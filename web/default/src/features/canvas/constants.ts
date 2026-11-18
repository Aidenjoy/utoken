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
import type { CanvasLayer } from './types'

// 智能画布：UI 常量
// 工具清单与参数以 /api/canvas/capabilities 为准，这里只定义展示顺序与分组，
// 以及画布尺寸预设等纯前端约定。

export interface CanvasSizePreset {
  id: string
  label: string
  width: number
  height: number
}

export const CANVAS_SIZE_PRESETS: CanvasSizePreset[] = [
  { id: 'square', label: '1:1', width: 2048, height: 2048 },
  { id: 'portrait', label: '3:4', width: 1536, height: 2048 },
  { id: 'landscape', label: '4:3', width: 2048, height: 1536 },
  { id: 'story', label: '9:16', width: 1152, height: 2048 },
  { id: 'wide', label: '16:9', width: 2048, height: 1152 },
]

export const DEFAULT_CANVAS_SIZE = { width: 2048, height: 2048 }

export const CANVAS_BACKGROUNDS = [
  '#ffffff',
  '#f8fafc',
  '#0f172a',
  '#111827',
  '#fdf2f8',
  '#ecfdf5',
]

export interface CanvasToolGroup {
  id: string
  title: string
  tools: string[]
}

// 与后端 toolRegistry 的 10 个工具一一对应（顺序即面板展示顺序）
export const CANVAS_TOOL_GROUPS: CanvasToolGroup[] = [
  {
    id: 'generate',
    title: 'Generate',
    tools: ['text2image', 'image_ref_single', 'image_ref_multi'],
  },
  {
    id: 'edit',
    title: 'Edit',
    tools: ['erase', 'prompt_inpaint', 'ref_inpaint'],
  },
  { id: 'expand', title: 'Outpaint', tools: ['outpaint'] },
  { id: 'cutout', title: 'Cutout', tools: ['matting'] },
  { id: 'upscale', title: 'Upscale', tools: ['upscale', 'generative_upscale'] },
]

export const MASK_BRUSH_SIZES = [8, 16, 24, 40, 64]

// 扩图方式（与后端 convertExpandMode 的 mode 取值一致）
export const OUTPAINT_MODES = ['ratio', 'aspect', 'edges', 'canvas'] as const
export type OutpaintMode = (typeof OUTPAINT_MODES)[number]

export const ASPECT_OPTIONS = [
  '1:1',
  '4:3',
  '3:2',
  '16:9',
  '9:16',
  '3:4',
  '2:3',
]

export type StageTool = 'select' | 'pan' | 'mask-brush' | 'mask-rect'

export type LayerPatchHandler = (
  layerId: string,
  patch: Partial<CanvasLayer>
) => void
