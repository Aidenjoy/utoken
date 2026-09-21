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
import type {
  ChipOption,
  CloseUpConfig,
  DesignBoardType,
  DesignDirection,
  DesignPreset,
  DetailPageConfig,
  DuoTryOnConfig,
  FashionDesignConfig,
  FashionDirection,
  FashionPreset,
  FashionPresetInput,
  HeroImageConfig,
  HeroSetConfig,
  ModelStudioConfig,
  MultiGarmentSlot,
  MultiTryOnConfig,
  OutfitStructure,
  ProductDesignConfig,
  TryOnConfig,
} from './types'

/** Session-authenticated image generation endpoint shared with the playground. */
export const TRY_ON_GENERATIONS_ENDPOINT = '/pg/images/generations'

/** Garment shots plus detail close-ups share one ten-image budget. */
export const GARMENT_PLUS_DETAIL_MAX = 10
export const REFERENCE_MAX = 9
export const ACTION_MAX = 9
/** Single upload ceiling in bytes; data URLs go into the request body. */
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024

export const TRY_ON_SIZES = ['1K', '2K', '4K'] as const
export const TRY_ON_COUNTS = [1, 2, 4] as const

export const TRY_ON_STORAGE_KEY = 'try-on-tasks-v1'
export const MULTI_TRY_ON_STORAGE_KEY = 'multi-try-on-tasks-v1'
export const DUO_TRY_ON_STORAGE_KEY = 'duo-try-on-tasks-v1'
export const PRODUCT_DESIGN_STORAGE_KEY = 'product-design-tasks-v1'
export const FASHION_DESIGN_STORAGE_KEY = 'fashion-design-tasks-v1'
export const HERO_IMAGE_STORAGE_KEY = 'hero-image-tasks-v1'
export const TRY_ON_TASK_MAX = 24

export function createDefaultTryOnConfig(): TryOnConfig {
  return {
    references: [],
    garments: [],
    details: [],
    model: null,
    actions: [],
    garmentName: '',
    intimateApparel: false,
    atmosphereSource: 'reference',
    naturalVariation: false,
    imageModel: '',
    size: '2K',
    count: 2,
  }
}

/** Pose/expression/output controls shared by the structured try-on pages. */
export const TRY_ON_OUTPUT_MODES: ChipOption[] = [
  { value: 'recreate', label: 'Full recreation' },
  { value: 'keep-original', label: 'Keep original action and background' },
]

export const TRY_ON_POSES: ChipOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'standing', label: 'Standing' },
  { value: 'sitting', label: 'Sitting' },
  { value: 'walking', label: 'Walking' },
  { value: 'leaning', label: 'Leaning' },
  { value: 'lying', label: 'Lying down' },
  { value: 'handheld', label: 'Handheld display' },
]

export const TRY_ON_ORIENTATIONS: ChipOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'back', label: 'Back view' },
  { value: 'two-thirds', label: 'Two-thirds side' },
]

export const TRY_ON_EXPRESSIONS: ChipOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'natural-smile', label: 'Natural smile' },
  { value: 'bright-smile', label: 'Bright smile' },
  { value: 'warm', label: 'Warm and approachable' },
  { value: 'confident', label: 'Confident' },
  { value: 'cool', label: 'Cool and premium' },
  { value: 'playful', label: 'Playful' },
  { value: 'surprised', label: 'Surprised' },
  { value: 'focused', label: 'Focused' },
  { value: 'none', label: 'Expressionless' },
]

/** Numeric ratios render as-is, so their labels are not i18n keys. */
export const TRY_ON_RATIOS: ChipOption[] = [
  { value: 'smart', label: 'Smart' },
  { value: '3:4', label: '3:4' },
  { value: '1:1', label: '1:1' },
  { value: '9:16', label: '9:16' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '5:4', label: '5:4' },
  { value: '4:5', label: '4:5' },
  { value: '21:9', label: '21:9' },
]

export const MULTI_STRUCTURES: {
  value: OutfitStructure
  label: string
  slots: MultiGarmentSlot[]
}[] = [
  { value: 'top-bottom', label: 'Top + bottom', slots: ['top', 'bottom'] },
  { value: 'inner-outer', label: 'Inner + outer', slots: ['inner', 'outer'] },
  {
    value: 'three-piece',
    label: '3-piece set',
    slots: ['inner', 'outer', 'bottom'],
  },
]

export const MULTI_SLOT_LABELS: Record<MultiGarmentSlot, string> = {
  top: 'Upload top',
  bottom: 'Upload bottom',
  inner: 'Upload inner',
  outer: 'Upload outer',
}

