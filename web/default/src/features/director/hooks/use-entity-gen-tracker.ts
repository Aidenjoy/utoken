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

import { getDirectorImageGenerations, type DirectorEntityType } from '../api'
import type { DirectorImageGeneration } from '../types'

const POLL_INTERVAL = 3000

// 各实体类型在生成任务记录中对应的外键字段：用于识别任务归属、以及结束后按外键查询终态
function entityIdOf(
  type: DirectorEntityType,
  task: DirectorImageGeneration
): number | null | undefined {
  if (type === 'character') return task.characterId
  if (type === 'scene') return task.sceneId
  return task.propId
}

function byEntityParams(
  type: DirectorEntityType,
  id: number
): { characterId?: number; sceneId?: number; propId?: number } {
  if (type === 'character') return { characterId: id }
  if (type === 'scene') return { sceneId: id }
  return { propId: id }
}

interface EntityGenTrackerOptions {
  type: DirectorEntityType
  projectId: number
  /** 有任务结束时回调（重载实体列表，图片已回写到实体） */
  onChange: () => void
}

/**
 * 实体（角色/场景/道具）图片生成任务跟踪，对齐 shotsStep/videosStep 的 useStoryboardGenTracker。
 *
 * 关键：批量提交后用【单个】列表轮询（status=processing）统一驱动所有卡片的“生成中”状态，
 * 而不是每张卡片各自轮询单条任务。后者在批量生成 N 个实体时会产生 N 路并发轮询，叠加流水线/
 * 素材轮询后轻易击穿全局限流（每 IP 180s/360 次）触发 429 风暴——前端每个失败的轮询请求都会
 * 经全局 axios 拦截器弹一个红色 toast，形成“疯狂报错”。本跟踪器把请求量从 N 路降到 1 路，
 * 且轮询失败静默重试（不打扰用户）；仅本次会话提交的任务在结束时 toast 结果。
 *
 * 挂载时一次性纳管本项目已在处理中的任务（刷新/切页返回后卡片继续显示“生成中”），
 * 这些非本次会话提交的任务结束时不 toast。
 */
export function useEntityGenTracker(opts: EntityGenTrackerOptions) {
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

  const markGenerating = React.useCallback((entityId: number, mine = true) => {
    if (mine) mySubmittedRef.current.add(entityId)
    const next = new Set(idsRef.current)
    next.add(entityId)
    syncIds(next)
  }, [])

  const adoptGenerating = React.useCallback((ids: Iterable<number>) => {
    const next = new Set(idsRef.current)
    for (const id of ids) next.add(id)
    if (next.size !== idsRef.current.size) syncIds(next)
  }, [])

  // 挂载/切换项目：把仍在处理中的本类型任务纳入跟踪（不标记为本次会话提交，故结束时不 toast）
  React.useEffect(() => {
    let cancelled = false
    void getDirectorImageGenerations({
      projectId: opts.projectId,
      status: 'processing',
      page_size: 100,
    })
      .then((res) => {
        if (cancelled) return
        const ids = (res.data?.list ?? [])
          .map((task) => entityIdOf(opts.type, task))
          .filter((id): id is number => Boolean(id))
        if (ids.length) adoptGenerating(ids)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.projectId, opts.type])

  React.useEffect(() => {
    if (generatingIds.size === 0) return
    let cancelled = false

    const notifyFinished = async (entityId: number) => {
      if (!mySubmittedRef.current.has(entityId)) return
      mySubmittedRef.current.delete(entityId)
      try {
        const res = await getDirectorImageGenerations({
          ...byEntityParams(opts.type, entityId),
          page_size: 1,
        })
        const task = res.data?.list?.[0]
        if (task?.status === 'failed') {
          toast.error(
            t('Image generation failed: {{msg}}', {
              msg: task.errorMsg || t('Unknown error'),
            })
          )
        } else if (task?.status === 'success') {
          toast.success(t('Image generation finished'))
        }
      } catch {
        // 忽略终态查询异常
      }
    }

    const poll = async () => {
      try {
        const res = await getDirectorImageGenerations({
          projectId: opts.projectId,
          status: 'processing',
          page_size: 100,
        })
        if (cancelled) return
        const processing = new Set(
          (res.data?.list ?? [])
            .map((task) => entityIdOf(opts.type, task))
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
        // 轮询失败静默重试（限流/网络抖动不打扰用户）
      }
    }

    const timer = setInterval(poll, POLL_INTERVAL)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatingIds.size > 0, opts.projectId, opts.type, t])

  return { generatingIds, markGenerating }
}
