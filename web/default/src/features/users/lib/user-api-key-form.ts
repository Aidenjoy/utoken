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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import type { ApiKeyFormData } from '@/features/keys/types'
import { parseQuotaFromDollars } from '@/lib/format'

// ============================================================================
// Admin quick-create form (create a key on behalf of a user)
// ============================================================================

export function getUserApiKeyFormSchema(t: TFunction) {
  return z.object({
    name: z.string().min(1, t('Please enter a name')),
    unlimited_quota: z.boolean(),
    remain_quota_dollars: z.number().min(0, t('Quota must be zero or greater')),
  })
}

export type UserApiKeyFormValues = z.infer<
  ReturnType<typeof getUserApiKeyFormSchema>
>

export const USER_API_KEY_FORM_DEFAULT_VALUES: UserApiKeyFormValues = {
  name: '',
  unlimited_quota: true,
  remain_quota_dollars: 10,
}

export type AdminCreateApiKeyPayload = ApiKeyFormData & { user_id: number }

// 与用户自行创建走同一后端接口与字段口径：永久有效、不限分组/模型/IP，
// 仅名称与额度可在代创建时指定。
export function transformUserApiKeyFormToPayload(
  data: UserApiKeyFormValues,
  userId: number
): AdminCreateApiKeyPayload {
  return {
    name: data.name,
    remain_quota: data.unlimited_quota
      ? 0
      : parseQuotaFromDollars(data.remain_quota_dollars || 0),
    expired_time: -1,
    unlimited_quota: data.unlimited_quota,
    model_limits_enabled: false,
    model_limits: '',
    allow_ips: '',
    group: '',
    cross_group_retry: false,
    user_id: userId,
  }
}
