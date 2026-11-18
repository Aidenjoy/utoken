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
import type { CanvasColorTheme } from './types'

// ===== 画布主题 token（移植自 BeefTV canvas-theme，画布独立于站点主题） =====

export const canvasThemes = {
  light: {
    canvas: {
      background: '#f0f0f0',
      dot: 'rgba(0,0,0,.80)',
      line: 'rgba(0,0,0,.80)',
    },
    node: {
      fill: '#ffffff',
      panel: '#ffffff',
      stroke: '#e2e4e8',
      edge: 'rgba(15,23,42,.16)',
      shadow: '0 6px 18px rgba(15,23,42,.08)',
      hoverShadow: '0 10px 24px rgba(15,23,42,.12)',
      activeStroke: '#111827',
      placeholder: '#9ca3af',
      text: '#111827',
      muted: '#6b7280',
      faint: '#9ca3af',
    },
    toolbar: {
      panel: 'rgba(255,255,255,.94)',
      border: 'rgba(17,24,39,.10)',
      item: '#4b5563',
      itemHover: 'rgba(17,24,39,.06)',
      activeBg: 'rgba(17,24,39,.10)',
      activeText: '#111827',
    },
    accent: {
      primary: '#171717',
      primarySoft: 'rgba(17,17,17,.10)',
      onPrimary: '#ffffff',
      danger: '#f87171',
    },
  },
  dark: {
    canvas: {
      // BeefTV 原版画布采样基线为 #141414，而不是纯黑；点阵保持低对比度
      background: '#141414',
      dot: 'rgba(175,175,175,.24)',
      line: 'rgba(175,175,175,.24)',
    },
    node: {
      fill: '#262626',
      panel: '#222222',
      stroke: 'rgba(255,255,255,.18)',
      edge: 'rgba(255,255,255,.18)',
      shadow: '0 8px 24px rgba(0,0,0,.34)',
      hoverShadow: '0 12px 30px rgba(0,0,0,.46)',
      activeStroke: '#f1f1f1',
      placeholder: '#737373',
      text: '#ededed',
      muted: '#a3a3a3',
      faint: '#666666',
    },
    toolbar: {
      panel: 'rgba(20,20,20,.97)',
      border: 'rgba(255,255,255,.1)',
      item: '#d4d4d4',
      itemHover: 'rgba(255,255,255,.07)',
      activeBg: 'rgba(255,255,255,.10)',
      activeText: '#f5f6f8',
    },
    accent: {
      primary: '#f5f5f5',
      primarySoft: 'rgba(255,255,255,.11)',
      onPrimary: '#131313',
      danger: '#fb7185',
    },
  },
} as const

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme]

export function getCanvasTheme(theme: CanvasColorTheme): CanvasTheme {
  return canvasThemes[theme]
}
