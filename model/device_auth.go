package model

import (
	"errors"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	DevicePending  = "pending"
	DeviceApproved = "approved"
	DeviceDenied   = "denied"
	DeviceConsumed = "consumed"
	DeviceRevoked  = "revoked"
)

var ErrDeviceGrantInvalid = errors.New("invalid device authorization")

// DeviceGrantInfo keeps device consent and hashed credentials independently of user.access_token.
// IDs follow this repository's GORM-managed primary keys; credentials are never stored in plaintext.
type DeviceGrantInfo struct {
	ID             int64     `json:"id" gorm:"primaryKey"`
	DeviceDigest   string    `json:"-" gorm:"type:char(64);not null;uniqueIndex:uk_device_grant_info_device_digest"`
	UserCodeDigest string    `json:"-" gorm:"type:char(64);not null;uniqueIndex:uk_device_grant_info_user_code_digest"`
	AccessDigest   *string   `json:"-" gorm:"type:char(64);uniqueIndex:uk_device_grant_info_access_digest"`
	UserID         int       `json:"user_id" gorm:"index:idx_device_grant_info_user_id"`
	ClientID       string    `json:"client_id" gorm:"type:varchar(64);not null"`
	DeviceName     string    `json:"device_name" gorm:"type:varchar(100)"`
	Scope          string    `json:"scope" gorm:"type:varchar(100);not null"`
	Status         string    `json:"status" gorm:"type:varchar(16);not null"`
	CodeExpiresAt  int64     `json:"-" gorm:"not null;index:idx_device_grant_info_code_expires_at"`
	ExpiresAt      int64     `json:"expires_at"`
	PollAfter      int64     `json:"-"`
	PollInterval   int64     `json:"-"`
	KeyCount       int64     `json:"-"`
	CreateTime     time.Time `json:"create_time" gorm:"autoCreateTime"`
	UpdateTime     time.Time `json:"update_time" gorm:"autoUpdateTime"`
	CreateBy       string    `json:"-" gorm:"type:varchar(64)"`
	UpdateBy       string    `json:"-" gorm:"type:varchar(64)"`
	Deleted        int       `json:"-" gorm:"not null;default:0"`
}

// TableName keeps the documented business-table suffix independent of GORM pluralization.
func (DeviceGrantInfo) TableName() string { return "device_grant_info" }

// DeviceGrantFlow audits consent, exchange, and revocation in the same transaction as the grant.
type DeviceGrantFlow struct {
	ID            int64 `gorm:"primaryKey"`
	DeviceGrantID int64 `gorm:"not null;index:idx_device_grant_flow_device_grant_id"`
	UserID        int
	Status        string    `gorm:"type:varchar(16);not null"`
	CreateTime    time.Time `gorm:"autoCreateTime"`
	UpdateTime    time.Time `gorm:"autoUpdateTime"`
	CreateBy      string    `gorm:"type:varchar(64)"`
	UpdateBy      string    `gorm:"type:varchar(64)"`
	Deleted       int       `gorm:"not null;default:0"`
}

// TableName preserves the audit-flow table suffix.
func (DeviceGrantFlow) TableName() string { return "device_grant_flow" }

// recordDeviceGrantStatus writes the durable transition alongside the main record.
func recordDeviceGrantStatus(tx *gorm.DB, grant *DeviceGrantInfo) error {
	actor := strconv.Itoa(grant.UserID)
	return tx.Create(&DeviceGrantFlow{DeviceGrantID: grant.ID, UserID: grant.UserID,
		Status: grant.Status, CreateBy: actor, UpdateBy: actor}).Error
}

// CreateDeviceGrant stores the pending request and its initial audit event atomically.
func CreateDeviceGrant(grant *DeviceGrantInfo) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(grant).Error; err != nil {
			return err
		}
		return recordDeviceGrantStatus(tx, grant)
	})
}

// GetPendingDeviceGrant resolves only live pending user codes; the browser never receives device_code.
func GetPendingDeviceGrant(digest string, now int64) (*DeviceGrantInfo, error) {
	var grant DeviceGrantInfo
	err := DB.Where("user_code_digest = ? AND status = ? AND code_expires_at > ? AND deleted = 0", digest, DevicePending, now).First(&grant).Error
	return &grant, err
}

