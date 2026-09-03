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
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  Users,
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
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ZoomableImage } from '@/components/zoomable-image'
import { handleServerError } from '@/lib/handle-server-error'

import {
  createDirectorEntity,
  deleteDirectorEntity,
  generateDirectorEntityImage,
  generateDirectorEntityPrompt,
  getDirectorEntities,
  getDirectorEntityAssets,
  getDirectorImageGenerations,
  updateDirectorEntity,
  uploadDirectorFile,
  type DirectorEntityType,
} from '../api'
import { EntityAssetRow } from '../components/entity-asset-row'
import {
  generationFinished,
  useImageGenerationPoll,
} from '../hooks/use-generation-polling'
import type {
  DirectorCharacter,
  DirectorEntityAsset,
  DirectorImageGeneration,
  DirectorProp,
  DirectorScene,
} from '../types'

type EntityItem = DirectorCharacter | DirectorScene | DirectorProp

export type { EntityItem }

// 各实体类型的表单字段配置
const ENTITY_FIELDS: Record<
  DirectorEntityType,
  { key: string; label: string; textarea?: boolean }[]
> = {
  character: [
    { key: 'name', label: 'Name' },
    { key: 'role', label: 'Role' },
    { key: 'prompt', label: 'Prompt', textarea: true },
  ],
  scene: [
    { key: 'location', label: 'Location' },
    { key: 'time', label: 'Time of Day' },
    { key: 'prompt', label: 'Scene Prompt', textarea: true },
  ],
  prop: [
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'prompt', label: 'Prompt', textarea: true },
  ],
}

const ENTITY_TITLE: Record<DirectorEntityType, string> = {
  character: 'Characters',
  scene: 'Scenes',
  prop: 'Props',
}

// 页头标题与描述（标题键与流水线步骤名一致）
const ENTITY_HEADER: Record<DirectorEntityType, { title: string; desc: string }> =
  {
    character: {
      title: 'Character Images',
      desc: 'Generate multi-angle character reference images as consistency references for storyboards and videos',
    },
    prop: {
      title: 'Prop Images',
      desc: 'Generate prop images from prompts as consistency references for storyboard images',
    },
    scene: {
      title: 'Scene Images',
      desc: 'Generate scene images from prompts as background references for storyboard images',
    },
  }

// 生成任务记录中与本实体类型对应的外键字段
function entityIdOf(
  type: DirectorEntityType,
  task: DirectorImageGeneration
): number | null | undefined {
  if (type === 'character') return task.characterId
  if (type === 'scene') return task.sceneId
  return task.propId
}

// 「生成中」任务 ID 持久化：切步骤/刷新后同步恢复，避免用户重复提交异步任务。
// 任务完成后由卡片轮询确认并清出缓存，缓存可自愈，不会长期残留。
function readGenIdCache(storageKey: string): Record<number, number> {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed)) {
      return {}
    }
    return parsed as Record<number, number>
  } catch {
    return {}
  }
}

function writeGenIdCache(storageKey: string, value: Record<number, number>) {
  try {
    if (Object.keys(value).length === 0) {
      localStorage.removeItem(storageKey)
    } else {
      localStorage.setItem(storageKey, JSON.stringify(value))
    }
  } catch {
    // 存储不可用（隐私模式等）时退化为仅内存跟踪
  }
}

function entityName(type: DirectorEntityType, item: EntityItem): string {
  if (type === 'scene') return (item as DirectorScene).location
  return (item as DirectorCharacter | DirectorProp).name
}

function entityDescription(type: DirectorEntityType, item: EntityItem): string {
  if (type === 'scene') {
    const scene = item as DirectorScene
    return [scene.time, scene.prompt].filter(Boolean).join(' · ')
  }
  if (type === 'character') {
    const ch = item as DirectorCharacter
    return [ch.role, ch.prompt].filter(Boolean).join(' · ')
  }
  const prop = item as DirectorProp
  return [prop.type, prop.prompt].filter(Boolean).join(' · ')
}

interface EntityStepProps {
  type: DirectorEntityType
  projectId: number
}

