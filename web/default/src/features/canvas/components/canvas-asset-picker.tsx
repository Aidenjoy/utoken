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
import {
  Image as ImageIcon,
  Loader2,
  Music2,
  RefreshCw,
  UploadCloud,
  Video,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { getDirectorAssets, uploadDirectorAsset } from '@/features/director/api'
import type { DirectorAsset } from '@/features/director/types'

import type { CanvasTheme } from '../canvas-theme'
import { CanvasModal } from './canvas-modal'

// ===== 素材库选择器（复用视频工厂素材库：分类过滤/分页/上传/点击插入画布） =====

export interface CanvasAssetInsert {
  url: string
  name: string
  type: 'image' | 'video' | 'audio'
  width?: number
  height?: number
}

const PAGE_SIZE = 40

const MEDIA_TYPE_LABEL: Record<'image' | 'video' | 'audio', string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
}

function assetMediaType(asset: DirectorAsset): 'image' | 'video' | 'audio' {
  if (asset.type === 'video') return 'video'
  if (asset.type === 'audio') return 'audio'
  return 'image'
}

export function CanvasAssetPicker(props: {
  theme: CanvasTheme
  onClose: () => void
  onInsert: (asset: CanvasAssetInsert) => void
}) {
  const { theme, onClose, onInsert } = props
  const { t } = useTranslation()
  const [typeFilter, setTypeFilter] = React.useState<
    'all' | 'image' | 'video' | 'audio'
  >('all')
  const [assets, setAssets] = React.useState<DirectorAsset[]>([])
  const [total, setTotal] = React.useState(0)
  const [page, setPage] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const requestIdRef = React.useRef(0)

  const loadPage = React.useCallback(
    async (nextPage: number, filter: typeof typeFilter, append: boolean) => {
      const requestId = ++requestIdRef.current
      setLoading(true)
      setError(false)
      try {
        const res = await getDirectorAssets({
          type: filter === 'all' ? undefined : filter,
          p: nextPage,
          page_size: PAGE_SIZE,
        })
        if (requestId !== requestIdRef.current) return
        const data = res.success ? res.data : undefined
        if (data) {
          setAssets((prev) => (append ? [...prev, ...data.list] : data.list))
          setTotal(data.total)
          setPage(nextPage)
        } else {
          setError(true)
        }
      } catch {
        if (requestId === requestIdRef.current) setError(true)
      } finally {
        if (requestId === requestIdRef.current) setLoading(false)
      }
    },
    []
  )

  React.useEffect(() => {
    void loadPage(1, typeFilter, false)
  }, [typeFilter, loadPage])

  const handleUpload = async (file: File) => {
    setUploading(true)
    try {
      const res = await uploadDirectorAsset({ file })
      const uploaded = res.success ? res.data : undefined
      if (uploaded) {
        toast.success(t('Uploaded to asset library'))
        setAssets((prev) => [uploaded.asset, ...prev])
        setTotal((prev) => prev + 1)
      }
    } catch {
      // 全局拦截器已提示
    } finally {
      setUploading(false)
    }
  }

  const filters: { value: typeof typeFilter; labelKey: string }[] = [
    { value: 'all', labelKey: 'All' },
    { value: 'image', labelKey: 'Image' },
    { value: 'video', labelKey: 'Video' },
    { value: 'audio', labelKey: 'Audio' },
  ]

  return (
    <CanvasModal
      theme={theme}
      title={t('Asset library')}
      onClose={onClose}
      width={760}
      headerExtra={
        <button
          type='button'
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className='flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs transition-opacity disabled:opacity-50'
          style={{
            background: theme.accent.primary,
            color: theme.accent.onPrimary,
          }}
        >
          {uploading ? (
            <Loader2 aria-hidden='true' className='size-3 animate-spin' />
          ) : (
            <UploadCloud aria-hidden='true' className='size-3.5' />
          )}
          {t('Upload')}
        </button>
      }
    >
      <input
        ref={fileInputRef}
        type='file'
        accept='image/*,video/*,audio/*'
        className='hidden'
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleUpload(file)
          event.target.value = ''
        }}
      />
      <div className='flex items-center gap-1.5 px-4 pt-3'>
        {filters.map((filter) => (
          <button
            key={filter.value}
            type='button'
            onClick={() => setTypeFilter(filter.value)}
            className='h-7 cursor-pointer rounded-full px-3 text-xs transition-colors'
            style={{
              background:
                typeFilter === filter.value
                  ? theme.accent.primary
                  : theme.toolbar.itemHover,
              color:
                typeFilter === filter.value
                  ? theme.accent.onPrimary
                  : theme.node.muted,
            }}
          >
            {t(filter.labelKey)}
          </button>
        ))}
        <span
          className='ml-auto text-[11px] tabular-nums'
          style={{ color: theme.node.faint }}
        >
          {total}
        </span>
      </div>

      {error && (
        <div className='flex flex-col items-center gap-3 py-16'>
          <p className='text-xs' style={{ color: theme.node.muted }}>
            {t('Failed to load assets')}
          </p>
          <button
            type='button'
            onClick={() => void loadPage(1, typeFilter, false)}
            className='flex h-7 cursor-pointer items-center gap-1 rounded-lg px-3 text-xs'
            style={{
              background: theme.toolbar.itemHover,
              color: theme.node.text,
            }}
          >
            <RefreshCw aria-hidden='true' className='size-3' />
            {t('Retry')}
          </button>
        </div>
      )}
      {!error && assets.length === 0 && !loading && (
        <div className='flex flex-col items-center gap-2 py-16'>
          <ImageIcon
            aria-hidden='true'
            className='size-8'
            style={{ color: theme.node.faint }}
          />
          <p className='text-xs' style={{ color: theme.node.muted }}>
            {t('No assets yet')}
          </p>
          <p className='text-[11px]' style={{ color: theme.node.faint }}>
            {t('Upload media to build your asset library')}
          </p>
        </div>
      )}
      {!error && (assets.length > 0 || loading) && (
        <>
          <div className='grid grid-cols-[repeat(auto-fill,minmax(142px,1fr))] gap-3 p-4'>
            {assets.map((asset) => {
              const mediaType = assetMediaType(asset)
              let typeIcon = (
                <ImageIcon aria-hidden='true' className='size-2.5' />
              )
              if (mediaType === 'video') {
                typeIcon = <Video aria-hidden='true' className='size-2.5' />
              } else if (mediaType === 'audio') {
                typeIcon = <Music2 aria-hidden='true' className='size-2.5' />
              }
              return (
                <button
                  key={asset.id}
                  type='button'
                  onClick={() =>
                    onInsert({
                      url: asset.url,
                      name: asset.name,
                      type: mediaType,
                      width: asset.width || undefined,
                      height: asset.height || undefined,
                    })
                  }
                  className='group/asset cursor-pointer overflow-hidden rounded-xl text-left transition-transform hover:-translate-y-0.5'
                  style={{
                    border: `1px solid ${theme.toolbar.border}`,
                    background: theme.node.fill,
                  }}
                  title={asset.name}
                >
                  <div
                    className='relative flex aspect-square items-center justify-center overflow-hidden'
                    style={{ background: 'rgba(0,0,0,.25)' }}
                  >
                    {mediaType === 'image' && (
                      <img
                        src={asset.url}
                        alt={asset.name}
                        loading='lazy'
                        draggable={false}
                        className='size-full object-cover'
                      />
                    )}
                    {mediaType === 'video' && (
                      <video
                        src={asset.url}
                        muted
                        playsInline
                        preload='metadata'
                        className='size-full object-cover'
                        onMouseEnter={(event) => {
                          void event.currentTarget.play().catch(() => {})
                        }}
                        onMouseLeave={(event) => {
                          event.currentTarget.pause()
                          event.currentTarget.currentTime = 0
                        }}
                      />
                    )}
                    {mediaType === 'audio' && (
                      <Music2
                        aria-hidden='true'
                        className='size-8'
                        style={{ color: '#a855f7' }}
                      />
                    )}
                    <span
                      className='absolute top-1.5 left-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium'
                      style={{
                        background: 'rgba(0,0,0,.55)',
                        color: '#fff',
                      }}
                    >
                      {typeIcon}
                      {t(MEDIA_TYPE_LABEL[mediaType])}
                    </span>
                  </div>
                  <p
                    className='truncate px-2 py-1.5 text-[11px]'
                    style={{ color: theme.node.muted }}
                  >
                    {asset.name}
                  </p>
                </button>
              )
            })}
          </div>
          <div className='flex justify-center pb-4'>
            {loading ? (
              <Loader2
                aria-hidden='true'
                className='size-5 animate-spin'
                style={{ color: theme.node.muted }}
              />
            ) : (
              assets.length < total && (
                <button
                  type='button'
                  onClick={() => void loadPage(page + 1, typeFilter, true)}
                  className='h-8 cursor-pointer rounded-lg px-4 text-xs transition-colors'
                  style={{
                    background: theme.toolbar.itemHover,
                    color: theme.node.text,
                  }}
                >
                  {t('Load more')}
                </button>
              )
            )}
          </div>
        </>
      )}
    </CanvasModal>
  )
}