// DecideDeviceGrant allows exactly one consent decision by an enabled browser-session user.
func DecideDeviceGrant(digest string, userID int, approve bool, now int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		// Obtain a write lock before reading, including SQLite where SELECT FOR UPDATE is unavailable.
		if err := tx.Model(&DeviceGrantInfo{}).Where("user_code_digest = ?", digest).
			UpdateColumn("status", gorm.Expr("status")).Error; err != nil {
			return err
		}
		if _, err := activeDesktopUser(tx, userID); err != nil {
			return err
		}
		var grant DeviceGrantInfo
		if err := tx.Where("user_code_digest = ? AND status = ? AND code_expires_at > ? AND deleted = 0", digest, DevicePending, now).First(&grant).Error; err != nil {
			return err
		}
		status := DeviceDenied
		if approve {
			status = DeviceApproved
		}
		result := tx.Model(&grant).Where("status = ? AND code_expires_at > ?", DevicePending, now).
			Updates(map[string]any{"status": status, "user_id": userID, "update_by": strconv.Itoa(userID)})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrDeviceGrantInvalid
		}
		grant.Status, grant.UserID = status, userID
		return recordDeviceGrantStatus(tx, &grant)
	})
}

// PollDeviceGrant serializes each polling window using a conditional UPDATE, including SQLite.
// Protocol errors are returned separately so pending/slow_down updates still commit.
func PollDeviceGrant(digest, clientID, accessDigest string, now, ttl int64) (*DeviceGrantInfo, string, error) {
	var grant DeviceGrantInfo
	protocolError := ""
	err := DB.Transaction(func(tx *gorm.DB) error {
		// 步骤1：匹配可信客户端与设备码摘要，拒绝过期或已终结的授权。
		// A write-first transaction prevents SQLite snapshot-upgrade failures during concurrent polling.
		if err := tx.Model(&DeviceGrantInfo{}).Where("device_digest = ? AND client_id = ?", digest, clientID).
			UpdateColumn("poll_after", gorm.Expr("poll_after")).Error; err != nil {
			return err
		}
		err := tx.Where("device_digest = ? AND client_id = ? AND deleted = 0", digest, clientID).First(&grant).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			protocolError = "invalid_grant"
			return nil
		}
		if err != nil {
			return err
		}
		if grant.CodeExpiresAt <= now {
			protocolError = "expired_token"
			return nil
		}
		switch grant.Status {
		case DevicePending, DeviceApproved:
			// Only these states may continue polling or issue an access credential.
		case DeviceDenied:
			protocolError = "access_denied"
			return nil
		default:
			protocolError = "invalid_grant"
			return nil
		}
		interval := grant.PollInterval
		// 步骤2：原子推进轮询窗口；过快请求会持久化增加后续等待时间。
		if now < grant.PollAfter {
			interval += 5
			protocolError = "slow_down"
		}
		updates := map[string]any{"poll_after": now + interval, "poll_interval": interval}
		if protocolError == "" && grant.Status == DeviceApproved {
			updates["status"], updates["access_digest"], updates["expires_at"] = DeviceConsumed, accessDigest, now+ttl
		}
		result := tx.Model(&grant).Where("status = ? AND poll_after = ? AND poll_interval = ?", grant.Status, grant.PollAfter, grant.PollInterval).Updates(updates)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			protocolError = "slow_down"
			return nil
		}
		if protocolError != "" {
			return nil
		}
		if grant.Status == DevicePending {
			protocolError = "authorization_pending"
			return nil
		}
		if _, err := activeDesktopUser(tx, grant.UserID); err != nil {
			if errors.Is(err, ErrDesktopCredentialInvalid) {
				return ErrDeviceGrantInvalid
			}
			return err
		}
		// 步骤3：凭证摘要与兑换审计同事务落库，防止重复兑换。
		grant.Status, grant.ExpiresAt = DeviceConsumed, now+ttl
		return recordDeviceGrantStatus(tx, &grant)
	})
	if errors.Is(err, ErrDeviceGrantInvalid) {
		return nil, "access_denied", nil
	}
	return &grant, protocolError, err
}

// GetDeviceAccessGrant validates expiry/revocation against the primary DB on every management request.
func GetDeviceAccessGrant(digest string, now int64) (*DeviceGrantInfo, *User, error) {
	var grant DeviceGrantInfo
	err := DB.Where("access_digest = ? AND status = ? AND expires_at > ? AND deleted = 0", digest, DeviceConsumed, now).First(&grant).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, ErrDeviceGrantInvalid
	}
	if err != nil {
		return nil, nil, err
	}
	user, err := activeDesktopUser(DB, grant.UserID)
	if errors.Is(err, ErrDesktopCredentialInvalid) {
		err = ErrDeviceGrantInvalid
	}
	return &grant, user, err
}

