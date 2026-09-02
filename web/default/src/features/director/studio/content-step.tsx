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

import { updateDirectorEpisode } from '../api'
import type { DirectorEpisode } from '../types'

const ASPECT_RATIOS = ['9:16', '16:9', '1:1', '3:4', '4:3']
const RESOLUTIONS = ['720p', '1080p']

interface ContentStepProps {
  episode: DirectorEpisode
  onSaved: () => void
}

export function ContentStep(props: ContentStepProps) {
  const { t } = useTranslation()

  const [content, setContent] = React.useState(props.episode.content ?? '')
  const [targetDuration, setTargetDuration] = React.useState(
    props.episode.targetDuration || 60
  )
  const [aspectRatio, setAspectRatio] = React.useState(
    props.episode.aspectRatio || '9:16'
  )
  const [resolution, setResolution] = React.useState(
    props.episode.resolution || '1080p'
  )

  React.useEffect(() => {
    setContent(props.episode.content ?? '')
    setTargetDuration(props.episode.targetDuration || 60)
    setAspectRatio(props.episode.aspectRatio || '9:16')
    setResolution(props.episode.resolution || '1080p')
  }, [props.episode])

  const saveMutation = useMutation({
    mutationFn: () =>
      updateDirectorEpisode({
        id: props.episode.id,
        content,
        targetDuration,
        aspectRatio,
        resolution,
      } as Partial<DirectorEpisode>),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Content saved'))
        props.onSaved()
      }
    },
    onError: handleServerError,
  })

  return (
    <div className='space-y-5'>
      <div className='grid gap-2'>
        <Label htmlFor='director-content'>{t('Original Content')}</Label>
        <Textarea
          id='director-content'
          rows={14}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t(
            'Paste the original story, script outline or product selling points...'
          )}
        />
      </div>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
        <div className='grid gap-2'>
          <Label htmlFor='director-target-duration'>
            {t('Target Duration (seconds)')}
          </Label>
          <Input
            id='director-target-duration'
            type='number'
            min={1}
            value={targetDuration}
            onChange={(e) =>
              setTargetDuration(Math.max(1, Number(e.target.value) || 60))
            }
          />
        </div>
        <div className='grid gap-2'>
          <Label>{t('Aspect Ratio')}</Label>
          <Select
            value={aspectRatio}
            onValueChange={(value) => setAspectRatio(value ?? '')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASPECT_RATIOS.map((ratio) => (
                <SelectItem key={ratio} value={ratio}>
                  {ratio}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='grid gap-2'>
          <Label>{t('Resolution')}</Label>
          <Select
            value={resolution}
            onValueChange={(value) => setResolution(value ?? '')}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESOLUTIONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <Button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
      >
        {saveMutation.isPending ? t('Saving...') : t('Save')}
      </Button>
    </div>
  )
}
