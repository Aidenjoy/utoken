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
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'

import { syncDirectorEntityAsset } from '../api'
import type { DirectorEntityAsset } from '../types'

interface EntityAssetRowProps {
  entityType: string
  entityId: number
  // 当前视频模型下的映射；null 表示未同步（或切换视频模型后无映射）
  asset: DirectorEntityAsset | null
  onSynced: () => void
}

// 实体图片的 asset_id 展示 + 同步按钮：同步后视频生成按 asset:// 引用该图片
export function EntityAssetRow(props: EntityAssetRowProps) {
  const { t } = useTranslation()

  const syncMutation = useMutation({
    mutationFn: () =>
      syncDirectorEntityAsset({
        entityType: props.entityType,
        entityId: props.entityId,
      }),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Asset synced'))
        props.onSynced()
      } else {
        toast.error(res.message || t('Operation failed'))
      }
    },
    onError: handleServerError,
  })

  const asset = props.asset

  let statusBadge: React.ReactNode = null
  if (asset?.status === 'pending') {
    statusBadge = (
      <Badge variant='secondary' className='shrink-0 text-[10px]'>
        {t('Activating')}
      </Badge>
    )
  } else if (asset?.status === 'failed') {
    statusBadge = (
      <Badge variant='destructive' className='shrink-0 text-[10px]'>
        {t('Failed')}
      </Badge>
    )
  }

  return (
    <div className='flex items-center gap-1.5'>
      <div
        className='bg-muted text-muted-foreground h-7 min-w-0 flex-1 truncate rounded-md px-2 font-mono text-[11px] leading-7'
        title={asset?.assetId || t('Not synced')}
      >
        {asset?.assetId || t('Not synced')}
      </div>
      {statusBadge}
      <Button
        size='sm'
        variant='outline'
        className='h-7 shrink-0 px-2 text-xs'
        disabled={syncMutation.isPending}
        onClick={() => syncMutation.mutate()}
      >
        {syncMutation.isPending ? t('Syncing...') : t('Sync Portrait')}
      </Button>
    </div>
  )
}
