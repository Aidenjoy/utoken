package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 回归：阿里百炼渠道的 wan/qwq/qvq 等模型必须映射到阿里巴巴供应商，
// 否则模型广场供应商列表缺失该供应商、价格页供应商列显示 "-"。
func TestInitDefaultVendorMapping(t *testing.T) {
	const aliVendorID = 7
	const openAIVendorID = 9

	tests := []struct {
		name           string
		modelName      string
		existingMeta   *Model
		expectedVendor int
	}{
		{
			name:           "wan video model without meta",
			modelName:      "wan2.5-t2v-preview",
			expectedVendor: aliVendorID,
		},
		{
			name:           "wanx image model without meta",
			modelName:      "wanx2.1-t2i-turbo",
			expectedVendor: aliVendorID,
		},
		{
			name:           "qwq reasoning model without meta",
			modelName:      "qwq-plus",
			expectedVendor: aliVendorID,
		},
		{
			name:           "existing meta without vendor gets backfilled",
			modelName:      "wan2.2-t2v-plus",
			existingMeta:   &Model{ModelName: "wan2.2-t2v-plus", VendorID: 0, Status: 1},
			expectedVendor: aliVendorID,
		},
		{
			name:           "existing meta with vendor is preserved",
			modelName:      "wan2.2-t2v-plus",
			existingMeta:   &Model{ModelName: "wan2.2-t2v-plus", VendorID: openAIVendorID, Status: 1},
			expectedVendor: openAIVendorID,
		},
		{
			name:           "qwen still maps to ali vendor",
			modelName:      "qwen-max",
			expectedVendor: aliVendorID,
		},
		{
			name:           "unknown model keeps zero vendor",
			modelName:      "some-unknown-model",
			expectedVendor: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vendorMap := map[int]*Vendor{
				aliVendorID:    {Id: aliVendorID, Name: "阿里巴巴", Status: 1},
				openAIVendorID: {Id: openAIVendorID, Name: "OpenAI", Status: 1},
			}
			metaMap := make(map[string]*Model)
			if tt.existingMeta != nil {
				metaMap[tt.modelName] = tt.existingMeta
			}
			abilities := []AbilityWithChannel{
				{Ability: Ability{Model: tt.modelName}},
			}

			initDefaultVendorMapping(metaMap, vendorMap, abilities)

			meta, ok := metaMap[tt.modelName]
			require.True(t, ok)
			assert.Equal(t, tt.expectedVendor, meta.VendorID)
		})
	}
}

// 前缀/包含规则的元数据指针会被多个模型共享，补齐供应商时不得污染共享指针。
func TestInitDefaultVendorMappingSharedMetaNotMutated(t *testing.T) {
	const aliVendorID = 7
	vendorMap := map[int]*Vendor{
		aliVendorID: {Id: aliVendorID, Name: "阿里巴巴", Status: 1},
	}
	shared := &Model{ModelName: "wan", NameRule: NameRulePrefix, VendorID: 0, Status: 1}
	metaMap := map[string]*Model{
		"wan2.2-t2v-plus":    shared,
		"wan2.5-t2v-preview": shared,
	}
	abilities := []AbilityWithChannel{
		{Ability: Ability{Model: "wan2.2-t2v-plus"}},
		{Ability: Ability{Model: "wan2.5-t2v-preview"}},
	}

	initDefaultVendorMapping(metaMap, vendorMap, abilities)

	assert.Equal(t, aliVendorID, metaMap["wan2.2-t2v-plus"].VendorID)
	assert.Equal(t, aliVendorID, metaMap["wan2.5-t2v-preview"].VendorID)
	assert.Equal(t, 0, shared.VendorID)
}
