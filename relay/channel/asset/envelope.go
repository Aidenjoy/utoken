package asset

import "github.com/QuantumNous/new-api/common"

// 官方兼容 API 的响应信封构造。与上游 call() 解析的 {ResponseMetadata,Result} 同构，
// 但方向相反：这里构造本站作为「服务端」返回给下游的响应体。
//
// 放在本包是因为它已是 Ark 官方信封格式的归属地，且 controller 与 middleware 都能
// 无环导入本包——controller→middleware 已存在，故 middleware 不能反向导入 controller，
// 二者共享的信封构造只能落在更底层的本包。

// OfficialSuccessEnvelope 构造成功响应：{ResponseMetadata:{...},Result:...}。
// Result 恒被序列化（即便为空对象 {}），与官方一致；RequestId 每次新生成。
func OfficialSuccessEnvelope(action, region string, result any) map[string]any {
	return map[string]any{
		"ResponseMetadata": map[string]any{
			"RequestId": common.GetUUID(),
			"Action":    action,
			"Version":   arkOfficialVersion,
			"Service":   arkOfficialService,
			"Region":    region,
		},
		"Result": result,
	}
}

// OfficialErrorEnvelope 构造错误响应：{ResponseMetadata:{...,Error:{CodeN,Code,Message}}}，无 Result。
func OfficialErrorEnvelope(action, region string, codeN int, code, message string) map[string]any {
	return map[string]any{
		"ResponseMetadata": map[string]any{
			"RequestId": common.GetUUID(),
			"Action":    action,
			"Version":   arkOfficialVersion,
			"Service":   arkOfficialService,
			"Region":    region,
			"Error": map[string]any{
				"CodeN":   codeN,
				"Code":    code,
				"Message": message,
			},
		},
	}
}
