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

// 归属筛选：自己（默认）/ 全部用户 / 搜索选中的指定用户（仅管理员可见）
export type OwnerSelection =
  | { kind: 'self' }
  | { kind: 'all' }
  | { kind: 'user'; id: number; username: string }

// 映射为列表接口的 userId 参数：非管理员/自己=缺省（后端默认自己），全部=0，指定用户=id
export function ownerUserIdParam(
  owner: OwnerSelection,
  isAdmin: boolean
): number | undefined {
  if (!isAdmin || owner.kind === 'self') return undefined
  if (owner.kind === 'all') return 0
  return owner.id
}
