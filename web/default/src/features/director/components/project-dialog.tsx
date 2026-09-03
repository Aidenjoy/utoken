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
import { ImagePlus, X } from 'lucide-react'
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
import { ZoomableImage } from '@/components/zoomable-image'
import { handleServerError } from '@/lib/handle-server-error'

import {
  createDirectorProject,
  updateDirectorProject,
  uploadDirectorFile,
} from '../api'
import {
  DIRECTOR_CATEGORY_CONFIG,
  DIRECTOR_CATEGORIES,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  PROJECT_STYLE_OPTIONS,
} from '../constants'
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
  const [category, setCategory] =
    React.useState<DirectorCategory>(props.category)
  const [genre, setGenre] = React.useState('')
  const [style, setStyle] = React.useState('realistic')
  const [totalEpisodes, setTotalEpisodes] = React.useState(1)
  const [status, setStatus] = React.useState('draft')
  const [description, setDescription] = React.useState('')
  const [thumbnail, setThumbnail] = React.useState('')
  const [tags, setTags] = React.useState('')
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!props.open) return
    const p = props.project
    setTitle(p?.title ?? '')
    setCategory(p?.category ?? props.category)
    setGenre(p?.genre ?? '')
    setStyle(p?.style || 'realistic')
    setTotalEpisodes(p?.totalEpisodes || 1)
    setStatus(p?.status || 'draft')
    setDescription(p?.description ?? '')
    setThumbnail(p?.thumbnail ?? '')
    setTags(p ? parseTags(p.tags) : '')
  }, [props.open, props.project, props.category])

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
        category,
        genre: genre.trim(),
        style,
        totalEpisodes,
        status,
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

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      uploadDirectorFile({ file, projectId: props.project?.id }),
    onSuccess: (res) => {
      if (res.success && res.data?.url) {
        setThumbnail(res.data.url)
        toast.success(t('Uploaded'))
      }
    },
    onError: handleServerError,
  })

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadMutation.mutate(file)
    e.target.value = ''
  }

  const showGenre = DIRECTOR_CATEGORY_CONFIG[category].showGenre

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-lg'>
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
              <Label htmlFor='director-project-category'>{t('Category')}</Label>
              <Select
                items={DIRECTOR_CATEGORIES.map((c) => ({
                  value: c,
                  label: t(DIRECTOR_CATEGORY_CONFIG[c].label),
                }))}
                value={category}
                onValueChange={(v) => setCategory(v as DirectorCategory)}
              >
                <SelectTrigger id='director-project-category'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {DIRECTOR_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(DIRECTOR_CATEGORY_CONFIG[c].label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {showGenre ? (
              <div className='grid gap-2'>
                <Label htmlFor='director-project-genre'>{t('Genre')}</Label>
                <Input
                  id='director-project-genre'
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder={t('e.g. urban romance')}
                />
              </div>
            ) : null}
          </div>
          <div className='grid grid-cols-3 gap-4'>
            <div className='grid gap-2'>
              <Label htmlFor='director-project-style'>{t('Style')}</Label>
              <Select
                items={PROJECT_STYLE_OPTIONS.map((s) => ({
                  value: s.value,
                  label: t(s.label),
                }))}
                value={style}
                onValueChange={(v) => {
                  if (v !== null) setStyle(v)
                }}
              >
                <SelectTrigger id='director-project-style'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {PROJECT_STYLE_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {t(s.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              <Label htmlFor='director-project-status'>{t('Status')}</Label>
              <Select
                items={PROJECT_STATUSES.map((s) => ({
                  value: s,
                  label: t(PROJECT_STATUS_LABEL[s]),
                }))}
                value={status}
                onValueChange={(v) => {
                  if (v !== null) setStatus(v)
                }}
              >
                <SelectTrigger id='director-project-status'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {PROJECT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(PROJECT_STATUS_LABEL[s])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className='grid gap-2'>
            <Label>{t('Cover')}</Label>
            <div className='flex items-start gap-3'>
              <div className='bg-muted relative h-24 w-32 shrink-0 overflow-hidden rounded-md border'>
                {thumbnail ? (
                  <ZoomableImage
                    src={thumbnail}
                    alt={t('Cover')}
                    className='size-full'
                  />
                ) : (
                  <div className='text-muted-foreground flex size-full items-center justify-center'>
                    <ImagePlus aria-hidden='true' className='size-6' />
                  </div>
                )}
              </div>
              <div className='flex flex-col gap-2'>
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='image/*'
                  className='hidden'
                  onChange={handleCoverChange}
                />
                <Button
                  variant='outline'
                  size='sm'
                  disabled={uploadMutation.isPending}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus aria-hidden='true' />
                  {uploadMutation.isPending ? t('Uploading...') : t('Upload')}
                </Button>
                {thumbnail && (
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => setThumbnail('')}
                  >
                    <X aria-hidden='true' />
                    {t('Remove')}
                  </Button>
                )}
              </div>
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
