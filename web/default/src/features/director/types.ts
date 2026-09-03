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

// ============================================================================
// 云导演（Cloud Director）类型定义，与后端 model/director*.go 的 JSON 字段对应
// ============================================================================

export type DirectorCategory = 'drama' | 'ecommerce' | 'ad' | 'daily'

export type DirectorGenStatus = 'pending' | 'processing' | 'success' | 'failed'

export interface ApiResponse<T> {
  success: boolean
  message?: string
  data?: T
}

export interface PageResult<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

// ----------------------------------------------------------------------------
// 项目与分集
// ----------------------------------------------------------------------------

export interface DirectorProject {
  id: number
  createdAt: number
  updatedAt: number
  userId: number
  title: string
  category: DirectorCategory
  description: string
  genre: string
  style: string
  totalEpisodes: number
  totalDuration: number
  status: string
  thumbnail: string
  tags: string
  metadata: string
}

export interface DirectorProjectWithStats extends DirectorProject {
  episodeCount: number
  characterCount: number
  sceneCount: number
}

export interface DirectorCharacter {
  id: number
  createdAt: number
  updatedAt: number
  userId: number
  projectId: number
  name: string
  role: string
  prompt: string
  imageUrl: string
  source: string
}

export interface DirectorScene {
  id: number
  createdAt: number
  updatedAt: number
  userId: number
  projectId: number
  episodeId?: number | null
  location: string
  time: string
  prompt: string
  imageUrl: string
  source: string
  status: string
}

export interface DirectorProp {
  id: number
  createdAt: number
  updatedAt: number
  userId: number
  projectId: number
  name: string
  type: string
  prompt: string
  imageUrl: string
  source: string
  status: string
}

export interface DirectorEpisode {
  id: number
  createdAt: number
  updatedAt: number
  userId: number
  projectId: number
  episodeNumber: number
  title: string
  content: string
  scriptContent: string
  description: string
  duration: number
  targetDuration: number
  aspectRatio: string
  resolution: string
  metadata: string
  status: string
  videoUrl: string
  thumbnail: string
  characters?: DirectorCharacter[]
  scenes?: DirectorScene[]
}

// ----------------------------------------------------------------------------
// 分镜与生成任务
// ----------------------------------------------------------------------------

export interface DirectorStoryboard {
  id: number
  createdAt: number
  updatedAt: number
  userId: number
  episodeId: number
  sceneId?: number | null
  storyboardNumber: number
  title: string
  location: string
  time: string
  shotType: string
  angle: string
  movement: string
  result: string
  imagePrompt: string
  videoPrompt: string
  bgmPrompt: string
  soundEffect: string
  description: string
  duration: number
  firstFrameImage: string
  lastFrameImage: string
  composedImage: string
  referenceImages: string
  videoUrl: string
  subtitleUrl: string
  composedVideoUrl: string
  status: string
  characters?: DirectorCharacter[]
}

export interface DirectorImageGeneration {
  id: number
  createdAt: number
  updatedAt: number
  userId: number
  storyboardId?: number | null
  projectId?: number | null
  sceneId?: number | null
  characterId?: number | null
  propId?: number | null
  imageType: string
  frameType: string
  prompt: string
  negativePrompt: string
  model: string
  size: string
  seed: number
  imageUrl: string
  status: DirectorGenStatus
  taskId: string
  errorMsg: string
  referenceImages: string
  completedAt?: number | null
}

export interface DirectorVideoGeneration {
  id: number
  createdAt: number
  updatedAt: number
  userId: number
  storyboardId?: number | null
  projectId?: number | null
  imageGenId?: number | null
  prompt: string
  model: string
  referenceMode: string
  imageUrl: string
  firstFrameUrl: string
  lastFrameUrl: string
  referenceImageUrls: string
  duration: number
  resolution: string
  aspectRatio: string
  seed: number
  videoUrl: string
  status: DirectorGenStatus
  taskId: string
  errorMsg: string
  completedAt?: number | null
}

// ----------------------------------------------------------------------------
// 剪辑
// ----------------------------------------------------------------------------

export interface DirectorEditProject {
  id: number
  createdAt: number
  updatedAt: number
  userId: number
  episodeId: number
  projectId: number
  name: string
  timeline: string
  status: string
  outputUrl: string
  progress: number
  errorMsg: string
}

// ----------------------------------------------------------------------------
// 素材库
// ----------------------------------------------------------------------------

export interface DirectorAsset {
  id: number
  createdAt: number
  updatedAt: number
  userId: number
  projectId?: number | null
  episodeId?: number | null
  storyboardId?: number | null
  name: string
  type: string
  category: string
  url: string
  fileSize: number
  width: number
  height: number
  duration: number
  isFavorite: boolean
}

export interface DirectorAssetCategory {
  id: number
  createdAt: number
  updatedAt: number
  userId: number
  name: string
}

// 实体图片同步渠道素材库后的 asset_id 映射（后端按当前视频模型过滤）
export interface DirectorEntityAsset {
  id: number
  entityType: string
  entityId: number
  model: string
  channelId: number
  assetId: string
  status: string
}

export interface AssetListParams {
  projectId?: number
  episodeId?: number
  type?: string
  category?: string
  p?: number
  page_size?: number
}

// ----------------------------------------------------------------------------
// 模型设定与流水线
// ----------------------------------------------------------------------------

export interface DirectorModelSettings {
  id: number
  userId: number
  textModel: string
  imageModel: string
  videoModel: string
}

export interface DirectorSettingsResponse {
  settings: DirectorModelSettings | null
  token: {
    tokenId: number
    name: string
  } | null
}

export interface DirectorPipelineStep {
  key: string
  name: string
  total: number
  finished: number
  done: boolean
}

export interface DirectorEpisodePipeline {
  episode: DirectorEpisode
  steps: DirectorPipelineStep[]
}

// ----------------------------------------------------------------------------
// 表单与查询参数
// ----------------------------------------------------------------------------

export interface ProjectListParams {
  category?: string
  status?: string
  keyword?: string
  p?: number
  page_size?: number
}

export interface EpisodeListParams {
  projectId: number
  p?: number
  page_size?: number
}

export interface ProjectFormData {
  id?: number
  title: string
  category: DirectorCategory
  description: string
  genre: string
  style: string
  totalEpisodes: number
  thumbnail: string
  tags: string
}
