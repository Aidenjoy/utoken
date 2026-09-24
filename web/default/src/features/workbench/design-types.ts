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
import type { TryOnImage } from './types'

/** 两个行业工作台的单项事实素材，不包含其他条目的资料。 */
export interface DesignItem {
  id: string
  name: string
  image: TryOnImage | null
  quantity: number
  notes: string
}

export interface DesignOutput {
  resolution: string
  ratio: string
  count: number
}

export interface DesignRequest {
  prompt: string
  images: string[]
  ratio: string
  label: string
}

export interface DesignPlan {
  requests: DesignRequest[]
  sources: string[]
  continuity?: 'food' | 'packaging'
}

export function createDesignItem(): DesignItem {
  return {
    id: crypto.randomUUID(),
    name: '',
    image: null,
    quantity: 1,
    notes: '',
  }
}

/** 按可见顺序移动；越界操作不修改原列表。 */
export function moveDesignItem<T>(
  items: T[],
  index: number,
  offset: number
): T[] {
  const target = index + offset
  if (
    index < 0 ||
    index >= items.length ||
    target < 0 ||
    target >= items.length
  ) {
    return items
  }
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}
