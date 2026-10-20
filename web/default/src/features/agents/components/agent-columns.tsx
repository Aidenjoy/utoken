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
import type { ColumnDef } from '@tanstack/react-table'
import type { TFunction } from 'i18next'
import { Pencil, Power, Trash2 } from 'lucide-react'

import { DataTableRowActionMenu } from '@/components/data-table/core/row-action-menu'
import { LongText } from '@/components/long-text'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatModelDiscount } from '@/lib/discount'

import { AGENT_STATUS, type Agent } from '../types'

export type AgentActions = {
  onEdit: (agent: Agent) => void
  onToggleStatus: (agent: Agent) => void
  onDelete: (agent: Agent) => void
}

/**
 * Columns for the reseller (agent) management list. The authorization column
 * shows how many models the agent may resell; hovering lists each model with
 * the deepest discount the agent may grant for it (0.8 → 80%).
 *
 * `locale` must be a BCP-47 tag (run `toIntlLocale` on it first): the i18next
 * codes this project uses (`zhCN` / `zhTW`) make `Intl.NumberFormat` throw, and
 * because the discount is formatted while building the tooltip elements the
 * throw happens during row render — the error boundary replaces the whole page.
 */
export function useAgentColumns(
  actions: AgentActions,
  t: TFunction,
  locale: string | undefined
): ColumnDef<Agent>[] {
  return [
    {
      accessorKey: 'id',
      header: t('ID'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <TableId value={row.original.id} className='w-[60px]' />
      ),
      size: 80,
    },
    {
      accessorKey: 'username',
      header: t('User'),
      meta: { mobileTitle: true },
      cell: ({ row }) => {
        const username = row.original.username
        const displayName = row.original.display_name
        return (
          <div className='flex min-w-[160px] flex-col gap-1'>
            <LongText className='max-w-[200px] font-medium'>
              {username || '-'}
            </LongText>
            {displayName && displayName !== username && (
              <LongText className='text-muted-foreground max-w-[200px] text-xs'>
                {displayName}
              </LongText>
            )}
          </div>
        )
      },
      size: 220,
    },
    {
      id: 'authorized_models',
      accessorKey: 'model_discounts',
      header: t('Authorized Models'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        // 键集合就是授权清单，排序后展示以免每次渲染都换序。
        const entries = Object.entries(row.original.model_discounts ?? {}).sort(
          ([a], [b]) => a.localeCompare(b)
        )
        const badge = (
          <StatusBadge
            label={t('{{total}} models', { total: entries.length })}
            variant={entries.length > 0 ? 'info' : 'danger'}
            copyable={false}
          />
        )
        if (entries.length === 0) {
          // 空授权是个陷阱（成员一个模型都调不通），单独标红而不是隐藏。
          return badge
        }
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger render={<span />}>{badge}</TooltipTrigger>
              <TooltipContent side='top' className='max-w-xs'>
                <ul className='space-y-0.5'>
                  {entries.map(([model, floor]) => (
                    <li key={model} className='flex items-center gap-2'>
                      <span className='font-mono'>{model}</span>
                      {/* “≥ 80%” is the same glyph sequence in every supported
                          language, so it is rendered directly rather than going
                          through t() — a translation key here would produce
                          seven identical values that the sync script flags as
                          untranslated. */}
                      <span className='text-background/70 ml-auto font-mono tabular-nums'>
                        {'≥ '}
                        {formatModelDiscount(floor, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      },
      size: 180,
    },
    {
      accessorKey: 'invite_count',
      header: t('Invite Codes'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='tabular-nums'>{row.original.invite_count ?? 0}</span>
      ),
      size: 110,
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) =>
        row.original.status === AGENT_STATUS.ENABLED ? (
          <StatusBadge
            label={t('Enabled')}
            variant='success'
            copyable={false}
          />
        ) : (
          <StatusBadge
            label={t('Disabled')}
            variant='neutral'
            copyable={false}
          />
        ),
      size: 110,
    },
    {
      accessorKey: 'remark',
      header: t('Remark'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='text-muted-foreground max-w-[200px] truncate text-xs'>
          {row.original.remark || '-'}
        </span>
      ),
      size: 200,
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const agent = row.original
        const enabled = agent.status === AGENT_STATUS.ENABLED
        return (
          <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
            <DropdownMenuItem onClick={() => actions.onEdit(agent)}>
              {t('Edit')}
              <Pencil size={16} />
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => actions.onToggleStatus(agent)}>
              {enabled ? t('Disable') : t('Enable')}
              <Power size={16} />
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => actions.onDelete(agent)}
              className='text-destructive focus:text-destructive'
            >
              {t('Delete')}
              <Trash2 size={16} />
            </DropdownMenuItem>
          </DataTableRowActionMenu>
        )
      },
      enableSorting: false,
      enableHiding: false,
      meta: { align: 'right' },
      size: 90,
    },
  ]
}
