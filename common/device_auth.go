package common

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
)

const (
	DeviceClientID        = "yundashi-agent"
	DeviceTokenPrefix     = "udv_"
	DeviceGrantContextKey = "device_grant"
)

// DeviceCredential generates 256 bits of entropy; callers only persist its digest.
func DeviceCredential() (string, error) {
	var value [32]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value[:]), nil
}

// DeviceCredentialDigest produces a fixed-size, non-reversible lookup key.
func DeviceCredentialDigest(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}
