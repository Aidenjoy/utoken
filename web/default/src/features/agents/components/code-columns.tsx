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
import { Link2, Pencil, Power } from 'lucide-react'
import { toast } from 'sonner'

import { DataTableRowActionMenu } from '@/components/data-table/core/row-action-menu'
import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { formatTimestampToDate } from '@/lib/format'

import { INVITE_CODE_STATUS, OWNER_TYPE, type InviteCode } from '../types'

export type CodeActions = {
  onEdit: (code: InviteCode) => void
  onToggleStatus: (code: InviteCode) => void
}

/**
 * Columns for the invite code list. A code carries no discount of its own — it
 * only binds whoever registers with it to the code's owner, which is what puts
 * that user inside the owner agent's model allowlist. `max_uses` of 0 means
 * unlimited; used count therefore doubles as the number of members recruited.
 * Owner is only meaningful in the admin view, which lists every code at once.
 */
export function useCodeColumns(
  actions: CodeActions,
  t: TFunction,
  options: { showOwner?: boolean } = {}
): ColumnDef<InviteCode>[] {
  const { showOwner = false } = options
  const columns: ColumnDef<InviteCode>[] = [
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
      accessorKey: 'code',
      header: t('Code'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <StatusBadge label={row.original.code} variant='purple' copyable />
      ),
      size: 140,
    },
    {
      id: 'usage',
      accessorKey: 'used_count',
      header: t('Used / Limit'),
      meta: { mobileHidden: true },
      cell: ({ row }) => {
        const { used_count: used, max_uses: max } = row.original
        return (
          <span className='text-sm tabular-nums'>
            {used} / {max > 0 ? max : t('Unlimited')}
          </span>
        )
      },
      size: 120,
    },
    {
      accessorKey: 'expires_at',
      header: t('Expires'),
      meta: { mobileHidden: true },
      cell: ({ row }) => {
        const expires = row.original.expires_at
        return (
          <span className='text-muted-foreground text-xs'>
            {expires > 0 ? formatTimestampToDate(expires) : t('Never')}
          </span>
        )
      },
      size: 150,
    },
    {
      accessorKey: 'status',
      header: t('Status'),
      meta: { mobileBadge: true },
      cell: ({ row }) =>
        row.original.status === INVITE_CODE_STATUS.ENABLED ? (
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
  ]

  if (showOwner) {
    columns.push({
      id: 'owner',
      accessorKey: 'owner_type',
      header: t('Owner'),
      meta: { mobileHidden: true },
      cell: ({ row }) => {
        const { owner_type: ownerType, owner_username: ownerUsername } =
          row.original
        const label =
          ownerType === OWNER_TYPE.ADMIN
            ? t('Admin')
            : ownerUsername || t('Agent')
        return <StatusBadge label={label} variant='neutral' copyable={false} />
      },
      size: 140,
    })
  }

  columns.push({
    accessorKey: 'remark',
    header: t('Remark'),
    meta: { mobileHidden: true },
    cell: ({ row }) => (
      <span className='text-muted-foreground max-w-[180px] truncate text-xs'>
        {row.original.remark || '-'}
      </span>
    ),
    size: 180,
  })

  columns.push({
    id: 'actions',
    cell: ({ row }) => {
      const code = row.original
      const enabled = code.status === INVITE_CODE_STATUS.ENABLED
      return (
        <DataTableRowActionMenu ariaLabel={t('Open menu')} modal={false}>
          <DropdownMenuItem
            onClick={() => {
              const url = `${window.location.origin}/sign-up?invite=${code.code}`
              navigator.clipboard
                .writeText(url)
                .then(() => toast.success(t('Invite link copied')))
                .catch(() => toast.error(t('Failed to copy')))
            }}
          >
            {t('Copy invite link')}
            <Link2 size={16} />
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.onEdit(code)}>
            {t('Edit')}
            <Pencil size={16} />
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.onToggleStatus(code)}>
            {enabled ? t('Disable') : t('Enable')}
            <Power size={16} />
          </DropdownMenuItem>
        </DataTableRowActionMenu>
      )
    },
    enableSorting: false,
    enableHiding: false,
    meta: { align: 'right' },
    size: 90,
  })

  return columns
}
