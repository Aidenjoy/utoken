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
import type { LucideIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'

interface ShowcaseHintProps {
  icon: LucideIcon
  title: string
  description: string
  badges: string[]
  className?: string
}

/**
 * 案例图下方的统一说明块：图标 + 标题 + 描述 + 关键要素徽标行。
 * 与主图套图·商品套图右侧的丰富提示保持一致，供所有 Workbench showcase 复用。
 */
export function ShowcaseHint(props: ShowcaseHintProps) {
  const Icon = props.icon
  return (
    <div
      className={`flex flex-col items-center gap-3 text-center ${props.className ?? ''}`}
    >
      <span className='border-border bg-card flex size-12 items-center justify-center rounded-xl border'>
        <Icon className='size-6' aria-hidden='true' />
      </span>
      <h2 className='text-lg font-semibold'>{props.title}</h2>
      <p className='text-muted-foreground max-w-md text-sm'>
        {props.description}
      </p>
      {props.badges.length > 0 ? (
        <div className='flex flex-wrap justify-center gap-2'>
          {props.badges.map((badge) => (
            <Badge
              key={badge}
              variant='outline'
              className='bg-card px-3 py-1.5'
            >
              {badge}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}
