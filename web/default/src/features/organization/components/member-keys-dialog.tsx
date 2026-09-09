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
import { API_KEY_STATUSES } from '@/features/keys/constants'
import { formatQuota, formatTimestamp } from '@/lib/format'

import { getOrgTokens } from '../api'
import { ORG_ERROR_MESSAGES } from '../constants'
import type { OrgMemberDetail } from '../types'

type Props = {
  open: boolean
  member: OrgMemberDetail | null
  onOpenChange: (open: boolean) => void
}

/**
 * Read-only view of one member's API keys. Keys stay owned by the member
 * (relay authentication is unchanged) and the plaintext key is never returned,
 * so this dialog can only show masked values and quota state.
 */
export function MemberKeysDialog({ open, member, onOpenChange }: Props) {
  const { t } = useTranslation()

  const { data, isLoading } = useQuery({
    queryKey: ['org-tokens', member?.user_id ?? 0],
    enabled: open && member !== null,
    queryFn: async () => {
      const result = await getOrgTokens({
        user_id: member?.user_id,
        p: 1,
        page_size: 100,
      })
      if (!result.success) {
        toast.error(result.message || t(ORG_ERROR_MESSAGES.LOAD_FAILED))
        return []
      }
      return result.data?.items ?? []
    },
  })

  const tokens = data ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[720px]'>
        <DialogHeader>
          <DialogTitle>{t('Member API Keys')}</DialogTitle>
          <DialogDescription>
            {t('Keys of {{username}}', { username: member?.username ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <div className='max-h-[60vh] overflow-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('Name')}</TableHead>
                <TableHead>{t('Key')}</TableHead>
                <TableHead>{t('Status')}</TableHead>
                <TableHead className='text-right'>{t('Remaining')}</TableHead>
                <TableHead className='text-right'>{t('Used')}</TableHead>
                <TableHead>{t('Last Used')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading || tokens.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className='text-muted-foreground py-10 text-center'
                  >
                    {isLoading ? t('Loading...') : t('No API Keys Found')}
                  </TableCell>
                </TableRow>
              ) : (
                tokens.map((token) => {
                  const statusConfig = API_KEY_STATUSES[token.status]
                  return (
                    <TableRow key={token.id}>
                      <TableCell className='max-w-[160px] truncate font-medium'>
                        {token.name}
                      </TableCell>
                      <TableCell className='max-w-[160px] truncate font-mono text-xs'>
                        {token.key}
                      </TableCell>
                      <TableCell>
                        {statusConfig ? (
                          <StatusBadge
                            label={t(statusConfig.label)}
                            variant={statusConfig.variant}
                            copyable={false}
                          />
                        ) : (
                          <span className='text-muted-foreground'>-</span>
                        )}
                      </TableCell>
                      <TableCell className='text-right text-xs tabular-nums'>
                        {token.unlimited_quota
                          ? t('Unlimited')
                          : formatQuota(token.remain_quota)}
                      </TableCell>
                      <TableCell className='text-right text-xs tabular-nums'>
                        {formatQuota(token.used_quota)}
                      </TableCell>
                      <TableCell className='text-muted-foreground text-xs'>
                        {token.accessed_time > 0
                          ? formatTimestamp(token.accessed_time)
                          : t('Never used')}
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
