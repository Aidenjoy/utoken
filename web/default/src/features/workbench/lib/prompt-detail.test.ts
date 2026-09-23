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
import type { DetailPageConfig, DetailPageElementValue } from '../types'
import {
  buildDetailPageRequest,
  getSelectedDetailElements,
} from './prompt-detail'

function productConfig(values?: DetailPageElementValue[]): DetailPageConfig {
  const config = createDefaultDetailPageConfig()
  config.products = [{ id: 'p', name: 'product', src: 'product.png' }]
  if (values) {
    config.elements = config.elements.map((element) => ({
      ...element,
      enabled: values.includes(element.value),
    }))
  }
  return config
}

test('默认四项就是四张分段，不额外插入封面或合并模块', () => {
  const config = productConfig()
  const selected = getSelectedDetailElements(config.elements)
  assert.deepEqual(
    selected.map((item) => item.value),
    ['copy', 'scene', 'closeup', 'brand-ending']
  )
  for (const [index, element] of selected.entries()) {
    const result = buildDetailPageRequest(config, index)
    assert.deepEqual(result.images, ['product.png'])
    assert.ok(
      result.prompt.includes(
        `Generate only segment ${index + 1} of 4. Current module: ${element.label}.`
      )
    )
    assert.match(result.prompt, /exactly one finished segment image/)
    assert.match(
      result.prompt,
      /Do not insert a cover, merge modules, repeat a module/
    )
    assert.match(result.prompt, /3:4 aspect ratio/)
  }
  assert.throws(() => buildDetailPageRequest(config, 4))
})

const duties: Array<[DetailPageElementValue, RegExp]> = [
  ['copy', /Demonstrate a few visible or explicitly confirmed selling points/],
  ['model', /Show a model wearing, holding or using the actual product/],
  ['scene', /recognizable, realistic usage environment/],
  ['closeup', /sharp close-up or macro view/],
  ['package', /Show only packaging or included items visible/],
  ['size-spec', /Never infer measurements from pixels/],
  ['steps', /physically plausible usage sequence/],
  [
    'brand-ending',
    /Close the story with a memorable product-in-context composition/,
  ],
]

for (const [value, duty] of duties) {
  test(`只选 ${value} 时直接生成该模块，文字和环境不依赖其他勾选`, () => {
    const config = productConfig([value])
    const { prompt } = buildDetailPageRequest(config, 0)
    assert.match(prompt, /Generate only segment 1 of 1/)
    assert.match(prompt, duty)
    assert.match(prompt, /Text is allowed on every segment/)
    assert.match(prompt, /Every module may use environmental backgrounds/)
    assert.match(prompt, /even when the usage-scene module is not selected/)
    assert.match(prompt, /no screenshot frame, outer card border/)
    assert.doesNotMatch(
      prompt,
      /Selling-point copy is disabled|No lifestyle scenery|Scene warehouse|Default styling: light neutral/
    )
    assert.throws(() => buildDetailPageRequest(config, 1))
  })
}

test('全部八项按界面顺序各生成一次，输入数组乱序不会改变阅读顺序', () => {
  const config = productConfig(duties.map(([value]) => value))
  config.elements.reverse()
  const selected = getSelectedDetailElements(config.elements)
  assert.deepEqual(
    selected.map((item) => item.value),
    duties.map(([value]) => value)
  )
  const requests = selected.map((_element, index) =>
    buildDetailPageRequest(config, index)
  )
  assert.equal(requests.length, 8)
  for (const [index, [, duty]] of duties.entries()) {
    assert.ok(
      requests[index].prompt.includes(
        `Generate only segment ${index + 1} of 8.`
      )
    )
    assert.match(requests[index].prompt, duty)
    const others = duties.filter((_entry, i) => i !== index)
    for (const [, otherDuty] of others) {
      assert.doesNotMatch(requests[index].prompt, otherDuty)
    }
  }
})

test('空勾选及非法分段索引在请求构造阶段拒绝', () => {
  assert.throws(() => buildDetailPageRequest(productConfig([]), 0), {
    message: 'Select at least one content module',
  })
  const config = productConfig(['closeup'])
  for (const index of [-1, 1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => buildDetailPageRequest(config, index))
  }
})