export const MULTI_GENDERS: ChipOption[] = [
  { value: 'women', label: 'Women' },
  { value: 'men', label: 'Men' },
]

export const MULTI_AGE_GROUPS: ChipOption[] = [
  { value: 'adult', label: 'Adults' },
  { value: 'teen', label: 'Teens' },
  { value: 'older-kids', label: 'Older kids' },
  { value: 'middle-kids', label: 'Middle kids' },
  { value: 'younger-kids', label: 'Younger kids' },
  { value: 'toddler', label: 'Toddlers' },
]

export function createDefaultMultiTryOnConfig(): MultiTryOnConfig {
  return {
    garmentName: '',
    structure: 'top-bottom',
    slots: { top: null, bottom: null, inner: null, outer: null },
    gender: 'women',
    ageGroup: 'adult',
    description: '',
    references: [],
    model: null,
    outputMode: 'recreate',
    pose: 'auto',
    orientation: 'auto',
    expression: 'auto',
    actionNote: '',
    actions: [],
    resolution: '1K',
    ratio: 'smart',
    imageModel: '',
    count: 2,
  }
}

export const DUO_RELATIONS: ChipOption[] = [
  { value: 'couple', label: 'Couple matching' },
  { value: 'brothers', label: 'Brothers' },
  { value: 'besties', label: 'Besties' },
  { value: 'parent-child', label: 'Parent-child' },
]

export const DUO_COLOR_MODES: ChipOption[] = [
  { value: 'same-color', label: 'Same style same color' },
  { value: 'diff-color', label: 'Same style different colors' },
]

export const DUO_GARMENT_STYLES: ChipOption[] = [
  { value: 'top', label: 'Tops' },
  { value: 'bottom', label: 'Bottoms' },
  { value: 'dress', label: 'Dress / one-piece' },
  { value: 'set', label: 'Set' },
]

export function createDefaultDuoTryOnConfig(): DuoTryOnConfig {
  return {
    garmentName: '',
    relation: 'couple',
    reference: null,
    colorMode: 'same-color',
    garments: [],
    garmentStyle: 'top',
    description: '',
    adultModel: null,
    childModel: null,
    outputMode: 'recreate',
    pose: 'auto',
    orientation: 'auto',
    expression: 'auto',
    actionNote: '',
    actions: [],
    naturalVariation: false,
    resolution: '1K',
    ratio: 'smart',
    imageModel: '',
    count: 2,
  }
}

/** Eight design direction tabs; custom replaces the template gallery. */
export const DESIGN_DIRECTIONS: ChipOption[] = [
  { value: 'creative', label: 'Creative extension' },
  { value: 'redesign', label: 'Redesign' },
  { value: 'function', label: 'Function experience' },
  { value: 'material', label: 'Material & craft' },
  { value: 'visual', label: 'Visual style' },
  { value: 'series', label: 'Series extension' },
  { value: 'proposal', label: 'Design proposal' },
  { value: 'custom', label: 'Custom' },
]

