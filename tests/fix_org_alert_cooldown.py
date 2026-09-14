#!/usr/bin/env python3
"""
清零企业告警冷却时间戳（organizations.last_alert_at / last_daily_alert_at）。

旧通知逻辑"先占位冷却再发送"，投递失败/被跳过也会消耗 24h 冷却，
导致配置修好后仍要等满窗口才能收到告警。新逻辑（失败 10 分钟有界重试）
上线后，执行本脚本清掉历史浪费的时间戳，使第一笔结算即可投递。

此操作是幂等的：只把非零时间戳置 0，可反复执行。
副作用上限：阈值仍处于突破状态的企业会在下一笔结算补发一次告警
（正好可用于验证新投递链路）。

从 .env 文件读取 SQL_DSN，不硬编码任何数据库凭据。
用法: python3 tests/fix_org_alert_cooldown.py
依赖: pip install pymysql
"""

import os
import re
import sys
import pymysql


def load_env():
    """从 .env 文件加载环境变量"""
    candidates = [
        os.path.join(os.path.dirname(__file__), '..', '.env'),
        os.path.join(os.getcwd(), '.env'),
    ]
    for path in candidates:
        if os.path.isfile(path):
            with open(path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    if '=' in line:
                        key, _, value = line.partition('=')
                        os.environ.setdefault(key.strip(), value.strip())
            return
    print('错误: 找不到 .env 文件')
    sys.exit(1)


def parse_dsn(dsn):
    """解析 Go MySQL DSN: user:password@tcp(host:port)/database?params"""
    pattern = r'^([^:]+):([^@]+)@tcp\(([^:]+):(\d+)\)/([^?]+)'
    m = re.match(pattern, dsn)
    if not m:
        print(f'错误: 无法解析 SQL_DSN: {dsn}')
        sys.exit(1)
    return {
        'user': m.group(1),
        'password': m.group(2),
        'host': m.group(3),
        'port': int(m.group(4)),
        'database': m.group(5),
    }


def main():
    load_env()

    dsn = os.environ.get('SQL_DSN')
    if not dsn:
        print('错误: .env 中未找到 SQL_DSN')
        sys.exit(1)

    db_config = parse_dsn(dsn)
    db_config['charset'] = 'utf8mb4'

    print(f'数据库: {db_config["user"]}@{db_config["host"]}:{db_config["port"]}/{db_config["database"]}')
    print()

    conn = pymysql.connect(**db_config)
    cursor = conn.cursor(pymysql.cursors.DictCursor)

    try:
        cursor.execute("""
            SELECT id, name, display_name, notify_type, notify_target,
                   last_alert_at, last_daily_alert_at
            FROM organizations
            WHERE last_alert_at <> 0 OR last_daily_alert_at <> 0
            ORDER BY id
        """)
        rows = cursor.fetchall()

        if not rows:
            print('没有非零的告警冷却时间戳，无需修正。')
            return

        print(f'  {"企业ID":>6}  {"标识":<16}  {"渠道":<8}  {"last_alert_at":>14}  {"last_daily_alert_at":>20}')
        print(f'  {"-"*6}  {"-"*16}  {"-"*8}  {"-"*14}  {"-"*20}')
        for r in rows:
            print(f'  {r["id"]:>6}  {(r["display_name"] or r["name"])[:16]:<16}  '
                  f'{(r["notify_type"] or "(未配置)"):<8}  {r["last_alert_at"]:>14}  {r["last_daily_alert_at"]:>20}')

        with conn.cursor() as update_cursor:
            update_cursor.execute("""
                UPDATE organizations
                SET last_alert_at = 0, last_daily_alert_at = 0
                WHERE last_alert_at <> 0 OR last_daily_alert_at <> 0
            """)
        conn.commit()
        print(f'\n  修正完成：{len(rows)} 个企业的冷却时间戳已清零并提交事务。')

        cursor.execute("""
            SELECT COUNT(*) AS left_over FROM organizations
            WHERE last_alert_at <> 0 OR last_daily_alert_at <> 0
        """)
        print(f'  验证: 剩余非零时间戳企业数 = {cursor.fetchone()["left_over"]}')

    finally:
        cursor.close()
        conn.close()


if __name__ == '__main__':
    main()
