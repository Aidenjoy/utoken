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

export type CostSummaryRow = {
  label: string
  value: string
}

export type CostSummaryProps = {
  rows: CostSummaryRow[]
  total?: CostSummaryRow
}

/** Live breakdown of the estimated cost; values are pre-formatted strings. */
export function CostSummary(props: CostSummaryProps) {
  const { t } = useTranslation()

  return (
    <div className='border-border bg-card space-y-2 rounded-lg border p-4'>
      <h3 className='text-sm font-medium'>{t('Estimated Cost')}</h3>
      <dl className='space-y-1'>
        {props.rows.map((row) => (
          <div
            key={row.label}
            className='text-muted-foreground flex items-center justify-between gap-4 text-sm'
          >
            <dt>{row.label}</dt>
            <dd className='tabular-nums'>{row.value}</dd>
          </div>
        ))}
      </dl>
      {props.total ? (
        <div className='border-border flex items-center justify-between gap-4 border-t pt-2 text-sm font-medium'>
          <span>{props.total.label}</span>
          <span className='tabular-nums'>{props.total.value}</span>
        </div>
      ) : null}
    </div>
  )
}
