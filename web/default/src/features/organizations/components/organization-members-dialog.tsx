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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
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
import type {
  Organization,
  OrgMemberDetail,
} from '@/features/organization/types'
import { formatQuota, formatTimestamp } from '@/lib/format'

import {
  MemberMutateDrawer,
  type MemberDrawerMode,
} from '@/features/organization/components/member-mutate-drawer'

import { getAdminOrganizationMembers } from '../api'
import { ORG_ADMIN_ERROR_MESSAGES } from '../constants'

type Props = {
  open: boolean
  organization: Organization | null
  onOpenChange: (open: boolean) => void
}

type DrawerState = {
  mode: MemberDrawerMode
  member: OrgMemberDetail | null
}

/**
 * Member list for a system administrator. Reading is always allowed; adding
 * and editing members are offered too because an organization created without
 * an admin (or whose admin appointment failed) would otherwise have nobody who
 * can ever populate or promote it. Writes go through the organization-scoped
 * endpoints with an explicit `org_id`, i.e. the administrator acts on behalf of
 * that org.
 */
export function OrganizationMembersDialog({
  open,
  organization,
  onOpenChange,
}: Props) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  // 抽屉内容与开关分离：关闭动画期间仍渲染最后一次的状态，
  // 避免退出动画里表单回退成“创建成员”。
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerState, setDrawerState] = useState<DrawerState>({
    mode: 'create',
    member: null,
  })

  const openDrawer = (state: DrawerState) => {
    setDrawerState(state)
    setDrawerOpen(true)
  }

  const refreshMembers = () => {
    void queryClient.invalidateQueries({
      queryKey: ['admin-organization-members', organization?.id ?? 0],
    })
    void queryClient.invalidateQueries({ queryKey: ['admin-organizations'] })
  }

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
        <div className='flex items-center justify-end gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => openDrawer({ mode: 'invite', member: null })}
          >
            {t('Add Existing User')}
          </Button>
          <Button
            size='sm'
            onClick={() => openDrawer({ mode: 'create', member: null })}
          >
            {t('Create Member')}
          </Button>
        </div>
        <div className='max-h-[60vh] overflow-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Username')}</TableHead>
                <TableHead>{t('Organization Role')}</TableHead>
                <TableHead className='text-right'>{t('Sub-quota')}</TableHead>
                <TableHead>{t('Status')}</TableHead>
                <TableHead>{t('Joined At')}</TableHead>
                <TableHead className='text-right'>{t('Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading || members.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
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
                      <TableCell className='text-right'>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => openDrawer({ mode: 'edit', member })}
                        >
                          {t('Edit')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
        <MemberMutateDrawer
          open={drawerOpen}
          mode={drawerState.mode}
          member={drawerState.member}
          orgId={organization?.id}
          onRefresh={refreshMembers}
          onOpenChange={(value) => {
            if (!value) setDrawerOpen(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
