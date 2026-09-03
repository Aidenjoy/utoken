import { ImageIcon, SendIcon, SquareIcon, Trash2Icon } from 'lucide-react'
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
import { getModelCategory } from '@/lib/model-category'
import { cn } from '@/lib/utils'

import {
  IMAGE_COUNT_RANGE,
  IMAGE_MODES,
  MAX_IMAGE_FILE_BYTES,
} from '../../constants'
import { createImageId, getImageModelProfile } from '../../lib/image-utils'
import type {
  GroupOption,
  ImageConfig,
  ImageItem,
  ImageMode,
  ImageOutputFormat,
  ModelOption,
} from '../../types'

interface PlaygroundImageInputProps {
  config: ImageConfig
  onConfigChange: (config: ImageConfig) => void
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

export function PlaygroundImageInput({
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
}: PlaygroundImageInputProps) {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Size and format vocabularies are provider-specific, and Ark 400s on a value
  // it does not know instead of falling back to its default.
  const profile = getImageModelProfile(config.model)
  const maxReferences =
    IMAGE_MODES.find((m) => m.value === config.mode)?.maxImages ?? 0

  const updateField = <K extends keyof ImageConfig>(
    key: K,
    value: ImageConfig[K]
  ) => {
    onConfigChange({ ...config, [key]: value })
  }

  const handleSubmit = () => {
    const trimmed = prompt.trim()
    // Ark marks prompt as required in all three modes, image-to-image included.
    if (!trimmed) {
      toast.error(t('Please enter a prompt'))
      return
    }
    onSubmit(trimmed)
    setPrompt('')
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!disabled) {
        handleSubmit()
      }
    }
  }

  // Ark tells the three modes apart purely by reference count, so switching mode
  // trims the list instead of leaving extra images behind: a single-image edit
  // with two references uploaded would silently become a multi-image fusion.
  const handleModeChange = (mode: string) => {
    const nextMax = IMAGE_MODES.find((m) => m.value === mode)?.maxImages ?? 0
    onConfigChange({
      ...config,
      mode: mode as ImageMode,
      referenceImages: config.referenceImages.slice(0, nextMax),
    })
  }

  // Reference images travel inline as base64 data URLs: the upstream accepts them
  // verbatim and no provider-specific file upload endpoint is needed.
  const handleReferenceUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    // Snapshot the picks before resetting the input: `files` is a live FileList,
    // so clearing `value` first empties it and the upload silently does nothing.
    // Resetting right after the snapshot is what allows picking the same file
    // twice in a row.
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    if (files.length === 0) return

    const remaining = maxReferences - config.referenceImages.length
    if (remaining <= 0) {
      toast.error(t('Up to {{max}} reference images', { max: maxReferences }))
      return
    }

    const next: ImageItem[] = []
    for (const file of files.slice(0, remaining)) {
      if (file.size > MAX_IMAGE_FILE_BYTES) {
        toast.error(t('Image size must be less than 10MB'))
        continue
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      }).catch(() => '')
      // A file that cannot be read as a data URL would otherwise vanish without
      // a trace, which the user can only read as "the picker did nothing".
      if (!dataUrl) {
        toast.error(t('Failed to upload image'))
        continue
      }
      next.push({ id: createImageId('ref'), src: dataUrl })
    }

    if (next.length > 0) {
      updateField('referenceImages', [...config.referenceImages, ...next])
    }
  }

  const removeReference = (id: string) => {
    updateField(
      'referenceImages',
      config.referenceImages.filter((item) => item.id !== id)
    )
  }

  return (
    <div className='grid shrink-0 gap-3 px-1 md:pb-4'>
      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
        multiple
        className='hidden'
        onChange={handleReferenceUpload}
      />

      <div className='bg-background/95 dark:bg-background/80 border-border/70 ring-foreground/5 focus-within:border-primary/45 focus-within:ring-primary/15 relative overflow-hidden rounded-xl border shadow-[0_18px_60px_-32px_rgba(0,0,0,0.65)] ring-1 transition-all duration-200'>
        {/* Reference images (image-to-image) */}
        {config.referenceImages.length > 0 && (
          <div className='border-border/60 flex flex-wrap gap-2 border-b p-3'>
            {config.referenceImages.map((item) => (
              <div
                key={item.id}
                className='group relative size-16 overflow-hidden rounded-lg border'
              >
                <img
                  src={item.src}
                  alt={t('Reference image')}
                  className='size-full object-cover'
                />
                <button
                  className='bg-background/80 hover:text-destructive absolute top-0.5 right-0.5 hidden size-5 items-center justify-center rounded-full text-xs opacity-0 transition-opacity group-hover:flex group-hover:opacity-100'
                  onClick={() => removeReference(item.id)}
                  aria-label={t('Remove')}
                  type='button'
                >
                  ✕
                </button>
              </div>
            ))}
            {/* 与视频模式一致：留出虚线空槽位，让“还能继续加图”和已上传的图一样显眼 */}
            {config.referenceImages.length < maxReferences && (
              <button
                className='border-border/60 text-muted-foreground hover:border-primary hover:text-primary flex size-16 items-center justify-center rounded-lg border-2 border-dashed transition-colors'
                disabled={disabled}
                onClick={() => fileInputRef.current?.click()}
                title={t('Upload reference images')}
                aria-label={t('Upload reference images')}
                type='button'
              >
                <ImageIcon size={16} />
              </button>
            )}
          </div>
        )}

        {/* Prompt */}
        <textarea
          className='text-foreground min-h-20 w-full resize-none bg-transparent px-5 pt-4 pb-3 leading-7 focus:outline-none md:min-h-24 md:text-base'
          disabled={disabled}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t(
            'Describe the image you want to generate, or upload a reference image'
          )}
          value={prompt}
        />

        {/* Configuration bar */}
        <div className='border-border/60 bg-muted/20 dark:bg-muted/10 flex flex-wrap items-center gap-1.5 border-t px-3 py-2 backdrop-blur'>
          <ConfigOptionPopover
            label={t(
              IMAGE_MODES.find((m) => m.value === config.mode)?.label ??
                'Text to Image'
            )}
            title={t('Generation mode')}
            options={IMAGE_MODES.map((m) => ({
              value: m.value,
              label: t(m.label),
            }))}
            value={config.mode}
            onChange={handleModeChange}
          />

          {maxReferences > 0 && (
            <button
              className={cn(
                'flex size-8 items-center justify-center rounded-lg transition-colors',
                config.referenceImages.length >= maxReferences
                  ? 'text-muted-foreground/50'
                  : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
              )}
              disabled={
                disabled || config.referenceImages.length >= maxReferences
              }
              onClick={() => fileInputRef.current?.click()}
              title={t('Upload reference images')}
              aria-label={t('Upload reference images')}
              type='button'
            >
              <ImageIcon size={16} />
            </button>
          )}

          <ConfigOptionPopover
            label={config.size}
            title={t('Image size')}
            options={profile.sizes.map((s) => ({ value: s, label: s }))}
            value={config.size}
            onChange={(v) => updateField('size', v)}
          />

          {/* Seedream 4.x has no output_format parameter and 5.0 Pro returns a
              single image and rejects sequential generation, so each control is
              offered only where the model documents it. */}
          {profile.outputFormats.length > 0 && (
            <ConfigOptionPopover
              label={config.outputFormat}
              title={t('Output format')}
              options={profile.outputFormats.map((f) => ({
                value: f,
                label: f,
              }))}
              value={config.outputFormat}
              onChange={(v) =>
                updateField('outputFormat', v as ImageOutputFormat)
              }
            />
          )}

          {profile.maxCount > 1 && (
            <ConfigOptionPopover
              label={`${config.count} ${t('images')}`}
              title={t('Number of images')}
              options={Array.from(
                { length: profile.maxCount },
                (_, i) => i + IMAGE_COUNT_RANGE.min
              ).map((n) => ({ value: String(n), label: String(n) }))}
              value={String(config.count)}
              onChange={(v) => updateField('count', Number.parseInt(v))}
            />
          )}

          {hasTasks && onClearTasks && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    className='text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-8 items-center justify-center rounded-lg transition-colors'
                    disabled={disabled}
                    onClick={onClearTasks}
                    type='button'
                  />
                }
              >
                <Trash2Icon size={16} />
              </TooltipTrigger>
              <TooltipContent>
                <p>{t('Clear all')}</p>
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
            categorizeModel={getModelCategory}
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
              disabled={disabled || !config.model}
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

// Single-option-list popover shared by the size, format and count controls.
function ConfigOptionPopover({
  label,
  title,
  options,
  value,
  onChange,
}: {
  label: string
  title: string
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            className='bg-muted hover:bg-muted/70 text-foreground flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors'
            title={title}
            aria-label={title}
            type='button'
          >
            {label}
            <span className='text-muted-foreground'>▾</span>
          </button>
        }
      />
      <PopoverContent
        side='top'
        align='start'
        className='w-auto min-w-[6rem] p-1.5'
      >
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
              type='button'
            >
              {opt.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
