package service

import (
	"crypto/rand"
	"errors"
	"math/big"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const DeviceCodeTTL int64 = 600
const DeviceAccessTTL int64 = 30 * 24 * 60 * 60

// DeviceAuthorizationResponse follows RFC 8628 and deliberately contains no user credentials.
type DeviceAuthorizationResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	ExpiresIn               int64  `json:"expires_in"`
	Interval                int64  `json:"interval"`
}

// CreateAgentDeviceAuthorization validates the registered public client and its requested permissions.
func CreateAgentDeviceAuthorization(clientID, scope, deviceName, origin string) (*DeviceAuthorizationResponse, error) {
	if clientID != common.DeviceClientID {
		return nil, errors.New("invalid_client")
	}
	if !utf8.ValidString(deviceName) || utf8.RuneCountInString(deviceName) > 100 || strings.ContainsAny(deviceName, "\r\n\x00") {
		return nil, errors.New("invalid_request")
	}
	if scope == "" {
		scope = "token:manage user:read log:read"
	}
	requested := strings.Fields(scope)
	allowed := map[string]bool{"token:manage": true, "user:read": true, "log:read": true}
	seen := make(map[string]bool)
	permissions := make([]string, 0, 3)
	for _, permission := range requested {
		if !allowed[permission] {
			return nil, errors.New("invalid_scope")
		}
		if !seen[permission] {
			permissions = append(permissions, permission)
			seen[permission] = true
		}
	}
	if len(permissions) == 0 {
		return nil, errors.New("invalid_scope")
	}
	deviceCode, err := common.DeviceCredential()
	if err != nil {
		return nil, err
	}
	// A 32-character alphabet avoids ambiguous letters, with 40 bits of user-code entropy.
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	code := make([]byte, 8)
	for i := range code {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return nil, err
		}
		code[i] = alphabet[n.Int64()]
	}
	userCode := string(code[:4]) + "-" + string(code[4:])
	now := model.GetDBTimestamp()
	grant := &model.DeviceGrantInfo{
		DeviceDigest: common.DeviceCredentialDigest(deviceCode), UserCodeDigest: common.DeviceCredentialDigest(userCode),
		ClientID: clientID, DeviceName: deviceName, Scope: strings.Join(permissions, " "), Status: model.DevicePending,
		CodeExpiresAt: now + DeviceCodeTTL, PollAfter: now + 5, PollInterval: 5, CreateBy: clientID, UpdateBy: clientID,
	}
	if err := model.CreateDeviceGrant(grant); err != nil {
		return nil, err
	}
	common.SysLog("device authorization created client=" + clientID)
	verificationURI := strings.TrimRight(origin, "/") + "/oauth/device"
	return &DeviceAuthorizationResponse{DeviceCode: deviceCode, UserCode: userCode,
		VerificationURI: verificationURI, VerificationURIComplete: verificationURI + "?user_code=" + userCode,
		ExpiresIn: DeviceCodeTTL, Interval: 5}, nil
}
