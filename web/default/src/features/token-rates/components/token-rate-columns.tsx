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
import { Eraser, Percent } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DataTableRowActionMenu } from '@/components/data-table/core/row-action-menu'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import type { User } from '@/features/users/types'

export type TokenRateActions = {
  onSetRate: (user: User) => void
  onClearRate: (user: User) => void
}

/**
 * Columns for the token-rate management list. The rate multiplies the tokens a
 * user consumes on seedance video tasks; 0 (unset) means the default 1.0x.
 */
export function useTokenRateColumns(
  actions: TokenRateActions
): ColumnDef<User>[] {
  const { t } = useTranslation()

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
      header: t('Username'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <div className='flex flex-col'>
          <span className='max-w-[220px] truncate font-medium'>
            {row.original.username}
          </span>
          {row.original.display_name ? (
            <span className='text-muted-foreground max-w-[220px] truncate text-xs'>
              {row.original.display_name}
            </span>
          ) : null}
        </div>
      ),
      size: 220,
    },
    {
      accessorKey: 'token_rate',
      header: t('Token Rate'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const rate = row.original.token_rate ?? 0
        if (rate > 0) {
          return (
            <StatusBadge label={`${rate}×`} variant='info' copyable={false} />
          )
        }
        return (
          <StatusBadge
            label={t('Default (1.0)')}
            variant='neutral'
            copyable={false}
          />
        )
      },
      size: 140,
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const user = row.original
        const hasRate = (user.token_rate ?? 0) > 0
        return (
          <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
            <DropdownMenuItem onClick={() => actions.onSetRate(user)}>
              {t('Set Rate')}
              <Percent size={16} />
            </DropdownMenuItem>
            {hasRate ? (
              <DropdownMenuItem onClick={() => actions.onClearRate(user)}>
                {t('Clear Rate')}
                <Eraser size={16} />
              </DropdownMenuItem>
            ) : null}
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
