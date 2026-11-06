package service

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	videoRouteModel20 = "doubao-seedance-2-0"
	videoRouteModel25 = "doubao-seedance-2-5"
)

type videoRouteChannelFixture struct {
	id         int
	modelName  string
	group      string
	discount   *float64
	supports4K bool
	status     int
	noProtocol bool
	noAbility  bool
	noMapping  bool
}

func videoRouteDiscount(value float64) *float64 {
	return &value
}

func setupVideoRouteTest(t *testing.T) {
	t.Helper()
	model.InitCol()
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Channel{}, &model.Ability{}, &model.Agent{}, &model.Token{}))

	oldMemoryCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		common.MemoryCacheEnabled = oldMemoryCache
	})

	tables := []string{"abilities", "agents", "tokens", "channels", "users"}
	for _, table := range tables {
		require.NoError(t, model.DB.Exec("DELETE FROM "+table).Error)
	}
	t.Cleanup(func() {
		for _, table := range tables {
			_ = model.DB.Exec("DELETE FROM " + table).Error
		}
	})
}

func seedVideoRouteUser(t *testing.T, id int, group string, agentID int) {
	t.Helper()
	if group == "" {
		group = "default"
	}
	user := &model.User{
		Id:       id,
		Username: fmt.Sprintf("video-route-user-%d", id),
		Role:     common.RoleCommonUser,
		Status:   common.UserStatusEnabled,
		Group:    group,
		AgentId:  agentID,
	}
	require.NoError(t, model.DB.Create(user).Error)
}

func seedVideoRouteChannel(t *testing.T, fixture videoRouteChannelFixture) {
	t.Helper()
	if fixture.group == "" {
		fixture.group = "default"
	}
	if fixture.status == 0 {
		fixture.status = common.ChannelStatusEnabled
	}

	mapping := map[string]string{}
	if !fixture.noMapping {
		mapping[fixture.modelName] = fixture.modelName + "-upstream"
	}
	mappingJSON, err := common.Marshal(mapping)
	require.NoError(t, err)
	settingJSON, err := common.Marshal(dto.ChannelSettings{
		ModelRouteConfigs: map[string]dto.ChannelModelRouteConfig{
			fixture.modelName: {
				Discount:   fixture.discount,
				Supports4K: fixture.supports4K,
			},
		},
	})
	require.NoError(t, err)
	protocol := dto.AssetUploadProtocolRelay
	if fixture.noProtocol {
		protocol = dto.AssetUploadProtocolNone
	}
	otherSettingsJSON, err := common.Marshal(dto.ChannelOtherSettings{AssetUploadProtocol: protocol})
	require.NoError(t, err)

	channel := &model.Channel{
		Id:            fixture.id,
		Name:          fmt.Sprintf("video-route-channel-%d", fixture.id),
		Key:           "sk-video-route-test",
		Status:        fixture.status,
		Group:         fixture.group,
		Models:        fixture.modelName,
		ModelMapping:  common.GetPointer(string(mappingJSON)),
		Setting:       common.GetPointer(string(settingJSON)),
		OtherSettings: string(otherSettingsJSON),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	if !fixture.noAbility {
		require.NoError(t, model.DB.Create(&model.Ability{
			Group:     fixture.group,
			Model:     fixture.modelName,
			ChannelId: fixture.id,
			Enabled:   true,
		}).Error)
	}
}

func TestMatchVideoKeyChannelSelectsLowestDiscountAndFiltersCandidates(t *testing.T) {
	setupVideoRouteTest(t)
	seedVideoRouteUser(t, 1, "default", 0)

	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 1, modelName: videoRouteModel20, discount: videoRouteDiscount(8)})
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 2, modelName: videoRouteModel20, discount: videoRouteDiscount(9), supports4K: true})
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 3, modelName: videoRouteModel25, discount: videoRouteDiscount(9), supports4K: true})
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 4, modelName: videoRouteModel25, discount: videoRouteDiscount(8)})

	// 以下渠道若未被排除，都会以更低折扣改变匹配结果。
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 5, modelName: videoRouteModel20, discount: videoRouteDiscount(1), status: common.ChannelStatusManuallyDisabled})
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 6, modelName: videoRouteModel20, discount: videoRouteDiscount(1), noProtocol: true})
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 7, modelName: videoRouteModel20, discount: videoRouteDiscount(1), noAbility: true})
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 8, modelName: videoRouteModel20})
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 9, modelName: videoRouteModel20, discount: videoRouteDiscount(1), noMapping: true})

	tests := []struct {
		name      string
		modelName string
		video4K   bool
		wantID    int
	}{
		{name: "2.0 standard selects eight discount", modelName: videoRouteModel20, wantID: 1},
		{name: "2.0 4k selects capable channel", modelName: videoRouteModel20, video4K: true, wantID: 2},
		{name: "2.5 standard uses its own discount", modelName: videoRouteModel25, wantID: 4},
		{name: "2.5 4k uses its own capable channel", modelName: videoRouteModel25, video4K: true, wantID: 3},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			channel, err := MatchVideoKeyChannel(1, "default", tt.modelName, tt.video4K)
			require.NoError(t, err)
			assert.Equal(t, tt.wantID, channel.Id)
		})
	}

	options, err := ListVideoKeyOptions(1, "default")
	require.NoError(t, err)
	assert.Equal(t, []VideoKeyOption{
		{Model: videoRouteModel20, Supports4K: true},
		{Model: videoRouteModel25, Supports4K: true},
	}, options)

	_, err = MatchVideoKeyChannel(1, "default", "doubao-seedance-3-0", false)
	assert.ErrorIs(t, err, ErrNoVideoKeyChannel)
}

