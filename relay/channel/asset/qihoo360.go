package asset

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// Qihoo360Protocol 360 智脑（api.360.cn）官方素材协议：
// 素材组与素材的创建、查询、更新、删除统一走 POST {host}/v1/images/generations，
// 用 body 里的 model 字段区分 cmecloud/* 动作，鉴权为 Authorization: Bearer <渠道密钥>
// （与视频任务同一把 key）。
// 响应是 OpenAI images 信封：真正的方舟结果塞在 data[0].b64_json 里；该字段文档示例
// 是明文 JSON（{"ResponseMetadata":..,"Result":..}），但字段名又暗示 base64，两种编码都兼容解析。
type Qihoo360Protocol struct {
	cfg ChannelConfig
	// apiKey 取渠道密钥池的第一条：整串多行 key 发出去必然 401。
	apiKey string
	// endpoint 素材接口完整地址：由渠道 base_url 的 scheme://host 派生 + /v1/images/generations。
	endpoint string
	// projectName 素材所属项目：渠道 asset_project_name，空时为 default。
	projectName string
}

const (
	qihoo360DefaultHost = "https://api.360.cn"
	qihoo360AssetPath   = "/v1/images/generations"

	qihoo360ModelCreateGroup      = "cmecloud/create-asset-group"
	qihoo360ModelCreateAsset      = "cmecloud/create-asset"
	qihoo360ModelGetAsset         = "cmecloud/get-asset"
	qihoo360ModelUpdateAsset      = "cmecloud/update-asset"
	qihoo360ModelUpdateAssetGroup = "cmecloud/update-asset-group"
	qihoo360ModelDeleteAsset      = "cmecloud/delete-asset"
	qihoo360ModelDeleteAssetGroup = "cmecloud/delete-asset-group"

	// qihoo360DefaultAssetGroupName 渠道未配置 asset_group_id 时自动创建的默认素材库名称。
	qihoo360DefaultAssetGroupName = "new-api-assets"
	qihoo360DefaultProjectName    = "default"
)

// newQihoo360Protocol 构造 360 素材协议：校验渠道密钥（Bearer），派生素材接口地址，
// ProjectName 缺省落 default。
func newQihoo360Protocol(cfg ChannelConfig) (*Qihoo360Protocol, error) {
	apiKey := strings.TrimSpace(cfg.ApiKey)
	if i := strings.IndexAny(apiKey, "\r\n,"); i >= 0 {
		apiKey = strings.TrimSpace(apiKey[:i])
	}
	if apiKey == "" {
		return nil, fmt.Errorf("qihoo360 asset protocol requires a channel api key")
	}
	projectName := strings.TrimSpace(cfg.Settings.AssetProjectName)
	if projectName == "" {
		projectName = qihoo360DefaultProjectName
	}
	return &Qihoo360Protocol{
		cfg:         cfg,
		apiKey:      apiKey,
		endpoint:    qihoo360AssetEndpoint(cfg.BaseURL),
		projectName: projectName,
	}, nil
}

// qihoo360AssetEndpoint 从渠道 base_url 派生素材接口地址：360 视频渠道 base_url 形如
// https://api.360.cn/api/v3，而素材接口挂在 host 根的 /v1/images/generations，
// 因此只取 scheme://host 再拼素材路径；base_url 缺失或无法解析时回落官方域名。
func qihoo360AssetEndpoint(baseURL string) string {
	trimmed := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	if u, err := url.Parse(trimmed); err == nil && u.Scheme != "" && u.Host != "" {
		return u.Scheme + "://" + u.Host + qihoo360AssetPath
	}
	return qihoo360DefaultHost + qihoo360AssetPath
}

