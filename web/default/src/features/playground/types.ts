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
// Message types
export type MessageRole = 'user' | 'assistant' | 'system'

export type MessageStatus = 'loading' | 'streaming' | 'complete' | 'error'

export type PlaygroundMessageLayoutMode = 'alternating' | 'left'

export interface MessageVersion {
  id: string
  content: string
}

export interface Message {
  key: string
  from: MessageRole
  versions: MessageVersion[]
  createdAt?: number
  startedAt?: number
  completedAt?: number
  durationMs?: number
  sources?: { href: string; title: string }[]
  reasoning?: {
    content: string
    duration: number
    startedAt?: number
    completedAt?: number
    durationMs?: number
  }
  isReasoningStreaming?: boolean
  isReasoningComplete?: boolean
  isContentComplete?: boolean
  status?: MessageStatus
  errorCode?: string | null
}

// API payload types
export interface ChatCompletionMessage {
  role: MessageRole
  content: string | ContentPart[]
}

export interface ContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: {
    url: string
  }
}

export interface ChatCompletionRequest {
  model: string
  group?: string
  messages: ChatCompletionMessage[]
  stream: boolean
  temperature?: number
  top_p?: number
  max_tokens?: number
  frequency_penalty?: number
  presence_penalty?: number
  seed?: number
}

export interface ChatCompletionChunk {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    delta: {
      role?: MessageRole
      content?: string
      reasoning_content?: string
    }
    finish_reason: string | null
  }>
}

export interface ChatCompletionResponse {
  id: string
  object: string
  created: number
  model: string
  choices: Array<{
    index: number
    message: {
      role: MessageRole
      content: string
      reasoning_content?: string
    }
    finish_reason: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

// Configuration types
export interface PlaygroundConfig {
  model: string
  group: string
  temperature: number
  top_p: number
  max_tokens: number
  frequency_penalty: number
  presence_penalty: number
  seed: number | null
  stream: boolean
}

export interface ParameterEnabled {
  temperature: boolean
  top_p: boolean
  max_tokens: boolean
  frequency_penalty: boolean
  presence_penalty: boolean
  seed: boolean
}

// Model and group options
export interface ModelOption {
  label: string
  value: string
}

export interface GroupOption {
  label: string
  value: string
  ratio: number
  desc?: string
}

// Video mode types
export type VideoMode = 'reference' | 'first_last_frame' | 'first_frame' | 'text_to_video'
export type AspectRatio = 'smart' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
export type Resolution = '480P' | '720P' | '1080P' | '4K'
export type VideoTaskStatus = 'queued' | 'in_progress' | 'completed' | 'failed' | 'cancelled'

export interface MediaItem {
  /** Local preview URL (blob: or data:) */
  url: string
  /** Remote URL returned by Volcengine Files API after upload */
  remoteUrl?: string
  /** Duration in seconds (video/audio only; images have no duration) */
  duration?: number
  type: 'image' | 'video' | 'audio'
  /** Original file name */
  name: string
  /** Upstream asset ID (set when this item comes from the asset library) */
  assetId?: string
  /** Channel the asset was registered on (asset:// is only valid there) */
  assetChannelId?: number
}

// Asset library (virtual portrait library) types
export type AssetType = 'Image' | 'Video' | 'Audio'
export type AssetStatus = 'pending' | 'active' | 'failed'

export interface Asset {
  id: number
  created_at: number
  updated_at: number
  user_id: number
  channel_id: number
  asset_id: string
  name: string
  asset_type: AssetType
  status: AssetStatus
  source_url: string
  preview_url: string
  group_id: string
  project_name: string
  error_msg: string
}

export interface AssetProvider {
  id: number
  name: string
  protocol: string
}

export interface VideoConfig {
  model: string
  group: string
  mode: VideoMode
  ratio: AspectRatio
  resolution: Resolution
  duration: number
  count: number
  audio: boolean
  /** First/last frame mode uses base64 image strings */
  images: string[]
  /** Reference mode media items (images, videos, audio) */
  mediaItems: MediaItem[]
}

export interface VideoTask {
  taskId: string
  status: VideoTaskStatus
  progress: number
  videoUrl?: string
  error?: string
  model: string
  prompt: string
  images: string[]
  createdAt: number
  completedAt?: number
}

// Volcano Ark official protocol content item
// ({base}/api/v3/contents/generations/tasks)
export interface ArkContentItem {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url'
  text?: string
  image_url?: { url: string }
  video_url?: { url: string }
  audio_url?: { url: string }
  role?: string
}

// Request body of the Volcano Ark official protocol; the gateway passes it
// through to upstream as-is. `group` is a gateway-specific extension for
// group selection and is ignored by the official protocol.
export interface VideoSubmitRequest {
  model: string
  content: ArkContentItem[]
  generate_audio?: boolean
  ratio?: string
  resolution?: string
  duration?: number
  group?: string
}

export interface VideoSubmitResponse {
  id: string
  task_id?: string
  object: string
  model: string
  status: string
  created_at: number
}

export interface VideoTaskResponse {
  id: string
  task_id?: string
  object: string
  model: string
  status: string
  progress: number
  created_at: number
  completed_at?: number
  metadata?: {
    url?: string
    [key: string]: unknown
  }
  error?: {
    message: string
    code: string
  }
}
