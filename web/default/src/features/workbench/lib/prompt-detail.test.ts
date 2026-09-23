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
  createDefaultDetailElements,
  createDefaultDetailPageConfig,
  DETAIL_CONTENT_ELEMENTS,
  DETAIL_PAGE_COUNTS,
} from '../constants'
import type { DetailPageConfig, DetailPageElementValue } from '../types'
import { buildDetailPageRequest } from './prompt-detail'

/** 依照已启用模块名称重建常驻列表，方便用例以旧风格指定 elements。 */
function withElements(
  values: DetailPageElementValue[]
): ReturnType<typeof createDefaultDetailElements> {
  return createDefaultDetailElements().map((element) => ({
    ...element,
    enabled: values.includes(element.value),
  }))
}

function patchConfig(
  patch: Omit<Partial<DetailPageConfig>, 'elements'> & {
    elements?: DetailPageElementValue[]
  }
): DetailPageConfig {
  const base = createDefaultDetailPageConfig()
  const { elements, ...rest } = patch
  return {
    ...base,
    ...rest,
    elements: elements ? withElements(elements) : base.elements,
  }
}

test('三页详情分别生成封面、内容、品牌收尾，并保留商品和文案约束', () => {
  const config = createDefaultDetailPageConfig()
  config.pageCount = 3
  config.products = [{ id: 'p', name: 'product', src: 'product.png' }]
  config.extra = 'Product name: Cup\nDouble wall; write captions in English.'
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
      'follow an explicit language requirement in the notes',
      'additional requirements override default styling and wording',
      '3:4 aspect ratio',
    ]) {
      assert.ok(request.prompt.includes(text), text)
    }
  }
  assert.match(requests[0].prompt, /Current page duty: Cover/)
  assert.match(requests[1].prompt, /Current page duty: Content page\./)
  assert.match(
    requests[1].prompt,
    /Assigned modules on this page: Selling point copy, Use scenes, Local close-up\./
  )
  assert.match(
    requests[1].prompt,
    /Unified scene: use the same product-appropriate real environment/
  )
  assert.doesNotMatch(requests[1].prompt, /No lifestyle scenery/)
  assert.match(requests[2].prompt, /Current page duty: Brand closing/)
  assert.match(
    requests[2].prompt,
    /Assigned modules on this page: Brand ending\./
  )
  assert.doesNotMatch(requests[2].prompt, /Use a sharp close-up|Unified scene:/)
})

test('单页合并内容，不同时要求另一个收尾页', () => {
  const request = buildDetailPageRequest(createDefaultDetailPageConfig(), 0)
  assert.match(request.prompt, /Generate only page 1 of 1/)
  assert.match(
    request.prompt,
    /Assigned modules on this page: Selling point copy, Use scenes, Local close-up, Brand ending\./
  )
  assert.match(
    request.prompt,
    /closing compact when integrated into a single-page design/
  )
  assert.match(request.prompt, /supporting sections or detail insets/)
  assert.doesNotMatch(
    request.prompt,
    /Current page duty: Brand closing|the last page is/
  )
})

test('十页保持独立页码，模块循环分配，不生成重复封面', () => {
  const config = patchConfig({ pageCount: 10, elements: ['scene', 'closeup'] })
  const requests = Array.from({ length: 10 }, (_, index) =>
    buildDetailPageRequest(config, index)
  )
  for (const [index, request] of requests.entries()) {
    assert.ok(request.prompt.includes(`Generate only page ${index + 1} of 10`))
    if (index > 0) {
      assert.match(
        request.prompt,
        /Assigned modules on this page: (Use scenes|Local close-up)\./
      )
      assert.match(
        request.prompt,
        /choose a different supported detail, angle or usage moment/
      )
      const expected = index % 2 === 1 ? 'Use scenes' : 'Local close-up'
      assert.ok(
        request.prompt.includes(`Assigned modules on this page: ${expected}.`)
      )
      assert.doesNotMatch(
        request.prompt,
        /Current page duty: Cover|Current page duty: Brand closing/
      )
    }
  }
})

