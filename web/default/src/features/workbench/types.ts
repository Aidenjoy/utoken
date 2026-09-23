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

/** One uploaded reference material (data URL or asset URL). */
export interface TryOnImage {
  id: string
  src: string
  name: string
}

/** Free try-on workbench configuration: uploaded roles plus output controls. */
export interface TryOnConfig {
  /** Scene/composition references, optional. */
  references: TryOnImage[]
  /** Garment shots to wear, at least one required. */
  garments: TryOnImage[]
  /** Fabric/accessory close-ups that raise garment fidelity, optional. */
  details: TryOnImage[]
  /** Person to dress; when absent the model is system-matched. */
  model: TryOnImage | null
  /** Pose references, optional. */
  actions: TryOnImage[]
  /** Background environment (stage, indoor, etc.), optional. */
  scene: TryOnImage | null
  /** Declares underwear/swimwear/lingerie so styling stays catalog-safe. */
  intimateApparel: boolean
  /** Pose and expression must vary naturally from the references. */
  naturalVariation: boolean
  imageModel: string
  size: string
  ratio: string
  count: number
}

/** Display-ready single-select chip; labels are English i18n sources. */
export interface ChipOption {
  value: string
  label: string
}

/** Outfit combination mode for multi-garment try-on. */
export type OutfitStructure = 'top-bottom' | 'inner-outer' | 'three-piece'

/** Garment slot identity; which slots apply depends on the outfit structure. */
export type MultiGarmentSlot = 'top' | 'bottom' | 'inner' | 'outer'

export interface MultiTryOnConfig {
  structure: OutfitStructure
  /** One image per slot; slots unused by the current structure stay null. */
  slots: Record<MultiGarmentSlot, TryOnImage | null>
  gender: string
  ageGroup: string
  references: TryOnImage[]
  model: TryOnImage | null
  /** Background environment (stage, indoor, etc.), optional. */
  scene: TryOnImage | null
  actions: TryOnImage[]
  /** Pose and expression must vary naturally from the references. */
  naturalVariation: boolean
  resolution: string
  ratio: string
  imageModel: string
  count: number
}

/** Who the two models are to each other in duo try-on. */
export type DuoRelation = 'couple' | 'brothers' | 'besties' | 'parent-child'

export interface DuoTryOnConfig {
  relation: DuoRelation
  /** Pair composition reference: placement, pose relation, framing, background. */
  reference: TryOnImage | null
  colorMode: 'same-color' | 'diff-color'
  /** Garment pieces or colorways; combined per the color mode. */
  garments: TryOnImage[]
  adultModel: TryOnImage | null
  childModel: TryOnImage | null
  /** Background environment (stage, indoor, etc.), optional. */
  scene: TryOnImage | null
  actions: TryOnImage[]
  resolution: string
  ratio: string
  imageModel: string
  count: number
}

/** Design direction tabs of the merchandise design workbench. */
export type DesignDirection =
  | 'creative'
  | 'redesign'
  | 'function'
  | 'material'
  | 'visual'
  | 'series'
  | 'proposal'
  | 'custom'

/** Abstract board layout family; drives the card glyph and the prompt copy. */
export type BoardGlyphKind =
  | 'grid9'
  | 'compare'
  | 'strip'
  | 'steps'
  | 'collage'
  | 'swatch'
  | 'scene'
  | 'quad'
  | 'spread'

/** Board layout shared by presets; badge text is an English i18n source. */
export interface DesignBoardType {
  label: string
  glyph: BoardGlyphKind
  /** English-only layout sentence appended to the prompt. */
  board: string
}

/** One selectable template card under a design direction. */
export interface DesignPreset {
  value: string
  /** Card title, English i18n source. */
  label: string
  boardType: string
  /** English-only design focus sentence appended to the prompt. */
  focus: string
}

export interface ProductDesignConfig {
  /** Source product photo; the only required material. */
  product: TryOnImage | null
  direction: DesignDirection
  /** Selected preset value; ignored when direction is custom. */
  preset: string
  /** Free-text direction used when direction is custom. */
  customBrief: string
  notes: string
  resolution: string
  ratio: string
  imageModel: string
  count: number
}

/** Design direction tabs of the fashion design workbench. */
export type FashionDirection =
  | 'free'
  | 'redesign'
  | 'new'
  | 'series'
  | 'pattern'
  | 'fabric'
  | 'lineart'

/** Upload slot identity a fashion template consumes. */
export type FashionInputKey = 'garment' | 'fabric' | 'reference' | 'lineart'

/** One upload slot declared by a fashion template. */
export interface FashionPresetInput {
  key: FashionInputKey
  /** Slot label, English i18n source. */
  label: string
  required: boolean
  max: number
}

/** One selectable fashion template card. */
export interface FashionPreset {
  value: string
  /** Card title, English i18n source. */
  label: string
  glyph: BoardGlyphKind
  /** Optional marketing pill, English i18n source. */
  tag?: string
  /** Shows the target color picker. */
  usesColor?: boolean
  /** The design description becomes mandatory. */
  needsDescription?: boolean
  inputs: FashionPresetInput[]
  /** English-only transformation sentence appended to the prompt. */
  focus: string
}

export interface FashionDesignConfig {
  direction: FashionDirection
  /** Selected preset value; ignored by free/custom/batch directions. */
  preset: string
  /** Uploaded materials keyed by FashionInputKey. */
  images: Record<FashionInputKey, TryOnImage[]>
  /** Target color hex for recolor templates. */
  color: string
  description: string
  resolution: string
  ratio: string
  imageModel: string
  count: number
}