/** Board layouts shared by presets; board sentences stay English-only. */
export const DESIGN_BOARD_TYPES: Record<string, DesignBoardType> = {
  'nine-grid': {
    label: 'Nine-grid',
    glyph: 'grid9',
    board:
      'a 3x3 nine-grid board: nine labeled cells, each a self-contained variation shot',
  },
  'concept-board': {
    label: 'Concept board',
    glyph: 'collage',
    board:
      'a concept board: one hero cell plus mixed-size inspiration cells with short annotations',
  },
  'before-after': {
    label: 'Before / after',
    glyph: 'compare',
    board:
      'a before-and-after comparison board: source shot on the left, redesigned shot on the right, linked by an arrow',
  },
  'concept-strip': {
    label: 'Concept strip',
    glyph: 'strip',
    board:
      'a horizontal concept strip: four to five sequential concept cells with keyword captions',
  },
  'four-way': {
    label: 'Four-way',
    glyph: 'quad',
    board:
      'a 2x2 exploration board: four clearly different design directions, one per cell',
  },
  'step-board': {
    label: 'Step board',
    glyph: 'steps',
    board:
      'a step-by-step board: numbered cells showing the mechanism from folded to deployed state',
  },
  cutaway: {
    label: 'Cutaway',
    glyph: 'collage',
    board:
      'a cutaway board: opened and sectioned views exposing the internal layout with callouts',
  },
  'structure-breakdown': {
    label: 'Structure breakdown',
    glyph: 'collage',
    board:
      'an exploded structure board: the product disassembled into modules with part labels',
  },
  'change-annot': {
    label: 'Change annotations',
    glyph: 'compare',
    board:
      'an annotation board: before and after shots with marked add, remove and swap callouts',
  },
  ergonomics: {
    label: 'Ergonomics',
    glyph: 'scene',
    board:
      'a human-factors board: the product in use on a body with comfort and reach annotations',
  },
  'scene-plan': {
    label: 'Scene plan',
    glyph: 'scene',
    board:
      'a scene board: the product staged in several real usage scenarios with scene notes',
  },
  'operation-flow': {
    label: 'Operation flow',
    glyph: 'strip',
    board:
      'an operation-flow board: sequential cells showing one-hand carry and quick-access steps',
  },
  'risk-map': {
    label: 'Risk map',
    glyph: 'collage',
    board:
      'a protection board: hazard cells plus the reinforced design countermeasures',
  },
  maintenance: {
    label: 'Maintenance plan',
    glyph: 'steps',
    board:
      'a maintenance board: numbered cells for part replacement and repair access',
  },
  'series-plan': {
    label: 'Series plan',
    glyph: 'strip',
    board:
      'a series board: sibling products in the same material language across form factors',
  },
  cmf: {
    label: 'CMF proposal',
    glyph: 'swatch',
    board:
      'a CMF board: color, material and finish swatches paired with rendered variants',
  },
  'hero-detail': {
    label: 'Hero detail',
    glyph: 'scene',
    board:
      'a premium hero board: one dramatic main visual plus macro craft-detail cells',
  },
  'detail-board': {
    label: 'Detail board',
    glyph: 'quad',
    board:
      'a texture board: macro cells comparing surface texture, gloss and grain',
  },
  'material-compare': {
    label: 'Material compare',
    glyph: 'compare',
    board:
      'a material-swap board: original and eco-material versions side by side with spec notes',
  },
  'color-matrix': {
    label: 'Color matrix',
    glyph: 'swatch',
    board:
      'a colorway matrix: rows of color and pattern variants with palette chips',
  },
  'style-plan': {
    label: 'Style proposal',
    glyph: 'collage',
    board:
      'a style-fusion board: the product restyled with fashion-brand language cues',
  },
  'mood-board': {
    label: 'Mood board',
    glyph: 'collage',
    board:
      'an aesthetics mood board: oriental-inspired forms, materials and mood cells',
  },
  'hero-visual': {
    label: 'Hero visual',
    glyph: 'scene',
    board:
      'a futuristic key-visual board: one dark high-tech hero shot with spec overlays',
  },
  ecosystem: {
    label: 'Product ecosystem',
    glyph: 'collage',
    board:
      'an ecosystem board: the hero product surrounded by matching accessories',
  },
  lineup: {
    label: 'Lineup',
    glyph: 'strip',
    board:
      'a lineup board: hero, image and profit models side by side with role labels',
  },
  'price-ladder': {
    label: 'Price ladder',
    glyph: 'steps',
    board:
      'a tier board: entry, standard and premium editions with feature deltas',
  },
  'series-matrix': {
    label: 'Series matrix',
    glyph: 'grid9',
    board: 'a series matrix board: sizes and scenes arranged in a labeled grid',
  },
  'landing-plan': {
    label: 'Landing plan',
    glyph: 'steps',
    board:
      'a production-landing board: DFM notes, part callouts and assembly sequence',
  },
  'full-proposal': {
    label: 'Full proposal',
    glyph: 'collage',
    board:
      'a complete design-proposal board: hero shot, views, CMF, structure and spec blocks',
  },
}

