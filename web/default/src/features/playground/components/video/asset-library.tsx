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
  FilmIcon,
  ImageIcon,
  MusicIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import {
  deleteAsset,
  getAssetProviders,
  listAssets,
  registerAsset,
  uploadFile,
} from '../../api'
import type { Asset, AssetProvider, AssetType } from '../../types'

interface AssetLibraryContentProps {
  /** Model used for local file TOS upload; local upload is disabled without it */
  model?: string
  /** Group used for local file TOS upload; local upload is disabled without it */
  group?: string
  className?: string
}

const ASSET_TYPES: AssetType[] = ['Image', 'Video', 'Audio']

function assetTypeIcon(type: AssetType) {
  switch (type) {
    case 'Video':
      return <FilmIcon size={14} />
    case 'Audio':
      return <MusicIcon size={14} />
    default:
      return <ImageIcon size={14} />
  }
}

function assetPreview(asset: Asset) {
  const src = asset.preview_url || asset.source_url
  if (asset.asset_type === 'Video') {
    return <video src={src} className='size-full object-cover' muted />
  }
  if (asset.asset_type === 'Audio') {
    return (
      <div className='flex size-full items-center justify-center'>
        <MusicIcon size={24} className='text-muted-foreground' />
      </div>
    )
  }
  return <img src={src} alt={asset.name} className='size-full object-cover' />
}

