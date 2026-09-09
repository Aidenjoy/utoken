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
import { ROLE } from '@/lib/roles'

import { PROMPT_VISIBILITY, type PromptTemplate } from '../types'

/** Tags are stored as a comma separated string; parse them for display. */
export function parsePromptTags(tags: string): string[] {
  return tags
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '')
}

/**
 * Mirror of `model.CanManagePromptTemplate`: the creator always can, an
 * organization admin can manage templates owned by their own organization, and
 * the super admin can manage public templates.
 *
 * The backend stays authoritative; this only decides which buttons to render so
 * users are not offered actions that would be rejected.
 */
export function canManagePromptTemplate(
  prompt: PromptTemplate,
  user: {
    id?: number
    role?: number
    org_id?: number
    org_role?: string
  } | null
): boolean {
  if (!user) return false
  if (prompt.user_id === user.id) return true

  const isOrgAdmin =
    (user.org_id ?? 0) > 0 &&
    prompt.org_id === user.org_id &&
    user.org_role === 'admin'
  if (isOrgAdmin) return true

  return (
    (user.role ?? 0) >= ROLE.SUPER_ADMIN &&
    prompt.visibility === PROMPT_VISIBILITY.PUBLIC
  )
}

/**
 * Whether the organization visibility is a valid choice for this user.
 * Templates created inside an organization keep their `org_id` forever, so a
 * member who left can still see them but must not create new ones.
 */
export function canUseOrgVisibility(user: { org_id?: number } | null): boolean {
  return (user?.org_id ?? 0) > 0
}
