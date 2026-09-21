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

/** Total pixel budget per resolution class (1K ≈ 1024×1024 and so on). */
const RESOLUTION_PIXELS: Record<string, number> = {
  '1K': 1024 * 1024,
  '2K': 2048 * 2048,
  '4K': 4096 * 4096,
}

const MIN_EDGE = 512
const MAX_EDGE = 4096

function snapEdge(value: number): number {
  return Math.round(value / 8) * 8
}

/**
 * Turn the resolution + aspect-ratio pickers into an explicit `WIDTHxHEIGHT`
 * size. Upstream image APIs reject the bare `1K` shorthand (only
 * `WIDTHxHEIGHT`, `2k`, `3k`, `4k` are accepted) and the shorthands silently
 * drop the chosen ratio, so always send explicit pixels: the ratio is
 * preserved while the total pixel count stays in the picked resolution
 * class. When a ratio cannot fit the edge limits at that class, the ratio
 * wins and the pixel budget shrinks.
 */
export function buildImageSize(resolution: string, ratio: string): string {
  const total = RESOLUTION_PIXELS[resolution] ?? RESOLUTION_PIXELS['1K']
  const [ratioWidth, ratioHeight] = ratio.split(':').map(Number)
  const w = Number.isFinite(ratioWidth) && ratioWidth > 0 ? ratioWidth : 1
  const h = Number.isFinite(ratioHeight) && ratioHeight > 0 ? ratioHeight : 1
  let width = Math.sqrt(total * (w / h))
  let height = total / width
  if (width > MAX_EDGE) {
    width = MAX_EDGE
    height = (width * h) / w
  } else if (height > MAX_EDGE) {
    height = MAX_EDGE
    width = (height * w) / h
  }
  if (width < MIN_EDGE) {
    width = MIN_EDGE
    height = (width * h) / w
  } else if (height < MIN_EDGE) {
    height = MIN_EDGE
    width = (height * w) / h
  }
  return `${snapEdge(width)}x${snapEdge(height)}`
}
