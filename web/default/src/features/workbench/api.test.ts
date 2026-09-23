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
import { afterEach, before, test } from 'node:test'

import { AxiosError } from 'axios'
import i18next from 'i18next'

import { api } from '@/lib/api'

import { generateImageBatch, type TryOnGenerationBody } from './api'

const originalAdapter = api.defaults.adapter
before(async () => {
  await i18next.init({ lng: 'en', fallbackLng: 'en', resources: {} })
})
afterEach(() => {
  api.defaults.adapter = originalAdapter
})

function request(n: number, prompt = 'one design board'): TryOnGenerationBody {
  return {
    model: 'test-image',
    prompt,
    size: '2048x2048',
    n,
    watermark: false,
    image: ['source-a', 'source-b'],
  }
}

for (const count of [1, 2, 3, 4, 10]) {
  test(`选择 ${count} 张时逐张发送 n=1，在下一次请求前交付上一张`, async () => {
    const calls: TryOnGenerationBody[] = []
    const delivered: string[] = []
    const plan = request(count)
    api.defaults.adapter = async (config) => {
      assert.equal(delivered.length, calls.length)
      calls.push(JSON.parse(config.data as string) as TryOnGenerationBody)
      return {
        config,
        status: 200,
        statusText: 'OK',
        headers: {},
        data: { data: [{ url: 'same-url' }] },
      }
    }
    await generateImageBatch([plan], (url, source) => {
      assert.equal(source, plan)
      delivered.push(url)
    })
    assert.equal(calls.length, count)
    assert.deepEqual(
      calls,
      Array.from({ length: count }, () => ({ ...plan, n: 1 }))
    )
    assert.deepEqual(
      delivered,
      Array.from({ length: count }, () => 'same-url')
    )
    assert.equal(plan.n, count)
  })
}

test('多个计划保留提示词、参考图与顺序，空 URL 回退到 base64', async () => {
  const plans = [
    request(2, 'front'),
    { ...request(1, 'side'), image: 'side-source' },
  ]
  const calls: TryOnGenerationBody[] = []
  const delivered: string[] = []
  api.defaults.adapter = async (config) => {
    calls.push(JSON.parse(config.data as string) as TryOnGenerationBody)
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { data: [{ url: '', b64_json: 'aW1hZ2U=' }] },
    }
  }
  await generateImageBatch(plans, (url) => {
    delivered.push(url)
  })
  assert.deepEqual(calls, [
    { ...plans[0], n: 1 },
    { ...plans[0], n: 1 },
    plans[1],
  ])
  assert.deepEqual(delivered, Array(3).fill('data:image/png;base64,aW1hZ2U='))
})

for (const failure of [
  { data: { data: [] }, message: 'The model returned no images' },
  {
    data: { data: [{ url: 'extra-a' }, { url: 'extra-b' }] },
    message: 'The model must return exactly one image per request',
  },
  {
    data: { error: { message: 'provider rejected this image' } },
    message: 'provider rejected this image',
  },
  {
    data: { error: { message: 'quota exhausted' } },
    message: 'quota exhausted',
    http: true,
  },
  {
    data: { message: 'channel unavailable' },
    message: 'channel unavailable',
    http: true,
  },
]) {
  test(`第二张失败保留第一张，停止剩余计划且不重试：${failure.message}`, async () => {
    let calls = 0
    const delivered: string[] = []
    api.defaults.adapter = async (config) => {
      calls++
      const response = {
        config,
        status: 200,
        statusText: 'OK',
        headers: {},
        data: calls === 1 ? { data: [{ url: 'first' }] } : failure.data,
      }
      if (calls === 2 && failure.http) {
        throw new AxiosError(
          'Request failed with status code 400',
          'ERR_BAD_REQUEST',
          config,
          undefined,
          { ...response, status: 400 }
        )
      }
      return response
    }
    await assert.rejects(
      generateImageBatch([request(3), request(2, 'next plan')], (url) => {
        delivered.push(url)
      }),
      { message: failure.message }
    )
    assert.equal(calls, 2)
    assert.deepEqual(delivered, ['first'])
  })
}

for (const count of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 11]) {
  test(`在首个计费请求前拒绝后续计划的无效张数 ${count}`, async () => {
    let calls = 0
    api.defaults.adapter = async () => {
      calls++
      throw new Error('Unexpected request')
    }
    await assert.rejects(
      generateImageBatch([request(1), request(count)], () => {})
    )
    assert.equal(calls, 0)
  })
}

test('套图模式将首张成片固定为后续请求的视觉锚点，不改动首张请求', async () => {
  const calls: TryOnGenerationBody[] = []
  let seq = 0
  api.defaults.adapter = async (config) => {
    calls.push(JSON.parse(config.data as string) as TryOnGenerationBody)
    seq++
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { data: [{ url: `shot-${seq}` }] },
    }
  }
  const plans = [
    request(2, 'front view'),
    { ...request(1, 'side'), image: 'side-source' },
  ]
  await generateImageBatch(plans, () => {}, undefined, 'model')
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[0].image, ['source-a', 'source-b'])
  assert.doesNotMatch(calls[0].prompt, /continuity reference/)
  assert.deepEqual(calls[1].image, ['source-a', 'source-b', 'shot-1'])
  assert.match(calls[1].prompt, /Image 3 is the first finished photograph/)
  assert.match(calls[1].prompt, /Continue the exact same photo shoot/)
  assert.deepEqual(calls[2].image, ['side-source', 'shot-1'])
  assert.match(calls[2].prompt, /Continue the exact same photo shoot/)
  assert.equal(calls[1].prompt.startsWith('front view\n'), true)
  assert.equal(calls[2].prompt.startsWith('side\n'), true)
})

test('商品套图锚点提示词保留白底与用途优先级，非套图模式不注入锚点', async () => {
  const calls: TryOnGenerationBody[] = []
  let seq = 0
  api.defaults.adapter = async (config) => {
    calls.push(JSON.parse(config.data as string) as TryOnGenerationBody)
    seq++
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { data: [{ url: `shot-${seq}` }] },
    }
  }
  await generateImageBatch([request(2)], () => {}, undefined, 'product')
  assert.match(
    calls[1].prompt,
    /white-background images must stay uniform #FFFFFF/
  )
  assert.match(calls[1].prompt, /Continue the same product photo shoot/)
  calls.length = 0
  seq = 0
  await generateImageBatch([request(2)], () => {})
  assert.deepEqual(calls, [
    { ...request(2), n: 1 },
    { ...request(2), n: 1 },
  ])
  assert.doesNotMatch(calls[1].prompt, /continuity reference/)
})
