package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrConversationConflict = errors.New("conversation changed; reload before saving")
var ErrConversationInput = errors.New("invalid conversation data")

// ConversationInfo isolates history from authentication, relay and billing state.
// ID is a client UUID, scoped by the authenticated owner on every operation.
type ConversationInfo struct {
	ID           string    `json:"id" gorm:"type:varchar(64);primaryKey;index:idx_conversation_owner_time,priority:3"`
	UserID       int       `json:"-" gorm:"not null;index:idx_conversation_owner_time,priority:1"`
	Title        string    `json:"title" gorm:"type:varchar(200);not null"`
	Revision     int64     `json:"revision" gorm:"not null"`
	NextSequence int64     `json:"-"`
	LastMutation string    `json:"-" gorm:"type:varchar(64)"`
	LastDigest   string    `json:"-" gorm:"type:varchar(64)"`
	CreateTime   time.Time `json:"create_time"`
	UpdateTime   time.Time `json:"update_time" gorm:"index:idx_conversation_owner_time,priority:2"`
}

// ConversationMessageDetail keeps the original structured client message as TEXT
// across SQLite, MySQL and PostgreSQL; sequence is allocated under a revision CAS.
type ConversationMessageDetail struct {
	ConversationID string    `json:"-" gorm:"type:varchar(64);primaryKey;uniqueIndex:uk_conversation_message_sequence,priority:1"`
	MessageID      string    `json:"id" gorm:"type:varchar(64);primaryKey"`
	Sequence       int64     `json:"sequence" gorm:"not null;uniqueIndex:uk_conversation_message_sequence,priority:2"`
	Payload        string    `json:"-" gorm:"size:1048576;not null"`
	CreateTime     time.Time `json:"create_time"`
}

// TableName preserves the explicit business table name across GORM naming modes.
func (ConversationInfo) TableName() string { return "conversation_info" }

// TableName preserves the explicit business table name across GORM naming modes.
func (ConversationMessageDetail) TableName() string { return "conversation_message_detail" }

// ConversationMessageInput contains an opaque structured message, not a relay request.
type ConversationMessageInput struct {
	ID      string          `json:"id"`
	Payload json.RawMessage `json:"payload"`
}

// ConversationChange is a bounded, idempotent patch against one known revision.
type ConversationChange struct {
	Revision   int64                      `json:"revision"`
	MutationID string                     `json:"mutation_id"`
	Title      string                     `json:"title"`
	Messages   []ConversationMessageInput `json:"messages"`
	DeletedIDs []string                   `json:"deleted_ids"`
}

// ConversationMessageView returns the original JSON without converting it to text.
type ConversationMessageView struct {
	ID       string          `json:"id"`
	Sequence int64           `json:"sequence"`
	Payload  json.RawMessage `json:"payload"`
}

// ConversationMessagePage is a consistent page read at a specific revision.
type ConversationMessagePage struct {
	Revision int64                     `json:"revision"`
	Items    []ConversationMessageView `json:"items"`
	HasMore  bool                      `json:"has_more"`
}

// ListConversations reads only the owner's metadata, with bounded pagination.
func ListConversations(userID, offset, limit int) ([]ConversationInfo, error) {
	items := make([]ConversationInfo, 0)
	err := DB.Where("user_id = ?", userID).Order("update_time DESC, id DESC").Offset(offset).Limit(limit).Find(&items).Error
	return items, err
}

// ReadConversationMessages checks ownership and uses a revision guard so pages
// from simultaneous writers cannot be silently combined into a corrupt history.
func ReadConversationMessages(userID int, id string, before, revision int64, limit int) (*ConversationMessagePage, error) {
	var page ConversationMessagePage
	err := DB.Transaction(func(tx *gorm.DB) error {
		var conversation ConversationInfo
		if err := tx.Where("id = ? AND user_id = ?", id, userID).First(&conversation).Error; err != nil {
			return err
		}
		if revision >= 0 && revision != conversation.Revision {
			return ErrConversationConflict
		}
		query := tx.Where("conversation_id = ?", id)
		if before > 0 {
			query = query.Where("sequence < ?", before)
		}
		var rows []ConversationMessageDetail
		if err := query.Order("sequence DESC").Limit(limit + 1).Find(&rows).Error; err != nil {
			return err
		}
		page.Revision, page.HasMore = conversation.Revision, len(rows) > limit
		if len(rows) > limit {
			rows = rows[:limit]
		}
		page.Items = make([]ConversationMessageView, 0, len(rows))
		for i := len(rows) - 1; i >= 0; i-- {
			row := rows[i]
			page.Items = append(page.Items, ConversationMessageView{ID: row.MessageID, Sequence: row.Sequence, Payload: json.RawMessage(row.Payload)})
		}
		// A fresh read catches a concurrent commit under READ COMMITTED as well.
		var current ConversationInfo
		if err := tx.Where("id = ? AND user_id = ?", id, userID).First(&current).Error; err != nil {
			return err
		}
		if current.Revision != page.Revision {
			return ErrConversationConflict
		}
		return nil
	})
	return &page, err
}

