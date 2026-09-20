#!/usr/bin/env python3
"""
修正 seedance 费率「跨节点双结算」产生的脏数据（仅展示/聚合修正，不改变净额/余额）。

背景: 旧构建 master(node-1) 按原始 token 先结算，新构建节点(node-3) 按缩放 token 差额补结，
导致同一任务在 logs 出现 3 条、在 quota_data 出现 2 个 node_name 行且重复计数。
本脚本收敛为正确状态:
  logs:     删除差额消费行，把退款行改为按缩放后 token 的一次性结算值 -> 2 条
  quota_data: 删除旧构建节点的重复行，把存活行 token_used 改回缩放值 -> 1 行
净额保持不变(= 缩放后 actual_quota)，因此 users.used_quota / 钱包余额无需改动。

从 .env 文件读取 SQL_DSN，不硬编码任何数据库凭据。
用法: python3 tests/fix_token_rate_log_rows.py <task_id>
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


def compact_other(s):
    """Go encoding/json 为紧凑格式(冒号/逗号后无空格)；折叠查询 LIKE '%"task_id":"x"%'
    依赖无空格格式，故回写 other 必须用紧凑分隔符，否则企业计费详情折叠匹配失败。"""
    if not s:
        return s
    try:
        return json.dumps(json.loads(s), ensure_ascii=False, separators=(',', ':'))
    except Exception:
        return s


def fetch_task_rows(cur, task_id):
    cur.execute(
        "SELECT id, type, created_at, user_id, model_name, completion_tokens, quota, other "
        "FROM logs WHERE other LIKE %s AND type IN (2, 6) ORDER BY id",
        (f'%{task_id}%',),
    )
    return cur.fetchall()


def fix_logs(cur, task_id):
    """返回 (scaled_actual, scaled_tokens, user_id, model_name, bucket) 供 quota_data 对账。"""
    rows = fetch_task_rows(cur, task_id)
    print(f'[logs] task_id={task_id}  现有 {len(rows)} 条消费/退款日志:')
    for r in rows:
        print(f'  id={r["id"]} type={r["type"]} completion={r["completion_tokens"]} '
              f'quota={int(r["quota"]):,} (¥{int(r["quota"])/QUOTA_PER_UNIT:.6f})')

    consumes = [r for r in rows if r['type'] == 2]
    refunds = [r for r in rows if r['type'] == 6]
    if not refunds:
        print('[logs] 无退款行，放弃。')
        sys.exit(1)
    refund_row = refunds[0]
    other = json.loads(refund_row['other']) if refund_row['other'] else {}
    scaled_actual = int(other.get('actual_quota', 0))
    scaled_tokens = int(refund_row['completion_tokens'])
    pre_row = consumes[0]
    user_id = int(pre_row['user_id'])
    model_name = pre_row['model_name']
    bucket = (int(pre_row['created_at']) // 3600) * 3600

    if len(consumes) == 1 and len(refunds) == 1:
        print('[logs] 已是 2 条(预扣+退款)，跳过 logs 金额修正。')
        compact = compact_other(refund_row['other'])
        if compact != refund_row['other']:
            cur.execute("UPDATE logs SET other = %s WHERE id = %s", (compact, refund_row['id']))
            print(f'[logs] 已规范化退款行 id={refund_row["id"]} other 为紧凑 JSON(修复折叠匹配)')
        return scaled_actual, scaled_tokens, user_id, model_name, bucket

    if len(consumes) != 2 or len(refunds) != 1:
        print(f'[logs] 错误: 期望 2 消费+1 退款，实际 {len(consumes)}+{len(refunds)}，放弃。')
        sys.exit(1)

    delta_row = consumes[1]
    pre_quota = int(pre_row['quota'])
    delta_quota = int(delta_row['quota'])
    old_refund_quota = int(refund_row['quota'])
    new_refund_quota = pre_quota - scaled_actual
    print(f'[logs] 计算: 预扣={pre_quota:,} 旧退款={old_refund_quota:,} 差额={delta_quota:,} '
          f'-> 新退款={new_refund_quota:,} completion={scaled_tokens}')
    assert pre_quota - old_refund_quota + delta_quota == pre_quota - new_refund_quota, '净额不一致，放弃'

    cur.execute("DELETE FROM logs WHERE id = %s AND type = 2", (delta_row['id'],))
    print(f'[logs] 已删除差额行 id={delta_row["id"]}')
    other['actual_quota'] = scaled_actual
    cur.execute(
        "UPDATE logs SET quota = %s, completion_tokens = %s, other = %s WHERE id = %s AND type = 6",
        (new_refund_quota, scaled_tokens, compact_other(json.dumps(other)), refund_row['id']),
    )
    print(f'[logs] 已更新退款行 id={refund_row["id"]}: quota->{new_refund_quota:,} completion->{scaled_tokens}')
    return scaled_actual, scaled_tokens, user_id, model_name, bucket


def fix_quota_data(cur, scaled_actual, scaled_tokens, user_id, model_name, bucket):
    cur.execute(
        "SELECT id, node_name, token_used, count, quota FROM quota_data "
        "WHERE user_id = %s AND model_name = %s AND created_at = %s",
        (user_id, model_name, bucket),
    )
    rows = cur.fetchall()
    print(f'\n[quota_data] user={user_id} model={model_name} bucket={bucket}  现有 {len(rows)} 行:')
    for r in rows:
        print(f'  id={r["id"]} node={r["node_name"]} token_used={int(r["token_used"]):,} '
              f'quota={int(r["quota"]):,} count={r["count"]}')

    if len(rows) == 1 and int(rows[0]['token_used']) == scaled_tokens and int(rows[0]['quota']) == scaled_actual:
        print('[quota_data] 已是单行正确值，跳过。')
        return
    if len(rows) != 2:
        print(f'[quota_data] 错误: 期望 2 行(跨节点重复)，实际 {len(rows)} 行，放弃。')
        sys.exit(1)

    survivor = next((r for r in rows if int(r['quota']) == scaled_actual), None)
    dup = next((r for r in rows if r is not survivor), None)
    if survivor is None or dup is None:
        print('[quota_data] 错误: 无法识别存活行/重复行，放弃。')
        sys.exit(1)
    # 重复行 token 应为 存活行累加值 - 缩放值 (= 原始 token)
    assert int(dup['token_used']) == int(survivor['token_used']) - scaled_tokens, 'token 关系不符，放弃'

    cur.execute("DELETE FROM quota_data WHERE id = %s", (dup['id'],))
    print(f'[quota_data] 已删除重复行 id={dup["id"]} (node={dup["node_name"]})')
    cur.execute("UPDATE quota_data SET token_used = %s WHERE id = %s", (scaled_tokens, survivor['id']))
    print(f'[quota_data] 已更新存活行 id={survivor["id"]} (node={survivor["node_name"]}): '
          f'token_used {int(survivor["token_used"]):,}->{scaled_tokens:,}')


def main():
    load_env()
    dsn = os.environ.get('SQL_DSN')
    if not dsn:
        print('错误: .env 中未找到 SQL_DSN')
        sys.exit(1)
    if len(sys.argv) < 2:
        print('用法: python3 tests/fix_token_rate_log_rows.py <task_id>')
        sys.exit(1)
    task_id = sys.argv[1]

    cfg = parse_dsn(dsn)
    cfg['charset'] = 'utf8mb4'
    conn = pymysql.connect(**cfg)
    cur = conn.cursor(pymysql.cursors.DictCursor)
    try:
        scaled_actual, scaled_tokens, user_id, model_name, bucket = fix_logs(cur, task_id)
        fix_quota_data(cur, scaled_actual, scaled_tokens, user_id, model_name, bucket)
        conn.commit()
        print('\n已提交。最终 logs:')
        for r in fetch_task_rows(cur, task_id):
            print(f'  id={r["id"]} type={r["type"]} completion={r["completion_tokens"]} '
                  f'quota={int(r["quota"]):,} (¥{int(r["quota"])/QUOTA_PER_UNIT:.6f})')
        cur.execute(
            "SELECT id, node_name, token_used, count, quota FROM quota_data "
            "WHERE user_id = %s AND model_name = %s AND created_at = %s",
            (user_id, model_name, bucket),
        )
        print('最终 quota_data:')
        for r in cur.fetchall():
            print(f'  id={r["id"]} node={r["node_name"]} token_used={int(r["token_used"]):,} '
                  f'quota={int(r["quota"]):,} count={r["count"]}')
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == '__main__':
    main()
