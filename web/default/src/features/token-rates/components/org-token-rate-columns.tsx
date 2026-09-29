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
import type { Organization } from '@/features/organization/types'

export type OrgTokenRateActions = {
  onSetRate: (org: Organization) => void
  onClearRate: (org: Organization) => void
}

/**
 * Columns for the enterprise token-rate list. The rate multiplies the tokens
 * every member consumes on seedance video tasks; 0 (unset) means 1.0x.
 */
export function useOrgTokenRateColumns(
  actions: OrgTokenRateActions
): ColumnDef<Organization>[] {
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
      accessorKey: 'name',
      header: t('Name'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <div className='flex flex-col'>
          <span className='max-w-[260px] truncate font-medium'>
            {row.original.name}
          </span>
          {row.original.display_name &&
          row.original.display_name !== row.original.name ? (
            <span className='text-muted-foreground max-w-[260px] truncate text-xs'>
              {row.original.display_name}
            </span>
          ) : null}
        </div>
      ),
      size: 260,
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
        const org = row.original
        const hasRate = (org.token_rate ?? 0) > 0
        return (
          <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
            <DropdownMenuItem onClick={() => actions.onSetRate(org)}>
              {t('Set Rate')}
              <Percent size={16} />
            </DropdownMenuItem>
            {hasRate ? (
              <DropdownMenuItem onClick={() => actions.onClearRate(org)}>
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
