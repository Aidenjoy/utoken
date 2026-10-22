package controller

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

// 实验性探针：把按官方 seedance 2.0/2.5 协议发来的请求实际打到 mini 上，
// 用于评估「换成 mini 之后画质还够不够用」。
//
// 隔离方式（这是它能随时下线、且不可能影响线上业务的前提）：
//   - 全部实现只在本文件 + router/api-router.go 里一个 env 守卫块内；
//     SEEDANCE_PROBE_ENABLED 不为 true（或没配独立 Ark key）时路由根本不注册。
//   - 不经过 relay 管线：不写 tasks 表、不写日志、不预扣费、不动任何用户额度。
//     Ark 侧的花费直接记在 SEEDANCE_PROBE_ARK_KEY 这把独立密钥上。
//   - RootAuth 专属，客户拿不到入口。
//
// 响应保真：上游 JSON 原样透传，只用 sjson 改写 content.video_url 一个字段
// （换成转存到自有 TOS 后的地址——Ark 的签名 URL 只活 24 小时）。其余字段，
// 包括 model 与 usage，都是上游返回的真实值，本探针不编造任何一个。
// 附加的 _probe 块是诊断信息（客户端请求的模型 vs 实际调用的模型、TOS 对象键、
// 下载字节数、各阶段耗时）；JSON 加字段是向后兼容的，客户端按需忽略即可。
const (
	seedanceProbeDefaultBaseURL = "https://ark.cn-beijing.volces.com/api/v3"
	seedanceProbeDefaultTarget  = "doubao-seedance-2-0-mini"

	// Ark 的任务响应只有几百字节，这个上限纯粹是防止异常上游把内存打满。
	seedanceProbeMaxResponseBytes = 8 << 20
	// 转存单片上限。4K 成片也就几百 MB，超过这个量说明上游返回的不是视频。
	seedanceProbeMaxVideoBytes = 2 << 30

	seedanceProbeAPITimeout      = 60 * time.Second
	seedanceProbeDownloadTimeout = 10 * time.Minute

	// 与 Ark 签名 URL 的 X-Tos-Expires=86400 对齐：过期后原始 URL 已不可下载，
	// 缓存的转存结果也就没必要再留着了。
	seedanceProbeCacheTTL        = 24 * time.Hour
	seedanceProbeCacheMaxEntries = 512

	// TOS 对象键里的 batchID，固定值让所有探针产物落在同一目录，便于整体清理。
	seedanceProbeTOSBatchID = "seedance-probe"
)

type seedanceProbeConfig struct {
	baseURL     string
	apiKey      string
	targetModel string
}

// SeedanceProbeEnabled 报告探针是否应当注册路由。没配 Ark key 时一律视为关闭，
// 免得注册了路由却每个请求都失败。
func SeedanceProbeEnabled() bool {
	if !common.GetEnvOrDefaultBool("SEEDANCE_PROBE_ENABLED", false) {
		return false
	}
	return strings.TrimSpace(common.GetEnvOrDefaultString("SEEDANCE_PROBE_ARK_KEY", "")) != ""
}

func getSeedanceProbeConfig() seedanceProbeConfig {
	return seedanceProbeConfig{
		baseURL: strings.TrimSuffix(strings.TrimSpace(
			common.GetEnvOrDefaultString("SEEDANCE_PROBE_ARK_BASE_URL", seedanceProbeDefaultBaseURL)), "/"),
		apiKey:      strings.TrimSpace(common.GetEnvOrDefaultString("SEEDANCE_PROBE_ARK_KEY", "")),
		targetModel: strings.TrimSpace(common.GetEnvOrDefaultString("SEEDANCE_PROBE_TARGET_MODEL", seedanceProbeDefaultTarget)),
	}
}

// 任务 ID → 探针上下文。提交时记下客户端请求的模型名（上游响应里没有这个信息），
// 查询时若已转存过则直接复用结果，避免客户端每次轮询都重新下载上传一遍。
type seedanceProbeEntry struct {
	requestedModel string
	tosURL         string
	tosObjectKey   string
	expiresAt      time.Time
}

var (
	seedanceProbeMu    sync.Mutex
	seedanceProbeCache = map[string]seedanceProbeEntry{}
)

func seedanceProbeGet(taskID string) (seedanceProbeEntry, bool) {
	seedanceProbeMu.Lock()
	defer seedanceProbeMu.Unlock()
	seedanceProbePurgeLocked()
	entry, ok := seedanceProbeCache[taskID]
	return entry, ok
}

