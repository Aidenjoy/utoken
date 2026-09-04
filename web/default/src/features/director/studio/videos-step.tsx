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
  AlertTriangle,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Loader2,
  Play,
  Video as VideoIcon,
  XCircle,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { handleServerError } from '@/lib/handle-server-error'
import { cn } from '@/lib/utils'

import {
  generateStoryboardVideo,
  generateStoryboardVideoPrompt,
  getDirectorStoryboards,
  getDirectorVideoGenerations,
} from '../api'
import { MentionEditor } from '../components/mention-editor'
import {
  formatMentions,
  MENTION_KIND_LABEL,
  type MentionAsset,
} from '../components/mention-utils'
import { useMentionAssets } from '../hooks/use-mention-assets'
import { useStoryboardGenTracker } from '../hooks/use-storyboard-gen-tracker'
import type {
  DirectorEpisode,
  DirectorStoryboard,
  DirectorVideoGeneration,
} from '../types'
import { sliderNumber } from './edit-utils'

// adaptive=智能比例（上游按输入图片自适应画幅）；首帧/首尾帧模式上游强制 adaptive
const RATIO_OPTIONS = ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16']
const RESOLUTION_OPTIONS = ['480p', '720p', '1080p', '4k']
const COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8]

const MENTION_TEST_RE = /@\[(char|prop|scene|shot|video):\d+\]/
const MENTION_TOKEN_RE = /@\[(char|prop|scene|shot|video):(\d+)\]/g

// 胶片上下齿孔（内联样式，避免新增全局 CSS）
const FILM_HOLE_STYLE: React.CSSProperties = {
  backgroundImage:
    'radial-gradient(circle at 3.5px 3px, rgba(255,255,255,0.22) 2px, transparent 2.6px)',
  backgroundSize: '13px 6px',
  backgroundRepeat: 'repeat-x',
}

interface VideosStepProps {
  episode: DirectorEpisode
  onSaved: () => void
}

interface VideoGenDialogState {
  id: number
  storyboardNumber: number
  firstFrameImage: string
  prompt: string
  frameMode: 'reference' | 'first_last'
  duration: number
}