/** Template gallery per direction; the custom direction has no presets. */
export const DESIGN_PRESETS: Partial<Record<DesignDirection, DesignPreset[]>> =
  {
    creative: [
      {
        value: 'viral-nine-grid',
        label: 'Viral nine-grid split',
        boardType: 'nine-grid',
        focus:
          'split the hero product into nine sellable variations across colorways, materials and scenes',
      },
      {
        value: 'cross-inspiration',
        label: 'Cross-border inspiration fusion',
        boardType: 'concept-board',
        focus:
          'fuse the product with visual inspiration from other industries into fresh concept renders',
      },
      {
        value: 'identity-redesign',
        label: 'Core identity redesign',
        boardType: 'before-after',
        focus:
          'redesign the product while keeping its core visual identity instantly recognizable',
      },
      {
        value: 'keyword-divergence',
        label: 'Keyword concept divergence',
        boardType: 'concept-strip',
        focus:
          'diverge from five style keywords into distinct concept sketches of the product',
      },
      {
        value: 'multi-direction',
        label: 'Single-item multi-direction exploration',
        boardType: 'four-way',
        focus:
          'explore four clearly different design directions for the same single product',
      },
    ],
    redesign: [
      {
        value: 'folding-storage',
        label: 'Folding storage structure',
        boardType: 'step-board',
        focus:
          'rework the product around a folding storage mechanism with clear deploy steps',
      },
      {
        value: 'interior-space',
        label: 'Interior space optimization',
        boardType: 'cutaway',
        focus:
          'optimize the internal space division and show the organized interior layout',
      },
      {
        value: 'modular-disassembly',
        label: 'Modular disassembly',
        boardType: 'structure-breakdown',
        focus:
          'restructure the product into swappable modules with clean parting lines',
      },
      {
        value: 'part-swap',
        label: 'Part add-remove swap',
        boardType: 'change-annot',
        focus:
          'add, remove and swap functional parts with annotated before and after views',
      },
      {
        value: 'proportion-rebuild',
        label: 'Proportion silhouette rebuild',
        boardType: 'before-after',
        focus:
          'rebuild the proportions and silhouette for a more premium stance',
      },
    ],
    function: [
      {
        value: 'ergonomic',
        label: 'Ergonomic optimization',
        boardType: 'ergonomics',
        focus:
          'optimize carrying and handling ergonomics with human-factors evidence',
      },
      {
        value: 'scene-extension',
        label: 'Scene function extension',
        boardType: 'scene-plan',
        focus:
          'extend the product into new usage scenes with scene-specific functions',
      },
      {
        value: 'quick-operation',
        label: 'Portable quick operation',
        boardType: 'operation-flow',
        focus:
          'design one-hand carry and seconds-level quick-access operations',
      },
      {
        value: 'safety-boost',
        label: 'Safety protection boost',
        boardType: 'risk-map',
        focus:
          'map usage risks and answer each with a visible protection design',
      },
      {
        value: 'easy-repair',
        label: 'Easy repair and replacement',
        boardType: 'maintenance',
        focus:
          'make wear parts tool-free to replace and show the maintenance path',
      },
    ],
    material: [
      {
        value: 'same-material-extension',
        label: 'Same-material function extension',
        boardType: 'series-plan',
        focus:
          'extend the signature material into a family of companion products',
      },
      {
        value: 'multi-material',
        label: 'Multi-material combination',
        boardType: 'cmf',
        focus: 'combine two to three materials in refined CMF combinations',
      },
      {
        value: 'premium-craft',
        label: 'Premium limited craft',
        boardType: 'hero-detail',
        focus: 'elevate the product with limited-edition premium craft details',
      },
      {
        value: 'texture-gloss',
        label: 'Surface texture and gloss',
        boardType: 'detail-board',
        focus:
          'study surface texture and gloss levels across macro detail cells',
      },
      {
        value: 'eco-swap',
        label: 'Eco material swap',
        boardType: 'material-compare',
        focus:
          'swap to recycled or bio-based materials without losing the premium feel',
      },
    ],
    visual: [
      {
        value: 'color-pattern',
        label: 'Color and pattern system',
        boardType: 'color-matrix',
        focus: 'build a systematic colorway and pattern family for the product',
      },
      {
        value: 'fashion-fusion',
        label: 'Fashion brand language fusion',
        boardType: 'style-plan',
        focus:
          'fuse current fashion-brand visual language into the product styling',
      },
      {
        value: 'oriental',
        label: 'Oriental aesthetics translation',
        boardType: 'mood-board',
        focus:
          'translate oriental aesthetics into form, material and color cues',
      },
      {
        value: 'future-tech',
        label: 'Futuristic tech style',
        boardType: 'hero-visual',
        focus: 'restyle the product in a futuristic high-tech visual language',
      },
      {
        value: 'outdoor-functional',
        label: 'Outdoor functional language',
        boardType: 'scene-plan',
        focus:
          'dress the product in an outdoor functional design language with field scenes',
      },
    ],
    series: [
      {
        value: 'accessories',
        label: 'Hero product and accessories',
        boardType: 'ecosystem',
        focus: 'design a matching accessory ecosystem around the hero product',
      },
      {
        value: 'lineup-combo',
        label: 'Hero-image-profit lineup',
        boardType: 'lineup',
        focus: 'plan hero, image and profit models as one coherent lineup',
      },
      {
        value: 'tiers',
        label: 'Entry-standard-premium tiers',
        boardType: 'price-ladder',
        focus:
          'define entry, standard and premium editions with visible value deltas',
      },
      {
        value: 'family-nine-grid',
        label: 'Nine-grid product family',
        boardType: 'series-matrix',
        focus: 'arrange the whole product family as a nine-grid series matrix',
      },
      {
        value: 'size-scene',
        label: 'Multi-size multi-scene',
        boardType: 'series-matrix',
        focus: 'show multiple sizes staged in their best-fit scenes',
      },
    ],
    proposal: [
      {
        value: 'compare-board',
        label: 'Before-after comparison board',
        boardType: 'before-after',
        focus:
          'summarize the redesign as a decision-ready before-and-after comparison',
      },
      {
        value: 'cmf-board',
        label: 'CMF material proposal board',
        boardType: 'cmf',
        focus:
          'present the full CMF material proposal with swatches and renders',
      },
      {
        value: 'structure-board',
        label: 'Structure breakdown proposal board',
        boardType: 'structure-breakdown',
        focus:
          'present the structure breakdown as an engineering-ready proposal',
      },
      {
        value: 'landing-board',
        label: 'Production landing proposal board',
        boardType: 'landing-plan',
        focus:
          'turn the design into a production-landing proposal with DFM notes',
      },
      {
        value: 'full-board',
        label: 'Complete design explanation board',
        boardType: 'full-proposal',
        focus:
          'compose the complete design explanation board for stakeholder review',
      },
    ],
  }

