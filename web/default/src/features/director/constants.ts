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

// 项目类型展示配置：label 为 i18n 英文源文案（键），渲染时用 t(label)
export const DIRECTOR_CATEGORY_CONFIG: Record<
  DirectorCategory,
  { label: string; description: string }
> = {
  drama: {
    label: 'Short Drama',
    description: 'Episodic short drama production',
  },
  ecommerce: {
    label: 'E-commerce Video',
    description: 'Product showcase and selling videos',
  },
  ad: {
    label: 'Ad Video',
    description: 'Brand and advertising videos',
  },
  daily: {
    label: 'Daily Video',
    description: 'Daily life and vlog videos',
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
  extract: 'Extract Roles & Scenes',
  chars: 'Character Images',
  props: 'Prop Images',
  scenes: 'Scene Images',
  storyboard: 'Storyboard Split',
  shots: 'Shot Images & Videos',
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