test('空内容模块仍有明确的商品亮点职责', () => {
  const config = patchConfig({ pageCount: 3, elements: [] })
  assert.match(
    buildDetailPageRequest(config, 1).prompt,
    /Assigned modules on this page: product highlights\./
  )
})

for (const pageCount of DETAIL_PAGE_COUNTS) {
  test(`${pageCount} 页规划覆盖全部已选模块且每次只生成当前页`, () => {
    const config = patchConfig({
      pageCount,
      elements: DETAIL_CONTENT_ELEMENTS.map(
        (element) => element.value as DetailPageElementValue
      ),
    })
    const assigned: string[] = []
    for (let index = 0; index < pageCount; index++) {
      const { prompt } = buildDetailPageRequest(config, index)
      const line = prompt
        .split('\n')
        .find((value) => value.startsWith('Assigned modules on this page: '))
      assert.ok(line)
      assigned.push(line)
      assert.ok(
        prompt.includes(`Generate only page ${index + 1} of ${pageCount}.`)
      )
      assert.ok(prompt.includes(`Final check: return only page ${index + 1};`))
      assert.match(prompt, /Return exactly one standalone page image/)
      assert.equal(/Current page duty: Cover/.test(prompt), index === 0)
      assert.equal(
        /Current page duty: Brand closing/.test(prompt),
        pageCount > 1 && index === pageCount - 1
      )
    }
    for (const element of DETAIL_CONTENT_ELEMENTS) {
      assert.ok(
        assigned.some((line) => line.includes(element.label)),
        `${element.label} 必须至少分配一次`
      )
    }
  })
}

test('两个页面保留全部正文内容，品牌收尾独占最后一页', () => {
  const config = { ...createDefaultDetailPageConfig(), pageCount: 2 }
  const cover = buildDetailPageRequest(config, 0).prompt
  const closing = buildDetailPageRequest(config, 1).prompt
  assert.match(
    cover,
    /Assigned modules on this page: Selling point copy, Use scenes, Local close-up\./
  )
  assert.match(closing, /Assigned modules on this page: Brand ending\./)
  assert.doesNotMatch(
    closing,
    /Show the product in a recognizable|Use a sharp close-up/
  )
})

test('取消文案在封面和品牌收尾同样生效，不因补充标语或旧字段而重新开启', () => {
  const config = patchConfig({
    pageCount: 2,
    elements: ['brand-ending'],
    extra: 'Add a headline and price ¥99.',
  })
  for (const index of [0, 1]) {
    const { prompt } = buildDetailPageRequest(config, index)
    assert.match(prompt, /Selling-point copy is disabled/)
    assert.match(prompt, /including on the cover and brand closing/)
    assert.match(
      prompt,
      /Notes cannot enable unchecked modules or change the page plan/
    )
    assert.doesNotMatch(
      prompt,
      /Selling-point copy is enabled|Overlay text language/
    )
  }
})

test('未选使用场景时场景仓库不改变提示词，已选时两种策略互斥', () => {
  const base = patchConfig({ elements: ['closeup'] })
  const smart = buildDetailPageRequest(
    { ...base, sceneMode: 'smart' },
    0
  ).prompt
  const unified = buildDetailPageRequest(
    { ...base, sceneMode: 'unified' },
    0
  ).prompt
  assert.equal(smart, unified)
  assert.match(smart, /No lifestyle scenery or scene props/)
  assert.doesNotMatch(smart, /Smart scene assignment:|Unified scene:/)

  for (const sceneMode of ['smart', 'unified']) {
    const { prompt } = buildDetailPageRequest(
      patchConfig({ elements: ['scene'], sceneMode }),
      0
    )
    assert.match(prompt, /recognizable, realistic usage environment/)
    assert.equal(prompt.includes('Unified scene:'), sceneMode === 'unified')
    assert.equal(
      prompt.includes('Smart scene assignment:'),
      sceneMode === 'smart'
    )
    assert.doesNotMatch(
      prompt,
      /No lifestyle scenery or scene props|legible overlay text, studio lighting/
    )
  }
})

