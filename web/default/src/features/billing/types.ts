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
export interface BillingFilter {
  userIds: number[]
  orgIds: number[]
  start?: number
  end?: number
}

export interface BillingFilterDraft {
  userIds: number[]
  orgIds: number[]
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

export interface BillingRechargeStat {
  count: number
  total_quota: number
  online_quota: number
  user_adjust_quota: number
  org_adjust_quota: number
}

export interface BillingConsumptionStat {
  request_count: number
  consume_quota: number
  refund_quota: number
  total_tokens: number
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
}

export interface BillingApiResponse<T> {
  success: boolean
  message: string
  data: T
}
