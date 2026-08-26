package middleware

import (
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMain(m *testing.M) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		panic("failed to open test db: " + err.Error())
	}
	sqlDB, err := db.DB()
	if err != nil {
		panic("failed to get sql.DB: " + err.Error())
	}
	sqlDB.SetMaxOpenConns(1)

	model.DB = db
	model.LOG_DB = db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.BatchUpdateEnabled = false

	if err := db.AutoMigrate(&model.Asset{}); err != nil {
		panic("failed to migrate test db: " + err.Error())
	}
	os.Exit(m.Run())
}

func TestExtractAssetIDs(t *testing.T) {
	tests := []struct {
		name string
		body string
		want []string
	}{
		{"no refs", `{"model":"seedance-1-0"}`, nil},
		{"single ref", `{"content":[{"image_url":{"url":"asset://asset-20260716111338-vwmxj"}}]}`, []string{"asset-20260716111338-vwmxj"}},
		{"dedup and order", `asset://a-1 text asset://a-2 asset://a-1 asset://b_3`, []string{"a-1", "a-2", "b_3"}},
		{"empty", ``, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, ExtractAssetIDs([]byte(tt.body)))
		})
	}
}

func seedAsset(t *testing.T, userId, channelId int, assetID string) {
	t.Helper()
	require.NoError(t, (&model.Asset{
		UserID:    userId,
		ChannelID: channelId,
		AssetID:   assetID,
		AssetType: model.AssetTypeImage,
		Status:    model.AssetStatusActive,
	}).Insert())
}

func TestValidateUserAssetRefs(t *testing.T) {
	seedAsset(t, 1, 5, "asset-user1-ch5-a")
	seedAsset(t, 1, 5, "asset-user1-ch5-b")
	seedAsset(t, 1, 7, "asset-user1-ch7")
	seedAsset(t, 2, 5, "asset-user2-ch5")

	tests := []struct {
		name      string
		userId    int
		ids       []string
		want      int
		wantKind  AssetLockErrorKind
		wantNoErr bool
	}{
		{"empty", 1, nil, 0, "", true},
		{"single own asset", 1, []string{"asset-user1-ch5-a"}, 5, "", true},
		{"same channel", 1, []string{"asset-user1-ch5-a", "asset-user1-ch5-b"}, 5, "", true},
		{"not registered", 1, []string{"asset-missing"}, 0, AssetLockNotFound, false},
		{"other user asset", 1, []string{"asset-user2-ch5"}, 0, AssetLockNotFound, false},
		{"cross channel conflict", 1, []string{"asset-user1-ch5-a", "asset-user1-ch7"}, 0, AssetLockChannelConflict, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			channelId, err := ValidateUserAssetRefs(tt.userId, tt.ids)
			if tt.wantNoErr {
				require.NoError(t, err)
				assert.Equal(t, tt.want, channelId)
				return
			}
			require.Error(t, err)
			lockErr, ok := err.(*AssetLockError)
			require.True(t, ok, "expected *AssetLockError, got %T", err)
			assert.Equal(t, tt.wantKind, lockErr.Kind)
		})
	}
}

func TestIsVideoSubmitPath(t *testing.T) {
	assert.True(t, isVideoSubmitPath("/pg/video/generations"))
	assert.True(t, isVideoSubmitPath("/v1/video/generations"))
	assert.True(t, isVideoSubmitPath("/api/v3/contents/generations/tasks"))
	// 前缀匹配：GET 查询路径同前缀，但 Distribute 中 shouldSelectChannel=false 不会进入锁定逻辑
	assert.True(t, isVideoSubmitPath("/v1/video/generations/task-123"))
	assert.False(t, isVideoSubmitPath("/pg/chat/completions"))
	assert.False(t, isVideoSubmitPath("/v1/chat/completions"))
}
