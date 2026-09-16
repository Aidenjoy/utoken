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
  CheckIcon,
  CopyIcon,
  FilmIcon,
  ImageIcon,
  MusicIcon,
  RefreshCwIcon,
  SparklesIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { cn } from '@/lib/utils'

import {
  deleteSourceAsset,
  getAssetProviders,
  listSourceAssets,
  uploadSourceAsset,
} from '../../api'
import { SMART_ASSET_REF_PREFIX } from '../../constants'
import type { AssetProvider, AssetType, SourceAsset } from '../../types'

interface SmartAssetsPanelProps {
  className?: string
}

function sourceTypeIcon(type: AssetType) {
  switch (type) {
    case 'Video':
      return <FilmIcon size={14} />
    case 'Audio':
      return <MusicIcon size={14} />
    default:
      return <ImageIcon size={14} />
  }
}

function sourcePreview(asset: SourceAsset) {
  if (asset.asset_type === 'Video') {
    return (
      <video src={asset.source_url} className='size-full object-cover' muted />
    )
  }
  if (asset.asset_type === 'Audio') {
    return (
      <div className='flex size-full items-center justify-center'>
        <MusicIcon size={24} className='text-muted-foreground' />
      </div>
    )
  }
  return (
    <img
      src={asset.source_url}
      alt={asset.name}
      className='size-full object-cover'
      referrerPolicy='no-referrer'
    />
  )
}

/**
 * Smart-asset panel: upload once to our own TOS, then the playground rewrites
 * `asset://yun-<id>` to the right channel's upstream asset at submit time.
 * Channel-independent, so no channel/model/group selection is needed here; the
 * per-channel sync status is shown as chips on each card.
 */
