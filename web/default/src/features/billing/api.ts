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
import { api } from '@/lib/api'

import {
  billingScopeToParam,
  type BillingApiResponse,
  type BillingConsumptionRow,
  type BillingConsumptionStat,
  type BillingQueryParams,
  type BillingRechargeRecord,
  type BillingRechargeStat,
} from './types'

function toQueryParams(filter: BillingQueryParams): Record<string, string> {
  const params: Record<string, string> = {}
  const userIds = billingScopeToParam(filter.userSel)
  if (userIds) params.user_ids = userIds
  const orgIds = billingScopeToParam(filter.orgSel)
  if (orgIds) params.org_ids = orgIds
  if (filter.start) params.start_timestamp = String(filter.start)
  if (filter.end) params.end_timestamp = String(filter.end)
  if (filter.p) params.p = String(filter.p)
  if (filter.page_size) params.page_size = String(filter.page_size)
  return params
}

// Agents hit the scoped /api/agent/billing/* endpoints (server restricts to the
// agent's members and drops admin-only fields); admins use /api/billing/*.
function billingPath(isAgent: boolean, suffix: string): string {
  return isAgent ? `/api/agent/billing${suffix}` : `/api/billing${suffix}`
}

export interface BillingRechargeData {
  records: BillingRechargeRecord[]
  stat: BillingRechargeStat
}

export async function getBillingRecharge(
  filter: BillingQueryParams,
  isAgent = false
): Promise<BillingApiResponse<BillingRechargeData>> {
  const res = await api.get(billingPath(isAgent, '/recharge'), {
    params: toQueryParams(filter),
    disableDuplicate: true,
  })
  return res.data
}

export interface BillingConsumptionData {
  items: BillingConsumptionRow[]
  total: number
  stat: BillingConsumptionStat
  user_org: Record<string, number>
  org_names: Record<string, string>
}

export async function getBillingConsumption(
  filter: BillingQueryParams,
  isAgent = false
): Promise<BillingApiResponse<BillingConsumptionData>> {
  const res = await api.get(billingPath(isAgent, '/consumption'), {
    params: toQueryParams(filter),
    disableDuplicate: true,
  })
  return res.data
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export async function downloadBillingRecharge(
  filter: BillingQueryParams,
  isAgent = false
): Promise<void> {
  const res = await api.get(billingPath(isAgent, '/recharge/export'), {
    params: toQueryParams(filter),
    responseType: 'blob',
    disableDuplicate: true,
  })
  triggerBlobDownload(res.data as Blob, 'billing-recharge.csv')
}

export async function downloadBillingConsumption(
  filter: BillingQueryParams,
  isAgent = false
): Promise<void> {
  const res = await api.get(billingPath(isAgent, '/consumption/export'), {
    params: toQueryParams(filter),
    responseType: 'blob',
    disableDuplicate: true,
  })
  triggerBlobDownload(res.data as Blob, 'billing-consumption.csv')
}
