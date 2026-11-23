package dto

// DesktopUsageLog exposes stored fields and Web-compatible consumption display values.
// It deliberately excludes raw content/other, identity, upstream and channel data.
type DesktopUsageLog struct {
	ID                 int                     `json:"id" gorm:"column:id"`
	CreatedAt          int64                   `json:"created_at"`
	ModelName          string                  `json:"model_name"`
	Type               int                     `json:"type"`
	PromptTokens       int                     `json:"prompt_tokens"`
	CompletionTokens   int                     `json:"completion_tokens"`
	Quota              int                     `json:"quota"`
	SubscriptionQuota  int                     `json:"subscription_quota"`
	TokenName          string                  `json:"token_name"`
	RequestID          string                  `json:"request_id" gorm:"column:request_id"`
	HTTPStatus         int                     `json:"http_status" gorm:"column:http_status"`
	UseTime            int                     `json:"use_time"`
	IsStream           bool                    `json:"is_stream"`
	CacheHit           bool                    `json:"cache_hit"`
	TaskSettle         bool                    `json:"task_settle"`
	Other              string                  `json:"-" gorm:"column:other"`
	UserInput          *string                 `json:"user_input" gorm:"-"`
	UserInputTruncated bool                    `json:"user_input_truncated" gorm:"-"`
	Consumption        DesktopUsageConsumption `json:"consumption" gorm:"-"`
}

// DesktopUsageLogQuery carries bounded filters; owner identity is supplied separately
// from authentication and can never be populated from client query parameters.
type DesktopUsageLogQuery struct {
	Offset         int
	Limit          int
	StartTimestamp int64
	EndTimestamp   int64
	ModelName      string
}

// DesktopUsageConsumption separates wallet currency from subscription points.
// Values follow current Web display settings; original quota fields stay raw.
type DesktopUsageConsumption struct {
	WalletAmount       float64 `json:"wallet_amount"`
	WalletUnit         string  `json:"wallet_unit"`
	WalletSymbol       string  `json:"wallet_symbol"`
	SubscriptionPoints float64 `json:"subscription_points"`
	SubscriptionUnit   string  `json:"subscription_unit"`
}