func TestMatchVideoKeyChannelBreaksDiscountTieByChannelID(t *testing.T) {
	setupVideoRouteTest(t)
	seedVideoRouteUser(t, 1, "default", 0)
	modelName := "doubao-seedance-tie"
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 22, modelName: modelName, discount: videoRouteDiscount(7)})
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 11, modelName: modelName, discount: videoRouteDiscount(7)})

	channel, err := MatchVideoKeyChannel(1, "default", modelName, false)
	require.NoError(t, err)
	assert.Equal(t, 11, channel.Id)
}

func TestMatchVideoKeyChannelUsesTargetUserAgentAndAutoGroups(t *testing.T) {
	setupVideoRouteTest(t)
	oldAutoGroups := setting.AutoGroups2JsonString()
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["default","vip"]`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(oldAutoGroups))
	})

	require.NoError(t, model.DB.Create(&model.Agent{
		Id:             1,
		UserId:         99,
		ModelDiscounts: `{"doubao-seedance-2-0":0.8}`,
		Status:         model.AgentStatusEnabled,
	}).Error)
	seedVideoRouteUser(t, 1, "vip", 1)
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 1, modelName: videoRouteModel20, discount: videoRouteDiscount(9)})
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 2, modelName: videoRouteModel20, group: "vip", discount: videoRouteDiscount(8)})
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 3, modelName: videoRouteModel25, group: "vip", discount: videoRouteDiscount(1)})

	channel, err := MatchVideoKeyChannel(1, "auto", videoRouteModel20, false)
	require.NoError(t, err)
	assert.Equal(t, 2, channel.Id)

	_, err = MatchVideoKeyChannel(1, "auto", videoRouteModel25, false)
	assert.ErrorIs(t, err, ErrNoVideoKeyChannel)
}

func TestValidateVideoTokenChannelIgnoresDiscountButChecksCapability(t *testing.T) {
	setupVideoRouteTest(t)
	seedVideoRouteUser(t, 1, "default", 0)
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 1, modelName: videoRouteModel20, supports4K: true})
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 2, modelName: videoRouteModel20})
	seedVideoRouteChannel(t, videoRouteChannelFixture{id: 3, modelName: videoRouteModel20, supports4K: true, noMapping: true})

	token := &model.Token{
		UserId:     1,
		Group:      "default",
		KeyType:    model.TokenKeyTypeVideo,
		VideoModel: videoRouteModel20,
		Video4K:    true,
	}

	// 空折扣不参与自动匹配，但能力与协议合法时允许管理员手动改派。
	_, err := MatchVideoKeyChannel(1, "default", videoRouteModel20, true)
	assert.ErrorIs(t, err, ErrNoVideoKeyChannel)
	assert.NoError(t, ValidateVideoTokenChannel(token, 1))
	assert.Error(t, ValidateVideoTokenChannel(token, 2))
	assert.Error(t, ValidateVideoTokenChannel(token, 3))
}
