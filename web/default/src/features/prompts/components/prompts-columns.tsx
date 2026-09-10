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
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { TableId } from '@/components/table-id'
import { Badge } from '@/components/ui/badge'

import { PROMPT_VISIBILITIES } from '../constants'
import { parsePromptTags } from '../lib'
import type { PromptTemplate } from '../types'
import { DataTableRowActions } from './data-table-row-actions'

export function usePromptsColumns(): ColumnDef<PromptTemplate>[] {
  const { t } = useTranslation()
  return [
    {
      accessorKey: 'id',
      header: t('ID'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <TableId value={row.getValue('id') as number} className='w-[60px]' />
      ),
      size: 80,
    },
    {
      accessorKey: 'title',
      header: t('Title'),
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <span className='max-w-[280px] truncate font-medium'>
          {row.getValue('title')}
        </span>
      ),
      size: 220,
    },
    {
      accessorKey: 'description',
      header: t('Description'),
      meta: { mobileHidden: true },
      cell: ({ row }) => {
        const description = row.getValue('description') as string
        if (!description) {
          return <span className='text-muted-foreground'>-</span>
        }
        return (
          <span className='text-muted-foreground line-clamp-2 max-w-[320px]'>
            {description}
          </span>
        )
      },
      size: 260,
    },
    {
      accessorKey: 'tags',
      header: t('Tags'),
      meta: { mobileHidden: true },
      cell: ({ row }) => {
        const tags = parsePromptTags(row.getValue('tags') as string)
        if (tags.length === 0) {
          return <span className='text-muted-foreground'>-</span>
        }
        return (
          <div className='flex flex-wrap gap-1'>
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
        )
      },
      size: 200,
    },
    {
      accessorKey: 'visibility',
      header: t('Visibility'),
      meta: { mobileBadge: true },
      cell: ({ row }) => {
        const config = PROMPT_VISIBILITIES[row.getValue('visibility') as string]
        if (!config) return null
        return (
          <StatusBadge
            label={t(config.labelKey)}
            variant={config.variant}
            copyable={false}
            className='-ml-1.5'
          />
        )
      },
      size: 120,
    },
    {
      accessorKey: 'use_count',
      header: t('Uses'),
      meta: { mobileHidden: true },
      cell: ({ row }) => (
        <span className='text-muted-foreground tabular-nums'>
          {row.getValue('use_count')}
        </span>
      ),
      size: 90,
    },
    {
      // Scope is a server-side ownership dimension (mine / org-managed /
      // public) with no visual cell; the hidden column exists so the toolbar
      // scope filter can bind to a real column id.
      id: 'scope',
      header: t('Scope'),
      accessorFn: () => '',
      enableSorting: false,
      meta: { mobileHidden: true },
    },
    {
      id: 'actions',
      cell: ({ row }) => <DataTableRowActions row={row} />,
      enableSorting: false,
      enableHiding: false,
      meta: { align: 'right' },
      size: 90,
    },
  ]
}
