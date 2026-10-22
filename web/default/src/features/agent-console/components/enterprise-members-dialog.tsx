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
import { useEffect, useState } from 'react'
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
import { listMyEnterpriseMembers } from '@/features/agents/api'
import type {
  AgentOrganization,
  AgentOrganizationMember,
} from '@/features/agents/types'
import { ORG_ROLE } from '@/features/organization/types'
import { formatQuota } from '@/lib/format'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  enterprise: AgentOrganization | null
}

const PAGE_SIZE = 20

/**
 * Read-only roster of an enterprise's members. The agent develops the
 * enterprise but does not manage its membership — members join through the
 * enterprise admin, and their discounts and attribution follow the enterprise.
 * This dialog is therefore a viewer, paginated against the server, never an
 * editor.
 */
export function EnterpriseMembersDialog({
  open,
  onOpenChange,
  enterprise,
}: Props) {
  const { t } = useTranslation()
  const [pageIndex, setPageIndex] = useState(0)

  const orgId = enterprise?.id ?? 0

  useEffect(() => {
    if (open) setPageIndex(0)
  }, [open, orgId])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['agent-enterprise-members', orgId, pageIndex],
    queryFn: async () => {
      const result = await listMyEnterpriseMembers(orgId, {
        p: pageIndex + 1,
        page_size: PAGE_SIZE,
      })
      if (!result.success) {
        toast.error(result.message || t('Failed to load members'))
        return { items: [] as AgentOrganizationMember[], total: 0 }
      }
      return {
        items: result.data?.items ?? [],
        total: result.data?.total ?? 0,
      }
    },
    enabled: open && orgId > 0,
    placeholderData: (previous) => previous,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[560px]'>
        <DialogHeader>
          <DialogTitle>{t('Enterprise Members')}</DialogTitle>
          <DialogDescription>
            {t('Enterprise: {{name}}', {
              name: enterprise?.display_name || enterprise?.name || '',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <div className='text-muted-foreground text-xs'>
            {t(
              'Members follow the enterprise. Their discounts and attribution are set at the enterprise level.'
            )}
          </div>

          {isLoading && items.length === 0 ? (
            <div className='text-muted-foreground py-8 text-center text-sm'>
              {t('Loading...')}
            </div>
          ) : items.length === 0 ? (
            <div className='border-border/60 bg-muted/20 text-muted-foreground rounded-md border border-dashed py-8 text-center text-sm'>
              {t('No Members Found')}
            </div>
          ) : (
            <div className='max-h-[360px] space-y-1 overflow-y-auto pr-1'>
              {items.map((member) => {
                const isAdmin = member.org_role === ORG_ROLE.ADMIN
                return (
                  <div
                    key={member.id}
                    className='border-border/50 flex items-center gap-3 border-b py-2 last:border-b-0'
                  >
                    <div className='min-w-0 flex-1'>
                      <div className='truncate font-medium'>
                        {member.display_name || member.username}
                      </div>
                      <div className='text-muted-foreground truncate text-xs'>
                        {member.username}
                        {member.sub_user ? ` · ${t('Sub-account')}` : ''}
                      </div>
                    </div>
                    <StatusBadge
                      label={isAdmin ? t('Organization Admin') : t('Member')}
                      variant={isAdmin ? 'blue' : 'neutral'}
                      copyable={false}
                    />
                    <span className='font-mono text-xs tabular-nums'>
                      {formatQuota(member.user_quota ?? 0)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {total > PAGE_SIZE ? (
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground text-xs'>
                {t('{{count}} members', { count: total })}
              </span>
              <div className='flex items-center gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={pageIndex === 0 || isFetching}
                  onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
                >
                  {t('Previous')}
                </Button>
                <span className='text-muted-foreground text-xs tabular-nums'>
                  {pageIndex + 1} / {pageCount}
                </span>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={pageIndex + 1 >= pageCount || isFetching}
                  onClick={() => setPageIndex((p) => p + 1)}
                >
                  {t('Next')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