export function createDefaultProductDesignConfig(): ProductDesignConfig {
  return {
    product: null,
    direction: 'creative',
    preset: DESIGN_PRESETS.creative?.[0]?.value ?? '',
    customBrief: '',
    notes: '',
    resolution: '1K',
    ratio: 'smart',
    imageModel: '',
    count: 2,
  }
}

/** Nine fashion direction tabs; free/custom/batch have no template gallery. */
export const FASHION_DIRECTIONS: ChipOption[] = [
  { value: 'free', label: 'Free design' },
  { value: 'redesign', label: 'Garment redesign' },
  { value: 'new', label: 'New style creation' },
  { value: 'series', label: 'Series extension' },
  { value: 'pattern', label: 'Pattern design' },
  { value: 'fabric', label: 'Fabric design' },
  { value: 'lineart', label: 'Line art tools' },
  { value: 'custom', label: 'Custom' },
  { value: 'batch', label: 'Batch' },
]

/** Batch mode consumes several garments and generates one run per image. */
export const FASHION_BATCH_MAX = 8

const FASHION_INPUT_LABELS = {
  garment: 'Garment image',
  fabric: 'Fabric / pattern image',
  reference: 'Reference image',
  lineart: 'Line art image',
} as const

function fashionInput(
  key: keyof typeof FASHION_INPUT_LABELS,
  required: boolean,
  max = 1
): FashionPresetInput {
  return { key, label: FASHION_INPUT_LABELS[key], required, max }
}

/** Template gallery per fashion direction. */
export const FASHION_PRESETS: Partial<
  Record<FashionDirection, FashionPreset[]>
