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
import { useTranslation } from 'react-i18next'

import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import {
  getModelOverviewPriceInfo,
  type ModelOverviewPriceInfo,
  type OverviewPriceField,
  type OverviewPriceRow,
} from '../lib/overview-price'
import type { PricingModel } from '../types'

export type PriceOverviewVariant = 'text' | 'image' | 'video'

type PriceOverviewTableProps = {
  models: PricingModel[]
  priceRate: number
  usdExchangeRate: number
  variant: PriceOverviewVariant
}

type VendorGroup = {
  vendorName: string
  vendorIcon?: string
  models: PricingModel[]
}

type VideoTier = {
  resolution: string | null
  withoutVideo?: OverviewPriceRow
  withVideo?: OverviewPriceRow
}

type ColumnDef = { field: OverviewPriceField; labelKey: string }

/** One desktop <tr>: a video model emits one row per resolution tier. */
type BodyRow = {
  key: string
  group: VendorGroup
  model: PricingModel
  info: ModelOverviewPriceInfo
  modelRowSpan: number
  /** First row of the whole vendor group: renders the spanning vendor cell. */
  showVendor: boolean
  /** First row of this model: renders the (possibly spanning) model cell. */
  showModel: boolean
  tier?: VideoTier
}

const TEXT_COLUMNS: ColumnDef[] = [
  { field: 'input', labelKey: 'Input' },
  { field: 'output', labelKey: 'Output' },
  { field: 'cached', labelKey: 'Cached' },
]

const IMAGE_COLUMNS: ColumnDef[] = [
  { field: 'input', labelKey: 'Input image price' },
  { field: 'output', labelKey: 'Output image price' },
]

const VENDOR_CELL_CLASS =
  'border-border bg-violet-50/60 dark:bg-violet-950/25 border-b border-r px-4 py-3 align-middle'

function groupByVendor(models: PricingModel[]): VendorGroup[] {
  const groups: VendorGroup[] = []
  for (const model of models) {
    const vendorName = model.vendor_name || '—'
    const last = groups.at(-1)
    if (last && last.vendorName === vendorName) {
      last.models.push(model)
      continue
    }
    groups.push({
      vendorName,
      vendorIcon: model.vendor_icon,
      models: [model],
    })
  }
  return groups
}

/**
 * Pivot a model's seedance billing rows into one tier per resolution so the
 * desktop table can show resolution / without-video / with-video columns.
 * Rows without a resolution (e.g. per-request video models) collapse into a
 * single tier rendered as one merged price cell.
 */
function getVideoTiers(rows: OverviewPriceRow[]): VideoTier[] {
  const tiers: VideoTier[] = []
  for (const row of rows) {
    if (!row.labelPrefix) {
      tiers.push({ resolution: null, withoutVideo: row })
      continue
    }
    let tier = tiers.find((item) => item.resolution === row.labelPrefix)
    if (!tier) {
      tier = { resolution: row.labelPrefix }
      tiers.push(tier)
    }
    if (row.labelKey === 'With video input') tier.withVideo = row
    else tier.withoutVideo = row
  }
  return tiers.length > 0 ? tiers : [{ resolution: null }]
}

function PriceValue(props: { value: string | null; unit?: string | null }) {
  if (!props.value) return <span className='text-muted-foreground/40'>—</span>
  return (
    <span className='inline-flex items-baseline gap-1 whitespace-nowrap'>
      <span className='font-semibold text-violet-700 tabular-nums dark:text-violet-300'>
        {props.value}
      </span>
      {props.unit && (
        <span className='text-muted-foreground text-[11px] font-normal'>
          {props.unit}
        </span>
      )}
    </span>
  )
}

function BillingRows(props: { rows: OverviewPriceRow[] }) {
  const { t } = useTranslation()
  return (
    <div className='space-y-1.5'>
      {props.rows.map((row) => (
        <div
          key={`${row.labelPrefix ?? ''}-${row.labelKey}`}
          className='flex items-baseline justify-between gap-4'
        >
          <span className='text-foreground text-[13px] font-medium'>
            {row.labelPrefix ? `${row.labelPrefix} · ` : ''}
            {t(row.labelKey)}
          </span>
          <PriceValue value={row.value} unit={row.sub} />
        </div>
      ))}
    </div>
  )
}

