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
import {
  ArrowRightIcon,
  FilmIcon,
  ImageIcon,
  MusicIcon,
  RefreshCwIcon,
  Trash2Icon,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
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
import { Checkbox } from '@/components/ui/checkbox'
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
  deleteChannelAsset,
  listAssetChannels,
  listChannelAssets,
  syncChannelAssets,
} from './api'
import type { AssetType, ChannelAsset } from './types'

const SKELETON_KEYS = ['sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5']

function typeIcon(type: AssetType) {
  switch (type) {
    case 'Video':
      return <FilmIcon size={14} />
    case 'Audio':
      return <MusicIcon size={14} />
    default:
      return <ImageIcon size={14} />
  }
}

function AssetThumb({ asset }: { asset: ChannelAsset }) {
  const src = asset.preview_url || asset.source_url
  if (asset.asset_type === 'Video') {
    return <video src={src} className='size-full object-cover' muted />
  }
  if (asset.asset_type === 'Audio') {
    return (
      <div className='flex size-full items-center justify-center'>
        <MusicIcon size={18} className='text-muted-foreground' />
      </div>
    )
  }
  return <img src={src} alt={asset.name} className='size-full object-cover' />
}

export function AssetSyncPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [sourceChannelId, setSourceChannelId] = useState(0)
  const [targetChannelId, setTargetChannelId] = useState(0)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [deletingAsset, setDeletingAsset] = useState<ChannelAsset | null>(null)

  const channelsQuery = useQuery({
    queryKey: ['asset-sync-channels'],
    queryFn: listAssetChannels,
  })
  const channels = channelsQuery.data ?? []

  const assetsQuery = useQuery({
    queryKey: ['asset-sync-assets', sourceChannelId],
    queryFn: () => listChannelAssets(sourceChannelId),
    enabled: sourceChannelId > 0,
  })
  const assets = assetsQuery.data ?? []

  // 未勾选任何素材时默认同步源渠道下列出的全部素材，勾选后仅同步勾选项
  const syncIds = selected.size > 0 ? [...selected] : assets.map((a) => a.id)

  const syncMutation = useMutation({
    mutationFn: () =>
      syncChannelAssets({
        source_channel_id: sourceChannelId,
        target_channel_id: targetChannelId,
        asset_ids: syncIds,
      }),
    onSuccess: (results) => {
      const pending = results.filter((r) => r.status === 'pending').length
      const skipped = results.filter((r) => r.status === 'skipped').length
      const failed = results.filter((r) => r.status === 'failed')
      const summary = t(
        '{{pending}} submitted, {{skipped}} skipped, {{failed}} failed',
        {
          pending,
          skipped,
          failed: failed.length,
        }
      )
      if (failed.length > 0) {
        const detail = failed
          .slice(0, 3)
          .map((f) => `${f.name || f.asset_db_id || ''}: ${f.error || ''}`)
          .join('\n')
        toast.error(summary, { description: detail })
      } else {
        toast.success(summary)
      }
      setSelected(new Set())
      void queryClient.invalidateQueries({
        queryKey: ['asset-sync-assets', targetChannelId],
      })
    },
    onError: (error) => {
      toast.error(t('Sync failed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (asset: ChannelAsset) =>
      deleteChannelAsset(sourceChannelId, asset.id),
    onSuccess: (_res, asset) => {
      toast.success(t('Asset deleted'))
      // AlertDialogAction 是普通 Button 不带自动关闭，需显式清空关闭确认框
      setDeletingAsset(null)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(asset.id)
        return next
      })
      void queryClient.invalidateQueries({
        queryKey: ['asset-sync-assets', sourceChannelId],
      })
    },
    onError: (error) => {
      toast.error(t('Failed to delete asset'), {
        description: error instanceof Error ? error.message : String(error),
      })
    },
  })

  const allSelected = assets.length > 0 && selected.size === assets.length
  const sameChannel = sourceChannelId > 0 && sourceChannelId === targetChannelId
  const canSync =
    sourceChannelId > 0 &&
    targetChannelId > 0 &&
    !sameChannel &&
    assets.length > 0 &&
    !syncMutation.isPending

  const handleSourceChange = (value: string | null) => {
    const id = Number(value)
    setSourceChannelId(id)
    setSelected(new Set())
    if (id === targetChannelId) setTargetChannelId(0)
  }

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(assets.map((a) => a.id)) : new Set())
  }

  const toggleOne = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const statusBadge = (asset: ChannelAsset) => {
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

  let syncLabel = t('Sync all {{count}} assets', { count: assets.length })
  if (selected.size > 0) {
    syncLabel = t('Sync {{count}} assets', { count: selected.size })
  }
  if (syncMutation.isPending) {
    syncLabel = t('Syncing...')
  }

  return (
    <>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('Asset Sync')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <Button
            variant='outline'
            size='sm'
            disabled={!sourceChannelId || assetsQuery.isFetching}
            onClick={() =>
              queryClient.invalidateQueries({
                queryKey: ['asset-sync-assets', sourceChannelId],
              })
            }
          >
            <RefreshCwIcon
              size={14}
              className={cn(assetsQuery.isFetching && 'animate-spin')}
            />
            {t('Refresh')}
          </Button>
          <Button
            size='sm'
            disabled={!canSync}
            onClick={() => syncMutation.mutate()}
          >
            <ArrowRightIcon size={14} />
            {syncLabel}
          </Button>
        </SectionPageLayout.Actions>

        <SectionPageLayout.Content>
          <div className='flex h-full flex-col gap-4'>
            <p className='text-muted-foreground text-sm'>
              {t('Sync assets from one channel to another')}
            </p>

            {/* Channel pickers */}
            <div className='grid gap-3 sm:grid-cols-2'>
              <div className='space-y-1.5'>
                <div className='text-muted-foreground text-xs font-medium'>
                  {t('Source Channel')}
                </div>
                <Select
                  value={sourceChannelId ? String(sourceChannelId) : null}
                  onValueChange={handleSourceChange}
                  items={channels.map((c) => ({
                    value: String(c.id),
                    label: c.name,
                  }))}
                >
                  <SelectTrigger className='w-full'>
                    <SelectValue placeholder={t('Select channel')} />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='space-y-1.5'>
                <div className='text-muted-foreground text-xs font-medium'>
                  {t('Target Channel')}
                </div>
                <Select
                  value={targetChannelId ? String(targetChannelId) : null}
                  onValueChange={(v) => setTargetChannelId(Number(v))}
                  items={channels.map((c) => ({
                    value: String(c.id),
                    label: c.name,
                  }))}
                >
                  <SelectTrigger className='w-full'>
                    <SelectValue placeholder={t('Select channel')} />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((c) => (
                      <SelectItem
                        key={c.id}
                        value={String(c.id)}
                        disabled={c.id === sourceChannelId}
                      >
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {sameChannel && (
              <div className='text-destructive text-xs'>
                {t('Source and target channel must be different')}
              </div>
            )}

            {/* Asset list */}
            <div className='border-border/60 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border'>
              <div className='border-border/60 bg-muted/40 dark:bg-muted/20 flex items-center gap-3 border-b px-3 py-2'>
                <Checkbox
                  checked={allSelected}
                  disabled={assets.length === 0}
                  onCheckedChange={(v) => toggleAll(Boolean(v))}
                  aria-label={t('Select All')}
                />
                <span className='text-muted-foreground text-xs'>
                  {sourceChannelId
                    ? t('{{count}} assets', { count: assets.length })
                    : t('Please select a source channel')}
                </span>
                {selected.size > 0 && (
                  <span className='text-muted-foreground ml-auto text-xs'>
                    {t('Selected {{count}}', { count: selected.size })}
                  </span>
                )}
              </div>

              <div className='min-h-0 flex-1 overflow-y-auto'>
                {sourceChannelId === 0 && (
                  <div className='text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-xs'>
                    <ImageIcon size={24} className='opacity-40' />
                    {t('Please select a source channel')}
                  </div>
                )}

                {sourceChannelId > 0 && assetsQuery.isLoading && (
                  <div className='space-y-2 p-3'>
                    {SKELETON_KEYS.map((key) => (
                      <Skeleton key={key} className='h-14 w-full' />
                    ))}
                  </div>
                )}

                {sourceChannelId > 0 &&
                  !assetsQuery.isLoading &&
                  assets.length === 0 && (
                    <div className='text-muted-foreground flex flex-col items-center gap-2 py-12 text-center text-xs'>
                      <ImageIcon size={24} className='opacity-40' />
                      {channels.length === 0
                        ? t('No channel has enabled the asset upload protocol')
                        : t('No assets yet')}
                    </div>
                  )}

                {sourceChannelId > 0 &&
                  assets.map((asset) => (
                    // 行用 div 而非 label：避免点击被转发给行内删除按钮
                    <div
                      key={asset.id}
                      className='border-border/60 hover:bg-muted/40 dark:hover:bg-muted/20 flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0'
                      onClick={() =>
                        toggleOne(asset.id, !selected.has(asset.id))
                      }
                    >
                      <Checkbox
                        checked={selected.has(asset.id)}
                        onCheckedChange={(v) => toggleOne(asset.id, Boolean(v))}
                        aria-label={asset.name || asset.asset_id}
                      />
                      <div className='bg-muted size-10 shrink-0 overflow-hidden rounded-md'>
                        <AssetThumb asset={asset} />
                      </div>
                      <div className='min-w-0 flex-1 space-y-0.5'>
                        <div className='flex items-center gap-1.5'>
                          <span className='text-muted-foreground'>
                            {typeIcon(asset.asset_type)}
                          </span>
                          <span
                            className='truncate text-sm font-medium'
                            title={asset.name}
                          >
                            {asset.name || asset.asset_id}
                          </span>
                        </div>
                        <div className='text-muted-foreground truncate text-xs'>
                          {t('Owner')}: {asset.username || `#${asset.user_id}`}
                        </div>
                        {asset.status === 'failed' && asset.error_msg && (
                          <div className='text-destructive truncate text-xs'>
                            {asset.error_msg}
                          </div>
                        )}
                      </div>
                      <div className='shrink-0'>{statusBadge(asset)}</div>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='text-muted-foreground hover:text-destructive size-7 shrink-0'
                        aria-label={t('Delete Asset')}
                        onClick={(e) => {
                          // 阻止冒泡到行点击，避免删除时误触勾选
                          e.stopPropagation()
                          setDeletingAsset(asset)
                        }}
                      >
                        <Trash2Icon size={14} />
                      </Button>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      {/* 删除素材确认 */}
      <AlertDialog
        open={Boolean(deletingAsset)}
        onOpenChange={(open) => {
          if (!open) setDeletingAsset(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Delete Asset')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('Delete this asset? This action cannot be undone.')}{' '}
              {t(
                'Only the local record is removed; the upstream asset is kept.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className='bg-destructive hover:bg-destructive/90 text-white'
              onClick={() => {
                if (deletingAsset) deleteMutation.mutate(deletingAsset)
              }}
            >
              {deleteMutation.isPending ? t('Deleting...') : t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
