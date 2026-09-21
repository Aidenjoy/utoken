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

/** Which image set lends the atmosphere of the generated shots. */
export type AtmosphereSource = 'reference' | 'action'

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
  garmentName: string
  /** Declares underwear/swimwear/lingerie so styling stays catalog-safe. */
  intimateApparel: boolean
  atmosphereSource: AtmosphereSource
  /** Pose and expression must vary naturally from the references. */
  naturalVariation: boolean
  imageModel: string
  size: string
  count: number
}

/** One generation run kept in local history. */
export interface TryOnTask {
  id: string
  createdAt: number
  imageModel: string
  size: string
  count: number
  prompt: string
  results: string[]
  garmentThumbs: string[]
  modelThumb: string | null
  error?: string
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
  garmentName: string
  structure: OutfitStructure
  /** One image per slot; slots unused by the current structure stay null. */
  slots: Record<MultiGarmentSlot, TryOnImage | null>
  gender: string
  ageGroup: string
  description: string
  references: TryOnImage[]
  model: TryOnImage | null
  outputMode: string
  pose: string
  orientation: string
  expression: string
  actionNote: string
  actions: TryOnImage[]
  resolution: string
  ratio: string
  imageModel: string
  count: number
}

/** Who the two models are to each other in duo try-on. */
export type DuoRelation = 'couple' | 'brothers' | 'besties' | 'parent-child'

export interface DuoTryOnConfig {
  garmentName: string
  relation: DuoRelation
  /** Pair composition reference: placement, pose relation, framing, background. */
  reference: TryOnImage | null
  colorMode: 'same-color' | 'diff-color'
  /** One colorway per image when the same design comes in different colors. */
  garments: TryOnImage[]
  garmentStyle: string
  description: string
  adultModel: TryOnImage | null
  childModel: TryOnImage | null
  outputMode: string
  pose: string
  orientation: string
  expression: string
  actionNote: string
  actions: TryOnImage[]
  naturalVariation: boolean
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
  | 'custom'
  | 'batch'

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

/** Person handling for hero images whose product shots contain a person. */
export type HeroPersonMode = 'keep' | 'replace'

export interface HeroImageConfig {
  /** Product shots; at least one required, up to three. */
  products: TryOnImage[]
  /** Hero layout templates; only composition and text zones are borrowed. */
  templates: TryOnImage[]
  /** Visible product features; drives hero copy and composition. */
  description: string
  /** Hard constraints such as logo safety or background tone. */
  extra: string
  /** Values of HERO_CONTENT_ELEMENTS that appear on the hero image. */
  elements: string[]
  personMode: HeroPersonMode
  /** Replacement model; null lets AI generate one. */
  model: TryOnImage | null
  outputMode: string
  pose: string
  orientation: string
  expression: string
  actionNote: string
  /** Pose/framing references matched randomly across outputs. */
  actions: TryOnImage[]
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

export interface HeroSetConfig {
  mode: HeroSetMode
  /** Single reference shot; its view should match the selected angles. */
  reference: TryOnImage | null
  /** Selected view angles with per-angle output counts. */
  angles: HeroSetAngle[]
  /** Preset overrides for the whole set; empty string means untouched. */
  pose: string
  expression: string
  outfit: string
  scene: string
  other: string
  resolution: string
  ratio: string
  imageModel: string
}

export interface DetailPageConfig {
  /** Product shots of one sample group; one to five. */
  products: TryOnImage[]
  /** Recognized or hand-filled product facts driving the page copy. */
  name: string
  selling: string
  audience: string
  scene: string
  /** Values of DETAIL_CONTENT_ELEMENTS that become detail page modules. */
  elements: string[]
  textLanguage: string
  sceneMode: string
  pageCount: number
  resolution: string
  ratio: string
  imageModel: string
}

/** Which garment shot set the close-up workbench starts from. */
export type CloseUpShotMode = 'position' | 'flat' | 'threed'

export interface CloseUpConfig {
  shotMode: CloseUpShotMode
  /** Per-view garment shots used in position mode. */
  front: TryOnImage | null
  side: TryOnImage | null
  back: TryOnImage | null
  /** Single garment shot used in flat / threed mode. */
  garment: TryOnImage | null
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
  /** Existing portrait restyled or registered as-is. */
  model: TryOnImage | null
  /** Optional haircut / hair color references. */
  hairStyle: TryOnImage | null
  hairColor: TryOnImage | null
  resolution: string
  count: number
  imageModel: string
}
