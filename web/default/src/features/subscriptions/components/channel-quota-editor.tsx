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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { getMembershipChannels } from '../api'
import {
  channelQuotaUnitLabels,
  type ChannelQuotaConfig,
  type MembershipChannelOption,
} from '../types'

function quotaFromChannel(
  channel: MembershipChannelOption
): ChannelQuotaConfig {
  const count = channel.unit !== 'input_output_tokens'
  return {
    channel_id: channel.id,
    profile: channel.profile,
    unit: channel.unit,
    models: channel.models,
    input_limit: count ? 0 : 1000000,
    output_limit: count ? 0 : 200000,
    quantity_limit: count ? 100 : 0,
  }
}

/** Edits draft plan rights; activated subscription snapshots are never deleted or changed. */
export function ChannelQuotaEditor(props: {
  value: ChannelQuotaConfig[]
  onChange: (value: ChannelQuotaConfig[]) => void
}) {
  const { t } = useTranslation()
  const channels = useQuery({
    queryKey: ['membership-channel-options'],
    queryFn: getMembershipChannels,
  })
  const options = channels.data?.data ?? []
  return (
    <div className='space-y-3'>
      <p className='text-muted-foreground text-sm'>
        {t('Channel membership never falls back to wallet balance.')}
      </p>
      {channels.isError && <p role='alert'>{t('Failed to load channels')}</p>}
      {props.value.map((quota, index) => (
        <div key={quota.channel_id} className='space-y-3 rounded-md border p-3'>
          <Label>{t('Channel')}</Label>
          <Select
            value={`${quota.channel_id}:${quota.profile}`}
            items={options.map((item) => ({
              value: `${item.id}:${item.profile}`,
              label: `#${item.id} ${item.name} · ${t(channelQuotaUnitLabels[item.unit])}`,
            }))}
            onValueChange={(value) => {
              const channel = options.find(
                (item) => `${item.id}:${item.profile}` === value
              )
              if (channel) {
                props.onChange(
                  props.value.map((item, i) =>
                    i === index ? quotaFromChannel(channel) : item
                  )
                )
              }
            }}
          >
            <SelectTrigger aria-label={t('Channel')}>
              <SelectValue placeholder={t('Select a channel')} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {options
                  .filter(
                    (item) =>
                      item.id === quota.channel_id ||
                      !props.value.some((q) => q.channel_id === item.id)
                  )
                  .map((item) => (
                    <SelectItem
                      key={`${item.id}:${item.profile}`}
                      value={`${item.id}:${item.profile}`}
                    >
                      #{item.id} {item.name} ·{' '}
                      {t(channelQuotaUnitLabels[item.unit])}
                    </SelectItem>
                  ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p className='text-muted-foreground text-xs'>
            {quota.models.join(', ')}
          </p>
          {quota.unit !== 'input_output_tokens' ? (
            <div className='space-y-1'>
              <Label htmlFor={`membership-${index}-quantity`}>
                {t(channelQuotaUnitLabels[quota.unit])}
              </Label>
              <Input
                id={`membership-${index}-quantity`}
                type='number'
                min={1}
                max={2147483647}
                step={1}
                value={quota.quantity_limit ?? 0}
                onChange={(event) =>
                  props.onChange(
                    props.value.map((item, i) =>
                      i === index
                        ? {
                            ...item,
                            quantity_limit: Number(event.target.value),
                          }
                        : item
                    )
                  )
                }
              />
            </div>
          ) : (
            <div className='grid grid-cols-2 gap-3'>
              {(['input', 'output'] as const).map((dimension) => (
                <div key={dimension} className='space-y-1'>
                  <Label htmlFor={`membership-${index}-${dimension}`}>
                    {dimension === 'input'
                      ? t('Input tokens')
                      : t('Output tokens')}
                  </Label>
                  <Input
                    id={`membership-${index}-${dimension}`}
                    type='number'
                    min={1}
                    max={2147483647}
                    step={1}
                    value={quota[`${dimension}_limit`]}
                    onChange={(event) =>
                      props.onChange(
                        props.value.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                [`${dimension}_limit`]: Number(
                                  event.target.value
                                ),
                              }
                            : item
                        )
                      )
                    }
                  />
                </div>
              ))}
            </div>
          )}
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() =>
              props.onChange(props.value.filter((_, i) => i !== index))
            }
          >
            {t('Remove channel from plan')}
          </Button>
        </div>
      ))}
      <Button
        type='button'
        variant='outline'
        disabled={
          channels.isPending ||
          !options.some(
            (item) => !props.value.some((quota) => quota.channel_id === item.id)
          )
        }
        onClick={() => {
          const channel = options.find(
            (item) => !props.value.some((quota) => quota.channel_id === item.id)
          )
          if (channel) {
            props.onChange([...props.value, quotaFromChannel(channel)])
          }
        }}
      >
        {t('Add channel')}
      </Button>
    </div>
  )
}
