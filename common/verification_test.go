package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withMemoryOnlyVerification(t *testing.T) {
	t.Helper()
	original := RedisEnabled
	RedisEnabled = false
	t.Cleanup(func() { RedisEnabled = original })
}

func TestVerifyCodeWithKeyAcceptsPreviousCodeAfterResend(t *testing.T) {
	withMemoryOnlyVerification(t)

	RegisterVerificationCodeWithKey("keep@example.com", "code1", EmailVerificationPurpose)
	RegisterVerificationCodeWithKey("keep@example.com", "code2", EmailVerificationPurpose)
	RegisterVerificationCodeWithKey("keep@example.com", "code3", EmailVerificationPurpose)

	assert.False(t, VerifyCodeWithKey("keep@example.com", "code1", EmailVerificationPurpose), "oldest code must be dropped once a third is issued")
	assert.True(t, VerifyCodeWithKey("keep@example.com", "code2", EmailVerificationPurpose), "previous code stays valid after a resend")
	assert.True(t, VerifyCodeWithKey("keep@example.com", "code3", EmailVerificationPurpose))
	assert.False(t, VerifyCodeWithKey("keep@example.com", "code3", PasswordResetPurpose), "purposes must not share codes")
}

func TestVerifyCodeWithKeyRejectsExpiredCode(t *testing.T) {
	withMemoryOnlyVerification(t)
	original := VerificationValidMinutes
	VerificationValidMinutes = 0
	t.Cleanup(func() { VerificationValidMinutes = original })

	RegisterVerificationCodeWithKey("expired@example.com", "code1", EmailVerificationPurpose)

	assert.False(t, VerifyCodeWithKey("expired@example.com", "code1", EmailVerificationPurpose))
}

func TestDeleteKeyInvalidatesAllCodes(t *testing.T) {
	withMemoryOnlyVerification(t)

	RegisterVerificationCodeWithKey("deleted@example.com", "code1", PasswordResetPurpose)
	RegisterVerificationCodeWithKey("deleted@example.com", "code2", PasswordResetPurpose)
	require.True(t, VerifyCodeWithKey("deleted@example.com", "code1", PasswordResetPurpose))

	DeleteKey("deleted@example.com", PasswordResetPurpose)

	assert.False(t, VerifyCodeWithKey("deleted@example.com", "code1", PasswordResetPurpose))
	assert.False(t, VerifyCodeWithKey("deleted@example.com", "code2", PasswordResetPurpose))
}

func TestCheckSendIntervalBlocksImmediateResend(t *testing.T) {
	withMemoryOnlyVerification(t)

	assert.Equal(t, 0, CheckSendInterval("rate@example.com", EmailVerificationPurpose))
	assert.Positive(t, CheckSendInterval("rate@example.com", EmailVerificationPurpose))
	assert.Equal(t, 0, CheckSendInterval("rate@example.com", PasswordResetPurpose), "intervals are tracked per purpose")
	assert.Equal(t, 0, CheckSendInterval("other@example.com", EmailVerificationPurpose))
}
