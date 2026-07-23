import { useCallback, useEffect, useState } from 'react'

import {
  getInitialVideoConfig,
  saveVideoConfig,
} from '../lib/storage/video-storage'
import { useVideoHandler } from '../hooks/use-video-handler'
import type {
  GroupOption,
  ModelOption,
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
  isModelLoading?: boolean
}

export function PlaygroundVideoMode({
  model,
  group,
  models,
  groups,
  onModelChange,
  onGroupChange,
  isModelLoading,
}: PlaygroundVideoModeProps) {
  const [videoConfig, setVideoConfig] = useState<VideoConfig>(() => {
    const initial = getInitialVideoConfig()
    return { ...initial, model, group }
  })

  // Sync model/group from parent (shared with chat mode)
  useEffect(() => {
    setVideoConfig((prev) => {
      const next = { ...prev, model, group }
      if (
        prev.model !== model ||
        prev.group !== group
      ) {
        saveVideoConfig(next)
      }
      return next
    })
  }, [model, group])

  const handleConfigChange = useCallback((next: VideoConfig) => {
    setVideoConfig(next)
    saveVideoConfig(next)
  }, [])

  const { videoTasks, isGenerating, submitVideo, stopPolling, clearTasks, uploadMediaItem, uploadProgress } =
    useVideoHandler(videoConfig)

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
          isGenerating={isGenerating}
          models={models}
          onClearTasks={clearTasks}
          onConfigChange={handleConfigChange}
          onGroupChange={onGroupChange}
          onModelChange={onModelChange}
          onStop={stopPolling}
          onSubmit={submitVideo}
          onUploadMediaItem={uploadMediaItem}
          uploadProgress={uploadProgress}
        />
      </div>
    </div>
  )
}
