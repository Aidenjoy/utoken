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
import { Download, FileIcon, Music, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ZoomableImage } from '@/components/zoomable-image'
import dayjs from '@/lib/dayjs'

import type { DirectorAsset } from '../types'

interface AssetCardProps {
  asset: DirectorAsset
  categoryLabel: (key: string) => string
  projectText: (id?: number | null) => string
  onDelete: (asset: DirectorAsset) => void
}

export function AssetCard(props: AssetCardProps) {
  const { t } = useTranslation()
  const asset = props.asset

  const typeLabel = () => {
    if (asset.type === 'image') return t('Image')
    if (asset.type === 'video') return t('Video')
    if (asset.type === 'audio') return t('Audio')
    return t('File')
  }

  const cover = () => {
    if (asset.type === 'image') {
      return (
        <ZoomableImage
          src={asset.url}
          alt={asset.name}
          className='size-full'
        />
      )
    }
    if (asset.type === 'video') {
      return (
        <video
          src={asset.url}
          controls
          preload='metadata'
          className='size-full bg-black object-contain'
        />
      )
    }
    if (asset.type === 'audio') {
      return (
        <div className='text-muted-foreground flex size-full items-center justify-center'>
          <Music aria-hidden='true' className='size-8' />
        </div>
      )
    }
    return (
      <div className='text-muted-foreground flex size-full items-center justify-center'>
        <FileIcon aria-hidden='true' className='size-8' />
      </div>
    )
  }

  return (
    <div className='border-border/60 bg-background flex flex-col overflow-hidden rounded-xl border transition-shadow hover:shadow-md'>
      <div className='bg-muted relative aspect-[16/10] w-full overflow-hidden'>
        {cover()}
        <div className='absolute top-1.5 left-1.5 rounded bg-black/55 px-2 py-0.5 text-xs text-white'>
          {typeLabel()}
        </div>
      </div>
      <div className='flex-1 space-y-1.5 p-2.5'>
        <div className='truncate text-[13px] font-semibold' title={asset.name}>
          {asset.name}
        </div>
        <div className='flex items-center justify-between'>
          <Badge variant='outline' className='font-normal'>
            {props.categoryLabel(asset.category)}
          </Badge>
          <span className='text-muted-foreground text-xs'>
            {dayjs(asset.createdAt * 1000).format('YYYY-MM-DD')}
          </span>
        </div>
        <div
          className='text-muted-foreground truncate text-xs'
          title={props.projectText(asset.projectId)}
        >
          {props.projectText(asset.projectId)}
        </div>
      </div>
      <div className='border-border/60 flex items-center justify-end gap-1 border-t p-1.5'>
        <a href={asset.url} target='_blank' rel='noreferrer'>
          <Button
            variant='ghost'
            size='icon'
            className='size-7'
            aria-label={t('Download')}
            title={t('Download')}
          >
            <Download aria-hidden='true' className='size-3.5' />
          </Button>
        </a>
        <Button
          variant='ghost'
          size='icon'
          className='text-destructive hover:text-destructive size-7'
          aria-label={t('Delete')}
          title={t('Delete')}
          onClick={() => props.onDelete(asset)}
        >
          <Trash2 aria-hidden='true' className='size-3.5' />
        </Button>
      </div>
    </div>
  )
}
