package director

import (
	"fmt"
	"sync"
)

// 批量任务并发队列：限制同类上游服务的在途请求数，
// 批量提交时先发送限额内的请求，有完成的再发送排队中的，避免触发上游 429 突发限流。
const (
	llmConcurrentLimit    = 2 // 文本模型并发上限
	imageConcurrentLimit  = 2 // 图片生成并发上限
	videoConcurrentLimit  = 2 // 视频生成并发上限
	renderConcurrentLimit = 1 // 剪辑渲染并发上限（ffmpeg 重编码 CPU 密集，本地串行）
)

var (
	llmSem    = make(chan struct{}, llmConcurrentLimit)
	imageSem  = make(chan struct{}, imageConcurrentLimit)
	videoSem  = make(chan struct{}, videoConcurrentLimit)
	renderSem = make(chan struct{}, renderConcurrentLimit)
)

// acquireLLMSlot / releaseLLMSlot 文本模型调用槽位
func acquireLLMSlot() { llmSem <- struct{}{} }
func releaseLLMSlot() { <-llmSem }

// acquireImageSlot / releaseImageSlot 图片生成槽位
func acquireImageSlot() { imageSem <- struct{}{} }
func releaseImageSlot() { <-imageSem }

// acquireVideoSlot / releaseVideoSlot 视频生成槽位
func acquireVideoSlot() { videoSem <- struct{}{} }
func releaseVideoSlot() { <-videoSem }

// acquireRenderSlot / releaseRenderSlot 剪辑渲染槽位
func acquireRenderSlot() { renderSem <- struct{}{} }
func releaseRenderSlot() { <-renderSem }

// 分集级 AI 任务互斥锁：改写/提取/拆解是同步长耗时请求，模型排队时可能超过代理超时被掐断，
// 前端误以为失败重复点击会导致双重执行（浪费额度、数据互相覆盖），这里按 task+分集 拒绝重入。
var (
	episodeTaskMu   sync.Mutex
	episodeTaskBusy = make(map[string]struct{})
)

// tryAcquireEpisodeTask 尝试占用分集任务锁，成功返回释放函数；已在执行中返回 false
func tryAcquireEpisodeTask(task string, episodeID int) (func(), bool) {
	key := fmt.Sprintf("%s:%d", task, episodeID)
	episodeTaskMu.Lock()
	defer episodeTaskMu.Unlock()
	if _, ok := episodeTaskBusy[key]; ok {
		return nil, false
	}
	episodeTaskBusy[key] = struct{}{}
	return func() {
		episodeTaskMu.Lock()
		delete(episodeTaskBusy, key)
		episodeTaskMu.Unlock()
	}, true
}
