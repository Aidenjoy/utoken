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
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Image as ImageIcon,
  Link2,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Video,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { splitCanvasScript } from '../api'
import type { CanvasTheme } from '../canvas-theme'
import {
  canvasId,
  type CanvasNode,
  type CanvasNodeMetadata,
  type CanvasScriptScene,
} from '../types'

// ===== 分镜脚本节点表格（对齐 BeefTV：管线步骤 + 镜头表格 + AI 拆分 composer） =====

const MIN_SHOT_DURATION = 2
const MAX_SHOT_DURATION = 15

interface CanvasScriptTableProps {
  node: CanvasNode
  theme: CanvasTheme
  modelConfigured: boolean
  textModelName?: string
  onPatchMetadata: (metadata: Partial<CanvasNodeMetadata>) => void
  onBeginEdit: () => void
  onEndEdit: () => void
  onExpandScene: (node: CanvasNode, scene: CanvasScriptScene) => void
  onSceneVideo: (node: CanvasNode, scene: CanvasScriptScene) => void
  onOpenSettings: () => void
  onNodeInfo: (node: CanvasNode) => void
  onEnlarge: (node: CanvasNode) => void
}

export function CanvasScriptTable(props: CanvasScriptTableProps) {
  const {
    node,
    theme,
    modelConfigured,
    textModelName,
    onPatchMetadata,
    onBeginEdit,
    onEndEdit,
    onExpandScene,
    onSceneVideo,
    onOpenSettings,
    onNodeInfo,
    onEnlarge,
  } = props
  const { t } = useTranslation()
  const scenes = node.metadata.scenes ?? []
  const totalDuration = scenes.reduce(
    (sum, scene) => sum + (scene.duration ?? 5),
    0
  )
  const [splitText, setSplitText] = React.useState('')
  const [perShot, setPerShot] = React.useState(0)
  const [totalTarget, setTotalTarget] = React.useState(0)
  const [splitting, setSplitting] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const updateScene = (sceneId: string, patch: Partial<CanvasScriptScene>) =>
    onPatchMetadata({
      scenes: scenes.map((scene) =>
        scene.id === sceneId ? { ...scene, ...patch } : scene
      ),
    })

  const runSplit = async () => {
    const script = splitText.trim()
    if (!script || splitting) return
    if (!modelConfigured) {
      onOpenSettings()
      return
    }
    setSplitting(true)
    try {
      const res = await splitCanvasScript({
        script,
        totalDuration: totalTarget > 0 ? totalTarget : undefined,
        perShotDuration: perShot > 0 ? perShot : undefined,
      })
      if (res.success && res.data && res.data.shots.length > 0) {
        onPatchMetadata({
          scenes: res.data.shots.map((shot) => ({
            id: canvasId('scene'),
            title: shot.title,
            description: shot.description,
            dialogue: shot.dialogue,
            narration: shot.narration ?? '',
            duration: shot.duration ?? 5,
            assetTitle: '',
          })),
        })
        toast.success(
          t('Split into {{count}} shots', { count: res.data.shots.length })
        )
      } else {
        toast.error(res.message || t('Script split failed'))
      }
    } catch {
      // 全局拦截器已提示
    } finally {
      setSplitting(false)
    }
  }

  const importScriptFile = async (file: File) => {
    try {
      const text = await file.text()
      setSplitText(text.slice(0, 8000))
    } catch {
      toast.error(t('Failed to read script file'))
    }
  }

  const headerCell = 'px-2 py-1.5 text-left text-[10px] font-semibold'

  return (
    <div
      className='flex size-full min-h-0 flex-col'
      data-canvas-no-zoom
    >
      {/* 头部：标题 + 统计 + 上传/放大/更多 */}
      <div className='flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-1.5'>
        <Clapperboard
          aria-hidden='true'
          className='size-3.5 shrink-0'
          style={{ color: theme.accent.primary }}
        />
        <span
          className='text-xs font-semibold'
          style={{ color: theme.node.text }}
        >
          {t('Storyboard script')}
        </span>
        <span
          className='rounded-md px-1.5 py-0.5 text-[10px] tabular-nums'
          style={{
            background: theme.toolbar.itemHover,
            color: theme.node.muted,
          }}
        >
          {t('{{shots}} shots · {{seconds}}s', {
            shots: scenes.length,
            seconds: totalDuration,
          })}
        </span>
        <div className='ml-auto flex items-center gap-0.5'>
          <button
            type='button'
            onClick={() => fileInputRef.current?.click()}
            className='flex size-6 items-center justify-center rounded-md transition-colors'
            style={{ color: theme.node.muted }}
            aria-label={t('Import script file')}
            title={t('Import script file')}
          >
            <Upload aria-hidden='true' className='size-3.5' />
          </button>
          <input
            ref={fileInputRef}
            type='file'
            accept='.txt,.md,text/plain'
            className='hidden'
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importScriptFile(file)
              event.target.value = ''
            }}
          />
          <button
            type='button'
            onClick={() => onEnlarge(node)}
            className='flex size-6 items-center justify-center rounded-md transition-colors'
            style={{ color: theme.node.muted }}
            aria-label={t('Enlarge node')}
            title={t('Enlarge node')}
          >
            <Maximize2 aria-hidden='true' className='size-3.5' />
          </button>
          <button
            type='button'
            onClick={() => onNodeInfo(node)}
            className='flex size-6 items-center justify-center rounded-md transition-colors'
            style={{ color: theme.node.muted }}
            aria-label={t('Node info')}
            title={t('Node info')}
          >
            <MoreHorizontal aria-hidden='true' className='size-3.5' />
          </button>
        </div>
      </div>

      {/* 管线步骤 */}
      <div
        className='flex shrink-0 flex-wrap items-center gap-1 px-3 pb-2 text-[10px]'
        style={{ color: theme.node.faint }}
      >
        <span
          className='rounded px-1.5 py-0.5'
          style={{
            background: theme.accent.primarySoft,
            color: theme.node.text,
          }}
        >
          {t('Shots')}
        </span>
        <span aria-hidden='true'>→</span>
        <span>{t('Shot images (optional)')}</span>
        <span aria-hidden='true'>→</span>
        <span>{t('Videos')}</span>
        <span aria-hidden='true'>→</span>
        <span>{t('Merge into film')}</span>
      </div>

      {/* 镜头表格 */}
      <div
        className='canvas-scroll mx-3 min-h-0 flex-1 overflow-auto rounded-lg'
        style={{ border: `1px solid ${theme.node.stroke}` }}
        data-canvas-wheel-scroll
        data-no-drag
        onPointerDown={(event) => event.stopPropagation()}
      >
        <table className='w-full border-collapse'>
          <thead
            className='sticky top-0 z-10'
            style={{ background: theme.node.panel }}
          >
            <tr style={{ color: theme.node.muted }}>
              <th className={`${headerCell} w-10`}>{t('No.')}</th>
              <th className={`${headerCell} w-20`}>{t('Duration')}</th>
              <th className={headerCell}>{t('Video prompt')}</th>
              <th className={`${headerCell} w-28`}>{t('Dialogue')}</th>
              <th className={`${headerCell} w-28`}>{t('Narration')}</th>
              <th className={`${headerCell} w-24`}>{t('Linked asset')}</th>
              <th className={`${headerCell} w-16`} />
            </tr>
          </thead>
          <tbody>
            {scenes.map((scene, index) => (
              <tr
                key={scene.id}
                className='group/row align-top'
                style={{ borderTop: `1px solid ${theme.node.stroke}` }}
              >
                <td
                  className='px-2 py-1.5 text-[11px] font-semibold tabular-nums'
                  style={{ color: theme.accent.primary }}
                >
                  {index + 1}
                </td>
                <td className='px-1 py-1'>
                  <div
                    className='flex h-7 items-center rounded-md'
                    style={{ border: `1px solid ${theme.node.stroke}` }}
                  >
                    <input
                      value={scene.duration ?? 5}
                      onFocus={onBeginEdit}
                      onBlur={onEndEdit}
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        if (Number.isFinite(value)) {
                          updateScene(scene.id, {
                            duration: Math.min(
                              MAX_SHOT_DURATION,
                              Math.max(0, Math.round(value))
                            ),
                          })
                        }
                      }}
                      aria-label={t('Shot duration')}
                      className='w-8 bg-transparent text-center text-[11px] tabular-nums outline-none'
                      style={{ color: theme.node.text }}
                    />
                    <span
                      className='text-[9px]'
                      style={{ color: theme.node.faint }}
                    >
                      s
                    </span>
                    <div className='ml-auto flex flex-col'>
                      <button
                        type='button'
                        onClick={() =>
                          updateScene(scene.id, {
                            duration: Math.min(
                              MAX_SHOT_DURATION,
                              (scene.duration ?? 5) + 1
                            ),
                          })
                        }
                        className='flex h-3 w-4 items-center justify-center'
                        style={{ color: theme.node.muted }}
                        aria-label={t('Increase duration')}
                      >
                        <ChevronUp aria-hidden='true' className='size-2.5' />
                      </button>
                      <button
                        type='button'
                        onClick={() =>
                          updateScene(scene.id, {
                            duration: Math.max(
                              MIN_SHOT_DURATION,
                              (scene.duration ?? 5) - 1
                            ),
                          })
                        }
                        className='flex h-3 w-4 items-center justify-center'
                        style={{ color: theme.node.muted }}
                        aria-label={t('Decrease duration')}
                      >
                        <ChevronDown aria-hidden='true' className='size-2.5' />
                      </button>
                    </div>
                  </div>
                </td>
                <td className='px-1 py-1'>
                  <textarea
                    value={scene.description}
                    rows={2}
                    onFocus={onBeginEdit}
                    onBlur={onEndEdit}
                    onChange={(event) =>
                      updateScene(scene.id, { description: event.target.value })
                    }
                    placeholder={t('Describe video motion, camera and action')}
                    aria-label={t('Video prompt')}
                    className='canvas-scroll w-full resize-none rounded-md bg-transparent p-1.5 text-[11px] leading-relaxed outline-none'
                    style={{ color: theme.node.text }}
                  />
                </td>
                <td className='px-1 py-1'>
                  <textarea
                    value={scene.dialogue}
                    rows={2}
                    onFocus={onBeginEdit}
                    onBlur={onEndEdit}
                    onChange={(event) =>
                      updateScene(scene.id, { dialogue: event.target.value })
                    }
                    placeholder={t('Dialogue or narration')}
                    aria-label={t('Dialogue')}
                    className='canvas-scroll w-full resize-none rounded-md bg-transparent p-1.5 text-[11px] leading-relaxed outline-none'
                    style={{ color: theme.node.muted }}
                  />
                </td>
                <td className='px-1 py-1'>
                  <textarea
                    value={scene.narration ?? ''}
                    rows={2}
                    onFocus={onBeginEdit}
                    onBlur={onEndEdit}
                    onChange={(event) =>
                      updateScene(scene.id, { narration: event.target.value })
                    }
                    placeholder={t('Narration (optional)')}
                    aria-label={t('Narration')}
                    className='canvas-scroll w-full resize-none rounded-md bg-transparent p-1.5 text-[11px] leading-relaxed outline-none'
                    style={{ color: theme.node.muted }}
                  />
                </td>
                <td className='px-2 py-1.5'>
                  <span
                    className='flex items-center gap-1 text-[10px]'
                    style={{
                      color: scene.assetTitle
                        ? theme.node.text
                        : theme.node.faint,
                    }}
                  >
                    <Link2 aria-hidden='true' className='size-3 shrink-0' />
                    <span className='truncate'>
                      {scene.assetTitle || t('Not linked')}
                    </span>
                  </span>
                </td>
                <td className='px-1 py-1'>
                  <div className='flex items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100'>
                    <button
                      type='button'
                      onClick={() => onExpandScene(node, scene)}
                      className='flex size-6 items-center justify-center rounded-md'
                      style={{ color: theme.node.muted }}
                      aria-label={t('Generate image from scene')}
                      title={t('Generate image from scene')}
                    >
                      <ImageIcon aria-hidden='true' className='size-3' />
                    </button>
                    <button
                      type='button'
                      onClick={() => onSceneVideo(node, scene)}
                      className='flex size-6 items-center justify-center rounded-md'
                      style={{ color: theme.node.muted }}
                      aria-label={t('Generate video from scene')}
                      title={t('Generate video from scene')}
                    >
                      <Video aria-hidden='true' className='size-3' />
                    </button>
                    <button
                      type='button'
                      onClick={() =>
                        onPatchMetadata({
                          scenes: scenes.filter((s) => s.id !== scene.id),
                        })
                      }
                      className='flex size-6 items-center justify-center rounded-md'
                      style={{ color: theme.accent.danger }}
                      aria-label={t('Delete scene')}
                      title={t('Delete scene')}
                    >
                      <Trash2 aria-hidden='true' className='size-3' />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type='button'
          onClick={() =>
            onPatchMetadata({
              scenes: [
                ...scenes,
                {
                  id: canvasId('scene'),
                  title: t('Scene {{n}}', { n: scenes.length + 1 }),
                  description: '',
                  dialogue: '',
                  narration: '',
                  duration: 6,
                  assetTitle: '',
                },
              ],
            })
          }
          className='flex h-8 w-full items-center justify-center gap-1.5 text-[11px] transition-colors'
          style={{
            borderTop: `1px dashed ${theme.node.stroke}`,
            color: theme.node.muted,
          }}
        >
          <Plus aria-hidden='true' className='size-3' />
          {t('Add row')}
        </button>
      </div>

      {/* AI 拆分 composer */}
      <div
        className='shrink-0 px-3 pt-2 pb-3'
        data-no-drag
        onPointerDown={(event) => event.stopPropagation()}
      >
        <textarea
          value={splitText}
          rows={2}
          onChange={(event) => setSplitText(event.target.value)}
          placeholder={t(
            'Enter a script or plot with requirements like total duration to auto-split into shots'
          )}
          aria-label={t('Script to split')}
          className='canvas-scroll w-full resize-none rounded-lg bg-transparent p-2 text-[11px] leading-relaxed outline-none'
          style={{
            color: theme.node.text,
            border: `1px solid ${theme.node.stroke}`,
          }}
        />
        <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
          <button
            type='button'
            onClick={onOpenSettings}
            className='flex h-7 max-w-44 items-center gap-1 rounded-full px-2.5 text-[10px]'
            style={{
              background: theme.toolbar.itemHover,
              color: modelConfigured ? theme.node.text : '#fcd34d',
            }}
            title={t('Select text model')}
          >
            {modelConfigured ? (
              <span className='truncate'>
                {textModelName || t('Text model')}
              </span>
            ) : (
              <>
                <Settings2 aria-hidden='true' className='size-3 shrink-0' />
                {t('Select text model')}
              </>
            )}
          </button>
          <button
            type='button'
            disabled={!splitText.trim() || splitting}
            onClick={() => void runSplit()}
            className='flex h-7 items-center gap-1 rounded-full px-2.5 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-40'
            style={{
              background: theme.accent.primary,
              color: theme.accent.onPrimary,
            }}
          >
            {splitting ? (
              <Loader2 aria-hidden='true' className='size-3 animate-spin' />
            ) : (
              <Sparkles aria-hidden='true' className='size-3' />
            )}
            {splitting ? t('Splitting...') : t('Auto split')}
          </button>
          <select
            value={perShot}
            onChange={(event) => setPerShot(Number(event.target.value))}
            className='h-7 rounded-full px-2 text-[10px] outline-none'
            style={{
              background: theme.toolbar.itemHover,
              color: theme.node.muted,
            }}
            aria-label={t('Per-shot duration')}
          >
            <option value={0}>{t('Auto per-shot duration')}</option>
            {[3, 4, 5, 6, 8, 10, 12, 15].map((value) => (
              <option key={value} value={value}>
                {t('{{n}}s per shot', { n: value })}
              </option>
            ))}
          </select>
          <input
            value={totalTarget || ''}
            onChange={(event) => {
              const value = Number(event.target.value)
              setTotalTarget(
                Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
              )
            }}
            placeholder={t('Total s')}
            aria-label={t('Total duration')}
            className='h-7 w-16 rounded-full px-2 text-[10px] tabular-nums outline-none'
            style={{
              background: theme.toolbar.itemHover,
              color: theme.node.text,
            }}
          />
          <button
            type='button'
            disabled={!splitText.trim() || splitting}
            onClick={() => void runSplit()}
            className='ml-auto flex size-7 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-35'
            style={{
              background: theme.accent.primary,
              color: theme.accent.onPrimary,
            }}
            aria-label={t('Split script')}
            title={t('Split script')}
          >
            {splitting ? (
              <Loader2 aria-hidden='true' className='size-3.5 animate-spin' />
            ) : (
              <ArrowUp aria-hidden='true' className='size-3.5' />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}