function ModelName(props: { model: PricingModel; special: boolean }) {
  const { t } = useTranslation()
  const iconKey = props.model.icon || props.model.vendor_icon
  return (
    <div className='flex min-w-0 items-center gap-2.5'>
      {iconKey && getLobeIcon(iconKey, 18)}
      <div className='min-w-0'>
        <div className='font-mono text-[13px] font-semibold break-all'>
          {props.model.model_name}
        </div>
        {props.special && (
          <div className='text-muted-foreground mt-0.5 text-xs'>
            {t('Dynamic Pricing')}
          </div>
        )}
      </div>
    </div>
  )
}

function VendorLabel(props: { group: VendorGroup }) {
  return (
    <span className='inline-flex items-center gap-2 text-sm'>
      {props.group.vendorIcon && getLobeIcon(props.group.vendorIcon, 16)}
      <span>{props.group.vendorName}</span>
    </span>
  )
}

export function PriceOverviewTable(props: PriceOverviewTableProps) {
  const { t } = useTranslation()

  if (props.models.length === 0) {
    return (
      <div className='bg-card rounded-xl border px-6 py-16 text-center'>
        <p className='font-medium'>{t('No Models Found')}</p>
        <p className='text-muted-foreground mt-1 text-sm'>
          {t('No models match your current filters.')}
        </p>
      </div>
    )
  }

  const groups = groupByVendor(props.models)
  const getInfo = (model: PricingModel) =>
    getModelOverviewPriceInfo(model, {
      priceRate: props.priceRate,
      usdExchangeRate: props.usdExchangeRate,
      translate: t,
    })
  const rowValue = (rows: OverviewPriceRow[], field: OverviewPriceField) =>
    rows.find((row) => row.field === field)

  const bodyRows: BodyRow[] = []
  // Rowspan of the vendor cell = number of body rows in that vendor group.
  const vendorSpans = new Map<VendorGroup, number>()
  for (const group of groups) {
    const prepared = group.models.map((model) => {
      const info = getInfo(model)
      const tiers =
        props.variant === 'video' ? getVideoTiers(info.rows) : undefined
      return { model, info, tiers }
    })
    vendorSpans.set(
      group,
      prepared.reduce((total, entry) => total + (entry.tiers?.length ?? 1), 0)
    )
    prepared.forEach((entry, modelIndex) => {
      const modelRowSpan = entry.tiers?.length ?? 1
      const modelKey = String(entry.model.id ?? entry.model.model_name)
      if (entry.tiers) {
        entry.tiers.forEach((tier, tierIndex) => {
          bodyRows.push({
            key: `${modelKey}-${tier.resolution ?? tierIndex}`,
            group,
            model: entry.model,
            info: entry.info,
            modelRowSpan,
            showVendor: modelIndex === 0 && tierIndex === 0,
            showModel: tierIndex === 0,
            tier,
          })
        })
      } else {
        bodyRows.push({
          key: modelKey,
          group,
          model: entry.model,
          info: entry.info,
          modelRowSpan,
          showVendor: modelIndex === 0,
          showModel: true,
        })
      }
    })
  }

  const columns = props.variant === 'text' ? TEXT_COLUMNS : IMAGE_COLUMNS

  return (
    <div className='bg-card overflow-hidden rounded-xl border shadow-xs'>
      {/* Desktop: grouped table with a spanning vendor column */}
      <table
        className='hidden w-full border-collapse text-left md:table'
        aria-label={t('Model Price Overview')}
      >
        <thead className='bg-muted/45'>
          <tr className='text-muted-foreground border-border text-xs font-medium [&>th]:border-r [&>th]:border-b [&>th:last-child]:border-r-0'>
            <th className='w-44 px-4 py-3'>{t('Vendor')}</th>
            <th className='px-4 py-3'>{t('Model')}</th>
            {props.variant === 'video' ? (
              <>
                <th className='w-24 px-4 py-3'>{t('Resolution')}</th>
                <th className='w-52 px-4 py-3 text-right'>
                  {t('Without video input')}
                </th>
                <th className='w-52 px-4 py-3 text-right'>
                  {t('With video input')}
                </th>
              </>
            ) : (
              columns.map((column) => (
                <th key={column.labelKey} className='w-48 px-4 py-3 text-right'>
                  {t(column.labelKey)}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {bodyRows.map((row, rowIndex) => {
            // Zebra striping stays continuous across vendor groups; rowspan
            // cells ignore tr backgrounds, so the stripe goes on every td.
            const stripe = rowIndex % 2 === 1 ? 'bg-muted/60' : 'bg-card'
            const cellClass = cn(
              'border-border border-b border-r px-4 py-3 last:border-r-0',
              stripe
            )
            const tier = row.tier
            const fallbackPrice =
              tier && tier.resolution === null && !tier.withVideo
                ? tier.withoutVideo
                : undefined
            return (
              <tr
                key={row.key}
                className='hover:[&>td]:bg-primary/5 transition-colors'
              >
                {row.showVendor && (
                  <td
                    rowSpan={vendorSpans.get(row.group)}
                    className={VENDOR_CELL_CLASS}
                  >
                    <VendorLabel group={row.group} />
                  </td>
                )}
                {row.showModel && (
                  <td
                    rowSpan={
                      row.modelRowSpan > 1 ? row.modelRowSpan : undefined
                    }
                    className={cn(cellClass, 'align-middle')}
                  >
                    <ModelName
                      model={row.model}
                      special={row.info.isSpecialExpression}
                    />
                  </td>
                )}
                {fallbackPrice && (
                  <td colSpan={3} className={cn(cellClass, 'text-right')}>
                    <PriceValue
                      value={fallbackPrice.value}
                      unit={fallbackPrice.sub}
                    />
                  </td>
                )}
                {tier && !fallbackPrice && (
                  <>
                    <td className={cellClass}>{tier.resolution ?? '—'}</td>
                    <td className={cn(cellClass, 'text-right')}>
                      <PriceValue
                        value={tier.withoutVideo?.value ?? null}
                        unit={tier.withoutVideo?.sub}
                      />
                    </td>
                    <td className={cn(cellClass, 'text-right')}>
                      <PriceValue
                        value={tier.withVideo?.value ?? null}
                        unit={tier.withVideo?.sub}
                      />
                    </td>
                  </>
                )}
                {!tier &&
                  columns.map((column) => {
                    const priceRow = rowValue(row.info.rows, column.field)
                    return (
                      <td
                        key={column.labelKey}
                        className={cn(cellClass, 'text-right')}
                      >
                        <PriceValue
                          value={priceRow?.value ?? null}
                          unit={priceRow?.sub}
                        />
                      </td>
                    )
                  })}
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Mobile: one card per model, vendor repeated as a caption line */}
      <div className='md:hidden' aria-label={t('Model Price Overview')}>
        {groups.map((group) =>
          group.models.map((model) => {
            const info = getInfo(model)
            return (
              <div
                key={model.id ?? model.model_name}
                className='border-border/60 border-b px-4 py-3.5 last:border-b-0'
              >
                <div className='text-muted-foreground mb-1.5'>
                  <VendorLabel group={group} />
                </div>
                <ModelName model={model} special={info.isSpecialExpression} />
                <div className='mt-3'>
                  {props.variant === 'video' ? (
                    <BillingRows rows={info.rows} />
                  ) : (
                    <div className='space-y-1.5'>
                      {columns.map((column) => {
                        const priceRow = rowValue(info.rows, column.field)
                        return (
                          <div
                            key={column.labelKey}
                            className='flex items-baseline justify-between gap-4'
                          >
                            <span className='text-muted-foreground text-xs'>
                              {t(column.labelKey)}
                            </span>
                            <PriceValue
                              value={priceRow?.value ?? null}
                              unit={priceRow?.sub}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
