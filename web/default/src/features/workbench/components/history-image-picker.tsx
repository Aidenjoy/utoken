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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { getDirectorAssets } from '@/features/director/api'
import { useAuthStore } from '@/stores/auth-store'

import type { TryOnImage } from '../types'

interface HistoryImagePickerProps {
  onSelect: (image: TryOnImage) => void
  onClose: () => void
}

/** 仅在打开时挂载，读取当前用户素材库中的图片。 */
export function HistoryImagePicker(props: HistoryImagePickerProps) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const userId = useAuthStore((state) => state.auth.user?.id)
  const pageSize = 12
  const history = useQuery({
    queryKey: ['director-assets', 'image-history', userId, page],
    enabled: Boolean(userId),
    staleTime: 0,
    queryFn: async () => {
      const response = await getDirectorAssets({
        type: 'image',
        p: page,
        page_size: pageSize,
      })
      if (!response.success || !response.data) {
        throw new Error(response.message || 'Failed to load image history')
      }
      return response.data
    },
  })
  const images = (history.data?.list ?? []).filter(
    (asset) => asset.type === 'image' && asset.url
  )

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent className='max-h-[85dvh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{t('Select from history')}</DialogTitle>
          <DialogDescription>
            {t('Choose an image from your asset library.')}
          </DialogDescription>
        </DialogHeader>
        {history.isPending ? (
          <div aria-label={t('Loading...')} className='grid grid-cols-3 gap-3'>
            <Skeleton className='aspect-square' />
            <Skeleton className='aspect-square' />
            <Skeleton className='aspect-square' />
          </div>
        ) : null}
        {history.isError ? (
          <Alert variant='destructive'>
            <AlertDescription>
              {t('Failed to load image history')}
              <Button
                variant='outline'
                size='sm'
                disabled={history.isFetching}
                onClick={() => void history.refetch()}
              >
                {t('Retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {history.isSuccess && images.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('No images in history')}</EmptyTitle>
              <EmptyDescription>
                {t(
                  'Upload an image locally, or save images to your asset library first.'
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {history.isSuccess && images.length > 0 ? (
          <div className='grid grid-cols-3 gap-3'>
            {images.map((asset) => (
              <button
                key={asset.id}
                type='button'
                className='border-border hover:border-primary focus-visible:ring-ring min-w-0 overflow-hidden rounded-lg border text-left outline-none focus-visible:ring-2'
                onClick={() =>
                  props.onSelect({
                    id: String(asset.id),
                    src: asset.url,
                    name: asset.name,
                  })
                }
              >
                <img
                  src={asset.url}
                  alt=''
                  loading='lazy'
                  className='bg-muted aspect-square w-full object-contain'
                />
                <span className='block truncate p-2 text-xs'>
                  {asset.name || t('Image')}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <div className='flex items-center justify-between gap-3'>
          <Button
            variant='outline'
            size='sm'
            disabled={page <= 1 || history.isFetching}
            onClick={() => setPage((value) => value - 1)}
          >
            {t('Previous page')}
          </Button>
          <span className='text-muted-foreground text-xs'>{page}</span>
          <Button
            variant='outline'
            size='sm'
            disabled={
              !history.isSuccess ||
              page * pageSize >= (history.data?.total ?? 0) ||
              history.isFetching
            }
            onClick={() => setPage((value) => value + 1)}
          >
            {t('Next page')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
