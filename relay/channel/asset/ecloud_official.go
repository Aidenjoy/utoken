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
	"sort"
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

// ecloudClockSkew 本地时钟相对上游服务器的偏差（秒），由响应 Date 头自动校正，
// 供进程内全部移动云请求复用；上游要求 Timestamp 与服务器时差不超过限定（否则 400）。
var ecloudClockSkew atomic.Int64

// call 执行一次签名的移动云 API 调用，并把响应信封的 body 字段解析到 out。
// 上游以 INVALID_PARAMETER 拒绝 Timestamp 时（本地时钟漂移），利用响应 Date 头
// 纠偏后自动重试一次。
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
			Now:  now().Add(time.Duration(ecloudClockSkew.Load()) * time.Second),
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

// ecloudSyncClock 用上游响应 Date 头校正本地时钟偏差（秒）。
func ecloudSyncClock(resp *http.Response, localNow func() time.Time) {
	date := resp.Header.Get("Date")
	if date == "" {
		return
	}
	serverTime, err := http.ParseTime(date)
	if err != nil {
		return
	}
	ecloudClockSkew.Store(int64(serverTime.Sub(localNow()).Seconds()))
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
func signEcloudRequest(req *http.Request, p ecloudSignParams) {
	nonce := p.Nonce
	if nonce == "" {
		nonce = strings.ReplaceAll(uuid.NewString(), "-", "")
	}
	query := map[string]string{
		"Version":          ecloudAPIVersion,
		"AccessKey":        p.AK,
		"Timestamp":        p.Now.UTC().Format(ecloudTimestampLayout),
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
	req.URL.RawQuery = ecloudRawQuery(query)
}

// ecloudRawQuery 构造实际请求的 query 串：冒号保留不转义（官方示例 URL 中
// Timestamp=2017-01-11T15:15:11Z 为原样冒号，网关对 %3A 形式可能判格式非法）；
// 参与签名哈希的规范串仍用 canonicalQuery 的全转义形式。
func ecloudRawQuery(q map[string]string) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, ecloudEscape(k)+"="+ecloudEscape(q[k]))
	}
	return strings.Join(parts, "&")
}

// ecloudEscape 在 canonicalEscape 基础上保留 ':' 不转义（':' 在 URL query 中本就合法）。
func ecloudEscape(s string) string {
	return strings.ReplaceAll(canonicalEscape(s), "%3A", ":")
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
