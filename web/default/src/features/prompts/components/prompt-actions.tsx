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
import { Copy, Edit, Eye, Play, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DataTableRowActionMenu } from '@/components/data-table/core/row-action-menu'
import { Button } from '@/components/ui/button'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import type { PromptTemplate } from '../types'
import { usePrompts } from './prompts-provider'
import { usePromptTemplateActions } from './use-prompt-template-actions'

type PromptActionsProps = {
  prompt: PromptTemplate
  /** Card view has no room for a leading icon button, so it uses the menu item. */
  hideCopyButton?: boolean
  className?: string
}

/**
 * Actions shared by the table rows and the card grid.
 *
 * `View` / `Use in Playground` / `Duplicate` are offered for every template the
 * user can read; `Edit` / `Delete` follow the same ownership rule the backend
 * enforces (creator, own-organization admin, or super admin on public ones).
 */
export function PromptActions({
  prompt,
  hideCopyButton = false,
  className,
}: PromptActionsProps) {
  const { t } = useTranslation()
  const { setOpen, setCurrentRow } = usePrompts()
  const { canManage, copyContent, duplicate, useInPlayground } =
    usePromptTemplateActions(prompt)

  return (
    <div className={className ?? '-ml-1.5 flex items-center gap-1'}>
      {!hideCopyButton && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant='ghost'
                size='icon-sm'
                onClick={copyContent}
                aria-label={t('Copy content')}
              />
            }
          >
            <Copy />
          </TooltipTrigger>
          <TooltipContent>{t('Copy content')}</TooltipContent>
        </Tooltip>
      )}

      <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
        <DropdownMenuItem
          onClick={() => {
            setCurrentRow(prompt)
            setOpen('view')
          }}
        >
          {t('View')}
          <DropdownMenuShortcut>
            <Eye size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={useInPlayground}>
          {t('Use in Playground')}
          <DropdownMenuShortcut>
            <Play size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={duplicate}>
          {t('Duplicate')}
          <DropdownMenuShortcut>
            <Copy size={16} />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        {hideCopyButton && (
          <DropdownMenuItem onClick={copyContent}>
            {t('Copy content')}
            <DropdownMenuShortcut>
              <Copy size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
        {canManage && <DropdownMenuSeparator />}
        {canManage && (
          <DropdownMenuItem
            onClick={() => {
              setCurrentRow(prompt)
              setOpen('update')
            }}
          >
            {t('Edit')}
            <DropdownMenuShortcut>
              <Edit size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
        {canManage && (
          <DropdownMenuItem
            onClick={() => {
              setCurrentRow(prompt)
              setOpen('delete')
            }}
            className='text-destructive focus:text-destructive'
          >
            {t('Delete')}
            <DropdownMenuShortcut>
              <Trash2 size={16} />
            </DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
      </DataTableRowActionMenu>
    </div>
  )
}
