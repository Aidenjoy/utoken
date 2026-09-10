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
import { Copy, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { formatTimestampToDate } from '@/lib/format'

import { PROMPT_VISIBILITIES } from '../constants'
import { parsePromptTags } from '../lib'
import { usePrompts } from './prompts-provider'
import { usePromptTemplateActions } from './use-prompt-template-actions'

/**
 * Read-only detail view. The list only shows a clamped preview, so this is where
 * users read a long template before deciding to copy or run it.
 */
export function PromptsViewDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow } = usePrompts()
  const { copyContent, useInPlayground } = usePromptTemplateActions(currentRow)

  const visibility = currentRow
    ? PROMPT_VISIBILITIES[currentRow.visibility]
    : undefined
  const tags = currentRow ? parsePromptTags(currentRow.tags) : []

  return (
    <Dialog open={open === 'view'} onOpenChange={(v) => !v && setOpen(null)}>
      <DialogContent className='sm:max-w-[720px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <span className='truncate'>{currentRow?.title}</span>
            {visibility && (
              <StatusBadge
                label={t(visibility.labelKey)}
                variant={visibility.variant}
                copyable={false}
              />
            )}
          </DialogTitle>
          <DialogDescription>
            {currentRow?.description || t('No description provided')}
          </DialogDescription>
        </DialogHeader>

        <div className='flex flex-wrap items-center gap-1'>
          {tags.map((tag) => (
            <Badge key={tag} variant='outline' className='font-normal'>
              {tag}
            </Badge>
          ))}
          {tags.length === 0 && (
            <span className='text-muted-foreground text-xs'>
              {t('No tags')}
            </span>
          )}
        </div>

        <Separator />

        <pre className='bg-muted/40 max-h-[45vh] overflow-auto rounded-md p-3 font-mono text-xs wrap-break-word whitespace-pre-wrap'>
          {currentRow?.content}
        </pre>

        <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
          <span>
            {t('Used {{count}} times', { count: currentRow?.use_count ?? 0 })}
          </span>
          {currentRow && currentRow.updated_at > 0 && (
            <span>
              {t('Updated at')} {formatTimestampToDate(currentRow.updated_at)}
            </span>
          )}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={copyContent}>
            <Copy className='h-4 w-4' />
            {t('Copy content')}
          </Button>
          <Button onClick={useInPlayground}>
            <Play className='h-4 w-4' />
            {t('Use in Playground')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
