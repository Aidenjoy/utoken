package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestFilterChannelsByResolution 覆盖按 (渠道 × 模型 × 分辨率) 三维能力过滤候选渠道：
// 空分辨率不过滤、大小写/空格不敏感、未收录渠道向后兼容全支持。
func TestFilterChannelsByResolution(t *testing.T) {
	saved := channel2resolutionBlacklist
	t.Cleanup(func() { channel2resolutionBlacklist = saved })

	channel2resolutionBlacklist = map[int]map[string][]string{
		1: {"m2": {"4k"}}, // A：模型 m2 不支持 4k
		2: {"m1": {"4k"}}, // B：模型 m1 不支持 4k
		// 3 (C) 未收录 → 视为全部分辨率都支持
	}

	// 未指定分辨率（走上游默认档）不过滤。
	assert.Equal(t, []int{1, 2, 3}, filterChannelsByResolution([]int{1, 2, 3}, "m1", ""))

	// m1@4k → 剔除 B(2)，保留 {A, C}。
	assert.Equal(t, []int{1, 3}, filterChannelsByResolution([]int{1, 2, 3}, "m1", "4k"))

	// m2@4k（大写）→ 剔除 A(1)，保留 {B, C}。
	assert.Equal(t, []int{2, 3}, filterChannelsByResolution([]int{1, 2, 3}, "m2", "4K"))

	// m1@720p 不在任何黑名单中 → 无剔除。
	assert.Equal(t, []int{1, 2, 3}, filterChannelsByResolution([]int{1, 2, 3}, "m1", "720p"))

	assert.Empty(t, filterChannelsByResolution(nil, "m1", "4k"))
}

// TestGetRandomSatisfiedChannelByResolution 验证选路阶段的分辨率过滤落到最终选渠道：
// 做不了请求分辨率的渠道永远不会被选中，而支持的渠道都仍可达。
func TestGetRandomSatisfiedChannelByResolution(t *testing.T) {
	savedCache := common.MemoryCacheEnabled
	savedG2m := group2model2channels
	savedIdm := channelsIDM
	savedBl := channel2resolutionBlacklist
	t.Cleanup(func() {
		common.MemoryCacheEnabled = savedCache
		group2model2channels = savedG2m
		channelsIDM = savedIdm
		channel2resolutionBlacklist = savedBl
	})

	common.MemoryCacheEnabled = true
	channelsIDM = map[int]*Channel{
		1: {Id: 1}, // A
		2: {Id: 2}, // B
		3: {Id: 3}, // C
	}
	group2model2channels = map[string]map[string][]int{
		"default": {
			"m1": {1, 2, 3},
			"m2": {1, 2, 3},
		},
	}
	channel2resolutionBlacklist = map[int]map[string][]string{
		1: {"m2": {"4k"}},
		2: {"m1": {"4k"}},
	}

	// 请求 m1@4k：候选 {A=1, C=3}，绝不会命中被过滤的 B=2。
	for i := 0; i < 60; i++ {
		ch, err := GetRandomSatisfiedChannel("default", "m1", 0, "", "4k")
		require.NoError(t, err)
		require.NotNil(t, ch)
		assert.Contains(t, []int{1, 3}, ch.Id)
	}

	// 请求 m2@4k：候选 {B=2, C=3}，绝不会命中被过滤的 A=1。
	for i := 0; i < 60; i++ {
		ch, err := GetRandomSatisfiedChannel("default", "m2", 0, "", "4k")
		require.NoError(t, err)
		require.NotNil(t, ch)
		assert.Contains(t, []int{2, 3}, ch.Id)
	}

	// 未指定分辨率：三个渠道都应可达（加权随机，采样足够次数后全部命中）。
	seen := map[int]bool{}
	for i := 0; i < 200; i++ {
		ch, err := GetRandomSatisfiedChannel("default", "m1", 0, "", "")
		require.NoError(t, err)
		require.NotNil(t, ch)
		seen[ch.Id] = true
	}
	assert.True(t, seen[1] && seen[2] && seen[3], "expected all three channels reachable without resolution filter")

	// m1@4k 若某渠道被过滤到只剩候选为空之外的场景：全部渠道都不支持时应返回 nil。
	channel2resolutionBlacklist = map[int]map[string][]string{
		1: {"m1": {"4k"}},
		2: {"m1": {"4k"}},
		3: {"m1": {"4k"}},
	}
	ch, err := GetRandomSatisfiedChannel("default", "m1", 0, "", "4k")
	require.NoError(t, err)
	assert.Nil(t, ch, "no channel supports the required resolution")
}
