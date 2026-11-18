package canvas

import (
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// ===== 智能画布：结果落地（素材库 / 下载） =====

// MaxCanvasSide 画布单边像素上限（下发给前端做输入校验）
func MaxCanvasSide() int { return maxCanvasSide }

// MaxCanvasDocumentMB 文档体积上限（MB）
func MaxCanvasDocumentMB() int { return maxCanvasDocumentBytes >> 20 }

// MaxCanvasUploadMB 单张图片上传/蒙版体积上限（MB）
func MaxCanvasUploadMB() int { return int(maxUploadBytes() >> 20) }

// taskResultImages 取出任务结果图（含归属与状态校验）
func taskResultImages(userID, taskID int) (*model.CanvasTask, []ResultImage, error) {
	task, err := model.GetCanvasTaskByID(taskID)
	if err != nil || task.UserID != userID {
		return nil, nil, ErrTaskNotFound
	}
	if task.Result == "" {
		return task, nil, errors.New("任务还没有结果")
	}
	var result TaskResult
	if err := common.UnmarshalJsonStr(task.Result, &result); err != nil {
		return task, nil, err
	}
	return task, result.Images, nil
}

// ResultDownloadURL 返回结果图的下载直链（自有存储地址）
func ResultDownloadURL(userID, taskID, index int) (string, error) {
	_, images, err := taskResultImages(userID, taskID)
	if err != nil {
		return "", err
	}
	if len(images) == 0 {
		return "", errors.New("任务没有可下载的结果")
	}
	if index < 0 || index >= len(images) {
		index = 0
	}
	if !isHTTPURL(images[index].URL) {
		return "", errors.New("结果地址不可下载")
	}
	return images[index].URL, nil
}

// SaveResultToLibrary 把结果图保存进现有共享素材库（源素材库）。
// 画布结果本就转存在自有 TOS，因此这里只登记引用，不再复制对象；
// 若结果仍在 24h 上游链接上，先补存一次再登记，避免素材库里出现会过期的地址。
func SaveResultToLibrary(userID, taskID, index int, name string) (*model.SourceAsset, error) {
	task, images, err := taskResultImages(userID, taskID)
	if err != nil {
		return nil, err
	}
	if len(images) == 0 {
		return nil, errors.New("任务没有可保存的结果")
	}
	if index < 0 || index >= len(images) {
		index = 0
	}
	img := images[index]
	url := img.URL
	if !strings.Contains(url, "/canvas") {
		stored, storeErr := storeRemoteToCanvasBucket(url, fmt.Sprintf("save_%d_%d.%s", taskID, index, img.Format), userID, task.ProjectID)
		if storeErr != nil {
			return nil, fmt.Errorf("结果转存失败: %w", storeErr)
		}
		url = stored
	}
	title := strings.TrimSpace(name)
	if title == "" {
		title = fmt.Sprintf("智能画布 · %s", toolLabel(task.Tool))
	}
	asset := &model.SourceAsset{
		UserID: userID, Name: title, AssetType: model.AssetTypeImage,
		SourceURL: url, Status: model.AssetStatusActive,
	}
	if err := asset.Insert(); err != nil {
		return nil, err
	}
	return asset, nil
}
