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
import { z } from 'zod'

// ============================================================================
// Prompt Template Schema & Types
// ============================================================================

export const promptTemplateSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  org_id: z.number(),
  title: z.string(),
  content: z.string(),
  description: z.string(),
  tags: z.string(),
  visibility: z.string(),
  use_count: z.number(),
  created_at: z.number(),
  updated_at: z.number(),
})

export type PromptTemplate = z.infer<typeof promptTemplateSchema>

/** Visibility values accepted by the backend. */
export const PROMPT_VISIBILITY = {
  PRIVATE: 'private',
  ORG: 'org',
  PUBLIC: 'public',
} as const

export type PromptVisibility =
  (typeof PROMPT_VISIBILITY)[keyof typeof PROMPT_VISIBILITY]

/** Values offered in the toolbar visibility filter (`''` means "any"). */
export const PROMPT_VISIBILITY_FILTER_VALUES = [
  '',
  PROMPT_VISIBILITY.PRIVATE,
  PROMPT_VISIBILITY.ORG,
  PROMPT_VISIBILITY.PUBLIC,
] as const

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  data?: T
}

export interface PromptTemplatePage {
  items: PromptTemplate[]
  total: number
  page: number
  page_size: number
}

export type GetPromptTemplatesResponse = ApiResponse<PromptTemplatePage>

export interface GetPromptTemplatesParams {
  p?: number
  page_size?: number
  keyword?: string
  tag?: string
  visibility?: string
  /**
   * Management view. Empty/omitted means "templates visible to me".
   * 'org' is honored for organization admins, 'public' for the super admin;
   * the backend silently falls back to the default view otherwise.
   */
  scope?: '' | 'org' | 'public'
}

export interface PromptTemplateFormData {
  title: string
  content: string
  description: string
  tags: string
  visibility: string
}

// ============================================================================
// Dialog Types
// ============================================================================

export type PromptsDialogType = 'create' | 'update' | 'delete' | 'view'
