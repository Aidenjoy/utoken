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
import type {
  PlaygroundConfig,
  ParameterEnabled,
  AspectRatio,
  VideoConfig,
  VideoMode,
} from './types'

// Message constants
export const MESSAGE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
} as const

export const MESSAGE_STATUS = {
  LOADING: 'loading',
  STREAMING: 'streaming',
  COMPLETE: 'complete',
  ERROR: 'error',
} as const

// API endpoints
export const API_ENDPOINTS = {
  CHAT_COMPLETIONS: '/pg/chat/completions',
  USER_MODELS: '/api/user/models',
  USER_GROUPS: '/api/user/self/groups',
} as const

// Default group — uses 'default' as the safe fallback; auto-group is
// only selected when the backend confirms it is available for the user.
export const DEFAULT_GROUP = 'default' as const

// Default configuration
export const DEFAULT_CONFIG: PlaygroundConfig = {
  model: 'gpt-4o',
  group: DEFAULT_GROUP,
  temperature: 0.7,
  top_p: 1,
  max_tokens: 4096,
  frequency_penalty: 0,
  presence_penalty: 0,
  seed: null,
  stream: true,
}

export const DEFAULT_PARAMETER_ENABLED: ParameterEnabled = {
  temperature: true,
  top_p: true,
  max_tokens: false,
  frequency_penalty: true,
  presence_penalty: true,
  seed: false,
}

// Storage keys
export const STORAGE_KEYS = {
  CONFIG: 'playground_config',
  MESSAGES: 'playground_messages',
  PARAMETER_ENABLED: 'playground_parameter_enabled',
} as const

// Error messages
export const ERROR_MESSAGES = {
  API_REQUEST_ERROR: 'Request error occurred',
  NETWORK_ERROR: 'Network connection failed or server not responding',
  PARSE_ERROR: 'Error parsing response data',
  STREAM_START_ERROR: 'Error establishing connection',
  CONNECTION_CLOSED: 'Connection closed',
  INTERRUPTED: 'Generation was interrupted',
} as const

// Message action button styles
export const MESSAGE_ACTION_BUTTON_STYLES = {
  BASE: 'size-7 text-muted-foreground hover:text-foreground',
  DELETE: 'size-7 text-muted-foreground hover:text-destructive',
  ICON: 'size-4',
} as const

// Video mode constants
export const VIDEO_API_ENDPOINTS = {
  SUBMIT: '/pg/video/generations',
  FETCH: (taskId: string) => `/pg/video/generations/${taskId}`,
  FILE_UPLOAD: '/pg/files/upload',
} as const

// Asset library (virtual portrait library) endpoints
export const ASSET_API_ENDPOINTS = {
  PROVIDERS: '/pg/assets/providers',
  UPLOAD: '/pg/assets/upload',
  LIST: '/pg/assets',
  DETAIL: (id: number) => `/pg/assets/${id}`,
} as const

export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  model: '',
  group: DEFAULT_GROUP,
  mode: 'reference',
  ratio: 'smart',
  resolution: '720P',
  duration: 5,
  count: 1,
  audio: true,
  images: [],
  mediaItems: [],
}

export const ASPECT_RATIOS: { value: AspectRatio; label: string }[] = [
  { value: 'smart', label: '智能' },
  { value: '21:9', label: '21:9' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: '1:1', label: '1:1' },
  { value: '3:4', label: '3:4' },
  { value: '9:16', label: '9:16' },
]

export const RESOLUTIONS = ['480P', '720P', '1080P', '4K'] as const
export const DURATION_OPTIONS = [
  4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
  24, 25, 26, 27, 28, 29, 30,
] as const
export const VIDEO_COUNT_RANGE = { min: 1, max: 8 } as const

export const VIDEO_STORAGE_KEYS = {
  VIDEO_CONFIG: 'playground_video_config',
  VIDEO_TASKS: 'playground_video_tasks',
} as const

export const VIDEO_MAX_DURATION = 30 // 视频总时长上限（秒）
export const AUDIO_MAX_DURATION = 30 // 音频总时长上限（秒）
export const MAX_VIDEOS = 3 // 最多视频数
export const MAX_AUDIOS = 3 // 最多音频数
export const MAX_REFERENCE_IMAGES = 9 // 参考模式最多图片数
export const IMAGE_ASPECT_RATIO_RANGE = { min: 0.4, max: 2.5 } // 图片宽高比范围（Volcengine Seedance API 限制）

export const VIDEO_MODES: { value: VideoMode; label: string; maxImages?: number }[] = [
  { value: 'reference', label: '参考生成' },
  { value: 'first_last_frame', label: '首尾帧', maxImages: 2 },
  { value: 'first_frame', label: '首帧', maxImages: 1 },
  { value: 'text_to_video', label: '文生视频', maxImages: 0 },
]

export const VIDEO_POLL_INTERVAL_MS = 3000

// Message action labels
export const MESSAGE_ACTION_LABELS = {
  COPY: 'Copy',
  COPIED: 'Copied!',
  REGENERATE: 'Regenerate',
  SHOW_PREVIEW: 'Show preview',
  SHOW_SOURCE: 'Show source',
  EDIT: 'Edit',
  DELETE: 'Delete',
  NO_CONTENT: 'No content to copy',
  WAIT_GENERATION: 'Please wait for the current generation to complete',
} as const
