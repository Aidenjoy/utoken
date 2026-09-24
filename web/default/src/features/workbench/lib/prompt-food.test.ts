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
import { createFoodConfig, FOOD_MODES, type FoodMode } from '../food-config'
import { designPlanToBodies } from './design-plan'
import { buildImageSize } from './image-size'
import { buildFoodPlan } from './prompt-food'

before(async () => {
  await i18next.init({ lng: 'en', fallbackLng: 'en', resources: {} })
})
function dish(name: string) {
  return {
    ...createDesignItem(),
    name,
    notes: `${name}-note`,
    image: { id: name, name, src: `${name}.png` },
  }
}
function valid(mode: FoodMode) {
  const config = createFoodConfig(mode)
  config.items = [dish('salad')]
  if (mode === 'combo') config.items.push(dish('noodles'))
  return config
}

for (const mode of FOOD_MODES) {
  test(`餐饮必需真实素材：${mode.value}`, () => {
    assert.throws(() => buildFoodPlan(createFoodConfig(mode.value)))
    const config = valid(mode.value)
    const plan = buildFoodPlan(config)
    assert.equal(plan.requests.length, 1)
    assert.equal(plan.continuity, mode.value === 'batch' ? 'food' : undefined)
    assert.match(plan.requests[0].prompt, /only authority for food identity/)
    assert.match(plan.requests[0].prompt, /original camera angle/)
    assert.match(
      plan.requests[0].prompt,
      /Do not invent a hidden cross-section/
    )
  })
}

test('菜单三项三个请求，重排删除后顺序正确且备注、素材隔离', () => {
  const config = valid('batch')
  config.items = [dish('salad'), dish('noodles'), dish('tea')]
  config.count = 4
  config.style = { id: 'style', name: 'style', src: 'style.png' }
  const original = structuredClone(config)
  const plan = buildFoodPlan(config)
  assert.equal(plan.requests.length, 3)
  for (const [index, request] of plan.requests.entries()) {
    const item = config.items[index]
    assert.equal(request.label, item.name)
    assert.ok(item.image)
    assert.deepEqual(request.images, [item.image.src, 'style.png'])
    assert.match(request.prompt, /style reference ONLY/)
    assert.ok(request.prompt.includes(item.notes))
    config.items
      .filter((_, other) => other !== index)
      .forEach((other) => assert.ok(!request.prompt.includes(other.notes)))
    assert.match(request.prompt, /No marketing text/)
  }
  assert.deepEqual(config, original)
  config.items = moveDesignItem(config.items, 2, -1)
  config.items = config.items.filter((item) => item.name !== 'salad')
  assert.deepEqual(
    buildFoodPlan(config).requests.map((item) => item.label),
    ['tea', 'noodles']
  )
})

test('单菜与套餐身份不同；套餐每张含全部确认条目及份数', () => {
  const config = valid('combo')
  config.items[1].quantity = 3
  config.count = 2
  config.style = { id: 'hidden', name: 'hidden', src: 'hidden.png' }
  const plan = buildFoodPlan(config)
  assert.equal(plan.requests.length, 2)
  assert.deepEqual(plan.sources, ['salad.png', 'noodles.png'])
  assert.deepEqual(plan.requests[0].images, ['salad.png', 'noodles.png'])
  assert.match(plan.requests[0].prompt, /ONE complete meal photograph/)
  assert.match(plan.requests[0].prompt, /"servings":3/)
  assert.doesNotMatch(
    plan.requests[0].prompt,
    /Retouch ONLY the current single dish/
  )
  config.items[1].quantity = 0
  assert.throws(() => buildFoodPlan(config))
})