export function AssetLibraryContent({
  model,
  group,
  className,
}: AssetLibraryContentProps) {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<AssetProvider[]>([])
  const [channelId, setChannelId] = useState<number>(0)
  const [assets, setAssets] = useState<Asset[]>([])
  const [loading, setLoading] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [uploadingLocal, setUploadingLocal] = useState(false)
  const [url, setUrl] = useState('')
  const [assetType, setAssetType] = useState<AssetType>('Image')
  const [name, setName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reloadAssets = useCallback(
    async (opts: { silent?: boolean; channelId?: number } = {}) => {
      if (!opts.silent) setLoading(true)
      try {
        const list = await listAssets(opts.channelId)
        setAssets(list)
      } finally {
        if (!opts.silent) setLoading(false)
      }
    },
    []
  )

  // Pending assets settle asynchronously upstream; poll silently until none remain.
  const hasPendingAsset = assets.some((asset) => asset.status === 'pending')
  useEffect(() => {
    if (!hasPendingAsset) return
    const timer = setInterval(() => {
      void reloadAssets({ silent: true, channelId })
    }, 3000)
    return () => clearInterval(timer)
  }, [hasPendingAsset, channelId, reloadAssets])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const list = await getAssetProviders()
      if (cancelled) return
      setProviders(list)
      if (list.length > 0) {
        setChannelId((prev) =>
          prev && list.some((p) => p.id === prev) ? prev : list[0].id
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 素材绑定「用户 × 渠道」，跨渠道不通用，列表只展示当前所选渠道
  useEffect(() => {
    if (!channelId) return
    void reloadAssets({ channelId })
  }, [channelId, reloadAssets])

  const handleRegister = async (registerUrl: string, registerName: string) => {
    if (!channelId) {
      toast.error(t('Please select a channel first'))
      return
    }
    if (!/^https?:\/\//.test(registerUrl)) {
      toast.error(t('Asset URL must be a public http(s) URL'))
      return
    }
    setRegistering(true)
    try {
      await registerAsset({
        channel_id: channelId,
        url: registerUrl,
        asset_type: assetType,
        name: registerName,
      })
      toast.success(t('Asset registered'))
      setUrl('')
      setName('')
      await reloadAssets({ channelId })
    } catch (err) {
      toast.error(t('Failed to register asset'), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setRegistering(false)
    }
  }

  const handleLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!channelId) {
      toast.error(t('Please select a channel first'))
      return
    }
    if (!model || !group) {
      toast.error(t('No available model for file upload'))
      return
    }
    setUploadingLocal(true)
    try {
      // 1. Upload to TOS to get a public URL
      const batchId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `asset-${Date.now()}`
      const { url: tosUrl } = await uploadFile(file, model, group, batchId)
      // 2. Register the public URL as an asset
      await registerAsset({
        channel_id: channelId,
        url: tosUrl,
        asset_type: assetType,
        name: name.trim() || file.name,
      })
      toast.success(t('Asset registered'))
      setName('')
      await reloadAssets({ channelId })
    } catch (err) {
      toast.error(t('Failed to register asset'), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setUploadingLocal(false)
    }
  }

  const handleDelete = async (asset: Asset) => {
    try {
      await deleteAsset(asset.id)
      setAssets((prev) => prev.filter((a) => a.id !== asset.id))
    } catch (err) {
      toast.error(t('Failed to delete asset'), {
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const statusBadge = (asset: Asset) => {
    switch (asset.status) {
      case 'active':
        return (
          <Badge className='border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'>
            {t('Active')}
          </Badge>
        )
      case 'failed':
        return <Badge variant='destructive'>{t('Failed')}</Badge>
      default:
        return <Badge variant='secondary'>{t('Pending')}</Badge>
    }
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-4', className)}>
      <input
        ref={fileInputRef}
        type='file'
        accept='image/*,video/*,audio/*'
        className='hidden'
        onChange={handleLocalFile}
      />

      {/* Register form */}
      <div className='border-border/60 bg-muted/40 dark:bg-muted/20 shrink-0 space-y-3 rounded-xl border p-3'>
        <div className='grid grid-cols-[1fr_10rem] gap-2'>
          <div className='space-y-1.5'>
            <div className='text-muted-foreground text-xs font-medium'>
              {t('Channel')}
            </div>
            <Select
              value={channelId ? String(channelId) : null}
              onValueChange={(v) => setChannelId(Number(v))}
              items={providers.map((p) => ({
                value: String(p.id),
                label: p.name,
              }))}
            >
              <SelectTrigger className='w-full'>
                <SelectValue placeholder={t('Select channel')} />
              </SelectTrigger>
              <SelectContent>
                {providers.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className='space-y-1.5'>
            <div className='text-muted-foreground text-xs font-medium'>
              {t('Type')}
            </div>
            <Select
              value={assetType}
              onValueChange={(v) => setAssetType(v as AssetType)}
              items={ASSET_TYPES.map((tp) => ({ value: tp, label: t(tp) }))}
            >
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSET_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    <span className='flex items-center gap-1.5'>
                      {assetTypeIcon(type)}
                      {t(type)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className='grid grid-cols-[1fr_14rem] gap-2'>
          <div className='space-y-1.5'>
            <div className='text-muted-foreground text-xs font-medium'>
              {t('URL')}
            </div>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('Paste a public URL of the asset')}
            />
          </div>
          <div className='space-y-1.5'>
            <div className='text-muted-foreground text-xs font-medium'>
              {t('Name')}
            </div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Asset name (optional)')}
            />
          </div>
        </div>
        <div className='flex gap-2'>
          <Button
            className='flex-1'
            disabled={registering || uploadingLocal || !url.trim()}
            onClick={() => handleRegister(url.trim(), name.trim())}
          >
            {registering ? t('Submitting...') : t('Submit URL asset')}
          </Button>
          <Button
            variant='outline'
            className='flex-1'
            disabled={registering || uploadingLocal || !model || !group}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadIcon size={14} />
            {uploadingLocal ? t('Uploading...') : t('Upload local file')}
          </Button>
        </div>
      </div>

      {/* Asset grid */}
      <div className='flex items-center justify-between'>
        <div className='text-muted-foreground text-xs'>
          {t('{{count}} assets', { count: assets.length })}
        </div>
        <Button
          variant='ghost'
          size='sm'
          disabled={loading}
          onClick={() => reloadAssets({ channelId })}
        >
          <RefreshCwIcon size={14} className={cn(loading && 'animate-spin')} />
          {t('Refresh')}
        </Button>
      </div>
      <div className='grid min-h-0 flex-1 auto-rows-min grid-cols-4 gap-2 overflow-y-auto pr-1 sm:grid-cols-6'>
        {loading &&
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className='space-y-1.5'>
              <Skeleton className='aspect-square w-full' />
              <Skeleton className='h-3 w-3/4' />
            </div>
          ))}
        {!loading &&
          assets.map((asset) => (
            <div
              key={asset.id}
              className={cn(
                'group relative overflow-hidden rounded-lg border bg-background transition-all',
                asset.status !== 'active' && 'opacity-75'
              )}
            >
              <div className='bg-muted relative aspect-square w-full'>
                {assetPreview(asset)}
                {/* Status badge overlay */}
                <div className='absolute top-1.5 left-1.5'>
                  {statusBadge(asset)}
                </div>
                {/* Pending spinner overlay */}
                {asset.status === 'pending' && (
                  <div className='absolute inset-0 flex items-center justify-center bg-black/30'>
                    <div className='size-5 animate-spin rounded-full border-2 border-white/30 border-t-white' />
                  </div>
                )}
                {/* Delete on hover */}
                <button
                  type='button'
                  className='bg-background/80 text-muted-foreground hover:text-destructive absolute top-1 right-1 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100'
                  onClick={() => {
                    void handleDelete(asset)
                  }}
                >
                  <Trash2Icon size={13} />
                </button>
              </div>
              <div className='space-y-0.5 p-1.5'>
                <div className='truncate text-xs font-medium'>
                  {asset.name || asset.asset_id}
                </div>
                {asset.status === 'failed' && asset.error_msg && (
                  <div className='text-destructive truncate text-[10px]'>
                    {asset.error_msg}
                  </div>
                )}
              </div>
            </div>
          ))}
        {!loading && assets.length === 0 && (
          <div className='text-muted-foreground col-span-full flex flex-col items-center gap-2 py-10 text-center text-xs'>
            <ImageIcon size={24} className='opacity-40' />
            {providers.length === 0
              ? t('No channel has enabled the asset upload protocol')
              : t('No assets yet')}
          </div>
        )}
      </div>
    </div>
  )
}
