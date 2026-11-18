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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  const [videoModel, setVideoModel] = useState(props.grant.models[0] ?? '')
  const video = props.grant.unit === 'completed_videos'
  const queryClient = useQueryClient()
  const create = useMutation({
    mutationFn: async () => {
      let keyType: 'video' | 'image' | 'language' = 'language'
      if (video) keyType = 'video'
      else if (
        props.grant.unit === 'images' ||
        props.grant.profile === 'gemini_native_bounded_image_v1'
      ) {
        keyType = 'image'
      }
      const result = await createApiKey({
        name: name.trim(),
        user_subscription_id: props.grant.user_subscription_id,
        channel_id: props.grant.channel_id,
        key_type: keyType,
        video_model: video ? videoModel : '',
        expired_time: -1,
        remain_quota: 0,
        unlimited_quota: true,
        model_limits_enabled: true,
        model_limits: video ? videoModel : props.grant.models.join(','),
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
        {video && (
          <div className='space-y-2'>
            <Label>{t('Model')}</Label>
            <Select
              value={videoModel}
              onValueChange={(value) => {
                if (value) setVideoModel(value)
              }}
              items={props.grant.models.map((model) => ({
                value: model,
                label: model,
              }))}
            >
              <SelectTrigger aria-label={t('Model')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {props.grant.models.map((model) => (
                    <SelectItem key={model} value={model}>
                      {model}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}
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
