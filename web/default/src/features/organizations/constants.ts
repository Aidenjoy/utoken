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
/** i18n keys; wrap with t() when displaying. */
export const ORG_ADMIN_ERROR_MESSAGES = {
  LOAD_FAILED: 'Failed to load organizations',
  CREATE_FAILED: 'Failed to create organization',
  UPDATE_FAILED: 'Failed to update organization',
  QUOTA_FAILED: 'Failed to adjust the pool quota',
  STATUS_FAILED: 'Failed to update organization status',
  DELETE_FAILED: 'Failed to delete organization',
  MEMBERS_FAILED: 'Failed to load organization members',
} as const

export const ORG_ADMIN_SUCCESS_MESSAGES = {
  CREATED: 'Organization created',
  UPDATED: 'Organization updated',
  QUOTA_ADJUSTED: 'Pool quota adjusted',
  STATUS_UPDATED: 'Organization status updated',
  DELETED: 'Organization deleted',
} as const
