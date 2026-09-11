package controller

import (
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel/asset"
	"github.com/QuantumNous/new-api/service"
)

// assetProtocolAdapter 将 relay/channel/asset.Protocol 适配到 service.AssetProtocol。
type assetProtocolAdapter struct {
	inner asset.Protocol
}

func (a *assetProtocolAdapter) Upload(url string, assetType string, name string) (string, string, string, error) {
	res, err := a.inner.Upload(asset.UploadRequest{
		URL:       url,
		AssetType: assetType,
		Name:      name,
	})
	if err != nil {
		return "", "", "", err
	}
	return res.AssetID, res.GroupID, res.ProjectName, nil
}

func (a *assetProtocolAdapter) Query(assetID string) (string, string, string, error) {
	res, err := a.inner.Query(assetID)
	if err != nil {
		return "", "", "", err
	}
	return res.Status, res.PreviewURL, res.ErrorMsg, nil
}

// InitAssetProtocolFactory 初始化素材协议工厂，注入到 service 层。
// 在路由注册时调用。
func InitAssetProtocolFactory() {
	service.AssetProtocolFactoryFunc = func(channel *model.Channel) (service.AssetProtocolAdapter, error) {
		protocol, err := asset.NewProtocol(buildAssetChannelConfig(channel))
		if err != nil {
			return nil, err
		}
		return &assetProtocolAdapter{inner: protocol}, nil
	}
}
