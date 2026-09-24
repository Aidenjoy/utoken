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

export const PACKAGING_MODES = [
  { value: 'concept', label: 'New packaging concept' },
  { value: 'refresh', label: 'Packaging refresh' },
  { value: 'materials', label: 'Material comparison' },
  { value: 'unboxing', label: 'Gift box unboxing' },
  { value: 'series', label: 'Packaging series' },
  { value: 'display', label: 'Packaging showcase' },
] as const
export type PackagingMode = (typeof PACKAGING_MODES)[number]['value']

export const PACKAGING_SHAPES = [
  { value: 'gift-box', label: 'Gift box' },
  { value: 'carton', label: 'Folding carton' },
  { value: 'mailer', label: 'Shipping box' },
  { value: 'bag', label: 'Shopping bag' },
  { value: 'pouch', label: 'Flexible pouch' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'jar', label: 'Can or jar' },
  { value: 'tube', label: 'Tube' },
] as const
export type PackagingShape = (typeof PACKAGING_SHAPES)[number]['value']

export const PACKAGING_MATERIALS = [
  { value: 'white-card', label: 'White paperboard' },
  { value: 'kraft', label: 'Kraft paper' },
  { value: 'specialty', label: 'Specialty paper' },
  { value: 'wood', label: 'Wood' },
  { value: 'corrugated', label: 'Corrugated paper' },
  { value: 'paper-plastic', label: 'Paper-plastic look' },
  { value: 'plastic', label: 'Plastic' },
  { value: 'foil-laminate', label: 'Foil laminate look' },
  { value: 'glass', label: 'Glass' },
  { value: 'metal', label: 'Metal' },
  { value: 'aluminum', label: 'Aluminum' },
] as const
export type PackagingMaterial = (typeof PACKAGING_MATERIALS)[number]['value']

export const COMPATIBLE_MATERIALS: Record<
  PackagingShape,
  readonly PackagingMaterial[]
> = {
  'gift-box': ['white-card', 'kraft', 'specialty', 'wood'],
  carton: ['white-card', 'kraft', 'specialty'],
  mailer: ['corrugated'],
  bag: ['white-card', 'kraft', 'specialty'],
  pouch: ['paper-plastic', 'plastic', 'foil-laminate'],
  bottle: ['glass', 'plastic'],
  jar: ['metal', 'glass', 'plastic'],
  tube: ['plastic', 'aluminum'],
}
export const PACKAGING_FINISHES: ChipOption[] = [
  { value: 'natural', label: 'Natural surface' },
  { value: 'matte', label: 'Matte' },
  { value: 'gloss', label: 'Glossy' },
  { value: 'foil', label: 'Spot metallic foil' },
  { value: 'emboss', label: 'Embossed texture' },
]
export const PACKAGING_REFRESH: ChipOption[] = [
  { value: 'full', label: 'Full visual refresh' },
  { value: 'label', label: 'Label update' },
  { value: 'sleeve', label: 'Seasonal belly band' },
]
export const PACKAGING_SCENES: ChipOption[] = [
  { value: 'studio', label: 'Clean studio' },
  { value: 'lifestyle', label: 'Lifestyle setting' },
  { value: 'gifting', label: 'Gifting scene' },
]
export const PACKAGING_WARNING =
  'Visual concept only, not a dieline or print-ready file.'

/** 展示模式多比例输出的通用比例选项。 */
export const DESIGN_CHANNELS: ChipOption[] = [
  { value: '1:1', label: 'Square 1:1' },
  { value: '3:4', label: 'Portrait 3:4' },
  { value: '16:9', label: 'Banner 16:9' },
]

export interface MaterialCombination {
  id: string
  material: PackagingMaterial
  finish: string
}
export interface PackagingConfig extends DesignOutput {
  mode: PackagingMode
  brief: string
  master: TryOnImage | null
  products: TryOnImage[]
  brand: TryOnImage | null
  style: TryOnImage | null
  brandName: string
  productName: string
  copy: string
  shape: PackagingShape
  material: PackagingMaterial
  finish: string
  combinations: MaterialCombination[]
  items: DesignItem[]
  refresh: string
  scene: string
  multiRatio: boolean
  channels: string[]
}

export function createPackagingConfig(
  mode: PackagingMode = 'concept'
): PackagingConfig {
  return {
    mode,
    brief: '',
    master: null,
    products: [],
    brand: null,
    style: null,
    brandName: '',
    productName: '',
    copy: '',
    shape: 'gift-box',
    material: 'white-card',
    finish: 'natural',
    combinations: [
      { id: crypto.randomUUID(), material: 'white-card', finish: 'matte' },
      { id: crypto.randomUUID(), material: 'kraft', finish: 'natural' },
    ],
    items: Array.from({ length: mode === 'series' ? 2 : 1 }, createDesignItem),
    refresh: 'full',
    scene: 'studio',
    multiRatio: false,
    channels: ['1:1', '3:4', '16:9'],
    resolution: '2K',
    ratio: 'smart',
    count: 1,
  }
}

/** 形态变化时清除不兼容材质；对比项保持可比较且不保留非法组合。 */
export function changePackagingShape(
  config: PackagingConfig,
  shape: PackagingShape
): PackagingConfig {
  const allowed = COMPATIBLE_MATERIALS[shape]
  const material = allowed.includes(config.material)
    ? config.material
    : allowed[0]
  const combinations = config.combinations.map((item) => ({
    ...item,
    material: allowed.includes(item.material) ? item.material : allowed[0],
  }))
  const seen = new Set<string>()
  for (const item of combinations) {
    if (seen.has(`${item.material}:${item.finish}`)) {
      const available = PACKAGING_FINISHES.find(
        (finish) => !seen.has(`${item.material}:${finish.value}`)
      )
      if (available) item.finish = available.value
    }
    seen.add(`${item.material}:${item.finish}`)
  }
  return { ...config, shape, material, combinations }
}
