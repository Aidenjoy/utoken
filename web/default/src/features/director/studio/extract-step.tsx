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
import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'

import { extractDirectorEpisode } from '../api'
import type { DirectorEpisode } from '../types'

interface ExtractStepProps {
  episode: DirectorEpisode
  onSaved: () => void
}

export function ExtractStep(props: ExtractStepProps) {
  const { t } = useTranslation()

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
        props.onSaved()
      }
    },
    onError: handleServerError,
  })

  const source = props.episode.scriptContent || props.episode.content

  return (
    <div className='space-y-5'>
      {!source && (
        <Alert>
          <AlertDescription>
            {t('Please prepare the content or script in previous steps first.')}
          </AlertDescription>
        </Alert>
      )}
      <Alert>
        <AlertDescription>
          {t(
            'AI will read the script and extract characters, scenes and props, then save them for the following steps. Re-running will skip duplicates.'
          )}
        </AlertDescription>
      </Alert>
      <Button
        onClick={() => extractMutation.mutate()}
        disabled={extractMutation.isPending || !source}
      >
        <Sparkles aria-hidden='true' />
        {extractMutation.isPending
          ? t('Extracting...')
          : t('Extract Roles & Scenes')}
      </Button>
    </div>
  )
}
