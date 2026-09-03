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
export type ModelCategory = 'text' | 'image' | 'video'

const VIDEO_MODEL_PATTERNS = [
  /seedance/i,
  /sora/i,
  /hailuo/i,
  /vidu/i,
  /kling/i,
  /jimeng/i,
  /veo/i,
  /wan-/i,
  /hunyuanvideo/i,
  /pika/i,
  /video/i,
]

// Checked after the video patterns so that names carrying both hints
// (for example hunyuan-image vs hunyuanvideo) keep their video behaviour.
const IMAGE_MODEL_PATTERNS = [
  /seedream/i,
  /dall-e/i,
  /gpt-image/i,
  /cogview/i,
  /flux/i,
  /imagen/i,
  /stable-diffusion/i,
  /sdxl/i,
  /kolors/i,
  /qwen-image/i,
  /hunyuan-image/i,
  /step-1x/i,
  /ideogram/i,
  /recraft/i,
  /t2i/i,
  /image/i,
]

export function getModelCategory(modelName: string): ModelCategory {
  if (VIDEO_MODEL_PATTERNS.some((p) => p.test(modelName))) {
    return 'video'
  }
  if (IMAGE_MODEL_PATTERNS.some((p) => p.test(modelName))) {
    return 'image'
  }
  return 'text'
}
