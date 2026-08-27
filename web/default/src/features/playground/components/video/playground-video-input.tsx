import {
  FilmIcon,
  ImageIcon,
  MusicIcon,
  SendIcon,
  SquareIcon,
  TimerIcon,
  Trash2Icon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ModelGroupSelector } from '@/components/model-group-selector'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { listAssets } from '../../api'
import {
  ASPECT_RATIOS,
  DURATION_OPTIONS,
  IMAGE_ASPECT_RATIO_RANGE,
  MAX_AUDIOS,
  MAX_REFERENCE_IMAGES,
  MAX_VIDEOS,
  RESOLUTIONS,
  VIDEO_COUNT_RANGE,
  VIDEO_MODES,
} from '../../constants'
import type {
  AspectRatio,
  Asset,
  GroupOption,
  MediaItem,
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
  onUploadMediaItem?: (
    file: File,
    type: 'image' | 'video' | 'audio',
    existingItems: MediaItem[]
  ) => Promise<MediaItem>
  uploadProgress?: Record<string, number>
}

function getMediaDisplayName(item: MediaItem, items: MediaItem[]): string {
  // Asset library items keep their registered name
  if (item.assetId) return item.name || item.assetId
  const typeLabel =
    item.type === 'video' ? '视频' : item.type === 'audio' ? '音频' : '图片'
  const sameTypeItems = items.filter((i) => i.type === item.type)
  const index = sameTypeItems.indexOf(item) + 1
  return `${typeLabel}${index}`
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
  onUploadMediaItem,
  uploadProgress,
}: PlaygroundVideoInputProps) {
  const { t } = useTranslation()
  const [prompt, setPrompt] = useState('')
  const [isEmpty, setIsEmpty] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoFileInputRef = useRef<HTMLInputElement>(null)
  const audioFileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)

  // --- @ mention popup state ---
  const [showMention, setShowMention] = useState(false)
  const [mentionFilter, setMentionFilter] = useState<
    'all' | 'image' | 'video' | 'audio'
  >('all')
  const [mentionStartIndex, setMentionStartIndex] = useState(-1)
  const mentionPopupRef = useRef<HTMLDivElement>(null)

  // --- asset library assets shown in the @ mention popup ---
  const [libraryAssets, setLibraryAssets] = useState<Asset[]>([])

  // --- uploading placeholder state ---
  const [uploadingItems, setUploadingItems] = useState<
    {
      id: string
      type: 'image' | 'video' | 'audio'
      fileName: string
      localUrl: string
    }[]
  >([])
  const configRef = useRef(config)
  configRef.current = config

  // --- helpers for contentEditable ---

  // Get the text cursor position as a plain-text offset
  function getCursorTextOffset(): number {
    const editor = editorRef.current
    if (!editor) return 0
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return 0
    const range = sel.getRangeAt(0)
    const pre = range.cloneRange()
    pre.selectNodeContents(editor)
    pre.setEnd(range.endContainer, range.endOffset)
    return pre.toString().length
  }

  const maxImages =
    VIDEO_MODES.find((m) => m.value === config.mode)?.maxImages ?? 1

  // seedance 2.5（模型名含 2-5）时长上限 30 秒，其余模型保持 4–15 秒
  const durationOptions = config.model.includes('2-5')
    ? Array.from({ length: 30 - 4 + 1 }, (_, i) => i + 4)
    : DURATION_OPTIONS
  const maxDuration = durationOptions[durationOptions.length - 1]

  const updateField = <K extends keyof VideoConfig>(
    key: K,
    value: VideoConfig[K]
  ) => {
    onConfigChange({ ...config, [key]: value })
  }

  // 模型切换后当前时长超出上限时回落（2.5 上限 30 秒，其余 15 秒）
  useEffect(() => {
    const maxDuration = config.model.includes('2-5') ? 30 : 15
    if (config.duration > maxDuration) {
      updateField('duration', maxDuration)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.model, config.duration])

  const handleModeChange = (mode: string) => {
    if (mode === 'first_last_frame' || mode === 'first_frame') {
      // Switching to frame-based mode: clear media items, trim images
      const newMax = VIDEO_MODES.find((m) => m.value === mode)?.maxImages ?? 2
      const trimmedImages = config.images.slice(0, newMax)
      onConfigChange({
        ...config,
        mode: mode as VideoMode,
        images: trimmedImages,
        mediaItems: [],
      })
    } else if (mode === 'text_to_video') {
      // Text-to-video: clear all media
      onConfigChange({
        ...config,
        mode: mode as VideoMode,
        images: [],
        mediaItems: [],
      })
    } else {
      // Switching to reference: clear images, keep media items
      onConfigChange({
        ...config,
        mode: mode as VideoMode,
        images: [],
      })
    }
  }

  const handleSubmit = () => {
    const text = editorRef.current?.innerText.trim() || ''
    if (!text) return
    onSubmit(text)
    if (editorRef.current) {
      editorRef.current.innerHTML = ''
    }
    setPrompt('')
    setIsEmpty(true)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const remaining = maxImages - config.images.length
    if (remaining <= 0) {
      toast.error(
        config.mode === 'first_last_frame'
          ? t('最多上传2张图片（首帧和尾帧）')
          : config.mode === 'first_frame'
            ? t('最多上传1张图片（首帧）')
            : t('最多上传1张参考图片')
      )
      return
    }

    for (const file of Array.from(files).slice(0, remaining)) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(t('Image size must be less than 10MB'))
        continue
      }
      const ratio = await getImageAspectRatio(file)
      if (
        ratio > 0 &&
        (ratio < IMAGE_ASPECT_RATIO_RANGE.min ||
          ratio > IMAGE_ASPECT_RATIO_RANGE.max)
      ) {
        toast.error(
          t(
            'Image aspect ratio must be between {{min}} and {{max}}, got {{ratio}}',
            {
              min: IMAGE_ASPECT_RATIO_RANGE.min,
              max: IMAGE_ASPECT_RATIO_RANGE.max,
              ratio: ratio.toFixed(2),
            }
          )
        )
        continue
      }

      if (!onUploadMediaItem) {
        const dataUrl = await fileToBase64(file)
        updateField('images', [...configRef.current.images, dataUrl])
        continue
      }

      const uploadId = `${file.name}-${Date.now()}`
      const localUrl = URL.createObjectURL(file)
      setUploadingItems((prev) => [
        ...prev,
        { id: uploadId, type: 'image', fileName: file.name, localUrl },
      ])
      try {
        const item = await onUploadMediaItem(file, 'image', [])
        const remoteUrl = item.remoteUrl
        if (remoteUrl) {
          updateField('images', [...configRef.current.images, remoteUrl])
        }
      } catch {
        toast.error(t('Failed to upload image'))
      } finally {
        setUploadingItems((prev) => prev.filter((u) => u.id !== uploadId))
        URL.revokeObjectURL(localUrl)
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const removeImage = (index: number) => {
    const images = config.images.filter((_, i) => i !== index)
    updateField('images', images)
  }

  // --- Reference mode media item handlers ---

  const imageMediaItems = config.mediaItems.filter(
    (item) => item.type === 'image'
  )
  const videoMediaItems = config.mediaItems.filter(
    (item) => item.type === 'video'
  )
  const audioMediaItems = config.mediaItems.filter(
    (item) => item.type === 'audio'
  )

  const handleReferenceImageUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    if (!onConfigChange) return
    if (!onUploadMediaItem) return

    const remaining =
      MAX_REFERENCE_IMAGES -
      imageMediaItems.length -
      uploadingItems.filter((u) => u.type === 'image').length
    if (remaining <= 0) {
      toast.error(t('最多上传{{max}}张图片', { max: MAX_REFERENCE_IMAGES }))
      return
    }

    for (const file of Array.from(files).slice(0, remaining)) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error(t('Image size must be less than 10MB'))
        continue
      }
      const ratio = await getImageAspectRatio(file)
      if (
        ratio > 0 &&
        (ratio < IMAGE_ASPECT_RATIO_RANGE.min ||
          ratio > IMAGE_ASPECT_RATIO_RANGE.max)
      ) {
        toast.error(
          t(
            'Image aspect ratio must be between {{min}} and {{max}}, got {{ratio}}',
            {
              min: IMAGE_ASPECT_RATIO_RANGE.min,
              max: IMAGE_ASPECT_RATIO_RANGE.max,
              ratio: ratio.toFixed(2),
            }
          )
        )
        continue
      }

      const uploadId = `${file.name}-${Date.now()}`
      const localUrl = URL.createObjectURL(file)
      setUploadingItems((prev) => [
        ...prev,
        { id: uploadId, type: 'image', fileName: file.name, localUrl },
      ])
      try {
        const item = await onUploadMediaItem(file, 'image', [
          ...imageMediaItems,
          ...uploadingItems
            .filter((u) => u.type === 'image')
            .map((u) => ({
              url: u.localUrl,
              type: 'image' as const,
              name: u.fileName,
            })),
        ])
        onConfigChange({
          ...configRef.current,
          mediaItems: [...configRef.current.mediaItems, item],
        })
      } catch {
        toast.error(t('Failed to upload image'))
      } finally {
        setUploadingItems((prev) => prev.filter((u) => u.id !== uploadId))
        URL.revokeObjectURL(localUrl)
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    if (!onUploadMediaItem) return

    const remaining =
      MAX_VIDEOS -
      videoMediaItems.length -
      uploadingItems.filter((u) => u.type === 'video').length
    if (remaining <= 0) {
      toast.error(t('最多上传{{max}}个视频', { max: MAX_VIDEOS }))
      return
    }

    for (const file of Array.from(files).slice(0, remaining)) {
      if (file.size > 100 * 1024 * 1024) {
        toast.error(t('Video size must be less than 100MB'))
        continue
      }
      const uploadId = `${file.name}-${Date.now()}`
      const localUrl = URL.createObjectURL(file)
      setUploadingItems((prev) => [
        ...prev,
        { id: uploadId, type: 'video', fileName: file.name, localUrl },
      ])
      try {
        const item = await onUploadMediaItem(file, 'video', [
          ...configRef.current.mediaItems,
        ])
        onConfigChange({
          ...configRef.current,
          mediaItems: [...configRef.current.mediaItems, item],
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setUploadingItems((prev) => prev.filter((u) => u.id !== uploadId))
        URL.revokeObjectURL(localUrl)
      }
    }
    if (videoFileInputRef.current) {
      videoFileInputRef.current.value = ''
    }
  }

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    if (!onUploadMediaItem) return

    const remaining =
      MAX_AUDIOS -
      audioMediaItems.length -
      uploadingItems.filter((u) => u.type === 'audio').length
    if (remaining <= 0) {
      toast.error(t('最多上传{{max}}个音频', { max: MAX_AUDIOS }))
      return
    }

    for (const file of Array.from(files).slice(0, remaining)) {
      if (file.size > 50 * 1024 * 1024) {
        toast.error(t('Audio size must be less than 50MB'))
        continue
      }
      const uploadId = `${file.name}-${Date.now()}`
      const localUrl = URL.createObjectURL(file)
      setUploadingItems((prev) => [
        ...prev,
        { id: uploadId, type: 'audio', fileName: file.name, localUrl },
      ])
      try {
        const item = await onUploadMediaItem(file, 'audio', [
          ...configRef.current.mediaItems,
        ])
        onConfigChange({
          ...configRef.current,
          mediaItems: [...configRef.current.mediaItems, item],
        })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      } finally {
        setUploadingItems((prev) => prev.filter((u) => u.id !== uploadId))
        URL.revokeObjectURL(localUrl)
      }
    }
    if (audioFileInputRef.current) {
      audioFileInputRef.current.value = ''
    }
  }

  const removeMediaItem = (index: number) => {
    const mediaItems = config.mediaItems.filter((_, i) => i !== index)
    onConfigChange({ ...config, mediaItems })
  }

  // --- @ mention handlers ---

  const handleEditorInput = () => {
    const editor = editorRef.current
    if (!editor) return
    const text = editor.innerText

    setPrompt(text)
    setIsEmpty(text.trim() === '')

    // Use Range.toString() for @ detection instead of innerText.
    // innerText may add extra \n around <div> wrappers that browsers
    // create inside contentEditable, causing mismatches with the cursor
    // offset (which is derived from Range.toString()).
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const preRange = range.cloneRange()
    preRange.selectNodeContents(editor)
    preRange.setEnd(range.endContainer, range.endOffset)
    const textBeforeCursor = preRange.toString()
    const cursorPos = textBeforeCursor.length

    // Detect @ typed at start of text or after whitespace
    if (textBeforeCursor[cursorPos - 1] === '@') {
      const prevChar = cursorPos > 1 ? textBeforeCursor[cursorPos - 2] : ''
      // @ is at a word boundary if prevChar is empty (start) or whitespace
      let atBoundary = prevChar === '' || /\s/.test(prevChar)
      // Also check DOM: @ right after a mention chip element is a boundary
      if (!atBoundary && cursorPos > 1) {
        const node = range.endContainer
        if (
          node.nodeType === Node.TEXT_NODE &&
          range.endOffset === 1 &&
          node.previousSibling?.nodeType === Node.ELEMENT_NODE &&
          (node.previousSibling as HTMLElement).classList?.contains(
            'mention-chip'
          )
        ) {
          atBoundary = true
        }
      }
      if (atBoundary) {
        setMentionStartIndex(cursorPos - 1)
        setShowMention(true)
        setMentionFilter('all')
      }
    } else if (showMention && mentionStartIndex >= 0) {
      // Close popup if user typed space/newline after @, or deleted the @
      const textAfterAt = textBeforeCursor.substring(
        mentionStartIndex + 1,
        cursorPos
      )
      if (
        /\s/.test(textAfterAt) ||
        textBeforeCursor[mentionStartIndex] !== '@'
      ) {
        setShowMention(false)
      }
    }
  }

  // Build the HTML for a mention chip element
  const buildChipHtml = (item: MediaItem, displayName: string): string => {
    const thumb =
      item.type === 'image'
        ? `<img src="${item.url}" class="mention-chip-thumb" />`
        : item.type === 'video'
          ? `<video src="${item.url}" class="mention-chip-thumb" muted></video>`
          : `<span class="mention-chip-icon">🎵</span>`
    return `<span contenteditable="false" class="mention-chip">${thumb}@${displayName}</span>`
  }

  const handleMentionSelect = (item: MediaItem) => {
    const editor = editorRef.current
    if (!editor) return
    const displayName = getMediaDisplayName(item, config.mediaItems)

    // Delete the @ and any filter text typed after it, then insert the chip
    const cursorPos = getCursorTextOffset()
    const deleteCount = cursorPos - mentionStartIndex
    editor.focus()
    for (let i = 0; i < deleteCount; i++) {
      document.execCommand('delete', false)
    }
    const chipHtml = buildChipHtml(item, displayName)
    document.execCommand('insertHTML', false, chipHtml + '\u00A0')

    // Sync state
    const newText = editor.innerText
    setPrompt(newText)
    setIsEmpty(newText.trim() === '')
    setShowMention(false)
  }

  // Close popup on Escape or outside click
  useEffect(() => {
    if (!showMention) return
    const handleClickOutside = (e: MouseEvent) => {
      if (
        mentionPopupRef.current &&
        !mentionPopupRef.current.contains(e.target as Node) &&
        editorRef.current &&
        !editorRef.current.contains(e.target as Node)
      ) {
        setShowMention(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowMention(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showMention])

  // Fetch active library assets while the @ mention popup is open so they
  // can be referenced alongside session uploads. Assets are per-channel, so
  // only ask for assets whose channel can serve the selected model/group.
  useEffect(() => {
    if (!showMention || config.mode !== 'reference') return
    let cancelled = false
    void listAssets(undefined, config.model, config.group).then((list) => {
      if (!cancelled) {
        setLibraryAssets(list.filter((asset) => asset.status === 'active'))
      }
    })
    return () => {
      cancelled = true
    }
  }, [showMention, config.mode, config.model, config.group])

  const mentionLibraryAssets = libraryAssets.filter(
    (asset) =>
      !config.mediaItems.some((item) => item.assetId === asset.asset_id) &&
      (mentionFilter === 'all' ||
        (mentionFilter === 'video'
          ? asset.asset_type === 'Video'
          : mentionFilter === 'audio'
            ? asset.asset_type === 'Audio'
            : asset.asset_type === 'Image'))
  )

  // Add an asset-library asset as a media item; remoteUrl carries asset://
  // and flows through buildSubmitPayload unchanged.
  const handleLibraryAssetSelect = (asset: Asset) => {
    const item: MediaItem = {
      url: asset.preview_url || asset.source_url,
      remoteUrl: `asset://${asset.asset_id}`,
      type:
        asset.asset_type === 'Video'
          ? 'video'
          : asset.asset_type === 'Audio'
            ? 'audio'
            : 'image',
      name: asset.name || asset.asset_id,
      assetId: asset.asset_id,
      assetChannelId: asset.channel_id,
    }
    onConfigChange({
      ...configRef.current,
      mediaItems: [...configRef.current.mediaItems, item],
    })
    handleMentionSelect(item)
  }

  return (
    <div className='grid shrink-0 gap-3 px-1 md:pb-4'>
      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
        multiple
        className='hidden'
        onChange={
          config.mode === 'reference'
            ? handleReferenceImageUpload
            : handleImageUpload
        }
      />
      <input
        ref={videoFileInputRef}
        type='file'
        accept='video/*'
        multiple
        className='hidden'
        onChange={handleVideoUpload}
      />
      <input
        ref={audioFileInputRef}
        type='file'
        accept='audio/*'
        multiple
        className='hidden'
        onChange={handleAudioUpload}
      />

      {/* Prompt input card */}
      <div className='relative'>
        <div className='bg-background/95 dark:bg-background/80 border-border/70 ring-foreground/5 focus-within:border-primary/45 focus-within:ring-primary/15 relative overflow-hidden rounded-xl border shadow-[0_18px_60px_-32px_rgba(0,0,0,0.65)] ring-1 transition-all duration-200'>
          {/* First/last frame and first frame images */}
          {(config.mode === 'first_last_frame' ||
            config.mode === 'first_frame') &&
            (config.images.length > 0 ||
              uploadingItems.some((u) => u.type === 'image')) && (
              <div className='border-border/60 flex flex-wrap gap-2 border-b p-3'>
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
                      {i === 0 ? '首帧' : '尾帧'}
                    </span>
                    <button
                      onClick={() => removeImage(i)}
                      className='bg-background/80 absolute top-0.5 right-0.5 hidden size-5 items-center justify-center rounded-full text-xs opacity-0 transition-opacity group-hover:flex group-hover:opacity-100'
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {uploadingItems
                  .filter((u) => u.type === 'image')
                  .map((u) => (
                    <div
                      key={u.id}
                      className='group relative size-16 overflow-hidden rounded-lg border'
                    >
                      <img
                        src={u.localUrl}
                        alt={u.fileName}
                        className='size-full object-cover opacity-50'
                      />
                      <div className='absolute inset-0 flex items-center justify-center bg-black/50'>
                        <div className='size-4 animate-spin rounded-full border-2 border-white/30 border-t-white' />
                      </div>
                    </div>
                  ))}
                {/* Empty slots */}
                {config.images.length +
                  uploadingItems.filter((u) => u.type === 'image').length <
                  maxImages && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={disabled}
                    className='border-border/60 text-muted-foreground hover:border-primary hover:text-primary flex size-16 items-center justify-center rounded-lg border-2 border-dashed text-[10px] transition-colors'
                  >
                    {config.images.length === 0 ? '首帧' : '尾帧'}
                  </button>
                )}
              </div>
            )}

          {/* Reference mode media items */}
          {config.mode === 'reference' &&
            (config.mediaItems.length > 0 || uploadingItems.length > 0) && (
              <div className='border-border/60 space-y-2 border-b p-3'>
                {/* Images row */}
                {(imageMediaItems.length > 0 ||
                  uploadingItems.some((u) => u.type === 'image')) && (
                  <div className='flex flex-wrap gap-2'>
                    {config.mediaItems.map((item, i) =>
                      item.type === 'image' ? (
                        <div
                          key={i}
                          className='group relative size-16 overflow-hidden rounded-lg border'
                        >
                          <img
                            src={item.url}
                            alt={item.name}
                            className='size-full object-cover'
                          />
                          <span className='bg-background/80 absolute bottom-0.5 left-0.5 rounded px-1 py-0.5 text-[10px] font-medium'>
                            {t('Image')}
                          </span>
                          <button
                            onClick={() => removeMediaItem(i)}
                            className='bg-background/80 absolute top-0.5 right-0.5 hidden size-5 items-center justify-center rounded-full text-xs opacity-0 transition-opacity group-hover:flex group-hover:opacity-100'
                          >
                            ✕
                          </button>
                        </div>
                      ) : null
                    )}
                    {uploadingItems
                      .filter((u) => u.type === 'image')
                      .map((u) => (
                        <div
                          key={u.id}
                          className='group relative size-16 overflow-hidden rounded-lg border'
                        >
                          <img
                            src={u.localUrl}
                            alt={u.fileName}
                            className='size-full object-cover opacity-50'
                          />
                          <div className='absolute inset-0 flex items-center justify-center bg-black/50'>
                            <div className='size-4 animate-spin rounded-full border-2 border-white/30 border-t-white' />
                          </div>
                        </div>
                      ))}
                  </div>
                )}
                {/* Videos row */}
                {(videoMediaItems.length > 0 ||
                  uploadingItems.some((u) => u.type === 'video')) && (
                  <div className='flex flex-wrap gap-2'>
                    {config.mediaItems.map((item, i) =>
                      item.type === 'video' ? (
                        <div
                          key={i}
                          className='group relative size-16 overflow-hidden rounded-lg border'
                        >
                          <video
                            src={item.url}
                            className='size-full object-cover'
                          />
                          <span className='bg-background/80 absolute bottom-0.5 left-0.5 rounded px-1 py-0.5 text-[10px] font-medium'>
                            {item.duration != null
                              ? `${item.duration.toFixed(1)}s`
                              : t('Video')}
                          </span>
                          {!item.remoteUrl &&
                            uploadProgress?.[item.url] != null && (
                              <div className='absolute inset-0 flex items-center justify-center bg-black/50'>
                                <span className='text-primary text-xs font-medium'>
                                  {uploadProgress[item.url]}%
                                </span>
                              </div>
                            )}
                          <button
                            onClick={() => removeMediaItem(i)}
                            className='bg-background/80 absolute top-0.5 right-0.5 hidden size-5 items-center justify-center rounded-full text-xs opacity-0 transition-opacity group-hover:flex group-hover:opacity-100'
                          >
                            ✕
                          </button>
                        </div>
                      ) : null
                    )}
                    {uploadingItems
                      .filter((u) => u.type === 'video')
                      .map((u) => (
                        <div
                          key={u.id}
                          className='group relative size-16 overflow-hidden rounded-lg border'
                        >
                          <video
                            src={u.localUrl}
                            className='size-full object-cover'
                          />
                          <div className='absolute inset-0 flex items-center justify-center bg-black/50'>
                            <div className='size-4 animate-spin rounded-full border-2 border-white/30 border-t-white' />
                          </div>
                        </div>
                      ))}
                  </div>
                )}
                {/* Audio row */}
                {(audioMediaItems.length > 0 ||
                  uploadingItems.some((u) => u.type === 'audio')) && (
                  <div className='flex flex-wrap gap-2'>
                    {config.mediaItems.map((item, i) =>
                      item.type === 'audio' ? (
                        <div
                          key={i}
                          className='group relative flex h-8 items-center gap-1.5 rounded-lg border px-2'
                        >
                          <MusicIcon
                            size={14}
                            className='text-muted-foreground shrink-0'
                          />
                          <span className='max-w-[100px] truncate text-xs'>
                            {item.name}
                          </span>
                          {item.duration != null && (
                            <span className='text-muted-foreground text-[10px]'>
                              {item.duration.toFixed(1)}s
                            </span>
                          )}
                          {!item.remoteUrl &&
                            uploadProgress?.[item.url] != null && (
                              <span className='text-primary text-[10px] font-medium'>
                                {uploadProgress[item.url]}%
                              </span>
                            )}
                          <button
                            onClick={() => removeMediaItem(i)}
                            className='text-muted-foreground hover:text-destructive shrink-0'
                          >
                            ✕
                          </button>
                        </div>
                      ) : null
                    )}
                    {uploadingItems
                      .filter((u) => u.type === 'audio')
                      .map((u) => (
                        <div
                          key={u.id}
                          className='flex h-8 items-center gap-1.5 rounded-lg border px-2'
                        >
                          <div className='border-muted-foreground/30 border-t-muted-foreground size-3 animate-spin rounded-full border-2' />
                          <span className='max-w-[100px] truncate text-xs'>
                            {u.fileName}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

          {/* Rich text editor (contentEditable) */}
          <div className='relative min-h-20 md:min-h-24'>
            {isEmpty && (
              <div className='text-muted-foreground pointer-events-none absolute inset-0 px-5 pt-4 leading-7 md:text-base'>
                {t(
                  '使用@可快速引用上传的文件，如:参考@视频1中的动作，生成@图片2和@图片3中的角色打斗的视频。'
                )}
              </div>
            )}
            <div
              ref={editorRef}
              contentEditable={!disabled}
              suppressContentEditableWarning
              className={cn(
                'min-h-20 w-full resize-none px-5 pt-4 pb-3 leading-7 md:min-h-24 md:text-base focus:outline-none',
                disabled && 'cursor-not-allowed opacity-50'
              )}
              onInput={handleEditorInput}
              onKeyDown={handleKeyDown}
              style={{ caretColor: 'currentColor' }}
            />
          </div>

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

            {/* Upload buttons */}
            {config.mode === 'reference' ? (
              <>
                <button
                  className={cn(
                    'flex size-8 items-center justify-center rounded-lg transition-colors',
                    imageMediaItems.length >= MAX_REFERENCE_IMAGES
                      ? 'text-muted-foreground/50'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
                  )}
                  disabled={
                    disabled || imageMediaItems.length >= MAX_REFERENCE_IMAGES
                  }
                  onClick={() => fileInputRef.current?.click()}
                  title={t('Upload reference images')}
                >
                  <ImageIcon size={16} />
                </button>
                <button
                  className={cn(
                    'flex size-8 items-center justify-center rounded-lg transition-colors',
                    videoMediaItems.length >= MAX_VIDEOS
                      ? 'text-muted-foreground/50'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
                  )}
                  disabled={disabled || videoMediaItems.length >= MAX_VIDEOS}
                  onClick={() => videoFileInputRef.current?.click()}
                  title={t('Upload reference videos')}
                >
                  <FilmIcon size={16} />
                </button>
                <button
                  className={cn(
                    'flex size-8 items-center justify-center rounded-lg transition-colors',
                    audioMediaItems.length >= MAX_AUDIOS
                      ? 'text-muted-foreground/50'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
                  )}
                  disabled={disabled || audioMediaItems.length >= MAX_AUDIOS}
                  onClick={() => audioFileInputRef.current?.click()}
                  title={t('Upload reference audio')}
                >
                  <MusicIcon size={16} />
                </button>
              </>
            ) : config.mode === 'first_last_frame' ||
              config.mode === 'first_frame' ? (
              <button
                className='text-muted-foreground hover:text-foreground hover:bg-muted/70 flex size-8 items-center justify-center rounded-lg transition-colors'
                disabled={disabled || config.images.length >= maxImages}
                onClick={() => fileInputRef.current?.click()}
                title={t('Upload frame image')}
              >
                <ImageIcon size={16} />
              </button>
            ) : null}

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

            {/* Duration slider */}
            <div
              className={cn(
                'border-border/60 bg-muted/70 hover:border-foreground/20 focus-within:border-ring/60 flex h-8 w-44 items-center gap-2 rounded-lg border px-2.5 transition-colors sm:w-52',
                disabled && 'pointer-events-none opacity-50'
              )}
              title={t('Video duration')}
            >
              <TimerIcon
                size={13}
                className='text-muted-foreground/80 shrink-0'
              />
              <Slider
                value={[config.duration]}
                min={4}
                max={maxDuration}
                step={1}
                aria-label={t('Video duration')}
                onValueChange={(v) => updateField('duration', v[0])}
                className='min-w-0 flex-1'
              />
              <span className='border-border/60 bg-background text-foreground shrink-0 rounded-md border px-1.5 py-px font-mono text-[11px] font-medium tabular-nums'>
                {config.duration}s
              </span>
            </div>

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

        {/* @ mention popup - outside overflow-hidden container */}
        {showMention && config.mode === 'reference' && (
          <div
            ref={mentionPopupRef}
            className='bg-background/95 dark:bg-background/90 border-border/70 absolute right-3 bottom-full left-3 z-50 mb-1 overflow-hidden rounded-lg border shadow-lg'
          >
            {/* Filter tabs */}
            <div className='border-border/60 flex items-center gap-1 border-b px-2 py-1.5'>
              {(
                [
                  { value: 'all', label: t('全部') },
                  { value: 'video', label: t('视频') },
                  { value: 'image', label: t('图片') },
                  { value: 'audio', label: t('音频') },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.value}
                  className={cn(
                    'rounded px-2 py-0.5 text-xs font-medium transition-colors',
                    mentionFilter === tab.value
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setMentionFilter(tab.value)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {/* Resource list */}
            <div className='max-h-48 overflow-y-auto py-1'>
              {config.mediaItems
                .filter(
                  (item) =>
                    mentionFilter === 'all' || item.type === mentionFilter
                )
                .map((item, i) => {
                  const displayName = getMediaDisplayName(
                    item,
                    config.mediaItems
                  )
                  return (
                    <button
                      key={i}
                      className='hover:bg-muted/60 flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors'
                      onClick={() => handleMentionSelect(item)}
                    >
                      {/* Thumbnail */}
                      <div className='size-8 shrink-0 overflow-hidden rounded border'>
                        {item.type === 'image' && (
                          <img
                            src={item.url}
                            alt={item.name}
                            className='size-full object-cover'
                          />
                        )}
                        {item.type === 'video' && (
                          <video
                            src={item.url}
                            className='size-full object-cover'
                          />
                        )}
                        {item.type === 'audio' && (
                          <div className='bg-muted flex size-full items-center justify-center'>
                            <MusicIcon
                              size={14}
                              className='text-muted-foreground'
                            />
                          </div>
                        )}
                      </div>
                      {/* Name + duration */}
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-xs font-medium'>
                          {displayName}
                        </div>
                        {item.duration != null && (
                          <div className='text-muted-foreground text-[10px]'>
                            {item.duration.toFixed(1)}s
                          </div>
                        )}
                      </div>
                      {/* Upload status */}
                      {!item.remoteUrl &&
                        uploadProgress?.[item.url] != null && (
                          <span className='text-primary shrink-0 text-[10px] font-medium'>
                            {uploadProgress[item.url]}%
                          </span>
                        )}
                    </button>
                  )
                })}
              {mentionLibraryAssets.length > 0 && (
                <>
                  <div className='text-muted-foreground/80 px-3 pt-1.5 pb-0.5 text-[10px] font-medium tracking-wide uppercase'>
                    {t('Asset Library')}
                  </div>
                  {mentionLibraryAssets.map((asset) => (
                    <button
                      key={asset.asset_id}
                      className='hover:bg-muted/60 flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors'
                      onClick={() => handleLibraryAssetSelect(asset)}
                    >
                      <div className='size-8 shrink-0 overflow-hidden rounded border'>
                        {asset.asset_type === 'Image' ? (
                          <img
                            src={asset.preview_url || asset.source_url}
                            alt={asset.name}
                            className='size-full object-cover'
                          />
                        ) : asset.asset_type === 'Video' ? (
                          <video
                            src={asset.preview_url || asset.source_url}
                            className='size-full object-cover'
                          />
                        ) : (
                          <div className='bg-muted flex size-full items-center justify-center'>
                            <MusicIcon
                              size={14}
                              className='text-muted-foreground'
                            />
                          </div>
                        )}
                      </div>
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-xs font-medium'>
                          {asset.name || asset.asset_id}
                        </div>
                      </div>
                    </button>
                  ))}
                </>
              )}
              {config.mediaItems.filter(
                (item) => mentionFilter === 'all' || item.type === mentionFilter
              ).length === 0 &&
                mentionLibraryAssets.length === 0 && (
                  <div className='text-muted-foreground px-3 py-2 text-center text-xs'>
                    {t('No resources uploaded yet')}
                  </div>
                )}
            </div>
          </div>
        )}
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

/**
 * Validate that the image's aspect ratio (width / height) falls within the
 * range allowed by the Volcengine Seedance API.
 * Returns the aspect ratio if valid, or 0 if the image cannot be loaded.
 */
function getImageAspectRatio(file: File): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const ratio = img.width / img.height
      URL.revokeObjectURL(img.src)
      resolve(ratio)
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      resolve(0)
    }
    img.src = URL.createObjectURL(file)
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
      <PopoverContent
        side='top'
        align='start'
        className='w-auto min-w-[5rem] p-1.5'
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
            >
              {t(opt.label)}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
