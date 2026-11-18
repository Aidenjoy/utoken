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
import { proxyImageUrl } from '../api'
import type { CanvasDocument, CanvasLayer } from '../types'

// 智能画布：离屏合成与导出
// 所有图片都经同源代理加载，否则跨域图片会把画布标记为污染，
// toBlob/toDataURL 直接抛 SecurityError（导出与缩略图都会失效）。

const imageCache = new Map<string, Promise<HTMLImageElement>>()

/** 加载图片（同源代理 + 内存缓存，重复导出不重复下载） */
export function loadCanvasImage(url: string): Promise<HTMLImageElement> {
  const src = proxyImageUrl(url)
  const cached = imageCache.get(src)
  if (cached) return cached
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.addEventListener('load', () => resolve(img))
    img.addEventListener('error', () => {
      imageCache.delete(src)
      reject(new Error('图片加载失败'))
    })
    img.src = src
  })
  imageCache.set(src, promise)
  return promise
}

/** 按字符宽度折行（与画布文本图层的渲染宽度保持一致） */
function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    let current = ''
    for (const char of paragraph) {
      const next = current + char
      if (current !== '' && ctx.measureText(next).width > maxWidth) {
        lines.push(current)
        current = char
      } else {
        current = next
      }
    }
    if (current !== '') lines.push(current)
  }
  return lines
}

/** 把一个图层画到离屏画布上（顺序即叠放顺序） */
async function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: CanvasLayer
): Promise<void> {
  if (!layer.visible || layer.opacity <= 0) return
  const centerX = layer.x + layer.width / 2
  const centerY = layer.y + layer.height / 2
  ctx.save()
  ctx.globalAlpha = Math.min(Math.max(layer.opacity, 0), 1)
  ctx.translate(centerX, centerY)
  ctx.rotate((layer.rotation * Math.PI) / 180)
  ctx.scale(layer.scale || 1, layer.scale || 1)
  ctx.translate(-layer.width / 2, -layer.height / 2)

  if (layer.type === 'image' && layer.url) {
    try {
      const img = await loadCanvasImage(layer.url)
      const crop = layer.crop ?? {
        x: 0,
        y: 0,
        width: img.naturalWidth,
        height: img.naturalHeight,
      }
      ctx.drawImage(
        img,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        layer.width,
        layer.height
      )
    } catch {
      // 单张图片加载失败不影响整幅导出：留白并继续
    }
  } else if (layer.type === 'text' && layer.text) {
    const fontSize = layer.fontSize ?? 32
    ctx.fillStyle = layer.color ?? '#111827'
    ctx.font = `${fontSize}px sans-serif`
    ctx.textBaseline = 'top'
    const lineHeight = fontSize * 1.3
    const lines = wrapTextLines(ctx, layer.text, layer.width)
    lines.forEach((line, index) => {
      const y = index * lineHeight
      if (y > layer.height) return
      ctx.fillText(line, 0, y)
    })
  }
  ctx.restore()
}

/** 把文档按目标分辨率合成到一张离屏画布 */
export async function renderDocumentToCanvas(
  doc: CanvasDocument,
  scale = 1
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(doc.width * scale))
  canvas.height = Math.max(1, Math.round(doc.height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持 Canvas 2D')
  ctx.scale(scale, scale)
  if (doc.background) {
    ctx.fillStyle = doc.background
    ctx.fillRect(0, 0, doc.width, doc.height)
  }
  for (const layer of doc.layers) {
    await drawLayer(ctx, layer)
  }
  return canvas
}

export type CanvasExportFormat = 'png' | 'jpeg'

/** 导出整幅画布为 PNG / JPEG */
export async function exportCanvasImage(
  doc: CanvasDocument,
  format: CanvasExportFormat,
  quality = 0.92
): Promise<Blob> {
  const canvas = await renderDocumentToCanvas(doc)
  const mime = format === 'png' ? 'image/png' : 'image/jpeg'
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('导出失败：画布未被浏览器允许读取'))
      },
      mime,
      format === 'jpeg' ? quality : undefined
    )
  })
}

/** 生成项目缩略图（JPEG data URL，长边不超过 maxSide） */
export async function documentThumbnail(
  doc: CanvasDocument,
  maxSide = 480
): Promise<string> {
  if (doc.width <= 0 || doc.height <= 0) return ''
  const scale = Math.min(maxSide / Math.max(doc.width, doc.height), 1)
  const canvas = await renderDocumentToCanvas(doc, scale)
  return canvas.toDataURL('image/jpeg', 0.7)
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  // 交给下一轮事件循环回收，避免 Safari 下载被中断
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 导出文件名：项目名 + 时间戳 */
export function exportFilename(
  title: string,
  format: CanvasExportFormat
): string {
  const safe = (title || 'canvas').replaceAll(/[\\/:*?"<>|]/g, '_').slice(0, 40)
  const stamp = new Date().toISOString().replaceAll(/[-:T]/g, '').slice(0, 14)
  return `${safe}_${stamp}.${format === 'png' ? 'png' : 'jpg'}`
}
