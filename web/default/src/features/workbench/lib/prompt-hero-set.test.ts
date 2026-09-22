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
import { describe, test } from 'node:test'

import { createDefaultHeroSetConfig } from '../constants'
import type { HeroSetConfig } from '../types'
import {
  buildHeroSetRequest,
  buildProductSetRequests,
  heroSetTotalCount,
} from './prompt-hero-set'

function productFixture(): HeroSetConfig {
  const config = createDefaultHeroSetConfig()
  config.mode = 'product'
  config.product.products = [
    { id: 'front', name: 'front.png', src: 'product-front' },
    { id: 'side', name: 'side.png', src: 'product-side' },
    { id: 'box', name: 'box.png', src: 'product-packaging' },
  ]
  return config
}

describe('商品套图生成计划', () => {
  test('默认五种用途分开请求，保留三张商品图且排除人物', () => {
    const config = productFixture()
    const requests = buildProductSetRequests(config)
    assert.equal(heroSetTotalCount(config), 5)
    assert.equal(requests.length, 5)
    assert.equal(
      requests.reduce((sum, request) => sum + request.count, 0),
      5
    )
    for (const request of requests) {
      assert.deepEqual(request.images, [
        'product-front',
        'product-side',
        'product-packaging',
      ])
      assert.match(
        request.prompt,
        /Do not add people, models, hands or body parts/
      )
      assert.doesNotMatch(request.prompt, /Angle plan:/)
    }
    assert.match(requests[4].prompt, /pure white background/)
    assert.doesNotMatch(
      requests[4].prompt,
      /Use a plausible product-appropriate environment/
    )
  })

  test('用途参考图及文字隔离，全局标语和价格按原样加入每个请求', () => {
    const config = productFixture()
    config.product.extra = ' 标语「轻装出发」\n价格 ¥99.90 / $12.50！ '
    config.product.shots[0].extra = '仅主图：标题放左上方'
    config.product.shots[0].references = [
      { id: 'layout', name: 'layout.png', src: 'hero-layout' },
    ]
    const requests = buildProductSetRequests(config)
    assert.deepEqual(requests[0].images, [
      'product-front',
      'product-side',
      'product-packaging',
      'hero-layout',
    ])
    assert.match(requests[0].prompt, /image 4: layout reference/)
    assert.ok(
      requests[0].prompt.endsWith(
        'Purpose-specific requirements:\n仅主图：标题放左上方'
      )
    )
    for (const request of requests) {
      assert.ok(request.prompt.includes(config.product.extra.trim()))
    }
    for (const request of requests.slice(1)) {
      assert.ok(!request.images.includes('hero-layout'))
      assert.ok(!request.prompt.includes('仅主图'))
    }
    config.product.extra = '价格 ¥79'
    assert.ok(buildProductSetRequests(config)[0].prompt.includes('价格 ¥79'))
    assert.ok(!buildProductSetRequests(config)[0].prompt.includes('99.90'))
  })

  test('多张参考图逐张生成，零张用途保留配置但不参与请求', () => {
    const config = productFixture()
    config.product.shots = [
      {
        type: 'hero',
        count: 2,
        extra: '主图要求',
        references: [
          { id: 'a', name: 'a.png', src: 'layout-a' },
          { id: 'b', name: 'b.png', src: 'layout-b' },
        ],
      },
      {
        type: 'structure',
        count: 0,
        extra: '不能泄露到本次提示词',
        references: [{ id: 'off', name: 'off.png', src: 'disabled-layout' }],
      },
    ]
    const requests = buildProductSetRequests(config)
    assert.equal(heroSetTotalCount(config), 2)
    assert.deepEqual(
      requests.map((request) => request.count),
      [1, 1]
    )
    assert.equal(requests[0].images.at(-1), 'layout-a')
    assert.equal(requests[1].images.at(-1), 'layout-b')
    for (const request of requests) {
      assert.ok(!request.prompt.includes('不能泄露'))
      assert.ok(!request.images.includes('disabled-layout'))
    }
    assert.equal(config.product.shots[1].references.length, 1)
  })

  test('单张参考图复用于所选张数，内容开关、比例进入请求', () => {
    const config = productFixture()
    config.product.shots = [
      {
        type: 'hero',
        count: 8,
        extra: '',
        references: [{ id: 'a', name: 'a.png', src: 'layout-a' }],
      },
    ]
    config.product.withCopy = false
    config.product.withScene = false
    config.ratio = '3:4'
    const [request] = buildProductSetRequests(config)
    assert.equal(request.count, 8)
    assert.match(request.prompt, /Do not add selling-point copy/)
    assert.match(request.prompt, /without lifestyle scenery or scene props/)
    assert.match(request.prompt, /3:4 aspect ratio/)
    assert.doesNotMatch(
      request.prompt,
      /Whole-set requirements|Purpose-specific requirements/
    )
    config.product.withCopy = true
    assert.match(
      buildProductSetRequests(config)[0].prompt,
      /Include concise, legible selling-point copy/
    )
  })

  for (const count of [0, -1, 1.5, 9, Number.NaN, Number.POSITIVE_INFINITY]) {
    test(`拒绝无效生成张数 ${String(count)}`, () => {
      const config = productFixture()
      config.product.shots = [
        { type: 'hero', count, references: [], extra: '' },
      ]
      assert.throws(
        () => buildProductSetRequests(config),
        /Select between 1 and 8/
      )
    })
  }

  test('总张数上限、参考图与张数不一致以及商品缺失均被拦截', () => {
    const config = productFixture()
    config.product.shots[0].count = 8
    assert.throws(
      () => buildProductSetRequests(config),
      /Select between 1 and 8/
    )
    config.product.shots = [
      {
        type: 'hero',
        count: 1,
        extra: '',
        references: [
          { id: 'a', name: 'a.png', src: 'layout-a' },
          { id: 'b', name: 'b.png', src: 'layout-b' },
        ],
      },
    ]
    assert.throws(
      () => buildProductSetRequests(config),
      /Select between 1 and 8/
    )
    config.product.products = []
    assert.throws(
      () => buildProductSetRequests(config),
      /Upload between 1 and 3/
    )
    config.product.products = [
      ...productFixture().product.products,
      { id: 'fourth', name: '4.png', src: 'fourth' },
    ]
    assert.throws(
      () => buildProductSetRequests(config),
      /Upload between 1 and 3/
    )
  })

  test('模特模式仍按原角度计划生成，不受商品设置影响', () => {
    const config = productFixture()
    config.mode = 'model'
    config.reference = {
      id: 'model',
      name: 'model.png',
      src: 'model-reference',
    }
    config.angles = [
      { value: 'front', count: 2 },
      { value: 'side', count: 1 },
    ]
    config.product.extra = '商品模式专用要求'
    config.extra = '统一使用浅灰背景'
    assert.equal(heroSetTotalCount(config), 3)
    const request = buildHeroSetRequest(config)
    assert.deepEqual(request.images, ['model-reference'])
    assert.match(
      request.prompt,
      /2 image\(s\) from the front view; 1 image\(s\) from the side view/
    )
    assert.match(
      request.prompt,
      /Keep the person, clothing and background consistent/
    )
    assert.match(request.prompt, /统一使用浅灰背景/)
    assert.doesNotMatch(request.prompt, /商品模式专用要求|Do not add people/)
  })
})
