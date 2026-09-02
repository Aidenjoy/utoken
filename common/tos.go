package common

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
	tos "github.com/volcengine/ve-tos-golang-sdk/v2/tos"
)

// TOS (Volcengine Object Storage) shared upload helpers.
//
// Configuration is read from environment variables:
//   - TOS_ACCESS_KEY:  TOS access key
//   - TOS_SECRET_KEY:  TOS secret key
//   - TOS_ENDPOINT:    TOS endpoint (e.g., https://tos-cn-beijing.volces.com)
//   - TOS_REGION:      TOS region (e.g., cn-beijing)
//   - TOS_BUCKET:      TOS bucket name

// TOSUploadConfig holds the resolved TOS upload configuration.
type TOSUploadConfig struct {
	Endpoint  string
	Region    string
	Bucket    string
	AccessKey string
	SecretKey string
}

// GetTOSUploadConfig resolves the TOS upload configuration from the
// environment. Returns ok=false when any required value is missing.
func GetTOSUploadConfig() (cfg TOSUploadConfig, ok bool) {
	cfg.AccessKey = GetEnvOrDefaultString("TOS_ACCESS_KEY", "")
	cfg.SecretKey = GetEnvOrDefaultString("TOS_SECRET_KEY", "")
	cfg.Endpoint = GetEnvOrDefaultString("TOS_ENDPOINT", "https://tos-cn-beijing.volces.com")
	cfg.Region = GetEnvOrDefaultString("TOS_REGION", "cn-beijing")
	cfg.Bucket = GetEnvOrDefaultString("TOS_BUCKET", "")
	ok = cfg.AccessKey != "" && cfg.SecretKey != "" && cfg.Bucket != ""
	return cfg, ok
}

// UploadReaderToTOS uploads a file to Volcengine TOS (Object Storage) and
// returns the publicly accessible URL and the object key.
// The object key is structured as {date}/{userId}_{batchId}/{filename} so
// that all resources sharing the same batchID are grouped in one folder.
// If batchID is empty, a new UUID is generated.
func UploadReaderToTOS(file io.Reader, filename string, userId int, batchID string) (publicURL, objectKey string, err error) {
	if _, ok := GetTOSUploadConfig(); !ok {
		return "", "", fmt.Errorf("TOS not configured; set TOS_ACCESS_KEY/TOS_SECRET_KEY/TOS_BUCKET")
	}
	content, err := io.ReadAll(file)
	if err != nil {
		return "", "", fmt.Errorf("read file: %w", err)
	}
	return UploadBytesToTOS(content, filename, userId, batchID)
}

// UploadBytesToTOS uploads raw bytes to TOS under the standard
// {date}/{userId}_{batchId}/{filename} object key layout.
func UploadBytesToTOS(content []byte, filename string, userId int, batchID string) (publicURL, objectKey string, err error) {
	cfg, ok := GetTOSUploadConfig()
	if !ok {
		return "", "", fmt.Errorf("TOS not configured; set TOS_ACCESS_KEY/TOS_SECRET_KEY/TOS_BUCKET")
	}

	client, err := tos.NewClientV2(cfg.Endpoint, tos.WithRegion(cfg.Region), tos.WithCredentials(tos.NewStaticCredentials(cfg.AccessKey, cfg.SecretKey)))
	if err != nil {
		return "", "", fmt.Errorf("create TOS client: %w", err)
	}

	if batchID == "" {
		batchID = uuid.New().String()
	}
	date := time.Now().Format("2006-01-02")
	objectKey = fmt.Sprintf("%s/%d_%s/%s", date, userId, batchID, filename)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	_, err = client.PutObjectV2(ctx, &tos.PutObjectV2Input{
		PutObjectBasicInput: tos.PutObjectBasicInput{
			Bucket: cfg.Bucket,
			Key:    objectKey,
		},
		Content: bytes.NewReader(content),
	})
	if err != nil {
		return "", "", fmt.Errorf("upload to TOS: %w", err)
	}

	// Construct public URL: https://{bucket}.{endpoint-host}/{object-key}
	endpointHost := strings.TrimPrefix(cfg.Endpoint, "https://")
	endpointHost = strings.TrimPrefix(endpointHost, "http://")
	publicURL = fmt.Sprintf("https://%s.%s/%s", cfg.Bucket, endpointHost, objectKey)

	return publicURL, objectKey, nil
}
