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
import { api } from '@/lib/api'

import type {
  ApiResponse,
  AssetListParams,
  DirectorAsset,
  DirectorAssetCategory,
  DirectorCharacter,
  DirectorEditProject,
  DirectorEpisode,
  DirectorEpisodePipeline,
  DirectorImageGeneration,
  DirectorModelSettings,
  DirectorProject,
  DirectorProjectWithStats,
  DirectorProp,
  DirectorScene,
  DirectorSettingsResponse,
  DirectorStoryboard,
  DirectorVideoGeneration,
  EpisodeListParams,
  PageResult,
  ProjectListParams,
} from './types'

const BASE = '/api/director'

// ============================================================================
// 模型设定与内部令牌
// ============================================================================

export async function getDirectorSettings(): Promise<
  ApiResponse<DirectorSettingsResponse>
> {
  const res = await api.get(`${BASE}/settings`)
  return res.data
}

export async function updateDirectorSettings(params: {
  textModel?: string
  imageModel?: string
  videoModel?: string
  tokenId?: number
}): Promise<ApiResponse<DirectorModelSettings>> {
  const res = await api.put(`${BASE}/settings`, params)
  return res.data
}

// 用户已有令牌列表（供模型设定页选择内部令牌）
export async function getDirectorTokenOptions(): Promise<
  ApiResponse<{
    items: {
      id: number
      name: string
      key: string
      status: number
    }[]
    total: number
  }>
> {
  const res = await api.get(`/api/token/?p=1&size=200`)
  return res.data
}

// ============================================================================
// 项目
// ============================================================================

export async function getDirectorProjects(
  params: ProjectListParams = {}
): Promise<ApiResponse<PageResult<DirectorProjectWithStats>>> {
  const res = await api.get(`${BASE}/project/list`, { params })
  return res.data
}

export async function getDirectorProject(
  id: number
): Promise<ApiResponse<DirectorProject>> {
  const res = await api.get(`${BASE}/project`, { params: { id } })
  return res.data
}

export async function createDirectorProject(
  data: Partial<DirectorProject>
): Promise<ApiResponse<DirectorProject>> {
  const res = await api.post(`${BASE}/project`, data)
  return res.data
}

export async function updateDirectorProject(
  data: Partial<DirectorProject>
): Promise<ApiResponse<DirectorProject>> {
  const res = await api.put(`${BASE}/project`, data)
  return res.data
}

export async function deleteDirectorProject(
  id: number
): Promise<ApiResponse<null>> {
  const res = await api.delete(`${BASE}/project`, { params: { id } })
  return res.data
}

// ============================================================================
// 分集与 AI 编排
// ============================================================================

export async function getDirectorEpisodes(
  params: EpisodeListParams
): Promise<ApiResponse<PageResult<DirectorEpisode>>> {
  const res = await api.get(`${BASE}/episode/list`, { params })
  return res.data
}

export async function getDirectorEpisode(
  id: number
): Promise<ApiResponse<DirectorEpisode>> {
  const res = await api.get(`${BASE}/episode`, { params: { id } })
  return res.data
}

export async function createDirectorEpisode(
  data: Partial<DirectorEpisode>
): Promise<ApiResponse<DirectorEpisode>> {
  const res = await api.post(`${BASE}/episode`, data)
  return res.data
}

export async function updateDirectorEpisode(
  data: Partial<DirectorEpisode>
): Promise<ApiResponse<DirectorEpisode>> {
  const res = await api.put(`${BASE}/episode`, data)
  return res.data
}

export async function deleteDirectorEpisode(
  id: number
): Promise<ApiResponse<null>> {
  const res = await api.delete(`${BASE}/episode`, { params: { id } })
  return res.data
}

export async function getDirectorEpisodePipeline(
  episodeId: number
): Promise<ApiResponse<DirectorEpisodePipeline>> {
  const res = await api.get(`${BASE}/episode/pipeline`, {
    params: { id: episodeId },
  })
  return res.data
}

export async function rewriteDirectorEpisode(
  id: number
): Promise<ApiResponse<DirectorEpisode>> {
  const res = await api.post(`${BASE}/episode/rewrite`, { id })
  return res.data
}

export async function extractDirectorEpisode(id: number): Promise<
  ApiResponse<{
    characters: DirectorCharacter[]
    scenes: DirectorScene[]
    props: DirectorProp[]
  }>
> {
  const res = await api.post(`${BASE}/episode/extract`, { id })
  return res.data
}

export async function generateDirectorEpisodePrompts(
  id: number
): Promise<ApiResponse<null>> {
  const res = await api.post(`${BASE}/episode/prompts`, { id })
  return res.data
}

