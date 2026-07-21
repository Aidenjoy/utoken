import {
  ImageIcon,
  SendIcon,
  SquareIcon,
  Trash2Icon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ModelGroupSelector } from '@/components/model-group-selector'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import {
  ASPECT_RATIOS,
  DURATION_OPTIONS,
  RESOLUTIONS,
  VIDEO_COUNT_RANGE,
  VIDEO_MODES,
} from '../../constants'
import type {
  AspectRatio,
  GroupOption,
  ModelOption,
  Resolution,
  VideoConfig,
  VideoMode,
} from '../../types'

interface PlaygroundVideoInputProps {
  config: VideoConfig
  onConfigChange: (config: VideoConfig) => void
  onSubmit: (prompt: string) => void
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  models: ModelOption[]
  groups: GroupOption[]
  onModelChange: (model: string) => void
  onGroupChange: (group: string) => void
  onClearTasks?: () => void
  hasTasks?: boolean
}

export function PlaygroundVideoInput({
  config,
  onConfigChange,
  onSubmit,
  onStop,
  disabled,
  isGenerating,
  models,
  groups,
  onModelChange,
  onGroupChange,
  onClearTasks,
  hasTasks,
}: PlaygroundVideoInputProps) {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const maxImages =
    VIDEO_MODES.find((m) => m.value === config.mode)?.maxImages ?? 1

  const updateField = <K extends keyof VideoConfig>(
    key: K,
    value: VideoConfig[K]
  ) => {
    onConfigChange({ ...config, [key]: value })
  }

  const handleModeChange = (mode: string) => {
    const newMax =
      VIDEO_MODES.find((m) => m.value === mode)?.maxImages ?? 1
    const trimmedImages = config.images.slice(0, newMax)
    onConfigChange({ ...config, mode: mode as VideoMode, images: trimmedImages })
  }

  const handleSubmit = () => {
    if (!prompt.trim()) return
    onSubmit(prompt.trim())
    setPrompt('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const remaining = maxImages - config.images.length
    if (remaining <= 0) {
      toast.error(
        config.mode === 'first_last_frame'
          ? t('最多上传2张图片（首帧和尾帧）')
          : t('最多上传1张参考图片')
      )
      return
    }

    const newImages: string[] = []
    for (const file of Array.from(files).slice(0, remaining)) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(t('Image size must be less than 10MB'))
        continue
      }
      const dataUrl = await fileToBase64(file)
      newImages.push(dataUrl)
    }

    if (newImages.length > 0) {
      updateField('images', [...config.images, ...newImages])
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const removeImage = (index: number) => {
    const images = config.images.filter((_, i) => i !== index)
    updateField('images', images)
  }

  return (
    <div className='grid shrink-0 gap-3 px-1 md:pb-4'>
      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
        multiple
        className='hidden'
        onChange={handleImageUpload}
      />

      {/* Prompt input card */}
      <div className='bg-background/95 dark:bg-background/80 border-border/70 shadow-[0_18px_60px_-32px_rgba(0,0,0,0.65)] ring-1 ring-foreground/5 relative rounded-xl border overflow-hidden transition-all duration-200 focus-within:border-primary/45 focus-within:ring-primary/15'>
        {/* Reference images */}
        {config.images.length > 0 && (
          <div className='flex flex-wrap gap-2 border-border/60 border-b p-3'>
            {config.images.map((img, i) => (
              <div
                key={i}
                className='group relative size-16 overflow-hidden rounded-lg border'
              >
                <img
                  src={img}
                  alt={`ref-${i}`}
                  className='size-full object-cover'
                />
                <span className='bg-background/80 absolute bottom-0.5 left-0.5 rounded px-1 py-0.5 text-[10px] font-medium'>
                  {config.mode === 'first_last_frame'
                    ? i === 0
                      ? '首帧'
                      : '尾帧'
                    : '参考图'}
                </span>
                <button
                  onClick={() => removeImage(i)}
                  className='bg-background/80 absolute top-0.5 right-0.5 hidden size-5 items-center justify-center rounded-full text-xs opacity-0 transition-opacity group-hover:flex group-hover:opacity-100'
                >
                  ✕
                </button>
              </div>
            ))}
            {/* Empty slots for first_last_frame mode */}
            {config.mode === 'first_last_frame' &&
              config.images.length < 2 && (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                  className='border-border/60 border-dashed text-muted-foreground hover:border-primary hover:text-primary flex size-16 items-center justify-center rounded-lg border-2 text-[10px] transition-colors'
                >
                  {config.images.length === 0 ? '首帧' : '尾帧'}
                </button>
              )}
          </div>
        )}

        {/* Text area */}
        <textarea
          className='min-h-20 w-full resize-none px-5 pt-4 pb-3 leading-7 md:min-h-24 md:text-base focus:outline-none'
          disabled={disabled}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('Describe the video you want to generate...')}
          value={prompt}
        />

        {/* Configuration bar */}
        <div className='border-border/60 bg-muted/20 dark:bg-muted/10 flex flex-wrap items-center gap-1.5 border-t px-3 py-2 backdrop-blur'>
          {/* Mode selector */}
          <ConfigDropdown
            label={
              VIDEO_MODES.find((m) => m.value === config.mode)?.label ||
              '参考生成'
            }
            options={VIDEO_MODES.map((m) => ({
              value: m.value,
              label: m.label,
            }))}
            value={config.mode}
            onChange={handleModeChange}
          />

          {/* Upload button */}
          <button
            className='text-muted-foreground hover:text-foreground hover:bg-muted/70 flex size-8 items-center justify-center rounded-lg transition-colors'
            disabled={disabled || config.images.length >= maxImages}
            onClick={() => fileInputRef.current?.click()}
            title={t('Upload reference images')}
          >
            <ImageIcon size={16} />
          </button>

          {/* Ratio selector */}
          <ConfigDropdown
            label={config.ratio === 'smart' ? t('Smart Ratio') : config.ratio}
            options={ASPECT_RATIOS.map((r) => ({
              value: r.value,
              label: r.label,
            }))}
            value={config.ratio}
            onChange={(v) => updateField('ratio', v as AspectRatio)}
          />

          {/* Resolution selector */}
          <ConfigButtonGroup
            label={config.resolution}
            options={RESOLUTIONS.map((r) => ({ value: r, label: r }))}
            value={config.resolution}
            onChange={(v) => updateField('resolution', v as Resolution)}
          />

          {/* Duration selector */}
          <ConfigButtonGroup
            label={`${config.duration}s`}
            options={DURATION_OPTIONS.map((d) => ({
              value: String(d),
              label: `${d}s`,
            }))}
            value={String(config.duration)}
            onChange={(v) => updateField('duration', parseInt(v))}
          />

          {/* Count selector */}
          <ConfigDropdown
            label={`${config.count} ${t('videos')}`}
            options={Array.from(
              { length: VIDEO_COUNT_RANGE.max },
              (_, i) => i + 1
            ).map((n) => ({ value: String(n), label: String(n) }))}
            value={String(config.count)}
            onChange={(v) => updateField('count', parseInt(v))}
          />

          {/* Audio toggle */}
          <button
            className={cn(
              'flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors',
              config.audio
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            )}
            disabled={disabled}
            onClick={() => updateField('audio', !config.audio)}
          >
            {config.audio ? (
              <Volume2Icon size={14} />
            ) : (
              <VolumeXIcon size={14} />
            )}
            <span className='hidden sm:inline'>
              {config.audio ? t('Audio') : t('Muted')}
            </span>
          </button>

          {/* Clear button */}
          {hasTasks && onClearTasks && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    className='text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex size-8 items-center justify-center rounded-lg transition-colors'
                    disabled={disabled}
                    onClick={onClearTasks}
                  />
                }
              >
                <Trash2Icon size={16} />
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('Clear tasks')}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Footer with model selector and submit */}
        <div className='border-border/60 bg-muted/20 dark:bg-muted/10 flex items-center justify-between gap-2 border-t px-3 py-2.5 backdrop-blur'>
          <ModelGroupSelector
            selectedModel={config.model}
            models={models}
            onModelChange={onModelChange}
            selectedGroup={config.group}
            groups={groups}
            onGroupChange={onGroupChange}
          />

          {isGenerating ? (
            <Button
              className='border-destructive/25 bg-destructive/10 text-destructive hover:bg-destructive/15 font-medium'
              onClick={onStop}
              variant='secondary'
            >
              <SquareIcon className='fill-current' size={16} />
              <span className='hidden sm:inline'>{t('Stop')}</span>
            </Button>
          ) : (
            <Button
              className='h-8 px-3 font-medium shadow-sm'
              disabled={disabled || !prompt.trim() || !config.model}
              onClick={handleSubmit}
              size='sm'
            >
              <SendIcon size={16} />
              <span className='hidden sm:inline'>{t('Generate')}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// --- Config button group component ---
function ConfigButtonGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button className='bg-muted hover:bg-muted/70 text-foreground flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors'>
            {label}
            <span className='text-muted-foreground'>▾</span>
          </button>
        }
      />
      <PopoverContent side='top' align='start' className='w-auto p-2'>
        <div className='flex flex-wrap gap-1'>
          {options.map((opt) => (
            <button
              key={opt.value}
              className={cn(
                'flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors',
                value === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted hover:bg-muted/70 text-foreground'
              )}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
            >
              {t(opt.label)}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// --- Config dropdown (for ratio and count) ---
function ConfigDropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button className='bg-muted hover:bg-muted/70 text-foreground flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors'>
            {label}
            <span className='text-muted-foreground'>▾</span>
          </button>
        }
      />
      <PopoverContent side='top' align='start' className='w-auto min-w-[5rem] p-1.5'>
        <div className='flex max-h-48 flex-col gap-0.5 overflow-y-auto'>
          {options.map((opt) => (
            <button
              key={opt.value}
              className={cn(
                'flex h-7 items-center rounded-md px-3 text-xs font-medium transition-colors',
                value === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted text-foreground'
              )}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
            >
              {t(opt.label)}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
