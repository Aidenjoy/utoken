package director

import (
	"github.com/QuantumNous/new-api/model"
)

// entityAssetRef 返回实体图片在当前视频模型下已同步且激活的 asset:// 引用；
// 未同步、素材被删除或仍在 pending 时返回空串（调用方回退为原始图片地址）。
// asset:// 引用会触发网关中间件把请求锁定到素材所属渠道，因此只有激活素材才可用。
func entityAssetRef(userID int, entityType string, entityID int, videoModel string) string {
	if videoModel == "" {
		return ""
	}
	m, err := model.GetDirectorEntityAsset(entityType, entityID, videoModel)
	if err != nil || m == nil || m.ID == 0 {
		return ""
	}
	a, err := model.GetAssetByChannelAndAssetID(m.ChannelID, m.AssetID)
	if err != nil || a == nil || a.ID == 0 || a.UserID != userID {
		return ""
	}
	if a.Status != model.AssetStatusActive {
		return ""
	}
	return model.AssetURIScheme + m.AssetID
}

// mentionEntityAssetRef 把 @ 引用标识（char/prop/scene/shot）映射为实体类型后查 asset:// 引用
func mentionEntityAssetRef(userID int, videoModel string) func(kind string, id int) string {
	return func(kind string, id int) string {
		var entityType string
		switch kind {
		case "char":
			entityType = model.DirectorEntityAssetCharacter
		case "prop":
			entityType = model.DirectorEntityAssetProp
		case "scene":
			entityType = model.DirectorEntityAssetScene
		case "shot":
			entityType = model.DirectorEntityAssetStoryboard
		default:
			return ""
		}
		return entityAssetRef(userID, entityType, id, videoModel)
	}
}
