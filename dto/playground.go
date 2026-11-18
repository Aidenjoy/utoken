package dto

type PlayGroundRequest struct {
	Model string `json:"model,omitempty"`
	Group string `json:"group,omitempty"`
	// ChannelId 超级管理员在体验页显式指定的渠道（0=自动，走优先级选路）；
	// 对话/视频/图片三条生成路径生效，普通用户该字段被 distributor 忽略。
	ChannelId int `json:"channel_id,omitempty"`
}
