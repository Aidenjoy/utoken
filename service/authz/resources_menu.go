package authz

// 菜单页面级权限：每个 action 对应管理员左侧菜单（或系统设置子菜单）的一项。
// 语义为「整页授权」——勾选后该菜单页面及其全部增删改查接口均可用；
// 未勾选则菜单隐藏、页面 403、后端接口一律拒绝。不再细分到按钮级。
const (
	ResourceMenu     = "menu"
	ResourceSettings = "settings"
)

// 管理员主菜单 action，声明顺序与左侧菜单顺序一致（Catalog 按注册顺序输出）。
const (
	ActionMenuChannels       = "channels"
	ActionMenuAssetSync      = "asset_sync"
	ActionMenuModels         = "models"
	ActionMenuUsers          = "users"
	ActionMenuOrganizations  = "organizations"
	ActionMenuTokenRates     = "token_rates"
	ActionMenuAgents         = "agents"
	ActionMenuUserBilling    = "user_billing"
	ActionMenuChannelBilling = "channel_billing"
	ActionMenuCostCalculator = "cost_calculator"
	ActionMenuRedemption     = "redemption"
	ActionMenuSubscriptions  = "subscriptions"
	ActionMenuSystemInfo     = "system_info"
)

// 系统设置子菜单 action，声明顺序与系统设置侧栏顺序一致。
const (
	ActionSettingsSite       = "site"
	ActionSettingsAuth       = "auth"
	ActionSettingsBilling    = "billing"
	ActionSettingsModels     = "models"
	ActionSettingsSecurity   = "security"
	ActionSettingsContent    = "content"
	ActionSettingsOperations = "operations"
)

var (
	MenuChannels       = Permission{Resource: ResourceMenu, Action: ActionMenuChannels}
	MenuAssetSync      = Permission{Resource: ResourceMenu, Action: ActionMenuAssetSync}
	MenuModels         = Permission{Resource: ResourceMenu, Action: ActionMenuModels}
	MenuUsers          = Permission{Resource: ResourceMenu, Action: ActionMenuUsers}
	MenuOrganizations  = Permission{Resource: ResourceMenu, Action: ActionMenuOrganizations}
	MenuTokenRates     = Permission{Resource: ResourceMenu, Action: ActionMenuTokenRates}
	MenuAgents         = Permission{Resource: ResourceMenu, Action: ActionMenuAgents}
	MenuUserBilling    = Permission{Resource: ResourceMenu, Action: ActionMenuUserBilling}
	MenuChannelBilling = Permission{Resource: ResourceMenu, Action: ActionMenuChannelBilling}
	MenuCostCalculator = Permission{Resource: ResourceMenu, Action: ActionMenuCostCalculator}
	MenuRedemption     = Permission{Resource: ResourceMenu, Action: ActionMenuRedemption}
	MenuSubscriptions  = Permission{Resource: ResourceMenu, Action: ActionMenuSubscriptions}
	MenuSystemInfo     = Permission{Resource: ResourceMenu, Action: ActionMenuSystemInfo}

	SettingsSite       = Permission{Resource: ResourceSettings, Action: ActionSettingsSite}
	SettingsAuth       = Permission{Resource: ResourceSettings, Action: ActionSettingsAuth}
	SettingsBilling    = Permission{Resource: ResourceSettings, Action: ActionSettingsBilling}
	SettingsModels     = Permission{Resource: ResourceSettings, Action: ActionSettingsModels}
	SettingsSecurity   = Permission{Resource: ResourceSettings, Action: ActionSettingsSecurity}
	SettingsContent    = Permission{Resource: ResourceSettings, Action: ActionSettingsContent}
	SettingsOperations = Permission{Resource: ResourceSettings, Action: ActionSettingsOperations}
)

// AllSettingsPermissions 返回系统设置全部子菜单权限，供「任一子菜单授权即可」的
// 场景（如 /api/option 读写入口）做任一命中判定。
func AllSettingsPermissions() []Permission {
	return []Permission{
		SettingsSite,
		SettingsAuth,
		SettingsBilling,
		SettingsModels,
		SettingsSecurity,
		SettingsContent,
		SettingsOperations,
	}
}

