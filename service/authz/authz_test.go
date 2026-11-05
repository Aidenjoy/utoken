package authz

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func newAuthzTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	wasMaster := common.IsMasterNode
	common.IsMasterNode = true
	t.Cleanup(func() {
		common.IsMasterNode = wasMaster
	})
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.CasbinRule{}, &model.AuthzRole{}))
	return db
}

func TestInitSeedsBuiltInRolesAndPoliciesOnce(t *testing.T) {
	db := newAuthzTestDB(t)

	require.NoError(t, Init(db))
	require.NoError(t, Init(db))

	var count int64
	require.NoError(t, db.Model(&model.CasbinRule{}).Count(&count).Error)
	assert.Equal(t, int64(len(PermissionsForRole(BuiltInRoleAdmin))), count)

	var roles []model.AuthzRole
	require.NoError(t, db.Order("sort asc").Find(&roles).Error)
	require.Len(t, roles, 2)
	assert.Equal(t, BuiltInRoleRoot, roles[0].Key)
	assert.Equal(t, BuiltInRoleAdmin, roles[1].Key)

	assert.True(t, Can(1, common.RoleRootUser, MenuSystemInfo))
	assert.True(t, Can(1, common.RoleRootUser, SettingsSite))
	assert.True(t, Can(2, common.RoleAdminUser, MenuChannels))
	assert.True(t, Can(2, common.RoleAdminUser, MenuSubscriptions))
	assert.False(t, Can(2, common.RoleAdminUser, MenuSystemInfo))
	for _, permission := range AllSettingsPermissions() {
		assert.False(t, Can(2, common.RoleAdminUser, permission))
	}
	assert.False(t, Can(3, common.RoleCommonUser, MenuChannels))
}

func TestCatalogMatchesAdministratorMenuOrder(t *testing.T) {
	catalog := Catalog()
	require.Len(t, catalog, 2)
	assert.Equal(t, ResourceMenu, catalog[0].Resource)
	assert.Equal(t, ResourceSettings, catalog[1].Resource)

	menuActions := make([]string, 0, len(catalog[0].Actions))
	for _, action := range catalog[0].Actions {
		menuActions = append(menuActions, action.Action)
	}
	assert.Equal(t, []string{
		ActionMenuChannels,
		ActionMenuAssetSync,
		ActionMenuModels,
		ActionMenuUsers,
		ActionMenuOrganizations,
		ActionMenuTokenRates,
		ActionMenuAgents,
		ActionMenuUserBilling,
		ActionMenuChannelBilling,
		ActionMenuCostCalculator,
		ActionMenuRedemption,
		ActionMenuSubscriptions,
		ActionMenuSystemInfo,
	}, menuActions)

	settingsActions := make([]string, 0, len(catalog[1].Actions))
	for _, action := range catalog[1].Actions {
		settingsActions = append(settingsActions, action.Action)
	}
	assert.Equal(t, []string{
		ActionSettingsSite,
		ActionSettingsAuth,
		ActionSettingsBilling,
		ActionSettingsModels,
		ActionSettingsSecurity,
		ActionSettingsContent,
		ActionSettingsOperations,
	}, settingsActions)
}

func TestInitOnSlaveOnlyLoadsPolicies(t *testing.T) {
	wasMaster := common.IsMasterNode
	common.IsMasterNode = false
	t.Cleanup(func() {
		common.IsMasterNode = wasMaster
	})
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, db.AutoMigrate(&model.CasbinRule{}, &model.AuthzRole{}))

	require.NoError(t, Init(db))

	var roleCount int64
	require.NoError(t, db.Model(&model.AuthzRole{}).Count(&roleCount).Error)
	assert.Zero(t, roleCount)
	var policyCount int64
	require.NoError(t, db.Model(&model.CasbinRule{}).Count(&policyCount).Error)
	assert.Zero(t, policyCount)
	assert.False(t, Can(2, common.RoleAdminUser, MenuChannels))
}

func TestSetUserPermissionsStoresOnlyOverrides(t *testing.T) {
	db := newAuthzTestDB(t)
	require.NoError(t, Init(db))

	require.NoError(t, SetUserPermissions(42, PermissionsMap{
		ResourceMenu: {
			ActionMenuChannels: false,
			ActionMenuUsers:    true,
			"unknown":          true,
		},
		ResourceSettings: {
			ActionSettingsBilling: true,
			"unknown":             true,
		},
		"unknown": {
			ActionMenuChannels: true,
		},
	}))

	assert.False(t, Can(42, common.RoleAdminUser, MenuChannels))
	assert.True(t, Can(42, common.RoleAdminUser, MenuUsers))
	assert.True(t, Can(42, common.RoleAdminUser, SettingsBilling))
	assert.Equal(t, PermissionsMap{
		ResourceMenu: {
			ActionMenuChannels: false,
		},
		ResourceSettings: {
			ActionSettingsBilling: true,
		},
	}, ExplicitUserOverrides(42))

	var userPolicyCount int64
	require.NoError(t, db.Model(&model.CasbinRule{}).Where("v0 = ?", UserSubject(42)).Count(&userPolicyCount).Error)
	assert.Equal(t, int64(2), userPolicyCount)

	require.NoError(t, SetUserPermissions(42, PermissionsMap{
		ResourceMenu:     {ActionMenuChannels: true},
		ResourceSettings: {ActionSettingsBilling: false},
	}))
	assert.True(t, Can(42, common.RoleAdminUser, MenuChannels))
	assert.False(t, Can(42, common.RoleAdminUser, SettingsBilling))
	assert.Empty(t, ExplicitUserOverrides(42))
}

