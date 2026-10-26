/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
/** Sentinel option: no constraint on this dimension (query everything). */
export const BILLING_SCOPE_ALL = '__all__'
/** Sentinel option: exclude this dimension entirely (wire value "none"). */
export const BILLING_SCOPE_NONE = 'none'

/**
 * Normalize a multi-select change for a scope dropdown whose options are
 * [All, None, ...real items]. All/None are mutually exclusive with real items
 * and with each other; an empty selection falls back to All.
 */
export function normalizeBillingScope(
  prev: string[],
  next: string[]
): string[] {
  const prevAll = prev.includes(BILLING_SCOPE_ALL)
  const prevNone = prev.includes(BILLING_SCOPE_NONE)
  if (next.includes(BILLING_SCOPE_ALL) && !prevAll) return [BILLING_SCOPE_ALL]
  if (next.includes(BILLING_SCOPE_NONE) && !prevNone) {
    return [BILLING_SCOPE_NONE]
  }
  const ids = next.filter(
    (v) => v !== BILLING_SCOPE_ALL && v !== BILLING_SCOPE_NONE
  )
  if (ids.length === 0) return [BILLING_SCOPE_ALL]
  return ids
}

/** Map a scope selection to the backend query value (undefined = omit). */
export function billingScopeToParam(sel: string[]): string | undefined {
  if (sel.length === 0 || sel.includes(BILLING_SCOPE_ALL)) return undefined
  if (sel.includes(BILLING_SCOPE_NONE)) return BILLING_SCOPE_NONE
  return sel.join(',')
}

export interface BillingFilter {
  userSel: string[]
  orgSel: string[]
  start?: number
  end?: number
}

export interface BillingFilterDraft {
  userSel: string[]
  orgSel: string[]
  start?: Date
  end?: Date
}

export interface BillingQueryParams extends BillingFilter {
  p?: number
  page_size?: number
}

export type BillingRechargeSource =
  | 'online_topup'
  | 'user_adjust'
  | 'org_adjust'
  | 'wallet_transfer_in'
  | 'wallet_transfer_out'

export interface BillingRechargeRecord {
  source: BillingRechargeSource | string
  created_at: number
  user_id: number
  username: string
  org_id: number
  org_name: string
  quota: number
  money: number
  payment_method: string
  trade_no: string
  operator: string
  action: string
}

/**
 * Recharge ledger totals, split by funding origin so the books reconcile:
 * online (self-service card payment), offline (admin adjustment after an
 * offline bank transfer) and internal (wallet ↔ pool moves, which create no new
 * money). `inflow_quota`/`outflow_quota` only count the external two, so
 * "total recharged" never inflates when a customer moves balance around.
 */
export interface BillingRechargeStat {
  count: number
  total_quota: number
  inflow_quota: number
  outflow_quota: number
  online_inflow_quota: number
  offline_inflow_quota: number
  transfer_in_quota: number
  transfer_out_quota: number
  balance_quota: number
}

export interface BillingConsumptionStat {
  request_count: number
  consume_quota: number
  refund_quota: number
  total_tokens: number
  balance_quota: number
}

export interface BillingConsumptionRow {
  id: number
  created_at: number
  user_id: number
  username: string
  token_name: string
  model_name: string
  type: number
  quota: number
  prompt_tokens: number
  completion_tokens: number
  request_id: string
  /** Raw log `other` JSON: carries original_quota / discount / billing_source. */
  other?: string
}

export interface BillingApiResponse<T> {
  success: boolean
  message: string
  data: T
}

// ============================================================================
// Channel Billing (upstream reconciliation) — admin only
// ============================================================================

/** Per-model upstream contract price, in USD per 1M tokens. */
export interface UpstreamPrice {
  input: number
  output: number
}

/**
 * Rate card keyed by model name. An empty card means the channel has no
 * configured price, so its rows fall back to pure-token reconciliation.
 */
export type UpstreamPrices = Record<string, UpstreamPrice>

/**
 * Channel + model + date-range filter for the channel billing views.
 * `channelSel` follows the same scope convention as the user/org selects:
 * empty or [BILLING_SCOPE_ALL] means every channel; otherwise a list of ids.
 */
export interface ChannelBillingFilter {
  channelSel: string[]
  modelName: string
  start?: number
  end?: number
}

export interface ChannelBillingQueryParams extends ChannelBillingFilter {
  p?: number
  page_size?: number
}

/** One aggregated reconciliation row: date x channel x model. */
export interface ChannelBillingRecord {
  date: number
  channel_id: number
  channel_name: string
  model_name: string
  request_count: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  /** Estimated upstream cost in quota units; 0 when the price is unknown. */
  estimated_cost_quota: number
  /** False = no rate card for this channel/model, so cost is unknown (not $0). */
  price_configured: boolean
}

export interface ChannelBillingStat {
  request_count: number
  total_tokens: number
  prompt_tokens: number
  completion_tokens: number
  estimated_cost_quota: number
  channel_count: number
  priced_channel_count: number
  unpriced_record_count: number
}

/**
 * A raw log row in the detail/audit view (consume + refund + settle rows).
 * Field names mirror the backend `Log` JSON tags: `channel` is the channel id.
 */
export interface ChannelBillingDetailRow {
  id: number
  created_at: number
  channel: number
  channel_name: string
  model_name: string
  type: number
  username: string
  token_name: string
  prompt_tokens: number
  completion_tokens: number
  upstream_prompt_tokens: number
  upstream_completion_tokens: number
  cache_hit: boolean
  task_settle: boolean
  request_id?: string
  upstream_request_id?: string
}