export async function splitDirectorEpisodeStoryboards(
  id: number
): Promise<ApiResponse<{ count: number }>> {
  const res = await api.post(`${BASE}/episode/splitStoryboards`, { id })
  return res.data
}

// ============================================================================
// 角色 / 场景 / 道具
// ============================================================================

export type DirectorEntityType = 'character' | 'scene' | 'prop'

export async function getDirectorEntities<T>(
  type: DirectorEntityType,
  params: {
    projectId: number
    episodeId?: number
    p?: number
    page_size?: number
  }
): Promise<ApiResponse<PageResult<T>>> {
  const res = await api.get(`${BASE}/${type}/list`, { params })
  return res.data
}

export async function getDirectorEntity<T>(
  type: DirectorEntityType,
  id: number
): Promise<ApiResponse<T>> {
  const res = await api.get(`${BASE}/${type}`, { params: { id } })
  return res.data
}

export async function createDirectorEntity<T>(
  type: DirectorEntityType,
  data: Record<string, unknown>
): Promise<ApiResponse<T>> {
  const res = await api.post(`${BASE}/${type}`, data)
  return res.data
}

export async function updateDirectorEntity<T>(
  type: DirectorEntityType,
  data: Record<string, unknown>
): Promise<ApiResponse<T>> {
  const res = await api.put(`${BASE}/${type}`, data)
  return res.data
}

export async function deleteDirectorEntity(
  type: DirectorEntityType,
  id: number
): Promise<ApiResponse<null>> {
  const res = await api.delete(`${BASE}/${type}`, { params: { id } })
  return res.data
}

export async function generateDirectorEntityPrompt(
  type: DirectorEntityType,
  id: number
): Promise<ApiResponse<{ prompt: string }>> {
  const res = await api.post(`${BASE}/${type}/prompt`, { id })
  return res.data
}

export async function generateDirectorEntityImage(
  type: DirectorEntityType,
  params: { id: number; prompt?: string; size?: string }
): Promise<ApiResponse<{ generationId: number }>> {
  const res = await api.post(`${BASE}/${type}/image`, params)
  return res.data
}

// ============================================================================
// 分镜
// ============================================================================

export async function getDirectorStoryboards(params: {
  episodeId: number
  status?: string
  p?: number
  page_size?: number
}): Promise<ApiResponse<PageResult<DirectorStoryboard>>> {
  const res = await api.get(`${BASE}/storyboard/list`, { params })
  return res.data
}

export async function getDirectorStoryboard(
  id: number
): Promise<ApiResponse<DirectorStoryboard>> {
  const res = await api.get(`${BASE}/storyboard`, { params: { id } })
  return res.data
}

export async function createDirectorStoryboard(
  data: Partial<DirectorStoryboard>
): Promise<ApiResponse<DirectorStoryboard>> {
  const res = await api.post(`${BASE}/storyboard`, data)
  return res.data
}

export async function updateDirectorStoryboard(
  data: Partial<DirectorStoryboard>
): Promise<ApiResponse<DirectorStoryboard>> {
  const res = await api.put(`${BASE}/storyboard`, data)
  return res.data
}

export async function deleteDirectorStoryboard(
  id: number
): Promise<ApiResponse<null>> {
  const res = await api.delete(`${BASE}/storyboard`, { params: { id } })
  return res.data
}

export interface DirectorGenSubmitParams {
  id: number
  prompt?: string
  size?: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  count?: number
  frameMode?: string
}

export async function generateStoryboardImage(
  params: DirectorGenSubmitParams
): Promise<ApiResponse<{ generationId: number }>> {
  const res = await api.post(`${BASE}/storyboard/image`, params)
  return res.data
}

export async function generateStoryboardPrompt(
  id: number
): Promise<ApiResponse<{ prompt: string }>> {
  const res = await api.post(`${BASE}/storyboard/prompt`, { id })
  return res.data
}

export async function generateStoryboardVideo(
  params: DirectorGenSubmitParams
): Promise<ApiResponse<{ generationId: number }>> {
  const res = await api.post(`${BASE}/storyboard/video`, params)
  return res.data
}

export async function generateStoryboardVideoPrompt(
  id: number
): Promise<ApiResponse<{ prompt: string }>> {
  const res = await api.post(`${BASE}/storyboard/videoPrompt`, { id })
  return res.data
}

// ============================================================================
// 生成任务查询（前端轮询）
// ============================================================================

export async function getDirectorImageGeneration(
  id: number
): Promise<ApiResponse<DirectorImageGeneration>> {
  const res = await api.get(`${BASE}/imageGeneration`, { params: { id } })
  return res.data
}

