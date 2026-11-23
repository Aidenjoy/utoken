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
import { afterEach, test } from 'node:test'

import { generateImages } from './api'
import type { ImageGenerationRequest } from './types'

const payload: ImageGenerationRequest = {
  model: 'doubao-seedream-5-0-pro',
  prompt: 'a cat',
  stream: true,
}

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

// The gateway keepalives the connection with ":" comment pings while the
// upstream renders; they must never surface as data, and completed events
// aggregate into the plain response shape the image handler already reads.
test('SSE keepalive pings are ignored and completed events aggregate', async () => {
  globalThis.fetch = async () =>
    sseResponse([
      ': PING\n\n',
      'event: image_generation.completed\ndata: {"type":"image_generation.completed","created_at":1710000000,"url":"https://example.com/a.png"}\n\n',
      ': PING\n\n',
      'event: image_generation.completed\ndata: {"type":"image_generation.completed","b64_json":"AAAA"}\n\n',
      'data: [DONE]\n\n',
    ])
  const res = await generateImages(payload)
  assert.equal(res.created, 1710000000)
  assert.equal(res.data.length, 2)
  assert.equal(res.data[0].url, 'https://example.com/a.png')
  assert.equal(res.data[1].b64_json, 'AAAA')
})

// A data line can split across network chunks; the parser must buffer until
// the newline instead of dropping the partial JSON.
test('SSE data lines split across chunks are reassembled', async () => {
  globalThis.fetch = async () =>
    sseResponse([
      'event: image_generation.completed\ndata: {"type":"image_generation.comp',
      'leted","url":"https://example.com/b.png"}\n\ndata: [DONE]\n\n',
    ])
  const res = await generateImages(payload)
  assert.equal(res.data.length, 1)
  assert.equal(res.data[0].url, 'https://example.com/b.png')
})

// Post-commit upstream failures arrive as SSE error events (the 200 header is
// already on the wire); the message must reach the caller, not be swallowed.
test('SSE error events reject with the upstream message', async () => {
  globalThis.fetch = async () =>
    sseResponse([
      ': PING\n\n',
      'event: error\ndata: {"type":"error","error":{"message":"content moderation failed"}}\n\n',
      'data: [DONE]\n\n',
    ])
  await assert.rejects(generateImages(payload), /content moderation failed/)
})

// A backend that ignores `stream` (or middleware that fails before the relay)
// answers JSON; both success and failure keep the axios-style error shape.
test('JSON fallback returns the body on success', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        created: 1,
        data: [{ url: 'https://example.com/c.png' }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  const res = await generateImages(payload)
  assert.equal(res.data[0].url, 'https://example.com/c.png')
})

test('JSON fallback failures keep response.status and error.message', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'invalid size' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  await assert.rejects(generateImages(payload), (err: unknown) => {
    const e = err as Error & { response?: { status?: number } }
    assert.equal(e.message, 'invalid size')
    assert.equal(e.response?.status, 400)
    return true
  })
})
