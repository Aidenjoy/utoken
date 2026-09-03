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
  Clapperboard,
  Image as ImageIcon,
  Loader2,
  Plus,
  Upload,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { ZoomableImage } from '@/components/zoomable-image'
import { handleServerError } from '@/lib/handle-server-error'

import {
  createDirectorStoryboard,
  generateStoryboardImage,
  generateStoryboardPrompt,
  getDirectorEntityAssets,
  getDirectorImageGenerations,
  getDirectorStoryboards,
  updateDirectorStoryboard,
  uploadDirectorFile,
} from '../api'
import { EntityAssetRow } from '../components/entity-asset-row'
import { MentionEditor } from '../components/mention-editor'
import {
  formatMentions,
  MENTION_KIND_LABEL,
  type MentionAsset,
} from '../components/mention-utils'
import { useMentionAssets } from '../hooks/use-mention-assets'
import { useStoryboardGenTracker } from '../hooks/use-storyboard-gen-tracker'
import type { DirectorEpisode, DirectorStoryboard } from '../types'

const SHOT_TYPE_OPTIONS = [
  'Long Shot',
  'Full Shot',
  'Medium Shot',
  'Close-Up',
  'Extreme Close-Up',
]

interface ShotsStepProps {
  episode: DirectorEpisode
  onSaved: () => void
}

