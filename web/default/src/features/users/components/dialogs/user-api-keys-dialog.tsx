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
import { KeySquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ApiKeys } from '@/features/keys'

import type { User } from '../../types'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: Pick<User, 'id' | 'username'> | null
}

// 直接复用常规 API 密钥页，创建、AK/SK、绑定渠道及后续新增能力自动保持一致。
export function UserApiKeysDialog(props: Props) {
  const { t } = useTranslation()

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={
        <>
          <KeySquare className='h-5 w-5' />
          {t('API Keys')}
        </>
      }
      description={
        props.user ? `${t('Owner')}: ${props.user.username}` : undefined
      }
      contentClassName='flex max-h-[92vh] max-w-[calc(100%-2rem)] flex-col sm:max-w-[96vw] xl:max-w-[1500px]'
      titleClassName='flex items-center gap-2'
      contentHeight='min(78vh, 800px)'
      bodyClassName='flex h-full min-h-0 flex-col'
    >
      {props.open && props.user && (
        <ApiKeys
          embedded
          owner={{
            kind: 'user',
            id: props.user.id,
            username: props.user.username,
          }}
        />
      )}
    </Dialog>
  )
}
