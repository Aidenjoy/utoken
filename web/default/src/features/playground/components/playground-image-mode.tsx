import { useCallback, useEffect, useState } from 'react'

import { useImageHandler } from '../hooks/use-image-handler'
import { normalizeImageConfig } from '../lib/image-utils'
import { getChannelModelOptions } from '../lib/options/playground-option-utils'
import {
  getInitialImageConfig,
  saveImageConfig,
} from '../lib/storage/image-storage'
import type {
  GroupOption,
  ImageConfig,
  ModelOption,
  PlaygroundChannel,
} from '../types'
import { PlaygroundImageChat } from './image/playground-image-chat'
import { PlaygroundImageInput } from './image/playground-image-input'

interface PlaygroundImageModeProps {
  model: string
  group: string
  models: ModelOption[]
  groups: GroupOption[]
  onModelChange: (model: string) => void
  onGroupChange: (group: string) => void
  /** 渠道选择器状态由父级统一持有（三模式共享，避免模式切换时互相纠正模型） */
  channels: PlaygroundChannel[]
  showChannelSelector: boolean
  channelValue: number
  onChannelChange: (value: number) => void
  /** Prompt Library template text seeded into the composer. */
  initialText?: string
}

export function PlaygroundImageMode({
  model,
  group,
  models,
  groups,
  onModelChange,
  onGroupChange,
  initialText,
  channels,
  showChannelSelector,
  channelValue,
  onChannelChange,
}: PlaygroundImageModeProps) {
  const [imageConfig, setImageConfig] = useState<ImageConfig>(() =>
    normalizeImageConfig({ ...getInitialImageConfig(), group }, model)
  )

  // Sync model/group from parent (shared with chat and video modes). Size,
  // output format and image count are model-specific, so a model switch also
  // re-clamps them: a stored 1024x1024 sent to Ark, or a stored 4K sent to
  // Seedream 5.0 Pro, is a 400 rather than a silent fallback.
  useEffect(() => {
    setImageConfig((prev) => {
      const next = normalizeImageConfig(
        { ...prev, group, channelId: channelValue },
        model
      )
      if (
        prev.model !== next.model ||
        prev.group !== next.group ||
        prev.channelId !== next.channelId ||
        prev.size !== next.size ||
        prev.outputFormat !== next.outputFormat ||
        prev.count !== next.count
      ) {
        saveImageConfig(next)
      }
      return next
    })
  }, [model, group, channelValue])

  const handleConfigChange = useCallback((next: ImageConfig) => {
    setImageConfig(next)
    saveImageConfig(next)
  }, [])

  // 渠道选择器仅超管可见；默认 Auto 时与普通用户完全一致。
  const channelModels = getChannelModelOptions(models, channels, channelValue)

  // 先选渠道后选模型：锁定渠道后当前模型不在候选里时自动落到首个候选。
  useEffect(() => {
    if (channelModels.length === 0) return
    if (!channelModels.some((m) => m.value === model)) {
      onModelChange(channelModels[0].value)
    }
  }, [channelModels, model, onModelChange])

  const { imageTasks, isGenerating, generate, stop, clearTasks } =
    useImageHandler(imageConfig)

  return (
    <div className='relative flex size-full min-h-0 flex-col overflow-hidden'>
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        <PlaygroundImageChat tasks={imageTasks} onClear={clearTasks} />
      </div>

      <div className='mx-auto w-full max-w-4xl'>
        <PlaygroundImageInput
          config={imageConfig}
          disabled={isGenerating}
          groups={groups}
          hasTasks={imageTasks.length > 0}
          initialText={initialText}
          isGenerating={isGenerating}
          models={channelModels}
          onClearTasks={clearTasks}
          onConfigChange={handleConfigChange}
          onGroupChange={onGroupChange}
          onModelChange={onModelChange}
          onStop={stop}
          onSubmit={generate}
          showChannelSelector={showChannelSelector}
          channels={channels}
          onChannelChange={onChannelChange}
        />
      </div>
    </div>
  )
}
