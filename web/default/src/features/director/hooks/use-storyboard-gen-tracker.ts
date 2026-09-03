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
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  getDirectorImageGenerations,
  getDirectorVideoGenerations,
} from '../api'

const POLL_INTERVAL = { image: 3000, video: 5000 } as const

interface StoryboardGenTrackerOptions {
  kind: 'image' | 'video'
  projectId: number
  /** 有任务结束时回调（重载列表 + 刷新流水线） */
  onChange: () => void
}

/**
 * 分镜生成任务跟踪（对齐参考实现 shotsStep/videosStep 的轮询逻辑）：
 * markGenerating 标记提交中的分镜，随后按 kind 间隔轮询任务表；
 * 跟踪中的 storyboardId 不再 processing 即视为结束，toast 通知并回调 onChange。
 * 仅本次会话提交的任务会 toast（刷新/切页后恢复的不打扰）。
 */
export function useStoryboardGenTracker(opts: StoryboardGenTrackerOptions) {
  const { t } = useTranslation()
  const [generatingIds, setGeneratingIds] = React.useState<ReadonlySet<number>>(
    () => new Set()
  )
  const idsRef = React.useRef<Set<number>>(new Set())
  const mySubmittedRef = React.useRef(new Set<number>())
  const onChangeRef = React.useRef(opts.onChange)
  onChangeRef.current = opts.onChange

  const syncIds = (next: Set<number>) => {
    idsRef.current = next
    setGeneratingIds(next)
  }

  const markGenerating = React.useCallback(
    (storyboardId: number, mine = true) => {
      if (mine) mySubmittedRef.current.add(storyboardId)
      const next = new Set(idsRef.current)
      next.add(storyboardId)
      syncIds(next)
    },
    []
  )

  const adoptGenerating = React.useCallback((ids: Iterable<number>) => {
    const next = new Set(idsRef.current)
    for (const id of ids) next.add(id)
    if (next.size !== idsRef.current.size) syncIds(next)
  }, [])

  React.useEffect(() => {
    if (generatingIds.size === 0) return
    let cancelled = false

    const notifyFinished = async (storyboardId: number) => {
      if (!mySubmittedRef.current.has(storyboardId)) return
      mySubmittedRef.current.delete(storyboardId)
      try {
        const res =
          opts.kind === 'image'
            ? await getDirectorImageGenerations({ storyboardId, page_size: 1 })
            : await getDirectorVideoGenerations({ storyboardId, page_size: 1 })
        const task = res.data?.list?.[0]
        if (task?.status === 'failed') {
          toast.error(
            opts.kind === 'image'
              ? t('Image generation failed: {{msg}}', {
                  msg: task.errorMsg || t('Unknown error'),
                })
              : t('Video generation failed: {{msg}}', {
                  msg: task.errorMsg || t('Unknown error'),
                })
          )
        } else if (task?.status === 'success') {
          toast.success(
            opts.kind === 'image'
              ? t('Image generation finished')
              : t('Video generation finished')
          )
        }
      } catch {
        // 忽略查询异常
      }
    }

    const poll = async () => {
      try {
        const res =
          opts.kind === 'image'
            ? await getDirectorImageGenerations({
                projectId: opts.projectId,
                status: 'processing',
                page_size: 100,
              })
            : await getDirectorVideoGenerations({
                projectId: opts.projectId,
                status: 'processing',
                page_size: 100,
              })
        if (cancelled) return
        const processing = new Set(
          (res.data?.list ?? [])
            .map((task) => task.storyboardId)
            .filter((id): id is number => Boolean(id))
        )
        const finished: number[] = []
        const next = new Set<number>()
        for (const id of idsRef.current) {
          if (processing.has(id)) next.add(id)
          else finished.push(id)
        }
        if (finished.length === 0) return
        syncIds(next)
        for (const id of finished) void notifyFinished(id)
        onChangeRef.current()
      } catch {
        // 轮询失败静默重试
      }
    }

    const timer = setInterval(poll, POLL_INTERVAL[opts.kind])
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatingIds.size > 0, opts.kind, opts.projectId, t])

  return { generatingIds, markGenerating, adoptGenerating }
}
