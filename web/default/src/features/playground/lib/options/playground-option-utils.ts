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
import type { GroupOption, ModelOption, PlaygroundChannel } from '../../types'

/**
 * 先选渠道再选模型：锁定渠道后模型列表只保留该渠道服务的模型
 * （与分组可用列表取交集；交集为空时展示渠道自身模型列表，
 * 便于超管查看渠道下都有什么模型）。Auto（0）保持常规分组列表。
 */
export function getChannelModelOptions(
  models: ModelOption[],
  channels: PlaygroundChannel[],
  channelId: number
): ModelOption[] {
  if (channelId <= 0) return models
  const channel = channels.find((ch) => ch.id === channelId)
  if (!channel) return models
  const served = new Set(channel.models)
  const intersection = models.filter((model) => served.has(model.value))
  if (intersection.length > 0) return intersection
  return channel.models.map((name) => ({ label: name, value: name }))
}

export function getModelFallback(
  models: ModelOption[],
  currentModel: string
): string | null {
  const hasCurrentModel = models.some((model) => model.value === currentModel)

  if (hasCurrentModel || models.length === 0) {
    return null
  }

  return models[0].value
}

export function shouldClearModelForGroup(
  models: ModelOption[],
  currentModel: string
): boolean {
  if (currentModel === '') {
    return false
  }

  return !models.some((model) => model.value === currentModel)
}

export function getGroupFallback(
  groups: GroupOption[],
  currentGroup: string
): string | null {
  const hasCurrentGroup = groups.some((group) => group.value === currentGroup)

  if (hasCurrentGroup || groups.length === 0) {
    return null
  }

  return (
    groups.find((group) => group.value === 'default')?.value ?? groups[0].value
  )
}

export function getOptionLoadErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
  return error instanceof Error ? error.message : fallbackMessage
}