export async function getDirectorImageGenerations(params: {
  storyboardId?: number
  characterId?: number
  sceneId?: number
  propId?: number
  projectId?: number
  status?: string
  p?: number
  page_size?: number
}): Promise<ApiResponse<PageResult<DirectorImageGeneration>>> {
  const res = await api.get(`${BASE}/imageGeneration/list`, { params })
  return res.data
}

export async function getDirectorVideoGeneration(
  id: number
): Promise<ApiResponse<DirectorVideoGeneration>> {
  const res = await api.get(`${BASE}/videoGeneration`, { params: { id } })
  return res.data
}

export async function getDirectorVideoGenerations(params: {
  storyboardId?: number
  projectId?: number
  status?: string
  p?: number
  page_size?: number
}): Promise<ApiResponse<PageResult<DirectorVideoGeneration>>> {
  const res = await api.get(`${BASE}/videoGeneration/list`, { params })
  return res.data
}

// ============================================================================
// 在线剪辑
// ============================================================================

export async function getDirectorEditProject(
  episodeId: number
): Promise<ApiResponse<DirectorEditProject>> {
  const res = await api.get(`${BASE}/edit/project`, { params: { episodeId } })
  return res.data
}

export async function saveDirectorEditProject(params: {
  episodeId: number
  name?: string
  timeline?: string
}): Promise<ApiResponse<DirectorEditProject>> {
  const res = await api.put(`${BASE}/edit/project`, params)
  return res.data
}

export async function submitDirectorEditRender(
  episodeId: number
): Promise<ApiResponse<{ projectId: number }>> {
  const res = await api.post(`${BASE}/edit/render`, { episodeId })
  return res.data
}

export async function getDirectorEditRenderProgress(
  projectId: number
): Promise<ApiResponse<{ stage: string; percent: number; detail: string }>> {
  const res = await api.get(`${BASE}/edit/renderProgress`, {
    params: { projectId },
  })
  return res.data
}

export async function correctDirectorSubtitles(params: {
  episodeId: number
  subtitles: unknown
}): Promise<ApiResponse<unknown>> {
  const res = await api.post(`${BASE}/edit/subtitleCorrect`, params)
  return res.data
}

// ============================================================================
// 文件上传（剪辑页素材替换 / 贴纸 / 音频）
// ============================================================================

export async function uploadDirectorFile(params: {
  file: File
  projectId?: number
}): Promise<ApiResponse<{ url: string }>> {
  const form = new FormData()
  form.append('file', params.file)
  if (params.projectId) form.append('projectId', String(params.projectId))
  const res = await api.post(`${BASE}/upload`, form)
  return res.data
}

// ============================================================================
// 素材库
// ============================================================================

export async function getDirectorAssets(
  params: AssetListParams = {}
): Promise<ApiResponse<PageResult<DirectorAsset>>> {
  const res = await api.get(`${BASE}/asset/list`, { params })
  return res.data
}

export async function updateDirectorAsset(data: {
  id: number
  name: string
  type: string
  category: string
  url: string
  isFavorite: boolean
  projectId?: number
}): Promise<ApiResponse<DirectorAsset>> {
  const res = await api.put(`${BASE}/asset`, data)
  return res.data
}

export async function deleteDirectorAsset(
  id: number
): Promise<ApiResponse<null>> {
  const res = await api.delete(`${BASE}/asset`, { params: { id } })
  return res.data
}

export async function uploadDirectorAsset(params: {
  file: File
  projectId?: number
  episodeId?: number
  category?: string
}): Promise<ApiResponse<{ url: string; asset: DirectorAsset }>> {
  const form = new FormData()
  form.append('file', params.file)
  if (params.projectId) form.append('projectId', String(params.projectId))
  if (params.episodeId) form.append('episodeId', String(params.episodeId))
  if (params.category) form.append('category', params.category)
  const res = await api.post(`${BASE}/asset/upload`, form)
  return res.data
}

// ============================================================================
// 素材自定义分类
// ============================================================================

export async function getDirectorAssetCategories(): Promise<
  ApiResponse<DirectorAssetCategory[]>
> {
  const res = await api.get(`${BASE}/asset/category/list`)
  return res.data
}

export async function createDirectorAssetCategory(
  name: string
): Promise<ApiResponse<DirectorAssetCategory>> {
  const res = await api.post(`${BASE}/asset/category`, { name })
  return res.data
}

export async function updateDirectorAssetCategory(params: {
  id: number
  name: string
}): Promise<ApiResponse<null>> {
  const res = await api.put(`${BASE}/asset/category`, params)
  return res.data
}

export async function deleteDirectorAssetCategory(
  id: number
): Promise<ApiResponse<null>> {
  const res = await api.delete(`${BASE}/asset/category`, {
    data: { id },
  })
  return res.data
}
