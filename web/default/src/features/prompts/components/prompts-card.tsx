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
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

import { PROMPT_VISIBILITIES } from '../constants'
import { parsePromptTags } from '../lib'
import type { PromptTemplate } from '../types'
import { PromptActions } from './prompt-actions'

/**
 * Card renderer for the grid view. Prompt bodies are long free-form text, so the
 * card trades the table's column alignment for a clamped content preview.
 */
export function PromptCard({ prompt }: { prompt: PromptTemplate }) {
  const { t } = useTranslation()
  const visibility = PROMPT_VISIBILITIES[prompt.visibility]
  const tags = parsePromptTags(prompt.tags)

  return (
    <Card className='hover:border-primary/40 h-full gap-0 py-0 transition-colors'>
      <CardHeader className='gap-2 py-4'>
        <div className='flex items-start justify-between gap-2'>
          <CardTitle className='line-clamp-1 text-sm font-medium'>
            {prompt.title}
          </CardTitle>
          {visibility && (
            <StatusBadge
              label={t(visibility.labelKey)}
              variant={visibility.variant}
              copyable={false}
              className='shrink-0'
            />
          )}
        </div>
        {prompt.description && (
          <CardDescription className='line-clamp-2'>
            {prompt.description}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className='px-4'>
        <pre className='text-muted-foreground bg-muted/40 line-clamp-5 max-h-32 overflow-hidden rounded-md p-3 font-mono text-xs wrap-break-word whitespace-pre-wrap'>
          {prompt.content}
        </pre>
      </CardContent>

      <CardFooter className='mt-auto justify-between gap-2 px-4 py-3'>
        <div className='flex min-w-0 flex-wrap items-center gap-1'>
          <span className='text-muted-foreground mr-1 text-xs'>
            {t('{{count}} uses', { count: prompt.use_count })}
          </span>
          {tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant='outline' className='font-normal'>
              {tag}
            </Badge>
          ))}
          {tags.length > 3 && (
            <Badge variant='outline' className='font-normal'>
              +{tags.length - 3}
            </Badge>
          )}
        </div>
        <PromptActions
          prompt={prompt}
          hideCopyButton
          className='flex shrink-0 items-center gap-1'
        />
      </CardFooter>
    </Card>
  )
}
