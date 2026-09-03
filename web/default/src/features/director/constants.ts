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
import type { DirectorCategory } from './types'

// ============================================================================
// 项目类型（菜单维度）
// ============================================================================

export const DIRECTOR_CATEGORIES: DirectorCategory[] = [
  'drama',
  'ecommerce',
  'ad',
  'daily',
]

export function isDirectorCategory(value: string): value is DirectorCategory {
  return DIRECTOR_CATEGORIES.includes(value as DirectorCategory)
}

// 项目类型差异化配置（对齐参考实现 drama/category.js）
// label / itemLabel / metaFields.label 均为 i18n 英文源文案（键）
export interface DirectorCategoryConfig {
  label: string
  description: string
  projectUnit: string
  itemUnit: string
  itemLabel: string
  showGenre: boolean
  metaFields: { key: string; label: string; placeholder: string }[]
}

export const DIRECTOR_CATEGORY_CONFIG: Record<
  DirectorCategory,
  DirectorCategoryConfig
> = {
  drama: {
    label: 'Short Drama',
    description: 'Episodic short drama production',
    projectUnit: 'Series',
    itemUnit: 'Episode',
    itemLabel: 'Episode',
    showGenre: true,
    metaFields: [],
  },
  ecommerce: {
    label: 'E-commerce Video',
    description: 'Product showcase and selling videos',
    projectUnit: 'Project',
    itemUnit: 'Episode',
    itemLabel: 'Episode',
    showGenre: false,
    metaFields: [
      {
        key: 'productParams',
        label: 'Product Parameters',
        placeholder: 'e.g. specs, material, size, color',
      },
      {
        key: 'coreFeatures',
        label: 'Core Features',
        placeholder: 'The most core features of the product',
      },
      {
        key: 'usage',
        label: 'Usage',
        placeholder: 'Steps or ways to use the product',
      },
      {
        key: 'sellingPoints',
        label: 'Selling Points',
        placeholder: 'Advantages over competitors',
      },
      {
        key: 'useCases',
        label: 'Use Cases',
        placeholder: 'e.g. home, office, outdoor, gifting',
      },
      {
        key: 'painPoints',
        label: 'Pain Points',
        placeholder: 'Unmet needs of target users',
      },
    ],
  },
  ad: {
    label: 'Ad Video',
    description: 'Brand and advertising videos',
    projectUnit: 'Project',
    itemUnit: 'Episode',
    itemLabel: 'Episode',
    showGenre: false,
    metaFields: [
      {
        key: 'brandConcept',
        label: 'Brand Concept',
        placeholder: 'Core brand values and proposition',
      },
      {
        key: 'promoCore',
        label: 'Promo Core',
        placeholder: 'Core message of this campaign',
      },
      {
        key: 'mainSellingPoints',
        label: 'Main Selling Points',
        placeholder: 'Key product/brand selling points',
      },
      {
        key: 'slogan',
        label: 'Slogan',
        placeholder: 'Brand slogan or campaign slogan',
      },
      {
        key: 'targetAudience',
        label: 'Target Audience',
        placeholder: 'e.g. urban white-collar women aged 25-35',
      },
    ],
  },
  daily: {
    label: 'Daily Video',
    description: 'Daily life and vlog videos',
    projectUnit: 'Project',
    itemUnit: 'Episode',
    itemLabel: 'Episode',
    showGenre: false,
    metaFields: [
      {
        key: 'theme',
        label: 'Theme',
        placeholder: 'e.g. a lazy weekend at home',
      },
      {
        key: 'synopsis',
        label: 'Synopsis',
        placeholder: 'Rough plot or content direction',
      },
      {
        key: 'emotion',
        label: 'Emotion',
        placeholder: 'e.g. healing, relaxed, warm',
      },
      {
        key: 'tone',
        label: 'Tone',
        placeholder: 'e.g. soft warm tones, fresh natural',
      },
      {
        key: 'contentWanted',
        label: 'Content Wanted',
        placeholder: 'Specific content you want in the frames',
      },
    ],
  },
}

// ============================================================================
// 状态配置
// ============================================================================

export const PROJECT_STATUSES = ['draft', 'producing', 'completed'] as const

export const PROJECT_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  producing: 'Producing',
  completed: 'Completed',
}

export const GEN_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  processing: 'Processing',
  success: 'Success',
  failed: 'Failed',
}

// ============================================================================
// 分集表单选项（对齐参考实现 drama/category.js）
// ============================================================================

export const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120]

export const ASPECT_RATIO_OPTIONS = [
  '21:9',
  '16:9',
  '4:3',
  '1:1',
  '3:4',
  '9:16',
]

export const RESOLUTION_OPTIONS = ['480P', '720P', '1080P', '4K']

export const PROJECT_STYLE_OPTIONS = [
  { value: 'realistic', label: 'Realistic' },
  { value: 'anime', label: 'Anime' },
  { value: '3d', label: '3D Render' },
  { value: 'watercolor', label: 'Watercolor' },
]

export const GEN_STATUS_BADGE_VARIANT: Record<
  string,
  'secondary' | 'default' | 'outline' | 'destructive'
> = {
  pending: 'secondary',
  processing: 'outline',
  success: 'default',
  failed: 'destructive',
}

// ============================================================================
// 流水线步骤（与后端 GetEpisodePipeline 的 step key 对应）
// ============================================================================

export const PIPELINE_STEP_LABEL: Record<string, string> = {
  content: 'Content Input',
  rewrite: 'AI Rewrite',
  extract: 'Extract Resources',
  chars: 'Character Images',
  props: 'Prop Images',
  scenes: 'Scene Images',
  storyboard: 'Storyboard Split',
  shots: 'Shot Images',
  videos: 'Video Generation',
  edit: 'Editing',
}

// 图片生成任务类型
export const IMAGE_TYPE_LABEL: Record<string, string> = {
  character: 'Character',
  scene: 'Scene',
  storyboard: 'Storyboard',
  prop: 'Prop',
}

// ============================================================================
// 素材库（对齐参考实现 drama/assets）
// ============================================================================

// 内置分类键与展示文案（i18n 英文源文案），与后端 builtinAssetCategories 对应
export const BUILTIN_ASSET_CATEGORIES: { key: string; label: string }[] = [
  { key: 'character', label: 'Character' },
  { key: 'scene', label: 'Scene' },
  { key: 'prop', label: 'Prop' },
  { key: 'storyboard', label: 'Storyboard Clip' },
  { key: 'composed', label: 'Composed Clip' },
  { key: 'merged', label: 'Merged Video' },
  { key: 'edited', label: 'Edited Video' },
  { key: 'upload', label: 'Upload' },
]

// 素材类型筛选选项（与后端 detectUploadType 对应）
export const ASSET_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
]
