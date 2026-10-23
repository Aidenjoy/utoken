package asset

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relay/channel/bce"
	"github.com/QuantumNous/new-api/relay/channel/task/databuilder"
)

// BaiduDataBuilderProtocol 百度 DataBuilder 官方素材协议（手册 §3）：
// POST {base}/db-ms/seedance/material/?Action={Action}&Version=2024-01-01，
// Action=CreateAssetGroup/CreateAsset/GetAsset，鉴权为 BCE Auth V1 AK/SK 签名
// （与视频任务共用 relay/channel/bce，但凭据来源不同：优先渠道 asset_ak/asset_sk，
// 未配置时回落解析渠道密钥 "AK|SK"）。
type BaiduDataBuilderProtocol struct {
	cfg  ChannelConfig
	cred bce.Credentials
	// endpoint 素材库基址（不含 query）：渠道 base_url 归一化而来，
	// 空时回落官方网关 {DefaultBaseURL}/db-ms/seedance/material。
	endpoint string
	// projectName 素材所属项目：渠道 asset_project_name，空时为 default（手册示例值）。
	projectName string
	// now 允许测试注入固定时间做确定性签名断言。
	now func() time.Time
}

const (
	baiduDataBuilderVersion = "2024-01-01"
	baiduActionCreateAsset  = "CreateAsset"
	baiduActionCreateGroup  = "CreateAssetGroup"
	baiduActionGetAsset     = "GetAsset"
	// baiduDefaultAssetGroupName 渠道未配置 asset_group_id 时自动创建的默认素材组名称。
	baiduDefaultAssetGroupName = "new-api-assets"
	baiduDefaultProjectName    = "default"
)

// newBaiduDataBuilderProtocol 构造 DataBuilder 素材协议并解析签名凭据：
// asset_ak/asset_sk 优先（前端「百度 DataBuilder」协议选项单独填写），
// 未配置时回落渠道密钥 "AK|SK"（与视频任务同一份凭据）。
func newBaiduDataBuilderProtocol(cfg ChannelConfig) (*BaiduDataBuilderProtocol, error) {
	ak := strings.TrimSpace(cfg.Settings.AssetAK)
	sk := strings.TrimSpace(cfg.Settings.AssetSK)
	var cred bce.Credentials
	if ak != "" && sk != "" {
		cred = bce.Credentials{AK: ak, SK: sk}
	} else {
		parsed, err := bce.ParseAKSK(cfg.ApiKey)
		if err != nil {
			return nil, fmt.Errorf("baidu_databuilder asset protocol requires asset_ak and asset_sk, or a channel api key in 'ak|sk' format: %w", err)
		}
		cred = parsed
	}
	projectName := strings.TrimSpace(cfg.Settings.AssetProjectName)
	if projectName == "" {
		projectName = baiduDefaultProjectName
	}
	return &BaiduDataBuilderProtocol{
		cfg:         cfg,
		cred:        cred,
		endpoint:    databuilder.MaterialBaseURL(cfg.BaseURL),
		projectName: projectName,
	}, nil
}

func (p *BaiduDataBuilderProtocol) Upload(req UploadRequest) (*UploadResult, error) {
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
		"GroupId":     groupID,
		"URL":         req.URL,
		"AssetType":   req.AssetType,
		"Name":        req.Name,
		"ProjectName": p.projectName,
	})
	if err != nil {
		return nil, err
	}

	var result struct {
		ID      string `json:"Id"`
		AssetID string `json:"AssetId"`
	}
	if err := p.call(baiduActionCreateAsset, body, &result); err != nil {
		return nil, err
	}
	assetID := result.ID
	if assetID == "" {
		assetID = result.AssetID
	}
	if strings.TrimSpace(assetID) == "" {
		return nil, fmt.Errorf("databuilder CreateAsset returned empty asset id")
	}
	return &UploadResult{
		AssetID:        assetID,
		GroupID:        groupID,
		ProjectName:    p.projectName,
		CreatedGroupID: createdGroupID,
	}, nil
}