// SaveConversation applies only changed messages. CAS serializes writers on all
// supported databases; stale clients must reload rather than overwrite history.
func SaveConversation(userID int, id string, change *ConversationChange) (*ConversationInfo, error) {
	if userID <= 0 || !validConversationID(id) || !validConversationID(change.MutationID) || change.Revision < 0 || len([]rune(change.Title)) > 200 || len(change.Messages) > 100 || len(change.DeletedIDs) > 100 {
		return nil, ErrConversationInput
	}
	seen := make(map[string]bool)
	for _, message := range change.Messages {
		if !validConversationID(message.ID) || seen[message.ID] || len(message.Payload) > 1024*1024 {
			return nil, ErrConversationInput
		}
		var object struct {
			Key  string `json:"key"`
			From string `json:"from"`
		}
		if common.Unmarshal(message.Payload, &object) != nil || object.Key != message.ID || (object.From != "user" && object.From != "assistant" && object.From != "system" && object.From != "tool") {
			return nil, ErrConversationInput
		}
		seen[message.ID] = true
	}
	for _, id := range change.DeletedIDs {
		if !validConversationID(id) || seen[id] {
			return nil, ErrConversationInput
		}
		seen[id] = true
	}
	encoded, err := common.Marshal(change)
	if err != nil {
		return nil, err
	}
	digestBytes := sha256.Sum256(encoded)
	digest := hex.EncodeToString(digestBytes[:])
	var conversation ConversationInfo
	err = DB.Transaction(func(tx *gorm.DB) error {
		// Step 1: an absent UUID may be created only at revision zero. OnConflict
		// never transfers ownership of an existing conversation to another account.
		if change.Revision == 0 {
			now := time.Now().UTC()
			created := ConversationInfo{ID: id, UserID: userID, Title: change.Title, CreateTime: now, UpdateTime: now}
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&created).Error; err != nil {
				return err
			}
		}
		if err := tx.Where("id = ? AND user_id = ?", id, userID).First(&conversation).Error; err != nil {
			return err
		}
		if conversation.LastMutation == change.MutationID {
			if conversation.LastDigest != digest {
				return ErrConversationConflict
			}
			return nil
		}
		// Step 2: acquire a write lock by conditional UPDATE, portable to SQLite.
		updated := tx.Model(&ConversationInfo{}).Where("id = ? AND user_id = ? AND revision = ?", id, userID, change.Revision).Updates(map[string]interface{}{"revision": change.Revision + 1, "title": change.Title, "update_time": time.Now().UTC(), "last_mutation": change.MutationID, "last_digest": digest})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrConversationConflict
		}
		// Step 3: keep existing sequence numbers and allocate new ones atomically.
		for _, message := range change.Messages {
			var row ConversationMessageDetail
			err := tx.Where("conversation_id = ? AND message_id = ?", id, message.ID).First(&row).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				conversation.NextSequence++
				row = ConversationMessageDetail{ConversationID: id, MessageID: message.ID, Sequence: conversation.NextSequence, Payload: string(message.Payload), CreateTime: time.Now().UTC()}
				if err := tx.Create(&row).Error; err != nil {
					return err
				}
			} else if err != nil {
				return err
			} else {
				if err := tx.Model(&row).Update("payload", string(message.Payload)).Error; err != nil {
					return err
				}
			}
		}
		if len(change.DeletedIDs) > 0 {
			if err := tx.Where("conversation_id = ? AND message_id IN ?", id, change.DeletedIDs).Delete(&ConversationMessageDetail{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&ConversationInfo{}).Where("id = ? AND user_id = ?", id, userID).Update("next_sequence", conversation.NextSequence).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ?", id, userID).First(&conversation).Error
	})
	return &conversation, err
}

// validConversationID restricts keys to portable, bounded ASCII identifiers.
func validConversationID(id string) bool {
	if len(id) < 1 || len(id) > 64 {
		return false
	}
	for _, r := range id {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}
