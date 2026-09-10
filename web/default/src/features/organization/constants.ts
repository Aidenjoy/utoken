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

import { ORG_MEMBER_STATUS, ORG_ROLE, ORG_STATUS } from './types'

// ============================================================================
// Section navigation
// ============================================================================

/** Sections an organization admin sees. Members only ever reach `overview`. */
export const ORG_SECTION_IDS = [
  'overview',
  'members',
  'usage',
  'billing',
  'settings',
] as const

export type OrgSectionId = (typeof ORG_SECTION_IDS)[number]

export const ORG_DEFAULT_SECTION: OrgSectionId = 'overview'

export function isOrgSectionId(value: string): value is OrgSectionId {
  return (ORG_SECTION_IDS as readonly string[]).includes(value)
}

export const ORG_SECTION_TITLES: Record<OrgSectionId, string> = {
  overview: 'Overview',
  members: 'Members',
  usage: 'Usage Report',
  billing: 'Billing Details',
  settings: 'Organization Settings',
}

// ============================================================================
// Roles & statuses (labelKey values are i18n keys)
// ============================================================================

export const ORG_ROLES: Record<
  string,
  Pick<StatusBadgeProps, 'variant'> & { labelKey: string }
> = {
  [ORG_ROLE.ADMIN]: { labelKey: 'Organization Admin', variant: 'blue' },
  [ORG_ROLE.MEMBER]: { labelKey: 'Member', variant: 'neutral' },
}

export function getOrgRoleOptions(t: TFunction) {
  return [ORG_ROLE.ADMIN, ORG_ROLE.MEMBER].map((value) => ({
    label: t(ORG_ROLES[value].labelKey),
    value,
  }))
}

export const ORG_MEMBER_STATUSES: Record<
  number,
  Pick<StatusBadgeProps, 'variant'> & { labelKey: string }
> = {
  [ORG_MEMBER_STATUS.ENABLED]: { labelKey: 'Enabled', variant: 'green' },
  [ORG_MEMBER_STATUS.DISABLED]: { labelKey: 'Disabled', variant: 'neutral' },
}

export const ORG_STATUSES: Record<
  number,
  Pick<StatusBadgeProps, 'variant'> & { labelKey: string }
> = {
  [ORG_STATUS.ENABLED]: { labelKey: 'Enabled', variant: 'green' },
  [ORG_STATUS.DISABLED]: { labelKey: 'Disabled', variant: 'red' },
}

// ============================================================================
// Alert channels (mirrors controller.orgNotifyTypes)
// ============================================================================

/** Empty value means "notify every organization admin". */
export const ORG_NOTIFY_TYPES = [
  '',
  'email',
  'webhook',
  'bark',
  'gotify',
] as const

export type OrgNotifyType = (typeof ORG_NOTIFY_TYPES)[number]

export const ORG_NOTIFY_TYPE_LABELS: Record<OrgNotifyType, string> = {
  '': 'All organization admins',
  email: 'Email',
  webhook: 'Webhook',
  bark: 'Bark',
  gotify: 'Gotify',
}

/**
 * Placeholder for the notify target field. Only the concrete channels take a
 * destination; the "all admins" option resolves recipients server-side.
 */
export const ORG_NOTIFY_TARGET_PLACEHOLDERS: Record<OrgNotifyType, string> = {
  '': 'Recipients are resolved automatically',
  email: 'alert@example.com',
  webhook: 'https://example.com/webhook',
  bark: 'Bark device key',
  gotify: 'https://gotify.example.com',
}

export function getOrgNotifyTypeOptions(t: TFunction) {
  return ORG_NOTIFY_TYPES.map((value) => ({
    label: t(ORG_NOTIFY_TYPE_LABELS[value]),
    value,
  }))
}

// ============================================================================
// Validation constants (must stay in sync with the backend)
// ============================================================================

export const ORG_VALIDATION = {
  /** model.OrgCacheTTLMax */
  CACHE_TTL_MAX: 86400,
  /** model.OrgCacheTTLDefault */
  CACHE_TTL_DEFAULT: 300,
  /** model.IsValidOrgName: 2-64 lowercase letters/digits/hyphen/underscore */
  NAME_MIN_LENGTH: 2,
  NAME_MAX_LENGTH: 64,
  NAME_PATTERN: /^[a-z0-9_-]+$/,
  /** organizations.display_name column size */
  DISPLAY_NAME_MAX_LENGTH: 128,
  /** organizations.notify_target column size */
  NOTIFY_TARGET_MAX_LENGTH: 512,
  /** controller.CreateOrgMember: aligned with User.Password validate tags */
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 20,
} as const

// ============================================================================
// Messages (i18n keys; wrap with t() when displaying)
// ============================================================================

export const ORG_ERROR_MESSAGES = {
  LOAD_FAILED: 'Failed to load organization data',
  UPDATE_FAILED: 'Failed to update organization',
  MEMBER_CREATE_FAILED: 'Failed to create member',
  MEMBER_INVITE_FAILED: 'Failed to invite member',
  MEMBER_UPDATE_FAILED: 'Failed to update member',
  MEMBER_REMOVE_FAILED: 'Failed to remove member',
} as const

export const ORG_SUCCESS_MESSAGES = {
  UPDATED: 'Organization updated',
  MEMBER_CREATED: 'Member created',
  MEMBER_INVITED: 'Member added to the organization',
  MEMBER_UPDATED: 'Member updated',
  MEMBER_REMOVED: 'Member removed from the organization',
} as const
