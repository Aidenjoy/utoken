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
import { useMutation } from '@tanstack/react-query'
import { Sparkles, Trash2, Upload, X } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { handleServerError } from '@/lib/handle-server-error'

import { correctDirectorSubtitles, uploadDirectorFile } from '../api'
import {
  clipDuration,
  FILTER_PRESETS,
  fmtTime,
  outputSize,
  probeVideoDuration,
  sliderNumber,
  SUBTITLE_FONTS,
  SUBTITLE_POSITIONS,
  TRANSITION_TYPES,
  type EditClip,
  type EditCrop,
  type EditSelection,
  type EditSticker,
  type EditSubtitle,
  type EditTimelineData,
} from './edit-utils'

interface EditPanelsProps {
  tl: EditTimelineData
  selected: EditSelection
  episodeId: number
  projectId: number
  aspectRatio: string
  resolution: string
  currentTime: number
  onSelect: (sel: EditSelection) => void
  onChange: (mutate: (tl: EditTimelineData) => void) => void
}

export function EditPanels(props: EditPanelsProps) {
  const { t } = useTranslation()
  const { tl, selected } = props

  const [activeTab, setActiveTab] = React.useState('clip')
  React.useEffect(() => {
    if (!selected.type) return
    setActiveTab(selected.type)
  }, [selected.type])

  const clip = selected.type === 'clip' ? (tl.clips[selected.index] ?? null) : null
  const subtitle =
    selected.type === 'subtitle' ? (tl.subtitles[selected.index] ?? null) : null
  const sticker =
    selected.type === 'sticker' ? (tl.stickers[selected.index] ?? null) : null
  const isLastClip = selected.index >= tl.clips.length - 1
  const outSize = outputSize(props.aspectRatio, props.resolution)

  const select = (type: EditSelection['type'], index: number) =>
    props.onSelect({ type, index })

  // ---------- 不可变更新入口（按当前选中项定位） ----------

  const mutateClip = (fn: (c: EditClip) => void) => {
    if (selected.type !== 'clip' || selected.index < 0) return
    props.onChange((data) => {
      const target = data.clips[selected.index]
      if (target) fn(target)
    })
  }

  const mutateSubtitle = (fn: (s: EditSubtitle) => void) => {
    if (selected.type !== 'subtitle' || selected.index < 0) return
    props.onChange((data) => {
      const target = data.subtitles[selected.index]
      if (target) fn(target)
    })
  }

  const mutateSticker = (fn: (s: EditSticker) => void) => {
    if (selected.type !== 'sticker' || selected.index < 0) return
    props.onChange((data) => {
      const target = data.stickers[selected.index]
      if (target) fn(target)
    })
  }

  // ---------- 片段：比例裁切锚点 ----------

  const [cropAnchorX, setCropAnchorX] = React.useState<'l' | 'c' | 'r'>('c')
  const [cropAnchorY, setCropAnchorY] = React.useState<'t' | 'c' | 'b'>('c')

  const toggleCrop = (on: boolean) => {
    mutateClip((c) => {
      c.crop = on ? { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } : null
    })
    setCropAnchorX('c')
    setCropAnchorY('c')
  }

  const clampCrop = (c: EditCrop) => {
    c.x = Math.min(c.x, 1 - c.w)
    c.y = Math.min(c.y, 1 - c.h)
  }

  const applyCropAnchor = (ax: 'l' | 'c' | 'r', ay: 't' | 'c' | 'b') => {
    mutateClip((c) => {
      if (!c.crop) return
      if (ax === 'l') c.crop.x = 0
      else if (ax === 'r') c.crop.x = 1 - c.crop.w
      else c.crop.x = (1 - c.crop.w) / 2
      if (ay === 't') c.crop.y = 0
      else if (ay === 'b') c.crop.y = 1 - c.crop.h
      else c.crop.y = (1 - c.crop.h) / 2
    })
  }

  // ---------- 片段：素材替换 ----------

  const replaceInputRef = React.useRef<HTMLInputElement>(null)
  const replaceMutation = useMutation({
    mutationFn: async (file: File) => {
      const res = await uploadDirectorFile({
        file,
        projectId: props.projectId || undefined,
      })
      if (!res.success || !res.data) throw new Error('upload failed')
      return res.data.url
    },
    onSuccess: (url) => {
      mutateClip((c) => {
        c.srcUrl = url
        c.storyboardId = 0
        c.start = 0
      })
      void probeVideoDuration(url).then((d) => {
        if (d > 0) {
          mutateClip((c) => {
            c.end = d
          })
        }
      })
      toast.success(t('Source replaced'))
    },
    onError: handleServerError,
  })

  // ---------- 字幕：AI 纠错 ----------

  const correctMutation = useMutation({
    mutationFn: () =>
      correctDirectorSubtitles({
        episodeId: props.episodeId,
        subtitles: structuredClone(tl.subtitles),
      }),
    onSuccess: (res) => {
      if (res.success) {
        const corrected = (res.data as { subtitles?: { text: string }[] })
          ?.subtitles
        if (Array.isArray(corrected)) {
          props.onChange((data) => {
            corrected.forEach((s, i) => {
              if (data.subtitles[i] && s.text) data.subtitles[i].text = s.text
            })
          })
        }
        toast.success(t('Subtitles corrected'))
      }
    },
    onError: handleServerError,
  })

  // ---------- 音频 / 贴纸上传 ----------

  const bgmInputRef = React.useRef<HTMLInputElement>(null)
  const stickerInputRef = React.useRef<HTMLInputElement>(null)

  const uploadMutation = useMutation({
    mutationFn: (vars: { file: File; kind: 'bgm' | 'sticker' }) =>
      uploadDirectorFile({
        file: vars.file,
        projectId: props.projectId || undefined,
      }),
    onSuccess: (res, vars) => {
      if (!res.success || !res.data) return
      const url = res.data.url
      if (vars.kind === 'bgm') {
        props.onChange((data) => {
          data.audio.bgmUrl = url
        })
        toast.success(t('BGM uploaded'))
      } else {
        props.onChange((data) => {
          data.stickers.push({
            url,
            x: 40,
            y: 40,
            width: 160,
            start: props.currentTime,
            end: props.currentTime + 3,
          })
        })
        props.onSelect({ type: 'sticker', index: tl.stickers.length })
        toast.success(t('Sticker added'))
      }
    },
    onError: handleServerError,
  })

  const pickFile = (
    ref: React.RefObject<HTMLInputElement | null>,
    accept: string,
    onFile: (file: File) => void
  ) => {
    const input = ref.current
    if (!input) return
    input.accept = accept
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0]
        if (file) onFile(file)
        input.value = ''
      },
      { once: true }
    )
    input.click()
  }

  return (
    <div className='min-h-0 w-full shrink-0 lg:w-95'>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className='w-full'>
          <TabsTrigger value='clip' className='flex-1'>
            {t('Clip')}
          </TabsTrigger>
          <TabsTrigger value='subtitle' className='flex-1'>
            {t('Subtitles')}
          </TabsTrigger>
          <TabsTrigger value='audio' className='flex-1'>
            {t('Audio')}
          </TabsTrigger>
          <TabsTrigger value='sticker' className='flex-1'>
            {t('Stickers')}
          </TabsTrigger>
        </TabsList>

        {/* ============ 片段属性 ============ */}
        <TabsContent value='clip'>
          {clip ? (
            <div className='flex flex-col gap-3 py-3'>
              <PanelBlock title={t('Trim & Duration')}>
                <Row>
                  <RowLabel>{t('In Point')}</RowLabel>
                  <Input
                    type='number'
                    className='w-24'
                    min={0}
                    max={clip.end - 0.1}
                    step={0.1}
                    value={clip.start}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0
                      mutateClip((c) => {
                        c.start = v
                      })
                    }}
                  />
                  <RowLabel>{t('Out Point')}</RowLabel>
                  <Input
                    type='number'
                    className='w-24'
                    min={clip.start + 0.1}
                    step={0.1}
                    value={clip.end}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0
                      mutateClip((c) => {
                        c.end = v
                      })
                    }}
                  />
                </Row>
                <p className='text-muted-foreground text-xs'>
                  {t('Timeline duration {{dur}}s (source {{src}}s ÷ {{speed}}x)', {
                    dur: clipDuration(clip).toFixed(1),
                    src: (clip.end - clip.start).toFixed(1),
                    speed: clip.speed,
                  })}
                </p>
                <Row>
                  <RowLabel>{t('Speed')}</RowLabel>
                  <Slider
                    className='min-w-25 flex-1'
                    min={0.25}
                    max={10}
                    step={0.25}
                    value={[clip.speed]}
                    onValueChange={(v) => {
                      mutateClip((c) => {
                        c.speed = sliderNumber(v)
                      })
                    }}
                    aria-label={t('Speed')}
                  />
                  <RowValue>{clip.speed}x</RowValue>
                </Row>
                <Row>
                  <RowLabel>{t('Volume')}</RowLabel>
                  <Slider
                    className='min-w-25 flex-1'
                    min={0}
                    max={2}
                    step={0.1}
                    value={[clip.volume]}
                    disabled={clip.muted}
                    onValueChange={(v) => {
                      mutateClip((c) => {
                        c.volume = sliderNumber(v)
                      })
                    }}
                    aria-label={t('Volume')}
                  />
                  <RowValue>
                    {clip.muted ? t('Muted') : clip.volume.toFixed(1)}
                  </RowValue>
                  <Switch
                    checked={clip.muted}
                    onCheckedChange={(v) => {
                      mutateClip((c) => {
                        c.muted = v
                      })
                    }}
                    aria-label={t('Muted')}
                  />
                </Row>
              </PanelBlock>

              <PanelBlock title={t('Transform')}>
                <Row>
                  <RowLabel>{t('Rotate')}</RowLabel>
                  <ToggleGroup
                    variant='outline'
                    size='sm'
                    spacing={2}
                    value={[String(clip.rotate)]}
                    onValueChange={(v) => {
                      const next = v.find((x) => x !== String(clip.rotate))
                      if (next) {
                        mutateClip((c) => {
                          c.rotate = Number(next)
                        })
                      }
                    }}
                  >
                    {[0, 90, 180, 270].map((r) => (
                      <ToggleGroupItem key={r} value={String(r)}>
                        {r}°
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Row>
                <Row>
                  <RowLabel>{t('Flip')}</RowLabel>
                  <ToggleGroup
                    variant='outline'
                    size='sm'
                    spacing={2}
                    value={[clip.flip]}
                    onValueChange={(v) => {
                      const next = v.find((x) => x !== clip.flip)
                      if (next) {
                        mutateClip((c) => {
                          c.flip = next
                        })
                      }
                    }}
                  >
                    <ToggleGroupItem value=''>{t('None')}</ToggleGroupItem>
                    <ToggleGroupItem value='h'>
                      {t('Horizontal')}
                    </ToggleGroupItem>
                    <ToggleGroupItem value='v'>{t('Vertical')}</ToggleGroupItem>
                    <ToggleGroupItem value='hv'>{t('Both')}</ToggleGroupItem>
                  </ToggleGroup>
                </Row>
                <Row>
                  <RowLabel>{t('Ratio Crop')}</RowLabel>
                  <Switch
                    checked={Boolean(clip.crop)}
                    onCheckedChange={toggleCrop}
                    aria-label={t('Ratio Crop')}
                  />
                  {clip.crop && (
                    <span className='text-muted-foreground text-xs'>
                      {t('Keep {{w}}% × {{h}}%', {
                        w: Math.round(clip.crop.w * 100),
                        h: Math.round(clip.crop.h * 100),
                      })}
                    </span>
                  )}
                </Row>
                {clip.crop && (
                  <>
                    <Row>
                      <RowLabel>{t('Width')}</RowLabel>
                      <Slider
                        className='min-w-25 flex-1'
                        min={0.2}
                        max={1}
                        step={0.05}
                        value={[clip.crop.w]}
                        onValueChange={(v) => {
                          mutateClip((c) => {
                            if (!c.crop) return
                            c.crop.w = sliderNumber(v)
                            clampCrop(c.crop)
                          })
                        }}
                        aria-label={t('Width')}
                      />
                    </Row>
                    <Row>
                      <RowLabel>{t('Height')}</RowLabel>
                      <Slider
                        className='min-w-25 flex-1'
                        min={0.2}
                        max={1}
                        step={0.05}
                        value={[clip.crop.h]}
                        onValueChange={(v) => {
                          mutateClip((c) => {
                            if (!c.crop) return
                            c.crop.h = sliderNumber(v)
                            clampCrop(c.crop)
                          })
                        }}
                        aria-label={t('Height')}
                      />
                    </Row>
                    <Row>
                      <RowLabel>{t('Anchor H')}</RowLabel>
                      <ToggleGroup
                        variant='outline'
                        size='sm'
                        spacing={2}
                        value={[cropAnchorX]}
                        onValueChange={(v) => {
                          const next = v.find((x) => x !== cropAnchorX)
                          if (next) {
                            const ax = next as 'l' | 'c' | 'r'
                            setCropAnchorX(ax)
                            applyCropAnchor(ax, cropAnchorY)
                          }
                        }}
                      >
                        <ToggleGroupItem value='l'>{t('Left')}</ToggleGroupItem>
                        <ToggleGroupItem value='c'>
                          {t('Center')}
                        </ToggleGroupItem>
                        <ToggleGroupItem value='r'>
                          {t('Right')}
                        </ToggleGroupItem>
                      </ToggleGroup>
                      <RowLabel>{t('Anchor V')}</RowLabel>
                      <ToggleGroup
                        variant='outline'
                        size='sm'
                        spacing={2}
                        value={[cropAnchorY]}
                        onValueChange={(v) => {
                          const next = v.find((x) => x !== cropAnchorY)
                          if (next) {
                            const ay = next as 't' | 'c' | 'b'
                            setCropAnchorY(ay)
                            applyCropAnchor(cropAnchorX, ay)
                          }
                        }}
                      >
                        <ToggleGroupItem value='t'>{t('Top')}</ToggleGroupItem>
                        <ToggleGroupItem value='c'>
                          {t('Center')}
                        </ToggleGroupItem>
                        <ToggleGroupItem value='b'>
                          {t('Bottom')}
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </Row>
                  </>
                )}
              </PanelBlock>

              <PanelBlock title={t('Color Grade')}>
                <Row>
                  <RowLabel>{t('Filter')}</RowLabel>
                  <ToggleGroup
                    variant='outline'
                    size='sm'
                    spacing={2}
                    className='flex-wrap'
                    value={[clip.filter.preset]}
                    onValueChange={(v) => {
                      const next = v.find((x) => x !== clip.filter.preset)
                      if (next !== undefined) {
                        mutateClip((c) => {
                          c.filter.preset = next
                        })
                      }
                    }}
                  >
                    {FILTER_PRESETS.map((p) => (
                      <ToggleGroupItem key={p.value} value={p.value}>
                        {t(p.label)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Row>
                <Row>
                  <RowLabel>{t('Brightness')}</RowLabel>
                  <Slider
                    className='min-w-25 flex-1'
                    min={-1}
                    max={1}
                    step={0.05}
                    value={[clip.filter.brightness]}
                    onValueChange={(v) => {
                      mutateClip((c) => {
                        c.filter.brightness = sliderNumber(v)
                      })
                    }}
                    aria-label={t('Brightness')}
                  />
                  <RowValue>{clip.filter.brightness.toFixed(2)}</RowValue>
                </Row>
                <Row>
                  <RowLabel>{t('Contrast')}</RowLabel>
                  <Slider
                    className='min-w-25 flex-1'
                    min={0}
                    max={2}
                    step={0.05}
                    value={[clip.filter.contrast]}
                    onValueChange={(v) => {
                      mutateClip((c) => {
                        c.filter.contrast = sliderNumber(v)
                      })
                    }}
                    aria-label={t('Contrast')}
                  />
                  <RowValue>{clip.filter.contrast.toFixed(2)}</RowValue>
                </Row>
                <Row>
                  <RowLabel>{t('Saturation')}</RowLabel>
                  <Slider
                    className='min-w-25 flex-1'
                    min={0}
                    max={3}
                    step={0.05}
                    value={[clip.filter.saturation]}
                    onValueChange={(v) => {
                      mutateClip((c) => {
                        c.filter.saturation = sliderNumber(v)
                      })
                    }}
                    aria-label={t('Saturation')}
                  />
                  <RowValue>{clip.filter.saturation.toFixed(2)}</RowValue>
                </Row>
                <Row>
                  <RowLabel>{t('Temperature')}</RowLabel>
                  <Switch
                    checked={clip.filter.temperature > 0}
                    onCheckedChange={(v) => {
                      mutateClip((c) => {
                        c.filter.temperature = v ? 5600 : 0
                      })
                    }}
                    aria-label={t('Temperature')}
                  />
                  {clip.filter.temperature > 0 ? (
                    <>
                      <Slider
                        className='min-w-25 flex-1'
                        min={1000}
                        max={12000}
                        step={100}
                        value={[clip.filter.temperature]}
                        onValueChange={(v) => {
                          mutateClip((c) => {
                            c.filter.temperature = sliderNumber(v)
                          })
                        }}
                        aria-label={t('Temperature')}
                      />
                      <RowValue>{clip.filter.temperature}K</RowValue>
                    </>
                  ) : (
                    <span className='text-muted-foreground text-xs'>
                      {t('Default')}
                    </span>
                  )}
                </Row>
                <Row>
                  <RowLabel>{t('Sharpen')}</RowLabel>
                  <Switch
                    checked={clip.filter.sharpen}
                    onCheckedChange={(v) => {
                      mutateClip((c) => {
                        c.filter.sharpen = v
                      })
                    }}
                    aria-label={t('Sharpen')}
                  />
                  <span className='text-muted-foreground text-xs'>
                    {t('Preview may differ; final result follows cloud render')}
                  </span>
                </Row>
              </PanelBlock>

              {!isLastClip && (
                <PanelBlock title={t('Transition (to next clip)')}>
                  <Row>
                    <NativeSelect
                      className='flex-1'
                      value={clip.transition.type}
                      onChange={(e) => {
                        const v = e.target.value
                        mutateClip((c) => {
                          c.transition.type = v
                        })
                      }}
                    >
                      {TRANSITION_TYPES.map((tr) => (
                        <NativeSelectOption key={tr.value} value={tr.value}>
                          {t(tr.label)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    {clip.transition.type && (
                      <>
                        <Slider
                          className='min-w-25 flex-1'
                          min={0.3}
                          max={2}
                          step={0.1}
                          value={[clip.transition.duration]}
                          onValueChange={(v) => {
                            mutateClip((c) => {
                              c.transition.duration = sliderNumber(v)
                            })
                          }}
                          aria-label={t('Duration')}
                        />
                        <RowValue>
                          {clip.transition.duration.toFixed(1)}s
                        </RowValue>
                      </>
                    )}
                  </Row>
                </PanelBlock>
              )}

              <PanelBlock title={t('Replace Source')}>
                <input ref={replaceInputRef} type='file' accept='video/*' className='hidden' />
                <Button
                  size='sm'
                  variant='outline'
                  disabled={replaceMutation.isPending}
                  onClick={() =>
                    pickFile(replaceInputRef, 'video/*', (file) =>
                      replaceMutation.mutate(file)
                    )
                  }
                >
                  <Upload aria-hidden='true' />
                  {t('Upload a video to replace this clip')}
                </Button>
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Or regenerate the shot in "Video Generation" and click "Sync Storyboards"'
                  )}
                </p>
              </PanelBlock>
            </div>
          ) : (
            <p className='text-muted-foreground py-6 text-center text-sm'>
              {t('Select a clip on the timeline to edit')}
            </p>
          )}
        </TabsContent>

        {/* ============ 字幕 ============ */}
        <TabsContent value='subtitle'>
          <div className='flex flex-col gap-3 py-3'>
            <Row className='justify-between'>
              <span className='text-muted-foreground text-xs'>
                {t('{{count}} subtitles', { count: tl.subtitles.length })}
              </span>
              <Button
                size='sm'
                variant='outline'
                disabled={
                  correctMutation.isPending || tl.subtitles.length === 0
                }
                onClick={() => correctMutation.mutate()}
              >
                <Sparkles aria-hidden='true' />
                {correctMutation.isPending ? t('Correcting...') : t('AI Correct')}
              </Button>
            </Row>
            <div className='max-h-50 space-y-1 overflow-y-auto'>
              {tl.subtitles.map((sub, i) => (
                <div
                  key={`sub-${sub.start}-${sub.end}-${sub.text}`}
                  role='button'
                  tabIndex={0}
                  onClick={() => select('subtitle', i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') select('subtitle', i)
                  }}
                  className={cnRow(
                    selected.type === 'subtitle' && selected.index === i
                  )}
                >
                  <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                    {fmtTime(sub.start)}
                  </span>
                  <span className='flex-1 truncate text-xs'>
                    {sub.text || t('Empty subtitle')}
                  </span>
                  <button
                    type='button'
                    className='text-muted-foreground hover:text-destructive shrink-0'
                    aria-label={t('Delete')}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onChange((data) => {
                        data.subtitles.splice(i, 1)
                      })
                    }}
                  >
                    <X aria-hidden='true' className='size-3.5' />
                  </button>
                </div>
              ))}
            </div>
            {subtitle && (
              <PanelBlock title=''>
                <textarea
                  className='border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border bg-transparent p-2 text-sm outline-none focus-visible:ring-3'
                  rows={2}
                  value={subtitle.text}
                  placeholder={t('Subtitle text')}
                  onChange={(e) => {
                    const v = e.target.value
                    mutateSubtitle((s) => {
                      s.text = v
                    })
                  }}
                />
                <Row>
                  <RowLabel>{t('Start')}</RowLabel>
                  <Input
                    type='number'
                    className='w-24'
                    min={0}
                    step={0.1}
                    value={subtitle.start}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0
                      mutateSubtitle((s) => {
                        s.start = v
                      })
                    }}
                  />
                  <RowLabel>{t('End')}</RowLabel>
                  <Input
                    type='number'
                    className='w-24'
                    min={subtitle.start + 0.1}
                    step={0.1}
                    value={subtitle.end}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0
                      mutateSubtitle((s) => {
                        s.end = v
                      })
                    }}
                  />
                </Row>
                <Row>
                  <RowLabel>{t('Font')}</RowLabel>
                  <NativeSelect
                    className='min-w-25 flex-1'
                    value={subtitle.style.fontFamily}
                    onChange={(e) => {
                      const v = e.target.value
                      mutateSubtitle((s) => {
                        s.style.fontFamily = v
                      })
                    }}
                  >
                    <NativeSelectOption value=''>
                      {t('Default')} PingFang SC
                    </NativeSelectOption>
                    {SUBTITLE_FONTS.map((f) => (
                      <NativeSelectOption key={f} value={f}>
                        {f}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Input
                    type='number'
                    className='w-20'
                    min={12}
                    max={120}
                    value={subtitle.style.fontSize}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 34
                      mutateSubtitle((s) => {
                        s.style.fontSize = v
                      })
                    }}
                    aria-label={t('Font Size')}
                  />
                </Row>
                <Row>
                  <RowLabel>{t('Color')}</RowLabel>
                  <input
                    type='color'
                    className='border-input h-8 w-10 cursor-pointer rounded-lg border bg-transparent p-0.5'
                    value={subtitle.style.color || '#ffffff'}
                    onChange={(e) => {
                      const v = e.target.value
                      mutateSubtitle((s) => {
                        s.style.color = v
                      })
                    }}
                    aria-label={t('Color')}
                  />
                  <RowLabel>{t('Position')}</RowLabel>
                  <ToggleGroup
                    variant='outline'
                    size='sm'
                    spacing={2}
                    value={[subtitle.style.position]}
                    onValueChange={(v) => {
                      const next = v.find((x) => x !== subtitle.style.position)
                      if (next) {
                        mutateSubtitle((s) => {
                          s.style.position = next
                        })
                      }
                    }}
                  >
                    {SUBTITLE_POSITIONS.map((p) => (
                      <ToggleGroupItem key={p.value} value={p.value}>
                        {t(p.label)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Row>
                <Row>
                  <RowLabel>{t('Animation')}</RowLabel>
                  <Switch
                    checked={subtitle.style.animation === 'fade'}
                    onCheckedChange={(v) => {
                      mutateSubtitle((s) => {
                        s.style.animation = v ? 'fade' : ''
                      })
                    }}
                    aria-label={t('Fade In/Out')}
                  />
                  <span className='text-muted-foreground text-xs'>
                    {t('Fade In/Out')}
                  </span>
                </Row>
              </PanelBlock>
            )}
          </div>
        </TabsContent>

        {/* ============ 音频 ============ */}
        <TabsContent value='audio'>
          <div className='flex flex-col gap-3 py-3'>
            <PanelBlock title={t('Background Music')}>
              <input ref={bgmInputRef} type='file' accept='audio/*' className='hidden' />
              <Row>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={uploadMutation.isPending}
                  onClick={() =>
                    pickFile(bgmInputRef, 'audio/*', (file) =>
                      uploadMutation.mutate({ file, kind: 'bgm' })
                    )
                  }
                >
                  <Upload aria-hidden='true' />
                  {tl.audio.bgmUrl ? t('Replace BGM') : t('Upload BGM')}
                </Button>
                {tl.audio.bgmUrl && (
                  <Button
                    size='sm'
                    variant='ghost'
                    className='text-destructive hover:text-destructive'
                    onClick={() => {
                      props.onChange((data) => {
                        data.audio.bgmUrl = ''
                      })
                    }}
                  >
                    {t('Remove')}
                  </Button>
                )}
              </Row>
              {tl.audio.bgmUrl && (
                <audio src={tl.audio.bgmUrl} controls className='h-8 w-full' />
              )}
              <Row>
                <RowLabel>{t('Music Volume')}</RowLabel>
                <Slider
                  className='min-w-25 flex-1'
                  min={0}
                  max={2}
                  step={0.1}
                  value={[tl.audio.bgmVolume]}
                  disabled={!tl.audio.bgmUrl}
                  onValueChange={(v) => {
                    props.onChange((data) => {
                      data.audio.bgmVolume = sliderNumber(v)
                    })
                  }}
                  aria-label={t('Music Volume')}
                />
                <RowValue>{tl.audio.bgmVolume.toFixed(1)}</RowValue>
              </Row>
              <Row>
                <RowLabel>{t('Voice Volume')}</RowLabel>
                <Slider
                  className='min-w-25 flex-1'
                  min={0}
                  max={2}
                  step={0.1}
                  value={[tl.audio.voiceVolume]}
                  onValueChange={(v) => {
                    props.onChange((data) => {
                      data.audio.voiceVolume = sliderNumber(v)
                    })
                  }}
                  aria-label={t('Voice Volume')}
                />
                <RowValue>{tl.audio.voiceVolume.toFixed(1)}</RowValue>
              </Row>
              <p className='text-muted-foreground text-xs'>
                {t(
                  'Voice volume is a global multiplier combined with clip volume; BGM loops under the mix'
                )}
              </p>
            </PanelBlock>
          </div>
        </TabsContent>

        {/* ============ 贴纸 ============ */}
        <TabsContent value='sticker'>
          <div className='flex flex-col gap-3 py-3'>
            <input ref={stickerInputRef} type='file' accept='image/*' className='hidden' />
            <Button
              size='sm'
              variant='outline'
              disabled={uploadMutation.isPending}
              onClick={() =>
                pickFile(stickerInputRef, 'image/*', (file) =>
                  uploadMutation.mutate({ file, kind: 'sticker' })
                )
              }
            >
              <Upload aria-hidden='true' />
              {t('Upload Sticker')}
            </Button>
            <p className='text-muted-foreground text-xs'>
              {t('Position/size are based on output pixels ({{w}}×{{h}})', {
                w: outSize.width,
                h: outSize.height,
              })}
            </p>
            <div className='max-h-50 space-y-1 overflow-y-auto'>
              {tl.stickers.map((stk, i) => (
                <div
                  key={`stk-${stk.url}-${stk.start}-${stk.end}`}
                  role='button'
                  tabIndex={0}
                  onClick={() => select('sticker', i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') select('sticker', i)
                  }}
                  className={cnRow(
                    selected.type === 'sticker' && selected.index === i
                  )}
                >
                  <img
                    src={stk.url}
                    alt=''
                    className='bg-muted size-9 shrink-0 rounded-md object-contain'
                  />
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {fmtTime(stk.start)} ~ {fmtTime(stk.end)}
                  </span>
                  <button
                    type='button'
                    className='text-muted-foreground hover:text-destructive ml-auto shrink-0'
                    aria-label={t('Delete')}
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onChange((data) => {
                        data.stickers.splice(i, 1)
                      })
                    }}
                  >
                    <X aria-hidden='true' className='size-3.5' />
                  </button>
                </div>
              ))}
            </div>
            {sticker && (
              <PanelBlock title=''>
                <Row>
                  <RowLabel>X</RowLabel>
                  <Input
                    type='number'
                    className='w-24'
                    min={0}
                    max={outSize.width}
                    value={sticker.x}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0
                      mutateSticker((s) => {
                        s.x = v
                      })
                    }}
                  />
                  <RowLabel>Y</RowLabel>
                  <Input
                    type='number'
                    className='w-24'
                    min={0}
                    max={outSize.height}
                    value={sticker.y}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0
                      mutateSticker((s) => {
                        s.y = v
                      })
                    }}
                  />
                  <RowLabel>{t('Width')}</RowLabel>
                  <Input
                    type='number'
                    className='w-24'
                    min={20}
                    max={outSize.width}
                    value={sticker.width}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 20
                      mutateSticker((s) => {
                        s.width = v
                      })
                    }}
                  />
                </Row>
                <Row>
                  <RowLabel>{t('Start')}</RowLabel>
                  <Input
                    type='number'
                    className='w-24'
                    min={0}
                    step={0.1}
                    value={sticker.start}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0
                      mutateSticker((s) => {
                        s.start = v
                      })
                    }}
                  />
                  <RowLabel>{t('End')}</RowLabel>
                  <Input
                    type='number'
                    className='w-24'
                    min={sticker.start + 0.1}
                    step={0.1}
                    value={sticker.end}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0
                      mutateSticker((s) => {
                        s.end = v
                      })
                    }}
                  />
                </Row>
                <Row>
                  <Button
                    size='sm'
                    variant='ghost'
                    className='text-destructive hover:text-destructive'
                    onClick={() => {
                      props.onChange((data) => {
                        data.stickers.splice(selected.index, 1)
                      })
                      props.onSelect({ type: '', index: -1 })
                    }}
                  >
                    <Trash2 aria-hidden='true' />
                    {t('Delete')}
                  </Button>
                </Row>
              </PanelBlock>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ----------------------------------------------------------------------------
// 面板内布局小件
// ----------------------------------------------------------------------------

function PanelBlock(props: { title: string; children: React.ReactNode }) {
  return (
    <div className='border-border/60 flex flex-col gap-2.5 border-b border-dashed pb-3 last:border-b-0'>
      {props.title && (
        <div className='text-[13px] font-semibold'>{props.title}</div>
      )}
      {props.children}
    </div>
  )
}

function Row(props: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${props.className ?? ''}`}>
      {props.children}
    </div>
  )
}

function RowLabel(props: { children: React.ReactNode }) {
  return (
    <span className='text-muted-foreground shrink-0 text-xs'>
      {props.children}
    </span>
  )
}

function RowValue(props: { children: React.ReactNode }) {
  return (
    <span className='w-13 shrink-0 text-right text-xs tabular-nums'>
      {props.children}
    </span>
  )
}

function cnRow(active: boolean) {
  return `flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 ${
    active ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-muted'
  }`
}
