package asset

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// RelayProtocol 中转站风格素材协议（以 ctaigw 为代表）：
// 注册 POST {base}{asset_upload_path}，body {url, asset_type, name}，Bearer 渠道 key；
// 查询 GET {base}{asset_query_path}（{id} 占位符替换为素材 ID）。
// 响应统一为 {"code":0,"message":"ok","data":{...}}，code 非 0 即失败。
type RelayProtocol struct {
	cfg ChannelConfig
}

type relayEnvelope struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (p *RelayProtocol) Upload(req UploadRequest) (*UploadResult, error) {
	body, err := common.Marshal(map[string]any{
		"url":        req.URL,
		"asset_type": req.AssetType,
		"name":       req.Name,
	})
	if err != nil {
		return nil, err
	}

	uri := strings.TrimSuffix(p.cfg.BaseURL, "/") + p.cfg.Settings.AssetUploadPathOrDefault()
	httpReq, cancel, err := p.newRequest(http.MethodPost, uri, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer cancel()
	httpReq.Header.Set("Content-Type", "application/json")

	respBody, err := p.do(httpReq)
	if err != nil {
		return nil, err
	}

	var resp struct {
		relayEnvelope
		Data struct {
			ID          string `json:"Id"`
			GroupID     string `json:"GroupId"`
			ProjectName string `json:"ProjectName"`
		} `json:"data"`
	}
	if err := common.Unmarshal(respBody, &resp); err != nil {
		return nil, fmt.Errorf("parse upload response failed: %w, body: %s", err, truncate(respBody))
	}
	if resp.Code != 0 {
		return nil, fmt.Errorf("upstream asset upload failed (code=%d): %s", resp.Code, resp.Message)
	}
	if strings.TrimSpace(resp.Data.ID) == "" {
		return nil, fmt.Errorf("upstream asset upload returned empty asset id, body: %s", truncate(respBody))
	}
	return &UploadResult{
		AssetID:     resp.Data.ID,
		GroupID:     resp.Data.GroupID,
		ProjectName: resp.Data.ProjectName,
	}, nil
}

func (p *RelayProtocol) Query(assetID string) (*QueryResult, error) {
	path := strings.Replace(p.cfg.Settings.AssetQueryPathOrDefault(), "{id}", assetID, 1)
	uri := strings.TrimSuffix(p.cfg.BaseURL, "/") + path
	httpReq, cancel, err := p.newRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	defer cancel()

	respBody, err := p.do(httpReq)
	if err != nil {
		return nil, err
	}

	var resp struct {
		relayEnvelope
		Data struct {
			Status string `json:"Status"`
			URL    string `json:"URL"`
		} `json:"data"`
	}
	if err := common.Unmarshal(respBody, &resp); err != nil {
		return nil, fmt.Errorf("parse query response failed: %w, body: %s", err, truncate(respBody))
	}
	if resp.Code != 0 {
		return nil, fmt.Errorf("upstream asset query failed (code=%d): %s", resp.Code, resp.Message)
	}
	return &QueryResult{
		Status:     NormalizeUpstreamStatus(resp.Data.Status),
		PreviewURL: resp.Data.URL,
	}, nil
}

// newRequest 构造带超时的请求；cancel 由调用方在请求完成后调用。
func (p *RelayProtocol) newRequest(method, uri string, body io.Reader) (*http.Request, context.CancelFunc, error) {
	ctx, cancel := context.WithTimeout(context.Background(), defaultRequestTimeout)
	req, err := http.NewRequestWithContext(ctx, method, uri, body)
	if err != nil {
		cancel()
		return nil, nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.cfg.ApiKey)
	return req, cancel, nil
}

func (p *RelayProtocol) do(req *http.Request) ([]byte, error) {
	client, err := httpClient(p.cfg.Proxy)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("asset request failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream returned status %d: %s", resp.StatusCode, truncate(respBody))
	}
	return respBody, nil
}

func truncate(b []byte) string {
	s := string(b)
	if len(s) > 500 {
		return s[:500] + "...(truncated)"
	}
	return s
}
