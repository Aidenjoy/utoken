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
import { before, test } from 'node:test'

import i18next from 'i18next'

import { createDesignItem, moveDesignItem } from '../design-types'
import {
  changePackagingShape,
  COMPATIBLE_MATERIALS,
  createPackagingConfig,
  PACKAGING_MODES,
  PACKAGING_SHAPES,
  type PackagingMode,
} from '../packaging-config'
import { designPlanToBodies } from './design-plan'
import { buildPackagingPlan } from './prompt-packaging'

before(async () => {
  await i18next.init({ lng: 'en', fallbackLng: 'en', resources: {} })
})
function photo(name: string) {
  return { id: name, name, src: `${name}.png` }
}
function valid(mode: PackagingMode) {
  const config = createPackagingConfig(mode)
  config.brief = '茶叶礼盒，简洁的植物图案'
  config.master = photo('master')
  config.items = config.items.map((item, index) => ({
    ...item,
    name: `SKU-${index}`,
    notes: `private-${index}`,
    image: photo(`item-${index}`),
  }))
  return config
}

for (const mode of PACKAGING_MODES) {
  test(`包装流程输出职责及输入要求：${mode.value}`, () => {
    assert.throws(() => buildPackagingPlan(createPackagingConfig(mode.value)))
    const plan = buildPackagingPlan(valid(mode.value))
    assert.equal(
      plan.requests.length,
      ['series', 'materials'].includes(mode.value) ? 2 : 1
    )
    assert.equal(
      plan.continuity,
      ['series', 'materials'].includes(mode.value) ? 'packaging' : undefined
    )
    assert.match(plan.requests[0].prompt, /never a contact sheet, dieline/)
    assert.match(plan.requests[0].prompt, /Do not invent barcodes/)
  })
}

test('智能比例不发送伪比例句，数值比例入提示词，列表外比例被拒绝', () => {
  const config = valid('concept')
  config.ratio = 'smart'
  const smart = buildPackagingPlan(config)
  assert.doesNotMatch(smart.requests[0].prompt, /aspect ratio/)
  config.ratio = '5:4'
  const boxed = buildPackagingPlan(config)
  assert.match(boxed.requests[0].prompt, /Output aspect ratio 5:4\./)
  assert.throws(() => buildPackagingPlan({ ...config, ratio: '2:5' }))
})

test('纯文字概念省略image，无源图时不虚构内部商品；品牌、风格和商品角色分离', () => {
  const config = valid('concept')
  let plan = buildPackagingPlan(config)
  assert.deepEqual(plan.sources, [])
  assert.ok(
    !Object.hasOwn(designPlanToBodies(plan, '2K', 'gpt-image-1')[0], 'image')
  )
  assert.match(
    plan.requests[0].prompt,
    /show the packaging ONLY, closed or opaque/
  )
  config.products = [photo('product')]
  config.brand = photo('brand')
  config.style = photo('style')
  config.brandName = '青山'
  config.productName = '春茶'
  config.copy = '礼赠心意'
  plan = buildPackagingPlan(config)
  assert.deepEqual(plan.requests[0].images, [
    'product.png',
    'brand.png',
    'style.png',
  ])
  assert.match(plan.requests[0].prompt, /Image 1: actual product identity/)
  assert.match(
    plan.requests[0].prompt,
    /Image 2: brand\/Logo visual reference only/
  )
  assert.match(plan.requests[0].prompt, /Image 3: visual style reference only/)
  for (const text of [config.brandName, config.productName, config.copy]) {
    assert.ok(plan.requests[0].prompt.includes(text))
  }
  config.count = 4
  assert.equal(buildPackagingPlan(config).requests.length, 4)
})

test('焕新严格区分整面、标签和腰封；展示仅改摄影环境', () => {
  const config = valid('refresh')
  assert.match(
    buildPackagingPlan(config).requests[0].prompt,
    /overall color, illustration and label design/
  )
  config.refresh = 'label'
  assert.match(
    buildPackagingPlan(config).requests[0].prompt,
    /Change ONLY the label surface/
  )
  config.refresh = 'sleeve'
  assert.match(
    buildPackagingPlan(config).requests[0].prompt,
    /ONLY a seasonal belly band/
  )
  const display = valid('display')
  display.products = [photo('hidden')]
  display.brandName = 'hidden-brand'
  const result = buildPackagingPlan(display).requests[0]
  assert.deepEqual(result.images, ['master.png'])
  assert.match(
    result.prompt,
    /Change ONLY background, lighting and composition/
  )
  assert.ok(!result.prompt.includes('hidden-brand'))
})

