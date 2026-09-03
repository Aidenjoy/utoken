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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Film, Pause, Play, RefreshCw } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { handleServerError } from '@/lib/handle-server-error'

import {
  getDirectorEditProject,
  getDirectorEditRenderProgress,
  getDirectorStoryboards,
  saveDirectorEditProject,
  submitDirectorEditRender,
} from '../api'
import type { DirectorEpisode } from '../types'
import { EditPanels } from './edit-panels'
import { EditTimeline } from './edit-timeline'
import {
  ASPECT_RATIO_OPTIONS,
  clipSpans,
  defaultClip,
  emptyTimeline,
  findSpanAt,
  fmtTime,
  outputSize,
  parseTimeline,
  probeVideoDuration,
  sliderNumber,
  totalDuration,
  type EditSelection,
  type EditTimelineData,
} from './edit-utils'

interface EditStepProps {
  episode: DirectorEpisode
  onSaved: () => void
}

export function EditStep(props: EditStepProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [timeline, setTimeline] = React.useState<EditTimelineData>(emptyTimeline)
  const [loaded, setLoaded] = React.useState(false)
  const [selected, setSelected] = React.useState<EditSelection>({
    type: '',
    index: -1,
  })
  const [currentTime, setCurrentTime] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const [previewMode, setPreviewMode] = React.useState<'draft' | 'output'>(
    'draft'
  )
  const [outputStale, setOutputStale] = React.useState(false)
  const videoDurationsRef = React.useRef<Record<string, number>>({})

  const invalidateEditProject = () =>
    queryClient.invalidateQueries({
      queryKey: ['director', 'edit-project', props.episode.id],
    })

  const projectQuery = useQuery({
    queryKey: ['director', 'edit-project', props.episode.id],
    queryFn: () => getDirectorEditProject(props.episode.id),
    // 渲染中时每 3 秒刷新工程状态
    refetchInterval: (query) =>
      query.state.data?.data?.status === 'rendering' ? 3000 : false,
  })

  const storyboardsQuery = useQuery({
    queryKey: ['director', 'storyboards', props.episode.id],
    queryFn: () =>
      getDirectorStoryboards({ episodeId: props.episode.id, page_size: 200 }),
  })

  const editProject = projectQuery.data?.data ?? null
  const rendering = editProject?.status === 'rendering'
  const hasOutput = editProject?.status === 'done' && Boolean(editProject.outputUrl)

  // 探测到源视频真实时长后：校正片段出点并记录源时长（供右缘裁剪上限）
  const patchClipSource = React.useCallback(
    (storyboardId: number, srcUrl: string, dur: number) => {
      videoDurationsRef.current[srcUrl] = dur
      setTimeline((prev) => {
        const idx = prev.clips.findIndex(
          (c) => c.storyboardId === storyboardId && c.srcUrl === srcUrl
        )
        if (idx < 0) return prev
        const next: EditTimelineData = structuredClone(prev)
        next.clips[idx].end = dur
        return next
      })
    },
    []
  )

  const progressQuery = useQuery({
    queryKey: ['director', 'edit-progress', editProject?.id],
    queryFn: () => {
      const id = editProject?.id ?? 0
      if (id <= 0) return Promise.reject(new Error('missing edit project'))
      return getDirectorEditRenderProgress(id)
    },
    enabled: Boolean(editProject?.id) && rendering,
    refetchInterval: rendering ? 3000 : false,
  })

  // 初始化时间轴：优先使用已保存草稿，否则从分镜成片生成
  React.useEffect(() => {
    if (loaded) return
    if (projectQuery.isPending || storyboardsQuery.isPending) return
    const saved = parseTimeline(editProject?.timeline ?? '')
    if (saved) {
      setTimeline(saved)
      setLoaded(true)
      return
    }
    const storyboards = storyboardsQuery.data?.data?.list ?? []
    const clips = storyboards
      .filter((sb) => sb.videoUrl)
      .sort((a, b) => a.storyboardNumber - b.storyboardNumber)
      .map((sb) =>
        defaultClip({
          storyboardId: sb.id,
          srcUrl: sb.videoUrl,
          start: 0,
          end: sb.duration > 0 ? sb.duration : 5,
        })
      )
    const tl = { ...emptyTimeline(), clips }
    setTimeline(tl)
    setLoaded(true)
    // 生成视频实际时长与目标时长可能不一致，探测完成后校正出点（静默）
    for (const clip of tl.clips) {
      void probeVideoDuration(clip.srcUrl).then((d) => {
        if (d > 0) patchClipSource(clip.storyboardId, clip.srcUrl, d)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectQuery.isPending, storyboardsQuery.isPending])

  // 有成片后默认切到成片预览；成片失效时回草稿
  React.useEffect(() => {
    if (!hasOutput) setPreviewMode('draft')
  }, [hasOutput])

  // ---------- 草稿保存（变更后 2s 防抖自动保存） ----------

  const suppressRef = React.useRef(false)
  const saveDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  const saveMutation = useMutation({
    mutationFn: () =>
      saveDirectorEditProject({
        episodeId: props.episode.id,
        name: editProject?.name || props.episode.title,
        timeline: JSON.stringify(timeline),
      }),
    onSuccess: (res) => {
      if (res.success) {
        setDirty(false)
        invalidateEditProject()
      }
    },
    onError: handleServerError,
  })

  const saveDraft = (manual: boolean) => {
    if (rendering) {
      if (manual) toast.warning(t('Cloud render in progress, save later'))
      return
    }
    if (timeline.clips.length === 0) {
      if (manual) toast.warning(t('No clips on the timeline'))
      return
    }
    saveMutation.mutate(undefined, {
      onSuccess: () => {
        if (manual) toast.success(t('Draft saved'))
      },
    })
  }

  // 时间轴变更：标记 dirty + 防抖自动保存
  React.useEffect(() => {
    if (!loaded || suppressRef.current) return
    setDirty(true)
    if (hasOutput) setOutputStale(true)
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
    saveDebounceRef.current = setTimeout(() => saveDraft(false), 2000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline, loaded])

  React.useEffect(
    () => () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current)
    },
    []
  )

  // 提交渲染前先保存草稿，保证云端按最新时间轴渲染
  const renderMutation = useMutation({
    mutationFn: async () => {
      const saveRes = await saveDirectorEditProject({
        episodeId: props.episode.id,
        name: editProject?.name || props.episode.title,
        timeline: JSON.stringify(timeline),
      })
      if (!saveRes.success) {
        throw new Error(saveRes.message || t('Draft save failed'))
      }
      return submitDirectorEditRender(props.episode.id)
    },
    onSuccess: (res) => {
      if (res.success) {
        setDirty(false)
        toast.success(t('Render submitted'))
        invalidateEditProject()
        props.onSaved()
      }
    },
    onError: handleServerError,
  })

  // 渲染完成自动切到成片
  const prevStatusRef = React.useRef('')
  React.useEffect(() => {
    const status = editProject?.status ?? ''
    if (prevStatusRef.current === 'rendering' && status === 'done') {
      setOutputStale(false)
      setPreviewMode('output')
      toast.success(t('Cloud render finished'))
    } else if (prevStatusRef.current === 'rendering' && status === 'failed') {
      toast.error(t('Render failed'))
    }
    prevStatusRef.current = status
  }, [editProject?.status, t])

  // ---------- 同步分镜 ----------

  const [syncing, setSyncing] = React.useState(false)
  const syncFromStoryboards = async () => {
    setSyncing(true)
    try {
      const res = await getDirectorStoryboards({
        episodeId: props.episode.id,
        page_size: 200,
      })
      const storyboards = res.data?.list ?? []
      let updated = 0
      let added = 0
      const probes: { storyboardId: number; srcUrl: string }[] = []
      const next: EditTimelineData = structuredClone(timeline)
      const existing = new Set(
        next.clips.map((c) => c.storyboardId).filter(Boolean)
      )
      for (const clip of next.clips) {
        if (!clip.storyboardId) continue
        const sb = storyboards.find((s) => s.id === clip.storyboardId)
        if (!sb) continue
        const url = sb.videoUrl
        if (url && url !== clip.srcUrl) {
          clip.srcUrl = url
          clip.start = 0
          clip.end = sb.duration > 0 ? sb.duration : clip.end
          updated++
          probes.push({ storyboardId: sb.id, srcUrl: url })
        }
      }
      for (const sb of storyboards) {
        const url = sb.videoUrl
        if (url && !existing.has(sb.id)) {
          next.clips.push(
            defaultClip({
              storyboardId: sb.id,
              srcUrl: url,
              start: 0,
              end: sb.duration > 0 ? sb.duration : 5,
            })
          )
          added++
          probes.push({ storyboardId: sb.id, srcUrl: url })
        }
      }
      if (updated > 0 || added > 0) setTimeline(next)
      for (const p of probes) {
        void probeVideoDuration(p.srcUrl).then((d) => {
          if (d > 0) patchClipSource(p.storyboardId, p.srcUrl, d)
        })
      }
      toast.success(
        updated || added
          ? t('Synced: {{updated}} updated, {{added}} added', {
              updated,
              added,
            })
          : t('No new changes from storyboards')
      )
    } finally {
      setSyncing(false)
    }
  }

  // ---------- 预览播放（video 元素近似预览，片段自动切换） ----------

  const videoRef = React.useRef<HTMLVideoElement>(null)
  const bgmRef = React.useRef<HTMLAudioElement>(null)
  const currentSpanIndexRef = React.useRef(-1)

  const spans = React.useMemo(() => clipSpans(timeline.clips), [timeline.clips])
  const total = React.useMemo(
    () => totalDuration(timeline.clips),
    [timeline.clips]
  )

  const applyVoiceVolume = React.useCallback(() => {
    const v = videoRef.current
    const span = spans[currentSpanIndexRef.current]
    if (!v || !span) return
    let cv = span.clip.volume
    if (span.clip.muted) cv = 0
    else if (cv <= 0) cv = 1
    v.volume = Math.min(cv * timeline.audio.voiceVolume, 1)
  }, [spans, timeline.audio.voiceVolume])

  const ensureClipLoaded = React.useCallback(
    async (span: ReturnType<typeof findSpanAt>, autoplay: boolean) => {
      const v = videoRef.current
      if (!v || !span) return
      const url = span.clip.srcUrl
      if (currentSpanIndexRef.current !== span.index || v.dataset.src !== url) {
        v.src = url
        v.dataset.src = url
        currentSpanIndexRef.current = span.index
      }
      const speed = span.clip.speed > 0 ? span.clip.speed : 1
      v.playbackRate = speed
      applyVoiceVolume()
      const target =
        span.clip.start + Math.max(0, currentTime - span.tlStart) * speed
      if (Math.abs(v.currentTime - target) > 0.15) v.currentTime = target
      if (autoplay) await v.play().catch(() => {})
    },
    [applyVoiceVolume, currentTime]
  )

  const syncBgm = React.useCallback(() => {
    const b = bgmRef.current
    if (!b) return
    if (!timeline.audio.bgmUrl || !playing) {
      b.pause()
      return
    }
    const url = timeline.audio.bgmUrl
    if (b.dataset.src !== url) {
      b.src = url
      b.dataset.src = url
    }
    b.volume = Math.min(timeline.audio.bgmVolume, 1)
    void b.play().catch(() => {})
  }, [timeline.audio.bgmUrl, timeline.audio.bgmVolume, playing])

  const pause = React.useCallback(() => {
    setPlaying(false)
    videoRef.current?.pause()
    bgmRef.current?.pause()
  }, [])

  const play = React.useCallback(async () => {
    if (timeline.clips.length === 0) return
    if (currentTime >= total - 0.05) setCurrentTime(0)
    setPlaying(true)
    const span = findSpanAt(spans, currentTime)
    await ensureClipLoaded(span, true)
    syncBgm()
  }, [timeline.clips.length, currentTime, total, spans, ensureClipLoaded, syncBgm])

  const seek = React.useCallback(
    (time: number) => {
      const t = Math.min(Math.max(Number(time) || 0, 0), total)
      setCurrentTime(t)
      const span = findSpanAt(spans, t)
      if (span) void ensureClipLoaded(span, playing)
      if (playing) syncBgm()
    },
    [total, spans, ensureClipLoaded, playing, syncBgm]
  )

  const onTimeUpdate = () => {
    const v = videoRef.current
    const span = spans[currentSpanIndexRef.current]
    if (!v || !span || !playing) return
    const speed = span.clip.speed > 0 ? span.clip.speed : 1
    setCurrentTime(
      span.tlStart + Math.max(0, v.currentTime - span.clip.start) / speed
    )
    // 到达片段出点：切换下一片段或结束
    if (v.currentTime >= span.clip.end - 0.04) {
      const next = spans[currentSpanIndexRef.current + 1]
      if (next) {
        setCurrentTime(next.tlStart)
        void ensureClipLoaded(next, true)
      } else {
        setCurrentTime(total)
        pause()
      }
    }
  }

  // 正在播放的片段参数变化时实时应用（变速/音量/静音）
  const currentClip = spans[currentSpanIndexRef.current]?.clip ?? null
  React.useEffect(() => {
    const v = videoRef.current
    if (!v || !currentClip) return
    v.playbackRate = currentClip.speed > 0 ? currentClip.speed : 1
    applyVoiceVolume()
  }, [currentClip?.speed, currentClip?.volume, currentClip?.muted, applyVoiceVolume, currentClip])
  React.useEffect(() => {
    if (bgmRef.current) bgmRef.current.volume = Math.min(timeline.audio.bgmVolume, 1)
  }, [timeline.audio.bgmVolume])
  React.useEffect(() => {
    applyVoiceVolume()
  }, [timeline.audio.voiceVolume, applyVoiceVolume])
  React.useEffect(() => {
    syncBgm()
  }, [timeline.audio.bgmUrl, syncBgm])
  React.useEffect(() => {
    if (currentTime > total) setCurrentTime(total)
  }, [total, currentTime])

  // 源视频加载失败（文件缺失等）：播放中自动跳下一片段，避免预览卡死
  const onVideoError = () => {
    if (!playing) return
    const next = spans[currentSpanIndexRef.current + 1]
    if (next) {
      setCurrentTime(next.tlStart)
      void ensureClipLoaded(next, true)
    } else {
      pause()
    }
  }

  // ---------- 预览样式 ----------

  const effectiveRatio = timeline.aspectRatio || props.episode.aspectRatio || '9:16'
  const outSize = outputSize(effectiveRatio, props.episode.resolution)
  const stageStyle: React.CSSProperties =
    outSize.height >= outSize.width
      ? { aspectRatio: `${outSize.width} / ${outSize.height}`, height: 440 }
      : {
          aspectRatio: `${outSize.width} / ${outSize.height}`,
          width: '100%',
          maxWidth: 720,
        }
  const previewScale =
    outSize.height >= outSize.width ? 440 / outSize.height : 720 / outSize.width

  const videoEffectStyle: React.CSSProperties = React.useMemo(() => {
    if (!currentClip) return {}
    const f = currentClip.filter
    const filters: string[] = []
    if (f.brightness) filters.push(`brightness(${1 + f.brightness})`)
    if (f.contrast && f.contrast !== 1) filters.push(`contrast(${f.contrast})`)
    if (f.saturation !== undefined && f.saturation !== 1) {
      filters.push(`saturate(${f.saturation})`)
    }
    const transforms: string[] = []
    if (currentClip.rotate === 180) transforms.push('rotate(180deg)')
    if (currentClip.flip === 'h' || currentClip.flip === 'hv') {
      transforms.push('scaleX(-1)')
    }
    if (currentClip.flip === 'v' || currentClip.flip === 'hv') {
      transforms.push('scaleY(-1)')
    }
    const style: React.CSSProperties = {}
    if (filters.length) style.filter = filters.join(' ')
    if (transforms.length) style.transform = transforms.join(' ')
    return style
  }, [currentClip])

  const activeSubtitles = timeline.subtitles.filter(
    (s) => currentTime >= s.start && currentTime < s.end && s.text
  )
  const activeStickers = timeline.stickers.filter(
    (st) => currentTime >= st.start && currentTime < st.end
  )

  const updateTimeline = (mutate: (tl: EditTimelineData) => void) => {
    setTimeline((tl) => {
      const next: EditTimelineData = structuredClone(tl)
      mutate(next)
      return next
    })
  }

  let saveLabel: string
  if (saveMutation.isPending) saveLabel = t('Saving...')
  else if (dirty) saveLabel = t('Unsaved changes')
  else saveLabel = t('Draft saved')

  const ratioLabel = (r: string) => {
    if (r === '9:16') return `${r} ${t('Portrait')}`
    if (r === '16:9') return `${r} ${t('Landscape')}`
    return r
  }

  let renderLabel: string
  if (!rendering) {
    renderLabel = t('Cloud Render Export')
  } else {
    const percent = progressQuery.data?.data?.percent
    renderLabel = percent
      ? t('Rendering {{percent}}%', { percent })
      : t('Rendering...')
  }

  if (!loaded) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-16 w-full' />
        <Skeleton className='h-64 w-full' />
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3.5'>
      {/* 顶部：标题 + 操作 */}
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div>
          <div className='text-base font-semibold'>{t('Video Editing')}</div>
          <div className='text-muted-foreground mt-1 text-[13px]'>
            {t(
              'Edit generated shot videos online: split & trim, speed & volume, subtitles & color, transitions & stickers, cloud render export'
            )}
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-muted-foreground text-xs'>{saveLabel}</span>
          <NativeSelect
            className='w-40'
            value={timeline.aspectRatio}
            disabled={rendering}
            title={t('Output Aspect Ratio')}
            onChange={(e) =>
              updateTimeline((tl) => {
                tl.aspectRatio = e.target.value
              })
            }
          >
            <NativeSelectOption value=''>
              {t('Follow project ({{ratio}})', {
                ratio: props.episode.aspectRatio || '9:16',
              })}
            </NativeSelectOption>
            {ASPECT_RATIO_OPTIONS.map((r) => (
              <NativeSelectOption key={r} value={r}>
                {ratioLabel(r)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            size='sm'
            variant='outline'
            disabled={syncing}
            onClick={() => void syncFromStoryboards()}
          >
            <RefreshCw
              aria-hidden='true'
              className={syncing ? 'animate-spin' : ''}
            />
            {t('Sync Storyboards')}
          </Button>
          <Button
            size='sm'
            variant='outline'
            disabled={rendering}
            onClick={() => saveDraft(true)}
          >
            {saveMutation.isPending ? t('Saving...') : t('Save Draft')}
          </Button>
          <Button
            size='sm'
            disabled={rendering || timeline.clips.length === 0}
            onClick={() => renderMutation.mutate()}
          >
            {renderLabel}
          </Button>
        </div>
      </div>

      {timeline.clips.length === 0 ? (
        <Alert>
          <Film aria-hidden='true' className='size-4' />
          <AlertDescription>
            {t('No clips to edit. Finish the "Video Generation" step first.')}
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <div className='flex flex-col gap-4 xl:flex-row xl:items-start'>
            {/* 预览区 */}
            <div className='flex min-w-0 flex-1 flex-col items-center gap-2.5'>
              <div
                className='relative max-w-full overflow-hidden rounded-xl bg-black'
                style={stageStyle}
              >
                {hasOutput && (
                  <div className='pointer-events-none absolute top-2.5 right-0 left-0 z-7 flex items-center justify-center px-2.5'>
                    <div className='pointer-events-auto flex gap-0.5 rounded-full bg-black/60 p-0.75 backdrop-blur-md'>
                      <button
                        type='button'
                        className={
                          previewMode === 'draft'
                            ? 'rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-neutral-900'
                            : 'rounded-full px-3.5 py-1.5 text-xs text-white/70'
                        }
                        onClick={() => setPreviewMode('draft')}
                      >
                        {t('Draft Preview')}
                      </button>
                      <button
                        type='button'
                        className={
                          previewMode === 'output'
                            ? 'flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-neutral-900'
                            : 'flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs text-white/70'
                        }
                        onClick={() => setPreviewMode('output')}
                      >
                        {t('Latest Output')}
                        {outputStale && (
                          <i
                            className='inline-block size-1.5 rounded-full bg-amber-500'
                            title={t('Timeline changed; output is stale')}
                          />
                        )}
                      </button>
                    </div>
                    {previewMode === 'output' && (
                      <a
                        className='pointer-events-auto absolute top-1/2 right-2.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md'
                        href={editProject.outputUrl}
                        target='_blank'
                        rel='noreferrer'
                        title={t('Download output')}
                      >
                        <Download aria-hidden='true' className='size-4' />
                      </a>
                    )}
                  </div>
                )}

                {previewMode === 'output' && hasOutput ? (
                  <>
                    <video
                      key={editProject.outputUrl}
                      src={editProject.outputUrl}
                      controls
                      playsInline
                      className='size-full object-contain'
                    />
                    {outputStale && (
                      <div className='absolute right-0 bottom-0 left-0 z-6 bg-amber-500/90 p-1.5 text-center text-xs text-white'>
                        {t('Timeline changed; this output is stale. Re-render after editing')}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <video
                      ref={videoRef}
                      playsInline
                      className='size-full object-contain'
                      style={videoEffectStyle}
                      onTimeUpdate={onTimeUpdate}
                      onError={onVideoError}
                    />
                    {activeSubtitles.map((s) => {
                      let posClass: string
                      if (s.style.position === 'top') {
                        posClass = 'right-[6%] left-[6%] top-[6%]'
                      } else if (s.style.position === 'middle') {
                        posClass =
                          'right-[6%] left-[6%] top-1/2 -translate-y-1/2'
                      } else {
                        posClass = 'right-[6%] bottom-[6%] left-[6%]'
                      }
                      return (
                        <div
                          key={`sub-${s.start}-${s.end}-${s.text}`}
                          className={`pointer-events-none absolute z-4 text-center font-semibold break-all ${posClass}`}
                          style={{
                            fontSize: Math.max(
                              (s.style.fontSize || 34) * previewScale,
                              10
                            ),
                            color: s.style.color || '#ffffff',
                            fontFamily: s.style.fontFamily || 'PingFang SC',
                            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                            lineHeight: 1.4,
                          }}
                        >
                          {s.text}
                        </div>
                      )
                    })}
                    {activeStickers.map((st) => (
                      <img
                        key={`stk-${st.url}-${st.start}-${st.end}`}
                        src={st.url}
                        alt=''
                        className='pointer-events-none absolute z-5'
                        style={{
                          left: `${(st.x / outSize.width) * 100}%`,
                          top: `${(st.y / outSize.height) * 100}%`,
                          width: `${(st.width / outSize.width) * 100}%`,
                        }}
                      />
                    ))}
                  </>
                )}

                {rendering && (
                  <div className='absolute inset-0 z-6 flex flex-col items-center justify-center gap-2 bg-black/55 text-[13px] text-white'>
                    <span>
                      {progressQuery.data?.data?.detail ||
                        t('Cloud rendering, usually takes a few minutes')}
                    </span>
                    {progressQuery.data?.data && (
                      <Progress
                        className='w-3/5 bg-white/20'
                        value={progressQuery.data.data.percent}
                      />
                    )}
                  </div>
                )}
              </div>

              {previewMode === 'draft' && (
                <div className='flex w-full items-center gap-2.5'>
                  <Button
                    size='icon'
                    variant='outline'
                    className='size-8 rounded-full'
                    aria-label={playing ? t('Pause') : t('Play')}
                    onClick={() => (playing ? pause() : void play())}
                  >
                    {playing ? (
                      <Pause aria-hidden='true' className='size-3.5' />
                    ) : (
                      <Play aria-hidden='true' className='size-3.5' />
                    )}
                  </Button>
                  <span className='text-muted-foreground shrink-0 text-xs tabular-nums'>
                    {fmtTime(currentTime)} / {fmtTime(total)}
                  </span>
                  <Slider
                    className='flex-1'
                    min={0}
                    max={Math.max(total, 0.1)}
                    step={0.1}
                    value={[currentTime]}
                    onValueChange={(v) => seek(sliderNumber(v))}
                    aria-label={t('Seek')}
                  />
                </div>
              )}
              {previewMode === 'draft' && (
                <p className='text-muted-foreground text-xs'>
                  {t(
                    'Preview is approximate (speed/volume/filters apply instantly); transitions, sharpen and temperature follow the cloud render'
                  )}
                </p>
              )}
              <audio ref={bgmRef} loop className='hidden' />

              {editProject?.status === 'failed' && editProject.errorMsg && (
                <Alert variant='destructive'>
                  <AlertDescription>
                    {t('Render failed')}: {editProject.errorMsg}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* 右侧属性面板 */}
            <EditPanels
              tl={timeline}
              selected={selected}
              episodeId={props.episode.id}
              projectId={props.episode.projectId}
              aspectRatio={effectiveRatio}
              resolution={props.episode.resolution || '1080P'}
              currentTime={currentTime}
              onSelect={setSelected}
              onChange={updateTimeline}
            />
          </div>

          {/* 底部多轨时间轴 */}
          <EditTimeline
            tl={timeline}
            storyboards={storyboardsQuery.data?.data?.list ?? []}
            currentTime={currentTime}
            selected={selected}
            videoDurations={videoDurationsRef.current}
            onSeek={seek}
            onSelect={setSelected}
            onChange={updateTimeline}
          />
        </>
      )}
    </div>
  )
}
