package dto

type PlayGroundRequest struct {
	Model string `json:"model,omitempty"`
	Group string `json:"group,omitempty"`
	// ChannelId 用户在体验页显式指定的渠道（0=自动，走优先级选路）；仅视频提交 C 端路径生效。
	ChannelId int `json:"channel_id,omitempty"`
}
