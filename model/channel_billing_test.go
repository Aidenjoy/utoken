package model

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// channelBillingDay mirrors the Go-side day bucket used by
// GetChannelBillingRecords so tests compute expected dates the same way
// (absolute-time truncation to UTC midnight, timezone independent).
func channelBillingDay(ts int64) int64 {
	return time.Unix(ts, 0).Truncate(24 * time.Hour).Unix()
}

func seedChannelBillingLog(t *testing.T, log *Log) {
	t.Helper()
	require.NoError(t, DB.Create(log).Error)
}

func seedChannelBillingChannel(t *testing.T, id int, name string) {
	t.Helper()
	require.NoError(t, DB.Create(&Channel{Id: id, Name: name}).Error)
}

// findChannelBillingRecord locates the aggregated row for a channel+model.
func findChannelBillingRecord(
	records []ChannelBillingRecord,
	channelId int,
	modelName string,
) *ChannelBillingRecord {
	for i := range records {
		if records[i].ChannelId == channelId && records[i].ModelName == modelName {
			return &records[i]
		}
	}
	return nil
}

// TestLogUpstreamTokenUsage locks the reconciliation read口径:
// settle rows count 0 (their usage lives on the pre-consume backfill row),
// other rows prefer the upstream column and fall back to billed tokens when
// upstream is 0 (legacy / unscaled links).
func TestLogUpstreamTokenUsage(t *testing.T) {
	tests := []struct {
		name           string
		log            Log
		wantPrompt     int
		wantCompletion int
	}{
		{
			name:           "settle row counts zero",
			log:            Log{TaskSettle: true, PromptTokens: 500, CompletionTokens: 500, UpstreamPromptTokens: 500, UpstreamCompletionTokens: 500},
			wantPrompt:     0,
			wantCompletion: 0,
		},
		{
			name:           "upstream zero falls back to billed tokens",
			log:            Log{PromptTokens: 120, CompletionTokens: 60},
			wantPrompt:     120,
			wantCompletion: 60,
		},
		{
			name:           "upstream non-zero wins over billed tokens",
			log:            Log{PromptTokens: 200, CompletionTokens: 80, UpstreamPromptTokens: 180, UpstreamCompletionTokens: 70},
			wantPrompt:     180,
			wantCompletion: 70,
		},
		{
			name:           "partial upstream mixes per column",
			log:            Log{PromptTokens: 100, CompletionTokens: 50, UpstreamCompletionTokens: 40},
			wantPrompt:     100,
			wantCompletion: 40,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			log := tt.log
			prompt, completion := log.UpstreamTokenUsage()
			assert.Equal(t, tt.wantPrompt, prompt)
			assert.Equal(t, tt.wantCompletion, completion)
		})
	}
}

// TestGetChannelBillingRecordsUpstreamFallback covers the core reconciliation
// contract: aggregated tokens use the real upstream value, falling back to the
// billed columns when upstream is 0, and rows on the same day/channel/model
// merge into one record.
func TestGetChannelBillingRecordsUpstreamFallback(t *testing.T) {
	truncateTables(t)
	seedChannelBillingChannel(t, 1, "east")

	base := int64(1700000000)
	// Row A: no upstream recorded -> falls back to billed 100/50.
	seedChannelBillingLog(t, &Log{
		Type: LogTypeConsume, ChannelId: 1, ModelName: "gpt-a",
		CreatedAt: base, PromptTokens: 100, CompletionTokens: 50,
	})
	// Row B: upstream recorded (rate-scaled link) -> uses 180/70, not 200/80.
	seedChannelBillingLog(t, &Log{
		Type: LogTypeConsume, ChannelId: 1, ModelName: "gpt-a",
		CreatedAt: base + 3600, PromptTokens: 200, CompletionTokens: 80,
		UpstreamPromptTokens: 180, UpstreamCompletionTokens: 70,
	})

	records, stat, err := GetChannelBillingRecords(ChannelBillingFilter{})
	require.NoError(t, err)
	require.Len(t, records, 1)

	record := records[0]
	assert.Equal(t, channelBillingDay(base), record.Date)
	assert.Equal(t, int64(2), record.RequestCount)
	assert.Equal(t, int64(280), record.PromptTokens)     // 100 + 180
	assert.Equal(t, int64(120), record.CompletionTokens) // 50 + 70
	assert.Equal(t, int64(400), record.TotalTokens)
	assert.False(t, record.PriceConfigured)

	assert.Equal(t, int64(2), stat.RequestCount)
	assert.Equal(t, int64(280), stat.PromptTokens)
	assert.Equal(t, int64(400), stat.TotalTokens)
	assert.Equal(t, 1, stat.ChannelCount)
	assert.Equal(t, int64(1), stat.UnpricedRecordCnt)
}

