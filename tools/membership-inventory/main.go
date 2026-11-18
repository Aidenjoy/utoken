// Command membership-inventory reads enabled channel/model abilities from a loopback-only
// MySQL database. It never starts the application, migrates tables or calls a provider.
package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	mysql "github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
)

// run emits only public channel metadata; credentials, base URLs and provider keys are never selected.
func run() error {
	env, err := godotenv.Read(".env")
	if err != nil {
		return fmt.Errorf("read local .env failed")
	}
	config, err := mysql.ParseDSN(env["SQL_DSN"])
	if err != nil {
		return fmt.Errorf("invalid MySQL DSN")
	}
	if config.Net != "tcp" || (!strings.HasPrefix(config.Addr, "127.0.0.1:") && !strings.HasPrefix(config.Addr, "localhost:")) {
		return fmt.Errorf("inventory refuses non-loopback database")
	}
	config.Timeout = 3 * time.Second
	db, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		return fmt.Errorf("open local MySQL failed")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return fmt.Errorf("local MySQL unavailable; no inventory obtained")
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, "SELECT c.id,c.name,c.type,a.model,a.`group`,c.model_mapping FROM channels c JOIN abilities a ON a.channel_id=c.id WHERE c.status=1 AND a.enabled=1 ORDER BY c.id,a.model,a.`group`")
	if err != nil {
		return fmt.Errorf("read-only channel inventory query failed")
	}
	defer rows.Close()
	type entry struct {
		ChannelId     int    `json:"channel_id"`
		ChannelName   string `json:"channel_name"`
		ChannelType   int    `json:"channel_type"`
		Model         string `json:"model"`
		UpstreamModel string `json:"upstream_model"`
		Group         string `json:"group"`
	}
	entries := make([]entry, 0)
	for rows.Next() {
		var value entry
		var mapping sql.NullString
		if err := rows.Scan(&value.ChannelId, &value.ChannelName, &value.ChannelType, &value.Model, &value.Group, &mapping); err != nil {
			return fmt.Errorf("invalid inventory row")
		}
		value.UpstreamModel = value.Model
		if mapping.Valid && mapping.String != "" {
			var names map[string]string
			if err := common.UnmarshalJsonStr(mapping.String, &names); err != nil {
				return fmt.Errorf("channel %d model mapping invalid", value.ChannelId)
			}
			if names[value.Model] != "" {
				value.UpstreamModel = names[value.Model]
			}
		}
		entries = append(entries, value)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("inventory read failed")
	}
	data, err := common.Marshal(entries)
	if err != nil {
		return err
	}
	fmt.Println(string(data))
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
