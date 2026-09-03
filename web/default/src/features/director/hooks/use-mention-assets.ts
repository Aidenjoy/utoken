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
import { useQuery } from '@tanstack/react-query'

import { getDirectorEntities, getDirectorStoryboards } from '../api'
import type { MentionAsset } from '../components/mention-utils'
import type { DirectorEpisode, DirectorProp } from '../types'

/**
 * 收集本项目/分集可 @ 引用的资产（仅含已生成图片/视频的条目）。
 * 分类与工作室菜单一致：角色形象/道具图片/场景图片/镜头图片/视频。
 * 角色/场景来自流水线接口预加载的分集关联，道具/镜头按列表接口拉取。
 */
export function useMentionAssets(
  episode: DirectorEpisode | undefined
): MentionAsset[] {
  const propsQuery = useQuery({
    queryKey: ['director', 'mention-assets', 'props', episode?.projectId],
    queryFn: () =>
      getDirectorEntities<DirectorProp>('prop', {
        projectId: episode?.projectId ?? 0,
        page_size: 200,
      }),
    enabled: Boolean(episode?.projectId),
  })

  const storyboardsQuery = useQuery({
    queryKey: ['director', 'mention-assets', 'storyboards', episode?.id],
    queryFn: () =>
      getDirectorStoryboards({ episodeId: episode?.id ?? 0, page_size: 200 }),
    enabled: Boolean(episode?.id),
  })

  const propsList = propsQuery.data?.data?.list ?? []
  const storyboards = storyboardsQuery.data?.data?.list ?? []

  const assets: MentionAsset[] = []
  for (const c of episode?.characters ?? []) {
    if (c.imageUrl) {
      assets.push({ kind: 'char', id: c.id, name: c.name, url: c.imageUrl })
    }
  }
  for (const p of propsList) {
    if (p.imageUrl) {
      assets.push({ kind: 'prop', id: p.id, name: p.name, url: p.imageUrl })
    }
  }
  for (const sc of episode?.scenes ?? []) {
    if (sc.imageUrl) {
      assets.push({
        kind: 'scene',
        id: sc.id,
        name: `${sc.location}-${sc.time}`,
        url: sc.imageUrl,
      })
    }
  }
  for (const sb of storyboards) {
    if (sb.firstFrameImage) {
      assets.push({
        kind: 'shot',
        id: sb.id,
        name: `#${sb.storyboardNumber}`,
        url: sb.firstFrameImage,
      })
    }
    if (sb.videoUrl) {
      assets.push({
        kind: 'video',
        id: sb.id,
        name: `#${sb.storyboardNumber}`,
        url: sb.videoUrl,
      })
    }
  }
  return assets
}