export function ShotsStep(props: ShotsStepProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const queryKey = ['director', 'storyboards', props.episode.id]

  const listQuery = useQuery({
    queryKey,
    queryFn: () =>
      getDirectorStoryboards({ episodeId: props.episode.id, page_size: 200 }),
  })
  const storyboards = listQuery.data?.data?.list ?? []

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

  // ---------- 生成中状态跟踪（刷新/切页后可恢复） ----------

  const tracker = useStoryboardGenTracker({
    kind: 'image',
    projectId: props.episode.projectId,
    onChange: refresh,
  })
  const isGenerating = (id: number) => tracker.generatingIds.has(id)

  // 镜头图片的 asset_id 映射（仅当前视频模型）；pending 素材 3s 轮询直到激活
  const assetQueryKey = ['director', 'entity-assets', 'storyboard']
  const assetQuery = useQuery({
    queryKey: assetQueryKey,
    queryFn: () => getDirectorEntityAssets('storyboard'),
    refetchInterval: (query) =>
      (query.state.data?.data ?? []).some((a) => a.status === 'pending')
        ? 3000
        : false,
  })
  const assetByStoryboard = new Map(
    (assetQuery.data?.data ?? []).map((a) => [a.entityId, a])
  )
  const invalidateAssets = () =>
    queryClient.invalidateQueries({ queryKey: assetQueryKey })

  // 首次进入：把仍在 processing 的本分集任务重新纳入跟踪
  const restoredRef = React.useRef(false)
  React.useEffect(() => {
    if (restoredRef.current || storyboards.length === 0) return
    restoredRef.current = true
    const local = new Set(storyboards.map((s) => s.id))
    void getDirectorImageGenerations({
      projectId: props.episode.projectId,
      status: 'processing',
      page_size: 100,
    })
      .then((res) => {
        const ids = (res.data?.list ?? [])
          .map((task) => task.storyboardId)
          .filter((id): id is number => Boolean(id && local.has(id)))
        if (ids.length) tracker.adoptGenerating(ids)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyboards.length > 0])

  const pendingList = storyboards.filter(
    (s) => !s.firstFrameImage && s.imagePrompt && !isGenerating(s.id)
  )

  // ---------- 单个生成 ----------

  const [promptGenId, setPromptGenId] = React.useState(0)
  const promptMutation = useMutation({
    mutationFn: (id: number) => generateStoryboardPrompt(id),
    onSuccess: (res, id) => {
      if (res.success) {
        const num = storyboards.find((s) => s.id === id)?.storyboardNumber
        toast.success(t('Prompt generated for shot #{{number}}', { number: num }))
        refresh()
      }
    },
    onError: handleServerError,
    onSettled: () => setPromptGenId(0),
  })

  const [submittingId, setSubmittingId] = React.useState(0)
  const imageMutation = useMutation({
    mutationFn: (params: { id: number; prompt?: string }) =>
      generateStoryboardImage(params),
    onSuccess: (res, params) => {
      if (res.success) {
        tracker.markGenerating(params.id)
        setGenDialog(null)
        refresh()
      }
    },
    onError: handleServerError,
    onSettled: () => setSubmittingId(0),
  })

  // 本机图片上传首帧：先传到素材库拿到 URL，再整体回写分镜（PUT 为全字段覆盖；
  // characters 关联由后端单独维护，必须剔除，否则空数组会清空出镜角色）
  const uploadInputRef = React.useRef<HTMLInputElement>(null)
  const [uploadTarget, setUploadTarget] =
    React.useState<DirectorStoryboard | null>(null)
  const uploadMutation = useMutation({
    mutationFn: async (params: { sb: DirectorStoryboard; file: File }) => {
      const up = await uploadDirectorFile({
        file: params.file,
        projectId: props.episode.projectId,
      })
      if (!up.success || !up.data?.url) return up
      const rest = { ...params.sb }
      delete rest.characters
      return updateDirectorStoryboard({
        ...rest,
        firstFrameImage: up.data.url,
        status: 'imaged',
      })
    },
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Uploaded'))
        refresh()
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    },
    onError: handleServerError,
  })

  // ---------- 批量生成 ----------

  const [batchSubmitting, setBatchSubmitting] = React.useState(false)
  const generateAll = async () => {
    setBatchSubmitting(true)
    let ok = 0
    try {
      for (const s of pendingList) {
        const res = await generateStoryboardImage({ id: s.id })
        if (res.success) {
          ok++
          tracker.markGenerating(s.id)
        }
      }
      toast.success(
        t('Submitted {{count}} shot image generation tasks', { count: ok })
      )
    } finally {
      setBatchSubmitting(false)
    }
  }

  // ---------- 生成参数弹窗 ----------

  const [genDialog, setGenDialog] = React.useState<{
    id: number
    storyboardNumber: number
    prompt: string
  } | null>(null)

  const submitOne = () => {
    if (!genDialog) return
    const prompt = genDialog.prompt.trim()
    if (!prompt) {
      toast.warning(t('Please fill in the image prompt'))
      return
    }
    setSubmittingId(genDialog.id)
    imageMutation.mutate({ id: genDialog.id, prompt })
  }

  // ---------- 手动添加镜头 ----------

  const [addOpen, setAddOpen] = React.useState(false)
  const [addForm, setAddForm] = React.useState({
    storyboardNumber: 1,
    shotType: 'Medium Shot',
    location: '',
    time: '',
    imagePrompt: '',
  })

  const openAdd = () => {
    setAddForm({
      storyboardNumber: storyboards.length + 1,
      shotType: 'Medium Shot',
      location: '',
      time: '',
      imagePrompt: '',
    })
    setAddOpen(true)
  }

  const addMutation = useMutation({
    mutationFn: () =>
      createDirectorStoryboard({
        episodeId: props.episode.id,
        storyboardNumber: addForm.storyboardNumber,
        shotType: addForm.shotType,
        location: addForm.location.trim(),
        time: addForm.time.trim(),
        duration: 5,
        imagePrompt: addForm.imagePrompt.trim(),
      }),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Added'))
        setAddOpen(false)
        refresh()
      }
    },
    onError: handleServerError,
  })

  // ---------- 渲染 ----------

  const renderCard = (s: DirectorStoryboard) => {
    const generating = isGenerating(s.id)
    const formatted = formatMentions(s.imagePrompt, mentionAssets, kindLabel)

    let imageContent: React.ReactNode
    if (generating) {
      imageContent = (
        <div className='from-primary/10 to-muted text-primary flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br text-[13px]'>
          <Loader2 aria-hidden='true' className='size-6.5 animate-spin' />
          <span>{t('Generating shot image...')}</span>
          <span className='text-muted-foreground text-[11px]'>
            {t('Usually takes 30-60 seconds')}
          </span>
          <div className='bg-muted-foreground/20 mt-1 h-1 w-[70%] overflow-hidden rounded-sm'>
            <div className='bg-primary h-full w-2/5 animate-[light-slide_1.4s_ease-in-out_infinite] rounded-sm' />
          </div>
        </div>
      )
    } else if (s.firstFrameImage) {
      imageContent = (
        <ZoomableImage
          src={s.firstFrameImage}
          alt={s.title || `#${s.storyboardNumber}`}
          className='size-full'
        />
      )
    } else {
      imageContent = (
        <div className='text-muted-foreground flex size-full flex-col items-center justify-center gap-1.5 text-xs'>
          <ImageIcon aria-hidden='true' className='size-7' />
          <span>{t('Not generated')}</span>
        </div>
      )
    }

    let promptLabel: string
    if (promptGenId === s.id) promptLabel = t('Generating...')
    else if (s.imagePrompt) promptLabel = t('Regenerate Prompt')
    else promptLabel = t('Generate Prompt')

    let generateLabel: string
    if (generating) generateLabel = t('Generating')
    else if (s.firstFrameImage) generateLabel = t('Regenerate')
    else generateLabel = t('Generate Image')

    return (
      <div
        key={s.id}
        className='bg-card flex flex-col overflow-hidden rounded-xl border transition-shadow hover:shadow-md'
      >
        <div className='bg-muted relative aspect-[9/16] max-h-85 w-full'>
          {imageContent}
          <div className='absolute top-1.5 left-1.5 rounded bg-black/55 px-2 py-0.5 text-xs text-white'>
            #{s.storyboardNumber}
          </div>
        </div>
        <div className='flex-1 space-y-2 px-3 py-2'>
          <div
            className='text-muted-foreground line-clamp-2 text-xs leading-5'
            title={formatted}
          >
            {formatted || t('No prompt yet, click "Generate Prompt"')}
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
            variant={s.firstFrameImage ? 'outline' : 'default'}
            className='min-w-0 flex-1'
            disabled={generating || submittingId === s.id}
            onClick={() =>
              setGenDialog({
                id: s.id,
                storyboardNumber: s.storyboardNumber,
                prompt: (s.imagePrompt || '').trim(),
              })
            }
          >
            {generateLabel}
          </Button>
          <Button
            size='sm'
            variant='outline'
            className='shrink-0 px-2.5'
            disabled={
              generating ||
              (uploadMutation.isPending && uploadTarget?.id === s.id)
            }
            title={t('Upload')}
            aria-label={t('Upload')}
            onClick={() => {
              setUploadTarget(s)
              uploadInputRef.current?.click()
            }}
          >
            {uploadMutation.isPending && uploadTarget?.id === s.id ? (
              <Loader2 aria-hidden='true' className='size-4 animate-spin' />
            ) : (
              <Upload aria-hidden='true' className='size-4' />
            )}
          </Button>
        </div>
        {s.firstFrameImage && (
          <div className='border-t px-3 py-2'>
            <EntityAssetRow
              entityType='storyboard'
              entityId={s.id}
              asset={assetByStoryboard.get(s.id) ?? null}
              onSynced={invalidateAssets}
            />
          </div>
        )}
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
          {t(
            'Click "Add Shot" to add one manually, or run AI split in the "Storyboard Split" step first'
          )}
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
          <div className='text-base font-semibold'>{t('Shot Images')}</div>
          <div className='text-muted-foreground mt-1 text-[13px]'>
            {t(
              'Generate a first-frame image for each storyboard (used as the first frame of image-to-video)'
            )}
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            size='sm'
            disabled={pendingList.length === 0 || batchSubmitting}
            onClick={() => void generateAll()}
          >
            {batchSubmitting
              ? t('Submitting...')
              : t('Batch Generate ({{count}})', { count: pendingList.length })}
          </Button>
          <Button size='sm' variant='outline' onClick={openAdd}>
            <Plus aria-hidden='true' />
            {t('Add Shot')}
          </Button>
        </div>
      </div>

      {listContent}

      {/* 本机上传首帧图的隐藏文件选择器（按卡片记录目标分镜） */}
      <input
        ref={uploadInputRef}
        type='file'
        accept='image/*'
        className='hidden'
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file && uploadTarget) {
            uploadMutation.mutate({ sb: uploadTarget, file })
          }
          e.target.value = ''
        }}
      />

      {/* 生成参数弹窗：图片 prompt 可编辑 */}
      <Dialog
        open={genDialog != null}
        onOpenChange={(open) => {
          if (!open) setGenDialog(null)
        }}
      >
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>
              {t('Generate Shot Image: #{{number}}', {
                number: genDialog?.storyboardNumber,
              })}
            </DialogTitle>
          </DialogHeader>
          <div className='grid gap-2 py-1'>
            <Label>{t('Image Prompt')}</Label>
            {genDialog && (
              <MentionEditor
                value={genDialog.prompt}
                onChange={(v) =>
                  setGenDialog((d) => (d ? { ...d, prompt: v } : d))
                }
                assets={mentionAssets}
                rows={6}
                placeholder={t(
                  'Describe the scene: characters, actions, environment, lighting; type @ to reference character/prop/scene images for consistency'
                )}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setGenDialog(null)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={submittingId !== 0}
              onClick={submitOne}
            >
              {submittingId !== 0 ? t('Submitting...') : t('Start Generation')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 手动添加镜头弹窗（即创建分镜，字段与「分镜拆解」一致） */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{t('Add Shot')}</DialogTitle>
          </DialogHeader>
          <div className='grid grid-cols-2 gap-4 py-1 sm:grid-cols-4'>
            <div className='grid gap-2'>
              <Label>{t('Shot No')}</Label>
              <Input
                type='number'
                min={1}
                value={addForm.storyboardNumber}
                onChange={(e) =>
                  setAddForm((f) => ({
                    ...f,
                    storyboardNumber: Number(e.target.value) || 1,
                  }))
                }
              />
            </div>
            <div className='grid gap-2'>
              <Label>{t('Shot Type')}</Label>
              <NativeSelect
                value={addForm.shotType}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, shotType: e.target.value }))
                }
              >
                {SHOT_TYPE_OPTIONS.map((opt) => (
                  <NativeSelectOption key={opt} value={opt}>
                    {t(opt)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className='grid gap-2'>
              <Label>{t('Location')}</Label>
              <Input
                value={addForm.location}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, location: e.target.value }))
                }
              />
            </div>
            <div className='grid gap-2'>
              <Label>{t('Time')}</Label>
              <Input
                value={addForm.time}
                placeholder={t('Day/Night/Dusk')}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, time: e.target.value }))
                }
              />
            </div>
            <div className='col-span-2 grid gap-2 sm:col-span-4'>
              <Label>{t('Image Prompt')}</Label>
              {addOpen && (
                <MentionEditor
                  value={addForm.imagePrompt}
                  onChange={(v) => setAddForm((f) => ({ ...f, imagePrompt: v }))}
                  assets={mentionAssets}
                  rows={3}
                  placeholder={t(
                    'Optional; leave empty to generate with AI later; type @ to reference images'
                  )}
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setAddOpen(false)}>
              {t('Cancel')}
            </Button>
            <Button
              disabled={addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending ? t('Saving...') : t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
