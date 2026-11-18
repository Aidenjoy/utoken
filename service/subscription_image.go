package service

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

// PrepareMembershipImages reserves the final requested image count, never synthetic token usage.
func PrepareMembershipImages(c *gin.Context, info *relaycommon.RelayInfo, body []byte) (*MembershipSession, error) {
	var req dto.ImageRequest
	if err := common.Unmarshal(body, &req); err != nil {
		return nil, err
	}
	if !model.MembershipImageModelSupported(req.Model) || req.Model != info.UpstreamModelName || req.N == nil || *req.N == 0 || *req.N > dto.MaxImageN || (req.Stream != nil && *req.Stream) || len(req.Extra) > 0 || len(req.ExtraFields) > 0 || len(req.Image) > 0 || len(req.Images) > 0 || len(req.Mask) > 0 {
		return nil, errors.New("membership image count profile requires bounded non-streaming DALL-E generations")
	}
	if req.Model == "dall-e-2" && *req.N > 10 {
		return nil, errors.New("DALL-E 2 supports at most ten images per request")
	}
	if req.Model == "dall-e-3" && *req.N != 1 {
		return nil, errors.New("DALL-E 3 supports one image per request")
	}
	session := &MembershipSession{Request: model.SubscriptionChannelRequest{
		RequestId: common.GetUUID(), UserId: info.UserId, TokenId: info.TokenId,
		UserSubscriptionId: c.GetInt("membership_subscription_id"), ChannelId: info.ChannelId,
		Model: info.OriginModelName, QuantityReserved: int64(*req.N),
	}}
	if err := model.ReserveMembership(&session.Request); err != nil {
		return nil, err
	}
	c.Set("membership_session", session)
	return session, nil
}

// ObserveMembershipImages counts delivered image entries directly from the provider response.
// Empty/invalid responses stay pending; missing tokens are never replaced with a billable placeholder.
func ObserveMembershipImages(c *gin.Context, body []byte) {
	value, ok := c.Get("membership_session")
	session, valid := value.(*MembershipSession)
	if !ok || !valid || session.SeedreamImage || session.Request.Unit != model.MembershipUnitImages {
		return
	}
	var response dto.ImageResponse
	if common.Unmarshal(body, &response) != nil || len(response.Data) == 0 {
		session.InvalidUsage = true
		return
	}
	for _, image := range response.Data {
		if image.Url == "" && image.B64Json == "" {
			session.InvalidUsage = true
			return
		}
	}
	session.Quantity = int64(len(response.Data))
	session.HasUsage = true
	session.UsageReceipt, _ = common.Marshal(struct {
		ReturnedImages int64 `json:"returned_images"`
	}{ReturnedImages: session.Quantity})
}
