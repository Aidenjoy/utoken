package asset

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/google/uuid"
)

// EcloudOfficialProtocol 移动云 MoMA 官方素材协议：
// query 参数式 AK/SK 签名（移动云通用签名机制）直连素材资产库 API，
// 注册 POST /api/openapi-maas/exp/aicc/v2/asset，
// 查询 GET /api/openapi-maas/exp/aicc/v2/asset/{assetId}。
type EcloudOfficialProtocol struct {
	cfg ChannelConfig
	// endpoint 允许测试覆盖（默认 https://ecloud.10086.cn）。
	endpoint string
	// now 允许测试注入固定时间做确定性签名断言。
	now func() time.Time
}

const (
	ecloudDefaultEndpoint = "https://ecloud.10086.cn"
	ecloudAssetPath       = "/api/openapi-maas/exp/aicc/v2/asset"
	ecloudAssetGroupPath  = "/api/openapi-maas/exp/aicc/v2/asset-group"
	// ecloudMaxAssetName 上游限制素材名称最长 64 个字符。
	ecloudMaxAssetName    = 64
	ecloudSignKeyPrefix   = "BC_SIGNATURE&"
	ecloudSignVersion     = "V2.0"
	ecloudSignMethod      = "HmacSHA1"
	ecloudAPIVersion      = "2016-12-05"
	ecloudTimestampLayout = "2006-01-02T15:04:05Z"
	// ecloudDefaultAssetGroupName 渠道未配置 asset_group_id 时自动创建的默认 AIGC 素材组名称。
	ecloudDefaultAssetGroupName = "new-api-assets"
)

func (p *EcloudOfficialProtocol) Upload(req UploadRequest) (*UploadResult, error) {
	groupID := strings.TrimSpace(p.cfg.Settings.AssetGroupID)
	createdGroupID := ""
	if groupID == "" {
		var err error
		groupID, err = p.createAssetGroup()
		if err != nil {
			return nil, fmt.Errorf("auto-create default asset group failed: %w", err)
		}
		createdGroupID = groupID
	}
	body, err := common.Marshal(map[string]any{
		"groupId":   groupID,
		"assetName": ecloudTruncateName(req.Name),
		"assetUrl":  req.URL,
		"assetType": req.AssetType,
	})
	if err != nil {
		return nil, err
	}

	var assetID string
	if err := p.call(http.MethodPost, ecloudAssetPath, body, &assetID); err != nil {
		return nil, err
	}
	if strings.TrimSpace(assetID) == "" {
		return nil, fmt.Errorf("ecloud asset upload returned empty asset id")
	}
	return &UploadResult{
		AssetID:        assetID,
		GroupID:        groupID,
		CreatedGroupID: createdGroupID,
	}, nil
}

// createAssetGroup 调用官方创建素材组接口建默认 AIGC 素材组并返回其 ID；
// 上游仅支持 API 创建 AIGC（虚拟人像）类型素材组。
func (p *EcloudOfficialProtocol) createAssetGroup() (string, error) {
	body, err := common.Marshal(map[string]any{
		"groupType": "AIGC",
		"groupName": ecloudDefaultAssetGroupName,
	})
	if err != nil {
		return "", err
	}
	var result struct {
		GroupID string `json:"groupId"`
	}
	if err := p.call(http.MethodPost, ecloudAssetGroupPath, body, &result); err != nil {
		return "", err
	}
	if strings.TrimSpace(result.GroupID) == "" {
		return "", fmt.Errorf("ecloud asset group creation returned empty group id")
	}
	return result.GroupID, nil
}

func (p *EcloudOfficialProtocol) Query(assetID string) (*QueryResult, error) {
	var detail struct {
		AssetID      string `json:"assetId"`
		AssetURL     string `json:"assetUrl"`
		Status       string `json:"status"`
		ErrorMessage string `json:"errorMessage"`
	}
	if err := p.call(http.MethodGet, ecloudAssetPath+"/"+url.PathEscape(assetID), nil, &detail); err != nil {
		return nil, err
	}
	return &QueryResult{
		Status:     NormalizeUpstreamStatus(detail.Status),
		PreviewURL: detail.AssetURL,
		ErrorMsg:   detail.ErrorMessage,
	}, nil
}

