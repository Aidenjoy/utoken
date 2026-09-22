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

import { createDefaultDetailPageConfig } from '../constants'
import { buildDetailPageRequest } from './prompt-detail'

test('三页详情分别生成封面、内容、品牌收尾，并保留商品和文案约束', () => {
  const config = createDefaultDetailPageConfig()
  config.pageCount = 3
  config.products = [{ id: 'p', name: 'product', src: 'product.png' }]
  config.name = 'Cup'
  config.selling = 'Double wall'
  config.textLanguage = 'en'
  config.sceneMode = 'unified'
  const requests = Array.from({ length: 3 }, (_, index) =>
    buildDetailPageRequest(config, index)
  )
  for (const [index, request] of requests.entries()) {
    assert.deepEqual(request.images, ['product.png'])
    assert.match(
      request.prompt,
      new RegExp(`Generate only page ${index + 1} of 3`)
    )
    for (const text of [
      'Return exactly one standalone page image',
      'Product name: Cup',
      'Double wall',
      'Overlay text language: English',
      'Use one unified scene',
      '3:4 aspect ratio',
    ]) {
      assert.ok(request.prompt.includes(text), text)
    }
  }
  assert.match(requests[0].prompt, /Current page duty: Cover/)
  assert.match(
    requests[1].prompt,
    /Current page duty: Content page focused on:/
  )
  assert.match(requests[1].prompt, /Use scenes, Local close-up/)
  assert.match(requests[2].prompt, /Current page duty: Brand closing/)
})

test('单页合并内容，不同时要求另一个收尾页', () => {
  const request = buildDetailPageRequest(createDefaultDetailPageConfig(), 0)
  assert.match(request.prompt, /Generate only page 1 of 1/)
  assert.match(request.prompt, /Summarize the selected content modules/)
  assert.doesNotMatch(
    request.prompt,
    /Current page duty: Brand closing|the last page is/
  )
})

test('十页保持独立页码，模块循环分配，不生成重复封面', () => {
  const config = {
    ...createDefaultDetailPageConfig(),
    pageCount: 10,
    elements: ['scene', 'closeup'],
  }
  const requests = Array.from({ length: 10 }, (_, index) =>
    buildDetailPageRequest(config, index)
  )
  for (const [index, request] of requests.entries()) {
    assert.ok(request.prompt.includes(`Generate only page ${index + 1} of 10`))
    if (index > 0) {
      assert.match(
        request.prompt,
        /Current page duty: Content page focused on: (Use scenes|Local close-up)/
      )
      assert.doesNotMatch(
        request.prompt,
        /Current page duty: Cover|Current page duty: Brand closing/
      )
    }
  }
})

test('空内容模块仍有明确的商品亮点职责', () => {
  const config = {
    ...createDefaultDetailPageConfig(),
    pageCount: 3,
    elements: [],
  }
  assert.match(
    buildDetailPageRequest(config, 1).prompt,
    /Content page focused on: product highlights/
  )
})

test('非法总页数和页码在发出请求前被拒绝', () => {
  const config = createDefaultDetailPageConfig()
  for (const pageCount of [0, 11, 1.5, Number.POSITIVE_INFINITY]) {
    assert.throws(() => buildDetailPageRequest({ ...config, pageCount }, 0))
  }
  for (const index of [-1, 1, 0.5, Number.NaN]) {
    assert.throws(() => buildDetailPageRequest(config, index))
  }
})
