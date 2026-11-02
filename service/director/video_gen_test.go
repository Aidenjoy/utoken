package director

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQueryVideoTaskSupportsArkOfficialResponse(t *testing.T) {
	responses := map[string]string{
		"ark-success": `{"id":"ark-success","status":"succeeded","content":{"video_url":"https://videos.example.com/ark.mp4"}}`,
		"ark-failed":  `{"id":"ark-failed","status":"failed","error":{"message":"upstream rejected the request"}}`,
		"ark-running": `{"id":"ark-running","status":"running"}`,
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		taskID := strings.TrimPrefix(r.URL.Path, "/v1/video/generations/")
		body, ok := responses[taskID]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, body)
	}))
	defer server.Close()
	t.Setenv("DIRECTOR_RELAY_BASE", server.URL)

	tests := []struct {
		name       string
		taskID     string
		wantStatus string
		wantURL    string
		wantError  string
	}{
		{name: "succeeded returns content video URL", taskID: "ark-success", wantStatus: "success", wantURL: "https://videos.example.com/ark.mp4"},
		{name: "failed returns upstream error", taskID: "ark-failed", wantStatus: "failed", wantError: "upstream rejected the request"},
		{name: "running remains processing", taskID: "ark-running", wantStatus: "processing"},
	}

	service := &VideoGenerationService{}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, videoURL, err := service.QueryVideoTask(directorCallConfig{APIKey: "test-key"}, tt.taskID)
			assert.Equal(t, tt.wantStatus, status)
			assert.Equal(t, tt.wantURL, videoURL)
			if tt.wantError == "" {
				require.NoError(t, err)
				return
			}
			require.EqualError(t, err, tt.wantError)
		})
	}
}
