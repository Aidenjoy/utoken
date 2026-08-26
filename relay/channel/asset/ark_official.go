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
)

// ArkOfficialProtocol 火山方舟官方素材协议：
// AK/SK 签名直连 universal API（host 默认 open.volcengineapi.com），
// Action=CreateAsset/GetAsset，Version=2024-01-01，service=ark。
type ArkOfficialProtocol struct {
	cfg ChannelConfig
	// endpoint 允许测试覆盖（默认 https://open.volcengineapi.com）。
	endpoint string
	// now 允许测试注入固定时间做确定性签名断言。
	now func() time.Time
}

const (
	arkOfficialDefaultEndpoint = "https://open.volcengineapi.com"
	arkOfficialService         = "ark"
	arkOfficialVersion         = "2024-01-01"
	arkActionCreateAsset       = "CreateAsset"
	arkActionGetAsset          = "GetAsset"
)

func (p *ArkOfficialProtocol) Upload(req UploadRequest) (*UploadResult, error) {
	groupID := strings.TrimSpace(p.cfg.Settings.AssetGroupID)
	if groupID == "" {
		return nil, fmt.Errorf("ark_official asset protocol requires asset_group_id")
	}
	body, err := common.Marshal(map[string]any{
		"GroupId":     groupID,
		"URL":         req.URL,
		"AssetType":   req.AssetType,
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
		AssetID:     result.ID,
		GroupID:     groupID,
		ProjectName: p.cfg.Settings.AssetProjectName,
	}, nil
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
	}
	if err := p.call(arkActionGetAsset, body, &result); err != nil {
		return nil, err
	}
	preview := result.PreviewURL
	if preview == "" {
		preview = result.URL
	}
	return &QueryResult{
		Status:     NormalizeUpstreamStatus(result.Status),
		PreviewURL: preview,
	}, nil
}

// call 执行一次签名请求并把 Result 解析到 out。
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
	signRequest(httpReq, signParams{
		AK:      p.cfg.Settings.AssetAK,
		SK:      p.cfg.Settings.AssetSK,
		Region:  p.cfg.Settings.AssetRegionOrDefault(),
		Service: arkOfficialService,
		Host:    httpReq.URL.Host,
		Path:    httpReq.URL.Path,
		Query:   query,
		Headers: http.Header{"content-type": []string{"application/json"}},
		Body:    body,
		Now:     now(),
		SignedNames: []string{
			"content-type", "host", "x-content-sha256", "x-date",
		},
	})

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
		return fmt.Errorf("upstream returned status %d: %s", resp.StatusCode, truncate(respBody))
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
		return fmt.Errorf("ark official %s failed (code=%s): %s", action, e.Code, e.Message)
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
