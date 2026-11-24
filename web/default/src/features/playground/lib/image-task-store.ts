import type { ImageTask } from '../types'
import { loadImageTasks, saveImageTasks } from './storage/image-storage'

// 模块级任务 store：切换菜单会卸载体验组件，但进行中的生图请求不能随之中断
// （后端仍会渲染完并照常计费，页面却丢结果、日志响应快照为空）。任务与请求
// 句柄因此住在 React 之外：组件用 useSyncExternalStore 订阅，重新挂载后继续
// 接收同一次请求的进度与结果。整页刷新仍会中断请求，loadImageTasks 按既有
// 约定丢弃 pending 任务。
let tasks: ImageTask[] = loadImageTasks()
const listeners = new Set<() => void>()

export function subscribeImageTasks(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getImageTasks(): ImageTask[] {
  return tasks
}

function commit(next: ImageTask[]): void {
  tasks = next
  saveImageTasks(tasks)
  for (const listener of listeners) listener()
}

export function appendImageTask(task: ImageTask): void {
  commit([...tasks, task])
}

export function updateImageTask(
  taskId: string,
  updater: (task: ImageTask) => ImageTask
): void {
  commit(tasks.map((task) => (task.id === taskId ? updater(task) : task)))
}

export function clearImageTasks(): void {
  commit([])
}

// abort 句柄同样放在模块级：菜单切换重新挂载后，stop() 仍能中断上一次挂载
// 发起的请求；组件内的 ref 会随卸载丢失。
let activeController: AbortController | null = null

export function setActiveGenerationController(
  controller: AbortController | null
): void {
  activeController = controller
}

export function abortActiveGeneration(): void {
  activeController?.abort()
}