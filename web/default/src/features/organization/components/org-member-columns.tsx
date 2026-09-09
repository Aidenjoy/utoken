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
import { Edit, KeyRound, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DataTableRowActionMenu } from '@/components/data-table/core/row-action-menu'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { formatQuota, formatTimestamp } from '@/lib/format'

import { ORG_MEMBER_STATUSES, ORG_ROLES } from '../constants'
import type { OrgMemberDetail } from '../types'

type MemberActions = {
  onEdit: (member: OrgMemberDetail) => void
  onViewKeys: (member: OrgMemberDetail) => void
  onRemove: (member: OrgMemberDetail) => void
}

/**
 * Columns for the organization member table.
 *
 * `quota_limit` of 0 means unlimited (mirrors `OrgMember.RemainQuota` returning
 * -1), so it renders as text instead of a `0` that would read as "exhausted".
 */
export function useOrgMemberColumns(
  actions: MemberActions
): ColumnDef<OrgMemberDetail>[] {
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
          <span className='max-w-[200px] truncate font-medium'>
            {row.original.username}
          </span>
          {row.original.display_name &&
          row.original.display_name !== row.original.username ? (
            <span className='text-muted-foreground max-w-[200px] truncate text-xs'>
              {row.original.display_name}
            </span>
          ) : null}
        </div>
      ),
      size: 200,
    },
    {
      accessorKey: 'org_role',
      header: t('Organization Role'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const config = ORG_ROLES[row.original.org_role]
        if (!config) return <span className='text-muted-foreground'>-</span>
        return (
          <StatusBadge
            label={t(config.labelKey)}
            variant={config.variant}
            copyable={false}
          />
        )
      },
      size: 140,
    },
    {
      accessorKey: 'quota_limit',
      header: t('Sub-quota'),
      meta: { mobileHidden: true },
      cell: ({ row }) => {
        const { quota_limit: limit, quota_used: used } = row.original
        if (limit <= 0) {
          return (
            <span className='text-muted-foreground text-xs'>
              {t('Unlimited')} · {t('Used:')} {formatQuota(used)}
            </span>
          )
        }
        return (
          <div className='flex flex-col text-xs'>
            <span className='tabular-nums'>
              {t('Used:')} {formatQuota(used)}
            </span>
            <span className='text-muted-foreground tabular-nums'>
              {t('Total:')} {formatQuota(limit)}
            </span>
          </div>
        )
      },
      size: 180,
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const config = ORG_MEMBER_STATUSES[row.original.status]
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
      accessorKey: 'joined_at',
      header: t('Joined At'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='text-muted-foreground text-xs'>
          {formatTimestamp(row.original.joined_at)}
        </span>
      ),
      size: 170,
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
          <DropdownMenuItem onClick={() => actions.onEdit(row.original)}>
            {t('Edit')}
            <Edit size={16} />
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.onViewKeys(row.original)}>
            {t('View API Keys')}
            <KeyRound size={16} />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => actions.onRemove(row.original)}
            className='text-destructive focus:text-destructive'
          >
            {t('Remove from Organization')}
            <Trash2 size={16} />
          </DropdownMenuItem>
        </DataTableRowActionMenu>
      ),
      enableSorting: false,
      enableHiding: false,
      meta: { align: 'right' },
      size: 90,
    },
  ]
}
