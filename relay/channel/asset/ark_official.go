package asset

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
)

// ArkOfficialProtocol 火山方舟官方素材协议：
// Action=CreateAsset/GetAsset，Version=2024-01-01，service=ark。
// 网关地址默认 open.volcengineapi.com，可由渠道 asset_endpoint 改成方舟兼容网关；
// 鉴权方式由 asset_auth_mode 决定：默认 AK/SK V4 签名，bearer 则发渠道密钥。
type ArkOfficialProtocol struct {
	cfg ChannelConfig
	// endpoint 素材网关地址：来自渠道 asset_endpoint 配置（也允许测试覆盖），
	// 空时用默认的 https://open.volcengineapi.com。
	endpoint string
	// now 允许测试注入固定时间做确定性签名断言。
	now func() time.Time
	// signHost 覆写签名规范请求中的 host 头值（用于网关把路径前缀纳入 host 签名的场景，
	// 如星枢无极 mintel.591ll.com/render/api）。空时用 URL.Host。
	signHost string
	// signPath 覆写签名规范请求中的 URI 路径（如 "/assets/"）。空时用 URL.Path。
	signPath string
}

const (
	arkOfficialDefaultEndpoint = "https://open.volcengineapi.com"
	arkOfficialService         = "ark"
	arkOfficialVersion         = "2024-01-01"
	arkActionCreateAsset       = "CreateAsset"
	arkActionCreateAssetGroup  = "CreateAssetGroup"
	arkActionGetAsset          = "GetAsset"
	// arkDefaultAssetGroupName 渠道未配置 asset_group_id 时自动创建的默认虚拟人像素材组名称。
	arkDefaultAssetGroupName = "new-api-assets"
)

// normalizeAssetEndpoint 归一化渠道配置的方舟兼容素材网关地址。
// 留空返回 ""，由 call() 回退到火山官方默认地址；非空则要求是带 host 的绝对 URL。
// query 与 fragment 一律剥除：Action/Version 由 call() 按接口写入，而运维往往直接
// 从对接方给的 curl 里复制完整 URL（已带 ?Action=...&Version=...），不剥除会把
// 该次调用的 Action 固化到所有请求上。路径与尾斜杠原样保留，
// 因为部分网关的路径前缀既参与路由也参与签名（如 /seedance25/openapi/）。
func normalizeAssetEndpoint(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "", fmt.Errorf("invalid asset endpoint %q: expect an absolute http(s) URL like %s", raw, arkOfficialDefaultEndpoint)
	}
	return u.Scheme + "://" + u.Host + u.Path, nil
}

func (p *ArkOfficialProtocol) Upload(req UploadRequest) (*UploadResult, error) {
	groupID := strings.TrimSpace(p.cfg.Settings.AssetGroupID)
	createdGroupID := ""
	// “default” 不是火山合法的素材组 ID（组 ID 形如 group-xxxx），视同未配置走自动建组
	if groupID == "" || groupID == "default" {
		var err error
		groupID, err = p.createAssetGroup()
		if err != nil {
			return nil, fmt.Errorf("auto-create default asset group failed: %w", err)
		}
		createdGroupID = groupID
	}
	body, err := common.Marshal(map[string]any{
		"GroupId":     groupID,
		"URL":         req.URL,
		"AssetType":   req.AssetType,
		"Name":        req.Name,
		"ProjectName": p.cfg.Settings.AssetProjectName,
	})
	if err != nil {
		return nil, err
	}

	var result struct {
		ID string `json:"Id"`
	}
	if err := p.call(arkActionCreateAsset, body, &result); err != nil {
		return nil, err
	}
	if strings.TrimSpace(result.ID) == "" {
		return nil, fmt.Errorf("ark official CreateAsset returned empty asset id")
	}
	return &UploadResult{
		AssetID:        result.ID,
		GroupID:        groupID,
		ProjectName:    p.cfg.Settings.AssetProjectName,
		CreatedGroupID: createdGroupID,
	}, nil
}

// createAssetGroup 调用官方 CreateAssetGroup 创建默认虚拟人像素材组并返回其 ID；
// 未配置 ProjectName 时上游默认落入 default 项目。
func (p *ArkOfficialProtocol) createAssetGroup() (string, error) {
	payload := map[string]any{"Name": arkDefaultAssetGroupName}
	if projectName := strings.TrimSpace(p.cfg.Settings.AssetProjectName); projectName != "" {
		payload["ProjectName"] = projectName
	}
	body, err := common.Marshal(payload)
	if err != nil {
		return "", err
	}
	var result struct {
		ID string `json:"Id"`
	}
	if err := p.call(arkActionCreateAssetGroup, body, &result); err != nil {
		return "", err
	}
	if strings.TrimSpace(result.ID) == "" {
		return "", fmt.Errorf("ark official CreateAssetGroup returned empty group id")
	}
	return result.ID, nil
}