test('模特只出现在分配模特的页面，不与禁人物规则冲突', () => {
  const config = patchConfig({ pageCount: 3, elements: ['model', 'closeup'] })
  const model = buildDetailPageRequest(config, 1).prompt
  const closeup = buildDetailPageRequest(config, 2).prompt
  assert.match(
    model,
    /Show a model wearing, holding or using the actual product/
  )
  assert.doesNotMatch(model, /No added models, people, hands/)
  assert.match(closeup, /No added models, people, hands/)
  assert.doesNotMatch(closeup, /Show a model wearing/)
})

test('包装、规格、步骤有可执行职责和缺乏商品事实的退路', () => {
  const config = patchConfig({
    elements: ['package', 'size-spec', 'steps'],
    extra: '容量 350 mL；附带黑色布袋。先打开盖子，再装水。',
  })
  const { prompt } = buildDetailPageRequest(config, 0)
  for (const text of [
    'Show only packaging or included items visible',
    'If no packaging evidence is available',
    'Never infer measurements from pixels',
    'If no verified specifications are available',
    'Illustrate a short, physically plausible usage sequence',
    'show the observable ready-to-use state instead of guessing a procedure',
    'Minimal factual labels, units or step numbers are allowed',
    config.extra,
  ]) {
    assert.ok(prompt.includes(text), text)
  }
  assert.doesNotMatch(
    prompt,
    /Do not add a packaging display|Do not add measurement diagrams|Do not add a usage tutorial/
  )
})