func init() {
	// 前 12 个主菜单与现状 AdminAuth 语义一致：默认授予管理员角色，超管可按用户取消勾选。
	// 系统信息与系统设置各子菜单默认不授予（现状即超管专属），需超管逐项授权。
	RegisterResource(ResourceDefinition{
		Resource: ResourceMenu,
		LabelKey: "Admin Menus",
		Actions: []ActionDefinition{
			{
				Action:         ActionMenuChannels,
				LabelKey:       "Channels",
				DescriptionKey: "Open the Channels page and manage channels, keys, routing, testing, and balances.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionMenuAssetSync,
				LabelKey:       "Asset Sync",
				DescriptionKey: "Open Asset Sync and synchronize assets across users and channels.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionMenuModels,
				LabelKey:       "Models",
				DescriptionKey: "Open the Models page and manage model metadata, vendors, and deployments.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionMenuUsers,
				LabelKey:       "Users",
				DescriptionKey: "Open the Users page and manage accounts, quotas, groups, discounts, and bindings.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionMenuOrganizations,
				LabelKey:       "Organization Management",
				DescriptionKey: "Open Organization Management and manage enterprises, quotas, rates, and members.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionMenuTokenRates,
				LabelKey:       "Token Rate Management",
				DescriptionKey: "Open Token Rate Management and adjust per-user and per-organization token rates.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionMenuAgents,
				LabelKey:       "Agent Management",
				DescriptionKey: "Open Agent Management and manage agents, authorized models, and invite codes.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionMenuUserBilling,
				LabelKey:       "User Billing",
				DescriptionKey: "Open User Billing and review recharge, consumption, and usage log records.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionMenuChannelBilling,
				LabelKey:       "Channel Billing",
				DescriptionKey: "Open Channel Billing and reconcile upstream usage, tokens, and costs.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionMenuCostCalculator,
				LabelKey:       "Cost Calculator",
				DescriptionKey: "Open the Cost Calculator and estimate language, image, and video model costs.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionMenuRedemption,
				LabelKey:       "Redemption Codes",
				DescriptionKey: "Open Redemption Codes and create, edit, or delete redemption codes.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionMenuSubscriptions,
				LabelKey:       "Subscriptions",
				DescriptionKey: "Open Subscriptions and manage plans and user subscriptions.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionMenuSystemInfo,
				LabelKey:       "System Info",
				DescriptionKey: "Open System Info and view or remove cluster instances.",
			},
		},
	})
	RegisterResource(ResourceDefinition{
		Resource: ResourceSettings,
		LabelKey: "System Settings",
		Actions: []ActionDefinition{
			{
				Action:         ActionSettingsSite,
				LabelKey:       "Site & Branding",
				DescriptionKey: "Open System Settings - Site & Branding and read or write its configuration.",
			},
			{
				Action:         ActionSettingsAuth,
				LabelKey:       "Authentication",
				DescriptionKey: "Open System Settings - Authentication and read or write its configuration.",
			},
			{
				Action:         ActionSettingsBilling,
				LabelKey:       "Billing & Payment",
				DescriptionKey: "Open System Settings - Billing & Payment, including model pricing, group ratios, and payment gateways.",
			},
			{
				Action:         ActionSettingsModels,
				LabelKey:       "Models & Routing",
				DescriptionKey: "Open System Settings - Models & Routing and read or write its configuration.",
			},
			{
				Action:         ActionSettingsSecurity,
				LabelKey:       "Security & Limits",
				DescriptionKey: "Open System Settings - Security & Limits and read or write its configuration.",
			},
			{
				Action:         ActionSettingsContent,
				LabelKey:       "Console Content",
				DescriptionKey: "Open System Settings - Console Content and read or write its configuration.",
			},
			{
				Action:         ActionSettingsOperations,
				LabelKey:       "Operations",
				DescriptionKey: "Open System Settings - Operations and read or write its configuration.",
			},
		},
	})
}