> = {
  redesign: [
    {
      value: 'fabric-swap',
      label: 'Fabric swap',
      glyph: 'compare',
      inputs: [fashionInput('garment', true), fashionInput('fabric', true)],
      focus:
        'replace the garment fabric with the swatch material while keeping silhouette, trims and construction unchanged',
    },
    {
      value: 'pattern-swap',
      label: 'Pattern swap',
      glyph: 'compare',
      inputs: [fashionInput('garment', true), fashionInput('fabric', true)],
      focus:
        'apply the swatch pattern onto the garment surface, keeping the garment cut unchanged',
    },
    {
      value: 'garment-recolor',
      label: 'Garment recolor',
      glyph: 'compare',
      usesColor: true,
      inputs: [fashionInput('garment', true)],
      focus:
        'recolor the garment to the target color while keeping fabric texture and shading natural',
    },
    {
      value: 'description-redesign',
      label: 'Description redesign',
      glyph: 'compare',
      needsDescription: true,
      inputs: [fashionInput('garment', true)],
      focus:
        'modify the garment exactly as the instruction describes, keeping the rest of the design unchanged',
    },
    {
      value: 'reference-redesign',
      label: 'Reference redesign',
      glyph: 'compare',
      inputs: [fashionInput('garment', true), fashionInput('reference', true)],
      focus:
        'restyle the garment following the design language of the reference garment (collar, pockets, closures), keeping its own silhouette base',
    },
    {
      value: 'print-removal',
      label: 'Print removal',
      glyph: 'compare',
      inputs: [fashionInput('garment', true)],
      focus:
        'remove all prints, patterns and graphics from the garment, leaving a clean solid fabric',
    },
  ],
  new: [
    {
      value: 'viral-split',
      label: 'Viral split',
      glyph: 'spread',
      tag: 'Recommended',
      inputs: [fashionInput('garment', true)],
      focus:
        'derive six sellable variations of the hero garment (neckline, sleeve, length tweaks) as one family',
    },
    {
      value: 'viral-proposal',
      label: 'Viral proposal',
      glyph: 'strip',
      inputs: [fashionInput('garment', true)],
      focus:
        'propose a hit-style lineup: three refined versions of the garment plus material close-ups',
    },
    {
      value: 'detail-style',
      label: 'Detail-driven styles',
      glyph: 'spread',
      inputs: [fashionInput('garment', true)],
      focus:
        'generate new styles driven by the garment signature details (pleats, seams, closures)',
    },
    {
      value: 'fabric-style',
      label: 'Fabric-driven styles',
      glyph: 'spread',
      inputs: [fashionInput('fabric', true)],
      focus:
        'design six garment styles tailored to the provided fabric hand-feel and drape',
    },
    {
      value: 'description-style',
      label: 'Description-driven styles',
      glyph: 'spread',
      needsDescription: true,
      inputs: [fashionInput('fabric', false)],
      focus:
        'create garment styles from the written description, using the fabric swatch when provided',
    },
  ],
  series: [
    {
      value: 'series-variation',
      label: 'Series variation extension',
      glyph: 'spread',
      inputs: [fashionInput('garment', true)],
      focus:
        'extend the garment into a coherent series of six variation designs',
    },
    {
      value: 'series-fabric',
      label: 'Fabric series extension',
      glyph: 'spread',
      inputs: [fashionInput('fabric', true)],
      focus:
        'build a jacket and dress series in the provided fabric as one collection',
    },
    {
      value: 'series-reference',
      label: 'Series reference extension',
      glyph: 'spread',
      inputs: [fashionInput('reference', true, 3)],
      focus:
        'extend the reference series into new pieces that complete the collection',
    },
  ],
  pattern: [
    {
      value: 'pattern-extract',
      label: 'Pattern extraction',
      glyph: 'compare',
      inputs: [fashionInput('garment', true)],
      focus:
        'extract the garment print into a clean flat repeat pattern swatch',
    },
    {
      value: 'four-way-repeat',
      label: 'Four-way repeat',
      glyph: 'quad',
      tag: 'Feature upgrade',
      inputs: [fashionInput('fabric', true)],
      focus: 'turn the motif into a seamless four-way repeat pattern tile',
    },
    {
      value: 'style-transfer',
      label: 'Style transfer',
      glyph: 'compare',
      inputs: [fashionInput('fabric', true), fashionInput('reference', true)],
      focus:
        'render the motif in the craft style of the reference swatch (embroidery, print, weave)',
    },
    {
      value: 'similar-pattern',
      label: 'Similar pattern derivation',
      glyph: 'quad',
      inputs: [fashionInput('fabric', true)],
      focus:
        'derive six similar-but-distinct pattern variants from the source pattern',
    },
    {
      value: 'pattern-fusion',
      label: 'Pattern fusion',
      glyph: 'compare',
      inputs: [fashionInput('fabric', true, 2)],
      focus: 'fuse the two provided patterns into one harmonious new pattern',
    },
    {
      value: 'bg-tone',
      label: 'Background tone shift',
      glyph: 'compare',
      usesColor: true,
      inputs: [fashionInput('fabric', true)],
      focus:
        'shift the pattern background to the target color while keeping motifs untouched',
    },
  ],
  fabric: [
    {
      value: 'fabric-recolor',
      label: 'Fabric recolor',
      glyph: 'compare',
      usesColor: true,
      inputs: [fashionInput('fabric', true)],
      focus:
        'recolor the fabric swatch to the target color with realistic sheen and shadows',
    },
  ],
  lineart: [
    {
      value: 'lineart-style',
      label: 'Line art to garment',
      glyph: 'compare',
      inputs: [fashionInput('lineart', true), fashionInput('fabric', true)],
      focus:
        'dress the line art silhouette with the provided fabric into a finished garment render',
    },
    {
      value: 'lineart-extract',
      label: 'Black-white line art extraction',
      glyph: 'compare',
      inputs: [fashionInput('garment', true)],
      focus:
        'extract a clean black-and-white technical line art of the garment',
    },
  ],
}

/** Upload slots of the active mode: template inputs or the mode defaults. */
export function fashionInputsFor(
  direction: FashionDirection,
  preset: string
): FashionPresetInput[] {
  if (direction === 'free') {
    return [fashionInput('garment', false), fashionInput('fabric', false)]
  }
  if (direction === 'custom') {
    return [fashionInput('garment', false)]
  }
  if (direction === 'batch') {
    return [fashionInput('garment', true, FASHION_BATCH_MAX)]
  }
  const presets = FASHION_PRESETS[direction] ?? []
  return presets.find((item) => item.value === preset)?.inputs ?? []
}

