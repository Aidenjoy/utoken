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
import {
  ArrowDown,
  ArrowUp,
  Clapperboard,
  Film,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { handleServerError } from '@/lib/handle-server-error'

import {
  correctDirectorSubtitles,
  getDirectorEditProject,
  getDirectorEditRenderProgress,
  getDirectorStoryboards,
  saveDirectorEditProject,
  submitDirectorEditRender,
} from '../api'
import type { DirectorEpisode } from '../types'

// 时间轴结构（与后端 service/director/edit.go 的 editTimeline 对应，仅取剪辑页需要的字段）
interface EditClip {
  storyboardId: number
  srcUrl: string
  start: number
  end: number
  speed: number
  volume: number
}

interface EditSubtitle {
  text: string
  start: number
  end: number
  // 前端本地唯一键（后端透传存储，解析时忽略未知字段）
  keyId: string
}

interface EditTimeline {
  clips: EditClip[]
  subtitles: EditSubtitle[]
  audio: { bgmUrl: string; bgmVolume: number; voiceVolume: number }
}

function emptyTimeline(): EditTimeline {
  return {
    clips: [],
    subtitles: [],
    audio: { bgmUrl: '', bgmVolume: 0.5, voiceVolume: 1 },
  }
}

function parseTimeline(raw: string): EditTimeline | null {
  const s = raw?.trim()
  if (!s || s === 'null') return null
  try {
    const parsed = JSON.parse(s) as Partial<EditTimeline>
    return {
      clips: parsed.clips ?? [],
      subtitles: (parsed.subtitles ?? []).map((sub) => ({
        ...sub,
        keyId: sub.keyId ?? crypto.randomUUID(),
      })),
      audio: {
        bgmUrl: parsed.audio?.bgmUrl ?? '',
        bgmVolume: parsed.audio?.bgmVolume ?? 0.5,
        voiceVolume: parsed.audio?.voiceVolume ?? 1,
      },
    }
  } catch {
    return null
  }
}

interface EditStepProps {
  episode: DirectorEpisode
  onSaved: () => void
}

export function EditStep(props: EditStepProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [timeline, setTimeline] = React.useState<EditTimeline>(emptyTimeline())
  const [loaded, setLoaded] = React.useState(false)

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
    const clips: EditClip[] = storyboards
      .filter((sb) => sb.videoUrl)
      .sort((a, b) => a.storyboardNumber - b.storyboardNumber)
      .map((sb) => ({
        storyboardId: sb.id,
        srcUrl: sb.videoUrl,
        start: 0,
        end: sb.duration > 0 ? sb.duration : 5,
        speed: 1,
        volume: 1,
      }))
    setTimeline({ ...emptyTimeline(), clips })
    setLoaded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectQuery.isPending, storyboardsQuery.isPending])

  const saveMutation = useMutation({
    mutationFn: () =>
      saveDirectorEditProject({
        episodeId: props.episode.id,
        name: editProject?.name || props.episode.title,
        timeline: JSON.stringify(timeline),
      }),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Timeline saved'))
        queryClient.invalidateQueries({
          queryKey: ['director', 'edit-project', props.episode.id],
        })
      }
    },
    onError: handleServerError,
  })

  const renderMutation = useMutation({
    mutationFn: () => submitDirectorEditRender(props.episode.id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Render submitted'))
        queryClient.invalidateQueries({
          queryKey: ['director', 'edit-project', props.episode.id],
        })
        props.onSaved()
      }
    },
    onError: handleServerError,
  })

  const correctMutation = useMutation({
    mutationFn: () =>
      correctDirectorSubtitles({
        episodeId: props.episode.id,
        subtitles: timeline.subtitles,
      }),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Subtitles corrected'))
        const subtitles = (res.data as { subtitles?: EditSubtitle[] })
          ?.subtitles
        if (Array.isArray(subtitles)) {
          setTimeline((tl) => ({
            ...tl,
            subtitles: subtitles.map((sub) => ({
              ...sub,
              keyId: crypto.randomUUID(),
            })),
          }))
        }
      }
    },
    onError: handleServerError,
  })

  const moveClip = (index: number, delta: number) => {
    setTimeline((tl) => {
      const clips = [...tl.clips]
      const target = index + delta
      if (target < 0 || target >= clips.length) return tl
      const [clip] = clips.splice(index, 1)
      clips.splice(target, 0, clip)
      return { ...tl, clips }
    })
  }

  const removeClip = (index: number) => {
    setTimeline((tl) => ({
      ...tl,
      clips: tl.clips.filter((_, i) => i !== index),
    }))
  }

  const updateClip = (index: number, patch: Partial<EditClip>) => {
    setTimeline((tl) => ({
      ...tl,
      clips: tl.clips.map((clip, i) =>
        i === index ? { ...clip, ...patch } : clip
      ),
    }))
  }

  const updateSubtitleByKey = (keyId: string, patch: Partial<EditSubtitle>) => {
    setTimeline((tl) => ({
      ...tl,
      subtitles: tl.subtitles.map((sub) =>
        sub.keyId === keyId ? { ...sub, ...patch } : sub
      ),
    }))
  }

  if (!loaded) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-16 w-full' />
        <Skeleton className='h-16 w-full' />
      </div>
    )
  }

  return (
    <div className='space-y-6'>
      {/* 剪辑片段 */}
      <section className='space-y-3'>
        <h4 className='font-medium'>{t('Clips')}</h4>
        {timeline.clips.length === 0 ? (
          <Alert>
            <Film aria-hidden='true' className='size-4' />
            <AlertDescription>
              {t('No video clips available. Generate shot videos first.')}
            </AlertDescription>
          </Alert>
        ) : (
          <div className='space-y-2'>
            {timeline.clips.map((clip, index) => (
              <div
                key={`${clip.storyboardId}-${clip.srcUrl}`}
                className='flex items-center gap-3 rounded-lg border p-2'
              >
                <Badge variant='outline' className='shrink-0'>
                  {index + 1}
                </Badge>
                <video
                  src={clip.srcUrl}
                  preload='metadata'
                  muted
                  className='h-16 w-28 shrink-0 rounded bg-black object-cover'
                />
                <div className='grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3'>
                  <div className='grid gap-1'>
                    <Label className='text-xs'>{t('Start (s)')}</Label>
                    <Input
                      type='number'
                      min={0}
                      value={clip.start}
                      onChange={(e) =>
                        updateClip(index, {
                          start: Number(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                  <div className='grid gap-1'>
                    <Label className='text-xs'>{t('End (s)')}</Label>
                    <Input
                      type='number'
                      min={0}
                      value={clip.end}
                      onChange={(e) =>
                        updateClip(index, { end: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                  <div className='grid gap-1'>
                    <Label className='text-xs'>{t('Speed')}</Label>
                    <Input
                      type='number'
                      min={0.25}
                      max={10}
                      step={0.25}
                      value={clip.speed}
                      onChange={(e) =>
                        updateClip(index, {
                          speed: Number(e.target.value) || 1,
                        })
                      }
                    />
                  </div>
                </div>
                <div className='flex shrink-0 flex-col gap-1'>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-6'
                    aria-label={t('Move up')}
                    onClick={() => moveClip(index, -1)}
                  >
                    <ArrowUp aria-hidden='true' className='size-3.5' />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='size-6'
                    aria-label={t('Move down')}
                    onClick={() => moveClip(index, 1)}
                  >
                    <ArrowDown aria-hidden='true' className='size-3.5' />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon'
                    className='text-destructive hover:text-destructive size-6'
                    aria-label={t('Remove clip')}
                    onClick={() => removeClip(index)}
                  >
                    <Trash2 aria-hidden='true' className='size-3.5' />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 背景音乐 */}
      <section className='space-y-3'>
        <h4 className='font-medium'>{t('Background Music')}</h4>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
          <div className='grid gap-1 sm:col-span-2'>
            <Label htmlFor='director-bgm-url'>{t('Music URL')}</Label>
            <Input
              id='director-bgm-url'
              value={timeline.audio.bgmUrl}
              onChange={(e) =>
                setTimeline((tl) => ({
                  ...tl,
                  audio: { ...tl.audio, bgmUrl: e.target.value },
                }))
              }
              placeholder={t('Optional background music URL')}
            />
          </div>
          <div className='grid gap-1'>
            <Label htmlFor='director-bgm-volume'>{t('Music Volume')}</Label>
            <Input
              id='director-bgm-volume'
              type='number'
              min={0}
              max={2}
              step={0.1}
              value={timeline.audio.bgmVolume}
              onChange={(e) =>
                setTimeline((tl) => ({
                  ...tl,
                  audio: {
                    ...tl.audio,
                    bgmVolume: Number(e.target.value) || 0,
                  },
                }))
              }
            />
          </div>
        </div>
      </section>

      {/* 字幕 */}
      <section className='space-y-3'>
        <div className='flex items-center justify-between'>
          <h4 className='font-medium'>{t('Subtitles')}</h4>
          <div className='flex gap-2'>
            <Button
              size='sm'
              variant='outline'
              disabled={
                correctMutation.isPending || timeline.subtitles.length === 0
              }
              onClick={() => correctMutation.mutate()}
            >
              <Sparkles aria-hidden='true' />
              {correctMutation.isPending ? t('Correcting...') : t('AI Correct')}
            </Button>
            <Button
              size='sm'
              variant='outline'
              onClick={() =>
                setTimeline((tl) => ({
                  ...tl,
                  subtitles: [
                    ...tl.subtitles,
                    { text: '', start: 0, end: 2, keyId: crypto.randomUUID() },
                  ],
                }))
              }
            >
              <Plus aria-hidden='true' />
              {t('Add')}
            </Button>
          </div>
        </div>
        {timeline.subtitles.length === 0 ? (
          <p className='text-muted-foreground text-sm'>
            {t('No subtitles yet. Add lines to overlay text on the video.')}
          </p>
        ) : (
          <div className='space-y-2'>
            {timeline.subtitles.map((subtitle) => (
              <div key={subtitle.keyId} className='flex items-center gap-2'>
                <Input
                  className='flex-1'
                  value={subtitle.text}
                  onChange={(e) =>
                    updateSubtitleByKey(subtitle.keyId, {
                      text: e.target.value,
                    })
                  }
                  placeholder={t('Subtitle text')}
                />
                <Input
                  type='number'
                  className='w-20'
                  min={0}
                  value={subtitle.start}
                  onChange={(e) =>
                    updateSubtitleByKey(subtitle.keyId, {
                      start: Number(e.target.value) || 0,
                    })
                  }
                  aria-label={t('Start (s)')}
                />
                <Input
                  type='number'
                  className='w-20'
                  min={0}
                  value={subtitle.end}
                  onChange={(e) =>
                    updateSubtitleByKey(subtitle.keyId, {
                      end: Number(e.target.value) || 0,
                    })
                  }
                  aria-label={t('End (s)')}
                />
                <Button
                  variant='ghost'
                  size='icon'
                  className='text-destructive hover:text-destructive size-8'
                  aria-label={t('Delete')}
                  onClick={() =>
                    setTimeline((tl) => ({
                      ...tl,
                      subtitles: tl.subtitles.filter(
                        (sub) => sub.keyId !== subtitle.keyId
                      ),
                    }))
                  }
                >
                  <Trash2 aria-hidden='true' className='size-4' />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 渲染状态与操作 */}
      <section className='space-y-3'>
        {editProject?.status === 'done' && editProject.outputUrl ? (
          <div className='space-y-2'>
            <h4 className='font-medium'>{t('Final Video')}</h4>
            <video
              src={editProject.outputUrl}
              controls
              className='max-h-96 rounded'
            />
          </div>
        ) : null}
        {editProject?.status === 'failed' && editProject.errorMsg ? (
          <Alert variant='destructive'>
            <Clapperboard aria-hidden='true' className='size-4' />
            <AlertDescription>{editProject.errorMsg}</AlertDescription>
          </Alert>
        ) : null}
        {rendering ? (
          <div className='space-y-2'>
            <div className='flex items-center justify-between text-sm'>
              <span>
                {progressQuery.data?.data?.detail || t('Rendering...')}
              </span>
              <span>{progressQuery.data?.data?.percent ?? 0}%</span>
            </div>
            <Progress value={progressQuery.data?.data?.percent ?? 0} />
          </div>
        ) : null}
        <div className='flex gap-2'>
          <Button
            variant='outline'
            onClick={() => saveMutation.mutate()}
            disabled={
              saveMutation.isPending || rendering || timeline.clips.length === 0
            }
          >
            {saveMutation.isPending ? t('Saving...') : t('Save Draft')}
          </Button>
          <Button
            onClick={() => renderMutation.mutate()}
            disabled={
              renderMutation.isPending ||
              rendering ||
              timeline.clips.length === 0
            }
          >
            <Film aria-hidden='true' />
            {renderMutation.isPending ? t('Submitting...') : t('Render Video')}
          </Button>
        </div>
      </section>
    </div>
  )
}