func (p *Qihoo360Protocol) Upload(req UploadRequest) (*UploadResult, error) {
	groupID := strings.TrimSpace(p.cfg.Settings.AssetGroupID)
	createdGroupID := ""
	if groupID == "" {
		var err error
		groupID, err = p.CreateAssetGroup(qihoo360DefaultAssetGroupName, "auto-created by new-api", "AIGC", p.projectName)
		if err != nil {
			return nil, fmt.Errorf("auto-create default asset group failed: %w", err)
		}
		createdGroupID = groupID
	}
	result, err := p.CreateAssetInGroup(groupID, req.URL, req.AssetType, req.Name, p.projectName)
	if err != nil {
		return nil, err
	}
	result.CreatedGroupID = createdGroupID
	return result, nil
}

// CreateAssetGroup 调用 cmecloud/create-asset-group 创建素材组并返回其 ID。
func (p *Qihoo360Protocol) CreateAssetGroup(name, description, groupType, projectName string) (string, error) {
	payload := map[string]any{"Name": name}
	if description != "" {
		payload["Description"] = description
	}
	if groupType != "" {
		payload["GroupType"] = groupType
	}
	if projectName != "" {
		payload["ProjectName"] = projectName
	}
	var result struct {
		ID      string `json:"Id"`
		GroupID string `json:"GroupId"`
	}
	if err := p.call(qihoo360ModelCreateGroup, payload, &result); err != nil {
		return "", err
	}
	groupID := result.ID
	if groupID == "" {
		groupID = result.GroupID
	}
	if strings.TrimSpace(groupID) == "" {
		return "", fmt.Errorf("qihoo360 create-asset-group returned empty group id")
	}
	return groupID, nil
}

// CreateAssetInGroup 在指定素材组中创建素材，不读取渠道默认组，也不自动建组。
func (p *Qihoo360Protocol) CreateAssetInGroup(groupID, url, assetType, name, projectName string) (*UploadResult, error) {
	var result struct {
		ID      string `json:"Id"`
		AssetID string `json:"AssetId"`
	}
	if err := p.call(qihoo360ModelCreateAsset, map[string]any{
		"GroupId":     groupID,
		"AssetType":   assetType,
		"URL":         url,
		"Name":        name,
		"ProjectName": projectName,
	}, &result); err != nil {
		return nil, err
	}
	assetID := result.ID
	if assetID == "" {
		assetID = result.AssetID
	}
	if strings.TrimSpace(assetID) == "" {
		return nil, fmt.Errorf("qihoo360 create-asset returned empty asset id")
	}
	return &UploadResult{AssetID: assetID, GroupID: groupID, ProjectName: projectName}, nil
}

// UpdateAsset 更新素材名称。
func (p *Qihoo360Protocol) UpdateAsset(assetID, name, projectName string) error {
	payload := map[string]any{"Id": assetID}
	if name != "" {
		payload["Name"] = name
	}
	if projectName != "" {
		payload["ProjectName"] = projectName
	}
	return p.call(qihoo360ModelUpdateAsset, payload, nil)
}

// UpdateAssetGroup 更新素材组名称和描述。
func (p *Qihoo360Protocol) UpdateAssetGroup(groupID, name, description, projectName string) error {
	payload := map[string]any{"Id": groupID}
	if name != "" {
		payload["Name"] = name
	}
	if description != "" {
		payload["Description"] = description
	}
	if projectName != "" {
		payload["ProjectName"] = projectName
	}
	return p.call(qihoo360ModelUpdateAssetGroup, payload, nil)
}

// DeleteAsset 删除上游素材。
func (p *Qihoo360Protocol) DeleteAsset(assetID, projectName string) error {
	payload := map[string]any{"Id": assetID}
	if projectName != "" {
		payload["ProjectName"] = projectName
	}
	return p.call(qihoo360ModelDeleteAsset, payload, nil)
}

// DeleteAssetGroup 删除上游素材组。
func (p *Qihoo360Protocol) DeleteAssetGroup(groupID, projectName string) error {
	payload := map[string]any{"Id": groupID}
	if projectName != "" {
		payload["ProjectName"] = projectName
	}
	return p.call(qihoo360ModelDeleteAssetGroup, payload, nil)
}

