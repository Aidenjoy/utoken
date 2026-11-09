package controller

import (
	"strings"

	"github.com/QuantumNous/new-api/service/authz"
)

// 系统设置配置键（option key）到子菜单权限的归属映射。
//
// 归属依据是 default 前端各子菜单 section-registry 实际读写的键集合：
// 被授予某个系统设置子菜单权限的管理员，只能读到、且只能修改归属该子菜单的键；
// 未出现在任何映射中的键（含未来新增键）默认仅超管可读写，保证新配置不会意外泄露。
//
// 匹配顺序：精确键（含 general_setting 这类需要逐键拆分的命名空间）优先，其次前缀。
var optionPrefixSections = []struct {
	prefix   string
	sections []authz.Permission
}{
	{"theme.", []authz.Permission{authz.SettingsSite}},
	{"legal.", []authz.Permission{authz.SettingsSite}},
	{"discord.", []authz.Permission{authz.SettingsAuth}},
	{"oidc.", []authz.Permission{authz.SettingsAuth}},
	{"passkey.", []authz.Permission{authz.SettingsAuth}},
	{"console_setting.", []authz.Permission{authz.SettingsContent}},
	{"billing_setting.", []authz.Permission{authz.SettingsBilling}},
	{"quota_setting.", []authz.Permission{authz.SettingsBilling}},
	{"payment_setting.", []authz.Permission{authz.SettingsBilling}},
	{"group_ratio_setting.", []authz.Permission{authz.SettingsBilling}},
	{"tool_price_setting.", []authz.Permission{authz.SettingsBilling}},
	{"checkin_setting.", []authz.Permission{authz.SettingsBilling}},
	{"global.", []authz.Permission{authz.SettingsModels}},
	{"monitor_setting.", []authz.Permission{authz.SettingsModels}},
	{"gemini.", []authz.Permission{authz.SettingsModels}},
	{"claude.", []authz.Permission{authz.SettingsModels}},
	{"grok.", []authz.Permission{authz.SettingsModels}},
	{"qwen.", []authz.Permission{authz.SettingsModels}},
	{"channel_affinity_setting.", []authz.Permission{authz.SettingsModels}},
	{"model_deployment.", []authz.Permission{authz.SettingsModels}},
	{"fetch_setting.", []authz.Permission{authz.SettingsSecurity}},
	{"token_setting.", []authz.Permission{authz.SettingsSecurity}},
	{"perf_metrics_setting.", []authz.Permission{authz.SettingsOperations}},
	{"performance_setting.", []authz.Permission{authz.SettingsOperations}},
	{"response_cache_setting.", []authz.Permission{authz.SettingsOperations}},
}

