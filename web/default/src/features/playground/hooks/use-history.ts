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
import { useMutation, useQuery } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import {
  applyMessageStateUpdate,
  type MessageStateUpdater,
} from '../lib/state/playground-state-utils'
import {
  restoreHistoryDraft,
  validateHistoryMessages,
  type HistoryDraft as Draft,
} from '../lib/storage/history-draft'
import type { Message } from '../types'

type Conversation = { id: string; title: string; revision: number }
type HistoryList = {
  items: Conversation[]
  has_more: boolean
  unavailable?: boolean
}
type Row = { id: string; sequence: number; payload: Message }
type Page = { revision: number; items: Row[]; has_more: boolean }
type Patch = {
  revision: number
  mutation_id: string
  title: string
  messages: { id: string; payload: Message }[]
  deleted_ids: string[]
}
const options = { skipErrorHandler: true, skipBusinessError: true }

/** A fresh UUID is created locally; no model request or empty server row is created. */
function emptyDraft(): Draft {
  return {
    id: crypto.randomUUID(),
    revision: 0,
    title: '',
    messages: [],
    baseline: {},
    before: 0,
    more: false,
  }
}

/** Account-keyed drafts preserve failed saves without importing unowned legacy history. */
export function useHistory(userID: number) {
  const cacheKey = `conversation-draft-v1:${userID}`
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = localStorage.getItem(cacheKey)
      if (saved) {
        const restored = restoreHistoryDraft(saved, userID)
        if (restored) return restored
      }
    } catch {
      /* A damaged cache never blocks login or erases the original value. */
    }
    return emptyDraft()
  })
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState(0)
  const latest = useRef(draft)
  const alive = useRef(true)
  const pending = useRef<Patch | null>(null)
  const readEpoch = useRef(0)
  const initialized = useRef(false)
  const lastList = useRef<HistoryList>({ items: [], has_more: false })
  const list = useQuery({
    queryKey: ['conversations', userID, offset],
    queryFn: async (): Promise<HistoryList> => {
      try {
        const result = await api.get<{ data: HistoryList }>(
          '/api/conversations',
          {
            ...options,
            disableDuplicate: true,
            params: { offset, limit: 30 },
          }
        )
        const data = result.data.data
        if (!Array.isArray(data.items)) throw new Error('Invalid history list')
        lastList.current = data
        return data
      } catch (failure) {
        // Keep the existing global 401/session-expiry handling. History-only
        // outages must not invoke the application's global 500-page redirect.
        if (isAxiosError(failure) && failure.response?.status === 401) {
          throw failure
        }
        return { ...lastList.current, unavailable: true }
      }
    },
    enabled: userID > 0,
    retry: false,
  })
  const { mutateAsync: saveHistory } = useMutation({
    mutationFn: async (input: { id: string; patch: Patch }) => {
      const result = await api.patch<{ data: Conversation }>(
        `/api/conversations/${input.id}`,
        input.patch,
        options
      )
      return result.data.data
    },
    retry: false,
    // Autosave renders localized recovery controls instead of global error toasts.
    onError: () => undefined,
  })
  const refetchList = list.refetch
  useEffect(() => {
    if (list.data && !list.data.unavailable) lastList.current = list.data
  }, [list.data])
  const dirty =
    draft.messages.some((m) => draft.baseline[m.key] !== JSON.stringify(m)) ||
    Object.keys(draft.baseline).some(
      (id) => !draft.messages.some((m) => m.key === id)
    )

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /** Loading is atomic: on network/revision failure the currently displayed history survives. */
  const open = useCallback(
    async (id: string, older = false) => {
      if (useAuthStore.getState().auth.user?.id !== userID) return
      const epoch = ++readEpoch.current
      setLoading(true)
      try {
        const current = latest.current
        const result = await api.get<{ data: Page }>(
          `/api/conversations/${id}/messages`,
          {
            ...options,
            disableDuplicate: true,
            params: {
              limit: 50,
              before: older ? current.before : 0,
              revision: older ? current.revision : -1,
            },
          }
        )
        if (!alive.current || epoch !== readEpoch.current) return
        const page = result.data.data
        const messages = page.items.map((row) => row.payload)
        validateHistoryMessages(messages)
        const baseline = Object.fromEntries(
          messages.map((m) => [m.key, JSON.stringify(m)])
        )
        const next: Draft = {
          id,
          revision: page.revision,
          title:
            list.data?.items.find((item) => item.id === id)?.title ??
            current.title,
          messages: older ? [...messages, ...current.messages] : messages,
          baseline: older ? { ...baseline, ...current.baseline } : baseline,
          before: page.items[0]?.sequence ?? 0,
          more: page.has_more,
        }
        latest.current = next
        setDraft(next)
        setError(false)
        pending.current = null
      } catch (failure) {
        if (isAxiosError(failure) && failure.response?.status === 401) {
          void refetchList()
        }
        if (alive.current && epoch === readEpoch.current) setError(true)
      } finally {
        if (alive.current && epoch === readEpoch.current) setLoading(false)
      }
    },
    [list.data, userID, refetchList]
  )

  useEffect(() => {
    if (initialized.current || !list.data || list.data.unavailable) return
    initialized.current = true
    if (dirty) return
    const id = draft.revision > 0 ? draft.id : list.data.items[0]?.id
    if (id) void open(id)
  }, [list.data, open, dirty, draft.id, draft.revision])

  /** Persist only changed, finished messages; preserve pending/error semantics verbatim. */
  useEffect(() => {
    latest.current = draft
    if (!dirty) return
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ userID, draft }))
    } catch {
      // The in-memory draft remains usable; a cache quota error must not block server saving.
    }
    if (
      error ||
      saving ||
      draft.messages.some(
        (m) => m.status === 'loading' || m.status === 'streaming'
      )
    ) {
      return
    }
    const timer = window.setTimeout(async () => {
      if (!alive.current || useAuthStore.getState().auth.user?.id !== userID) {
        return
      }
      const changed: Message[] = []
      let patchBytes = 0
      const encoder = new TextEncoder()
      // Keep each retry below the HTTP body bound without truncating messages.
      for (const message of draft.messages) {
        const serialized = JSON.stringify(message)
        if (draft.baseline[message.key] === serialized) continue
        const bytes = encoder.encode(serialized).length
        if (changed.length > 0 && patchBytes + bytes > 1500000) break
        changed.push(message)
        patchBytes += bytes
        if (changed.length === 100) break
      }
      const deleted = Object.keys(draft.baseline)
        .filter((id) => !draft.messages.some((m) => m.key === id))
        .slice(0, 100)
      const patch = pending.current ?? {
        revision: draft.revision,
        mutation_id: crypto.randomUUID(),
        title:
          draft.title ||
          draft.messages
            .find((m) => m.from === 'user')
            ?.versions[0]?.content.slice(0, 80) ||
          '',
        messages: changed.map((m) => ({ id: m.key, payload: m })),
        deleted_ids: deleted,
      }
      pending.current = patch
      setSaving(true)
      try {
        const result = await saveHistory({ id: draft.id, patch })
        if (!alive.current) return
        const baseline = {
          ...latest.current.baseline,
          ...Object.fromEntries(
            patch.messages.map((row) => [row.id, JSON.stringify(row.payload)])
          ),
        }
        for (const id of patch.deleted_ids) delete baseline[id]
        const next = {
          ...latest.current,
          revision: result.revision,
          title: result.title,
          baseline,
        }
        latest.current = next
        setDraft(next)
        pending.current = null
        // Keep the last acknowledged snapshot until the next edit so a local
        // storage failure cannot accidentally cause a duplicate model request.
        localStorage.setItem(cacheKey, JSON.stringify({ userID, draft: next }))
        void refetchList()
      } catch (failure) {
        if (isAxiosError(failure) && failure.response?.status === 401) {
          void refetchList()
        }
        if (alive.current) setError(true)
      } finally {
        if (alive.current) setSaving(false)
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [
    draft,
    dirty,
    cacheKey,
    userID,
    retry,
    error,
    saving,
    refetchList,
    saveHistory,
  ])

  /** The existing relay handlers remain the sole writers of message contents. */
  const updateMessages = useCallback(
    (updater: MessageStateUpdater) => {
      if (useAuthStore.getState().auth.user?.id !== userID) return
      setDraft((current) => ({
        ...current,
        messages: applyMessageStateUpdate(current.messages, updater),
      }))
    },
    [userID]
  )

  /** Starting a new history never removes old local records or server conversations. */
  const clearMessages = useCallback(() => {
    if (dirty || saving) return
    const next = emptyDraft()
    latest.current = next
    setDraft(next)
    pending.current = null
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ userID, draft: next }))
    } catch {
      /* The server remains authoritative when local storage is full. */
    }
  }, [dirty, saving, cacheKey, userID])

  return {
    messages: draft.messages,
    updateMessages,
    clearMessages,
    isLoadingMessages: loading || list.isPending,
    conversations: list.data?.items ?? [],
    moreConversations: list.data?.has_more ?? false,
    offset,
    setOffset,
    open,
    id: draft.id,
    moreMessages: draft.more,
    dirty,
    saving,
    error: error || list.isError || Boolean(list.data?.unavailable),
    retrySave: () => {
      setError(false)
      setRetry((value) => value + 1)
      void refetchList()
    },
    reload: () => (draft.revision > 0 ? open(draft.id) : refetchList()),
    // Conflict recovery creates an explicit copy, preserving both devices' work.
    saveCopy: () => {
      const next = {
        ...latest.current,
        id: crypto.randomUUID(),
        revision: 0,
        baseline: {},
        more: false,
        before: 0,
      }
      latest.current = next
      setDraft(next)
      pending.current = null
      setError(false)
    },
  }
}
