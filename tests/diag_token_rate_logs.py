#!/usr/bin/env python3
"""
只读诊断：dump 指定用户近期的消费/退款日志（含 other/content 明细），用于排查
seedance 费率缩放后的计费展示问题。不做任何写操作。

从 .env 文件读取 SQL_DSN，不硬编码任何数据库凭据。
用法: python3 tests/diag_token_rate_logs.py [user_id] [limit]
依赖: pip install pymysql
"""

import os
import re
import sys
import json
import pymysql

QUOTA_PER_UNIT = 500000.0


def load_env():
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


TYPE_NAMES = {1: '充值', 2: '消费', 3: '管理', 4: '系统', 5: '错误', 6: '退款'}


def main():
    load_env()
    dsn = os.environ.get('SQL_DSN')
    if not dsn:
        print('错误: .env 中未找到 SQL_DSN')
        sys.exit(1)

    user_id = int(sys.argv[1]) if len(sys.argv) > 1 else 150
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 30

    cfg = parse_dsn(dsn)
    cfg['charset'] = 'utf8mb4'
    print(f'数据库: {cfg["user"]}@{cfg["host"]}:{cfg["port"]}/{cfg["database"]}  user_id={user_id}')

    conn = pymysql.connect(**cfg)
    cur = conn.cursor(pymysql.cursors.DictCursor)
    try:
        cur.execute(
            """SELECT id, type, FROM_UNIXTIME(created_at) AS t, username, model_name,
                      prompt_tokens, completion_tokens, quota, use_time, channel_id,
                      other, content
               FROM logs
               WHERE user_id = %s AND type IN (2, 6)
               ORDER BY created_at DESC, id DESC
               LIMIT %s""",
            (user_id, limit),
        )
        rows = cur.fetchall()
        # 时间正序展示
        rows.reverse()
        for r in rows:
            quota = int(r['quota'] or 0)
            yuan = quota / QUOTA_PER_UNIT
            tname = TYPE_NAMES.get(r['type'], str(r['type']))
            print('-' * 110)
            print(f"id={r['id']}  type={r['type']}({tname})  time={r['t']}  model={r['model_name']}")
            print(f"  tokens: prompt={r['prompt_tokens']} completion={r['completion_tokens']}  "
                  f"quota={quota:,}  (¥{yuan:.6f})  use_time={r['use_time']}s  channel={r['channel_id']}")
            other = r['other'] or ''
            if other:
                try:
                    oj = json.loads(other)
                    print(f"  other: {json.dumps(oj, ensure_ascii=False)}")
                except Exception:
                    print(f"  other(raw): {other[:400]}")
            content = r['content'] or ''
            if content:
                print(f"  content: {content[:300]}")
    finally:
        cur.close()
        conn.close()


if __name__ == '__main__':
    main()