// TestGetChannelBillingRecordsExclusions locks which rows count toward
// reconciliation: cache-hit replays never hit upstream and are dropped from
// both views; settle rows and refunds are excluded from the aggregate (to avoid
// double-counting a task) but stay visible in the detail/audit view.
func TestGetChannelBillingRecordsExclusions(t *testing.T) {
	truncateTables(t)
	seedChannelBillingChannel(t, 1, "east")

	base := int64(1700000000)
	// Counted: ordinary consume.
	seedChannelBillingLog(t, &Log{
		Type: LogTypeConsume, ChannelId: 1, ModelName: "gpt-a",
		CreatedAt: base, PromptTokens: 100, CompletionTokens: 50,
	})
	// Excluded everywhere: cache-hit replay (no upstream call, quota 0).
	seedChannelBillingLog(t, &Log{
		Type: LogTypeConsume, ChannelId: 1, ModelName: "gpt-a",
		CreatedAt: base + 10, PromptTokens: 999, CompletionTokens: 999, CacheHit: true,
	})
	// Excluded from aggregate, present in details: task settle row.
	seedChannelBillingLog(t, &Log{
		Type: LogTypeConsume, ChannelId: 1, ModelName: "gpt-a",
		CreatedAt: base + 20, PromptTokens: 500, CompletionTokens: 500, TaskSettle: true,
	})
	// Excluded from aggregate, present in details: full refund.
	seedChannelBillingLog(t, &Log{
		Type: LogTypeRefund, ChannelId: 1, ModelName: "gpt-a",
		CreatedAt: base + 30, PromptTokens: 100, CompletionTokens: 50,
	})

	records, stat, err := GetChannelBillingRecords(ChannelBillingFilter{})
	require.NoError(t, err)
	require.Len(t, records, 1)
	assert.Equal(t, int64(1), records[0].RequestCount)
	assert.Equal(t, int64(100), records[0].PromptTokens)
	assert.Equal(t, int64(50), records[0].CompletionTokens)
	assert.Equal(t, int64(1), stat.RequestCount)

	pageInfo := &common.PageInfo{Page: 1, PageSize: 50}
	logs, total, err := GetChannelBillingDetails(ChannelBillingFilter{}, pageInfo)
	require.NoError(t, err)
	// Details = consume(normal) + consume(settle) + refund; cache-hit dropped.
	assert.Equal(t, int64(3), total)
	require.Len(t, logs, 3)
	for _, log := range logs {
		assert.False(t, log.CacheHit, "cache-hit rows must never appear in details")
		assert.Equal(t, "east", log.ChannelName)
	}
}

// TestGetChannelBillingRecordsDayBucketing verifies the Go-side day bucketing:
// rows on different UTC days split into separate records, same-day rows merge.
func TestGetChannelBillingRecordsDayBucketing(t *testing.T) {
	truncateTables(t)
	seedChannelBillingChannel(t, 1, "east")

	base := int64(1700000000) // 2023-11-14 22:13:20 UTC
	seedChannelBillingLog(t, &Log{
		Type: LogTypeConsume, ChannelId: 1, ModelName: "gpt-a",
		CreatedAt: base, PromptTokens: 10, CompletionTokens: 5,
	})
	seedChannelBillingLog(t, &Log{
		Type: LogTypeConsume, ChannelId: 1, ModelName: "gpt-a",
		CreatedAt: base + 3600, PromptTokens: 20, CompletionTokens: 5, // same UTC day
	})
	seedChannelBillingLog(t, &Log{
		Type: LogTypeConsume, ChannelId: 1, ModelName: "gpt-a",
		CreatedAt: base + 86400, PromptTokens: 30, CompletionTokens: 5, // next UTC day
	})

	records, _, err := GetChannelBillingRecords(ChannelBillingFilter{})
	require.NoError(t, err)
	require.Len(t, records, 2)

	// Sorted date-descending: newest day first.
	assert.Equal(t, channelBillingDay(base+86400), records[0].Date)
	assert.Equal(t, int64(1), records[0].RequestCount)
	assert.Equal(t, int64(30), records[0].PromptTokens)

	assert.Equal(t, channelBillingDay(base), records[1].Date)
	assert.Equal(t, int64(2), records[1].RequestCount)
	assert.Equal(t, int64(30), records[1].PromptTokens) // 10 + 20 merged
}

