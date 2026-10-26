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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import { fetchChannelPrices, saveChannelPrices } from '../api'
import type { UpstreamPrices } from '../types'

interface PriceRow {
  id: number
  model: string
  input: string
  output: string
}

interface ChannelPricesDialogProps {
  channel: { id: number; name: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Per-channel upstream rate card editor. Prices are USD per 1M tokens, kept
 * separate from downstream (model-square) selling prices. An empty card means
 * the channel reconciles on tokens only, with no cost estimate.
 */
export function ChannelPricesDialog({
  channel,
  open,
  onOpenChange,
}: ChannelPricesDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<PriceRow[]>([])
  const [saving, setSaving] = useState(false)
  // Stable per-row ids so React keys never depend on array index (rows can be
  // added/removed and may share empty model names while being edited).
  const nextRowId = useRef(0)

  const { data, isLoading } = useQuery({
    queryKey: ['channel-prices', channel?.id],
    queryFn: async () => {
      if (!channel) return {} as UpstreamPrices
      const result = await fetchChannelPrices(channel.id)
      return result.data?.prices ?? ({} as UpstreamPrices)
    },
    enabled: open && channel !== null,
  })

  useEffect(() => {
    if (open && data) {
      setRows(
        Object.entries(data).map(([model, price]) => ({
          id: nextRowId.current++,
          model,
          input: String(price.input),
          output: String(price.output),
        }))
      )
    }
  }, [open, data])

  const updateRow = (id: number, patch: Partial<PriceRow>) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row))
    )
  }

  const handleSave = async () => {
    if (!channel) return
    const prices: UpstreamPrices = {}
    for (const row of rows) {
      const model = row.model.trim()
      if (!model) continue
      const input = Number(row.input)
      const output = Number(row.output)
      if (
        !Number.isFinite(input) ||
        !Number.isFinite(output) ||
        input < 0 ||
        output < 0
      ) {
        toast.error(t('Prices must be non-negative numbers'))
        return
      }
      prices[model] = { input, output }
    }
    setSaving(true)
    try {
      const result = await saveChannelPrices(channel.id, prices)
      if (!result.success) {
        toast.error(result.message || t('Failed to save'))
        return
      }
      toast.success(t('Saved successfully'))
      queryClient.invalidateQueries({ queryKey: ['channel-billing-records'] })
      queryClient.invalidateQueries({ queryKey: ['channel-prices'] })
      onOpenChange(false)
    } catch {
      toast.error(t('Failed to save'))
    } finally {
      setSaving(false)
    }
  }

  const renderRows = () => {
    if (isLoading) {
      return (
        <p className='text-muted-foreground py-4 text-center text-sm'>
          {t('Loading...')}
        </p>
      )
    }
    if (rows.length === 0) {
      return (
        <p className='text-muted-foreground py-4 text-center text-sm'>
          {t('No prices configured. Add a model to estimate cost.')}
        </p>
      )
    }
    return rows.map((row) => (
      <div
        key={row.id}
        className='grid grid-cols-[1fr_90px_90px_32px] items-center gap-2'
      >
        <Input
          className='h-8 font-mono text-xs'
          value={row.model}
          placeholder={t('Model name')}
          onChange={(e) => updateRow(row.id, { model: e.target.value })}
        />
        <Input
          className='h-8 text-right font-mono text-xs tabular-nums'
          type='number'
          min='0'
          step='any'
          value={row.input}
          onChange={(e) => updateRow(row.id, { input: e.target.value })}
        />
        <Input
          className='h-8 text-right font-mono text-xs tabular-nums'
          type='number'
          min='0'
          step='any'
          value={row.output}
          onChange={(e) => updateRow(row.id, { output: e.target.value })}
        />
        <Button
          variant='ghost'
          size='icon-sm'
          onClick={() =>
            setRows((current) => current.filter((item) => item.id !== row.id))
          }
        >
          <Trash2 className='text-muted-foreground size-4' />
        </Button>
      </div>
    ))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('Upstream Prices')}</DialogTitle>
          <DialogDescription>
            {channel
              ? `${channel.name || t('Channel')} #${channel.id} · ${t(
                  'USD per 1M tokens'
                )}`
              : t('USD per 1M tokens')}
          </DialogDescription>
        </DialogHeader>

        <div className='max-h-[50vh] space-y-2 overflow-y-auto'>
          <div className='text-muted-foreground grid grid-cols-[1fr_90px_90px_32px] gap-2 text-xs'>
            <span>{t('Model')}</span>
            <span className='text-right'>{t('Input')}</span>
            <span className='text-right'>{t('Output')}</span>
            <span />
          </div>
          {renderRows()}
          <Button
            variant='outline'
            size='sm'
            className='w-full'
            onClick={() =>
              setRows((current) => [
                ...current,
                { id: nextRowId.current++, model: '', input: '', output: '' },
              ])
            }
          >
            <Plus />
            {t('Add Model')}
          </Button>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving || isLoading}>
            {saving ? t('Saving...') : t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
