import { useCallback, useEffect, useState } from 'react'

import { useVideoHandler } from '../hooks/use-video-handler'
import { getChannelModelOptions } from '../lib/options/playground-option-utils'
import {
  getInitialVideoConfig,
  saveVideoConfig,
} from '../lib/storage/video-storage'
import type {
  GroupOption,
  ModelOption,
  PlaygroundChannel,
  VideoConfig,
} from '../types'
import { PlaygroundVideoChat } from './video/playground-video-chat'
import { PlaygroundVideoInput } from './video/playground-video-input'

interface PlaygroundVideoModeProps {
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

export function PlaygroundVideoMode({
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
}: PlaygroundVideoModeProps) {
  const [videoConfig, setVideoConfig] = useState<VideoConfig>(() => {
    const initial = getInitialVideoConfig()
    return { ...initial, model, group }
  })

  // Sync model/group/channel from parent (shared with chat and image modes)
  useEffect(() => {
    setVideoConfig((prev) => {
      const next = { ...prev, model, group, channelId: channelValue }
      if (
        prev.model !== model ||
        prev.group !== group ||
        prev.channelId !== channelValue
      ) {
        saveVideoConfig(next)
      }
      return next
    })
  }, [model, group, channelValue])

  const handleConfigChange = useCallback((next: VideoConfig) => {
    setVideoConfig(next)
    saveVideoConfig(next)
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

  const {
    videoTasks,
    isGenerating,
    submitVideo,
    stopPolling,
    clearTasks,
    uploadMediaItem,
    uploadProgress,
  } = useVideoHandler(videoConfig)

  // 提交成功后清空参考素材与首尾帧图片：任务已携带这些素材，
  // 留在输入区只会迫使下次生成前手动删除。失败时保留以便重试。
  const handleSubmit = useCallback(
    async (prompt: string) => {
      const submitted = await submitVideo(prompt)
      if (!submitted) return
      setVideoConfig((prev) => {
        const next = { ...prev, images: [], mediaItems: [] }
        saveVideoConfig(next)
        return next
      })
    },
    [submitVideo]
  )

  return (
    <div className='relative flex size-full min-h-0 flex-col overflow-hidden'>
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        <PlaygroundVideoChat tasks={videoTasks} onClear={clearTasks} />
      </div>

      <div className='mx-auto w-full max-w-4xl'>
        <PlaygroundVideoInput
          config={videoConfig}
          disabled={isGenerating}
          groups={groups}
          hasTasks={videoTasks.length > 0}
          initialText={initialText}
          isGenerating={isGenerating}
          models={channelModels}
          onClearTasks={clearTasks}
          onConfigChange={handleConfigChange}
          onGroupChange={onGroupChange}
          onModelChange={onModelChange}
          onStop={stopPolling}
          onSubmit={handleSubmit}
          onUploadMediaItem={uploadMediaItem}
          uploadProgress={uploadProgress}
          showChannelSelector={showChannelSelector}
          channels={channels}
          onChannelChange={onChannelChange}
        />
      </div>
    </div>
  )
}