test('三项模块独立传递参考图和要求，未选模块材料不进入任何请求', () => {
  const config = productConfig(['scene', 'closeup', 'brand-ending'])
  config.products.push({ id: 'back', name: 'back', src: 'back.png' })
  config.elements = config.elements.map((element) => ({
    ...element,
    references: [
      { id: element.value, name: element.value, src: `${element.value}.png` },
    ],
    extra: `Only-${element.value}-notes`,
  }))
  const before = structuredClone(config)
  const selected = getSelectedDetailElements(config.elements)
  for (const [index, element] of selected.entries()) {
    const result = buildDetailPageRequest(config, index)
    assert.deepEqual(result.images, [
      'product.png',
      'back.png',
      `${element.value}.png`,
    ])
    assert.ok(
      result.prompt.includes(`image 3: ${element.label} module reference`)
    )
    assert.ok(result.prompt.includes(`Only-${element.value}-notes`))
    for (const other of config.elements.filter(
      (item) => item.value !== element.value
    )) {
      assert.ok(!result.prompt.includes(`Only-${other.value}-notes`))
    }
    assert.match(
      result.prompt,
      /do not copy its products, people, text, watermarks or branding/
    )
  }
  assert.deepEqual(config, before)
})

test('取消模块仅减少对应分段，不因保留的参考图或要求重新启用', () => {
  const config = productConfig(['scene', 'closeup'])
  const scene = config.elements.find((element) => element.value === 'scene')
  assert.ok(scene)
  scene.references = [{ id: 'scene', name: 'scene', src: 'scene.png' }]
  scene.extra = 'Use the original coffee shop.'
  scene.enabled = false
  assert.equal(getSelectedDetailElements(config.elements).length, 1)
  const { images, prompt } = buildDetailPageRequest(config, 0)
  assert.deepEqual(images, ['product.png'])
  assert.match(prompt, /Current module: Local close-up/)
  assert.doesNotMatch(prompt, /Use the original coffee shop/)
  assert.equal(scene.references.length, 1)
  assert.equal(scene.extra, 'Use the original coffee shop.')
})

test('保留用户原文和事实约束，短标题规则不覆盖规格数值或明确的无字要求', () => {
  const config = productConfig(['size-spec'])
  config.extra = '  标题：轻装出发！价格：¥99.00\n容量 350 mL；Use English.  '
  const { prompt } = buildDetailPageRequest(config, 0)
  assert.ok(
    prompt.includes(
      `Additional detail page requirements:\n${config.extra.trim()}`
    )
  )
  assert.match(
    prompt,
    /Preserve supplied titles, slogans, values, units, currency symbols and punctuation exactly/
  )
  assert.match(prompt, /use Simplified Chinese when neither is given/)
  assert.match(
    prompt,
    /Confirmed specification values and supplied exact copy are not subject to this headline length guideline/
  )
  assert.match(prompt, /Honor an explicit request for a text-free design/)
  assert.match(prompt, /Do not invent dimensions, performance claims, prices/)
  assert.match(prompt, /If no verified specifications are available/)
  assert.match(
    prompt,
    /Do not print UI option names, module names, instructions/
  )
  assert.match(prompt, /no fake glyphs/)
})

test('缺少包装或操作依据时使用真实可见内容，不编造产品功能', () => {
  const packaging = buildDetailPageRequest(productConfig(['package']), 0).prompt
  assert.match(packaging, /If no packaging evidence is available/)
  assert.match(packaging, /never invent a branded box/)
  const steps = buildDetailPageRequest(productConfig(['steps']), 0).prompt
  assert.match(
    steps,
    /show the observable ready-to-use state instead of guessing a procedure/
  )
})

test('自动尺寸不发送伪比例，空白补充要求不进入提示词', () => {
  const config = productConfig(['closeup'])
  config.ratio = 'smart'
  config.extra = '   '
  const { prompt } = buildDetailPageRequest(config, 0)
  assert.doesNotMatch(
    prompt,
    /smart aspect ratio|Additional detail page requirements:/
  )
})
