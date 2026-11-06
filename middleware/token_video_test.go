package middleware

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestValidateVideoTokenRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name       string
		keyType    string
		videoModel string
		video4K    bool
		modelName  string
		resolution string
		wantError  bool
	}{
		{
			name:       "legacy key keeps existing behavior",
			videoModel: "doubao-seedance-2-0",
			modelName:  "another-model",
			resolution: "4k",
		},
		{
			name:      "language key cannot submit video",
			keyType:   model.TokenKeyTypeLanguage,
			modelName: "doubao-seedance-2-0",
			wantError: true,
		},
		{
			name:      "image key cannot submit video",
			keyType:   model.TokenKeyTypeImage,
			modelName: "doubao-seedance-2-0",
			wantError: true,
		},
		{
			name:       "video key rejects another model",
			keyType:    model.TokenKeyTypeVideo,
			videoModel: "doubao-seedance-2-0",
			modelName:  "doubao-seedance-2-5",
			wantError:  true,
		},
		{
			name:       "standard key rejects explicit 4k",
			keyType:    model.TokenKeyTypeVideo,
			videoModel: "doubao-seedance-2-0",
			modelName:  "doubao-seedance-2-0",
			resolution: "4k",
			wantError:  true,
		},
		{
			name:       "standard key accepts omitted resolution",
			keyType:    model.TokenKeyTypeVideo,
			videoModel: "doubao-seedance-2-0",
			modelName:  "doubao-seedance-2-0",
		},
		{
			name:       "standard key accepts ordinary resolution",
			keyType:    model.TokenKeyTypeVideo,
			videoModel: "doubao-seedance-2-0",
			modelName:  "doubao-seedance-2-0",
			resolution: "1080p",
		},
		{
			name:       "4k key rejects omitted resolution",
			keyType:    model.TokenKeyTypeVideo,
			videoModel: "doubao-seedance-2-0",
			video4K:    true,
			modelName:  "doubao-seedance-2-0",
			wantError:  true,
		},
		{
			name:       "4k key rejects ordinary resolution",
			keyType:    model.TokenKeyTypeVideo,
			videoModel: "doubao-seedance-2-0",
			video4K:    true,
			modelName:  "doubao-seedance-2-0",
			resolution: "1080p",
			wantError:  true,
		},
		{
			name:       "4k key accepts normalized explicit 4k",
			keyType:    model.TokenKeyTypeVideo,
			videoModel: "doubao-seedance-2-0",
			video4K:    true,
			modelName:  "doubao-seedance-2-0",
			resolution: "  4K  ",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Set("token_key_type", tt.keyType)
			ctx.Set("token_video_model", tt.videoModel)
			ctx.Set("token_video_4k", tt.video4K)

			err := validateVideoTokenRequest(ctx, tt.modelName, tt.resolution)
			if tt.wantError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}
