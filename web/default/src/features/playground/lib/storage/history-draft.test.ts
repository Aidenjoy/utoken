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
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  restoreHistoryDraft,
  validateHistoryMessages,
  type HistoryDraft,
} from './history-draft'

const draft: HistoryDraft = {
  id: 'conversation-a',
  revision: 3,
  title: 'test',
  baseline: {},
  before: 0,
  more: false,
  messages: [
    {
      key: 'message-a',
      from: 'assistant',
      versions: [{ id: 'v1', content: 'partial' }],
      status: 'streaming',
    },
  ],
}

test('different accounts and unowned legacy envelopes cannot restore a draft', () => {
  assert.equal(
    restoreHistoryDraft(JSON.stringify({ userID: 1, draft }), 2),
    null
  )
  assert.equal(
    restoreHistoryDraft(JSON.stringify({ messages: draft.messages }), 1),
    null
  )
  assert.equal(restoreHistoryDraft('invalid JSON', 1), null)
  assert.equal(
    restoreHistoryDraft(
      JSON.stringify({ userID: 1, draft: { messages: [] } }),
      1
    ),
    null
  )
})

test('interrupted responses remain incomplete and raw extension fields survive restoration', () => {
  const payload = {
    ...draft,
    messages: [
      {
        ...draft.messages[0],
        tool_calls: [{ name: 'mock', arguments: { n: 1 } }],
        sources: [
          { href: 'https://example.invalid/image', title: 'attachment' },
        ],
      },
    ],
  }
  const restored = restoreHistoryDraft(
    JSON.stringify({ userID: 1, draft: payload }),
    1
  )
  assert.ok(restored)
  assert.equal(restored.messages[0].status, 'error')
  assert.equal(restored.messages[0].isContentComplete, false)
  assert.deepEqual(
    (restored.messages[0] as (typeof payload.messages)[0]).tool_calls,
    payload.messages[0].tool_calls
  )
  assert.deepEqual(restored.messages[0].versions, draft.messages[0].versions)
})

test('malformed server history is rejected before replacing displayed messages', () => {
  assert.throws(() => validateHistoryMessages([{ key: 'bad' }] as never))
  assert.doesNotThrow(() => validateHistoryMessages(draft.messages))
})