export function EntityStep(props: EntityStepProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const queryKey = ['director', props.type, props.projectId]

  const listQuery = useQuery({
    queryKey,
    queryFn: () =>
      getDirectorEntities<EntityItem>(props.type, {
        projectId: props.projectId,
        page_size: 200,
      }),
  })

  const items = listQuery.data?.data?.list ?? []

  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  // 实体图片的 asset_id 映射（仅当前视频模型）；pending 素材 3s 轮询直到激活
  const assetQueryKey = ['director', 'entity-assets', props.type]
  const assetQuery = useQuery({
    queryKey: assetQueryKey,
    queryFn: () => getDirectorEntityAssets(props.type),
    refetchInterval: (query) =>
      (query.state.data?.data ?? []).some((a) => a.status === 'pending')
        ? 3000
        : false,
  })
  const assetByEntity = new Map(
    (assetQuery.data?.data ?? []).map((a) => [a.entityId, a])
  )
  const invalidateAssets = () =>
    queryClient.invalidateQueries({ queryKey: assetQueryKey })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDirectorEntity(props.type, id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Deleted successfully'))
        invalidate()
      }
    },
    onError: handleServerError,
  })

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingItem, setEditingItem] = React.useState<EntityItem | null>(null)

  // ---------- 批量生成 ----------

  // 各实体的生成任务 ID（提升到步骤层，批量提交后卡片可持续轮询）。
  // 初始值从 localStorage 同步恢复，切换步骤/刷新后「生成中」标识不丢失
  const storageKey = `director-image-gen:${props.type}:${props.projectId}`
  const [genIds, setGenIdsState] = React.useState<Record<number, number>>(() =>
    readGenIdCache(storageKey)
  )
  const setGenIds = React.useCallback(
    (updater: React.SetStateAction<Record<number, number>>) => {
      setGenIdsState((m) => {
        const next = typeof updater === 'function' ? updater(m) : updater
        writeGenIdCache(storageKey, next)
        return next
      })
    },
    [storageKey]
  )

  // 首次进入：把仍在 processing 的本项目任务重新纳入跟踪，
  // 切页/刷新回来后卡片继续显示「生成中」，避免用户重复提交异步任务
  const restoredRef = React.useRef(false)
  React.useEffect(() => {
    if (restoredRef.current || items.length === 0) return
    restoredRef.current = true
    const local = new Set(items.map((item) => item.id))
    void getDirectorImageGenerations({
      projectId: props.projectId,
      status: 'processing',
      page_size: 100,
    })
      .then((res) => {
        // 列表按 id DESC 返回，同一实体有多个任务时取最新的一条
        const restored: Record<number, number> = {}
        for (const task of res.data?.list ?? []) {
          const entityId = entityIdOf(props.type, task)
          if (entityId && local.has(entityId) && restored[entityId] == null) {
            restored[entityId] = task.id
          }
        }
        if (Object.keys(restored).length > 0) {
          // 本次会话内新提交的任务优先
          setGenIds((m) => ({ ...restored, ...m }))
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length > 0])

  const pendingList = items.filter((item) => {
    const it = item as DirectorCharacter
    return !it.imageUrl && Boolean(it.prompt) && genIds[item.id] == null
  })

  const [batchSubmitting, setBatchSubmitting] = React.useState(false)
  const generateAll = async () => {
    setBatchSubmitting(true)
    let ok = 0
    try {
      for (const item of pendingList) {
        const res = await generateDirectorEntityImage(props.type, {
          id: item.id,
        })
        const generationId = res.success ? res.data?.generationId : undefined
        if (generationId != null) {
          ok++
          setGenIds((m) => ({ ...m, [item.id]: generationId }))
        }
      }
      toast.success(
        t('Submitted {{count}} image generation tasks', { count: ok })
      )
    } finally {
      setBatchSubmitting(false)
    }
  }

  const renderList = () => {
    if (listQuery.isPending) {
      return (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
          {['s1', 's2', 's3'].map((key) => (
            <Skeleton key={key} className='h-72 w-full rounded-xl' />
          ))}
        </div>
      )
    }
    if (items.length === 0) {
      return (
        <Empty>
          <EmptyMedia>
            <Users aria-hidden='true' />
          </EmptyMedia>
          <EmptyTitle>{t('No entries yet')}</EmptyTitle>
          <EmptyDescription>
            {t('Use AI extraction from the script, or add one manually.')}
          </EmptyDescription>
        </Empty>
      )
    }
    return (
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
        {items.map((item) => (
          <EntityCard
            key={item.id}
            type={props.type}
            projectId={props.projectId}
            item={item}
            genId={genIds[item.id] ?? null}
            asset={assetByEntity.get(item.id) ?? null}
            onAssetSynced={invalidateAssets}
            onGenIdChange={(id) =>
              setGenIds((m) => {
                const next = { ...m }
                if (id == null) delete next[item.id]
                else next[item.id] = id
                return next
              })
            }
            onEdit={() => {
              setEditingItem(item)
              setDialogOpen(true)
            }}
            onDelete={() => deleteMutation.mutate(item.id)}
            onChanged={invalidate}
          />
        ))}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3.5'>
      {/* 顶部：标题 + 操作 */}
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div>
          <div className='text-base font-semibold'>
            {t(ENTITY_HEADER[props.type].title)}
          </div>
          <div className='text-muted-foreground mt-1 text-[13px]'>
            {t(ENTITY_HEADER[props.type].desc)}
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
          <Button
            variant='outline'
            size='sm'
            onClick={() => {
              setEditingItem(null)
              setDialogOpen(true)
            }}
          >
            <Plus aria-hidden='true' />
            {t('Add')}
          </Button>
        </div>
      </div>
      {renderList()}

      <EntityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        type={props.type}
        projectId={props.projectId}
        item={editingItem}
        onSaved={invalidate}
      />
    </div>
  )
}

// ----------------------------------------------------------------------------
// 实体卡片：形象图 + 提示词生成 + 形象图生成（轮询）
// ----------------------------------------------------------------------------

interface EntityCardProps {
  type: DirectorEntityType
  projectId: number
  item: EntityItem
  genId: number | null
  asset: DirectorEntityAsset | null
  onAssetSynced: () => void
  onGenIdChange: (id: number | null) => void
  onEdit: () => void
  onDelete: () => void
  onChanged: () => void
}

function EntityCard(props: EntityCardProps) {
  const { t } = useTranslation()
  const { item, type } = props
  const imageUrl = (item as DirectorCharacter).imageUrl ?? ''

  const genQuery = useImageGenerationPoll(props.genId)
  const gen = genQuery.data?.data ?? null

  // 生成完成后刷新实体列表（后端已把图片回写到实体）
  React.useEffect(() => {
    if (gen && generationFinished(gen)) {
      if (gen.status === 'failed') {
        toast.error(gen.errorMsg || t('Image generation failed'))
      }
      props.onGenIdChange(null)
      props.onChanged()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen?.status])

  const promptMutation = useMutation({
    mutationFn: () => generateDirectorEntityPrompt(type, item.id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Prompt generated'))
        props.onChanged()
      }
    },
    onError: handleServerError,
  })

  const imageMutation = useMutation({
    mutationFn: () => generateDirectorEntityImage(type, { id: item.id }),
    onSuccess: (res) => {
      if (res.success && res.data) {
        props.onGenIdChange(res.data.generationId)
        toast.success(t('Image generation started'))
      }
    },
    onError: handleServerError,
  })

  // 本机图片上传：先传到素材库拿到 URL，再整体回写实体（PUT 为全字段覆盖）。
  // 上传后 status 与 AI 生成完成时一致（imaged），source 标记为 upload
  const uploadInputRef = React.useRef<HTMLInputElement>(null)
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const up = await uploadDirectorFile({
        file,
        projectId: props.projectId,
      })
      if (!up.success || !up.data?.url) return up
      const payload: Record<string, unknown> = {
        ...item,
        imageUrl: up.data.url,
        source: 'upload',
      }
      if (type !== 'character') payload.status = 'imaged'
      return updateDirectorEntity(type, payload)
    },
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Uploaded'))
        props.onChanged()
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    },
    onError: handleServerError,
  })

  const running =
    imageMutation.isPending || (gen != null && !generationFinished(gen))

  // 图片区与镜头图片卡片一致：生成中光条占位 → 成图 → 未生成占位
  let imageContent: React.ReactNode
  if (running) {
    imageContent = (
      <div className='from-primary/10 to-muted text-primary flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br text-[13px]'>
        <Loader2 aria-hidden='true' className='size-6.5 animate-spin' />
        <span>{t('Generating')}</span>
        <span className='text-muted-foreground text-[11px]'>
          {t('Usually takes 30-60 seconds')}
        </span>
        <div className='bg-muted-foreground/20 mt-1 h-1 w-[70%] overflow-hidden rounded-sm'>
          <div className='bg-primary h-full w-2/5 animate-[light-slide_1.4s_ease-in-out_infinite] rounded-sm' />
        </div>
      </div>
    )
  } else if (imageUrl) {
    imageContent = (
      <ZoomableImage
        src={imageUrl}
        alt={entityName(type, item)}
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
  if (promptMutation.isPending) promptLabel = t('Generating...')
  else if ((item as DirectorCharacter).prompt) promptLabel = t('Regenerate Prompt')
  else promptLabel = t('Generate Prompt')

  let imageLabel: string
  if (running) imageLabel = t('Generating')
  else if (imageUrl) imageLabel = t('Regenerate')
  else imageLabel = t('Generate Image')

  return (
    <div className='bg-card flex flex-col overflow-hidden rounded-xl border transition-shadow hover:shadow-md'>
      <div className='bg-muted relative aspect-[9/16] max-h-85 w-full'>
        {imageContent}
      </div>
      <div className='flex-1 space-y-2 px-3 py-2'>
        <div className='flex items-center justify-between gap-2'>
          <span className='truncate text-sm font-medium'>
            {entityName(type, item)}
          </span>
          <span className='flex shrink-0 gap-1'>
            <Button
              variant='ghost'
              size='icon'
              className='size-6'
              aria-label={t('Edit')}
              onClick={props.onEdit}
            >
              <Pencil aria-hidden='true' className='size-3.5' />
            </Button>
            <Button
              variant='ghost'
              size='icon'
              className='text-destructive hover:text-destructive size-6'
              aria-label={t('Delete')}
              onClick={props.onDelete}
            >
              <Trash2 aria-hidden='true' className='size-3.5' />
            </Button>
          </span>
        </div>
        <div
          className='text-muted-foreground line-clamp-2 text-xs leading-5'
          title={entityDescription(type, item)}
        >
          {entityDescription(type, item) ||
            t('No prompt yet, click "Generate Prompt"')}
        </div>
      </div>
      <div className='flex gap-2 border-t px-3 py-2.5'>
        <Button
          size='sm'
          variant='outline'
          className='min-w-0 flex-1'
          disabled={promptMutation.isPending}
          onClick={() => promptMutation.mutate()}
        >
          {promptLabel}
        </Button>
        <Button
          size='sm'
          variant={imageUrl ? 'outline' : 'default'}
          className='min-w-0 flex-1'
          disabled={running}
          onClick={() => imageMutation.mutate()}
        >
          {imageLabel}
        </Button>
        <input
          ref={uploadInputRef}
          type='file'
          accept='image/*'
          className='hidden'
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) uploadMutation.mutate(file)
            e.target.value = ''
          }}
        />
        <Button
          size='sm'
          variant='outline'
          className='shrink-0 px-2.5'
          disabled={running || uploadMutation.isPending}
          title={t('Upload')}
          aria-label={t('Upload')}
          onClick={() => uploadInputRef.current?.click()}
        >
          {uploadMutation.isPending ? (
            <Loader2 aria-hidden='true' className='size-4 animate-spin' />
          ) : (
            <Upload aria-hidden='true' className='size-4' />
          )}
        </Button>
      </div>
      {imageUrl && (
        <div className='border-t px-3 py-2'>
          <EntityAssetRow
            entityType={type}
            entityId={item.id}
            asset={props.asset}
            onSynced={props.onAssetSynced}
          />
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------
// 新增/编辑对话框
// ----------------------------------------------------------------------------

interface EntityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: DirectorEntityType
  projectId: number
  item: EntityItem | null
  onSaved: () => void
}

export function EntityDialog(props: EntityDialogProps) {
  const { t } = useTranslation()
  const fields = ENTITY_FIELDS[props.type]
  const isEdit = Boolean(props.item?.id)

  const [values, setValues] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (!props.open) return
    const next: Record<string, string> = {}
    for (const field of fields) {
      next[field.key] = String(
        (props.item as Record<string, unknown> | null)?.[field.key] ?? ''
      )
    }
    setValues(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.item])

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        ...values,
        projectId: props.projectId,
      }
      if (isEdit && props.item) {
        payload.id = props.item.id
        return updateDirectorEntity(props.type, payload)
      }
      return createDirectorEntity(props.type, payload)
    },
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Saved successfully'))
        props.onOpenChange(false)
        props.onSaved()
      }
    },
    onError: handleServerError,
  })

  const handleSubmit = () => {
    const first = fields[0]
    if (first && !values[first.key]?.trim()) {
      toast.error(t('Name is required'))
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {t(isEdit ? 'Edit' : 'Add')} {t(ENTITY_TITLE[props.type])}
          </DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-2'>
          {fields.map((field) => (
            <div key={field.key} className='grid gap-2'>
              <Label htmlFor={`director-entity-${field.key}`}>
                {t(field.label)}
              </Label>
              {field.textarea ? (
                <Textarea
                  id={`director-entity-${field.key}`}
                  rows={3}
                  value={values[field.key] ?? ''}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                />
              ) : (
                <Input
                  id={`director-entity-${field.key}`}
                  value={values[field.key] ?? ''}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                />
              )}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending}>
            {mutation.isPending ? t('Saving...') : t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
