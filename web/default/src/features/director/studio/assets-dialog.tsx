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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, FolderOpen, Heart, Star, Trash2, Upload } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { handleServerError } from '@/lib/handle-server-error'

import {
  deleteDirectorAsset,
  getDirectorAssets,
  updateDirectorAsset,
  uploadDirectorAsset,
} from '../api'
import type { DirectorAsset } from '../types'

interface AssetsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: number
  episodeId: number
}

export function AssetsDialog(props: AssetsDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const queryKey = ['director', 'assets', props.projectId]
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const listQuery = useQuery({
    queryKey,
    queryFn: () =>
      getDirectorAssets({ projectId: props.projectId, page_size: 100 }),
    enabled: props.open,
  })

  const assets = listQuery.data?.data?.list ?? []
  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      uploadDirectorAsset({
        file,
        projectId: props.projectId,
        episodeId: props.episodeId,
      }),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Uploaded'))
        invalidate()
      }
    },
    onError: handleServerError,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteDirectorAsset(id),
    onSuccess: (res) => {
      if (res.success) {
        toast.success(t('Deleted'))
        invalidate()
      }
    },
    onError: handleServerError,
  })

  const favoriteMutation = useMutation({
    mutationFn: (asset: DirectorAsset) =>
      updateDirectorAsset({ id: asset.id, isFavorite: !asset.isFavorite }),
    onSuccess: (res) => {
      if (res.success) invalidate()
    },
    onError: handleServerError,
  })

  const copyUrl = (url: string) => {
    void navigator.clipboard.writeText(url).then(
      () => toast.success(t('Copied')),
      () => toast.error(t('Copy failed'))
    )
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) uploadMutation.mutate(file)
    e.target.value = ''
  }

  const renderGrid = () => {
    if (listQuery.isPending) {
      return (
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
          {['s1', 's2', 's3', 's4', 's5', 's6'].map((key) => (
            <Skeleton key={key} className='h-32 w-full rounded-lg' />
          ))}
        </div>
      )
    }
    if (assets.length === 0) {
      return (
        <Empty>
          <EmptyMedia>
            <FolderOpen aria-hidden='true' />
          </EmptyMedia>
          <EmptyTitle>{t('No assets yet')}</EmptyTitle>
          <EmptyDescription>
            {t('Upload images or videos to reuse them in your productions.')}
          </EmptyDescription>
        </Empty>
      )
    }
    return (
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
        {assets.map((asset) => (
          <div
            key={asset.id}
            className='group bg-muted/30 relative overflow-hidden rounded-lg border'
          >
            {asset.type === 'video' ? (
              <video
                src={asset.url}
                preload='metadata'
                muted
                className='h-32 w-full object-cover'
              />
            ) : (
              <img
                src={asset.url}
                alt={asset.name}
                loading='lazy'
                className='h-32 w-full object-cover'
              />
            )}
            <div className='space-y-1 p-2'>
              <p className='truncate text-xs font-medium' title={asset.name}>
                {asset.name || t('Unnamed')}
              </p>
              <div className='flex items-center gap-1'>
                {asset.category && (
                  <Badge variant='secondary' className='text-[10px]'>
                    {asset.category}
                  </Badge>
                )}
                {asset.isFavorite && (
                  <Star
                    aria-hidden='true'
                    className='size-3 fill-amber-400 text-amber-400'
                  />
                )}
              </div>
              <div className='flex gap-1'>
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-6'
                  aria-label={t('Copy URL')}
                  onClick={() => copyUrl(asset.url)}
                >
                  <Copy aria-hidden='true' className='size-3' />
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-6'
                  aria-label={t('Favorite')}
                  onClick={() => favoriteMutation.mutate(asset)}
                >
                  <Heart
                    aria-hidden='true'
                    className={
                      asset.isFavorite
                        ? 'size-3 fill-rose-500 text-rose-500'
                        : 'size-3'
                    }
                  />
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  className='text-destructive hover:text-destructive size-6'
                  aria-label={t('Delete')}
                  onClick={() => deleteMutation.mutate(asset.id)}
                >
                  <Trash2 aria-hidden='true' className='size-3' />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle className='flex items-center justify-between pr-6'>
            {t('Asset Library')}
            <Button
              size='sm'
              variant='outline'
              disabled={uploadMutation.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload aria-hidden='true' />
              {uploadMutation.isPending ? t('Uploading...') : t('Upload')}
            </Button>
            <input
              ref={fileInputRef}
              id='director-asset-file'
              type='file'
              accept='image/*,video/*'
              className='hidden'
              onChange={handleFileChange}
            />
          </DialogTitle>
        </DialogHeader>
        {renderGrid()}
      </DialogContent>
    </Dialog>
  )
}