// IsDeviceGrantActive bypasses token caches so revoked device keys cannot survive a Redis TTL.
func IsDeviceGrantActive(id int64) error {
	var count int64
	err := DB.Model(&DeviceGrantInfo{}).Where("id = ? AND status = ? AND expires_at > ? AND deleted = 0", id, DeviceConsumed, GetDBTimestamp()).Count(&count).Error
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrDeviceGrantInvalid
	}
	return nil
}

// ListDeviceGrants returns a user's authorization history without credential material.
func ListDeviceGrants(userID, offset, limit int) ([]DeviceGrantInfo, int64, error) {
	grants := make([]DeviceGrantInfo, 0)
	query := DB.Model(&DeviceGrantInfo{}).Where("user_id = ? AND status IN ? AND deleted = 0", userID, []string{DeviceConsumed, DeviceRevoked})
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("id desc").Offset(offset).Limit(limit).Find(&grants).Error
	return grants, total, err
}

// RevokeDeviceGrant atomically revokes consent and disables every key created by that device.
func RevokeDeviceGrant(id int64, userID int) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		// 步骤1：按当前用户匹配授权，条件更新与并发创建密钥互斥。
		if err := tx.Model(&DeviceGrantInfo{}).Where("id = ? AND user_id = ?", id, userID).
			UpdateColumn("status", gorm.Expr("status")).Error; err != nil {
			return err
		}
		var grant DeviceGrantInfo
		if err := tx.Where("id = ? AND user_id = ? AND deleted = 0", id, userID).First(&grant).Error; err != nil {
			return err
		}
		if grant.Status == DeviceRevoked {
			return nil
		}
		result := tx.Model(&grant).Where("status = ?", DeviceConsumed).Updates(map[string]any{"status": DeviceRevoked, "update_by": strconv.Itoa(userID)})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrDeviceGrantInvalid
		}
		// 步骤2：停用设备密钥并追加审计；中继另查授权真源，避免缓存延迟。
		if err := tx.Model(&Token{}).Where("device_grant_id = ? AND user_id = ?", id, userID).Update("status", common.TokenStatusDisabled).Error; err != nil {
			return err
		}
		grant.Status = DeviceRevoked
		return recordDeviceGrantStatus(tx, &grant)
	})
}

// InsertDeviceToken serializes creation with revocation; user input cannot assign a grant or source.
func InsertDeviceToken(token *Token, grant *DeviceGrantInfo) error {
	// Read DB time before opening the write-first transaction, avoiding SQLite snapshot upgrades.
	now := GetDBTimestamp()
	return DB.Transaction(func(tx *gorm.DB) error {
		// UPDATE takes a write lock on SQLite too; a racing revoke either wins first or disables this key.
		result := tx.Model(&DeviceGrantInfo{}).Where("id = ? AND user_id = ? AND status = ? AND expires_at > ? AND deleted = 0", grant.ID, token.UserId, DeviceConsumed, now).Update("key_count", gorm.Expr("key_count + 1"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrDeviceGrantInvalid
		}
		token.DeviceGrantID, token.Source = grant.ID, grant.ClientID
		return tx.Create(token).Error
	})
}

// GetDeviceTokens scopes management to keys with a trusted grant for this user/client.
func GetDeviceTokens(userID int, clientID, source string, offset, limit int) ([]*Token, int64, error) {
	grants := DB.Model(&DeviceGrantInfo{}).Select("id").Where("user_id = ? AND client_id = ?", userID, clientID)
	query := DB.Model(&Token{}).Where("user_id = ? AND device_grant_id IN (?)", userID, grants)
	if source != "" {
		query = query.Where("source = ?", source)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	tokens := make([]*Token, 0)
	err := query.Order("id desc").Offset(offset).Limit(limit).Find(&tokens).Error
	return tokens, total, err
}

// GetDeviceToken prevents administrator accounts from broadening a device credential's ownership scope.
func GetDeviceToken(id, userID int, clientID string) (*Token, error) {
	var token Token
	grants := DB.Model(&DeviceGrantInfo{}).Select("id").Where("user_id = ? AND client_id = ?", userID, clientID)
	err := DB.Where("id = ? AND user_id = ? AND device_grant_id IN (?)", id, userID, grants).First(&token).Error
	return &token, err
}