export function createDefaultFashionDesignConfig(): FashionDesignConfig {
  return {
    direction: 'free',
    preset: FASHION_PRESETS.redesign?.[0]?.value ?? '',
    images: { garment: [], fabric: [], reference: [], lineart: [] },
    color: '#b48ead',
    description: '',
    resolution: '1K',
    ratio: 'smart',
    imageModel: '',
    count: 2,
  }
}

/** Click-driving overlay elements a hero image may carry. */
export const HERO_CONTENT_ELEMENTS: ChipOption[] = [
  { value: 'main-title', label: 'Main title' },
  { value: 'selling-points', label: 'Core selling points' },
  { value: 'multi-spec', label: 'Multi-spec' },
  { value: 'detail-inset', label: 'Local detail inset' },
  { value: 'benefit-points', label: 'Bottom benefit points' },
  { value: 'price-promo', label: 'Price and promotion' },
  { value: 'promo-tags', label: 'Promotion tags' },
  { value: 'scenes', label: 'Use scenes' },
  { value: 'audience', label: 'Target audience' },
  { value: 'trust', label: 'Trust information' },
  { value: 'logo-text', label: 'Product text or logo' },
  { value: 'with-model', label: 'With model' },
]

/** Elements enabled before any product-specific analysis. */
const HERO_DEFAULT_ELEMENTS = [
  'main-title',
  'selling-points',
  'detail-inset',
  'price-promo',
  'promo-tags',
  'scenes',
  'trust',
  'logo-text',
  'with-model',
]

export const HERO_PERSON_MODES: ChipOption[] = [
  { value: 'keep', label: 'Keep original model' },
  { value: 'replace', label: 'Replace model' },
]

export const HERO_OUTPUT_MODES: ChipOption[] = [
  { value: 'full-new', label: 'Full new creation' },
  { value: 'optimize', label: 'Optimize original action and background' },
]

export function createDefaultHeroImageConfig(): HeroImageConfig {
  return {
    products: [],
    templates: [],
    description: '',
    extra: '',
    elements: [...HERO_DEFAULT_ELEMENTS],
    personMode: 'replace',
    model: null,
    outputMode: 'full-new',
    pose: 'auto',
    orientation: 'auto',
    expression: 'auto',
    actionNote: '',
    actions: [],
    resolution: '1K',
    ratio: 'smart',
    imageModel: '',
    count: 2,
  }
}

export const HERO_SET_STORAGE_KEY = 'hero-set-image-tasks-v1'

export const HERO_SET_MODES: ChipOption[] = [
  { value: 'model', label: 'Model set' },
  { value: 'product', label: 'Product set' },
]

/** View angles a set can be planned in; counts are picked per angle. */
export const HERO_SET_ANGLES: ChipOption[] = [
  { value: 'front', label: 'Front' },
  { value: 'side', label: 'Side' },
  { value: 'back', label: 'Back view' },
]

export const HERO_SET_ANGLE_COUNTS = [1, 2, 3, 4] as const

/** Preset overrides for the set; auto is meaningless once explicitly picked. */
export const HERO_SET_POSES: ChipOption[] = TRY_ON_POSES.filter(
  (option) => option.value !== 'auto'
)
export const HERO_SET_EXPRESSIONS: ChipOption[] = TRY_ON_EXPRESSIONS.filter(
  (option) => option.value !== 'auto'
)

export const HERO_SET_OUTFITS: ChipOption[] = [
  { value: 'keep', label: 'Keep the original outfit' },
  { value: 'casual', label: 'Casual style' },
  { value: 'commuter', label: 'Commuter style' },
  { value: 'sporty', label: 'Sporty style' },
  { value: 'dress', label: 'Elegant dress' },
]

export const HERO_SET_SCENES: ChipOption[] = [
  { value: 'keep', label: 'Keep the original scene' },
  { value: 'studio', label: 'Pure-color studio background' },
  { value: 'street', label: 'Daily street scene' },
  { value: 'home', label: 'Indoor home scene' },
  { value: 'outdoor', label: 'Outdoor nature scene' },
]

export const HERO_SET_OTHERS: ChipOption[] = [
  { value: 'lighting', label: 'Keep lighting consistent' },
  { value: 'atmosphere', label: 'Add scene atmosphere' },
  { value: 'details', label: 'Highlight product details' },
  { value: 'text-space', label: 'Leave space for marketing text' },
]

export function createDefaultHeroSetConfig(): HeroSetConfig {
  return {
    mode: 'model',
    reference: null,
    angles: [{ value: 'front', count: 2 }],
    pose: '',
    expression: '',
    outfit: '',
    scene: '',
    other: '',
    resolution: '1K',
    ratio: 'smart',
    imageModel: '',
  }
}

