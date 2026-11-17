package model

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	mysqldriver "github.com/go-sql-driver/mysql"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// openMembershipFixtureDB creates a new database for each opt-in SQL test.
// It never drops a database or reuses the application's SQL_DSN/.env.
func openMembershipFixtureDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("MEMBERSHIP_TEST_DSN")
	if dsn == "" {
		db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
		require.NoError(t, err)
		return db
	}
	dialect := os.Getenv("MEMBERSHIP_TEST_DIALECT")
	name := fmt.Sprintf("membership_%d", time.Now().UnixNano())
	previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
	var db *gorm.DB
	var err error
	switch dialect {
	case "mysql":
		cfg, parseErr := mysqldriver.ParseDSN(dsn)
		require.NoError(t, parseErr)
		require.True(t, strings.HasPrefix(cfg.Addr, "127.0.0.1:"), "external membership tests require a loopback-only disposable instance")
		admin, openErr := gorm.Open(mysql.Open(dsn), &gorm.Config{})
		require.NoError(t, openErr)
		require.NoError(t, admin.Exec("CREATE DATABASE `"+name+"` CHARACTER SET utf8mb4").Error)
		connection, openErr := admin.DB()
		require.NoError(t, openErr)
		require.NoError(t, connection.Close())
		cfg.DBName = name
		db, err = gorm.Open(mysql.Open(cfg.FormatDSN()), &gorm.Config{})
		common.SetDatabaseTypes(common.DatabaseTypeMySQL, common.DatabaseTypeMySQL)
	case "postgres":
		require.Contains(t, dsn, "host=127.0.0.1 ")
		admin, openErr := gorm.Open(postgres.Open(dsn), &gorm.Config{})
		require.NoError(t, openErr)
		require.NoError(t, admin.Exec(`CREATE DATABASE "`+name+`"`).Error)
		connection, openErr := admin.DB()
		require.NoError(t, openErr)
		require.NoError(t, connection.Close())
		db, err = gorm.Open(postgres.Open(dsn+" dbname="+name), &gorm.Config{})
		common.SetDatabaseTypes(common.DatabaseTypePostgreSQL, common.DatabaseTypePostgreSQL)
	default:
		t.Fatalf("unsupported MEMBERSHIP_TEST_DIALECT %q", dialect)
	}
	require.NoError(t, err)
	InitCol()
	t.Cleanup(func() { common.SetDatabaseTypes(previousMain, previousLog); InitCol() })
	t.Logf("independent %s database retained: %s", dialect, name)
	return db
}

// membershipLegacySubscription models columns present before the meter discriminator was introduced.
type membershipLegacySubscription struct {
	Id          int
	UserId      int
	PlanId      int
	AmountTotal int64
	AmountUsed  int64
	StartTime   int64
	EndTime     int64
	Status      string
}

func (membershipLegacySubscription) TableName() string { return "user_subscriptions" }

func TestMembershipSQLLegacyMigrationPreservesData(t *testing.T) {
	if os.Getenv("MEMBERSHIP_TEST_DSN") == "" {
		t.Skip("independent MySQL/PostgreSQL fixture not supplied")
	}
	db := openMembershipFixtureDB(t)
	previousDB, previousLog := DB, LOG_DB
	DB, LOG_DB = db, db
	connection, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { DB, LOG_DB = previousDB, previousLog; _ = connection.Close() })
	require.NoError(t, db.AutoMigrate(&membershipLegacySubscription{}))
	legacy := membershipLegacySubscription{Id: 9901, UserId: 9902, PlanId: 9903, AmountTotal: 1000, AmountUsed: 100, StartTime: common.GetTimestamp() - 10, EndTime: common.GetTimestamp() + 3600, Status: "active"}
	require.NoError(t, db.Create(&legacy).Error)
	require.NoError(t, db.AutoMigrate(&UserSubscription{}, &SubscriptionPlan{}, &SubscriptionChannelQuota{}, &SubscriptionChannelRequest{}, &SubscriptionPreConsumeRecord{}))
	require.NoError(t, db.Create(&SubscriptionPlan{Id: legacy.PlanId, Title: "legacy", TotalAmount: 1000, DurationUnit: SubscriptionDurationDay, DurationValue: 1}).Error)
	var migrated UserSubscription
	require.NoError(t, db.First(&migrated, legacy.Id).Error)
	assert.Equal(t, SubscriptionMeterQuota, migrated.MeterType)
	assert.Equal(t, legacy.AmountTotal, migrated.AmountTotal)
	assert.Equal(t, legacy.AmountUsed, migrated.AmountUsed)
	result, err := PreConsumeUserSubscription("legacy-migration", legacy.UserId, "gpt-4o-mini", 0, 50)
	require.NoError(t, err)
	assert.EqualValues(t, 150, result.AmountUsedAfter)
	require.NoError(t, db.AutoMigrate(&UserSubscription{}, &SubscriptionPlan{}, &SubscriptionChannelQuota{}, &SubscriptionChannelRequest{}))
	require.NoError(t, db.First(&migrated, legacy.Id).Error)
	assert.EqualValues(t, 150, migrated.AmountUsed)
}

