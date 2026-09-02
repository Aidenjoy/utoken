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
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { createDirectorProject, updateDirectorProject } from '../api'
import type { DirectorCategory, DirectorProject } from '../types'

interface ProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  category: DirectorCategory
  project?: DirectorProject | null
  onSaved: () => void
}

function parseTags(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    const arr = JSON.parse(trimmed)
    if (Array.isArray(arr)) return arr.join(',')
  } catch {
    /* not a JSON array, treat as comma separated */
  }
  return trimmed
}

export function ProjectDialog(props: ProjectDialogProps) {
  const { t } = useTranslation()
  const isEdit = Boolean(props.project?.id)

  const [title, setTitle] = React.useState('')
  const [genre, setGenre] = React.useState('')
  const [style, setStyle] = React.useState('')
  const [totalEpisodes, setTotalEpisodes] = React.useState(1)
  const [description, setDescription] = React.useState('')
  const [thumbnail, setThumbnail] = React.useState('')
  const [tags, setTags] = React.useState('')

  React.useEffect(() => {
    if (!props.open) return
    const p = props.project
    setTitle(p?.title ?? '')
    setGenre(p?.genre ?? '')
    setStyle(p?.style ?? '')
    setTotalEpisodes(p?.totalEpisodes || 1)
    setDescription(p?.description ?? '')
    setThumbnail(p?.thumbnail ?? '')
    setTags(p ? parseTags(p.tags) : '')
  }, [props.open, props.project])

  const mutation = useMutation({
    mutationFn: async () => {
      const tagsJson = tags.trim()
        ? JSON.stringify(
            tags
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          )
        : ''
      const payload: Partial<DirectorProject> = {
        title: title.trim(),
        category: props.category,
        genre: genre.trim(),
        style: style.trim(),
        totalEpisodes,
        description,
        thumbnail: thumbnail.trim(),
        tags: tagsJson,
      }
      const editingId = props.project?.id
      if (isEdit && editingId) {
        return updateDirectorProject({ ...payload, id: editingId })
      }
      return createDirectorProject(payload)
    },
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t(isEdit ? 'Project updated' : 'Project created'))
        props.onOpenChange(false)
        props.onSaved()
      }
    },
    onError: handleServerError,
  })

  const handleSubmit = () => {
    if (!title.trim()) {
      toast.error(t('Project title is required'))
      return
    }
    mutation.mutate()
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {t(isEdit ? 'Edit Project' : 'Create Project')}
          </DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-2'>
          <div className='grid gap-2'>
            <Label htmlFor='director-project-title'>{t('Title')}</Label>
            <Input
              id='director-project-title'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('Project title')}
            />
          </div>
          <div className='grid grid-cols-2 gap-4'>
            <div className='grid gap-2'>
              <Label htmlFor='director-project-genre'>{t('Genre')}</Label>
              <Input
                id='director-project-genre'
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder={t('e.g. urban romance')}
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='director-project-style'>{t('Style')}</Label>
              <Input
                id='director-project-style'
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder={t('e.g. realistic')}
              />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-4'>
            <div className='grid gap-2'>
              <Label htmlFor='director-project-episodes'>
                {t('Total Episodes')}
              </Label>
              <Input
                id='director-project-episodes'
                type='number'
                min={1}
                value={totalEpisodes}
                onChange={(e) =>
                  setTotalEpisodes(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='director-project-thumbnail'>{t('Cover')}</Label>
              <Input
                id='director-project-thumbnail'
                value={thumbnail}
                onChange={(e) => setThumbnail(e.target.value)}
                placeholder={t('Cover image URL')}
              />
            </div>
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='director-project-tags'>{t('Tags')}</Label>
            <Input
              id='director-project-tags'
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t('Separate multiple tags with commas')}
            />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='director-project-desc'>{t('Description')}</Label>
            <Textarea
              id='director-project-desc'
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('Project description')}
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
