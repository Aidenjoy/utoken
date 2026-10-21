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
import { Handshake } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { listAgents } from '@/features/agents/api'
import { AGENT_STATUS } from '@/features/agents/types'

import { adminBindUserAgent } from '../../api'
import type { User } from '../../types'

interface UserAgentBindDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: Pick<
    User,
    'id' | 'username' | 'display_name' | 'agent_id' | 'agent_username'
  > | null
  onSuccess?: () => void
}

// 代理商可能较多，一次取足够大的页把启用中的代理商全列进下拉；绑定是低频管理操作，
// 不做分页搜索。若某站点代理商数超过该上限，当前绑定项仍会以只读兜底项回显。
const AGENT_LIST_PAGE_SIZE = 200

/**
 * Admin-side reseller binding for an existing user. Binding mirrors registering
 * with the reseller's invite code: the user becomes the reseller's member, is
 * confined to the reseller's authorized models, and receives the per-model
 * discounts the reseller configures. Selecting "No agent" unbinds (agent_id 0),
 * restoring full model access at original price.
 */
export function UserAgentBindDialog({
  open,
  onOpenChange,
  user,
  onSuccess,
}: UserAgentBindDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState('0')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const agents = useQuery({
    queryKey: ['agents', 'bind-picker'],
    queryFn: () => listAgents({ page_size: AGENT_LIST_PAGE_SIZE }),
    enabled: open,
    staleTime: 60 * 1000,
  })

  const currentAgentId = user?.agent_id ?? 0

  useEffect(() => {
    if (!open) return
    setSelected(String(currentAgentId))
  }, [open, currentAgentId])

  const agentOptions = useMemo(() => {
    const items = agents.data?.data?.items ?? []
    const options = items
      .filter((agent) => agent.status === AGENT_STATUS.ENABLED)
      .sort((a, b) => (a.username ?? '').localeCompare(b.username ?? ''))
      .map((agent) => {
        const username = agent.username ?? ''
        const label =
          agent.display_name && agent.display_name !== username
            ? `${username} · ${agent.display_name}`
            : username
        return { value: String(agent.id), label }
      })
    // 当前绑定的代理商若已禁用或不在启用列表内，补一个只读兜底项，避免下拉回显空值。
    if (
      currentAgentId > 0 &&
      !options.some((option) => option.value === String(currentAgentId))
    ) {
      const fallback = user?.agent_username
        ? `${user.agent_username} (${t('Disabled')})`
        : t('Disabled')
      options.unshift({ value: String(currentAgentId), label: fallback })
    }
    return [
      { value: '0', label: t('No agent (original price, all models)') },
      ...options,
    ]
  }, [agents.data, currentAgentId, user?.agent_username, t])

  const submit = async () => {
    if (!user) return
    setIsSubmitting(true)
    try {
      const result = await adminBindUserAgent(user.id, Number(selected))
      if (!result.success) {
        toast.error(result.message || t('Failed to bind agent'))
        return
      }
      toast.success(t('Agent binding updated'))
      onOpenChange(false)
      void queryClient.invalidateQueries({ queryKey: ['users'] })
      onSuccess?.()
    } catch (e: unknown) {
      toast.error(
        e instanceof Error ? e.message : t('Failed to bind agent')
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-[480px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Handshake className='h-5 w-5' />
            {t('Bind Agent')}
          </DialogTitle>
          <DialogDescription>
            {t('User: {{name}}', {
              name: user?.display_name || user?.username || '',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-3'>
          <p className='text-muted-foreground text-xs'>
            {t(
              'Binding makes this user a member of the reseller, just like registering with the reseller\'s invite code: they can only call the reseller\'s authorized models and get the per-model discounts the reseller sets. Choose "No agent" to unbind and restore full model access.'
            )}
          </p>

          <div className='space-y-1.5'>
            <div className='text-sm font-medium'>{t('Agent')}</div>
            <Combobox
              options={agentOptions}
              value={selected}
              onValueChange={(value) => setSelected(value ?? '0')}
              placeholder={t('Select an agent')}
              searchPlaceholder={t('Search agents')}
              emptyText={t('No matching agent')}
            />
          </div>

          <div className='text-muted-foreground text-xs'>
            {currentAgentId > 0
              ? t('Currently bound to: {{name}}', {
                  name: user?.agent_username || `#${currentAgentId}`,
                })
              : t('Currently not bound to any agent.')}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant='outline'
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            disabled={isSubmitting || agents.isLoading}
            onClick={() => void submit()}
          >
            {isSubmitting ? t('Saving...') : t('Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