func (p *Qihoo360Protocol) Query(assetID string) (*QueryResult, error) {
	var result struct {
		Status     string `json:"Status"`
		URL        string `json:"URL"`
		PreviewURL string `json:"PreviewURL"`
		// Error 是素材自身的失败原因，与信封层错误不同（后者由 call() 直接返回 error）。
		// 上游成功时也可能带空 Error 对象，必须判空后才能当失败原因用。
		Error *struct {
			Code    string `json:"Code"`
			Message string `json:"Message"`
		} `json:"Error"`
	}
	if err := p.call(qihoo360ModelGetAsset, map[string]any{
		"Id":          assetID,
		"ProjectName": p.projectName,
	}, &result); err != nil {
		// 终端性错误（如素材参数不合规）转成 failed 结果，前端不再无限转圈；
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

// call 执行一次素材请求：以 {model, extra_body} 信封发出，解析 OpenAI images 响应，
// 再把 data[0].b64_json 里的方舟结果信封解出到 out。
func (p *Qihoo360Protocol) call(model string, extraBody map[string]any, out any) error {
	body, err := common.Marshal(map[string]any{"model": model, "extra_body": extraBody})
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultRequestTimeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)

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
		return &UpstreamError{Protocol: "qihoo360", Action: model, Status: resp.StatusCode, Message: extractErrorMessage(respBody)}
	}

	// 外层 OpenAI images 信封：失败时携带 error，成功时结果在 data[0].b64_json。
	var outer struct {
		Data []struct {
			B64JSON string `json:"b64_json"`
		} `json:"data"`
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := common.Unmarshal(respBody, &outer); err != nil {
		return fmt.Errorf("parse %s response failed: %w, body: %s", model, err, truncate(respBody))
	}
	if outer.Error != nil {
		return &UpstreamError{Protocol: "qihoo360", Action: model, Code: outer.Error.Code, Message: outer.Error.Message}
	}
	if len(outer.Data) == 0 || strings.TrimSpace(outer.Data[0].B64JSON) == "" {
		return fmt.Errorf("qihoo360 %s returned empty data, body: %s", model, truncate(respBody))
	}

	// 内层方舟信封：b64_json 文档示例是明文 JSON，字段名又暗示 base64，两者都兼容。
	// base64 字母表不含 '{'，明文 JSON 必然解码失败，故先尝试解码、解出合法对象才替换。
	payload := outer.Data[0].B64JSON
	if decoded, derr := base64.StdEncoding.DecodeString(strings.TrimSpace(payload)); derr == nil {
		if t := bytes.TrimSpace(decoded); len(t) > 0 && t[0] == '{' {
			payload = string(decoded)
		}
	}

	var envelope struct {
		ResponseMetadata struct {
			Error *struct {
				Code    string `json:"Code"`
				Message string `json:"Message"`
			} `json:"Error"`
		} `json:"ResponseMetadata"`
		Result jsonRaw `json:"Result"`
	}
	if err := common.Unmarshal([]byte(payload), &envelope); err != nil {
		return fmt.Errorf("parse %s result failed: %w, body: %s", model, err, truncate(respBody))
	}
	if envelope.ResponseMetadata.Error != nil {
		e := envelope.ResponseMetadata.Error
		return &UpstreamError{Protocol: "qihoo360", Action: model, Code: e.Code, Message: e.Message}
	}

	if out == nil {
		return nil
	}
	result := []byte(envelope.Result)
	if len(result) == 0 {
		// 无 Result 包装：b64_json 直接是结果对象，整体解析
		result = []byte(payload)
	}
	if err := common.Unmarshal(result, out); err != nil {
		return fmt.Errorf("parse %s result failed: %w, body: %s", model, err, truncate(respBody))
	}
	return nil
}
