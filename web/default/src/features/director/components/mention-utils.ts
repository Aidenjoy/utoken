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

// 可 @ 引用的资产条目，kind 与后端 mention.go 保持一致
export interface MentionAsset {
  kind: 'char' | 'prop' | 'scene' | 'shot' | 'video'
  id: number
  name: string
  url: string
}

export const MENTION_KIND_LABEL: Record<MentionAsset['kind'], string> = {
  char: 'Character Images',
  prop: 'Prop Images',
  scene: 'Scene Images',
  shot: 'Shot Images',
  video: 'Videos',
}

export const MENTION_TOKEN_RE = /@\[(char|prop|scene|shot|video):(\d+)\]/g

// 将含 @[kind:id] 的文本转为可读描述（供卡片展示）
export function formatMentions(
  text: string,
  assets: MentionAsset[],
  kindLabel: (kind: MentionAsset['kind']) => string
): string {
  if (!text) return ''
  const map = new Map(assets.map((a) => [`${a.kind}:${a.id}`, a]))
  return text.replaceAll(MENTION_TOKEN_RE, (_token, kind: string, id: string) => {
    const asset = map.get(`${kind}:${id}`)
    return asset ? `@${kindLabel(asset.kind)}·${asset.name}` : ''
  })
}