func (p *ArkOfficialProtocol) Query(assetID string) (*QueryResult, error) {
	body, err := common.Marshal(map[string]any{
		"Id": assetID,
	})
	if err != nil {
		return nil, err
	}

	var result struct {
		Status     string `json:"Status"`
		URL        string `json:"URL"`
		PreviewURL string `json:"PreviewURL"`
		// Error 是素材自身的失败原因（如百度网关对图片尺寸有 300–6000px 约束），
		// 与信封层 ResponseMetadata.Error 不同：后者会让 call() 直接返回 error。
		// 上游在成功时也可能带上空的 Error 对象，故必须判空后才能当失败原因用。
		Error *struct {
			Code    string `json:"Code"`
			Message string `json:"Message"`
		} `json:"Error"`
	}
	if err := p.call(arkActionGetAsset, body, &result); err != nil {
		// 终端性错误（如帧率/参数不合规）转成 failed 结果，前端不再无限转圈；
		// 可重试错误（限流/鉴权/服务端/网络）原样返回，素材保持 pending 继续轮询。
		if failed := terminalFailureResult(err); failed != nil {
			return failed, nil
		}
		return nil, err
	}
	preview := result.PreviewURL
	if preview == "" {
		preview = result.URL
	}
	errMsg := ""
	if result.Error != nil {
		errMsg = strings.TrimSpace(result.Error.Message)
		if errMsg == "" {
			errMsg = strings.TrimSpace(result.Error.Code)
		}
	}
	return &QueryResult{
		Status:     NormalizeUpstreamStatus(result.Status),
		PreviewURL: preview,
		ErrorMsg:   errMsg,
	}, nil
}

// call 执行一次请求并把 Result 解析到 out；鉴权方式按 asset_auth_mode 分支。
func (p *ArkOfficialProtocol) call(action string, body []byte, out any) error {
	endpoint := p.endpoint
	if endpoint == "" {
		endpoint = arkOfficialDefaultEndpoint
	}
	u, err := url.Parse(endpoint)
	if err != nil {
		return fmt.Errorf("invalid ark official endpoint: %w", err)
	}
	query := map[string]string{
		"Action":  action,
		"Version": arkOfficialVersion,
	}
	u.RawQuery = canonicalQuery(query)

	ctx, cancel := context.WithTimeout(context.Background(), defaultRequestTimeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	now := time.Now
	if p.now != nil {
		now = p.now
	}
	if p.cfg.Settings.AssetAuthModeOrDefault() == dto.AssetAuthModeBearer {
		// 渠道密钥可能是多行池，取第一条：整串发出去必然 401。
		apiKey := strings.TrimSpace(p.cfg.ApiKey)
		if i := strings.IndexAny(apiKey, "\r\n,"); i >= 0 {
			apiKey = strings.TrimSpace(apiKey[:i])
		}
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	} else {
		signHost := httpReq.URL.Host
		if p.signHost != "" {
			signHost = p.signHost
		}
		signPath := httpReq.URL.Path
		if p.signPath != "" {
			signPath = p.signPath
		}
		signRequest(httpReq, signParams{
			AK:      p.cfg.Settings.AssetAK,
			SK:      p.cfg.Settings.AssetSK,
			Region:  p.cfg.Settings.AssetRegionOrDefault(),
			Service: arkOfficialService,
			Host:    signHost,
			Path:    signPath,
			Query:   query,
			Headers: http.Header{"content-type": []string{"application/json"}},
			Body:    body,
			Now:     now(),
			SignedNames: []string{
				"content-type", "host", "x-content-sha256", "x-date",
			},
		})
	}

	client, err := httpClient(p.cfg.Proxy)
	if err != nil {
		return err
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return fmt.Errorf("asset request failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return &UpstreamError{Protocol: "ark_official", Action: action, Status: resp.StatusCode, Message: truncate(respBody)}
	}

	var envelope struct {
		ResponseMetadata struct {
			Error *struct {
				CodeN   int    `json:"CodeN"`
				Code    string `json:"Code"`
				Message string `json:"Message"`
			} `json:"Error"`
		} `json:"ResponseMetadata"`
		Result jsonRaw `json:"Result"`
	}
	if err := common.Unmarshal(respBody, &envelope); err != nil {
		return fmt.Errorf("parse %s response failed: %w, body: %s", action, err, truncate(respBody))
	}
	if envelope.ResponseMetadata.Error != nil {
		e := envelope.ResponseMetadata.Error
		// HTTP 200 但信封携带业务错误：真实状态由 C 系列错误码承载，Status 留 0，
		// 交给 Terminal() 从 Code 解析（如 C400999 → 400 → 终端错误）。
		return &UpstreamError{Protocol: "ark_official", Action: action, Code: e.Code, Message: e.Message}
	}
	if out != nil {
		if err := common.Unmarshal(envelope.Result, out); err != nil {
			return fmt.Errorf("parse %s result failed: %w, body: %s", action, err, truncate(respBody))
		}
	}
	return nil
}

// jsonRaw 延迟解析 Result 字段。
type jsonRaw []byte

func (r *jsonRaw) UnmarshalJSON(b []byte) error {
	*r = append((*r)[0:0], b...)
	return nil
}
