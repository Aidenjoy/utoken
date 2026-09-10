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
import type { TFunction } from 'i18next'
import { z } from 'zod'

import { PROMPT_VALIDATION, getPromptFormErrorMessages } from '../constants'
import { PROMPT_VISIBILITY, type PromptTemplateFormData } from '../types'

// ============================================================================
// Form Schema (use getPromptFormSchema(t) in components for i18n messages)
// ============================================================================

export function getPromptFormSchema(t: TFunction) {
  const msg = getPromptFormErrorMessages(t)
  return z.object({
    title: z
      .string()
      .trim()
      .min(1, msg.TITLE_REQUIRED)
      .max(PROMPT_VALIDATION.TITLE_MAX_LENGTH, msg.TITLE_TOO_LONG),
    content: z
      .string()
      .min(1, msg.CONTENT_REQUIRED)
      .max(PROMPT_VALIDATION.CONTENT_MAX_LENGTH, msg.CONTENT_TOO_LONG),
    description: z
      .string()
      .max(PROMPT_VALIDATION.DESCRIPTION_MAX_LENGTH, msg.DESCRIPTION_TOO_LONG),
    tags: z.string().max(PROMPT_VALIDATION.TAG_MAX_LENGTH),
    visibility: z.enum([
      PROMPT_VISIBILITY.PRIVATE,
      PROMPT_VISIBILITY.ORG,
      PROMPT_VISIBILITY.PUBLIC,
    ]),
  })
}

export type PromptFormValues = z.infer<ReturnType<typeof getPromptFormSchema>>

// ============================================================================
// Form Defaults
// ============================================================================

export function getPromptFormDefaultValues(
  visibility: string = PROMPT_VISIBILITY.PRIVATE
): PromptFormValues {
  return {
    title: '',
    content: '',
    description: '',
    tags: '',
    visibility: visibility as PromptFormValues['visibility'],
  }
}

// ============================================================================
// Form Data Transformation
// ============================================================================

/**
 * Transform form data to API payload. Tags are normalized here (trimmed,
 * de-duplicated) so the stored value matches what the backend would produce.
 */
export function transformFormDataToPayload(
  data: PromptFormValues
): PromptTemplateFormData {
  return {
    title: data.title.trim(),
    content: data.content,
    description: data.description.trim(),
    tags: data.tags,
    visibility: data.visibility,
  }
}

/**
 * Transform a template into form values. Unknown visibility values fall back to
 * `private` because the select only offers the three known ones.
 */
export function transformPromptToFormDefaults(prompt: {
  title: string
  content: string
  description: string
  tags: string
  visibility: string
}): PromptFormValues {
  const known = Object.values(PROMPT_VISIBILITY).includes(
    prompt.visibility as (typeof PROMPT_VISIBILITY)[keyof typeof PROMPT_VISIBILITY]
  )
  return {
    title: prompt.title,
    content: prompt.content,
    description: prompt.description,
    tags: prompt.tags,
    visibility: known
      ? (prompt.visibility as PromptFormValues['visibility'])
      : PROMPT_VISIBILITY.PRIVATE,
  }
}
