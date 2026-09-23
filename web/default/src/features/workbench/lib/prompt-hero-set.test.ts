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
  buildModelSetRequests,
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
      requests[0].prompt.includes(
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

  test('关闭细节图后第四张仍是独立白底图，不继承营销海报文案', () => {
    const config = productFixture()
    config.product.shots[3].count = 0
    config.product.shots[0].extra = '标题字要大一些'
    config.product.shots[1].extra = '总结核心卖点并放在图片内'
    const requests = buildProductSetRequests(config)
    assert.equal(heroSetTotalCount(config), 4)
    assert.equal(requests.length, 4)
    assert.match(
      requests[0].prompt,
      /Required image type: Traffic-driving hero image/
    )
    assert.match(
      requests[1].prompt,
      /Required image type: Core selling point image/
    )
    assert.match(requests[2].prompt, /Required image type: Usage scene image/)
    const white = requests[3].prompt
    assert.match(white, /Required image type: White background image/)
    assert.match(white, /uniform solid #FFFFFF \(RGB 255, 255, 255\)/)
    assert.match(white, /No added text, headlines, selling points, prices/)
    assert.match(white, /full silhouette, handles and included parts/)
    assert.doesNotMatch(white, /Include concise|标题字要大|总结核心卖点/)
  })

  for (const withCopy of [false, true]) {
    for (const withScene of [false, true]) {
      test(`白底用途优先于文案=${withCopy}、场景=${withScene}及冲突的参考图和补充要求`, () => {
        const config = productFixture()
        config.product.withCopy = withCopy
        config.product.withScene = withScene
        config.product.extra = '整套米黄色渐变背景，标语：轻装出发，价格 ¥99'
        config.product.shots = [
          {
            type: 'white',
            count: 1,
            references: [
              { id: 'scene', name: 'scene.png', src: 'colored-poster' },
            ],
            extra: '保留提手，在大理石台面加促销标签',
          },
        ]
        const [request] = buildProductSetRequests(config)
        assert.equal(request.images.at(-1), 'colored-poster')
        assert.match(request.prompt, /only product orientation and framing/)
        assert.match(request.prompt, /Discard its background, scenery/)
        assert.match(request.prompt, /disabled regardless of whole-set options/)
        assert.match(request.prompt, /including requests in the notes below/)
        assert.match(
          request.prompt,
          /only where compatible with the mandatory image purpose/
        )
        assert.match(request.prompt, /cannot change the assigned image type/)
        assert.match(
          request.prompt,
          /No gray, cream, colored or gradient background/
        )
        assert.match(
          request.prompt,
          /backdrop shadow, reflection, pedestal or scene props/
        )
        assert.match(request.prompt, /physical on-product logo/)
        assert.ok(request.prompt.includes(config.product.extra))
        assert.ok(request.prompt.includes(config.product.shots[0].extra))
        assert.doesNotMatch(
          request.prompt,
          /Include concise|Use a clean studio|environment is optional/
        )
        assert.match(
          request.prompt,
          /Final image check:[\s\S]*uniform #FFFFFF, with no added text or scenery/
        )
      })
    }
  }

  test('八种用途各自约束画面，不把场景、细节、角度和结构图都做成主图海报', () => {
    const config = productFixture()
    config.product.withScene = false
    config.product.withCopy = false
    config.product.shots = config.product.shots.map((shot) => ({
      ...shot,
      count: 1,
    }))
    const requests = buildProductSetRequests(config)
    assert.equal(requests.length, 8)
    const expected = [
      /complete product the dominant, sharply readable subject/,
      /Visually demonstrate one or a few verifiable product benefits/,
      /recognizable, realistic environment where it would actually be used/,
      /close-up or macro crop/,
      /uniform solid #FFFFFF/,
      /one useful side, rear or three-quarter angle/,
      /restrained lighting or abstract decorative effects/,
      /visible joint, closure, component connection/,
    ]
    requests.forEach((request, index) => {
      assert.match(request.prompt, expected[index])
      assert.match(request.prompt, /exactly one standalone/)
      assert.match(
        request.prompt,
        /one coordinated product photo shoot, not an independent design/
      )
      assert.match(
        request.prompt,
        /do not copy its background, layout, promotional text/
      )
      assert.doesNotMatch(request.prompt, /Include concise/)
    })
    assert.match(requests[2].prompt, /usage environment is required/)
    assert.doesNotMatch(requests[2].prompt, /Use a clean studio background/)
    assert.match(
      requests[3].prompt,
      /Do not substitute a full-product hero poster/
    )
    assert.match(requests[7].prompt, /Do not invent internal components/)
  })

  test('共享场景图只进入启用场景的用途，白底图保持纯白且不携带场景', () => {
    const config = productFixture()
    config.product.sceneImage = {
      id: 'scene',
      name: 'scene.png',
      src: 'shared-scene',
    }
    const requests = buildProductSetRequests(config)
    for (const request of requests.slice(0, 4)) {
      assert.ok(request.images.includes('shared-scene'))
      assert.match(request.prompt, /shared scene reference for the whole set/)
      assert.match(
        request.prompt,
        /Use the uploaded shared scene as the required environment/
      )
      assert.match(
        request.prompt,
        /do not copy its products, people, text or branding/
      )
    }
    const white = requests[4]
    assert.ok(!white.images.includes('shared-scene'))
    assert.doesNotMatch(white.prompt, /shared scene reference/)
    assert.match(white.prompt, /uniform solid #FFFFFF/)
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

  test('模特模式按每个角度的张数创建独立请求，不受商品设置影响', () => {
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
    const requests = buildModelSetRequests(config)
    assert.equal(requests.length, 3)
    for (const request of requests) {
      assert.equal(request.count, 1)
      assert.deepEqual(request.images, ['model-reference'])
      assert.match(request.prompt, /exactly one standalone/)
      assert.match(request.prompt, /统一使用浅灰背景/)
      assert.doesNotMatch(
        request.prompt,
        /商品模式专用要求|Do not add people|Angle plan:/
      )
    }
    assert.match(requests[0].prompt, /variation 1 of 2 for the front view/)
    assert.match(requests[1].prompt, /variation 2 of 2 for the front view/)
    assert.match(requests[2].prompt, /variation 1 of 1 for the side view/)
  })

  test('模特套图共享场景图进入每张请求并替换默认背景指令', () => {
    const config = modelFixture()
    config.angles = [{ value: 'front', count: 2 }]
    config.sceneImage = { id: 'scene', name: 'scene.png', src: 'shared-scene' }
    const requests = buildModelSetRequests(config)
    for (const request of requests) {
      assert.deepEqual(request.images, ['model-reference', 'shared-scene'])
      assert.match(request.prompt, /Image 2 is the shared scene reference/)
      assert.match(request.prompt, /never return a transparent cutout/)
      assert.match(
        request.prompt,
        /Only the requested body view and natural pose or expression may vary/
      )
    }
    assert.match(requests[0].prompt, /Pose variation cue: relaxed hands/)
    assert.match(requests[1].prompt, /Pose variation cue: a subtle weight/)
  })

  test('无场景图时模特套图要求共用环境并禁止透明抠图背景', () => {
    const config = modelFixture()
    const [request] = buildModelSetRequests(config)
    assert.deepEqual(request.images, ['model-reference'])
    assert.match(request.prompt, /light-gray photographic studio/)
    assert.match(request.prompt, /Always render a complete background/)
    assert.doesNotMatch(request.prompt, /shared scene reference/)
  })
})

function modelFixture(): HeroSetConfig {
  const config = createDefaultHeroSetConfig()
  config.reference = { id: 'model', name: 'model.png', src: 'model-reference' }
  return config
}

describe('模特套图自定义指令', () => {
  test('正面三张逐张指定站立全身、运动装、表情及营销留白，无保留旧衣服冲突', () => {
    const config = modelFixture()
    config.angles = [{ value: 'front', count: 3 }]
    config.pose = 'standing'
    config.outfit = 'sporty'
    config.expression = 'natural-smile'
    config.other = 'text-space'
    config.ratio = '3:4'
    const requests = buildModelSetRequests(config)
    assert.equal(requests.length, 3)
    assert.equal(new Set(requests.map((request) => request.prompt)).size, 3)
    for (const request of requests) {
      assert.equal(request.count, 1)
      assert.match(request.prompt, /Required view for this image: Front view/)
      assert.match(request.prompt, /Standing upright/)
      assert.match(request.prompt, /full-body long shot/)
      assert.match(request.prompt, /below the feet/)
      assert.match(
        request.prompt,
        /If the reference is cropped, extend the scene/
      )
      assert.match(request.prompt, /replace the reference clothing/)
      assert.match(request.prompt, /athletic top, sports bottoms and sneakers/)
      assert.match(request.prompt, /Required expression: Natural smile/)
      assert.match(request.prompt, /left 35%/)
      assert.match(request.prompt, /entire subject in the right 65%/)
      assert.match(request.prompt, /Do not render the headline itself/)
      assert.match(request.prompt, /3:4 aspect ratio/)
      assert.doesNotMatch(
        request.prompt,
        /Preserve the original outfit|keep the same person identity, outfit and scene/
      )
    }
  })

  test('未选搭配及明确保留原搭配时保持原服装，不凭空指定姿势表情或留白', () => {
    for (const outfit of ['', 'keep']) {
      const config = modelFixture()
      config.outfit = outfit
      const [request] = buildModelSetRequests(config)
      assert.match(request.prompt, /Preserve the original outfit/)
      assert.doesNotMatch(
        request.prompt,
        /Required pose|Required expression|Required outfit override|left 35%|aspect ratio/
      )
    }
  })

  test('其他搭配选项均要求换装，不与身份保持混为一谈', () => {
    for (const [outfit, expected] of [
      ['casual', 'casual outfit'],
      ['commuter', 'tailored workwear'],
      ['dress', 'elegant dress'],
    ]) {
      const config = modelFixture()
      config.outfit = outfit
      const [request] = buildModelSetRequests(config)
      assert.ok(request.prompt.includes(expected))
      assert.match(request.prompt, /Required outfit override: replace/)
      assert.doesNotMatch(request.prompt, /Preserve the original outfit/)
    }
  })

  test('坐姿、行走、倚靠和躺姿均包含完整身体构图，手持强调握持关系', () => {
    for (const [pose, expected] of [
      ['sitting', 'entire seated body'],
      ['walking', 'natural stride'],
      ['leaning', 'support contact and feet'],
      ['lying', 'whole reclining body'],
      ['handheld', 'correct grip'],
    ]) {
      const config = modelFixture()
      config.pose = pose
      const [request] = buildModelSetRequests(config)
      assert.ok(request.prompt.includes(expected))
      if (pose !== 'handheld') {
        assert.match(request.prompt, /full-body long shot/)
      }
    }
  })

  test('附加处理各自落实到光线、氛围和细节，不强制裁切', () => {
    for (const [other, expected] of [
      ['lighting', 'color temperature, exposure'],
      ['atmosphere', 'environmental depth and atmosphere'],
      [
        'details',
        'do not replace a full-body view with a cropped detail close-up',
      ],
    ]) {
      const config = modelFixture()
      config.other = other
      assert.ok(buildModelSetRequests(config)[0].prompt.includes(expected))
    }
  })

  test('文字要求原样进入每张请求并明确优先级，背面不为表情转回正面', () => {
    const config = modelFixture()
    config.angles = [{ value: 'back', count: 2 }]
    config.expression = 'confident'
    config.other = 'text-space'
    config.extra = '  留白改为右侧，戴红帽子。\n左手插兜  '
    for (const request of buildModelSetRequests(config)) {
      assert.ok(
        request.prompt.includes(
          `Whole-set requirements:\n${config.extra.trim()}`
        )
      )
      assert.match(
        request.prompt,
        /take priority over inferred defaults and conflicting preset styling/
      )
      assert.match(request.prompt, /Back view: show the back/)
      assert.match(
        request.prompt,
        /do not change the requested body view just to expose the face/
      )
    }
  })

  test('非法张数、重复或未知视角及缺少参考图不发起生成计划', () => {
    for (const count of [0, -1, 1.5, 5, Number.NaN, Infinity]) {
      const config = modelFixture()
      config.angles = [{ value: 'front', count }]
      assert.throws(() => buildModelSetRequests(config), /1 to 4 images/)
    }
    for (const angles of [
      [],
      [{ value: 'unknown', count: 1 }],
      [
        { value: 'front', count: 1 },
        { value: 'front', count: 2 },
      ],
    ]) {
      const config = modelFixture()
      config.angles = angles
      assert.throws(() => buildModelSetRequests(config), /1 to 4 images/)
    }
    assert.throws(
      () => buildModelSetRequests(createDefaultHeroSetConfig()),
      /Upload a reference image/
    )
  })
})
