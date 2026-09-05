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

// 分集级 AI 任务互斥锁：改写/提取/拆解是长耗时任务，模型排队时可能超过代理超时被掐断，
// 前端误以为失败重复点击会导致双重执行（浪费额度、数据互相覆盖），这里按 task+分集 拒绝重入。
// busy 同时充当异步任务的 running 状态，lastErr 记录最近一次执行失败的错误信息，供前端轮询展示。
var (
	episodeTaskMu      sync.Mutex
	episodeTaskBusy    = make(map[string]struct{})
	episodeTaskLastErr = make(map[string]string)
)

// tryAcquireEpisodeTask 尝试占用分集任务锁，成功返回完成回调；已在执行中返回 false。
// 完成回调传入任务失败错误（成功传 nil），用于记录/清除最近一次错误并释放锁。
func tryAcquireEpisodeTask(task string, episodeID int) (func(error), bool) {
	key := fmt.Sprintf("%s:%d", task, episodeID)
	episodeTaskMu.Lock()
	defer episodeTaskMu.Unlock()
	if _, ok := episodeTaskBusy[key]; ok {
		return nil, false
	}
	episodeTaskBusy[key] = struct{}{}
	delete(episodeTaskLastErr, key) // 重新开始执行：清除上次失败记录
	return func(finishErr error) {
		episodeTaskMu.Lock()
		delete(episodeTaskBusy, key)
		if finishErr != nil {
			episodeTaskLastErr[key] = finishErr.Error()
		} else {
			delete(episodeTaskLastErr, key)
		}
		episodeTaskMu.Unlock()
	}, true
}

// EpisodeTaskStatus 查询分集任务执行状态（running 是否执行中，lastErr 最近一次失败原因），供流水线进度接口透出
func EpisodeTaskStatus(task string, episodeID int) (running bool, lastErr string) {
	key := fmt.Sprintf("%s:%d", task, episodeID)
	episodeTaskMu.Lock()
	defer episodeTaskMu.Unlock()
	_, running = episodeTaskBusy[key]
	return running, episodeTaskLastErr[key]
}
