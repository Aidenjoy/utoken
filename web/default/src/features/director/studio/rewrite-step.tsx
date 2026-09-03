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

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { rewriteDirectorEpisode, updateDirectorEpisode } from '../api'
import type { DirectorEpisode } from '../types'

interface RewriteStepProps {
  episode: DirectorEpisode
  onSaved: () => void
}

export function RewriteStep(props: RewriteStepProps) {
  const { t } = useTranslation()

  const [script, setScript] = React.useState(props.episode.scriptContent ?? '')

  React.useEffect(() => {
    setScript(props.episode.scriptContent ?? '')
  }, [props.episode])

  const rewriteMutation = useMutation({
    mutationFn: () => rewriteDirectorEpisode(props.episode.id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Script rewritten'))
        setScript(res.data?.scriptContent ?? '')
        props.onSaved()
      }
    },
    onError: handleServerError,
  })

  const saveMutation = useMutation({
    mutationFn: () =>
      updateDirectorEpisode({
        id: props.episode.id,
        scriptContent: script,
      } as Partial<DirectorEpisode>),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Script saved'))
        props.onSaved()
      }
    },
    onError: handleServerError,
  })

  const busy = rewriteMutation.isPending || saveMutation.isPending

  return (
    <div className='flex flex-col gap-3.5'>
      {/* 顶部：标题 + 操作 */}
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div>
          <div className='text-base font-semibold'>{t('AI Rewrite')}</div>
          <div className='text-muted-foreground mt-1 text-[13px]'>
            {t('Rewrite the original content into a vertical short drama script')}
          </div>
        </div>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            size='sm'
            onClick={() => rewriteMutation.mutate()}
            disabled={busy || !props.episode.content}
          >
            {rewriteMutation.isPending
              ? t('Rewriting with AI...')
              : t('AI Rewrite')}
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={() => saveMutation.mutate()}
            disabled={busy}
          >
            {saveMutation.isPending ? t('Saving...') : t('Save Script')}
          </Button>
        </div>
      </div>
      {!props.episode.content && (
        <Alert>
          <AlertDescription>
            {t('Please input the original content in the previous step first.')}
          </AlertDescription>
        </Alert>
      )}
      <div className='grid gap-2'>
        <Label htmlFor='director-script'>{t('Script')}</Label>
        <Textarea
          id='director-script'
          className='min-h-96'
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder={t('The rewritten script will appear here...')}
        />
      </div>
    </div>
  )
}