// 网关把 Timestamp 当作北京时间墙钟比对（真实 AK/SK 实测：北京墙钟恒通过、
// 真 UTC 恒被 INVALID_PARAMETER 拒绝；官方 Python/Java/Postman 示例亦为本地时间+字面 Z）。
// ecloudBaseOffset 为时区基准（秒，默认 +8h），被上游拒绝且无 Date 头时在 +8h/0 间回退切换；
// ecloudClockDrift 为秒级时钟漂移，由响应 Date 头持续校正（限幅 ±1h），二者叠加渲染 Timestamp。
var (
	ecloudBaseOffset atomic.Int64
	ecloudClockDrift atomic.Int64
)

const ecloudBeijingOffset = int64(8 * 3600)

func init() {
	ecloudBaseOffset.Store(ecloudBeijingOffset)
}

// call 执行一次签名的移动云 API 调用，并把响应信封的 body 字段解析到 out。
// 上游以 INVALID_PARAMETER 拒绝 Timestamp 时（时区解读或时钟漂移），
// 校正后自动重试一次。
func (p *EcloudOfficialProtocol) call(method, path string, body []byte, out any) error {
	endpoint := p.endpoint
	if endpoint == "" {
		endpoint = ecloudDefaultEndpoint
	}
	uri := strings.TrimSuffix(endpoint, "/") + path
	now := time.Now
	if p.now != nil {
		now = p.now
	}
	client, err := httpClient(p.cfg.Proxy)
	if err != nil {
		return err
	}

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		httpReq, err := http.NewRequest(method, uri, bytes.NewReader(body))
		if err != nil {
			return err
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Accept", "application/json")
		signEcloudRequest(httpReq, ecloudSignParams{
			AK:   p.cfg.Settings.AssetAK,
			SK:   p.cfg.Settings.AssetSK,
			Path: httpReq.URL.Path,
			Now:  ecloudTimestamp(now()),
		})

		ctx, cancel := context.WithTimeout(context.Background(), defaultRequestTimeout)
		resp, err := client.Do(httpReq.WithContext(ctx))
		cancel()
		if err != nil {
			return fmt.Errorf("asset request failed: %w", err)
		}
		ecloudSyncClock(resp, now)
		respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if err != nil {
			return err
		}

		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("upstream returned status %d: %s", resp.StatusCode, truncate(respBody))
			if attempt == 0 && isEcloudTimestampError(respBody) {
				ecloudAdjustClock(resp, now())
				continue
			}
			return lastErr
		}

		var envelope struct {
			State        string          `json:"state"`
			ErrorCode    string          `json:"errorCode"`
			ErrorMessage string          `json:"errorMessage"`
			Body         json.RawMessage `json:"body"`
		}
		if err := common.Unmarshal(respBody, &envelope); err != nil {
			return fmt.Errorf("parse ecloud response failed: %w, body: %s", err, truncate(respBody))
		}
		if envelope.State != "OK" {
			return fmt.Errorf("ecloud asset request failed (code=%s): %s", envelope.ErrorCode, envelope.ErrorMessage)
		}
		if out != nil {
			if err := common.Unmarshal(envelope.Body, out); err != nil {
				return fmt.Errorf("parse ecloud body failed: %w, body: %s", err, truncate(respBody))
			}
		}
		return nil
	}
	return lastErr
}

// ecloudTimestamp 返回渲染 Timestamp 所用的墙钟时刻：真实 UTC 叠加时区基准与秒级漂移。
func ecloudTimestamp(now time.Time) time.Time {
	return now.UTC().Add(time.Duration(ecloudBaseOffset.Load()+ecloudClockDrift.Load()) * time.Second)
}

// ecloudAdjustClock 在上游拒绝 Timestamp 后修正时钟：优先用响应 Date 头
// （RFC1123，恒为真实 UTC）刷新秒级漂移；无 Date 头时回退启发式——
// 时区基准在北京墙钟（+8h）与真实 UTC（0）之间切换后重试。
func ecloudAdjustClock(resp *http.Response, localNow time.Time) {
	if drift, ok := ecloudDateDrift(resp, localNow); ok {
		ecloudClockDrift.Store(drift)
		return
	}
	if ecloudBaseOffset.Load() == ecloudBeijingOffset {
		ecloudBaseOffset.Store(0)
	} else {
		ecloudBaseOffset.Store(ecloudBeijingOffset)
	}
}

