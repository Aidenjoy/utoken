package service

import (
	"net/http/httptest"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// TestMembershipRealtimeRejectsLegacyAccounting protects both real-time billing
// boundaries without a wallet database or usable upstream session.
func TestMembershipRealtimeRejectsLegacyAccounting(t *testing.T) {
	for _, usePrice := range []bool{false, true} {
		t.Run(map[bool]string{false: "token_pricing", true: "fixed_pricing"}[usePrice], func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Set("membership_subscription_id", 123)
			info := &relaycommon.RelayInfo{UsePrice: usePrice}
			require.ErrorContains(t, PreWssConsumeQuota(ctx, info, nil), "wallet fallback is forbidden")
			require.NotPanics(t, func() { PostWssConsumeQuota(ctx, info, "unsupported", nil, "") })
		})
	}
}
