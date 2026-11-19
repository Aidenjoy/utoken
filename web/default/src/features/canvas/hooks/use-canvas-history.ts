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
import * as React from 'react'

import type { CanvasTab } from '../types'

// ===== 画布历史栈（移植自 BeefTV use-canvas-history：撤销/重做 + 连续手势合并） =====
// 快照只含结构（画布标题/节点/连线），视口由调用方在恢复时保留，避免撤销时镜头跳动。
// 离散操作先 record() 再修改；拖拽/缩放/输入等连续手势 beginContinuous() 一次，
// 期间多次修改不重复入栈，endContinuous() 收尾。

export interface CanvasHistorySnapshot {
  canvases: CanvasTab[]
  activeCanvasId: string
}

const HISTORY_LIMIT = 100

function cloneSnapshot(snap: CanvasHistorySnapshot): CanvasHistorySnapshot {
  return structuredClone(snap)
}

export function useCanvasHistory(opts: {
  getSnapshot: () => CanvasHistorySnapshot | null
  restore: (snap: CanvasHistorySnapshot) => void
}) {
  const optsRef = React.useRef(opts)
  optsRef.current = opts
  const undoStack = React.useRef<CanvasHistorySnapshot[]>([])
  const redoStack = React.useRef<CanvasHistorySnapshot[]>([])
  const continuousRef = React.useRef(false)
  const [, setVersion] = React.useState(0)
  const bump = React.useCallback(() => setVersion((v) => v + 1), [])

  const pushUndo = React.useCallback(() => {
    const snap = optsRef.current.getSnapshot()
    if (!snap) return
    undoStack.current.push(cloneSnapshot(snap))
    if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift()
    redoStack.current = []
    bump()
  }, [bump])

  // 离散操作：记录修改前快照
  const record = React.useCallback(() => {
    if (continuousRef.current) return
    pushUndo()
  }, [pushUndo])

  // 连续手势起点：仅首次记录
  const beginContinuous = React.useCallback(() => {
    if (continuousRef.current) return
    continuousRef.current = true
    pushUndo()
  }, [pushUndo])

  const endContinuous = React.useCallback(() => {
    continuousRef.current = false
  }, [])

  const undo = React.useCallback(() => {
    const snap = undoStack.current.pop()
    if (!snap) return
    const current = optsRef.current.getSnapshot()
    if (current) redoStack.current.push(cloneSnapshot(current))
    continuousRef.current = false
    optsRef.current.restore(cloneSnapshot(snap))
    bump()
  }, [bump])

  const redo = React.useCallback(() => {
    const snap = redoStack.current.pop()
    if (!snap) return
    const current = optsRef.current.getSnapshot()
    if (current) undoStack.current.push(cloneSnapshot(current))
    continuousRef.current = false
    optsRef.current.restore(cloneSnapshot(snap))
    bump()
  }, [bump])

  const clear = React.useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    continuousRef.current = false
    bump()
  }, [bump])

  return {
    record,
    beginContinuous,
    endContinuous,
    undo,
    redo,
    clear,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  }
}
