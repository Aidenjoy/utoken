// Package sms 短信验证码下发（云大师通道）。
// 协议见 https://www.yundashi.com/legacy/duanxin_api1.html ，
// 与 docs/yun/test_sms_send.py 测试脚本保持一致。
package sms

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const sendURL = "https://msg.yundashi.com/api/sms/send"

var httpClient = &http.Client{Timeout: 15 * time.Second}

type sendTarget struct {
	Mobile     string `json:"mobile"`
	NationCode string `json:"nationcode"`
}

type sendRequest struct {
	Tel    []sendTarget `json:"tel"`
	Msg    string       `json:"msg"`
	Sig    string       `json:"sig"`
	Time   int64        `json:"time"`
	Extend string       `json:"extend"`
	Ext    string       `json:"ext"`
}

type sendResponse struct {
	Result int    `json:"result"`
	ErrMsg string `json:"errmsg"`
}

// SendVerificationCode 向 mobile（归一化后的手机号）发送短信验证码。
// 短信内容 = 签名 + 模板（{code} 替换为验证码），需与云大师后台报备模板一致。
func SendVerificationCode(mobile string, code string) error {
	if common.SmsSdkAppId == "" || common.SmsAppKey == "" {
		return errors.New("短信通道未配置：请先在系统设置填写 SmsSdkAppId 与 SmsAppKey")
	}
	template := common.SmsTemplate
	if template == "" {
		template = "你的验证码是{code}，请在5分钟内使用。"
	}
	msg := common.SmsSignature + strings.ReplaceAll(template, "{code}", code)

	// sig 与 tel 使用不带 + 前缀的纯数字号码
	bareMobile := strings.TrimPrefix(mobile, "+")
	randStr := common.GenerateNumericVerificationCode(10)
	if randStr == "" {
		return errors.New("短信签名随机数生成失败")
	}
	timestamp := time.Now().Unix()
	raw := fmt.Sprintf("appkey=%s&random=%s&time=%d&mobile=%s", common.SmsAppKey, randStr, timestamp, bareMobile)
	sum := sha256.Sum256([]byte(raw))
	sig := hex.EncodeToString(sum[:])

	nationCode := common.SmsNationCode
	if nationCode == "" {
		nationCode = "86"
	}
	payload := sendRequest{
		Tel:    []sendTarget{{Mobile: bareMobile, NationCode: nationCode}},
		Msg:    msg,
		Sig:    sig,
		Time:   timestamp,
		Extend: "",
		Ext:    "",
	}
	body, err := common.Marshal(payload)
	if err != nil {
		return err
	}
	url := fmt.Sprintf("%s?sdkappid=%s&random=%s", sendURL, common.SmsSdkAppId, randStr)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("短信通道请求失败: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("短信通道响应读取失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("短信通道响应异常: status=%d body=%s", resp.StatusCode, string(respBody))
	}
	var result sendResponse
	if err := common.UnmarshalJsonStr(string(respBody), &result); err != nil {
		return fmt.Errorf("短信通道响应解析失败: %w", err)
	}
	if result.Result != 0 {
		return fmt.Errorf("短信发送失败: result=%d errmsg=%s", result.Result, result.ErrMsg)
	}
	return nil
}
