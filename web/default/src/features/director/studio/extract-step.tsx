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
import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { handleServerError } from '@/lib/handle-server-error'

import {
  deleteDirectorEntity,
  extractDirectorEpisode,
  generateDirectorEntityPrompt,
  generateDirectorEpisodePrompts,
  getDirectorEntities,
  type DirectorEntityType,
} from '../api'
import type {
  DirectorCharacter,
  DirectorEpisode,
  DirectorProp,
  DirectorScene,
} from '../types'
import { EntityDialog, type EntityItem } from './entity-step'

const SECTION_TITLE: Record<DirectorEntityType, string> = {
  character: 'Characters',
  scene: 'Scenes',
  prop: 'Props',
}

function entityName(type: DirectorEntityType, item: EntityItem): string {
  if (type === 'scene') return (item as DirectorScene).location
  return (item as DirectorCharacter | DirectorProp).name
}

function entityMeta(type: DirectorEntityType, item: EntityItem): string {
  if (type === 'scene') return (item as DirectorScene).time
  if (type === 'character') return (item as DirectorCharacter).role
  return (item as DirectorProp).type
}

interface ExtractStepProps {
  episode: DirectorEpisode
  onSaved: () => void
}

export function ExtractStep(props: ExtractStepProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const projectId = props.episode.projectId

  // 与 EntityStep 使用相同的 queryKey，保证增删改后两处视图同步刷新
  const charactersQuery = useQuery({
    queryKey: ['director', 'character', projectId],
    queryFn: () =>
      getDirectorEntities<DirectorCharacter>('character', {
        projectId,
        page_size: 200,
      }),
  })
  const scenesQuery = useQuery({
    queryKey: ['director', 'scene', projectId],
    queryFn: () =>
      getDirectorEntities<DirectorScene>('scene', {
        projectId,
        page_size: 200,
      }),
  })
  const propsQuery = useQuery({
    queryKey: ['director', 'prop', projectId],
    queryFn: () =>
      getDirectorEntities<DirectorProp>('prop', {
        projectId,
        page_size: 200,
      }),
  })

  const listsLoaded =
    !charactersQuery.isPending && !scenesQuery.isPending && !propsQuery.isPending
  const characters = charactersQuery.data?.data?.list ?? []
  const scenes = scenesQuery.data?.data?.list ?? []
  const propItems = propsQuery.data?.data?.list ?? []
  const hasResult =
    characters.length > 0 || scenes.length > 0 || propItems.length > 0

  const invalidateLists = () => {
    for (const type of ['character', 'scene', 'prop'] as const) {
      void queryClient.invalidateQueries({
        queryKey: ['director', type, projectId],
      })
    }
    props.onSaved()
  }

  const extractMutation = useMutation({
    mutationFn: () => extractDirectorEpisode(props.episode.id),
    onSuccess: (res) => {
      if (res.success && res.data) {
        const summary = [
          `${res.data.characters.length} ${t('Characters')}`,
          `${res.data.scenes.length} ${t('Scenes')}`,
          `${res.data.props.length} ${t('Props')}`,
        ].join(', ')
        toast.success(`${t('Extraction finished')}: ${summary}`)
        invalidateLists()
      }
    },
    onError: handleServerError,
  })

  const promptsMutation = useMutation({
    mutationFn: () => generateDirectorEpisodePrompts(props.episode.id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Prompt generated'))
        invalidateLists()
      }
    },
    onError: handleServerError,
  })

  const source = props.episode.scriptContent || props.episode.content

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [dialogType, setDialogType] =
    React.useState<DirectorEntityType>('character')
  const [dialogItem, setDialogItem] = React.useState<EntityItem | null>(null)

  const openAdd = (type: DirectorEntityType) => {
    setDialogType(type)
    setDialogItem(null)
    setDialogOpen(true)
  }

  const openEdit = (type: DirectorEntityType, item: EntityItem) => {
    setDialogType(type)
    setDialogItem(item)
    setDialogOpen(true)
  }

  let extractLabel = t('Extract Resources')
  if (extractMutation.isPending) {
    extractLabel = t('Extracting...')
  } else if (hasResult) {
    extractLabel = t('Re-extract')
  }

  return (
    <div className='flex flex-col gap-3.5'>
      {/* 顶部：标题 + 操作 */}
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div>
          <div className='text-base font-semibold'>
            {t('Extract Resources')}
          </div>
          <div className='text-muted-foreground mt-1 text-[13px]'>
            {t(
              'AI will read the script and extract characters, scenes and props, then save them for the following steps. Re-running will skip duplicates.'
            )}
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            size='sm'
            onClick={() => extractMutation.mutate()}
            disabled={extractMutation.isPending || !source}
          >
            {extractLabel}
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={() => promptsMutation.mutate()}
            disabled={promptsMutation.isPending || !hasResult}
          >
            {promptsMutation.isPending
              ? t('Generating...')
              : t('Batch Generate Prompts')}
          </Button>
        </div>
      </div>
      {!source && (
        <Alert>
          <AlertDescription>
            {t('Please prepare the content or script in previous steps first.')}
          </AlertDescription>
        </Alert>
      )}
      {listsLoaded && !hasResult && (
        <Alert>
          <AlertDescription>
            {t('No entries yet')} —{' '}
            {t('Use AI extraction from the script, or add one manually.')}
          </AlertDescription>
        </Alert>
      )}
      <EntitySection
        type='character'
        items={characters}
        isPending={charactersQuery.isPending}
        onRefresh={invalidateLists}
        onAdd={openAdd}
        onEdit={openEdit}
      />
      <EntitySection
        type='scene'
        items={scenes}
        isPending={scenesQuery.isPending}
        onRefresh={invalidateLists}
        onAdd={openAdd}
        onEdit={openEdit}
      />
      <EntitySection
        type='prop'
        items={propItems}
        isPending={propsQuery.isPending}
        onRefresh={invalidateLists}
        onAdd={openAdd}
        onEdit={openEdit}
      />
      <EntityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        type={dialogType}
        projectId={projectId}
        item={dialogItem}
        onSaved={invalidateLists}
      />
    </div>
  )
}

