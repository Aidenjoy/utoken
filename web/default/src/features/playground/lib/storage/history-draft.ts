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
import { z } from 'zod'

import type { Message } from '../../types'
import { messagesSchema } from './storage-schema'

/** A history draft is scoped to the verified account; legacy global keys are never read. */
export type HistoryDraft = {
  id: string
  revision: number
  title: string
  messages: Message[]
  baseline: Record<string, string>
  before: number
  more: boolean
}

const draftSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  revision: z.number().int().nonnegative(),
  title: z.string(),
  messages: messagesSchema,
  baseline: z.record(z.string(), z.string()),
  before: z.number().int().nonnegative(),
  more: z.boolean(),
})

/** Validate the envelope before use and retain original structured fields.
 * Interrupted responses become errors, never completed answers or new model calls.
 */
export function restoreHistoryDraft(
  raw: string,
  userID: number
): HistoryDraft | null {
  try {
    const envelope = JSON.parse(raw) as {
      userID?: number
      draft?: HistoryDraft
    }
    if (
      !envelope.draft ||
      envelope.userID !== userID ||
      !draftSchema.safeParse(envelope.draft).success
    ) {
      return null
    }
    const draft = envelope.draft
    return {
      ...draft,
      messages: draft.messages.map((message) =>
        message.status === 'loading' || message.status === 'streaming'
          ? {
              ...message,
              status: 'error',
              isContentComplete: false,
              isReasoningStreaming: false,
            }
          : message
      ),
    }
  } catch {
    return null
  }
}

/** Loading validates the known rendering contract without stripping extension fields. */
export function validateHistoryMessages(messages: Message[]): void {
  if (!messagesSchema.safeParse(messages).success) {
    throw new Error('Invalid history messages')
  }
}
