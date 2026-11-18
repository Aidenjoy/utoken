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
import { useEffect, useMemo } from 'react'

import { PlaygroundChat } from './components/chat/playground-chat'
import { PlaygroundInput } from './components/input/playground-input'
import { PlaygroundImageMode } from './components/playground-image-mode'
import { PlaygroundVideoMode } from './components/playground-video-mode'
import {
  useChatHandler,
  usePlaygroundChannels,
  usePlaygroundConversation,
  usePlaygroundOptions,
  usePlaygroundState,
} from './hooks'
import { getChannelModelOptions, getModelType } from './lib'

export function Playground({ initialPrompt }: { initialPrompt?: string }) {
  const {
    config,
    parameterEnabled,
    messages,
    isLoadingMessages,
    models,
    groups,
    updateMessages,
    setModels,
    setGroups,
    updateConfig,
    clearMessages,
  } = usePlaygroundState()

  const { sendChat, stopGeneration, isGenerating } = useChatHandler({
    config,
    parameterEnabled,
    onMessageUpdate: updateMessages,
  })

  const {
    editingMessageKey,
    handleSendMessage,
    handleRegenerateMessage,
    handleEditMessage,
    handleEditOpenChange,
    applyEdit,
    handleDeleteMessage,
  } = usePlaygroundConversation({
    messages,
    updateMessages,
    sendChat,
  })

  const handleClearMessages = () => {
    handleEditOpenChange(false)
    clearMessages()
  }

  const { isLoadingModels } = usePlaygroundOptions({
    currentGroup: config.group,
    currentModel: config.model,
    setGroups,
    setModels,
    updateConfig,
  })

  // 渠道选择器仅超管可见；默认 Auto 时与普通用户完全一致。
  const { isRoot, channels } = usePlaygroundChannels(config.group)
  const channelModels = useMemo(
    () => getChannelModelOptions(models, channels, config.channelId),
    [models, channels, config.channelId]
  )

  // 先选渠道后选模型：锁定渠道后当前模型不在候选里时自动落到首个候选，
  // 避免超管为了测试一个渠道反复手动切换模型。
  useEffect(() => {
    if (channelModels.length === 0) return
    if (!channelModels.some((m) => m.value === config.model)) {
      updateConfig('model', channelModels[0].value)
    }
  }, [channelModels, config.model, updateConfig])

  // Detect model type to switch between chat, video and image UI
  const modelType = getModelType(config.model)

  // The template text follows the user into whichever mode is active, so
  // picking a template while an image/video model is selected still lands the
  // text in the composer the user actually sees.
  if (modelType === 'video') {
    return (
      <PlaygroundVideoMode
        group={config.group}
        groups={groups}
        initialText={initialPrompt}
        model={config.model}
        models={models}
        onGroupChange={(value) => updateConfig('group', value)}
        onModelChange={(value) => updateConfig('model', value)}
        channels={channels}
        showChannelSelector={isRoot}
        channelValue={config.channelId}
        onChannelChange={(value) => updateConfig('channelId', value)}
      />
    )
  }

  if (modelType === 'image') {
    return (
      <PlaygroundImageMode
        group={config.group}
        groups={groups}
        initialText={initialPrompt}
        model={config.model}
        models={models}
        onGroupChange={(value) => updateConfig('group', value)}
        onModelChange={(value) => updateConfig('model', value)}
        channels={channels}
        showChannelSelector={isRoot}
        channelValue={config.channelId}
        onChannelChange={(value) => updateConfig('channelId', value)}
      />
    )
  }

  return (
    <div className='relative flex size-full min-h-0 flex-col overflow-hidden'>
      {/* Full-width scroll container: scrolling works even over side whitespace */}
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        <PlaygroundChat
          messages={messages}
          isLoadingMessages={isLoadingMessages}
          onRegenerateMessage={handleRegenerateMessage}
          onEditMessage={handleEditMessage}
          onDeleteMessage={handleDeleteMessage}
          onSelectPrompt={handleSendMessage}
          isGenerating={isGenerating}
          editingKey={editingMessageKey}
          onCancelEdit={handleEditOpenChange}
          onSaveEdit={(newContent) => applyEdit(newContent, false)}
          onSaveEditAndSubmit={(newContent) => applyEdit(newContent, true)}
        />
      </div>

      {/* Input area: center content and constrain to the same container width */}
      <div className='mx-auto w-full max-w-4xl'>
        <PlaygroundInput
          disabled={isGenerating}
          groups={groups}
          groupValue={config.group}
          initialText={initialPrompt}
          isGenerating={isGenerating}
          isModelLoading={isLoadingModels}
          modelValue={config.model}
          models={channelModels}
          onGroupChange={(value) => updateConfig('group', value)}
          onClearMessages={handleClearMessages}
          onModelChange={(value) => updateConfig('model', value)}
          onStop={stopGeneration}
          onSubmit={handleSendMessage}
          hasMessages={messages.length > 0}
          showChannelSelector={isRoot}
          channels={channels}
          channelValue={config.channelId}
          onChannelChange={(value) => updateConfig('channelId', value)}
        />
      </div>
    </div>
  )
}