// membershipLegacyGrant represents the stage-one token grant before count columns were introduced.
type membershipLegacyGrant struct {
	Id                 int
	UserSubscriptionId int
	ChannelId          int
	Profile            string
	Unit               string
	Models             JSONValue `gorm:"type:text"`
	InputLimit         int64
	OutputLimit        int64
	InputUsed          int64
	OutputUsed         int64
	InputReserved      int64
	OutputReserved     int64
}

func (membershipLegacyGrant) TableName() string { return "subscription_channel_quota" }

func TestMembershipSQLCountColumnsPreserveExistingTokenGrants(t *testing.T) {
	if os.Getenv("MEMBERSHIP_TEST_DSN") == "" {
		t.Skip("independent SQL fixture not supplied")
	}
	db := openMembershipFixtureDB(t)
	previousDB, previousLog := DB, LOG_DB
	DB, LOG_DB = db, db
	connection, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { DB, LOG_DB = previousDB, previousLog; _ = connection.Close() })
	// Use the actual GORM table name rather than depending on a pluralization guess.
	statement := &gorm.Statement{DB: db}
	require.NoError(t, statement.Parse(&SubscriptionChannelQuota{}))
	require.NoError(t, db.Table(statement.Schema.Table).AutoMigrate(&membershipLegacyGrant{}))
	old := membershipLegacyGrant{Id: 9904, UserSubscriptionId: 9901, ChannelId: 9905, Profile: MembershipTextProfile, Unit: MembershipUnitTokens, Models: JSONValue(`["gpt-4o-mini"]`), InputLimit: 1000, OutputLimit: 500, InputUsed: 10, OutputUsed: 20}
	require.NoError(t, db.Table(statement.Schema.Table).Create(&old).Error)
	require.NoError(t, db.AutoMigrate(&UserSubscription{}, &SubscriptionChannelQuota{}, &SubscriptionChannelRequest{}))
	now := common.GetTimestamp()
	require.NoError(t, db.Create(&UserSubscription{Id: 9901, UserId: 9902, PlanId: 9903, MeterType: SubscriptionMeterChannel, Status: "active", StartTime: now - 10, EndTime: now + 3600}).Error)
	record := &SubscriptionChannelRequest{RequestId: "old-token-grant", UserId: 9902, UserSubscriptionId: 9901, ChannelId: 9905, Model: "gpt-4o-mini", InputReserved: 50, OutputReserved: 30}
	require.NoError(t, ReserveMembership(record))
	require.NoError(t, DispatchMembership(record.RequestId))
	require.NoError(t, FinishMembership(record.RequestId, 12, 15, "settled", "raw receipt"))
	var grant SubscriptionChannelQuota
	require.NoError(t, db.First(&grant, old.Id).Error)
	assert.EqualValues(t, 22, grant.InputUsed)
	assert.EqualValues(t, 35, grant.OutputUsed)
	assert.Zero(t, grant.QuantityUsed)
	assert.Zero(t, grant.QuantityReserved)
}
