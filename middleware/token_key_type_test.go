package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRequiredKeyType(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name   string
		method string
		path   string
		want   string
	}{
		{name: "chat completions is language", method: http.MethodPost, path: "/v1/chat/completions", want: model.TokenKeyTypeLanguage},
		{name: "claude messages is language", method: http.MethodPost, path: "/v1/messages", want: model.TokenKeyTypeLanguage},
		{name: "embeddings is language", method: http.MethodPost, path: "/v1/embeddings", want: model.TokenKeyTypeLanguage},
		{name: "audio speech is language", method: http.MethodPost, path: "/v1/audio/speech", want: model.TokenKeyTypeLanguage},
		{name: "responses is language", method: http.MethodPost, path: "/v1/responses", want: model.TokenKeyTypeLanguage},
		{name: "gemini generateContent is language", method: http.MethodPost, path: "/v1beta/models/gemini-2.0-flash:generateContent", want: model.TokenKeyTypeLanguage},

		{name: "image generations is image", method: http.MethodPost, path: "/v1/images/generations", want: model.TokenKeyTypeImage},
		{name: "image edits is image", method: http.MethodPost, path: "/v1/images/edits", want: model.TokenKeyTypeImage},
		{name: "legacy edits is image", method: http.MethodPost, path: "/v1/edits", want: model.TokenKeyTypeImage},
		{name: "midjourney imagine is image", method: http.MethodPost, path: "/mj/submit/imagine", want: model.TokenKeyTypeImage},
		{name: "midjourney mode prefix is image", method: http.MethodPost, path: "/relax/mj/submit/change", want: model.TokenKeyTypeImage},

		{name: "native video submit is video", method: http.MethodPost, path: "/v1/video/generations", want: model.TokenKeyTypeVideo},
		{name: "openai videos create is video", method: http.MethodPost, path: "/v1/videos", want: model.TokenKeyTypeVideo},
		{name: "video content proxy is video", method: http.MethodGet, path: "/v1/videos/task-1/content", want: model.TokenKeyTypeVideo},
		{name: "ark task submit is video", method: http.MethodPost, path: "/api/v3/contents/generations/tasks", want: model.TokenKeyTypeVideo},

		{name: "model list is unclassified", method: http.MethodGet, path: "/v1/models", want: ""},
		{name: "model retrieve is unclassified", method: http.MethodGet, path: "/v1/models/gpt-4o", want: ""},
		{name: "gemini model list is unclassified", method: http.MethodGet, path: "/v1beta/models", want: ""},
		{name: "suno submit is unclassified", method: http.MethodPost, path: "/suno/submit/music", want: ""},
		{name: "relay asset library is unclassified", method: http.MethodPost, path: "/v1/api/assets/upload", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, requiredKeyType(tt.method, tt.path))
		})
	}
}

func TestEnforceTokenKeyType(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name       string
		keyType    string
		method     string
		path       string
		wantAbort  bool
		wantStatus int
	}{
		{name: "language key blocked on image endpoint", keyType: model.TokenKeyTypeLanguage, method: http.MethodPost, path: "/v1/images/generations", wantAbort: true, wantStatus: http.StatusForbidden},
		{name: "image key blocked on language endpoint", keyType: model.TokenKeyTypeImage, method: http.MethodPost, path: "/v1/chat/completions", wantAbort: true, wantStatus: http.StatusForbidden},
		{name: "video key blocked on language endpoint", keyType: model.TokenKeyTypeVideo, method: http.MethodPost, path: "/v1/chat/completions", wantAbort: true, wantStatus: http.StatusForbidden},
		{name: "language key blocked on video endpoint", keyType: model.TokenKeyTypeLanguage, method: http.MethodPost, path: "/v1/video/generations", wantAbort: true, wantStatus: http.StatusForbidden},

		{name: "language key allowed on language endpoint", keyType: model.TokenKeyTypeLanguage, method: http.MethodPost, path: "/v1/chat/completions"},
		{name: "image key allowed on image endpoint", keyType: model.TokenKeyTypeImage, method: http.MethodPost, path: "/v1/images/generations"},
		{name: "video key allowed on video endpoint", keyType: model.TokenKeyTypeVideo, method: http.MethodPost, path: "/v1/video/generations"},

		{name: "legacy empty key allowed on image endpoint", keyType: "", method: http.MethodPost, path: "/v1/images/generations"},
		{name: "legacy empty key allowed on language endpoint", keyType: "", method: http.MethodPost, path: "/v1/chat/completions"},
		{name: "image key allowed on model list", keyType: model.TokenKeyTypeImage, method: http.MethodGet, path: "/v1/models"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(w)
			ctx.Request = httptest.NewRequest(tt.method, tt.path, nil)
			ctx.Set("token_key_type", tt.keyType)

			enforceTokenKeyType(ctx)

			require.Equal(t, tt.wantAbort, ctx.IsAborted())
			if tt.wantAbort {
				assert.Equal(t, tt.wantStatus, w.Code)
			}
		})
	}
}