// createAssetGroup 调用 CreateAssetGroup 创建默认素材组并返回其 ID（手册 §3.1）。
func (p *BaiduDataBuilderProtocol) createAssetGroup() (string, error) {
	body, err := common.Marshal(map[string]any{
		"Name":        baiduDefaultAssetGroupName,
		"Description": "auto-created by new-api",
		"GroupType":   "AIGC",
		"ProjectName": p.projectName,
	})
	if err != nil {
		return "", err
	}
	var result struct {
		ID      string `json:"Id"`
		GroupID string `json:"GroupId"`
	}
	if err := p.call(baiduActionCreateGroup, body, &result); err != nil {
		return "", err
	}
	groupID := result.ID
	if groupID == "" {
		groupID = result.GroupID
	}
	if strings.TrimSpace(groupID) == "" {
		return "", fmt.Errorf("databuilder CreateAssetGroup returned empty group id")
	}
	return groupID, nil
}

func (p *BaiduDataBuilderProtocol) Query(assetID string) (*QueryResult, error) {
	body, err := common.Marshal(map[string]any{
		"Id":          assetID,
		"ProjectName": p.projectName,
	})
	if err != nil {
		return nil, err
	}

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
	if err := p.call(baiduActionGetAsset, body, &result); err != nil {
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

// call 执行一次素材库 Action 请求并把结果解析到 out。
// 响应信封兼容两种形态：方舟同族的 ResponseMetadata/Result 包装，
// 或 DataBuilder 网关直接返回的结果对象（含可选顶层 error/code/message）。
func (p *BaiduDataBuilderProtocol) call(action string, body []byte, out any) error {
	query := map[string]string{
		"Action":  action,
		"Version": baiduDataBuilderVersion,
	}
	endpoint := p.endpoint + "/?" + bce.CanonicalQuery(query)

	ctx, cancel := context.WithTimeout(context.Background(), defaultRequestTimeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	httpReq.Header.Set("Content-Type", "application/json; charset=utf-8")
	httpReq.Header.Set("Accept", "application/json")

	now := time.Now
	if p.now != nil {
		now = p.now
	}
	bce.SignRequest(httpReq, p.cred, "", query, now())

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
		return &UpstreamError{Protocol: "baidu_databuilder", Action: action, Status: resp.StatusCode, Message: extractErrorMessage(respBody)}
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
		Error  *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
		Code    *string `json:"code"`
		Message string  `json:"message"`
	}
	if err := common.Unmarshal(respBody, &envelope); err != nil {
		return fmt.Errorf("parse %s response failed: %w, body: %s", action, err, truncate(respBody))
	}
	if envelope.ResponseMetadata.Error != nil {
		e := envelope.ResponseMetadata.Error
		return &UpstreamError{Protocol: "baidu_databuilder", Action: action, Code: e.Code, Message: e.Message}
	}
	if envelope.Error != nil {
		return &UpstreamError{Protocol: "baidu_databuilder", Action: action, Code: envelope.Error.Code, Message: envelope.Error.Message}
	}
	if envelope.Code != nil && strings.TrimSpace(*envelope.Code) != "" && !strings.EqualFold(*envelope.Code, "success") {
		return &UpstreamError{Protocol: "baidu_databuilder", Action: action, Code: *envelope.Code, Message: envelope.Message}
	}

	if out == nil {
		return nil
	}
	result := []byte(envelope.Result)
	if len(result) == 0 {
		// 无 Result 包装：网关直接返回结果对象，整体解析
		result = respBody
	}
	if err := common.Unmarshal(result, out); err != nil {
		return fmt.Errorf("parse %s result failed: %w, body: %s", action, err, truncate(respBody))
	}
	return nil
}

// extractErrorMessage 尽力从非 200 响应体中提取人类可读错误原因，
// 兼容 {"error":{"message"}} / {"message"} 与纯文本三种形态。
func extractErrorMessage(respBody []byte) string {
	var probe struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if err := common.Unmarshal(respBody, &probe); err == nil {
		if probe.Error.Message != "" {
			return probe.Error.Message
		}
		if probe.Message != "" {
			return probe.Message
		}
	}
	return truncate(respBody)
}
