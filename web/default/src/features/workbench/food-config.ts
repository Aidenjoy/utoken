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
  createDesignItem,
  type DesignItem,
  type DesignOutput,
} from './design-types'
import type { ChipOption, TryOnImage } from './types'

export const FOOD_MODES = [
  { value: 'retouch', label: 'Dish retouch' },
  { value: 'batch', label: 'Batch menu photos' },
  { value: 'combo', label: 'Meal combinations' },
  { value: 'poster', label: 'Food campaign poster' },
] as const
export type FoodMode = (typeof FOOD_MODES)[number]['value']

export const FOOD_BACKGROUNDS: ChipOption[] = [
  { value: 'original', label: 'Keep original background' },
  { value: 'clean', label: 'Clean tabletop' },
  { value: 'dark', label: 'Dark dining mood' },
]
export const FOOD_OCCASIONS: ChipOption[] = [
  { value: 'new', label: 'New dish launch' },
  { value: 'seasonal', label: 'Seasonal promotion' },
  { value: 'daily', label: 'Everyday recommendation' },
]
export const FOOD_WARNING =
  'AI may change details. Check ingredients, portions and text before use.'

export interface FoodConfig extends DesignOutput {
  mode: FoodMode
  items: DesignItem[]
  style: TryOnImage | null
  background: string
  occasion: string
  copyMode: 'none' | 'short'
  title: string
  subtitle: string
  offer: string
}

export function createFoodConfig(mode: FoodMode = 'retouch'): FoodConfig {
  return {
    mode,
    items: Array.from({ length: mode === 'combo' ? 2 : 1 }, createDesignItem),
    style: null,
    background: 'clean',
    occasion: 'new',
    copyMode: 'none',
    title: '',
    subtitle: '',
    offer: '',
    resolution: '2K',
    ratio: 'smart',
    count: 1,
  }
}