// TestGetChannelBillingRecordsCostEstimation covers the optional rate card:
// a priced channel/model computes estimated cost from real tokens, an unpriced
// one stays at 0 with PriceConfigured=false (never silently counted as $0).
func TestGetChannelBillingRecordsCostEstimation(t *testing.T) {
	truncateTables(t)
	seedChannelBillingChannel(t, 1, "east")
	seedChannelBillingChannel(t, 2, "west")
	require.NoError(t, SaveChannelUpstreamPrices(1, ChannelUpstreamPrices{
		"gpt-a": {Input: 3, Output: 15}, // USD per 1M tokens
	}))

	base := int64(1700000000)
	// Priced channel: 1M input + 1M output -> 1*3 + 1*15 = 18 USD.
	seedChannelBillingLog(t, &Log{
		Type: LogTypeConsume, ChannelId: 1, ModelName: "gpt-a",
		CreatedAt: base, PromptTokens: 1_000_000, CompletionTokens: 1_000_000,
	})
	// Unpriced channel: no rate card, cost unknown.
	seedChannelBillingLog(t, &Log{
		Type: LogTypeConsume, ChannelId: 2, ModelName: "gpt-a",
		CreatedAt: base, PromptTokens: 1000, CompletionTokens: 1000,
	})

	records, stat, err := GetChannelBillingRecords(ChannelBillingFilter{})
	require.NoError(t, err)
	require.Len(t, records, 2)

	priced := findChannelBillingRecord(records, 1, "gpt-a")
	require.NotNil(t, priced)
	assert.True(t, priced.PriceConfigured)
	wantCost := common.QuotaFromFloat((1.0*3 + 1.0*15) * common.QuotaPerUnit)
	assert.Equal(t, wantCost, priced.EstimatedCostQuota)

	unpriced := findChannelBillingRecord(records, 2, "gpt-a")
	require.NotNil(t, unpriced)
	assert.False(t, unpriced.PriceConfigured)
	assert.Equal(t, 0, unpriced.EstimatedCostQuota)

	assert.Equal(t, 2, stat.ChannelCount)
	assert.Equal(t, 1, stat.PricedChannelCnt)
	assert.Equal(t, int64(1), stat.UnpricedRecordCnt)
	assert.Equal(t, int64(wantCost), stat.EstimatedCost)
}

// TestGetChannelBillingRecordsFilters verifies the channel-id and exact-model
// filters narrow the aggregate as expected.
func TestGetChannelBillingRecordsFilters(t *testing.T) {
	truncateTables(t)
	seedChannelBillingChannel(t, 1, "east")
	seedChannelBillingChannel(t, 2, "west")

	base := int64(1700000000)
	seedChannelBillingLog(t, &Log{Type: LogTypeConsume, ChannelId: 1, ModelName: "gpt-a", CreatedAt: base, PromptTokens: 10, CompletionTokens: 5})
	seedChannelBillingLog(t, &Log{Type: LogTypeConsume, ChannelId: 1, ModelName: "gpt-b", CreatedAt: base, PromptTokens: 20, CompletionTokens: 5})
	seedChannelBillingLog(t, &Log{Type: LogTypeConsume, ChannelId: 2, ModelName: "gpt-a", CreatedAt: base, PromptTokens: 30, CompletionTokens: 5})

	byChannel, _, err := GetChannelBillingRecords(ChannelBillingFilter{ChannelIds: []int{2}})
	require.NoError(t, err)
	require.Len(t, byChannel, 1)
	assert.Equal(t, 2, byChannel[0].ChannelId)

	byModel, _, err := GetChannelBillingRecords(ChannelBillingFilter{ModelName: "gpt-b"})
	require.NoError(t, err)
	require.Len(t, byModel, 1)
	assert.Equal(t, "gpt-b", byModel[0].ModelName)
	assert.Equal(t, 1, byModel[0].ChannelId)
}

// TestChannelUpstreamPricesRoundTrip covers the rate-card persistence: values
// survive a save/read cycle and an empty save clears the card back to nil
// (pure-token reconciliation).
func TestChannelUpstreamPricesRoundTrip(t *testing.T) {
	truncateTables(t)
	seedChannelBillingChannel(t, 1, "east")

	// Unconfigured channel reads back nil.
	initial, err := GetChannelUpstreamPricesRaw(1)
	require.NoError(t, err)
	assert.Nil(t, initial)

	prices := ChannelUpstreamPrices{
		"gpt-a": {Input: 3, Output: 15},
		"gpt-b": {Input: 0.5, Output: 1.5},
	}
	require.NoError(t, SaveChannelUpstreamPrices(1, prices))

	got, err := GetChannelUpstreamPricesRaw(1)
	require.NoError(t, err)
	assert.Equal(t, prices, got)

	// Empty save clears the card.
	require.NoError(t, SaveChannelUpstreamPrices(1, nil))
	cleared, err := GetChannelUpstreamPricesRaw(1)
	require.NoError(t, err)
	assert.Nil(t, cleared)
}

// TestMaskedJSONHidesUpstreamPrices guards the platform-confidential contract:
// marshalling a Channel must blank upstream_prices so neither the admin channel
// list nor the cache sync ever leaks the contract rate card.
func TestMaskedJSONHidesUpstreamPrices(t *testing.T) {
	channel := Channel{
		Id:             1,
		Name:           "east",
		UpstreamPrices: MaskedJSON(`{"gpt-a":{"input":3,"output":15}}`),
	}
	data, err := json.Marshal(channel)
	require.NoError(t, err)
	assert.Contains(t, string(data), `"upstream_prices":""`)
	assert.NotContains(t, string(data), `"input":3`)
	assert.NotContains(t, string(data), `"output":15`)
}
