package common

import (
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type verificationValue struct {
	Code string    `json:"code"`
	Time time.Time `json:"time"`
}

const (
	EmailVerificationPurpose = "v"
	PasswordResetPurpose     = "r"

	verificationCodeKeyPrefix = "verification_code:"
	verificationSendKeyPrefix = "verification_send:"
	// 重发不立即作废旧码：邮箱投递慢于重发间隔时，用户手里上一封的码仍应可校验
	verificationMaxCodes = 2
)

var verificationMutex sync.Mutex
var verificationMap map[string][]verificationValue
var verificationMapMaxSize = 10
var VerificationValidMinutes = 10
var VerificationSendIntervalSeconds = 60

var sendMutex sync.Mutex
var sendTimeMap map[string]time.Time

func GenerateVerificationCode(length int) string {
	code := uuid.New().String()
	code = strings.Replace(code, "-", "", -1)
	if length == 0 {
		return code
	}
	return code[:length]
}

// 验证码同时写入内存与 Redis：多节点部署下校验请求可能落在非发送节点，
// Redis 是跨节点共享源，内存仅作为 Redis 不可用时的兜底。
func RegisterVerificationCodeWithKey(key string, code string, purpose string) {
	storeKey := purpose + key
	appendMemoryCodes(storeKey, code)
	if RedisEnabled {
		appendRedisCodes(storeKey, code)
	}
}

func VerifyCodeWithKey(key string, code string, purpose string) bool {
	storeKey := purpose + key
	if RedisEnabled && matchRedisCodes(storeKey, code) {
		return true
	}
	return matchMemoryCodes(storeKey, code)
}

func DeleteKey(key string, purpose string) {
	storeKey := purpose + key
	verificationMutex.Lock()
	delete(verificationMap, storeKey)
	verificationMutex.Unlock()
	if RedisEnabled {
		_ = RedisDel(verificationCodeKeyPrefix + storeKey)
	}
}

// CheckSendInterval 返回还需等待的秒数，0 表示允许发送并已占用名额。
func CheckSendInterval(key string, purpose string) int {
	storeKey := purpose + key
	if RedisEnabled {
		if wait, handled := checkRedisSendInterval(storeKey); handled {
			return wait
		}
	}
	return checkMemorySendInterval(storeKey)
}

func verificationValidSeconds() int {
	return VerificationValidMinutes * 60
}

func pruneExpiredCodes(entries []verificationValue, now time.Time) []verificationValue {
	pruned := make([]verificationValue, 0, len(entries))
	for _, entry := range entries {
		if int(now.Sub(entry.Time).Seconds()) < verificationValidSeconds() {
			pruned = append(pruned, entry)
		}
	}
	return pruned
}

func matchCodes(entries []verificationValue, code string, now time.Time) bool {
	for _, entry := range entries {
		if int(now.Sub(entry.Time).Seconds()) >= verificationValidSeconds() {
			continue
		}
		if entry.Code == code {
			return true
		}
	}
	return false
}

func appendCodes(entries []verificationValue, code string, now time.Time) []verificationValue {
	entries = pruneExpiredCodes(entries, now)
	entries = append(entries, verificationValue{Code: code, Time: now})
	if len(entries) > verificationMaxCodes {
		entries = entries[len(entries)-verificationMaxCodes:]
	}
	return entries
}

func appendMemoryCodes(storeKey string, code string) {
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	verificationMap[storeKey] = appendCodes(verificationMap[storeKey], code, time.Now())
	if len(verificationMap) > verificationMapMaxSize {
		removeExpiredPairs()
	}
}

func matchMemoryCodes(storeKey string, code string) bool {
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	return matchCodes(verificationMap[storeKey], code, time.Now())
}

// no lock inside, so the caller must lock the verificationMap before calling!
func removeExpiredPairs() {
	now := time.Now()
	for key, entries := range verificationMap {
		pruned := pruneExpiredCodes(entries, now)
		if len(pruned) == 0 {
			delete(verificationMap, key)
		} else {
			verificationMap[key] = pruned
		}
	}
}

func appendRedisCodes(storeKey string, code string) {
	redisKey := verificationCodeKeyPrefix + storeKey
	var entries []verificationValue
	if raw, err := RedisGet(redisKey); err == nil && raw != "" {
		if err := UnmarshalJsonStr(raw, &entries); err != nil {
			entries = nil
		}
	}
	entries = appendCodes(entries, code, time.Now())
	raw, err := Marshal(entries)
	if err != nil {
		return
	}
	_ = RedisSet(redisKey, string(raw), time.Duration(verificationValidSeconds())*time.Second)
}

func matchRedisCodes(storeKey string, code string) bool {
	raw, err := RedisGet(verificationCodeKeyPrefix + storeKey)
	if err != nil || raw == "" {
		return false
	}
	var entries []verificationValue
	if err := UnmarshalJsonStr(raw, &entries); err != nil {
		return false
	}
	return matchCodes(entries, code, time.Now())
}

func checkRedisSendInterval(storeKey string) (int, bool) {
	redisKey := verificationSendKeyPrefix + storeKey
	interval := time.Duration(VerificationSendIntervalSeconds) * time.Second
	now := time.Now()
	if RedisSetNX(redisKey, strconv.FormatInt(now.Unix(), 10), interval) {
		return 0, true
	}
	raw, err := RedisGet(redisKey)
	if err != nil {
		return 0, false
	}
	sentAt, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, false
	}
	wait := VerificationSendIntervalSeconds - int(now.Unix()-sentAt)
	if wait <= 0 {
		_ = RedisSet(redisKey, strconv.FormatInt(now.Unix(), 10), interval)
		return 0, true
	}
	return wait, true
}

func checkMemorySendInterval(storeKey string) int {
	sendMutex.Lock()
	defer sendMutex.Unlock()
	now := time.Now()
	if sentAt, ok := sendTimeMap[storeKey]; ok {
		wait := VerificationSendIntervalSeconds - int(now.Sub(sentAt).Seconds())
		if wait > 0 {
			return wait
		}
	}
	sendTimeMap[storeKey] = now
	return 0
}

func init() {
	verificationMutex.Lock()
	defer verificationMutex.Unlock()
	verificationMap = make(map[string][]verificationValue)
	sendTimeMap = make(map[string]time.Time)
}
