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

import { useAuthStore } from '@/stores/auth-store'

import { HistoryBar } from './components/chat/history-bar'
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
import { useHistory } from './hooks/use-history'
import { getChannelModelOptions, getModelType } from './lib'

type PlaygroundProps = { initialPrompt?: string; syncHistory?: boolean }
type PlaygroundState = ReturnType<typeof usePlaygroundState>

/** Preserve the original local playground unless server history is explicitly selected. */
export function Playground(props: PlaygroundProps) {
  const userID = useAuthStore((state) => state.auth.user?.id)
  if (!userID) return null
  if (props.syncHistory) {
    return (
      <SyncedPlayground
        key={userID}
        userID={userID}
        initialPrompt={props.initialPrompt}
      />
    )
  }
  return <LocalPlayground key={userID} initialPrompt={props.initialPrompt} />
}

/** Keep the original browser history and chat behavior on the existing entry point. */
function LocalPlayground(props: { initialPrompt?: string }) {
  const state = usePlaygroundState()
  return <PlaygroundContent state={state} initialPrompt={props.initialPrompt} />
}

/** The separate server mode keeps authenticated history out of the legacy cache. */
function SyncedPlayground(props: { initialPrompt?: string; userID: number }) {
  const history = useHistory(props.userID)
  const state = usePlaygroundState({ localHistory: false })
  return (
    <PlaygroundContent
      initialPrompt={props.initialPrompt}
      history={history}
      state={{
        ...state,
        messages: history.messages,
        updateMessages: history.updateMessages,
        clearMessages: history.clearMessages,
        isLoadingMessages: history.isLoadingMessages,
      }}
    />
  )
}

/** Shared rendering and the existing relay handlers preserve model request semantics. */
function PlaygroundContent(props: {
  initialPrompt?: string
  state: PlaygroundState
  history?: ReturnType<typeof useHistory>
}) {
  const initialPrompt = props.initialPrompt
  const history = props.history
  const {
    messages,
    updateMessages,
    clearMessages,
    isLoadingMessages,
    config,
    parameterEnabled,
    models,
    groups,
    setModels,
    setGroups,
    updateConfig,
  } = props.state

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
      {history && (
        <HistoryBar
          history={history}
          disabled={isGenerating || isLoadingMessages}
        />
      )}
      {/* Full-width scroll container: scrolling works even over side whitespace */}
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        <PlaygroundChat
          messages={messages}
          isLoadingMessages={isLoadingMessages}
          onRegenerateMessage={
            history?.moreMessages ? undefined : handleRegenerateMessage
          }
          onEditMessage={history?.moreMessages ? undefined : handleEditMessage}
          onDeleteMessage={handleDeleteMessage}
          onSelectPrompt={
            isLoadingMessages || history?.moreMessages
              ? undefined
              : handleSendMessage
          }
          isGenerating={isGenerating || isLoadingMessages}
          editingKey={editingMessageKey}
          onCancelEdit={handleEditOpenChange}
          onSaveEdit={(newContent) => applyEdit(newContent, false)}
          onSaveEditAndSubmit={(newContent) => applyEdit(newContent, true)}
        />
      </div>

      {/* Input area: center content and constrain to the same container width */}
      <div className='mx-auto w-full max-w-4xl'>
        <PlaygroundInput
          disabled={isGenerating || isLoadingMessages || history?.moreMessages}
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
