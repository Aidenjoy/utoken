package main

import (
	"fmt"

	"github.com/joho/godotenv"

	"github.com/QuantumNous/new-api/model"
)

func main() {
	_ = godotenv.Load(".env")
	if err := model.InitDB(); err != nil {
		panic(err)
	}

	// 列出 director 相关表的外键，确认级联删除需要清理的完整集合
	type fkRow struct {
		TableName      string
		ConstraintName string
		ColumnName     string
		RefTable       string
		RefColumn      string
	}
	var fks []fkRow
	model.DB.Raw(`SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS constraint_name, COLUMN_NAME AS column_name,
		REFERENCED_TABLE_NAME AS ref_table, REFERENCED_COLUMN_NAME AS ref_column
		FROM information_schema.KEY_COLUMN_USAGE
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'director_%' AND REFERENCED_TABLE_NAME IS NOT NULL
		ORDER BY TABLE_NAME, CONSTRAINT_NAME`).Scan(&fks)
	fmt.Println("== director FKs ==")
	for _, f := range fks {
		fmt.Printf("%s.%s -> %s.%s (%s)\n", f.TableName, f.ColumnName, f.RefTable, f.RefColumn, f.ConstraintName)
	}
}
