package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMembershipRealtimeReceiptsAreIdempotent protects real usage accounting
// independently of websocket framing and never invokes a provider or wallet.
func TestMembershipRealtimeReceiptsAreIdempotent(t *testing.T) {
	budget := &MembershipRealtimeBudget{Session: &MembershipSession{Request: model.SubscriptionChannelRequest{InputReserved: 10000, OutputReserved: 512}}, TurnInput: 5000, TurnOutput: 256, InFlight: true, Seen: make(map[string]membershipRealtimeReceipt)}
	receipt := []byte(`{"type":"response.done","response":{"id":"a","status":"completed","usage":{"input_tokens":10,"output_tokens":4,"total_tokens":14}}}`)
	require.NoError(t, budget.ObserveProvider(receipt))
	require.NoError(t, budget.ObserveProvider(receipt))
	assert.EqualValues(t, 10, budget.Session.Input)
	assert.EqualValues(t, 4, budget.Session.Output)
	assert.Len(t, budget.Receipts, 1)
	require.Error(t, budget.ObserveProvider([]byte(`{"type":"response.done","response":{"id":"a","status":"completed","usage":{"input_tokens":11,"output_tokens":4,"total_tokens":15}}}`)))
	_, err := budget.ForwardClient([]byte(`{"type":"session.update","session":{"turn_detection":{"type":"server_vad"}}}`))
	require.Error(t, err)
	_, err = budget.ForwardClient([]byte(`{"type":"conversation.item.create","item":{"type":"message","role":"system","content":[{"type":"input_text","text":"cannot override instructions"}]}}`))
	require.Error(t, err)
}
