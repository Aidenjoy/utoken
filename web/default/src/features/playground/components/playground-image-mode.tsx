import { useCallback, useEffect, useState } from 'react'

import { useImageHandler } from '../hooks/use-image-handler'
import { normalizeImageConfig } from '../lib/image-utils'
import {
  getInitialImageConfig,
  saveImageConfig,
} from '../lib/storage/image-storage'
import type { GroupOption, ImageConfig, ModelOption } from '../types'
import { PlaygroundImageChat } from './image/playground-image-chat'
import { PlaygroundImageInput } from './image/playground-image-input'

interface PlaygroundImageModeProps {
  model: string
  group: string
  models: ModelOption[]
  groups: GroupOption[]
  onModelChange: (model: string) => void
  onGroupChange: (group: string) => void
}

export function PlaygroundImageMode({
  model,
  group,
  models,
  groups,
  onModelChange,
  onGroupChange,
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
      const next = normalizeImageConfig({ ...prev, group }, model)
      if (
        prev.model !== next.model ||
        prev.group !== next.group ||
        prev.size !== next.size ||
        prev.outputFormat !== next.outputFormat ||
        prev.count !== next.count
      ) {
        saveImageConfig(next)
      }
      return next
    })
  }, [model, group])

  const handleConfigChange = useCallback((next: ImageConfig) => {
    setImageConfig(next)
    saveImageConfig(next)
  }, [])

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
          isGenerating={isGenerating}
          models={models}
          onClearTasks={clearTasks}
          onConfigChange={handleConfigChange}
          onGroupChange={onGroupChange}
          onModelChange={onModelChange}
          onStop={stop}
          onSubmit={generate}
        />
      </div>
    </div>
  )
}
