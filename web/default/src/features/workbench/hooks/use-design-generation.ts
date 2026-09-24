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
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { getUserModels } from '@/lib/api'
import { getModelCategory } from '@/lib/model-category'

import { generateImageBatch } from '../api'
import type { ResultPhase } from '../components/result-panel'
import type { DesignPlan } from '../design-types'
import { designPlanToBodies } from '../lib/design-plan'
import { saveGenerationToLibrary } from '../lib/save-to-library'

/** 两个新页面共用执行器；计划由行业构造函数在首个请求前完整校验。 */
export function useDesignGeneration(title: string) {
  const { t } = useTranslation()
  const [model, setModel] = useState('')
  const [phase, setPhase] = useState<ResultPhase>('idle')
  const [results, setResults] = useState<string[]>([])
  const [labels, setLabels] = useState<string[]>([])
  const [error, setError] = useState('')
  const running = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const { data } = useQuery({
    queryKey: ['try-on-models'],
    queryFn: getUserModels,
  })
  const models = useMemo(
    () =>
      (data?.success ? (data.data ?? []) : []).filter(
        (name) => getModelCategory(name) === 'image'
      ),
    [data]
  )
  const imageModel = models.includes(model) ? model : (models[0] ?? '')
  useEffect(() => () => controller.current?.abort(), [])

  const generate = async (plan: DesignPlan, resolution: string) => {
    if (running.current) return
    if (!imageModel) {
      toast.error(t('Select an image model'))
      return
    }
    // 冻结标签、比例、提示词和源图，避免随后切换流程影响本轮结果。
    const snapshot = structuredClone(plan)
    const requests = designPlanToBodies(snapshot, resolution, imageModel)
    running.current = true
    controller.current = new AbortController()
    setLabels(snapshot.requests.map((request) => request.label))
    setResults([])
    setError('')
    setPhase('loading')
    const generated: string[] = []
    try {
      await generateImageBatch(
        requests,
        (url) => {
          generated.push(url)
          setResults([...generated])
        },
        controller.current.signal,
        snapshot.continuity
      )
      setPhase('done')
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : t('Generation failed, please retry')
      setError(message)
      setPhase(generated.length ? 'done' : 'error')
      if (!controller.current.signal.aborted) toast.error(message)
    } finally {
      running.current = false
      if (generated.length) {
        void saveGenerationToLibrary(
          'viral-design',
          title,
          generated,
          snapshot.sources,
          t
        )
      }
    }
  }

  const clear = () => {
    if (running.current) return
    setPhase('idle')
    setResults([])
    setLabels([])
    setError('')
  }
  return {
    imageModel,
    setModel,
    modelOptions: models.map((name) => ({ label: name, value: name })),
    phase,
    results,
    labels,
    error,
    generate,
    clear,
    isLoading: phase === 'loading',
  }
}
