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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  createEnterpriseMember,
  listMyEnterpriseMembers,
  removeEnterpriseMember,
  updateEnterpriseMember,
} from '@/features/agents/api'
import type {
  AgentOrganization,
  AgentOrganizationMember,
} from '@/features/agents/types'
import {
  MemberMutateDrawer,
  type MemberDrawerApi,
  type MemberDrawerMode,
} from '@/features/organization/components/member-mutate-drawer'
import {
  ORG_ERROR_MESSAGES,
  ORG_MEMBER_STATUSES,
  ORG_ROLES,
  ORG_SUCCESS_MESSAGES,
} from '@/features/organization/constants'
import { formatQuota, formatTimestamp } from '@/lib/format'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  enterprise: AgentOrganization | null
}

type DrawerState = {
  mode: MemberDrawerMode
  member: AgentOrganizationMember | null
}

/**
 * Member management for an enterprise this agent owns. The agent develops the
 * enterprise and, like a system administrator acting on behalf of an org, may
 * create sub-accounts, adjust role/sub-quota/status and remove members. Adding
 * an existing user is not offered: pulling one into an enterprise overwrites
 * its attribution and discounts, which only the enterprise's own admin or a
 * system administrator may do. Writes go through the agent-scoped enterprise
 * endpoints; the server enforces that the enterprise belongs to the calling
 * agent. Members still follow the enterprise for discounts and attribution.
 */
export function EnterpriseMembersDialog({
  open,
  onOpenChange,
  enterprise,
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
  const [pendingRemoval, setPendingRemoval] =
    useState<AgentOrganizationMember | null>(null)
  const [isRemoving, setIsRemoving] = useState(false)

  const orgId = enterprise?.id ?? 0

  const openDrawer = (state: DrawerState) => {
    setDrawerState(state)
    setDrawerOpen(true)
  }

  const refreshMembers = () => {
    void queryClient.invalidateQueries({
      queryKey: ['agent-enterprise-members', orgId],
    })
  }

  // 代理商走企业维度的成员端点，注入给共享抽屉；不注入 invite（代理商只能建号），
  // 额度池余量未知（后端仍强制校验）。
  const drawerApi: MemberDrawerApi = {
    create: (data) => createEnterpriseMember(orgId, data),
    update: (memberId, data) => updateEnterpriseMember(orgId, memberId, data),
  }

  const confirmRemove = async () => {
    if (!pendingRemoval) return
    setIsRemoving(true)
    try {
      const result = await removeEnterpriseMember(orgId, pendingRemoval.id)
      if (!result.success) {
        toast.error(
          result.message || t(ORG_ERROR_MESSAGES.MEMBER_REMOVE_FAILED)
        )
        return
      }
      toast.success(t(ORG_SUCCESS_MESSAGES.MEMBER_REMOVED))
      setPendingRemoval(null)
      refreshMembers()
    } finally {
      setIsRemoving(false)
    }
  }

  const { data, isLoading } = useQuery({
    queryKey: ['agent-enterprise-members', orgId],
    enabled: open && orgId > 0,
    queryFn: async () => {
      const result = await listMyEnterpriseMembers(orgId, {
        p: 1,
        page_size: 1000,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load members'))
        return []
      }
      return result.data?.items ?? []
    },
  })

  const members = data ?? []

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='sm:max-w-[760px]'>
          <DialogHeader>
            <DialogTitle>{t('Enterprise Members')}</DialogTitle>
            <DialogDescription>
              {t('Enterprise: {{name}}', {
                name: enterprise?.display_name || enterprise?.name || '',
              })}
            </DialogDescription>
          </DialogHeader>

          <div className='text-muted-foreground text-xs'>
            {t(
              'Members follow the enterprise. Their discounts and attribution are set at the enterprise level.'
            )}
          </div>

          <div className='flex items-center justify-end'>
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
                              {member.display_name ||
                                member.username ||
                                `#${member.user_id}`}
                            </span>
                            <span className='text-muted-foreground max-w-[180px] truncate text-xs'>
                              {member.username}
                              {member.sub_user ? ` · ${t('Sub-account')}` : ''}
                            </span>
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
                          {formatTimestamp(member.joined_at ?? 0)}
                        </TableCell>
                        <TableCell className='text-right'>
                          <div className='flex items-center justify-end gap-1'>
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() =>
                                openDrawer({ mode: 'edit', member })
                              }
                            >
                              {t('Edit')}
                            </Button>
                            <Button
                              variant='ghost'
                              size='sm'
                              className='text-destructive hover:text-destructive'
                              onClick={() => setPendingRemoval(member)}
                            >
                              {t('Remove from Organization')}
                            </Button>
                          </div>
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
            api={drawerApi}
            quotaHeadroom={null}
            onRefresh={refreshMembers}
            onOpenChange={(value) => {
              if (!value) setDrawerOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(value) => {
          if (!value) setPendingRemoval(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Remove Member')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Remove {{username}} from this organization? The account, its keys and its history are kept; it simply stops consuming the shared pool.',
                { username: pendingRemoval?.username ?? '' }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isRemoving}
              onClick={(event) => {
                event.preventDefault()
                void confirmRemove()
              }}
            >
              {isRemoving ? t('Removing...') : t('Remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