func TestClearUserAuthorizationRemovesOverrides(t *testing.T) {
	db := newAuthzTestDB(t)
	require.NoError(t, Init(db))

	require.NoError(t, SetUserPermissions(90, PermissionsMap{
		ResourceMenu:     {ActionMenuUsers: false},
		ResourceSettings: {ActionSettingsSite: true},
	}))
	assert.False(t, Can(90, common.RoleAdminUser, MenuUsers))
	assert.True(t, Can(90, common.RoleAdminUser, SettingsSite))

	require.NoError(t, ClearUserAuthorization(90))

	assert.Empty(t, ExplicitUserOverrides(90))
	assert.True(t, Can(90, common.RoleAdminUser, MenuUsers))
	assert.False(t, Can(90, common.RoleAdminUser, SettingsSite))
	assert.False(t, Can(90, common.RoleCommonUser, MenuUsers))
}

func TestSetUserPermissionsInTxDoesNotMutateEnforcerBeforeReload(t *testing.T) {
	db := newAuthzTestDB(t)
	require.NoError(t, Init(db))

	require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
		return SetUserPermissionsInTx(tx, 42, PermissionsMap{
			ResourceMenu:     {ActionMenuChannels: false},
			ResourceSettings: {ActionSettingsBilling: true},
		})
	}))

	assert.True(t, Can(42, common.RoleAdminUser, MenuChannels))
	assert.False(t, Can(42, common.RoleAdminUser, SettingsBilling))
	require.NoError(t, ReloadPolicy())
	assert.False(t, Can(42, common.RoleAdminUser, MenuChannels))
	assert.True(t, Can(42, common.RoleAdminUser, SettingsBilling))
}

func TestSetUserPermissionsInTxRollbackLeavesNoPolicy(t *testing.T) {
	db := newAuthzTestDB(t)
	require.NoError(t, Init(db))

	tx := db.Begin()
	require.NoError(t, tx.Error)
	require.NoError(t, SetUserPermissionsInTx(tx, 43, PermissionsMap{
		ResourceMenu: {ActionMenuChannels: false},
	}))
	require.NoError(t, tx.Rollback().Error)
	require.NoError(t, ReloadPolicy())

	assert.True(t, Can(43, common.RoleAdminUser, MenuChannels))
	var count int64
	require.NoError(t, db.Model(&model.CasbinRule{}).Where("v0 = ?", UserSubject(43)).Count(&count).Error)
	assert.Zero(t, count)
}

func TestAdapterAddPolicyIsIdempotent(t *testing.T) {
	db := newAuthzTestDB(t)
	adapter := newGormAdapter(db)
	rule := []string{UserSubject(55), ResourceMenu, ActionMenuChannels, EffectAllow}

	require.NoError(t, adapter.AddPolicy("p", "p", rule))
	require.NoError(t, adapter.AddPolicy("p", "p", rule))

	var count int64
	require.NoError(t, db.Model(&model.CasbinRule{}).Where(
		"ptype = ? AND v0 = ? AND v1 = ? AND v2 = ? AND v3 = ?",
		"p",
		UserSubject(55),
		ResourceMenu,
		ActionMenuChannels,
		EffectAllow,
	).Count(&count).Error)
	assert.Equal(t, int64(1), count)
}

func TestCapabilitiesUseCatalogShape(t *testing.T) {
	db := newAuthzTestDB(t)
	require.NoError(t, Init(db))

	capabilities := Capabilities(7, common.RoleAdminUser)

	assert.True(t, capabilities[ResourceMenu][ActionMenuChannels])
	assert.True(t, capabilities[ResourceMenu][ActionMenuSubscriptions])
	assert.False(t, capabilities[ResourceMenu][ActionMenuSystemInfo])
	assert.False(t, capabilities[ResourceSettings][ActionSettingsBilling])
}

func TestInitMigratesLegacyPolicies(t *testing.T) {
	db := newAuthzTestDB(t)
	legacyRules := []model.CasbinRule{
		{Ptype: "p", V0: UserSubject(42), V1: "channel", V2: "write", V3: EffectAllow},
		{Ptype: "p", V0: UserSubject(42), V1: "billing", V2: "model_pricing", V3: EffectAllow},
		{Ptype: "p", V0: UserSubject(43), V1: "billing", V2: "model_pricing", V3: EffectDeny},
	}
	require.NoError(t, db.Create(&legacyRules).Error)

	require.NoError(t, Init(db))

	var legacyCount int64
	require.NoError(t, db.Model(&model.CasbinRule{}).
		Where("ptype = ? AND (v1 = ? OR v1 = ?)", "p", "channel", "billing").
		Count(&legacyCount).Error)
	assert.Zero(t, legacyCount)
	assert.True(t, Can(42, common.RoleAdminUser, MenuChannels))
	assert.True(t, Can(42, common.RoleAdminUser, SettingsBilling))
	assert.False(t, Can(43, common.RoleAdminUser, SettingsBilling))

	var migrated []model.CasbinRule
	require.NoError(t, db.Where("ptype = ? AND v1 = ? AND v2 = ?", "p", ResourceSettings, ActionSettingsBilling).
		Order("v0 asc").Find(&migrated).Error)
	require.Len(t, migrated, 2)
	assert.Equal(t, UserSubject(42), migrated[0].V0)
	assert.Equal(t, EffectAllow, migrated[0].V3)
	assert.Equal(t, UserSubject(43), migrated[1].V0)
	assert.Equal(t, EffectDeny, migrated[1].V3)
}
