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
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { handleServerError } from '@/lib/handle-server-error'

import {
  createDirectorEntity,
  deleteDirectorEntity,
  generateDirectorEntityImage,
  generateDirectorEntityPrompt,
  getDirectorEntities,
  updateDirectorEntity,
  type DirectorEntityType,
} from '../api'
import { GEN_STATUS_BADGE_VARIANT, GEN_STATUS_LABEL } from '../constants'
import {
  generationFinished,
  useImageGenerationPoll,
} from '../hooks/use-generation-polling'
import type { DirectorCharacter, DirectorProp, DirectorScene } from '../types'

type EntityItem = DirectorCharacter | DirectorScene | DirectorProp

// 各实体类型的表单字段配置
const ENTITY_FIELDS: Record<
  DirectorEntityType,
  { key: string; label: string; textarea?: boolean }[]
> = {
  character: [
    { key: 'name', label: 'Name' },
    { key: 'role', label: 'Role' },
    { key: 'description', label: 'Description', textarea: true },
    { key: 'appearance', label: 'Appearance', textarea: true },
    { key: 'personality', label: 'Personality', textarea: true },
  ],
  scene: [
    { key: 'location', label: 'Location' },
    { key: 'time', label: 'Time of Day' },
    { key: 'prompt', label: 'Scene Prompt', textarea: true },
  ],
  prop: [
    { key: 'name', label: 'Name' },
    { key: 'type', label: 'Type' },
    { key: 'description', label: 'Description', textarea: true },
  ],
}

const ENTITY_TITLE: Record<DirectorEntityType, string> = {
  character: 'Characters',
  scene: 'Scenes',
  prop: 'Props',
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
    return [ch.role, ch.appearance || ch.description]
      .filter(Boolean)
      .join(' · ')
  }
  const prop = item as DirectorProp
  return [prop.type, prop.description].filter(Boolean).join(' · ')
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

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDirectorEntity(props.type, id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Deleted'))
        invalidate()
      }
    },
    onError: handleServerError,
  })

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingItem, setEditingItem] = React.useState<EntityItem | null>(null)

  const renderList = () => {
    if (listQuery.isPending) {
      return (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {['s1', 's2', 's3'].map((key) => (
            <Skeleton key={key} className='h-64 rounded-xl' />
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
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        {items.map((item) => (
          <EntityCard
            key={item.id}
            type={props.type}
            item={item}
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
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-base font-semibold'>
          {t(ENTITY_TITLE[props.type])}
        </h3>
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
  item: EntityItem
  onEdit: () => void
  onDelete: () => void
  onChanged: () => void
}

function EntityCard(props: EntityCardProps) {
  const { t } = useTranslation()
  const { item, type } = props
  const imageUrl = (item as DirectorCharacter).imageUrl ?? ''

  const [genId, setGenId] = React.useState<number | null>(null)
  const genQuery = useImageGenerationPoll(genId)
  const gen = genQuery.data?.data ?? null

  // 生成完成后刷新实体列表（后端已把图片回写到实体）
  React.useEffect(() => {
    if (gen && generationFinished(gen)) {
      if (gen.status === 'failed') {
        toast.error(gen.errorMsg || t('Image generation failed'))
      }
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
        setGenId(res.data.generationId)
        toast.success(t('Image generation started'))
      }
    },
    onError: handleServerError,
  })

  const running =
    imageMutation.isPending || (gen != null && !generationFinished(gen))

  return (
    <Card className='overflow-hidden'>
      <div className='bg-muted relative aspect-square w-full'>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={entityName(type, item)}
            loading='lazy'
            className='size-full object-cover'
          />
        ) : (
          <div className='text-muted-foreground flex size-full items-center justify-center'>
            <ImageIcon aria-hidden='true' className='size-8' />
          </div>
        )}
        {gen && !generationFinished(gen) && (
          <Badge
            variant={GEN_STATUS_BADGE_VARIANT[gen.status]}
            className='absolute top-2 left-2'
          >
            {t(GEN_STATUS_LABEL[gen.status] ?? gen.status)}
          </Badge>
        )}
      </div>
      <CardHeader className='pb-2'>
        <CardTitle className='flex items-center justify-between gap-2 text-sm'>
          <span className='truncate'>{entityName(type, item)}</span>
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
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-2'>
        <p className='text-muted-foreground line-clamp-2 min-h-8 text-xs'>
          {entityDescription(type, item)}
        </p>
        <div className='flex gap-2'>
          <Button
            size='sm'
            variant='outline'
            className='flex-1'
            disabled={promptMutation.isPending}
            onClick={() => promptMutation.mutate()}
          >
            <Sparkles aria-hidden='true' className='size-3.5' />
            {promptMutation.isPending ? t('Generating...') : t('Prompt')}
          </Button>
          <Button
            size='sm'
            className='flex-1'
            disabled={running}
            onClick={() => imageMutation.mutate()}
          >
            <ImageIcon aria-hidden='true' className='size-3.5' />
            {running ? t('Generating...') : t('Image')}
          </Button>
        </div>
      </CardContent>
    </Card>
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

function EntityDialog(props: EntityDialogProps) {
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
        toast.success(t(isEdit ? 'Updated' : 'Created'))
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