export const DETAIL_PAGE_STORAGE_KEY = 'detail-page-tasks-v1'

/** Content modules a detail page set may carry, in reference order. */
export const DETAIL_CONTENT_ELEMENTS: ChipOption[] = [
  { value: 'copy', label: 'Selling point copy' },
  { value: 'model', label: 'With model' },
  { value: 'scene', label: 'Use scenes' },
  { value: 'closeup', label: 'Local close-up' },
  { value: 'package', label: 'Package display' },
  { value: 'size-spec', label: 'Size or parameters' },
  { value: 'steps', label: 'Usage steps' },
  { value: 'brand-ending', label: 'Brand ending' },
]

/** Modules enabled before any product-specific analysis. */
const DETAIL_DEFAULT_ELEMENTS = ['copy', 'scene', 'closeup', 'brand-ending']

export const DETAIL_TEXT_LANGUAGES: ChipOption[] = [
  { value: 'zh', label: 'Chinese' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: 'Japanese' },
]

export const DETAIL_SCENE_MODES: ChipOption[] = [
  { value: 'unified', label: 'Unified scene' },
  { value: 'smart', label: 'Smart assignment' },
]

export const DETAIL_PAGE_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const

export function createDefaultDetailPageConfig(): DetailPageConfig {
  return {
    products: [],
    name: '',
    selling: '',
    audience: '',
    scene: '',
    elements: [...DETAIL_DEFAULT_ELEMENTS],
    textLanguage: 'zh',
    sceneMode: 'smart',
    pageCount: 10,
    resolution: '2K',
    ratio: '3:4',
    imageModel: '',
  }
}

export const CLOSE_UP_STORAGE_KEY = 'closeup-image-tasks-v1'

export const CLOSE_UP_SHOT_MODES: ChipOption[] = [
  { value: 'position', label: 'Detail position picks' },
  { value: 'flat', label: 'Flat white background' },
  { value: 'threed', label: '3D white background' },
]

/** Garment parts a close-up set can prioritize; empty means auto-picked. */
export const CLOSE_UP_PARTS: ChipOption[] = [
  { value: 'neck', label: 'Neck / collar' },
  { value: 'shoulder', label: 'Shoulder' },
  { value: 'cuff', label: 'Cuff' },
  { value: 'hem', label: 'Hem' },
  { value: 'back', label: 'Back panel' },
  { value: 'waist', label: 'Waist' },
  { value: 'pocket', label: 'Pocket' },
  { value: 'placket', label: 'Placket / zipper' },
  { value: 'buttons', label: 'Buttons' },
  { value: 'stitching', label: 'Stitching / seams' },
  { value: 'texture', label: 'Fabric texture' },
  { value: 'print', label: 'Print / pattern' },
  { value: 'patchwork', label: 'Patchwork' },
  { value: 'lining', label: 'Lining / inner' },
  { value: 'label', label: 'Label / tag' },
  { value: 'hardware', label: 'Hardware accessories' },
  { value: 'silhouette', label: 'Silhouette outline' },
]

export const CLOSE_UP_OUTPUT_MODES: ChipOption[] = [
  { value: 'white', label: 'White background detail' },
  { value: 'replicate', label: 'Replicate the reference' },
]

export const CLOSE_UP_GEN_MODES: ChipOption[] = [
  { value: 'independent', label: 'Independent generation' },
  { value: 'merged', label: 'Merge into one' },
]

export function createDefaultCloseUpConfig(): CloseUpConfig {
  return {
    shotMode: 'position',
    front: null,
    side: null,
    back: null,
    garment: null,
    references: [],
    parts: [],
    outputMode: 'white',
    genMode: 'independent',
    model: null,
    note: '',
    resolution: '1K',
    ratio: 'smart',
    imageModel: '',
    count: 1,
  }
}

export const MODEL_STUDIO_STORAGE_KEY = 'model-studio-tasks-v1'

export const MODEL_STUDIO_MODES: ChipOption[] = [
  { value: 'compose', label: 'Face-composed model' },
  { value: 'restyle', label: 'Model restyle' },
  { value: 'existing', label: 'Upload existing model' },
]

/** Stable identities of the three portrait slots fused into one identity. */
export const MODEL_STUDIO_FACE_SLOT_IDS = ['slot-1', 'slot-2', 'slot-3']

export function createDefaultModelStudioConfig(): ModelStudioConfig {
  return {
    mode: 'compose',
    faces: MODEL_STUDIO_FACE_SLOT_IDS.map(() => null),
    model: null,
    hairStyle: null,
    hairColor: null,
    resolution: '2K',
    count: 1,
    imageModel: '',
  }
}
