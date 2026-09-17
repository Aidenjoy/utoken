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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { toast } from 'sonner'

import { updateSystemOption } from '../api'
import type { UpdateOptionRequest } from '../types'

// Configuration keys that require status refresh
const STATUS_RELATED_KEYS = [
  'theme.frontend',
  'HeaderNavModules',
  'SidebarModulesAdmin',
  'Notice',
  'LogConsumeEnabled',
  'QuotaPerUnit',
  'USDExchangeRate',
  'DisplayInCurrencyEnabled',
  'DisplayTokenStatEnabled',
  'general_setting.quota_display_type',
  'general_setting.custom_currency_symbol',
  'general_setting.custom_currency_exchange_rate',
]

// 模型广场 /api/pricing 的 react-query 缓存（queryKey ['pricing']，staleTime 5 分钟）。
// 管理员在系统设置里改模型价后，若不同步失效这份缓存，切到广场页在 5 分钟内仍会
// 命中旧的新鲜缓存不重新拉取，表现为「保存成功但广场价格过一会才变」。这里列出
// 所有会影响广场展示的定价项，保存成功后一并失效 ['pricing']。
const PRICING_RATIO_KEYS = new Set([
  'ModelRatio',
  'ModelPrice',
  'CompletionRatio',
  'CacheRatio',
  'CreateCacheRatio',
  'ImageRatio',
  'AudioRatio',
  'AudioCompletionRatio',
])

function isPricingRelatedKey(key: string): boolean {
  return PRICING_RATIO_KEYS.has(key) || key.startsWith('billing_setting.')
}

export function useUpdateOption() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: UpdateOptionRequest) => updateSystemOption(request),
    onSuccess: (data, variables) => {
      if (data.success) {
        // Always refresh system-options
        queryClient.invalidateQueries({ queryKey: ['system-options'] })

        // 改到模型定价相关项时失效模型广场缓存，确保切过去立即拉到最新价格
        if (isPricingRelatedKey(variables.key)) {
          queryClient.invalidateQueries({ queryKey: ['pricing'] })
        }

        // If updating frontend-display-related config, also refresh status
        if (STATUS_RELATED_KEYS.includes(variables.key)) {
          queryClient.invalidateQueries({ queryKey: ['status'] })
          try {
            window.localStorage.removeItem('status')
          } catch {
            /* empty */
          }
        }

        // 批量保存会按变更键逐个提交、连续触发多次 onSuccess；
        // 固定 id 让 sonner 复用同一条提示，避免堆叠出 N 条成功弹窗。
        toast.success(i18next.t('Setting updated successfully'), {
          id: 'system-option-update-success',
        })
      } else {
        toast.error(data.message || i18next.t('Failed to update setting'))
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || i18next.t('Failed to update setting'))
    },
  })
}
