package relay

import (
	"fmt"
	"net/url"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

func WssHelper(c *gin.Context, info *relaycommon.RelayInfo) (newAPIError *types.NewAPIError) {
	info.InitChannelMeta(c)

	adaptor := GetAdaptor(info.ApiType)
	if adaptor == nil {
		return types.NewError(fmt.Errorf("invalid api type: %d", info.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
	}
	adaptor.Init(info)
	//var requestBody io.Reader
	//firstWssRequest, _ := c.Get("first_wss_request")
	//requestBody = bytes.NewBuffer(firstWssRequest.([]byte))

	var memberBudget *service.MembershipRealtimeBudget
	if c.GetInt("membership_subscription_id") > 0 {
		if err := helper.ModelMappedHelper(c, info, nil); err != nil {
			return types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
		}
		var err error
		memberBudget, err = service.PrepareMembershipRealtime(c, info)
		if err != nil {
			return types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
		}
		defer func() { service.FinishMembershipRequest(c, info, memberBudget.Session, newAPIError == nil) }()
		if err := model.DispatchMembership(memberBudget.Session.Request.RequestId); err != nil {
			return types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
		}
		memberBudget.Session.Dispatched = true
		info.RequestURLPath = "/v1/realtime?model=" + url.QueryEscape(info.UpstreamModelName)
	}
	statusCodeMappingStr := c.GetString("status_code_mapping")
	resp, err := adaptor.DoRequest(c, info, nil)
	if err != nil {
		return types.NewError(err, types.ErrorCodeDoRequestFailed)
	}

	if resp != nil {
		info.TargetWs = resp.(*websocket.Conn)
		defer info.TargetWs.Close()
	}

	if memberBudget != nil {
		info.IsStream = true
		if info.TargetWs == nil {
			return types.NewError(fmt.Errorf("membership realtime has no upstream socket"), types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
		}
		if err := service.RunMembershipRealtime(c, info, memberBudget); err != nil {
			return types.NewError(err, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
		}
		return nil
	}
	usage, newAPIError := adaptor.DoResponse(c, nil, info)
	if newAPIError != nil {
		// reset status code 重置状态码
		service.ResetStatusCode(newAPIError, statusCodeMappingStr)
		return newAPIError
	}
	service.PostWssConsumeQuota(c, info, info.UpstreamModelName, usage.(*dto.RealtimeUsage), "")
	return nil
}