export function SmartAssetsPanel({ className }: SmartAssetsPanelProps) {
  const { t } = useTranslation()
  const [assets, setAssets] = useState<SourceAsset[]>([])
  const [providers, setProviders] = useState<AssetProvider[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [deletingAsset, setDeletingAsset] = useState<SourceAsset | null>(null)
  const copyResetTimer = useRef<number | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const providerName = useCallback(
    (channelId: number) =>
      providers.find((p) => p.id === channelId)?.name ?? `#${channelId}`,
    [providers]
  )

  const reloadAssets = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    try {
      const list = await listSourceAssets()
      setAssets(list)
    } finally {
      if (!opts.silent) setLoading(false)
    }
  }, [])

  // Load channel providers once, for mapping channel_id -> name in status chips.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const list = await getAssetProviders()
      if (!cancelled) setProviders(list)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    void reloadAssets()
  }, [reloadAssets])

  // A pending channel copy settles asynchronously upstream; poll silently until
  // none remain (mirrors the channel-asset tab behaviour).
  const hasPendingCopy = assets.some((asset) =>
    (asset.channels ?? []).some((c) => c.status === 'pending')
  )
  useEffect(() => {
    if (!hasPendingCopy) return
    const timer = setInterval(() => {
      void reloadAssets({ silent: true })
    }, 3000)
    return () => clearInterval(timer)
  }, [hasPendingCopy, reloadAssets])

  const handleLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      await uploadSourceAsset(file, file.name)
      toast.success(t('Smart asset uploaded'))
      await reloadAssets()
    } catch (err) {
      toast.error(t('Failed to upload smart asset'), {
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setUploading(false)
    }
  }

  const handleCopyRef = useCallback(
    (asset: SourceAsset) => {
      void copyToClipboard(`asset://${SMART_ASSET_REF_PREFIX}${asset.id}`).then(
        (ok) => {
          if (!ok) {
            toast.error(t('Failed to copy'))
            return
          }
          setCopiedId(asset.id)
          window.clearTimeout(copyResetTimer.current)
          copyResetTimer.current = window.setTimeout(
            () => setCopiedId(null),
            1600
          )
        }
      )
    },
    [t]
  )

  const confirmDelete = async () => {
    if (!deletingAsset) return
    const target = deletingAsset
    setDeletingAsset(null)
    try {
      await deleteSourceAsset(target.id)
      setAssets((prev) => prev.filter((a) => a.id !== target.id))
      toast.success(t('Smart asset deleted'))
    } catch (err) {
      toast.error(t('Failed to delete asset'), {
        description: err instanceof Error ? err.message : String(err),
      })
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

      {/* Upload + hint */}
      <div className='border-border/60 bg-muted/40 dark:bg-muted/20 shrink-0 space-y-3 rounded-xl border p-3'>
        <p className='text-muted-foreground text-xs'>
          {t(
            'Upload once, then reference with @ in any video model. The asset is auto-synced to the channel that serves the selected model.'
          )}
        </p>
        <Button
          className='w-full'
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon size={14} />
          {uploading ? t('Uploading...') : t('Upload smart asset')}
        </Button>
      </div>

      {/* Grid header */}
      <div className='flex items-center justify-between'>
        <div className='text-muted-foreground text-xs'>
          {t('{{count}} assets', { count: assets.length })}
        </div>
        <Button
          variant='ghost'
          size='sm'
          disabled={loading}
          onClick={() => reloadAssets()}
        >
          <RefreshCwIcon size={14} className={cn(loading && 'animate-spin')} />
          {t('Refresh')}
        </Button>
      </div>

      <div className='grid min-h-0 flex-1 auto-rows-min grid-cols-3 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-4 lg:grid-cols-5'>
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
              className='group border-border/60 hover:border-foreground/25 relative overflow-hidden rounded-xl border bg-background transition-all hover:shadow-md'
            >
              <div className='bg-muted relative aspect-square w-full overflow-hidden'>
                <div className='size-full transition-transform duration-300 ease-out group-hover:scale-[1.04]'>
                  {sourcePreview(asset)}
                </div>
                {/* Smart badge */}
                <div className='absolute top-1.5 left-1.5'>
                  <Badge className='border-transparent bg-violet-500/15 text-violet-600 dark:text-violet-400'>
                    <SparklesIcon size={11} />
                    {t('Smart')}
                  </Badge>
                </div>
                {/* Delete on hover */}
                <button
                  type='button'
                  className='bg-background/80 text-muted-foreground hover:text-destructive absolute top-1 right-1 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100'
                  onClick={() => setDeletingAsset(asset)}
                >
                  <Trash2Icon size={13} />
                </button>
              </div>
              <div className='space-y-1.5 p-2'>
                {asset.name && (
                  <div
                    className='truncate text-xs font-medium'
                    title={asset.name}
                  >
                    {asset.name}
                  </div>
                )}
                <div className='flex items-center gap-1'>
                  <Badge variant='outline' className='gap-1 px-1.5 py-0'>
                    {sourceTypeIcon(asset.asset_type)}
                    {t(asset.asset_type)}
                  </Badge>
                </div>
                {/* Reference id + copy */}
                <div className='flex items-start gap-0.5'>
                  <span className='text-muted-foreground/90 min-w-0 flex-1 break-all font-mono text-[10px] leading-4'>
                    {`${SMART_ASSET_REF_PREFIX}${asset.id}`}
                  </span>
                  <button
                    type='button'
                    className={cn(
                      'shrink-0 rounded-md p-1 transition-colors',
                      copiedId === asset.id
                        ? 'text-emerald-500'
                        : 'text-muted-foreground/70 hover:bg-muted hover:text-foreground'
                    )}
                    title={t('Copy asset reference')}
                    aria-label={t('Copy asset reference')}
                    onClick={() => handleCopyRef(asset)}
                  >
                    {copiedId === asset.id ? (
                      <CheckIcon size={12} />
                    ) : (
                      <CopyIcon size={12} />
                    )}
                  </button>
                </div>
                {/* Per-channel sync status chips */}
                <div className='flex flex-wrap gap-1'>
                  {(asset.channels ?? []).length === 0 ? (
                    <span className='text-muted-foreground/70 text-[10px]'>
                      {t('Not synced yet')}
                    </span>
                  ) : (
                    (asset.channels ?? []).map((c) => (
                      <span
                        key={`${c.channel_id}-${c.id}`}
                        title={
                          c.status === 'failed' && c.error_msg
                            ? c.error_msg
                            : providerName(c.channel_id)
                        }
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px]',
                          c.status === 'active' &&
                            'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                          c.status === 'pending' &&
                            'border-border/60 bg-muted text-muted-foreground',
                          c.status === 'failed' &&
                            'border-destructive/30 bg-destructive/10 text-destructive'
                        )}
                      >
                        {c.status === 'pending' && (
                          <span className='size-2 animate-spin rounded-full border border-current border-t-transparent' />
                        )}
                        <span className='max-w-20 truncate'>
                          {providerName(c.channel_id)}
                        </span>
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>
          ))}
        {!loading && assets.length === 0 && (
          <div className='text-muted-foreground col-span-full flex flex-col items-center gap-2 py-10 text-center text-xs'>
            <SparklesIcon size={24} className='opacity-40' />
            {t('No smart assets yet')}
          </div>
        )}
      </div>

      <AlertDialog
        open={Boolean(deletingAsset)}
        onOpenChange={(open) => {
          if (!open) setDeletingAsset(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete Smart Asset')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('Delete this smart asset? This action cannot be undone.')}{' '}
              {t(
                'Only the local record is removed; channel copies and upstream assets are kept.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive hover:bg-destructive/90 text-white'
              onClick={() => {
                void confirmDelete()
              }}
            >
              {t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
