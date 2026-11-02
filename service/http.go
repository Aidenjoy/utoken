package service

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/gin-gonic/gin"
)

func CloseResponseBodyGracefully(httpResponse *http.Response) {
	if httpResponse == nil || httpResponse.Body == nil {
		return
	}
	err := httpResponse.Body.Close()
	if err != nil {
		common.SysError("failed to close response body: " + err.Error())
	}
}

// copyableUpstreamHeaders is the allow-list of standard, functionally-necessary
// response headers forwarded from upstream to the client: body typing
// (Content-Type / Content-Disposition / Content-Encoding), media range seeking
// (Accept-Ranges / Content-Range) and caching (Cache-Control / Expires / ETag /
// Last-Modified). Keys must be in http.CanonicalHeaderKey form (note "ETag"
// canonicalizes to "Etag"). Everything else is dropped fail-closed so a normal
// user cannot fingerprint the upstream provider/channel via headers such as
// Server, Via, vendor X-* identifiers, CDN/trace IDs or upstream rate-limit
// counters.
var copyableUpstreamHeaders = map[string]struct{}{
	"Content-Type":        {},
	"Content-Disposition": {},
	"Content-Encoding":    {},
	"Content-Range":       {},
	"Accept-Ranges":       {},
	"Cache-Control":       {},
	"Expires":             {},
	"Etag":                {},
	"Last-Modified":       {},
}

// ShouldCopyUpstreamHeader checks whether a given upstream response header
// should be copied to the client response. Only the standard headers in
// copyableUpstreamHeaders are forwarded; Content-Length is managed separately.
// The upstream X-Oneapi-Request-Id is captured into the Gin context for later
// logging but never forwarded, so the local instance/vendor ID is not leaked.
func ShouldCopyUpstreamHeader(c *gin.Context, k string, v []string) bool {
	if strings.EqualFold(k, common.RequestIdKey) {
		if c != nil && len(v) > 0 {
			c.Set(common.UpstreamRequestIdKey, v[0])
		}
		return false
	}
	if strings.EqualFold(k, "Content-Length") {
		return false
	}
	_, ok := copyableUpstreamHeaders[http.CanonicalHeaderKey(k)]
	return ok
}

func IOCopyBytesGracefully(c *gin.Context, src *http.Response, data []byte) {
	if c.Writer == nil {
		return
	}

	body := io.NopCloser(bytes.NewBuffer(data))

	// We shouldn't set the header before we parse the response body, because the parse part may fail.
	// And then we will have to send an error response, but in this case, the header has already been set.
	// So the httpClient will be confused by the response.
	// For example, Postman will report error, and we cannot check the response at all.
	if src != nil {
		for k, v := range src.Header {
			if !ShouldCopyUpstreamHeader(c, k, v) {
				continue
			}
			c.Writer.Header().Set(k, v[0])
		}
	}

	// set Content-Length header manually BEFORE calling WriteHeader
	c.Writer.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))

	// Write header with status code (this sends the headers)
	if src != nil {
		c.Writer.WriteHeader(src.StatusCode)
	} else {
		c.Writer.WriteHeader(http.StatusOK)
	}

	_, err := io.Copy(c.Writer, body)
	if err != nil {
		logger.LogError(c, fmt.Sprintf("failed to copy response body: %s", err.Error()))
	}
	c.Writer.Flush()
}
