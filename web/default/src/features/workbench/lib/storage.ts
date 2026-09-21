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
import { TRY_ON_STORAGE_KEY, TRY_ON_TASK_MAX } from '../constants'
import type { TryOnTask } from '../types'

/** Local run history, newest first; corrupt or oversized payloads are dropped. */
export function loadTryOnTasks(
  storageKey: string = TRY_ON_STORAGE_KEY
): TryOnTask[] {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, TRY_ON_TASK_MAX) as TryOnTask[]
  } catch {
    return []
  }
}

export function saveTryOnTask(
  task: TryOnTask,
  storageKey: string = TRY_ON_STORAGE_KEY
): TryOnTask[] {
  const tasks = [task, ...loadTryOnTasks(storageKey)].slice(0, TRY_ON_TASK_MAX)
  try {
    localStorage.setItem(storageKey, JSON.stringify(tasks))
  } catch {
    // Quota exceeded (base64 thumbs): keep the in-memory list for this session.
  }
  return tasks
}

export function removeTryOnTask(
  taskId: string,
  storageKey: string = TRY_ON_STORAGE_KEY
): TryOnTask[] {
  const tasks = loadTryOnTasks(storageKey).filter((task) => task.id !== taskId)
  try {
    localStorage.setItem(storageKey, JSON.stringify(tasks))
  } catch {
    // Ignore write failures; the next load recomputes from storage.
  }
  return tasks
}

export function clearTryOnTasks(storageKey: string = TRY_ON_STORAGE_KEY): void {
  try {
    localStorage.removeItem(storageKey)
  } catch {
    // Ignore: history simply stays empty for this session.
  }
}
