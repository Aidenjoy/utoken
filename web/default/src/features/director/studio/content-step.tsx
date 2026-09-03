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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { updateDirectorEpisode } from '../api'
import type { DirectorEpisode } from '../types'

interface ContentStepProps {
  episode: DirectorEpisode
  onSaved: () => void
}

export function ContentStep(props: ContentStepProps) {
  const { t } = useTranslation()

  const [content, setContent] = React.useState(props.episode.content ?? '')

  React.useEffect(() => {
    setContent(props.episode.content ?? '')
  }, [props.episode])

  const saveMutation = useMutation({
    mutationFn: () =>
      updateDirectorEpisode({
        id: props.episode.id,
        content,
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
    <div className='flex flex-col gap-3.5'>
      {/* 顶部：标题 + 操作 */}
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div>
          <div className='text-base font-semibold'>{t('Original Content')}</div>
          <div className='text-muted-foreground mt-1 text-[13px]'>
            {t(
              'Enter the original story content of this episode as the source material for AI rewriting'
            )}
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            size='sm'
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? t('Saving...') : t('Save Content')}
          </Button>
        </div>
      </div>
      <div className='grid gap-2'>
        <Label htmlFor='director-content'>{t('Original Content')}</Label>
        <Textarea
          id='director-content'
          className='min-h-96'
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t(
            'Paste the original story, script outline or product selling points...'
          )}
        />
      </div>
    </div>
  )
}
