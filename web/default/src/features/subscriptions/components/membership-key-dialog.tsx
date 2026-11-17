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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createApiKey } from '@/features/keys/api'
import { handleServerError } from '@/lib/handle-server-error'

import type { ChannelQuota } from '../types'

/** Creates a channel-bound key through the existing Key management API. */
export function MembershipKeyDialog(props: {
  grant: ChannelQuota
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: async () => {
      const result = await createApiKey({
        name: name.trim(),
        user_subscription_id: props.grant.user_subscription_id,
        channel_id: props.grant.channel_id,
        key_type: props.grant.unit === 'images' ? 'image' : 'language',
        expired_time: -1,
        remain_quota: 0,
        unlimited_quota: true,
        model_limits_enabled: true,
        model_limits: props.grant.models.join(','),
        allow_ips: '',
        group: '',
        cross_group_retry: false,
      })
      if (!result.success) throw new Error(result.message)
      return result
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      toast.success(t('Membership Key created. Manage it in Keys.'))
      props.onClose()
    },
    onError: handleServerError,
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) props.onClose()
      }}
      title={t('Create membership Key')}
      description={t('Channel membership never falls back to wallet balance.')}
      footer={
        <Button
          disabled={!name.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {t('Create')}
        </Button>
      }
    >
      <div className='space-y-3'>
        <p>
          {t('Channel {{id}}', { id: props.grant.channel_id })} ·{' '}
          {props.grant.models.join(', ')}
        </p>
        <Label htmlFor='membership-key-name'>{t('Name')}</Label>
        <Input
          id='membership-key-name'
          maxLength={50}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Link to='/keys' className='text-primary underline'>
          {t('Keys')}
        </Link>
      </div>
    </Dialog>
  )
}
