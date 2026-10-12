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
import { Pencil, Power, Trash2 } from 'lucide-react'
import type { TFunction } from 'i18next'

import { DataTableRowActionMenu } from '@/components/data-table/core/row-action-menu'
import { LongText } from '@/components/long-text'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { formatDiscount } from '@/lib/discount'

import { AGENT_STATUS, type Agent } from '../types'

export type AgentActions = {
  onEdit: (agent: Agent) => void
  onToggleStatus: (agent: Agent) => void
  onDelete: (agent: Agent) => void
}

/**
 * Columns for the reseller (agent) management list. The discount range shows
 * the deepest allowed discount first (min multiplier) then the shallowest
 * (max multiplier); a max of 1.0 renders as "No discount".
 */
export function useAgentColumns(
  actions: AgentActions,
  t: TFunction,
  language: string | undefined
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
      id: 'discount_range',
      accessorKey: 'min_discount',
      header: t('Discount Range'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const min = row.original.min_discount
        const max = row.original.max_discount
        return (
          <StatusBadge
            label={`${formatDiscount(min, language, t)} – ${formatDiscount(
              max,
              language,
              t
            )}`}
            variant='info'
            copyable={false}
          />
        )
      },
      size: 180,
    },
    {
      accessorKey: 'code_count',
      header: t('Codes'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='tabular-nums'>{row.original.code_count ?? 0}</span>
      ),
      size: 90,
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) =>
        row.original.status === AGENT_STATUS.ENABLED ? (
          <StatusBadge label={t('Enabled')} variant='success' copyable={false} />
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
            <DropdownMenuItem
              onClick={() => actions.onToggleStatus(agent)}
            >
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
