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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import { getDirectorEpisodePipeline } from '../api'
import { PIPELINE_STEP_LABEL } from '../constants'
import type { DirectorPipelineStep } from '../types'
import { ContentStep } from './content-step'
import { EditStep } from './edit-step'
import { EntityStep } from './entity-step'
import { ExtractStep } from './extract-step'
import { RewriteStep } from './rewrite-step'
import { ShotsStep } from './shots-step'
import { StoryboardStep } from './storyboard-step'
import { VideosStep } from './videos-step'

interface DirectorStudioProps {
  episodeId: number
  projectId: number
}

export function DirectorStudio(props: DirectorStudioProps) {
  const queryClient = useQueryClient()

  const [activeKey, setActiveKey] = React.useState('content')

  const pipelineQuery = useQuery({
    queryKey: ['director', 'pipeline', props.episodeId],
    queryFn: () => getDirectorEpisodePipeline(props.episodeId),
    refetchInterval: (query) => {
      // 存在未完成步骤时轮询刷新进度
      const steps = query.state.data?.data?.steps
      if (!steps) return false
      return steps.some((s) => !s.done) ? 10000 : false
    },
  })

  const episode = pipelineQuery.data?.data?.episode
  const steps = pipelineQuery.data?.data?.steps ?? []

  // 步骤完成后统一刷新流水线与各列表
  const refreshPipeline = () => {
    void queryClient.invalidateQueries({
      queryKey: ['director', 'pipeline', props.episodeId],
    })
  }

  // 后端返回的步骤顺序即为导航顺序；当前选中步骤不存在时回退到第一步
  const activeStep = steps.find((s) => s.key === activeKey) ?? steps[0]
  const activeKeyResolved = activeStep?.key ?? 'content'

  React.useEffect(() => {
    if (steps.length > 0 && !steps.some((s) => s.key === activeKey)) {
      setActiveKey(steps[0]?.key ?? 'content')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steps])

  const renderPanel = () => {
    if (pipelineQuery.isPending || !episode) {
      return (
        <div className='space-y-3'>
          {['s1', 's2', 's3'].map((key) => (
            <Skeleton key={key} className='h-24 w-full' />
          ))}
        </div>
      )
    }
    switch (activeKeyResolved) {
      case 'content':
        return <ContentStep episode={episode} onSaved={refreshPipeline} />
      case 'rewrite':
        return <RewriteStep episode={episode} onSaved={refreshPipeline} />
      case 'extract':
        return <ExtractStep episode={episode} onSaved={refreshPipeline} />
      case 'chars':
        return <EntityStep type='character' projectId={props.projectId} />
      case 'props':
        return <EntityStep type='prop' projectId={props.projectId} />
      case 'scenes':
        return <EntityStep type='scene' projectId={props.projectId} />
      case 'storyboard':
        return <StoryboardStep episode={episode} onSaved={refreshPipeline} />
      case 'shots':
        return <ShotsStep episode={episode} onSaved={refreshPipeline} />
      case 'videos':
        return <VideosStep episode={episode} onSaved={refreshPipeline} />
      case 'edit':
        return <EditStep episode={episode} onSaved={refreshPipeline} />
      default:
        return <ContentStep episode={episode} onSaved={refreshPipeline} />
    }
  }

  return (
    <div className='flex flex-col gap-4 lg:flex-row'>
      {/* 左侧步骤导航 */}
      <div className='shrink-0 space-y-2 lg:w-64'>
        {pipelineQuery.isPending ? (
          <div className='space-y-2'>
            {['s1', 's2', 's3', 's4', 's5'].map((key) => (
              <Skeleton key={key} className='h-10 w-full' />
            ))}
          </div>
        ) : (
          <nav className='flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible'>
            {steps.map((step, index) => (
              <StepNavItem
                key={step.key}
                step={step}
                index={index}
                active={step.key === activeKeyResolved}
                onClick={() => setActiveKey(step.key)}
              />
            ))}
          </nav>
        )}
      </div>

      {/* 右侧步骤面板 */}
      <div className='min-w-0 flex-1 rounded-xl border p-4'>
        {renderPanel()}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------------------
// 步骤导航项
// ----------------------------------------------------------------------------

interface StepNavItemProps {
  step: DirectorPipelineStep
  index: number
  active: boolean
  onClick: () => void
}

function StepNavItem(props: StepNavItemProps) {
  const { t } = useTranslation()

  let badgeClass = 'border-muted-foreground/40'
  if (props.step.done) {
    badgeClass = 'border-emerald-500 bg-emerald-500 text-white'
  } else if (props.active) {
    badgeClass = 'border-primary text-primary'
  }

  return (
    <button
      type='button'
      onClick={props.onClick}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
        'hover:bg-accent hover:text-accent-foreground',
        props.active
          ? 'border-primary bg-accent text-accent-foreground'
          : 'border-transparent text-muted-foreground'
      )}
    >
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
          badgeClass
        )}
      >
        {props.step.done ? (
          <Check aria-hidden='true' className='size-3' />
        ) : (
          props.index + 1
        )}
      </span>
      <span className='min-w-0 flex-1 truncate font-medium'>
        {t(PIPELINE_STEP_LABEL[props.step.key] ?? props.step.name)}
      </span>
      <span className='text-muted-foreground shrink-0 text-xs'>
        {props.step.finished}/{props.step.total}
      </span>
    </button>
  )
}