test('图文标题必填、文案原样保留；无字及菜单不发送隐藏营销文字', () => {
  const config = valid('poster')
  config.copyMode = 'short'
  config.title = '  '
  assert.throws(() => buildFoodPlan(config))
  config.title = '新品「春日」'
  config.offer = '¥18.80 / 份'
  config.subtitle = '周五供应'
  const request = buildFoodPlan(config).requests[0]
  for (const value of [config.title, config.offer, config.subtitle]) {
    assert.ok(request.prompt.includes(value))
  }
  config.offer = ''
  assert.match(
    buildFoodPlan(config).requests[0].prompt,
    /Empty fields mean OMIT/
  )
  config.copyMode = 'none'
  assert.ok(!buildFoodPlan(config).requests[0].prompt.includes(config.title))
  config.mode = 'batch'
  assert.ok(!buildFoodPlan(config).requests[0].prompt.includes(config.subtitle))
})

test('营销图先设计版面再放菜与字：文字落底色或色块、禁描边字，修图模式不含版式指令', () => {
  const config = valid('poster')
  config.copyMode = 'short'
  config.title = '新品'
  const poster = buildFoodPlan(config).requests[0].prompt
  assert.match(poster, /designed layout/)
  assert.match(poster, /must not fill the frame edge to edge/)
  assert.match(poster, /never over the dishes/)
  assert.match(poster, /no outlines, strokes, halos or drop shadows/)
  config.count = 2
  assert.ok(
    buildFoodPlan(config).requests.every((request) =>
      request.prompt.includes('designed layout')
    )
  )
  assert.doesNotMatch(
    buildFoodPlan(valid('retouch')).requests[0].prompt,
    /designed layout/
  )
})

test('海报每张请求size由分辨率与比例独立构造，不读取隐藏张数', () => {
  const config = valid('poster')
  config.count = 2
  config.ratio = '3:4'
  const plan = buildFoodPlan(config)
  const bodies = designPlanToBodies(plan, '4K', 'gpt-image-1')
  assert.equal(bodies.length, 2)
  assert.deepEqual(
    bodies.map((body) => body.size),
    [buildImageSize('4K', '3:4'), buildImageSize('4K', '3:4')]
  )
  assert.ok(bodies.every((body) => body.n === 1))
  assert.ok(
    plan.requests.every((request) =>
      request.prompt.includes('do not mechanically crop')
    )
  )
})

for (const count of [0, -1, 1.5, Number.NaN, Infinity, 5]) {
  test(`拒绝独立方案非法张数 ${count}`, () => {
    const config = valid('retouch')
    config.count = count
    assert.throws(() => buildFoodPlan(config))
  })
}

test('智能比例不发送伪比例句，数值比例入提示词，列表外比例被拒绝', () => {
  const config = valid('retouch')
  config.ratio = 'smart'
  const smart = buildFoodPlan(config)
  assert.doesNotMatch(smart.requests[0].prompt, /aspect ratio/)
  config.ratio = '21:9'
  const wide = buildFoodPlan(config)
  assert.match(wide.requests[0].prompt, /Output aspect ratio 21:9\./)
  assert.throws(() => buildFoodPlan({ ...config, ratio: '2:5' }))
})

test('预先拒绝最后一项缺图、非法模式背景、超限列表、重复身份和超长标题', () => {
  const batch = valid('batch')
  batch.items = [dish('salad'), dish('tea')]
  batch.items[1].image = null
  assert.throws(() => buildFoodPlan(batch))
  batch.items = Array.from({ length: 7 }, (_, index) => dish(String(index)))
  assert.throws(() => buildFoodPlan(batch))
  batch.items = [dish('same'), dish('same')]
  batch.items[1].id = batch.items[0].id
  assert.throws(() => buildFoodPlan(batch))
  const config = valid('retouch')
  assert.throws(() => buildFoodPlan({ ...config, mode: 'illegal' as FoodMode }))
  assert.throws(() => buildFoodPlan({ ...config, background: 'illegal' }))
  assert.throws(() => buildFoodPlan({ ...config, resolution: '8K' }))
  assert.throws(() =>
    buildFoodPlan({ ...config, items: [dish('a'), dish('b')] })
  )
  assert.throws(() =>
    buildFoodPlan({
      ...valid('poster'),
      copyMode: 'short',
      title: 'a'.repeat(81),
    })
  )
})
