package service

import (
	"context"
	"errors"
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

// MembershipTaskMeter is the adapter boundary for reliable terminal evidence.
// The shared task service owns reservations and accounting; adapters only interpret receipts.
type MembershipTaskMeter interface {
	MembershipTaskOutcome(task *model.Task, body []byte) (quantity int64, terminal bool, err error)
}

// PrepareMembershipTask validates the final outbound single-video request and reserves one
// completed-video unit. Durations or legacy rate conversions never become token usage.
func PrepareMembershipTask(c *gin.Context, info *relaycommon.RelayInfo, body []byte) (*MembershipSession, error) {
	if c.Request.URL.Path != "/v1/videos" || !model.MembershipVideoChannelSupported(info.ChannelType) || !model.MembershipVideoModelSupported(info.UpstreamModelName) {
		return nil, errors.New("membership video adapter or endpoint unsupported")
	}
	var fields map[string]interface{}
	if err := common.Unmarshal(body, &fields); err != nil {
		return nil, err
	}
	for key := range fields {
		switch key {
		case "model", "prompt", "seconds", "size":
		default:
			return nil, errors.New("membership video profile supports single text-to-video output only")
		}
	}
	var request struct {
		Model   string `json:"model"`
		Prompt  string `json:"prompt"`
		Seconds string `json:"seconds"`
		Size    string `json:"size"`
	}
	if err := common.Unmarshal(body, &request); err != nil {
		return nil, err
	}
	if request.Model != info.UpstreamModelName || request.Prompt == "" {
		return nil, errors.New("invalid membership video request")
	}
	if request.Seconds != "" {
		duration, err := strconv.Atoi(request.Seconds)
		if err != nil || (duration != 4 && duration != 8 && duration != 12) {
			return nil, errors.New("membership Sora duration must be 4, 8 or 12 seconds")
		}
	}
	session := &MembershipSession{Request: model.SubscriptionChannelRequest{
		RequestId: info.PublicTaskID, UserId: info.UserId, TokenId: info.TokenId,
		UserSubscriptionId: c.GetInt("membership_subscription_id"), ChannelId: info.ChannelId,
		Model: info.OriginModelName, QuantityReserved: 1,
	}}
	if err := model.ReserveMembership(&session.Request); err != nil {
		return nil, err
	}
	c.Set("membership_session", session)
	logger.LogInfo(c, fmt.Sprintf("membership video reserved request=%s subscription=%d channel=%d count=1", session.Request.RequestId, session.Request.UserSubscriptionId, session.Request.ChannelId))
	return session, nil
}

// ApplyMembershipTaskResult uses adapter evidence rather than normalized task token counters.
// Unknown or invalid receipts retain the reservation; terminal work settles after expiry too.
func ApplyMembershipTaskResult(ctx context.Context, adaptor TaskPollingAdaptor, task *model.Task, result *relaycommon.TaskInfo, body []byte) error {
	meter, ok := adaptor.(MembershipTaskMeter)
	if !ok {
		return errors.New("task adapter has no membership usage contract")
	}
	quantity, terminal, err := meter.MembershipTaskOutcome(task, body)
	if err != nil {
		// Preserve ambiguous evidence without refunding a dispatched task.
		if saveErr := model.SaveMembershipUsageReceipt(task.PrivateData.MembershipRequestId, body); saveErr != nil {
			logger.LogError(ctx, saveErr.Error())
		}
		if pendingErr := model.FinishMembershipQuantity(task.PrivateData.MembershipRequestId, 0, "pending", "task receipt could not be verified"); pendingErr != nil {
			logger.LogError(ctx, pendingErr.Error())
		}
		return err
	}
	if !terminal {
		if result.Status != model.TaskStatusQueued && result.Status != model.TaskStatusInProgress && result.Status != model.TaskStatusSubmitted {
			return errors.New("membership task outcome is unknown")
		}
		old := task.Status
		if old == model.TaskStatusSuccess || old == model.TaskStatusFailure || old == model.TaskStatusCancelled {
			return nil
		}
		task.Status = model.TaskStatus(result.Status)
		task.Data = body
		_, err := task.UpdateWithStatus(old)
		return err
	}
	if quantity == 1 {
		task.Status = model.TaskStatusSuccess
	} else if result.Status == model.TaskStatusFailure {
		task.Status = model.TaskStatusFailure
	} else {
		return errors.New("membership terminal status does not match receipt")
	}
	task.Data = body
	task.FailReason = result.Reason
	if err := model.CompleteMembershipTask(task, quantity, body); err != nil {
		return err
	}
	logger.LogInfo(ctx, fmt.Sprintf("membership task terminal request=%s status=%s completed_videos=%d", task.PrivateData.MembershipRequestId, task.Status, quantity))
	return nil
}

// IsMembershipVideoPlatform is shared by task admission and avoids treating generic providers as Sora.
func IsMembershipVideoPlatform(platform constant.TaskPlatform) bool {
	return platform == constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeOpenAI)) || platform == constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeSora))
}
