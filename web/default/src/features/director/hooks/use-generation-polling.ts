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

import { getDirectorImageGeneration, getDirectorVideoGeneration } from '../api'
import type { DirectorImageGeneration, DirectorVideoGeneration } from '../types'

const POLLING_INTERVAL = 3000

function isRunning(status: string | undefined): boolean {
  return status === 'pending' || status === 'processing'
}

// 轮询图片生成任务，未完成时每 3 秒刷新
export function useImageGenerationPoll(genId: number | null) {
  return useQuery({
    queryKey: ['director', 'image-generation', genId],
    queryFn: () => {
      const id = genId ?? 0
      if (id <= 0) return Promise.reject(new Error('missing generation id'))
      return getDirectorImageGeneration(id)
    },
    enabled: genId != null && genId > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status
      return isRunning(status) ? POLLING_INTERVAL : false
    },
  })
}

// 轮询视频生成任务，未完成时每 3 秒刷新
export function useVideoGenerationPoll(genId: number | null) {
  return useQuery({
    queryKey: ['director', 'video-generation', genId],
    queryFn: () => {
      const id = genId ?? 0
      if (id <= 0) return Promise.reject(new Error('missing generation id'))
      return getDirectorVideoGeneration(id)
    },
    enabled: genId != null && genId > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status
      return isRunning(status) ? POLLING_INTERVAL : false
    },
  })
}

export function generationFinished(
  gen: DirectorImageGeneration | DirectorVideoGeneration | null | undefined
): boolean {
  if (!gen) return false
  return gen.status === 'success' || gen.status === 'failed'
}