test('补充要求保留多行原文及价格标点，并受当前页和已选内容约束', () => {
  const config = {
    ...createDefaultDetailPageConfig(),
    pageCount: 3,
    products: [
      { id: 'front', name: 'front', src: 'front.png' },
      { id: 'back', name: 'back', src: 'back.png' },
    ],
    extra:
      '  标语：轻装出发！价格：¥99.00\nUse English; page 2: highlight the seams.  ',
    ratio: 'smart',
  }
  for (const index of [0, 1, 2]) {
    const request = buildDetailPageRequest(config, index)
    assert.deepEqual(request.images, ['front.png', 'back.png'])
    assert.ok(
      request.prompt.includes(
        `Additional detail page requirements:\n${config.extra.trim()}\nFinal check:`
      )
    )
    assert.match(
      request.prompt,
      /Apply page-specific notes only to the matching page/
    )
    assert.match(
      request.prompt,
      /Preserve supplied slogans, values, currency symbols and punctuation exactly/
    )
    assert.match(
      request.prompt,
      /do not copy its background, promotional overlays, layout or watermarks/
    )
    assert.doesNotMatch(request.prompt, /smart aspect ratio/)
  }
  assert.doesNotMatch(
    buildDetailPageRequest({ ...config, extra: '   ' }, 0).prompt,
    /Additional detail page requirements:/
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

test('共享场景图只进入分配了场景模块的页面，未分配页面保持干净背景', () => {
  const config = createDefaultDetailPageConfig()
  config.pageCount = 3
  config.products = [{ id: 'p', name: 'product', src: 'product.png' }]
  config.sceneImage = { id: 's', name: 'scene', src: 'scene.png' }
  config.sceneMode = 'smart'
  const requests = Array.from({ length: 3 }, (_, index) =>
    buildDetailPageRequest(config, index)
  )
  assert.deepEqual(requests[1].images, ['product.png', 'scene.png'])
  assert.match(requests[1].prompt, /shared scene reference for the whole set/)
  assert.match(
    requests[1].prompt,
    /Uploaded shared scene: use the shared scene reference image/
  )
  assert.doesNotMatch(requests[1].prompt, /Smart scene assignment:/)
  for (const index of [0, 2]) {
    assert.deepEqual(requests[index].images, ['product.png'])
    assert.doesNotMatch(requests[index].prompt, /Uploaded shared scene:/)
  }
  assert.match(requests[2].prompt, /No lifestyle scenery or scene props/)
})

test('模块参考图仅注入分配页，未分配页面不携带也不提示', () => {
  const config = patchConfig({
    pageCount: 3,
    elements: ['scene', 'closeup'],
    products: [{ id: 'p', name: 'product', src: 'product.png' }],
  })
  config.elements = config.elements.map((element) => {
    if (element.value === 'scene') {
      return {
        ...element,
        references: [
          { id: 'scene-a', name: 'scene-a', src: 'scene-a.png' },
          { id: 'scene-b', name: 'scene-b', src: 'scene-b.png' },
        ],
        extra: 'Keep the same coffee shop counter and warm daylight.',
      }
    }
    if (element.value === 'closeup') {
      return {
        ...element,
        references: [{ id: 'close', name: 'close', src: 'close.png' }],
        extra: 'Focus on the double-wall glass rim.',
      }
    }
    return element
  })
  const requests = Array.from({ length: 3 }, (_, index) =>
    buildDetailPageRequest(config, index)
  )
  // Page 1 = cover (empty), page 2 = scene, page 3 = closeup.
  assert.deepEqual(requests[0].images, ['product.png'])
  assert.doesNotMatch(
    requests[0].prompt,
    /scene-a\.png|close\.png|Keep the same coffee shop|double-wall glass rim|Module reference images/
  )
  assert.deepEqual(requests[1].images, [
    'product.png',
    'scene-a.png',
    'scene-b.png',
  ])
  assert.match(
    requests[1].prompt,
    /image 2: Use scenes reference — borrow framing/
  )
  assert.match(
    requests[1].prompt,
    /image 3: Use scenes reference — borrow framing/
  )
  assert.match(
    requests[1].prompt,
    /Module reference images on this page — Use scenes: images 2-3\./
  )
  assert.match(
    requests[1].prompt,
    /Use scenes requirements:\nKeep the same coffee shop counter and warm daylight\./
  )
  assert.doesNotMatch(requests[1].prompt, /double-wall glass rim|close\.png/)
  assert.deepEqual(requests[2].images, ['product.png', 'close.png'])
  assert.match(
    requests[2].prompt,
    /image 2: Local close-up reference — borrow framing/
  )
  assert.match(
    requests[2].prompt,
    /Local close-up requirements:\nFocus on the double-wall glass rim\./
  )
  assert.doesNotMatch(
    requests[2].prompt,
    /coffee shop|scene-a\.png|Use scenes requirements:/
  )
})

test('模块参考图与共享场景图共存，共享图作为背景优先级更高', () => {
  const config = patchConfig({
    pageCount: 2,
    elements: ['scene', 'brand-ending'],
    products: [{ id: 'p', name: 'product', src: 'product.png' }],
    sceneImage: { id: 'shared', name: 'shared', src: 'shared.png' },
    sceneMode: 'unified',
  })
  config.elements = config.elements.map((element) =>
    element.value === 'scene'
      ? {
          ...element,
          references: [{ id: 'mood', name: 'mood', src: 'mood.png' }],
        }
      : element
  )
  const scenePage = buildDetailPageRequest(config, 0)
  assert.deepEqual(scenePage.images, ['product.png', 'mood.png', 'shared.png'])
  assert.match(
    scenePage.prompt,
    /image 2: Use scenes reference — borrow framing/
  )
  assert.match(
    scenePage.prompt,
    /image 3: shared scene reference for the whole set/
  )
  assert.match(
    scenePage.prompt,
    /Uploaded shared scene: use the shared scene reference image/
  )
  const closing = buildDetailPageRequest(config, 1)
  assert.deepEqual(closing.images, ['product.png'])
  assert.doesNotMatch(closing.prompt, /mood\.png|shared\.png/)
})
