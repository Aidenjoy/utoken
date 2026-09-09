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
import { Ban, CircleCheck, Coins, Edit, Trash2, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DataTableRowActionMenu } from '@/components/data-table/core/row-action-menu'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { ORG_STATUSES } from '@/features/organization/constants'
import { ORG_STATUS, type Organization } from '@/features/organization/types'
import { formatQuota, formatTimestamp } from '@/lib/format'

export type OrganizationActions = {
  onEdit: (organization: Organization) => void
  onAdjustQuota: (organization: Organization) => void
  onToggleStatus: (organization: Organization) => void
  onViewMembers: (organization: Organization) => void
  onDelete: (organization: Organization) => void
}

/**
 * Columns for the system-administrator organization list. The pool balance and
 * its consumed amount share a cell because they are read together, and the
 * status cell doubles as the enable/disable affordance in the row menu.
 */
export function useOrganizationColumns(
  actions: OrganizationActions
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
      header: t('Organization Name'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <div className='flex flex-col'>
          <span className='max-w-[220px] truncate font-medium'>
            {row.original.display_name || row.original.name}
          </span>
          {row.original.display_name ? (
            <span className='text-muted-foreground max-w-[220px] truncate font-mono text-xs'>
              {row.original.name}
            </span>
          ) : null}
        </div>
      ),
      size: 220,
    },
    {
      accessorKey: 'group',
      header: t('Group'),
      meta: { mobileBadge: true },
      cell: ({ row }) => (
        <StatusBadge
          label={row.original.group}
          variant='neutral'
          copyable={false}
        />
      ),
      size: 120,
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const config = ORG_STATUSES[row.original.status]
        if (!config) return <span className='text-muted-foreground'>-</span>
        return (
          <StatusBadge
            label={t(config.labelKey)}
            variant={config.variant}
            copyable={false}
          />
        )
      },
      size: 110,
    },
    {
      accessorKey: 'quota',
      header: t('Pool Quota'),
      cell: ({ row }) => (
        <div className='flex flex-col text-xs'>
          <span className='tabular-nums'>
            {t('Balance:')} {formatQuota(row.original.quota)}
          </span>
          <span className='text-muted-foreground tabular-nums'>
            {t('Used:')} {formatQuota(row.original.used_quota)}
          </span>
        </div>
      ),
      size: 170,
    },
    {
      accessorKey: 'cache_enabled',
      header: t('Response Cache'),
      meta: { mobileHidden: true },
      cell: ({ row }) =>
        row.original.cache_enabled ? (
          <StatusBadge label={t('Enabled')} variant='green' copyable={false} />
        ) : (
          <span className='text-muted-foreground text-xs'>{t('Disabled')}</span>
        ),
      size: 130,
    },
    {
      accessorKey: 'created_at',
      header: t('Created At'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='text-muted-foreground text-xs'>
          {formatTimestamp(row.original.created_at)}
        </span>
      ),
      size: 170,
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const organization = row.original
        const isEnabled = organization.status === ORG_STATUS.ENABLED
        return (
          <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
            <DropdownMenuItem onClick={() => actions.onEdit(organization)}>
              {t('Edit')}
              <Edit size={16} />
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => actions.onAdjustQuota(organization)}
            >
              {t('Adjust Pool Quota')}
              <Coins size={16} />
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => actions.onViewMembers(organization)}
            >
              {t('View Members')}
              <Users size={16} />
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => actions.onToggleStatus(organization)}
            >
              {isEnabled ? t('Disable') : t('Enable')}
              {isEnabled ? <Ban size={16} /> : <CircleCheck size={16} />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => actions.onDelete(organization)}
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
