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
import { useTranslation } from 'react-i18next'

import { StatusBadge, type StatusBadgeProps } from '@/components/status-badge'

import type { UsageLog } from '../../data/schema'
import { useLogBodies } from '../../hooks/use-log-bodies'
import { getLogTypeConfig } from '../../lib/utils'
import { RelayDetailsDialog, prettyJson } from './relay-details-dialog'
import { UsageBillingSections } from './usage-billing-sections'

/**
 * 通用日志详情弹窗：摘要文本列与行尾超管按钮共用同一份入口逻辑；请求/返回
 * 快照仅在弹窗打开时按需拉取（大 JSON 存独立表、不进列表）。
 */
export function CommonLogDetailsDialog({
  log,
  isAdmin,
  open,
  onOpenChange,
}: {
  log: UsageLog
  isAdmin: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const typeConfig = getLogTypeConfig(log.type)
  const { requestData, responseData } = useLogBodies(log.request_id, open)

  return (
    <RelayDetailsDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        <>
          {t('Log Details')}
          <StatusBadge
            label={t(typeConfig.label)}
            variant={typeConfig.color as StatusBadgeProps['variant']}
            size='sm'
            copyable={false}
          />
        </>
      }
      description={t('View the complete details for this log entry')}
      requestModel={log.model_name || undefined}
      requestJson={prettyJson(requestData)}
      responseJson={prettyJson(responseData)}
      extraSections={<UsageBillingSections log={log} isAdmin={isAdmin} />}
    />
  )
}
