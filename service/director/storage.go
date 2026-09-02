package director

import (
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// ===== 云导演：存储（统一走 TOS 对象存储） =====

// directorBatchID TOS 对象键的批次段：同一项目的产出物归档到同一文件夹
// （对象键布局 {date}/{userId}_{batchId}/{filename}）
func directorBatchID(projectID int) string {
	if projectID > 0 {
		return fmt.Sprintf("director%d", projectID)
	}
	return "director"
}

// storeBytesToTOS 将字节流上传到 TOS，返回可公开访问的 URL
func storeBytesToTOS(data []byte, filename string, userID, projectID int) (string, error) {
	if len(data) == 0 {
		return "", fmt.Errorf("空文件内容")
	}
	url, _, err := common.UploadBytesToTOS(data, filename, userID, directorBatchID(projectID))
	return url, err
}

// storeRemoteFileToTOS 下载远程文件并转存到 TOS（防止临时链接过期）
func storeRemoteFileToTOS(remoteURL, filename string, userID, projectID int) (string, error) {
	client := &http.Client{Timeout: 300 * time.Second}
	resp, err := client.Get(remoteURL)
	if err != nil {
		return "", fmt.Errorf("下载远程文件失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("下载远程文件失败: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return storeBytesToTOS(data, filename, userID, projectID)
}

// storeHeaderToTOS 将用户上传的文件转存到 TOS，返回可公开访问的 URL
func storeHeaderToTOS(header *multipart.FileHeader, userID, projectID int) (string, error) {
	f, err := header.Open()
	if err != nil {
		return "", err
	}
	defer f.Close()
	url, _, err := common.UploadReaderToTOS(f, header.Filename, userID, directorBatchID(projectID))
	return url, err
}

// episodeInfo 由分集 ID 查集号与所属项目 ID
func episodeInfo(episodeID int) (episodeNumber int, projectID int) {
	if episodeID == 0 {
		return 0, 0
	}
	if e, err := model.GetDirectorEpisodeByID(episodeID); err == nil {
		return e.EpisodeNumber, e.ProjectID
	}
	return 0, 0
}

// toDataURL 校验图片地址可被外部 AI 服务直接消费：
// 存储已全面 TOS 化，仅接受 http(s)/data URL
func toDataURL(imageURL string) (string, error) {
	if strings.HasPrefix(imageURL, "http://") || strings.HasPrefix(imageURL, "https://") || strings.HasPrefix(imageURL, "data:") {
		return imageURL, nil
	}
	return "", fmt.Errorf("图片地址无法直接访问：请确保图片为可公开访问的 URL")
}