test('材质N组合=N图，当前材质优先，固定结构与图案；形态切换消除不兼容项', () => {
  const config = valid('materials')
  config.count = 4
  const plan = buildPackagingPlan(config)
  assert.equal(plan.requests.length, 2)
  assert.match(plan.requests[0].prompt, /White paperboard/)
  assert.match(plan.requests[1].prompt, /Kraft paper/)
  assert.match(
    plan.requests[1].prompt,
    /current material requirement overrides/
  )
  assert.ok(
    plan.requests.every((request) => request.images.join() === 'master.png')
  )
  const original = structuredClone(config)
  for (const shape of PACKAGING_SHAPES) {
    const next = changePackagingShape(config, shape.value)
    assert.ok(COMPATIBLE_MATERIALS[shape.value].includes(next.material))
    assert.ok(
      next.combinations.every((item) =>
        COMPATIBLE_MATERIALS[shape.value].includes(item.material)
      )
    )
    assert.equal(buildPackagingPlan(next).requests.length, 2)
  }
  assert.deepEqual(config, original)
  assert.throws(() => buildPackagingPlan({ ...config, shape: 'bottle' }))
  assert.throws(() =>
    buildPackagingPlan({ ...config, combinations: [config.combinations[0]] })
  )
  assert.throws(() =>
    buildPackagingPlan({
      ...config,
      combinations: [config.combinations[0], { ...config.combinations[0] }],
    })
  )
  assert.throws(() =>
    buildPackagingPlan({
      ...config,
      combinations: config.combinations.map((item) => ({
        ...item,
        finish: 'invalid',
      })),
    })
  )
})

test('礼盒原图可选，数量明确且内容物不扩充；拒绝非法数量和缺图', () => {
  const config = valid('unboxing')
  config.master = null
  config.items[0].quantity = 4
  const request = buildPackagingPlan(config).requests[0]
  assert.deepEqual(request.images, ['item-0.png'])
  assert.match(request.prompt, /"quantity":4/)
  assert.match(request.prompt, /Do not add gifts/)
  for (const quantity of [0, 5, 1.2, Number.NaN, Infinity]) {
    assert.throws(() =>
      buildPackagingPlan({
        ...config,
        items: [{ ...config.items[0], quantity }],
      })
    )
  }
  config.items[0].image = null
  assert.throws(() => buildPackagingPlan(config))
})

test('系列SKU各自隔离、原文保留，重排删除不更改来源，首图文字不得继承', () => {
  const config = valid('series')
  config.count = 4
  config.items.push({ ...createDesignItem(), name: '第三口味', notes: '绿色' })
  const plan = buildPackagingPlan(config)
  assert.equal(plan.requests.length, 3)
  assert.deepEqual(
    plan.requests.map((request) => request.images),
    [['master.png', 'item-0.png'], ['master.png', 'item-1.png'], ['master.png']]
  )
  for (const [index, request] of plan.requests.entries()) {
    assert.ok(request.prompt.includes(config.items[index].name))
    config.items
      .filter((_, other) => other !== index)
      .forEach((item) => assert.ok(!request.prompt.includes(item.name)))
    assert.match(request.prompt, /Never inherit another SKU name/)
  }
  config.items = moveDesignItem(config.items, 2, -1).filter(
    (item) => item.name !== 'SKU-0'
  )
  assert.deepEqual(
    buildPackagingPlan(config).requests.map((request) => request.label),
    ['第三口味', 'SKU-1']
  )
  config.items[1].name = '   '
  assert.throws(() => buildPackagingPlan(config))
})

test('展示多比例只按所选比例输出；不启用改变设计的连续性模式', () => {
  const config = valid('display')
  config.multiRatio = true
  const plan = buildPackagingPlan(config)
  assert.deepEqual(
    plan.requests.map((request) => request.ratio),
    ['1:1', '3:4', '16:9']
  )
  assert.equal(plan.continuity, undefined)
  assert.throws(() => buildPackagingPlan({ ...config, channels: [] }))
})

test('拒绝越界及非法枚举，批次6张上限和独立4张上限均有效', () => {
  const config = valid('concept')
  assert.throws(() =>
    buildPackagingPlan({ ...config, mode: 'bad' as PackagingMode })
  )
  assert.throws(() =>
    buildPackagingPlan({
      ...config,
      products: Array.from({ length: 5 }, (_, index) => photo(String(index))),
    })
  )
  assert.throws(() => buildPackagingPlan({ ...config, brief: '  ' }))
  assert.throws(() => buildPackagingPlan({ ...config, count: 5 }))
  assert.throws(() => buildPackagingPlan({ ...valid('display'), scene: 'bad' }))
  assert.throws(() =>
    buildPackagingPlan({ ...valid('refresh'), refresh: 'bad' })
  )
  const series = valid('series')
  series.items = Array.from({ length: 6 }, (_, index) => ({
    ...createDesignItem(),
    name: `sku-${index}`,
  }))
  assert.equal(buildPackagingPlan(series).requests.length, 6)
  series.items.push({ ...createDesignItem(), name: 'seventh' })
  assert.throws(() => buildPackagingPlan(series))
})