// ecloudSyncClock 用上游响应 Date 头（RFC1123，恒为真实 UTC）微调秒级时钟漂移；
// 偏差超过 1 小时视为本地时钟严重失准，仅记录不采纳，避免污染时区基准。
func ecloudSyncClock(resp *http.Response, localNow func() time.Time) {
	if drift, ok := ecloudDateDrift(resp, localNow()); ok {
		ecloudClockDrift.Store(drift)
	}
}

// ecloudDateDrift 从响应 Date 头计算本地时钟的秒级漂移；无 Date 头或偏差超限时不采纳。
func ecloudDateDrift(resp *http.Response, localNow time.Time) (int64, bool) {
	date := resp.Header.Get("Date")
	if date == "" {
		return 0, false
	}
	serverTime, err := http.ParseTime(date)
	if err != nil {
		return 0, false
	}
	drift := int64(serverTime.Sub(localNow.UTC()).Seconds())
	if drift < -3600 || drift > 3600 {
		return 0, false
	}
	return drift, true
}

// isEcloudTimestampError 判断上游是否因 Timestamp 非法（时钟漂移）拒绝请求。
func isEcloudTimestampError(body []byte) bool {
	var e struct {
		ErrorCode    string `json:"errorCode"`
		ErrorMessage string `json:"errorMessage"`
	}
	if err := common.Unmarshal(body, &e); err != nil {
		return false
	}
	return e.ErrorCode == "INVALID_PARAMETER" && strings.Contains(e.ErrorMessage, "Timestamp")
}

// ecloudSignParams 移动云通用签名所需输入。
type ecloudSignParams struct {
	AK    string
	SK    string
	Path  string
	Now   time.Time
	Nonce string // 为空时自动生成；测试可注入固定值做确定性断言。
}

// signEcloudRequest 按移动云通用签名机制把公共签名参数追加到 query：
// StringToSign = METHOD\npercentEncode(path)\nsha256hex(排序后的规范 query)，
// Signature = HmacSHA1("BC_SIGNATURE&"+SK, StringToSign)。
// 注意 p.Now 应为 ecloudTimestamp 处理后的墙钟时刻，此处不得再做 UTC 归一。
func signEcloudRequest(req *http.Request, p ecloudSignParams) {
	nonce := p.Nonce
	if nonce == "" {
		nonce = strings.ReplaceAll(uuid.NewString(), "-", "")
	}
	query := map[string]string{
		"Version":          ecloudAPIVersion,
		"AccessKey":        p.AK,
		"Timestamp":        p.Now.Format(ecloudTimestampLayout),
		"SignatureMethod":  ecloudSignMethod,
		"SignatureVersion": ecloudSignVersion,
		"SignatureNonce":   nonce,
	}

	canonical := canonicalQuery(query)
	stringToSign := strings.Join([]string{
		req.Method,
		canonicalEscape(p.Path),
		hexSha256([]byte(canonical)),
	}, "\n")

	mac := hmac.New(sha1.New, []byte(ecloudSignKeyPrefix+p.SK))
	mac.Write([]byte(stringToSign))
	query["Signature"] = hex.EncodeToString(mac.Sum(nil))
	// 实际请求的 query 直接用全转义的规范串（含 %3A 冒号）——已用真实 AK/SK 实测通过，
	// 网关先 URL 解码参数再校验，与签名哈希所用电文天然一致。
	req.URL.RawQuery = canonicalQuery(query)
}

// ecloudTruncateName 上游限制素材名称最长 64 字符，按字符（非字节）截断。
func ecloudTruncateName(name string) string {
	name = strings.TrimSpace(name)
	runes := []rune(name)
	if len(runes) <= ecloudMaxAssetName {
		return name
	}
	return string(runes[:ecloudMaxAssetName])
}
