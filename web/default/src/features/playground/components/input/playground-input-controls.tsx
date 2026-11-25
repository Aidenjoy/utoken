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
import { Check, ChevronsUpDown, SendIcon, SquareIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { ModelGroupSelector } from '@/components/model-group-selector'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { getModelCategory } from '@/lib/model-category'
import { cn } from '@/lib/utils'

import { TEMPERATURE_OPTIONS } from '../../constants'
import { getInputControlState } from '../../lib'
import type { GroupOption, ModelOption, PlaygroundChannel } from '../../types'
import { PlaygroundChannelSelector } from './playground-channel-selector'

type PlaygroundInputControlsProps = {
  disabled?: boolean
  groups: GroupOption[]
  groupValue: string
  isGenerating?: boolean
  isModelLoading?: boolean
  models: ModelOption[]
  modelValue: string
  onGroupChange: (value: string) => void
  onModelChange: (value: string) => void
  onStop?: () => void
  text: string
  tools: ReactNode
  showChannelSelector?: boolean
  channels?: PlaygroundChannel[]
  channelValue?: number
  onChannelChange?: (value: number) => void
  temperatureValue: number
  temperatureEnabled: boolean
  onTemperatureChange: (value: number | null) => void
}

export function PlaygroundInputControls({
  disabled,
  groups,
  groupValue,
  isGenerating,
  isModelLoading = false,
  models,
  modelValue,
  onGroupChange,
  onModelChange,
  onStop,
  text,
  tools,
  showChannelSelector = false,
  channels = [],
  channelValue = 0,
  onChannelChange,
  temperatureValue,
  temperatureEnabled,
  onTemperatureChange,
}: PlaygroundInputControlsProps) {
  const { t } = useTranslation()
  const { canSubmit, isSelectorDisabled, shouldShowStop } =
    getInputControlState({
      disabled,
      groups,
      hasStopHandler: Boolean(onStop),
      isGenerating,
      isModelLoading,
      models,
      text,
    })

  // 采样温度下拉：预设值 + “关闭”（省略 temperature 参数）。
  // 旧版自由输入可能存下预设外的温度，把当前值补进候选，避免下拉吞掉已有配置。
  const [temperatureOpen, setTemperatureOpen] = useState(false)
  const temperatureOptions = TEMPERATURE_OPTIONS.includes(temperatureValue)
    ? TEMPERATURE_OPTIONS
    : [temperatureValue, ...TEMPERATURE_OPTIONS]

  const renderTemperaturePicker = () => (
    <label className='flex shrink-0 items-center gap-1.5'>
      <span className='text-muted-foreground text-xs whitespace-nowrap'>
        {t('Sampling Temperature')}
      </span>
      <Popover open={temperatureOpen} onOpenChange={setTemperatureOpen}>
        <PopoverTrigger
          render={
            <button
              type='button'
              className='bg-background/80 hover:bg-accent/70 text-foreground flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors'
              aria-label={t('Sampling Temperature')}
              disabled={isSelectorDisabled}
            >
              <span>
                {temperatureEnabled ? String(temperatureValue) : t('Off')}
              </span>
              <ChevronsUpDown className='text-muted-foreground size-3.5 shrink-0 opacity-60' />
            </button>
          }
        />
        <PopoverContent side='top' align='start' className='w-32 p-1'>
          {temperatureOptions.map((value) => (
            <button
              type='button'
              key={value}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                temperatureEnabled && temperatureValue === value
                  ? 'bg-accent'
                  : 'hover:bg-accent'
              )}
              onClick={() => {
                onTemperatureChange(value)
                setTemperatureOpen(false)
              }}
            >
              <span>{value}</span>
              <Check
                className={cn(
                  'size-3.5',
                  temperatureEnabled && temperatureValue === value
                    ? 'opacity-100'
                    : 'opacity-0'
                )}
              />
            </button>
          ))}
          <button
            type='button'
            className={cn(
              'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              !temperatureEnabled ? 'bg-accent' : 'hover:bg-accent'
            )}
            onClick={() => {
              onTemperatureChange(null)
              setTemperatureOpen(false)
            }}
          >
            <span>{t('Off')}</span>
            <Check
              className={cn(
                'size-3.5',
                !temperatureEnabled ? 'opacity-100' : 'opacity-0'
              )}
            />
          </button>
        </PopoverContent>
      </Popover>
    </label>
  )

  const renderSelector = () => (
    <div className='flex min-w-0 items-center gap-2'>
      {showChannelSelector && onChannelChange && (
        <PlaygroundChannelSelector
          value={channelValue}
          channels={channels}
          onChange={onChannelChange}
        />
      )}
      <ModelGroupSelector
        selectedModel={modelValue}
        models={models}
        onModelChange={onModelChange}
        selectedGroup={groupValue}
        groups={groups}
        onGroupChange={onGroupChange}
        categorizeModel={getModelCategory}
        disabled={isSelectorDisabled}
      />
      {renderTemperaturePicker()}
    </div>
  )

  const renderSubmitButton = () =>
    shouldShowStop ? (
      <PromptInputButton
        className='border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15 font-medium'
        onClick={onStop}
        variant='secondary'
      >
        <SquareIcon className='fill-current' size={16} />
        <span className='hidden sm:inline'>{t('Stop')}</span>
        <span className='sr-only sm:hidden'>{t('Stop')}</span>
      </PromptInputButton>
    ) : (
      <PromptInputButton
        className='bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground h-8 px-3 font-medium shadow-sm'
        disabled={!canSubmit}
        type='submit'
        variant='default'
      >
        <SendIcon size={16} />
        <span className='hidden sm:inline'>{t('Send')}</span>
        <span className='sr-only sm:hidden'>{t('Send')}</span>
      </PromptInputButton>
    )

  return (
    <div className='flex w-full flex-col gap-2.5 md:flex-row md:items-center md:justify-between'>
      {/* Selector leads on the left, matching the image/video footers */}
      <div className='flex min-w-0 items-center'>{renderSelector()}</div>

      <div className='flex items-center justify-between gap-2 md:justify-end'>
        {tools}
        {renderSubmitButton()}
      </div>
    </div>
  )
}
