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
import { ImageOff, Loader2 } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import { listAssets, proxyImageUrl } from '../api'
import type { CanvasAsset } from '../types'

// 智能画布：素材库选择器
// 既用于「从素材库导入到画布」，也用于挑选额外参考图（多图参考 / 参考图局部编辑）。

interface AssetPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  multiple?: boolean
  /** 已被选中的 refId，二次打开时保持勾选状态 */
  selectedRefIds?: string[]
  onConfirm: (assets: CanvasAsset[]) => void
}

export function AssetPickerDialog(props: AssetPickerDialogProps) {
  const { t } = useTranslation()
  const [picked, setPicked] = React.useState<string[]>([])

  React.useEffect(() => {
    if (props.open) setPicked(props.selectedRefIds ?? [])
  }, [props.open, props.selectedRefIds])

  const { data, isPending } = useQuery({
    queryKey: ['canvas', 'assets'],
    queryFn: () => listAssets({}),
    enabled: props.open,
    staleTime: 30_000,
  })

  const assets = data?.items ?? []

  const toggle = (refId: string) => {
    if (!props.multiple) {
      setPicked([refId])
      return
    }
    setPicked((prev) =>
      prev.includes(refId)
        ? prev.filter((id) => id !== refId)
        : [...prev, refId]
    )
  }

  const renderBody = () => {
    if (isPending) {
      return (
        <div className='text-muted-foreground flex h-[180px] items-center justify-center gap-2 text-sm'>
          <Loader2 className='animate-spin' size={16} />
          {t('Loading...')}
        </div>
      )
    }
    if (assets.length === 0) {
      return (
        <div className='text-muted-foreground flex h-[180px] flex-col items-center justify-center gap-2 text-sm'>
          <ImageOff size={20} />
          {t('No assets in the library yet')}
        </div>
      )
    }
    return (
      <div className='grid grid-cols-3 gap-2 sm:grid-cols-4'>
        {assets.map((asset) => {
          const active = picked.includes(asset.refId)
          return (
            <button
              key={asset.refId}
              type='button'
              onClick={() => toggle(asset.refId)}
              className={cn(
                'group relative overflow-hidden rounded-md border',
                active ? 'ring-primary ring-2' : 'hover:border-primary/60'
              )}
            >
              <img
                src={proxyImageUrl(asset.url)}
                alt={asset.name}
                className='bg-muted aspect-square w-full object-cover'
                loading='lazy'
              />
              <span className='bg-background/85 absolute inset-x-0 bottom-0 truncate px-1.5 py-1 text-[11px]'>
                {asset.name || asset.refId}
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{props.title}</DialogTitle>
          {props.description ? (
            <DialogDescription>{props.description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <div className='max-h-[55vh] min-h-[180px] overflow-y-auto'>
          {renderBody()}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={picked.length === 0}
            onClick={() => {
              const selected = assets.filter((asset) =>
                picked.includes(asset.refId)
              )
              props.onConfirm(selected)
              props.onOpenChange(false)
            }}
          >
            {props.multiple
              ? t('Import {{count}} selected', { count: picked.length })
              : t('Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
