package model

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 渠道列表默认排序契约：先按模型类别分组（语言→图片→视频，含视频模型的混合
// 渠道归入视频），同类内优先级降序，同优先级按 id 降序保证稳定顺序。
func TestChannelDefaultOrderGroupsByModelCategory(t *testing.T) {
	int64Ptr := func(v int64) *int64 { return &v }
	weight := uint(0)

	channels := []*Channel{
		{Name: "cat-video-low", Type: 1, Models: "doubao-seedance-2-0", Priority: int64Ptr(0), Weight: &weight, Status: 1},
		{Name: "cat-image-low", Type: 1, Models: "seedream-4-0", Priority: int64Ptr(0), Weight: &weight, Status: 1},
		{Name: "cat-text-low", Type: 1, Models: "gpt-4o", Priority: int64Ptr(0), Weight: &weight, Status: 1},
		{Name: "cat-text-high", Type: 1, Models: "claude-sonnet-4", Priority: int64Ptr(10), Weight: &weight, Status: 1},
		{Name: "cat-mixed-video", Type: 1, Models: "gpt-4o,kling-v2", Priority: int64Ptr(0), Weight: &weight, Status: 1},
	}
	for _, ch := range channels {
		require.NoError(t, DB.Create(ch).Error)
	}
	t.Cleanup(func() {
		DB.Where("name LIKE ?", "cat-%").Delete(&Channel{})
	})

	list, err := GetAllChannels(0, 0, true, false)
	require.NoError(t, err)

	order := make([]string, 0, len(channels))
	for _, ch := range list {
		if strings.HasPrefix(ch.Name, "cat-") {
			order = append(order, ch.Name)
		}
	}

	// 语言组在前（高优先级置顶），随后图片组，最后视频组；
	// 视频组内 cat-mixed-video 与 cat-video-low 同优先级，id 大的（后创建的）在前。
	assert.Equal(t, []string{
		"cat-text-high",
		"cat-text-low",
		"cat-image-low",
		"cat-mixed-video",
		"cat-video-low",
	}, order)
}

// 显式列排序与 id 排序不叠加类别分组，维持原有行为。
func TestChannelExplicitSortOverridesCategoryOrder(t *testing.T) {
	int64Ptr := func(v int64) *int64 { return &v }
	weight := uint(0)

	channels := []*Channel{
		{Name: "catx-video", Type: 1, Models: "seedance-pro", Priority: int64Ptr(1), Weight: &weight, Status: 1},
		{Name: "catx-text", Type: 1, Models: "gpt-4o-mini", Priority: int64Ptr(9), Weight: &weight, Status: 1},
	}
	for _, ch := range channels {
		require.NoError(t, DB.Create(ch).Error)
	}
	t.Cleanup(func() {
		DB.Where("name LIKE ?", "catx-%").Delete(&Channel{})
	})

	list, err := GetAllChannels(0, 0, true, false, NewChannelSortOptions("priority", "desc", false))
	require.NoError(t, err)

	names := make([]string, 0, 2)
	for _, ch := range list {
		if strings.HasPrefix(ch.Name, "catx-") {
			names = append(names, ch.Name)
		}
	}
	// 显式按 priority 降序：语言渠道（priority=9）排在视频渠道（priority=1）之前，不叠加类别分组。
	assert.Equal(t, []string{"catx-text", "catx-video"}, names)
}
