package dto

import (
	"encoding/json"

	"github.com/QuantumNous/new-api/types"
)

type TaskError struct {
	Code       string `json:"code"`
	Message    string `json:"message"`
	Data       any    `json:"data"`
	StatusCode int    `json:"-"`
	LocalError bool   `json:"-"`
	Error      error  `json:"-"`
	// APIError 保留本地生成的类型化错误（预扣费失败等），让控制器仍能读到真实的
	// error_code 与 SkipRetry / NoRecordErrorLog 选项。为空表示错误来自上游响应，
	// 控制器按 bad_response_status_code 归一化后再判重试与落错误日志。
	APIError *types.NewAPIError `json:"-"`
}

type TaskData interface {
	SunoDataResponse | []SunoDataResponse | string | any
}

const TaskSuccessCode = "success"

type TaskResponse[T TaskData] struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Data    T      `json:"data"`
}

func (t *TaskResponse[T]) IsSuccess() bool {
	return t.Code == TaskSuccessCode
}

type TaskDto struct {
	ID         int64           `json:"id"`
	CreatedAt  int64           `json:"created_at"`
	UpdatedAt  int64           `json:"updated_at"`
	TaskID     string          `json:"task_id"`
	Platform   string          `json:"platform"`
	UserId     int             `json:"user_id"`
	Group      string          `json:"group"`
	ChannelId  int             `json:"channel_id"`
	Quota      int             `json:"quota"`
	Action     string          `json:"action"`
	Status     string          `json:"status"`
	FailReason string          `json:"fail_reason"`
	ResultURL  string          `json:"result_url,omitempty"` // 任务结果 URL（视频地址等）
	SubmitTime int64           `json:"submit_time"`
	StartTime  int64           `json:"start_time"`
	FinishTime int64           `json:"finish_time"`
	Progress   string          `json:"progress"`
	Properties any             `json:"properties"`
	Username   string          `json:"username,omitempty"`
	Data       json.RawMessage `json:"data"`
	// RequestData 用户提交任务时的请求体快照（base64 已截断），见 model.Task.RequestData。
	RequestData json.RawMessage `json:"request_data,omitempty"`
}

// PublicTaskDto 是公开任务查询与外部任务日志的字段白名单。TaskDto 供管理后台
// 使用，含用户/渠道/计费和内部上游地址，绝不能直接返回给 API 调用方。
// UserId/Username 仅由代理商成员列表填充，普通用户与 API 查询始终省略。
type PublicTaskDto struct {
	CreatedAt  int64                `json:"created_at"`
	UpdatedAt  int64                `json:"updated_at"`
	TaskID     string               `json:"task_id"`
	UserId     int                  `json:"user_id,omitempty"`
	Username   string               `json:"username,omitempty"`
	Action     string               `json:"action"`
	Status     string               `json:"status"`
	FailReason string               `json:"fail_reason"`
	ResultURL  string               `json:"result_url,omitempty"`
	SubmitTime int64                `json:"submit_time"`
	StartTime  int64                `json:"start_time"`
	FinishTime int64                `json:"finish_time"`
	Progress   string               `json:"progress"`
	Properties PublicTaskProperties `json:"properties"`
	Data       json.RawMessage      `json:"data,omitempty"`
}

// PublicTaskProperties 只保留公开模型名；内部 Properties 还可能含 request_url、
// 上游任务参数等，不应整个透传。
type PublicTaskProperties struct {
	OriginModelName string `json:"origin_model_name,omitempty"`
}

type FetchReq struct {
	IDs []string `json:"ids"`
}