// ----------------------------------------------------------------------------
// 单个实体分区：标题 + 数量 + 添加按钮 + 行列表（生成提示词 / 编辑 / 删除）
// ----------------------------------------------------------------------------

interface EntitySectionProps {
  type: DirectorEntityType
  items: EntityItem[]
  isPending: boolean
  onRefresh: () => void
  onAdd: (type: DirectorEntityType) => void
  onEdit: (type: DirectorEntityType, item: EntityItem) => void
}

function EntitySection(props: EntitySectionProps) {
  const { t } = useTranslation()

  const promptMutation = useMutation({
    mutationFn: (id: number) => generateDirectorEntityPrompt(props.type, id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Prompt generated'))
        props.onRefresh()
      }
    },
    onError: handleServerError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDirectorEntity(props.type, id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Deleted successfully'))
        props.onRefresh()
      }
    },
    onError: handleServerError,
  })

  const renderRows = () => {
    if (props.isPending) {
      return (
        <div className='space-y-2 p-3'>
          {['s1', 's2', 's3'].map((key) => (
            <Skeleton key={key} className='h-8 w-full' />
          ))}
        </div>
      )
    }
    if (props.items.length === 0) {
      return (
        <p className='text-muted-foreground px-3 py-4 text-sm'>
          {t('No entries yet')}
        </p>
      )
    }
    return (
      <div className='divide-y'>
        {props.items.map((item) => {
          const promptGenerating =
            promptMutation.isPending && promptMutation.variables === item.id
          const deleting =
            deleteMutation.isPending && deleteMutation.variables === item.id
          const prompt = (item as DirectorCharacter).prompt
          return (
            <div
              key={item.id}
              className='flex items-center gap-3 px-3 py-2 text-sm'
            >
              <span className='w-28 shrink-0 truncate font-medium'>
                {entityName(props.type, item)}
              </span>
              <span className='text-muted-foreground w-24 shrink-0 truncate'>
                {entityMeta(props.type, item) || '—'}
              </span>
              <span
                className='text-muted-foreground min-w-0 flex-1 truncate'
                title={prompt}
              >
                {prompt || t('Not generated')}
              </span>
              <span className='flex shrink-0 gap-1'>
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-7'
                  aria-label={t('Generate Prompt')}
                  disabled={promptGenerating}
                  onClick={() => promptMutation.mutate(item.id)}
                >
                  <Sparkles aria-hidden='true' className='size-3.5' />
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-7'
                  aria-label={t('Edit')}
                  onClick={() => props.onEdit(props.type, item)}
                >
                  <Pencil aria-hidden='true' className='size-3.5' />
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  className='text-destructive hover:text-destructive size-7'
                  aria-label={t('Delete')}
                  disabled={deleting}
                  onClick={() => deleteMutation.mutate(item.id)}
                >
                  <Trash2 aria-hidden='true' className='size-3.5' />
                </Button>
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between'>
        <h4 className='text-sm font-semibold'>
          {t(SECTION_TITLE[props.type])} ({props.items.length})
        </h4>
        <Button
          variant='outline'
          size='sm'
          onClick={() => props.onAdd(props.type)}
        >
          <Plus aria-hidden='true' />
          {t('Add')}
        </Button>
      </div>
      <div className='rounded-lg border'>{renderRows()}</div>
    </div>
  )
}
