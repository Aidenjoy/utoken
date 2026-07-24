#!/usr/bin/env python3
"""
修正所有用户的 used_quota。

直接根据日志计算正确值: used_quota = SUM(type=2消费日志) - SUM(type=6退款日志)
此操作是幂等的，可反复执行，不会重复扣减。

从 .env 文件读取 SQL_DSN，不硬编码任何数据库凭据。
用法: python3 tests/fix_used_quota.py
依赖: pip install pymysql
"""

import os
import re
import sys
import pymysql

QUOTA_PER_UNIT = 500000.0


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


def quota_to_display(quota):
    if quota is None:
        return 0.0
    return round(float(quota) / QUOTA_PER_UNIT, 2)


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
        # 1. 计算每个用户的正确 used_quota
        # used_quota = SUM(type=2 消费日志的 quota) - SUM(type=6 退款日志的 quota)
        # 此公式是幂等的：直接计算目标值并设置，不做增量修改
        print('=' * 110)
        print('  步骤1: 计算每个用户的正确 used_quota (消费总额 - 退款总额)')
        print('=' * 110)

        cursor.execute("""
            SELECT user_id,
                   SUM(CASE WHEN type = 2 THEN quota ELSE 0 END) as consume_total,
                   SUM(CASE WHEN type = 6 THEN quota ELSE 0 END) as refund_total
            FROM logs
            WHERE type IN (2, 6)
            GROUP BY user_id
            ORDER BY user_id
        """)
        log_stats = cursor.fetchall()

        if not log_stats:
            print('  没有消费/退款日志，无需修正。')
            return

        print(f'  共 {len(log_stats)} 个用户有消费/退款日志\n')
        print(f'  {"用户ID":>8}  {"消费总额":>18}  {"退款总额":>18}  {"正确used_quota":>18}  {"金额":>10}')
        print(f'  {"-"*8}  {"-"*18}  {"-"*18}  {"-"*18}  {"-"*10}')

        updates = []
        for r in log_stats:
            user_id = r['user_id']
            consume_total = int(r['consume_total'] or 0)
            refund_total = int(r['refund_total'] or 0)
            correct_used = consume_total - refund_total

            cursor.execute("SELECT quota, used_quota, username FROM users WHERE id = %s", (user_id,))
            u = cursor.fetchone()
            if not u:
                print(f'  {user_id:>8}  用户不存在，跳过')
                continue

            current_used = int(u['used_quota'])
            username = u['username']

            updates.append((user_id, username, current_used, correct_used, consume_total, refund_total))
            print(f'  {user_id:>8}  {consume_total:>18,}  {refund_total:>18,}  {correct_used:>18,}  {quota_to_display(correct_used):>10.2f}')

        # 2. 对比当前值和正确值
        print('\n' + '=' * 110)
        print('  步骤2: 对比当前值与正确值')
        print('=' * 110)

        print(f'  {"用户ID":>8}  {"当前used_quota":>18}  {"正确used_quota":>18}  {"差额":>18}  {"需更新":>6}')
        print(f'  {"-"*8}  {"-"*18}  {"-"*18}  {"-"*18}  {"-"*6}')

        need_update = []
        for user_id, username, current_used, correct_used, consume_total, refund_total in updates:
            diff = correct_used - current_used
            needs = '是' if diff != 0 else '否'
            if diff != 0:
                need_update.append((user_id, username, current_used, correct_used))
            print(f'  {user_id:>8}  {current_used:>18,}  {correct_used:>18,}  {diff:>+18,}  {needs:>6}')

        if not need_update:
            print('\n  所有用户的 used_quota 已是正确值，无需修正。')
            return

        # 3. 执行修正
        print('\n' + '=' * 110)
        print(f'  步骤3: 执行修正 ({len(need_update)} 个用户)')
        print('=' * 110)

        with conn.cursor() as update_cursor:
            for user_id, username, current_used, correct_used in need_update:
                update_cursor.execute(
                    "UPDATE users SET used_quota = %s WHERE id = %s",
                    (correct_used, user_id)
                )
                print(f'  OK  用户ID={user_id} ({username}): {current_used:,} -> {correct_used:,}')

        conn.commit()
        print(f'\n  修正完成，已提交事务')

        # 4. 验证
        print('\n' + '=' * 110)
        print('  步骤4: 验证修正结果')
        print('=' * 110)

        for user_id, username, current_used, correct_used, consume_total, refund_total in updates:
            cursor.execute("SELECT quota, used_quota FROM users WHERE id = %s", (user_id,))
            u = cursor.fetchone()
            if not u:
                continue

            remaining = int(u['quota'])
            used = int(u['used_quota'])
            total = remaining + used

            print(f'  用户ID={user_id:>4} ({username:>16})  剩余={remaining:>14,}  已用={used:>14,}  总额={total:>14,}  ({quota_to_display(total):.2f})')

    finally:
        cursor.close()
        conn.close()


if __name__ == '__main__':
    main()
