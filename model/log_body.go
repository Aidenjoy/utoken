package model

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// LogBody 使用日志（同步中继：语言/生图等）的请求/返回体快照，按 request_id 与 logs 行
// 唯一关联。独立成表是为了不把大 JSON 放进最高频的 logs 表：列表查询仍只扫 logs，
// 详情弹窗才按 request_id 拉取本表。
//
// RequestData/ResponseData 刻意不加 gorm type 标签：string 默认映射为
// MySQL longtext / PostgreSQL text / SQLite text，跨库都是大文本，配合应用层
// 截断（见 controller 侧 maxRelayBodySnapshotBytes）杜绝字段溢出报错。
type LogBody struct {
	Id           int64  `json:"id" gorm:"primary_key;AUTO_INCREMENT"`
	RequestId    string `json:"request_id" gorm:"type:varchar(64);uniqueIndex"`
	RequestData  string `json:"request_data"`
	ResponseData string `json:"response_data"`
	CreatedAt    int64  `json:"created_at"`
}

// SaveLogBody 落库一条请求/返回体快照。requestId 为空或两体皆空则跳过；
// request_id 唯一索引 + OnConflict DoNothing 天然幂等防重（重试产生的多次写入
// 只会保留第一条，且不报错），跨库分别落到 ON CONFLICT DO NOTHING / INSERT IGNORE。
func SaveLogBody(requestId string, request []byte, response []byte) error {
	if requestId == "" || (len(request) == 0 && len(response) == 0) {
		return nil
	}
	body := &LogBody{
		RequestId:    requestId,
		RequestData:  string(request),
		ResponseData: string(response),
		CreatedAt:    time.Now().Unix(),
	}
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(body).Error
}

// GetLogBodyByRequestId 按 request_id 查询快照；不存在时返回 (nil, false, nil)。
func GetLogBodyByRequestId(requestId string) (*LogBody, bool, error) {
	if requestId == "" {
		return nil, false, nil
	}
	var body LogBody
	err := DB.Where("request_id = ?", requestId).First(&body).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, nil
		}
		return nil, false, err
	}
	return &body, true, nil
}