export function VideosStep(props: VideosStepProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const queryKey = ['director', 'storyboards', props.episode.id]

  const listQuery = useQuery({
    queryKey,
    queryFn: () =>
      getDirectorStoryboards({ episodeId: props.episode.id, page_size: 200 }),
  })
  const storyboards = React.useMemo(
    () => listQuery.data?.data?.list ?? [],
    [listQuery.data]
  )
  const storyboardsRef = React.useRef<DirectorStoryboard[]>([])
  storyboardsRef.current = storyboards

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey })
    props.onSaved()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, props.episode.id])

  const mentionAssets = useMentionAssets(props.episode)
  const kindLabel = React.useCallback(
    (kind: MentionAsset['kind']) => t(MENTION_KIND_LABEL[kind]),
    [t]
  )

  // ---------- 生成中状态跟踪 + 失败原因（刷新/切页后可恢复） ----------

  const [failMsgs, setFailMsgs] = React.useState<Record<number, string>>({})

  const clearFailMsg = React.useCallback((id: number) => {
    setFailMsgs((m) => {
      if (!(id in m)) return m
      const next = { ...m }
      delete next[id]
      return next
    })
  }, [])

  // 同步任务状态：处理中的恢复跟踪；最近一次失败且未出片的显示失败原因
  const syncGenState = React.useCallback(async () => {
    const local = new Set(storyboardsRef.current.map((s) => s.id))
    if (local.size === 0) return
    try {
      const res = await getDirectorVideoGenerations({
        projectId: props.episode.projectId,
        page_size: 200,
      })
      const tasks = res.data?.list ?? [] // 列表按 id 倒序，首个即该分镜最新任务
      const latest = new Map<number, DirectorVideoGeneration>()
      for (const task of tasks) {
        if (
          task.storyboardId &&
          local.has(task.storyboardId) &&
          !latest.has(task.storyboardId)
        ) {
          latest.set(task.storyboardId, task)
        }
      }
      const processing: number[] = []
      const msgs: Record<number, string> = {}
      for (const [sid, task] of latest) {
        if (task.status === 'processing') {
          processing.push(sid)
        } else if (task.status === 'failed') {
          const sb = storyboardsRef.current.find((s) => s.id === sid)
          if (sb && !sb.videoUrl) {
            msgs[sid] = task.errorMsg || t('Unknown error')
          }
        }
      }
      setFailMsgs(msgs)
      if (processing.length) tracker.adoptGenerating(processing)
    } catch {
      // 忽略状态同步异常
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.episode.projectId, t])

  const tracker = useStoryboardGenTracker({
    kind: 'video',
    projectId: props.episode.projectId,
    onChange: () => {
      refresh()
      void syncGenState()
    },
  })
  const isGenerating = (id: number) => tracker.generatingIds.has(id)

  const markGenerating = React.useCallback(
    (id: number) => {
      tracker.markGenerating(id)
      clearFailMsg(id)
    },
    [tracker, clearFailMsg]
  )

  // 首次进入：恢复处理中任务跟踪与失败原因
  const restoredRef = React.useRef(false)
  React.useEffect(() => {
    if (restoredRef.current || !listQuery.data) return
    restoredRef.current = true
    void syncGenState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listQuery.data])

  const pendingList = storyboards.filter(
    (s) => !s.videoUrl && s.firstFrameImage && !isGenerating(s.id)
  )
  const promptPendingList = storyboards.filter((s) => !s.videoPrompt)

  // ---------- 运动 prompt 生成 ----------

  const [promptGenId, setPromptGenId] = React.useState(0)
  const promptMutation = useMutation({
    mutationFn: (id: number) => generateStoryboardVideoPrompt(id),
    onSuccess: (res, id) => {
      if (res.success) {
        const num = storyboards.find((s) => s.id === id)?.storyboardNumber
        toast.success(
          t('Motion prompt generated for shot #{{number}}', { number: num })
        )
        refresh()
      }
    },
    onError: handleServerError,
    onSettled: () => setPromptGenId(0),
  })

  // 批量补齐缺失的运动 prompt（服务端有并发队列限流，顺序提交即可）
  const [batchPrompting, setBatchPrompting] = React.useState(false)
  const generateAllPrompts = async () => {
    setBatchPrompting(true)
    let ok = 0
    try {
      for (const s of promptPendingList) {
        const res = await generateStoryboardVideoPrompt(s.id)
        if (res.success) ok++
      }
      toast.success(t('Generated {{count}} motion prompts', { count: ok }))
      refresh()
    } finally {
      setBatchPrompting(false)
    }
  }

  // ---------- 视频生成 ----------

  const [submittingId, setSubmittingId] = React.useState(0)
  const videoMutation = useMutation({
    mutationFn: (params: {
      id: number
      prompt: string
      frameMode: string
      aspectRatio: string
      resolution: string
      duration: number
      count: number
    }) => generateStoryboardVideo(params),
    onSuccess: (res, params) => {
      if (res.success) {
        markGenerating(params.id)
        toast.success(
          t('Submitted {{count}} video generation task(s) for shot #{{number}}', {
            count: params.count,
            number: genDialog?.storyboardNumber,
          })
        )
        setGenDialog(null)
        refresh()
      }
    },
    onError: handleServerError,
    onSettled: () => setSubmittingId(0),
  })

  // ---------- 批量生成 ----------

  const [batchSubmitting, setBatchSubmitting] = React.useState(false)
  const generateAll = async () => {
    setBatchSubmitting(true)
    let ok = 0
    try {
      for (const s of pendingList) {
        const res = await generateStoryboardVideo({
          id: s.id,
          frameMode: 'reference',
        })
        if (res.success) {
          ok++
          markGenerating(s.id)
        }
      }
      toast.success(
        t('Submitted {{count}} video generation tasks', { count: ok })
      )
    } finally {
      setBatchSubmitting(false)
    }
  }

  // ---------- 生成参数弹窗 ----------

  const [genDialog, setGenDialog] = React.useState<VideoGenDialogState | null>(
    null
  )
  // 画幅/分辨率/数量在多次打开间保持（对齐原项目行为）
  const [aspectRatio, setAspectRatio] = React.useState('9:16')
  const [resolution, setResolution] = React.useState('720p')
  const [count, setCount] = React.useState(1)
  const [mentionConfirmOpen, setMentionConfirmOpen] = React.useState(false)

  const openDialog = (s: DirectorStoryboard) => {
    setGenDialog({
      id: s.id,
      storyboardNumber: s.storyboardNumber,
      firstFrameImage: s.firstFrameImage || '',
      prompt: (s.videoPrompt || '').trim(),
      frameMode: 'reference',
      duration: s.duration >= 4 && s.duration <= 15 ? s.duration : 5,
    })
  }

  // 下一镜头图（列表序：镜号+ID）：首尾帧模式的尾帧来源。
  // 同一镜号可有多张镜头图，尾帧取列表下一张有图记录，保证逐张衔接、视频可拼接
  const nextShot = React.useMemo(() => {
    if (!genDialog) return null
    const sorted = [...storyboards].sort(
      (a, b) => a.storyboardNumber - b.storyboardNumber || a.id - b.id
    )
    const idx = sorted.findIndex((s) => s.id === genDialog.id)
    if (idx < 0) return null
    return sorted.slice(idx + 1).find((s) => s.firstFrameImage) || null
  }, [genDialog, storyboards])
  const lastFrameImage = nextShot?.firstFrameImage || ''

  // 首尾帧模式下提示词是否含 @ 引用（该模式不支持图片引用，需提示用户）
  const hasMentions = genDialog ? MENTION_TEST_RE.test(genDialog.prompt) : false
  // 解析 prompt 中 @ 引用 token 为资产缩略图列表（胶片带展示，去重保序）
  const mentionItems = React.useMemo(() => {
    if (!genDialog) return []
    const tokens = genDialog.prompt.match(MENTION_TOKEN_RE) || []
    const items: MentionAsset[] = []
    for (const token of tokens) {
      const m = token.match(/@\[(char|prop|scene|shot|video):(\d+)\]/)
      if (!m) continue
      const a = mentionAssets.find(
        (x) => x.kind === m[1] && x.id === Number(m[2])
      )
      if (a && !items.some((i) => i.kind === a.kind && i.id === a.id)) {
        items.push(a)
      }
    }
    return items
  }, [genDialog, mentionAssets])

  const doSubmit = React.useCallback(() => {
    if (!genDialog) return
    setSubmittingId(genDialog.id)
    videoMutation.mutate({
      id: genDialog.id,
      prompt: genDialog.prompt.trim(),
      frameMode: genDialog.frameMode,
      aspectRatio,
      resolution,
      duration: genDialog.duration,
      count,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genDialog, aspectRatio, resolution, count])

  const submitOne = () => {
    if (!genDialog) return
    if (!genDialog.prompt.trim()) {
      toast.warning(t('Please fill in the motion prompt'))
      return
    }
    // 首尾帧模式不支持 @ 图片引用：提交前拦截提示，用户可选择忽略 @ 继续或取消后切换模式
    if (genDialog.frameMode === 'first_last' && hasMentions) {
      setMentionConfirmOpen(true)
      return
    }
    doSubmit()
  }

  // ---------- 渲染 ----------

  const renderCard = (s: DirectorStoryboard) => {
    const generating = isGenerating(s.id)
    const failMsg = failMsgs[s.id]
    const formatted = formatMentions(s.videoPrompt, mentionAssets, kindLabel)

    let videoContent: React.ReactNode
    if (s.videoUrl) {
      videoContent = (
        <video
          src={s.videoUrl}
          controls
          preload='metadata'
          className='size-full object-contain'
        />
      )
    } else if (generating) {
      videoContent = (
        <div className='from-primary/10 to-muted text-primary flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br text-[13px]'>
          <Loader2 aria-hidden='true' className='size-6.5 animate-spin' />
          <span>{t('Generating video...')}</span>
          <span className='text-muted-foreground text-[11px]'>
            {t('Usually takes 2-5 minutes')}
          </span>
          <div className='bg-muted-foreground/20 mt-1 h-1 w-[70%] overflow-hidden rounded-sm'>
            <div className='bg-primary h-full w-2/5 animate-[light-slide_1.4s_ease-in-out_infinite] rounded-sm' />
          </div>
        </div>
      )
    } else if (failMsg) {
      videoContent = (
        <div className='flex size-full flex-col items-center justify-center gap-1.5 bg-[#1f1416] px-3.5 text-center text-xs text-red-300'>
          <XCircle aria-hidden='true' className='size-6 text-red-400' />
          <span>{t('Generation failed')}</span>
          <span
            className='line-clamp-3 text-[11px] leading-4 text-red-300/85'
            title={failMsg}
          >
            {failMsg}
          </span>
          <span className='text-[11px] text-red-300/55'>
            {t('Regenerate the shot image and retry')}
          </span>
        </div>
      )
    } else {
      videoContent = (
        <div className='text-muted-foreground bg-muted flex size-full flex-col items-center justify-center gap-1.5 text-xs'>
          <VideoIcon aria-hidden='true' className='size-7' />
          <span>{t('Not generated')}</span>
        </div>
      )
    }

    let promptLabel: string
    if (promptGenId === s.id) promptLabel = t('Generating...')
    else if (s.videoPrompt) promptLabel = t('Regenerate Prompt')
    else promptLabel = t('Generate Prompt')

    let generateLabel: string
    if (generating) generateLabel = t('Generating')
    else if (s.videoUrl) generateLabel = t('Regenerate')
    else generateLabel = t('Generate Video')

    return (
      <div
        key={s.id}
        className='bg-card flex flex-col overflow-hidden rounded-xl border transition-shadow hover:shadow-md'
      >
        <div className='relative aspect-[9/16] max-h-85 w-full bg-black'>
          {videoContent}
          <div className='absolute top-1.5 left-1.5 rounded bg-black/55 px-2 py-0.5 text-xs text-white'>
            #{s.storyboardNumber}
          </div>
        </div>
        <div className='flex-1 px-3 py-2'>
          <div
            className='text-muted-foreground line-clamp-2 text-xs leading-5'
            title={formatted}
          >
            {formatted || t('No motion prompt yet, click "Generate Prompt"')}
          </div>
        </div>
        <div className='flex gap-2 border-t px-3 py-2.5'>
          <Button
            size='sm'
            variant='outline'
            className='min-w-0 flex-1'
            disabled={promptGenId === s.id}
            onClick={() => {
              setPromptGenId(s.id)
              promptMutation.mutate(s.id)
            }}
          >
            {promptLabel}
          </Button>
          <Button
            size='sm'
            variant={s.videoUrl ? 'outline' : 'default'}
            className='min-w-0 flex-1'
            disabled={!s.firstFrameImage || generating || submittingId === s.id}
            onClick={() => openDialog(s)}
          >
            {generateLabel}
          </Button>
        </div>
      </div>
    )
  }

  let listContent: React.ReactNode
  if (listQuery.isPending) {
    listContent = (
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
        {['s1', 's2', 's3'].map((key) => (
          <Skeleton key={key} className='h-72 w-full rounded-xl' />
        ))}
      </div>
    )
  } else if (storyboards.length === 0) {
    listContent = (
      <Empty>
        <EmptyMedia>
          <Clapperboard aria-hidden='true' />
        </EmptyMedia>
        <EmptyTitle>{t('No shots yet')}</EmptyTitle>
        <EmptyDescription>
          {t('Please finish AI split in the "Storyboard Split" step first')}
        </EmptyDescription>
      </Empty>
    )
  } else {
    listContent = (
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
        {storyboards.map(renderCard)}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3.5'>
      {/* 顶部：标题 + 操作 */}
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div>
          <div className='text-base font-semibold'>{t('Video Generation')}</div>
          <div className='text-muted-foreground mt-1 text-[13px]'>
            {t(
              'Reference generation (default): shot image and @ references as references; first & last frame: last frame anchors the next shot for smoother transitions (takes longer, auto-polls after submit)'
            )}
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={promptPendingList.length === 0 || batchPrompting}
            onClick={() => void generateAllPrompts()}
          >
            {batchPrompting
              ? t('Generating...')
              : t('Batch Generate Prompts ({{count}})', {
                  count: promptPendingList.length,
                })}
          </Button>
          <Button
            size='sm'
            disabled={pendingList.length === 0 || batchSubmitting}
            onClick={() => void generateAll()}
          >
            {batchSubmitting
              ? t('Submitting...')
              : t('Batch Generate ({{count}})', { count: pendingList.length })}
          </Button>
        </div>
      </div>

      {listContent}

      {/* 生成参数弹窗：视频运动 prompt 可编辑，画幅/分辨率/时长/数量可选 */}
      <Dialog
        open={genDialog != null}
        onOpenChange={(open) => {
          if (!open) setGenDialog(null)
        }}
      >
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>
              {t('Generate Shot Video: #{{number}}', {
                number: genDialog?.storyboardNumber,
              })}
            </DialogTitle>
          </DialogHeader>
          {genDialog && (
            <div className='grid gap-4 py-1'>
              {/* 生成模式 */}
              <div className='grid gap-2'>
                <Label>{t('Generation Mode')}</Label>
                <div className='grid grid-cols-1 gap-2.5 sm:grid-cols-2'>
                  <button
                    type='button'
                    onClick={() =>
                      setGenDialog((d) =>
                        d ? { ...d, frameMode: 'reference' } : d
                      )
                    }
                    className={cn(
                      'flex gap-2.5 rounded-[10px] border p-3 text-left transition-all hover:-translate-y-px hover:border-primary/60',
                      genDialog.frameMode === 'reference' &&
                        'border-primary bg-primary/10 shadow-[inset_0_0_0_1px_var(--primary)]'
                    )}
                  >
                    <ImageIcon
                      aria-hidden='true'
                      className={cn(
                        'text-muted-foreground mt-0.5 size-5 shrink-0',
                        genDialog.frameMode === 'reference' && 'text-primary'
                      )}
                    />
                    <div className='min-w-0'>
                      <div className='text-[13px] font-semibold'>
                        {t('Reference Generation')}
                        <span className='bg-primary/10 text-primary ml-1.5 rounded-sm border border-primary/30 px-1.5 py-0 text-[10px] font-medium'>
                          {t('Default')}
                        </span>
                      </div>
                      <div className='text-muted-foreground mt-0.5 text-xs leading-5'>
                        {t(
                          'Shot image and @ referenced assets are used as reference images; freer framing, start frame not strictly locked'
                        )}
                      </div>
                    </div>
                  </button>
                  <button
                    type='button'
                    onClick={() => {
                      // 首尾帧模式上游强制画幅跟随首帧（adaptive），切到该模式即锁定智能比例
                      setAspectRatio('adaptive')
                      setGenDialog((d) =>
                        d ? { ...d, frameMode: 'first_last' } : d
                      )
                    }}
                    className={cn(
                      'flex gap-2.5 rounded-[10px] border p-3 text-left transition-all hover:-translate-y-px hover:border-primary/60',
                      genDialog.frameMode === 'first_last' &&
                        'border-primary bg-primary/10 shadow-[inset_0_0_0_1px_var(--primary)]'
                    )}
                  >
                    <Film
                      aria-hidden='true'
                      className={cn(
                        'text-muted-foreground mt-0.5 size-5 shrink-0',
                        genDialog.frameMode === 'first_last' && 'text-primary'
                      )}
                    />
                    <div className='min-w-0'>
                      <div className='text-[13px] font-semibold'>
                        {t('First & Last Frame')}
                      </div>
                      <div className='text-muted-foreground mt-0.5 text-xs leading-5'>
                        {t(
                          'Last frame anchors the next shot image for smoother transitions; aspect ratio follows the frames'
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* 帧输入：胶片流 */}
              <div className='grid gap-2'>
                <Label>{t('Frame Input')}</Label>
                <div className='w-full'>
                  <div
                    className='relative rounded-[10px] px-[18px] pt-[17px] pb-[13px]'
                    style={{
                      background:
                        'linear-gradient(180deg, #26262d 0%, #1b1b21 100%)',
                      boxShadow:
                        'inset 0 0 0 1px rgba(255,255,255,0.06), 0 4px 14px rgba(0,0,0,0.18)',
                    }}
                  >
                    <div
                      aria-hidden='true'
                      className='absolute top-[6px] right-[13px] left-[13px] h-[6px]'
                      style={FILM_HOLE_STYLE}
                    />
                    <div
                      aria-hidden='true'
                      className='absolute right-[13px] bottom-[6px] left-[13px] h-[6px]'
                      style={FILM_HOLE_STYLE}
                    />
                    <div className='flex items-center gap-3.5'>
                      {/* 当前镜头帧 */}
                      <div className='shrink-0'>
                        <img
                          src={genDialog.firstFrameImage}
                          alt=''
                          className='h-[138px] w-24 rounded-md border-2 border-white/85 bg-[#0d0d10] object-contain shadow-[0_3px_10px_rgba(0,0,0,0.45)]'
                        />
                        <div className='mt-1.5 text-center text-[11px] whitespace-nowrap text-white/70'>
                          <span className='mr-1 rounded-sm bg-white/15 px-1.5 py-0 text-white/90'>
                            {genDialog.frameMode === 'reference'
                              ? t('Reference')
                              : t('First Frame')}
                          </span>
                          {t('Current Shot')}
                        </div>
                      </div>

                      {genDialog.frameMode === 'first_last' ? (
                        <>
                          {/* 首尾帧连接：虚线 + 运动节点 */}
                          <div className='flex min-w-14 flex-1 items-center gap-1.5 pb-5'>
                            <i className='border-primary h-0 flex-1 border-t-2 border-dashed opacity-75' />
                            <span className='bg-primary rounded-full p-1.5 text-white shadow-[0_2px_8px_rgba(0,0,0,0.4),0_0_0_4px_rgba(255,255,255,0.08)]'>
                              <Play aria-hidden='true' className='size-3.5' />
                            </span>
                            <i className='border-primary h-0 flex-1 border-t-2 border-dashed opacity-75' />
                          </div>
                          {/* 尾帧 */}
                          <div className='shrink-0'>
                            {lastFrameImage ? (
                              <img
                                src={lastFrameImage}
                                alt=''
                                className='h-[138px] w-24 rounded-md border-2 border-white/85 bg-[#0d0d10] object-contain shadow-[0_3px_10px_rgba(0,0,0,0.45)]'
                              />
                            ) : (
                              <div className='flex h-[138px] w-24 flex-col items-center justify-center gap-1 rounded-md border-[1.5px] border-dashed border-white/35 p-2 text-center text-[11px] text-white/70'>
                                <AlertTriangle
                                  aria-hidden='true'
                                  className='size-5 text-amber-400'
                                />
                                <span>
                                  {nextShot
                                    ? t('Shot #{{number}} has no image', {
                                        number: nextShot.storyboardNumber,
                                      })
                                    : t('This is the last shot')}
                                </span>
                                <span className='text-[10px] opacity-70'>
                                  {t('Generate with first frame only')}
                                </span>
                              </div>
                            )}
                            <div className='mt-1.5 text-center text-[11px] whitespace-nowrap text-white/70'>
                              <span className='mr-1 rounded-sm bg-white/15 px-1.5 py-0 text-white/90'>
                                {t('Last Frame')}
                              </span>
                              {lastFrameImage && nextShot
                                ? t('Shot #{{number}}', {
                                    number: nextShot.storyboardNumber,
                                  })
                                : t('Unavailable')}
                            </div>
                          </div>
                        </>
                      ) : (
                        mentionItems.length > 0 && (
                          /* @ 引用资产：小缩略图徽章组（不占帧位，避免与真实帧混淆） */
                          <div className='shrink-0'>
                            <div className='flex items-center gap-[7px]'>
                              {mentionItems.slice(0, 4).map((m) => (
                                <div
                                  key={`${m.kind}-${m.id}`}
                                  className='relative size-11'
                                  title={m.name}
                                >
                                  <img
                                    src={m.url}
                                    alt=''
                                    className='size-11 rounded-[9px] border-[1.5px] border-white/40 bg-[#0d0d10] object-cover shadow-[0_2px_6px_rgba(0,0,0,0.4)]'
                                  />
                                  <span className='bg-primary absolute -top-1.5 -left-1.5 flex size-[17px] items-center justify-center rounded-full text-[10px] font-bold text-white shadow ring-2 ring-[#1b1b21]'>
                                    @
                                  </span>
                                </div>
                              ))}
                              {mentionItems.length > 4 && (
                                <div className='flex size-11 items-center justify-center rounded-[9px] bg-white/15 text-xs font-semibold text-white/90'>
                                  +{mentionItems.length - 4}
                                </div>
                              )}
                            </div>
                            <div className='mt-2 text-center text-[11px] whitespace-nowrap text-white/70'>
                              <span className='mr-1 rounded-sm bg-white/15 px-1.5 py-0 text-white/90'>
                                {t('Reference')}
                              </span>
                              {t('@ references ×{{count}}', {
                                count: mentionItems.length,
                              })}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                  {genDialog.frameMode === 'first_last' && hasMentions && (
                    <div className='mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-[7px] text-xs leading-5 text-amber-600 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400'>
                      {t(
                        'First & last frame mode does not support @ image references; they will be ignored on submit. Switch to "Reference Generation" to keep them'
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 运动 prompt */}
              <div className='grid gap-2'>
                <Label>{t('Motion Prompt')}</Label>
                <MentionEditor
                  value={genDialog.prompt}
                  onChange={(v) =>
                    setGenDialog((d) => (d ? { ...d, prompt: v } : d))
                  }
                  assets={mentionAssets}
                  rows={5}
                  placeholder={t(
                    'Describe camera motion: character movement, expression changes, camera movement and speed; type @ to reference character/scene/shot images and videos for consistency'
                  )}
                />
              </div>

              {/* 视频比例 */}
              <div className='grid gap-2'>
                <Label>{t('Aspect Ratio')}</Label>
                <div>
                  <ToggleGroup
                    variant='outline'
                    size='sm'
                    spacing={2}
                    value={[aspectRatio]}
                    disabled={genDialog.frameMode === 'first_last'}
                    onValueChange={(v) => {
                      const next = v.find((x) => x !== aspectRatio)
                      if (next) setAspectRatio(next)
                    }}
                  >
                    {RATIO_OPTIONS.map((r) => (
                      <ToggleGroupItem key={r} value={r}>
                        {r === 'adaptive' ? t('Smart Ratio') : r}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                {genDialog.frameMode === 'first_last' && (
                  <p className='text-muted-foreground text-xs'>
                    {t('Output ratio follows the first frame image')}
                  </p>
                )}
              </div>

              {/* 分辨率 */}
              <div className='grid gap-2'>
                <Label>{t('Resolution')}</Label>
                <div>
                  <ToggleGroup
                    variant='outline'
                    size='sm'
                    spacing={2}
                    value={[resolution]}
                    onValueChange={(v) => {
                      const next = v.find((x) => x !== resolution)
                      if (next) setResolution(next)
                    }}
                  >
                    {RESOLUTION_OPTIONS.map((r) => (
                      <ToggleGroupItem key={r} value={r}>
                        {r}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </div>

              {/* 视频时长 */}
              <div className='grid gap-2'>
                <Label>{t('Video Duration')}</Label>
                <div className='flex items-center gap-3'>
                  <Slider
                    className='flex-1'
                    min={4}
                    max={15}
                    step={1}
                    value={[genDialog.duration]}
                    onValueChange={(v) =>
                      setGenDialog((d) =>
                        d ? { ...d, duration: sliderNumber(v) } : d
                      )
                    }
                  />
                  <span className='text-muted-foreground w-10 text-[13px]'>
                    {genDialog.duration}s
                  </span>
                </div>
              </div>

              {/* 生成数量 */}
              <div className='grid gap-2'>
                <Label>{t('Generation Count')}</Label>
                <div>
                  <ToggleGroup
                    variant='outline'
                    size='sm'
                    spacing={2}
                    value={[String(count)]}
                    onValueChange={(v) => {
                      const next = v.find((x) => x !== String(count))
                      if (next) setCount(Number(next))
                    }}
                  >
                    {COUNT_OPTIONS.map((n) => (
                      <ToggleGroupItem key={n} value={String(n)}>
                        {n}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant='outline' onClick={() => setGenDialog(null)}>
              {t('Cancel')}
            </Button>
            <Button disabled={submittingId !== 0} onClick={submitOne}>
              {submittingId !== 0 ? t('Submitting...') : t('Start Generation')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 首尾帧 + @ 引用冲突确认 */}
      <AlertDialog
        open={mentionConfirmOpen}
        onOpenChange={setMentionConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Notice')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'First & last frame mode does not support @ image references; submitting now will ignore them. To keep @ references, cancel and switch to "Reference Generation" mode.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setMentionConfirmOpen(false)
                doSubmit()
              }}
            >
              {t('Ignore @ and submit')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