var optionKeySections = map[string][]authz.Permission{
	// 站点与品牌（site）。ServerAddress 同时供认证子菜单展示 OAuth 回调地址（只读语义共享）。
	"SystemName":          {authz.SettingsSite},
	"Logo":                {authz.SettingsSite},
	"SupportQRCode":       {authz.SettingsSite},
	"SupportContact":      {authz.SettingsSite},
	"Footer":              {authz.SettingsSite},
	"About":               {authz.SettingsSite},
	"HomePageContent":     {authz.SettingsSite},
	"ServerAddress":       {authz.SettingsSite, authz.SettingsAuth},
	"Notice":              {authz.SettingsSite},
	"HeaderNavModules":    {authz.SettingsSite},
	"SidebarModulesAdmin": {authz.SettingsSite},

	// 认证（auth）
	"PasswordLoginEnabled":          {authz.SettingsAuth},
	"PasswordRegisterEnabled":       {authz.SettingsAuth},
	"EmailVerificationEnabled":      {authz.SettingsAuth},
	"PhoneVerificationEnabled":      {authz.SettingsAuth},
	"SmsSdkAppId":                   {authz.SettingsAuth},
	"SmsAppKey":                     {authz.SettingsAuth},
	"SmsSignature":                  {authz.SettingsAuth},
	"SmsNationCode":                 {authz.SettingsAuth},
	"SmsTemplate":                   {authz.SettingsAuth},
	"RegisterEnabled":               {authz.SettingsAuth},
	"EmailDomainRestrictionEnabled": {authz.SettingsAuth},
	"EmailAliasRestrictionEnabled":  {authz.SettingsAuth},
	"EmailDomainWhitelist":          {authz.SettingsAuth},
	"GitHubOAuthEnabled":            {authz.SettingsAuth},
	"GitHubClientId":                {authz.SettingsAuth},
	"GitHubClientSecret":            {authz.SettingsAuth},
	"TelegramOAuthEnabled":          {authz.SettingsAuth},
	"TelegramBotToken":              {authz.SettingsAuth},
	"TelegramBotName":               {authz.SettingsAuth},
	"LinuxDOOAuthEnabled":           {authz.SettingsAuth},
	"LinuxDOClientId":               {authz.SettingsAuth},
	"LinuxDOClientSecret":           {authz.SettingsAuth},
	"LinuxDOMinimumTrustLevel":      {authz.SettingsAuth},
	"WeChatAuthEnabled":             {authz.SettingsAuth},
	"WeChatServerAddress":           {authz.SettingsAuth},
	"WeChatServerToken":             {authz.SettingsAuth},
	"WeChatAccountQRCodeImageURL":   {authz.SettingsAuth},
	"TurnstileCheckEnabled":         {authz.SettingsAuth},
	"TurnstileSiteKey":              {authz.SettingsAuth},
	"TurnstileSecretKey":            {authz.SettingsAuth},

	// 控制台内容（content）
	"DataExportEnabled":           {authz.SettingsContent},
	"DataExportInterval":          {authz.SettingsContent},
	"DataExportDefaultTime":       {authz.SettingsContent},
	"Chats":                       {authz.SettingsContent},
	"DrawingEnabled":              {authz.SettingsContent},
	"MjNotifyEnabled":             {authz.SettingsContent},
	"MjAccountFilterEnabled":      {authz.SettingsContent},
	"MjForwardUrlEnabled":         {authz.SettingsContent},
	"MjModeClearEnabled":          {authz.SettingsContent},
	"MjActionCheckSuccessEnabled": {authz.SettingsContent},

	// 模型与路由（models）
	"RetryTimes":                     {authz.SettingsModels},
	"ChannelDisableThreshold":        {authz.SettingsModels},
	"AutomaticDisableChannelEnabled": {authz.SettingsModels},
	"AutomaticEnableChannelEnabled":  {authz.SettingsModels},
	"AutomaticDisableKeywords":       {authz.SettingsModels},
	"AutomaticDisableStatusCodes":    {authz.SettingsModels},
	"AutomaticRetryStatusCodes":      {authz.SettingsModels},

	// 安全与限制（security）
	"ModelRequestRateLimitEnabled":         {authz.SettingsSecurity},
	"ModelRequestRateLimitCount":           {authz.SettingsSecurity},
	"ModelRequestRateLimitSuccessCount":    {authz.SettingsSecurity},
	"ModelRequestRateLimitDurationMinutes": {authz.SettingsSecurity},
	"ModelRequestRateLimitGroup":           {authz.SettingsSecurity},
	"CheckSensitiveEnabled":                {authz.SettingsSecurity},
	"CheckSensitiveOnPromptEnabled":        {authz.SettingsSecurity},
	"StopOnSensitiveEnabled":               {authz.SettingsSecurity},
	"SensitiveWords":                       {authz.SettingsSecurity},

	// 运营（operations）
	"DefaultCollapseSidebar":             {authz.SettingsOperations},
	"DemoSiteEnabled":                    {authz.SettingsOperations},
	"SelfUseModeEnabled":                 {authz.SettingsOperations},
	"QuotaRemindThreshold":               {authz.SettingsOperations},
	"SMTPServer":                         {authz.SettingsOperations},
	"SMTPPort":                           {authz.SettingsOperations},
	"SMTPAccount":                        {authz.SettingsOperations},
	"SMTPFrom":                           {authz.SettingsOperations},
	"SMTPToken":                          {authz.SettingsOperations},
	"SMTPSSLEnabled":                     {authz.SettingsOperations},
	"SMTPStartTLSEnabled":                {authz.SettingsOperations},
	"SMTPInsecureSkipVerify":             {authz.SettingsOperations},
	"SMTPForceAuthLogin":                 {authz.SettingsOperations},
	"EmailDomainBlacklist":               {authz.SettingsOperations},
	"WorkerUrl":                          {authz.SettingsOperations},
	"WorkerValidKey":                     {authz.SettingsOperations},
	"WorkerAllowHttpImageRequestEnabled": {authz.SettingsOperations},
	"LogConsumeEnabled":                  {authz.SettingsOperations},
	"LogQueryApiCallEnabled":             {authz.SettingsOperations},

	// 计费与支付（billing）：额度、货币展示、模型定价、分组倍率、支付网关、签到。
	"QuotaForNewUser":             {authz.SettingsBilling},
	"PreConsumedQuota":            {authz.SettingsBilling},
	"QuotaForInviter":             {authz.SettingsBilling},
	"QuotaForInvitee":             {authz.SettingsBilling},
	"TopUpLink":                   {authz.SettingsBilling},
	"QuotaPerUnit":                {authz.SettingsBilling},
	"USDExchangeRate":             {authz.SettingsBilling},
	"DisplayInCurrencyEnabled":    {authz.SettingsBilling},
	"DisplayTokenStatEnabled":     {authz.SettingsBilling},
	"ModelPrice":                  {authz.SettingsBilling},
	"ModelRatio":                  {authz.SettingsBilling},
	"CacheRatio":                  {authz.SettingsBilling},
	"CreateCacheRatio":            {authz.SettingsBilling},
	"CompletionRatio":             {authz.SettingsBilling},
	"ImageRatio":                  {authz.SettingsBilling},
	"AudioRatio":                  {authz.SettingsBilling},
	"AudioCompletionRatio":        {authz.SettingsBilling},
	"ExposeRatioEnabled":          {authz.SettingsBilling},
	"TopupGroupRatio":             {authz.SettingsBilling},
	"GroupRatio":                  {authz.SettingsBilling},
	"UserUsableGroups":            {authz.SettingsBilling},
	"GroupGroupRatio":             {authz.SettingsBilling},
	"AutoGroups":                  {authz.SettingsBilling},
	"DefaultUseAutoGroup":         {authz.SettingsBilling},
	"PayAddress":                  {authz.SettingsBilling},
	"EpayId":                      {authz.SettingsBilling},
	"EpayKey":                     {authz.SettingsBilling},
	"Price":                       {authz.SettingsBilling},
	"MinTopUp":                    {authz.SettingsBilling},
	"CustomCallbackAddress":       {authz.SettingsBilling},
	"PayMethods":                  {authz.SettingsBilling},
	"StripeApiSecret":             {authz.SettingsBilling},
	"StripeWebhookSecret":         {authz.SettingsBilling},
	"StripePriceId":               {authz.SettingsBilling},
	"StripeUnitPrice":             {authz.SettingsBilling},
	"StripeCurrency":              {authz.SettingsBilling},
	"StripeMinTopUp":              {authz.SettingsBilling},
	"StripePromotionCodesEnabled": {authz.SettingsBilling},
	"CreemApiKey":                 {authz.SettingsBilling},
	"CreemProducts":               {authz.SettingsBilling},
	"CreemTestMode":               {authz.SettingsBilling},
	"CreemWebhookSecret":          {authz.SettingsBilling},
	"WaffoEnabled":                {authz.SettingsBilling},
	"WaffoApiKey":                 {authz.SettingsBilling},
	"WaffoPrivateKey":             {authz.SettingsBilling},
	"WaffoPublicCert":             {authz.SettingsBilling},
	"WaffoSandboxPublicCert":      {authz.SettingsBilling},
	"WaffoSandboxApiKey":          {authz.SettingsBilling},
	"WaffoSandboxPrivateKey":      {authz.SettingsBilling},
	"WaffoSandbox":                {authz.SettingsBilling},
	"WaffoMerchantId":             {authz.SettingsBilling},
	"WaffoNotifyUrl":              {authz.SettingsBilling},
	"WaffoReturnUrl":              {authz.SettingsBilling},
	"WaffoSubscriptionReturnUrl":  {authz.SettingsBilling},
	"WaffoCurrency":               {authz.SettingsBilling},
	"WaffoUnitPrice":              {authz.SettingsBilling},
	"WaffoMinTopUp":               {authz.SettingsBilling},
	"WaffoPayMethods":             {authz.SettingsBilling},
	"WaffoPancakeMerchantID":      {authz.SettingsBilling},
	"WaffoPancakePrivateKey":      {authz.SettingsBilling},
	"WaffoPancakeReturnURL":       {authz.SettingsBilling},
	"WaffoPancakeUnitPrice":       {authz.SettingsBilling},
	"WaffoPancakeMinTopUp":        {authz.SettingsBilling},
	"WaffoPancakeStoreID":         {authz.SettingsBilling},
	"WaffoPancakeProductID":       {authz.SettingsBilling},

	// general_setting 命名空间逐键拆分：计费展示归 billing，心跳归 models，其余键超管专属。
	"general_setting.docs_link":                     {authz.SettingsBilling},
	"general_setting.quota_display_type":            {authz.SettingsBilling},
	"general_setting.custom_currency_symbol":        {authz.SettingsBilling},
	"general_setting.custom_currency_exchange_rate": {authz.SettingsBilling},
	"general_setting.ping_interval_enabled":         {authz.SettingsModels},
	"general_setting.ping_interval_seconds":         {authz.SettingsModels},
}

// optionSectionsForKey 返回允许读写该配置键的子菜单权限集合；空集合表示仅超管可读写。
func optionSectionsForKey(key string) []authz.Permission {
	if sections, ok := optionKeySections[key]; ok {
		return sections
	}
	for _, entry := range optionPrefixSections {
		if strings.HasPrefix(key, entry.prefix) {
			return entry.sections
		}
	}
	return nil
}

// grantedSettingsActions 计算当前用户拥有的系统设置子菜单 action 集合。
// 超管经 authz.Can 直通，自然得到全部子菜单。
func grantedSettingsActions(userID int, role int) map[string]bool {
	granted := make(map[string]bool, len(authz.AllSettingsPermissions()))
	for _, permission := range authz.AllSettingsPermissions() {
		if authz.Can(userID, role, permission) {
			granted[permission.Action] = true
		}
	}
	return granted
}

// optionKeyAllowed 判定该键是否落在已授权子菜单集合内；未归属任何子菜单的键仅超管可见可改。
func optionKeyAllowed(key string, granted map[string]bool) bool {
	sections := optionSectionsForKey(key)
	for _, section := range sections {
		if granted[section.Action] {
			return true
		}
	}
	return false
}
