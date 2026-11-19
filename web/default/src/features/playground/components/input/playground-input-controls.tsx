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
import { SendIcon, SquareIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { PromptInputButton } from '@/components/ai-elements/prompt-input'
import { ModelGroupSelector } from '@/components/model-group-selector'
import { Input } from '@/components/ui/input'
import { getModelCategory } from '@/lib/model-category'

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
  onTemperatureChange: (value: number) => void
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

  // 采样温度草稿：输入过程中不实时提交，失焦/回车时才校验并写回配置，
  // 避免 typing “1.” 这类中间态被规范化打断。
  const [temperatureDraft, setTemperatureDraft] = useState(
    String(temperatureValue)
  )
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTemperatureDraft(String(temperatureValue))
  }, [temperatureValue])

  const commitTemperature = () => {
    const parsed = Number.parseFloat(temperatureDraft)
    if (Number.isNaN(parsed)) {
      setTemperatureDraft(String(temperatureValue))
      return
    }
    const clamped = Math.min(2, Math.max(0, parsed))
    setTemperatureDraft(String(clamped))
    if (clamped !== temperatureValue) {
      onTemperatureChange(clamped)
    }
  }

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
      <label className='flex shrink-0 items-center gap-1.5'>
        <span className='text-muted-foreground text-xs whitespace-nowrap'>
          {t('Sampling Temperature')}
        </span>
        <Input
          type='number'
          min={0}
          max={2}
          step={0.1}
          inputMode='decimal'
          aria-label={t('Sampling Temperature')}
          className='h-8 w-16 px-2 text-xs'
          disabled={isSelectorDisabled}
          value={temperatureDraft}
          onChange={(event) => setTemperatureDraft(event.target.value)}
          onBlur={commitTemperature}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // 阻止表单隐式提交，回车只确认温度值
              event.preventDefault()
              commitTemperature()
            }
          }}
        />
      </label>
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
