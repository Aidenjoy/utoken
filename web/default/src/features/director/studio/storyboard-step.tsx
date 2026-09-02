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
import { Clapperboard, Plus, Sparkles } from 'lucide-react'
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
import { handleServerError } from '@/lib/handle-server-error'

import {
  createDirectorStoryboard,
  deleteDirectorStoryboard,
  getDirectorStoryboards,
  splitDirectorEpisodeStoryboards,
  updateDirectorStoryboard,
} from '../api'
import type { DirectorEpisode, DirectorStoryboard } from '../types'
import { StoryboardCard } from './storyboard-card'

interface StoryboardStepProps {
  episode: DirectorEpisode
  onSaved: () => void
}

// 分镜表单字段（镜头语言 + 提示词）
const STORYBOARD_FIELDS: {
  key: keyof DirectorStoryboard
  label: string
  textarea?: boolean
}[] = [
  { key: 'title', label: 'Title' },
  { key: 'shotType', label: 'Shot Type' },
  { key: 'angle', label: 'Angle' },
  { key: 'movement', label: 'Camera Movement' },
  { key: 'location', label: 'Location' },
  { key: 'time', label: 'Time of Day' },
  { key: 'result', label: 'Shot Description', textarea: true },
  { key: 'imagePrompt', label: 'Image Prompt', textarea: true },
  { key: 'videoPrompt', label: 'Video Prompt', textarea: true },
  { key: 'bgmPrompt', label: 'BGM Prompt', textarea: true },
]

export function StoryboardStep(props: StoryboardStepProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const queryKey = ['director', 'storyboards', props.episode.id]

  const listQuery = useQuery({
    queryKey,
    queryFn: () =>
      getDirectorStoryboards({ episodeId: props.episode.id, page_size: 200 }),
  })

  const storyboards = listQuery.data?.data?.list ?? []
  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const splitMutation = useMutation({
    mutationFn: () => splitDirectorEpisodeStoryboards(props.episode.id),
    onSuccess: (res) => {
      if (res.success && res.data) {
        toast.success(`${t('Storyboard split finished')}: ${res.data.count}`)
        invalidate()
        props.onSaved()
      }
    },
    onError: handleServerError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDirectorStoryboard(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Deleted'))
        invalidate()
      }
    },
    onError: handleServerError,
  })

  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingItem, setEditingItem] =
    React.useState<DirectorStoryboard | null>(null)

  const canSplit = Boolean(props.episode.scriptContent || props.episode.content)

  const renderList = () => {
    if (listQuery.isPending) {
      return (
        <div className='space-y-4'>
          {['s1', 's2'].map((key) => (
            <Skeleton key={key} className='h-48 w-full rounded-xl' />
          ))}
        </div>
      )
    }
    if (storyboards.length === 0) {
      return (
        <Empty>
          <EmptyMedia>
            <Clapperboard aria-hidden='true' />
          </EmptyMedia>
          <EmptyTitle>{t('No storyboards yet')}</EmptyTitle>
          <EmptyDescription>
            {t(
              'Split the script into storyboards with AI, or add one manually.'
            )}
          </EmptyDescription>
        </Empty>
      )
    }
    return (
      <div className='space-y-4'>
        {storyboards.map((storyboard) => (
          <StoryboardCard
            key={storyboard.id}
            storyboard={storyboard}
            episode={props.episode}
            onEdit={() => {
              setEditingItem(storyboard)
              setDialogOpen(true)
            }}
            onDelete={() => deleteMutation.mutate(storyboard.id)}
            onChanged={invalidate}
          />
        ))}
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h3 className='text-base font-semibold'>{t('Storyboards')}</h3>
        <div className='flex gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={splitMutation.isPending || !canSplit}
            onClick={() => splitMutation.mutate()}
          >
            <Sparkles aria-hidden='true' />
            {splitMutation.isPending
              ? t('Splitting...')
              : t('AI Split Storyboards')}
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

      <StoryboardDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        episode={props.episode}
        item={editingItem}
        onSaved={invalidate}
      />
    </div>
  )
}

// ----------------------------------------------------------------------------
// 分镜编辑对话框
// ----------------------------------------------------------------------------

interface StoryboardDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  episode: DirectorEpisode
  item: DirectorStoryboard | null
  onSaved: () => void
}

function StoryboardDialog(props: StoryboardDialogProps) {
  const { t } = useTranslation()
  const isEdit = Boolean(props.item?.id)

  const [values, setValues] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (!props.open) return
    const next: Record<string, string> = {}
    for (const field of STORYBOARD_FIELDS) {
      next[field.key] = String(
        (props.item as unknown as Record<string, unknown> | null)?.[
          field.key
        ] ?? ''
      )
    }
    setValues(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.open, props.item])

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Partial<DirectorStoryboard> = {
        ...(values as Partial<DirectorStoryboard>),
        episodeId: props.episode.id,
      }
      if (isEdit && props.item) {
        payload.id = props.item.id
        return updateDirectorStoryboard(payload)
      }
      return createDirectorStoryboard(payload)
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

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t('Edit Storyboard') : t('Add Storyboard')}
          </DialogTitle>
        </DialogHeader>
        <div className='grid grid-cols-1 gap-4 py-2 sm:grid-cols-2'>
          {STORYBOARD_FIELDS.map((field) => (
            <div
              key={field.key}
              className={
                field.textarea ? 'grid gap-2 sm:col-span-2' : 'grid gap-2'
              }
            >
              <Label htmlFor={`director-sb-${field.key}`}>
                {t(field.label)}
              </Label>
              {field.textarea ? (
                <Textarea
                  id={`director-sb-${field.key}`}
                  rows={3}
                  value={values[field.key] ?? ''}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                />
              ) : (
                <Input
                  id={`director-sb-${field.key}`}
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
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? t('Saving...') : t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
