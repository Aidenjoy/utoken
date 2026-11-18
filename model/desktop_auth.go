package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var ErrDesktopCredentialInvalid = errors.New("invalid desktop credential")

// DesktopAuthCode stores only a digest of the short-lived browser authorization code.
type DesktopAuthCode struct {
	Digest      string `gorm:"type:char(64);primaryKey"`
	UserID      int    `gorm:"not null"`
	ClientID    string `gorm:"type:varchar(64);not null"`
	RedirectURI string `gorm:"type:varchar(128);not null"`
	Challenge   string `gorm:"type:varchar(43);not null"`
	ExpiresAt   int64  `gorm:"not null;index"`
}

// DesktopAuthSession is separate from dashboard management tokens and relay API keys.
type DesktopAuthSession struct {
	Digest    string `gorm:"type:char(64);primaryKey"`
	UserID    int    `gorm:"not null"`
	ExpiresAt int64  `gorm:"not null;index"`
}

func CreateDesktopAuthCode(code *DesktopAuthCode, now int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("expires_at <= ?", now).Delete(&DesktopAuthCode{}).Error; err != nil {
			return err
		}
		if err := tx.Where("expires_at <= ?", now).Delete(&DesktopAuthSession{}).Error; err != nil {
			return err
		}
		return tx.Create(code).Error
	})
}

func ExchangeDesktopAuthCode(digest, clientID, redirectURI, challenge string, now int64, session *DesktopAuthSession) (*User, error) {
	match := DB.Where("digest = ? AND client_id = ? AND redirect_uri = ? AND challenge = ? AND expires_at > ?",
		digest, clientID, redirectURI, challenge, now)
	var code DesktopAuthCode
	if err := match.First(&code).Error; err != nil {
		return nil, desktopCredentialError(err)
	}

	var user *User
	err := DB.Transaction(func(tx *gorm.DB) error {
		deleted := tx.Where("digest = ? AND expires_at > ?", digest, now).Delete(&DesktopAuthCode{})
		if deleted.Error != nil {
			return deleted.Error
		}
		if deleted.RowsAffected != 1 {
			return ErrDesktopCredentialInvalid
		}
		var err error
		user, err = activeDesktopUser(tx, code.UserID)
		if err != nil {
			return err
		}
		session.UserID = user.Id
		return tx.Create(session).Error
	})
	return user, err
}

func GetDesktopAuthUser(digest string, now int64, consume bool) (*User, error) {
	var session DesktopAuthSession
	if err := DB.Where("digest = ? AND expires_at > ?", digest, now).First(&session).Error; err != nil {
		return nil, desktopCredentialError(err)
	}
	if !consume {
		return activeDesktopUser(DB, session.UserID)
	}
	var user *User
	err := DB.Transaction(func(tx *gorm.DB) error {
		deleted := tx.Where("digest = ? AND expires_at > ?", digest, now).Delete(&DesktopAuthSession{})
		if deleted.Error != nil {
			return deleted.Error
		}
		if deleted.RowsAffected != 1 {
			return ErrDesktopCredentialInvalid
		}
		var err error
		user, err = activeDesktopUser(tx, session.UserID)
		return err
	})
	return user, err
}

func RevokeDesktopAuthSession(digest string) error {
	return DB.Where("digest = ?", digest).Delete(&DesktopAuthSession{}).Error
}

func activeDesktopUser(tx *gorm.DB, userID int) (*User, error) {
	var user User
	err := tx.Omit("password", "access_token").
		Where("id = ? AND status = ?", userID, common.UserStatusEnabled).First(&user).Error
	if err != nil {
		return nil, desktopCredentialError(err)
	}
	return &user, nil
}

func desktopCredentialError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrDesktopCredentialInvalid
	}
	return err
}
