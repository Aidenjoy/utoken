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

import type { ChannelQuotaConfig, ChannelQuota } from '../types'

/** Displays real token dimensions without converting them to wallet currency. */
export function ChannelQuotaSummary(props: {
  quotas: (ChannelQuotaConfig | ChannelQuota)[]
  showAmounts?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className='space-y-3'>
      {props.quotas.map((quota) => (
        <div key={quota.channel_id} className='rounded-md border p-3 text-sm'>
          <p className='font-medium'>
            {t('Channel {{id}}', { id: quota.channel_id })}
          </p>
          <p className='text-muted-foreground text-xs break-words'>
            {quota.models.join(', ')}
          </p>
          {!props.showAmounts &&
            'available' in quota &&
            typeof quota.available === 'boolean' && (
              <p className='mt-2'>
                {quota.available
                  ? t('Available')
                  : t('Plan allowance exhausted')}
              </p>
            )}
          {props.showAmounts &&
            (quota.unit !== 'input_output_tokens' ? (
              <div className='mt-2 space-y-1'>
                <p className='font-medium'>
                  {quota.unit === 'completed_videos'
                    ? t('Completed videos')
                    : t('Image count')}
                </p>
                <p>
                  {t('Limit')}: {(quota.quantity_limit ?? 0).toLocaleString()}
                </p>
                {'quantity_used' in quota && (
                  <>
                    <p>
                      {t('Used')}: {(quota.quantity_used ?? 0).toLocaleString()}
                    </p>
                    <p>
                      {t('Reserved')}:{' '}
                      {(quota.quantity_reserved ?? 0).toLocaleString()}
                    </p>
                    <p>
                      {t('Available')}:{' '}
                      {Math.max(
                        0,
                        (quota.quantity_limit ?? 0) -
                          (quota.quantity_used ?? 0) -
                          (quota.quantity_reserved ?? 0)
                      ).toLocaleString()}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <>
                <p className='text-muted-foreground mt-1 text-xs'>
                  {t('Input / output tokens')}
                </p>
                <div className='mt-2 grid grid-cols-2 gap-3'>
                  {(['input', 'output'] as const).map((dimension) => {
                    const limit = quota[`${dimension}_limit`] ?? 0
                    const balance = 'input_used' in quota ? quota : undefined
                    const used = balance?.[`${dimension}_used`] ?? 0
                    const reserved = balance?.[`${dimension}_reserved`] ?? 0
                    return (
                      <div key={dimension} className='space-y-1'>
                        <p className='font-medium'>
                          {dimension === 'input'
                            ? t('Input tokens')
                            : t('Output tokens')}
                        </p>
                        <p>
                          {t('Limit')}: {limit.toLocaleString()}
                        </p>
                        {balance && (
                          <>
                            <p>
                              {t('Used')}: {used.toLocaleString()}
                            </p>
                            <p>
                              {t('Reserved')}: {reserved.toLocaleString()}
                            </p>
                            <p>
                              {t('Available')}:{' '}
                              {Math.max(
                                0,
                                limit - used - reserved
                              ).toLocaleString()}
                            </p>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            ))}
        </div>
      ))}
    </div>
  )
}