export interface HeroImageConfig {
  /** Product shots; at least one required, up to three. */
  products: TryOnImage[]
  /** 单张主图模板，仅借鉴构图和文案布局。 */
  template: TryOnImage | null
  /** 标语、价格、指定文案及其他主图补充要求。 */
  extra: string
  /** Values of HERO_CONTENT_ELEMENTS that appear on the hero image. */
  elements: string[]
  resolution: string
  ratio: string
  imageModel: string
  count: number
}

/** Which subject the image-set workbench organizes views around. */
export type HeroSetMode = 'model' | 'product'

/** One selected view angle plus how many images to generate for it. */
export interface HeroSetAngle {
  value: string
  count: number
}

export type ProductSetShotType =
  | 'hero'
  | 'selling'
  | 'scene'
  | 'detail'
  | 'white'
  | 'angle'
  | 'effect'
  | 'structure'

export interface ProductSetShot {
  type: ProductSetShotType
  count: number
  references: TryOnImage[]
  extra: string
}

/** 商品套图独立配置，切换模特套图时保留上传和用途设置。 */
export interface ProductSetConfig {
  products: TryOnImage[]
  /** 整套商品图共用的可选场景，白底图除外。 */
  sceneImage: TryOnImage | null
  withCopy: boolean
  withScene: boolean
  shots: ProductSetShot[]
  extra: string
}

export interface HeroSetConfig {
  mode: HeroSetMode
  product: ProductSetConfig
  /** Single reference shot; its view should match the selected angles. */
  reference: TryOnImage | null
  /** 整套模特图共用的可选场景。 */
  sceneImage: TryOnImage | null
  /** Selected view angles with per-angle output counts. */
  angles: HeroSetAngle[]
  /** Preset overrides for the whole set; empty string means untouched. */
  pose: string
  expression: string
  outfit: string
  scene: string
  other: string
  /** Free-text requirements applied to every image of the model set. */
  extra: string
  resolution: string
  ratio: string
  imageModel: string
}

/** Detail page content module identifier; one entry per DETAIL_CONTENT_ELEMENTS. */
export type DetailPageElementValue =
  | 'copy'
  | 'model'
  | 'scene'
  | 'closeup'
  | 'package'
  | 'size-spec'
  | 'steps'
  | 'brand-ending'

/** 详情页单个内容模块的独立配置，仿商品套图逐用途结构。 */
export interface DetailPageElement {
  value: DetailPageElementValue
  /** 未勾选的模块保留 references/extra，方便来回切换。 */
  enabled: boolean
  /** 该模块专属参考图，进入分配了此模块的页面提示词。 */
  references: TryOnImage[]
  /** 该模块专属补充要求，仅在此模块被分配到的页面注入。 */
  extra: string
}

export interface DetailPageConfig {
  /** Product shots of one sample group; one to five. */
  products: TryOnImage[]
  /** 补充已选内容的商品事实、文案、风格与构图要求。 */
  extra: string
  /** 全部内容模块，按 DETAIL_CONTENT_ELEMENTS 顺序常驻，勾选状态由 enabled 决定。 */
  elements: DetailPageElement[]
  /** 整套详情页共用的可选场景，仅作用于分配了场景模块的页面。 */
  sceneImage: TryOnImage | null
  sceneMode: string
  pageCount: number
  resolution: string
  ratio: string
  imageModel: string
}

/** Which garment shot set the close-up workbench starts from. */
export type CloseUpShotMode = 'position' | 'flat' | 'threed'

export interface GarmentBaseConfig {
  front: TryOnImage | null
  supplement: TryOnImage | null
  generationMode: 'smart' | 'reference'
  reference: TryOnImage | null
  garmentType: string
  note: string
  resolution: string
  ratio: string
}

export interface CloseUpConfig {
  shotMode: CloseUpShotMode
  /** 平铺底图配置独立保存，不复用局部特写或 3D 模式的素材。 */
  flat: GarmentBaseConfig
  /** 3D 底图独立保存素材、出图模式与输出参数。 */
  threed: GarmentBaseConfig
  /** Per-view garment shots used in position mode. */
  front: TryOnImage | null
  side: TryOnImage | null
  back: TryOnImage | null
  /** Detail references lending framing and close-up style. */
  references: TryOnImage[]
  /** Values of CLOSE_UP_PARTS to prioritize; empty means auto-picked. */
  parts: string[]
  /** 'white' keeps a pure white background, 'replicate' follows references. */
  outputMode: string
  /** 'independent' renders one shot per output, 'merged' one composite. */
  genMode: string
  /** Optional model for try-on when the reference shows a person. */
  model: TryOnImage | null
  /** Merchant-written extra content; not a prompt. */
  note: string
  resolution: string
  ratio: string
  imageModel: string
  count: number
}

/** How the dedicated model identity is sourced. */
export type ModelStudioMode = 'compose' | 'restyle' | 'existing'

export interface ModelStudioConfig {
  mode: ModelStudioMode
  /** Three portrait slots fused into one identity in compose mode. */
  faces: (TryOnImage | null)[]
  /** Multi-view slots (front/left/right required, back optional) in existing mode. */
  views: (TryOnImage | null)[]
  /** Existing portrait restyled in restyle mode. */
  model: TryOnImage | null
  /** Optional haircut / hair color references. */
  hairStyle: TryOnImage | null
  hairColor: TryOnImage | null
  resolution: string
  /** 'smart' defers framing to the model; otherwise a numeric W:H ratio. */
  ratio: string
  count: number
  imageModel: string
}
