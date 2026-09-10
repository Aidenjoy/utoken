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

import type { StatusBadgeProps } from '@/components/status-badge'

import { PROMPT_VISIBILITY } from './types'

// ============================================================================
// Visibility Configuration
// ============================================================================

// labelKey values are i18n keys; use t(config.labelKey) in components
export const PROMPT_VISIBILITIES: Record<
  string,
  Pick<StatusBadgeProps, 'variant'> & {
    labelKey: string
    descriptionKey: string
  }
> = {
  [PROMPT_VISIBILITY.PRIVATE]: {
    labelKey: 'Private',
    descriptionKey: 'Only visible to you',
    variant: 'neutral',
  },
  [PROMPT_VISIBILITY.ORG]: {
    labelKey: 'Organization',
    descriptionKey: 'Visible to members of your organization',
    variant: 'blue',
  },
  [PROMPT_VISIBILITY.PUBLIC]: {
    labelKey: 'Public',
    descriptionKey: 'Visible to everyone',
    variant: 'green',
  },
} as const

export const PROMPT_VISIBILITY_VALUES = Object.values(PROMPT_VISIBILITY)

export function getPromptVisibilityOptions(t: TFunction) {
  return PROMPT_VISIBILITY_VALUES.map((value) => ({
    label: t(PROMPT_VISIBILITIES[value].labelKey),
    value,
  }))
}

/**
 * Visibilities the current user may pick when creating or editing a template.
 * `public` is reserved for the super admin, mirroring the backend rule, so
 * offering it to everyone would only produce a rejected request.
 */
export function getSelectablePromptVisibilities(
  t: TFunction,
  options: { hasOrg: boolean; isRoot: boolean }
) {
  return PROMPT_VISIBILITY_VALUES.filter((value) => {
    if (value === PROMPT_VISIBILITY.ORG) return options.hasOrg
    if (value === PROMPT_VISIBILITY.PUBLIC) return options.isRoot
    return true
  }).map((value) => ({
    label: t(PROMPT_VISIBILITIES[value].labelKey),
    description: t(PROMPT_VISIBILITIES[value].descriptionKey),
    value,
  }))
}

// ============================================================================
// List Scope (management views on top of the default "visible to me" list)
// ============================================================================

export const PROMPT_SCOPE = {
  MINE: '',
  ORG: 'org',
  PUBLIC: 'public',
} as const

export const PROMPT_SCOPE_VALUES = Object.values(PROMPT_SCOPE)

export function getPromptScopeOptions(t: TFunction) {
  return [
    { label: t('Visible to me'), value: PROMPT_SCOPE.MINE },
    { label: t('Organization templates'), value: PROMPT_SCOPE.ORG },
    { label: t('Public templates'), value: PROMPT_SCOPE.PUBLIC },
  ]
}

// ============================================================================
// Validation Constants (must stay in sync with model/prompt_template.go)
// ============================================================================

export const PROMPT_VALIDATION = {
  TITLE_MAX_LENGTH: 255,
  DESCRIPTION_MAX_LENGTH: 512,
  TAG_MAX_LENGTH: 255,
  TAG_COUNT_MAX: 20,
  CONTENT_MAX_LENGTH: 64 * 1024,
} as const

// ============================================================================
// Error Messages (i18n keys; use t(ERROR_MESSAGES.xxx) when displaying)
// ============================================================================

export const ERROR_MESSAGES = {
  LOAD_FAILED: 'Failed to load prompt templates',
  CREATE_FAILED: 'Failed to create prompt template',
  UPDATE_FAILED: 'Failed to update prompt template',
  DELETE_FAILED: 'Failed to delete prompt template',
  COPY_FAILED: 'Failed to copy prompt template',
  TITLE_REQUIRED: 'Title is required',
  TITLE_TOO_LONG: 'Title must be at most {{max}} characters',
  CONTENT_REQUIRED: 'Content is required',
  CONTENT_TOO_LONG: 'Content must be at most {{max}} characters',
  DESCRIPTION_TOO_LONG: 'Description must be at most {{max}} characters',
  TAGS_TOO_MANY: 'At most {{max}} tags are allowed',
  COPY_CONTENT_FAILED: 'Failed to copy to clipboard',
} as const

/** For form schema only: returns translated messages with interpolation. */
export function getPromptFormErrorMessages(t: TFunction) {
  return {
    TITLE_REQUIRED: t(ERROR_MESSAGES.TITLE_REQUIRED),
    TITLE_TOO_LONG: t(ERROR_MESSAGES.TITLE_TOO_LONG, {
      max: PROMPT_VALIDATION.TITLE_MAX_LENGTH,
    }),
    CONTENT_REQUIRED: t(ERROR_MESSAGES.CONTENT_REQUIRED),
    CONTENT_TOO_LONG: t(ERROR_MESSAGES.CONTENT_TOO_LONG, {
      max: PROMPT_VALIDATION.CONTENT_MAX_LENGTH,
    }),
    DESCRIPTION_TOO_LONG: t(ERROR_MESSAGES.DESCRIPTION_TOO_LONG, {
      max: PROMPT_VALIDATION.DESCRIPTION_MAX_LENGTH,
    }),
    TAGS_TOO_MANY: t(ERROR_MESSAGES.TAGS_TOO_MANY, {
      max: PROMPT_VALIDATION.TAG_COUNT_MAX,
    }),
  } as const
}

// ============================================================================
// Success Messages (i18n keys; use t(SUCCESS_MESSAGES.xxx) when displaying)
// ============================================================================

export const SUCCESS_MESSAGES = {
  PROMPT_CREATED: 'Prompt template created successfully',
  PROMPT_UPDATED: 'Prompt template updated successfully',
  PROMPT_DELETED: 'Prompt template deleted successfully',
  PROMPT_COPIED: 'Prompt template copied to your library',
  CONTENT_COPIED: 'Copied to clipboard',
} as const
