package model

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// TestConversationSaveRollback protects atomic history/revision writes when a
// message insert fails after the conversation metadata was conditionally updated.
func TestConversationSaveRollback(t *testing.T) {
	original := DB
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "rollback.db")), &gorm.Config{})
	require.NoError(t, err)
	connection, err := db.DB()
	require.NoError(t, err)
	DB = db
	t.Cleanup(func() { DB = original; require.NoError(t, connection.Close()) })
	require.NoError(t, db.AutoMigrate(&ConversationInfo{}, &ConversationMessageDetail{}))
	require.NoError(t, db.AutoMigrate(&ConversationInfo{}, &ConversationMessageDetail{}))
	raw, err := common.Marshal(struct {
		Key     string `json:"key"`
		From    string `json:"from"`
		Content string `json:"content"`
	}{Key: "m1", From: "user", Content: strings.Repeat("long structured message ", 5000)})
	require.NoError(t, err)
	change := &ConversationChange{MutationID: "first", Title: "original", Messages: []ConversationMessageInput{{ID: "m1", Payload: raw}}}
	saved, err := SaveConversation(1, "rollback-conversation", change)
	require.NoError(t, err)
	assert.EqualValues(t, 1, saved.Revision)
	page, err := ReadConversationMessages(1, saved.ID, 0, 1, 50)
	require.NoError(t, err)
	require.Len(t, page.Items, 1)
	assert.JSONEq(t, string(raw), string(page.Items[0].Payload))
	failure := errors.New("isolated message storage failure")
	require.NoError(t, db.Callback().Create().Before("gorm:create").Register("history_test_failure", func(tx *gorm.DB) {
		if tx.Statement.Table == "conversation_message_detail" {
			tx.AddError(failure)
		}
	}))
	defer func() { require.NoError(t, db.Callback().Create().Remove("history_test_failure")) }()
	_, err = SaveConversation(1, saved.ID, &ConversationChange{Revision: 1, MutationID: "second", Title: "must rollback", Messages: []ConversationMessageInput{{ID: "m2", Payload: []byte(`{"key":"m2","from":"user"}`)}}})
	require.ErrorIs(t, err, failure)
	var persisted ConversationInfo
	require.NoError(t, db.First(&persisted, "id = ?", saved.ID).Error)
	assert.EqualValues(t, 1, persisted.Revision)
	assert.Equal(t, "original", persisted.Title)
	page, err = ReadConversationMessages(1, saved.ID, 0, 1, 50)
	require.NoError(t, err)
	assert.Len(t, page.Items, 1)
}
