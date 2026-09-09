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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ORG_MEMBER_STATUSES,
  ORG_ROLES,
} from '@/features/organization/constants'
import type { Organization } from '@/features/organization/types'
import { formatQuota, formatTimestamp } from '@/lib/format'

import { getAdminOrganizationMembers } from '../api'
import { ORG_ADMIN_ERROR_MESSAGES } from '../constants'

type Props = {
  open: boolean
  organization: Organization | null
  onOpenChange: (open: boolean) => void
}

/**
 * Read-only member list for a system administrator. Member management belongs
 * to the organization admin, so this dialog never offers edits — an
 * administrator acting on behalf of an organization does it as that
 * organization's own admin.
 */
export function OrganizationMembersDialog({
  open,
  organization,
  onOpenChange,
}: Props) {
  const { t } = useTranslation()

  const { data, isLoading } = useQuery({
    queryKey: ['admin-organization-members', organization?.id ?? 0],
    enabled: open && organization !== null,
    queryFn: async () => {
      const result = await getAdminOrganizationMembers(organization?.id ?? 0, {
        p: 1,
        page_size: 1000,
      })
      if (!result.success) {
        toast.error(
          result.message || t(ORG_ADMIN_ERROR_MESSAGES.MEMBERS_FAILED)
        )
        return []
      }
      return result.data?.items ?? []
    },
  })

  const members = data ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[760px]'>
        <DialogHeader>
          <DialogTitle>{t('Organization Members')}</DialogTitle>
          <DialogDescription>
            {t('Organization: {{name}}', {
              name: organization?.display_name || organization?.name || '',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className='max-h-[60vh] overflow-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Username')}</TableHead>
                <TableHead>{t('Organization Role')}</TableHead>
                <TableHead className='text-right'>{t('Sub-quota')}</TableHead>
                <TableHead>{t('Status')}</TableHead>
                <TableHead>{t('Joined At')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading || members.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className='text-muted-foreground py-10 text-center'
                  >
                    {isLoading ? t('Loading...') : t('No Members Found')}
                  </TableCell>
                </TableRow>
              ) : (
                members.map((member) => {
                  const roleConfig = ORG_ROLES[member.org_role]
                  const statusConfig = ORG_MEMBER_STATUSES[member.status]
                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className='flex flex-col'>
                          <span className='max-w-[180px] truncate font-medium'>
                            {member.username || `#${member.user_id}`}
                          </span>
                          {member.email ? (
                            <span className='text-muted-foreground max-w-[180px] truncate text-xs'>
                              {member.email}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        {roleConfig ? (
                          <StatusBadge
                            label={t(roleConfig.labelKey)}
                            variant={roleConfig.variant}
                            copyable={false}
                          />
                        ) : (
                          <span className='text-muted-foreground'>-</span>
                        )}
                      </TableCell>
                      <TableCell className='text-right text-xs tabular-nums'>
                        {member.quota_limit > 0
                          ? `${formatQuota(member.quota_used)} / ${formatQuota(member.quota_limit)}`
                          : `${t('Unlimited')} · ${formatQuota(member.quota_used)}`}
                      </TableCell>
                      <TableCell>
                        {statusConfig ? (
                          <StatusBadge
                            label={t(statusConfig.labelKey)}
                            variant={statusConfig.variant}
                            copyable={false}
                          />
                        ) : (
                          <span className='text-muted-foreground'>-</span>
                        )}
                      </TableCell>
                      <TableCell className='text-muted-foreground text-xs'>
                        {formatTimestamp(member.joined_at)}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
