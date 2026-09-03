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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { createDirectorEpisode, updateDirectorEpisode } from '../api'
import {
  ASPECT_RATIO_OPTIONS,
  DIRECTOR_CATEGORY_CONFIG,
  DURATION_OPTIONS,
  RESOLUTION_OPTIONS,
} from '../constants'
import type { DirectorCategory, DirectorEpisode } from '../types'

interface EpisodeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  category: DirectorCategory
  projectId: number
  nextEpisodeNumber: number
  episode?: DirectorEpisode | null
  onSaved: () => void
}

function parseMetadata(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object') return obj as Record<string, string>
  } catch {
    /* ignore invalid JSON */
  }
  return {}
}

export function EpisodeDialog(props: EpisodeDialogProps) {
  const { t } = useTranslation()
  const categoryConfig = DIRECTOR_CATEGORY_CONFIG[props.category]
  const isEdit = Boolean(props.episode?.id)

  const [episodeNumber, setEpisodeNumber] = React.useState(1)
  const [title, setTitle] = React.useState('')
  const [targetDuration, setTargetDuration] = React.useState(60)
  const [aspectRatio, setAspectRatio] = React.useState('9:16')
  const [resolution, setResolution] = React.useState('1080P')
  const [description, setDescription] = React.useState('')
  const [content, setContent] = React.useState('')
  const [meta, setMeta] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    if (!props.open) return
    const e = props.episode
    setEpisodeNumber(e?.episodeNumber || props.nextEpisodeNumber)
    setTitle(e?.title ?? '')
    setTargetDuration(e?.targetDuration || 60)
    setAspectRatio(e?.aspectRatio || '9:16')
    setResolution(e?.resolution || '1080P')
    setDescription(e?.description ?? '')
    setContent(e?.content ?? '')
    setMeta(e ? parseMetadata(e.metadata) : {})
  }, [props.open, props.episode, props.nextEpisodeNumber])

  const mutation = useMutation({
    mutationFn: async () => {
      const metadata = categoryConfig.metaFields.length
        ? JSON.stringify(meta)
        : ''
      if (isEdit && props.episode?.id) {
        return updateDirectorEpisode({
          id: props.episode.id,
          title: title.trim(),
          content,
          description,
          targetDuration,
          aspectRatio,
          resolution,
          metadata,
        })
      }
      return createDirectorEpisode({
        projectId: props.projectId,
        episodeNumber,
        title: title.trim(),
        content,
        description,
        targetDuration,
        aspectRatio,
        resolution,
        metadata,
      })
    },
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t(isEdit ? 'Episode updated' : 'Episode created'))
        props.onOpenChange(false)
        props.onSaved()
      }
    },
    onError: handleServerError,
  })

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error(t('Episode title is required'))
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {t(isEdit ? 'Edit Episode' : 'Create Episode')}
          </DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-2'>
          <div className='grid grid-cols-2 gap-4'>
            <div className='grid gap-2'>
              <Label htmlFor='director-episode-number'>
                {t('Episode Number')}
              </Label>
              <Input
                id='director-episode-number'
                type='number'
                min={1}
                disabled={isEdit}
                value={episodeNumber}
                onChange={(e) =>
                  setEpisodeNumber(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='director-episode-title'>{t('Title')}</Label>
              <Input
                id='director-episode-title'
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('Episode title')}
              />
            </div>
          </div>
          <div className='grid grid-cols-3 gap-4'>
            <div className='grid gap-2'>
              <Label htmlFor='director-episode-duration'>
                {t('Duration')}
              </Label>
              <Select
                items={DURATION_OPTIONS.map((d) => ({
                  value: String(d),
                  label: `${d}s`,
                }))}
                value={String(targetDuration)}
                onValueChange={(v) => {
                  if (v !== null) setTargetDuration(Number(v))
                }}
              >
                <SelectTrigger id='director-episode-duration'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {DURATION_OPTIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d}s
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='director-episode-ratio'>
                {t('Aspect Ratio')}
              </Label>
              <Select
                value={aspectRatio}
                onValueChange={(v) => {
                  if (v !== null) setAspectRatio(v)
                }}
              >
                <SelectTrigger id='director-episode-ratio'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {ASPECT_RATIO_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='director-episode-resolution'>
                {t('Resolution')}
              </Label>
              <Select
                value={resolution}
                onValueChange={(v) => {
                  if (v !== null) setResolution(v)
                }}
              >
                <SelectTrigger id='director-episode-resolution'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {RESOLUTION_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='director-episode-desc'>{t('Description')}</Label>
            <Textarea
              id='director-episode-desc'
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {categoryConfig.metaFields.length > 0 ? (
            <div className='space-y-4'>
              <p className='text-muted-foreground text-sm'>
                {t(categoryConfig.label)} {t('input info (used by AI rewrite)')}
              </p>
              {categoryConfig.metaFields.map((f) => (
                <div key={f.key} className='grid gap-2'>
                  <Label htmlFor={`director-episode-meta-${f.key}`}>
                    {t(f.label)}
                  </Label>
                  <Textarea
                    id={`director-episode-meta-${f.key}`}
                    rows={2}
                    value={meta[f.key] ?? ''}
                    onChange={(e) =>
                      setMeta((prev) => ({
                        ...prev,
                        [f.key]: e.target.value,
                      }))
                    }
                    placeholder={t(f.placeholder)}
                  />
                </div>
              ))}
            </div>
          ) : null}
          <div className='grid gap-2'>
            <Label htmlFor='director-episode-content'>
              {t('Original Content')}
            </Label>
            <Textarea
              id='director-episode-content'
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t(
                'Paste the original script or draft; AI rewrite will be based on it'
              )}
            />
          </div>
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