func seedanceProbePut(taskID string, entry seedanceProbeEntry) {
	seedanceProbeMu.Lock()
	defer seedanceProbeMu.Unlock()
	seedanceProbePurgeLocked()
	// 探针不接数据库，缓存就是唯一的转存记录，满了只能挤掉最早过期的那条。
	if len(seedanceProbeCache) >= seedanceProbeCacheMaxEntries {
		oldestKey, oldestExpiry := "", time.Now().Add(seedanceProbeCacheTTL)
		for key, existing := range seedanceProbeCache {
			if existing.expiresAt.Before(oldestExpiry) {
				oldestKey, oldestExpiry = key, existing.expiresAt
			}
		}
		delete(seedanceProbeCache, oldestKey)
	}
	entry.expiresAt = time.Now().Add(seedanceProbeCacheTTL)
	seedanceProbeCache[taskID] = entry
}

func seedanceProbePurgeLocked() {
	now := time.Now()
	for key, entry := range seedanceProbeCache {
		if entry.expiresAt.Before(now) {
			delete(seedanceProbeCache, key)
		}
	}
}

// SeedanceProbeSubmit 对应官方 POST {base}/contents/generations/tasks：
// 请求体原样透传，只把 model 换成探针目标模型；未显式传 watermark 时补 false
// 去水印，与 arknative 适配器的线上行为保持一致，这样画质对比才有意义。
func SeedanceProbeSubmit(c *gin.Context) {
	cfg := getSeedanceProbeConfig()

	storage, err := common.GetBodyStorage(c)
	if err != nil {
		seedanceProbeFail(c, http.StatusBadRequest, "invalid_request_error", err.Error())
		return
	}
	body, err := io.ReadAll(storage)
	if err != nil {
		seedanceProbeFail(c, http.StatusBadRequest, "invalid_request_error", err.Error())
		return
	}

	requestedModel := strings.TrimSpace(gjson.GetBytes(body, "model").String())
	if requestedModel == "" {
		seedanceProbeFail(c, http.StatusBadRequest, "invalid_request_error", "model is required")
		return
	}

	upstreamBody, err := sjson.SetBytes(body, "model", cfg.targetModel)
	if err != nil {
		seedanceProbeFail(c, http.StatusInternalServerError, "server_error", "rewrite model failed: "+err.Error())
		return
	}
	if !gjson.GetBytes(body, "watermark").Exists() {
		if upstreamBody, err = sjson.SetBytes(upstreamBody, "watermark", false); err != nil {
			seedanceProbeFail(c, http.StatusInternalServerError, "server_error", "set watermark failed: "+err.Error())
			return
		}
	}

	startedAt := time.Now()
	respBody, status, err := seedanceProbeRequest(c.Request.Context(), cfg, http.MethodPost,
		cfg.baseURL+"/contents/generations/tasks", upstreamBody, seedanceProbeAPITimeout)
	if err != nil {
		logger.LogError(c.Request.Context(), "[SeedanceProbe] submit failed: "+err.Error())
		seedanceProbeFail(c, http.StatusBadGateway, "upstream_error", err.Error())
		return
	}

	taskID := strings.TrimSpace(gjson.GetBytes(respBody, "id").String())
	if status == http.StatusOK && taskID != "" {
		seedanceProbePut(taskID, seedanceProbeEntry{requestedModel: requestedModel})
	}

	probe := newSeedanceProbe(cfg, requestedModel, "submit")
	probe["elapsed_ms"] = time.Since(startedAt).Milliseconds()
	probe["upstream_bytes"] = len(upstreamBody)
	seedanceProbeWrite(c, status, respBody, "", probe)
}

// SeedanceProbeFetch 对应官方 GET {base}/contents/generations/tasks/{id}：
// 未完成时原样透传；succeeded 时下载成片、转存自有 TOS，再只改写 video_url。
func SeedanceProbeFetch(c *gin.Context) {
	cfg := getSeedanceProbeConfig()
	taskID := strings.TrimSpace(c.Param("id"))
	if taskID == "" {
		seedanceProbeFail(c, http.StatusBadRequest, "invalid_request_error", "task id is required")
		return
	}

	entry, _ := seedanceProbeGet(taskID)

	startedAt := time.Now()
	respBody, status, err := seedanceProbeRequest(c.Request.Context(), cfg, http.MethodGet,
		cfg.baseURL+"/contents/generations/tasks/"+url.PathEscape(taskID), nil, seedanceProbeAPITimeout)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("[SeedanceProbe] fetch %s failed: %s", taskID, err.Error()))
		seedanceProbeFail(c, http.StatusBadGateway, "upstream_error", err.Error())
		return
	}
	if status != http.StatusOK {
		seedanceProbeWrite(c, status, respBody, "", newSeedanceProbe(cfg, entry.requestedModel, "fetch"))
		return
	}

	upstreamStatus := gjson.GetBytes(respBody, "status").String()
	upstreamVideoURL := strings.TrimSpace(gjson.GetBytes(respBody, "content.video_url").String())
	if upstreamStatus != "succeeded" || upstreamVideoURL == "" {
		probe := newSeedanceProbe(cfg, entry.requestedModel, "poll")
		probe["status"] = upstreamStatus
		probe["elapsed_ms"] = time.Since(startedAt).Milliseconds()
		seedanceProbeWrite(c, status, respBody, "", probe)
		return
	}

	// 已转存过就直接复用：客户端反复轮询不会重复下载上传。
	if entry.tosURL != "" {
		probe := newSeedanceProbe(cfg, entry.requestedModel, "succeeded")
		probe["rehosted"] = true
		probe["rehost_cached"] = true
		probe["tos_object_key"] = entry.tosObjectKey
		probe["upstream_video_url"] = upstreamVideoURL
		seedanceProbeWrite(c, status, respBody, entry.tosURL, probe)
		return
	}

	probe := newSeedanceProbe(cfg, entry.requestedModel, "succeeded")
	probe["upstream_video_url"] = upstreamVideoURL

	downloadStartedAt := time.Now()
	videoBytes, err := seedanceProbeDownload(c.Request.Context(), upstreamVideoURL)
	probe["downloaded_ms"] = time.Since(downloadStartedAt).Milliseconds()

	rehostedURL := ""
	if err == nil {
		probe["video_bytes"] = len(videoBytes)
		var tosURL, tosObjectKey string
		tosURL, tosObjectKey, err = common.UploadBytesToTOS(videoBytes, taskID+".mp4", c.GetInt("id"), seedanceProbeTOSBatchID)
		if err == nil {
			entry.tosURL, entry.tosObjectKey = tosURL, tosObjectKey
			seedanceProbePut(taskID, entry)
			probe["rehosted"] = true
			probe["tos_object_key"] = tosObjectKey
			rehostedURL = tosURL
		}
	}
	// 转存失败不阻断探针：video_url 保持上游原值（24 小时内仍可下载），并说明原因。
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("[SeedanceProbe] rehost %s failed: %s", taskID, err.Error()))
		probe["rehosted"] = false
		probe["rehost_error"] = err.Error()
	}
	seedanceProbeWrite(c, status, respBody, rehostedURL, probe)
}

func newSeedanceProbe(cfg seedanceProbeConfig, requestedModel, stage string) gin.H {
	return gin.H{
		"stage":           stage,
		"requested_model": requestedModel,
		"target_model":    cfg.targetModel,
	}
}

// seedanceProbeWrite 透传上游响应：只把 content.video_url 换成 replacement
// （为空表示不改写），并挂上 _probe 诊断块，其余字段保留上游原值。
func seedanceProbeWrite(c *gin.Context, status int, respBody []byte, replacement string, probe gin.H) {
	probe["upstream_model"] = gjson.GetBytes(respBody, "model").String()

	out := respBody
	if replacement != "" {
		rewritten, err := sjson.SetBytes(out, "content.video_url", replacement)
		if err != nil {
			logger.LogError(c.Request.Context(), "[SeedanceProbe] rewrite video_url failed: "+err.Error())
		} else {
			out = rewritten
		}
	}

	probeJSON, err := common.Marshal(probe)
	if err != nil {
		logger.LogError(c.Request.Context(), "[SeedanceProbe] marshal _probe failed: "+err.Error())
		c.Data(status, "application/json", out)
		return
	}
	withProbe, err := sjson.SetRawBytes(out, "_probe", probeJSON)
	if err != nil {
		logger.LogError(c.Request.Context(), "[SeedanceProbe] attach _probe failed: "+err.Error())
		c.Data(status, "application/json", out)
		return
	}
	c.Data(status, "application/json", withProbe)
}

func seedanceProbeFail(c *gin.Context, status int, errType, message string) {
	c.JSON(status, gin.H{
		"error": gin.H{"type": errType, "message": message},
	})
}

func seedanceProbeRequest(ctx context.Context, cfg seedanceProbeConfig, method, uri string,
	body []byte, timeout time.Duration) ([]byte, int, error) {
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(reqCtx, method, uri, reader)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.apiKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := service.GetSSRFProtectedHTTPClient().Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, seedanceProbeMaxResponseBytes))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return respBody, resp.StatusCode, nil
}

// seedanceProbeDownload 拉取成片。URL 来自可信的 Ark 响应而非用户输入，
// 但仍按 controller/video_proxy.go 的既有做法先过 SSRF 校验再取。
func seedanceProbeDownload(ctx context.Context, videoURL string) ([]byte, error) {
	if err := service.ValidateSSRFProtectedFetchURL(videoURL); err != nil {
		return nil, fmt.Errorf("video url blocked: %w", err)
	}

	reqCtx, cancel := context.WithTimeout(ctx, seedanceProbeDownloadTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, videoURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := service.GetSSRFProtectedHTTPClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream video returned status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(io.LimitReader(resp.Body, seedanceProbeMaxVideoBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("upstream video is empty")
	}
	if int64(len(data)) > seedanceProbeMaxVideoBytes {
		return nil, fmt.Errorf("video exceeds the %d byte cap", int64(seedanceProbeMaxVideoBytes))
	}
	return data, nil
}
