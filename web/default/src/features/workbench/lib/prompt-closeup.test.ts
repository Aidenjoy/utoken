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

import { createDefaultCloseUpConfig } from '../constants'
import type { TryOnImage } from '../types'
import {
  buildCloseUpRequest,
  buildFlatLayRequest,
  buildThreeDRequest,
} from './prompt-closeup'

function image(name: string): TryOnImage {
  return { id: name, name, src: `https://example.test/${name}.png` }
}

test('仅正面图即可生成完整平铺底图，默认比例为 1:1', () => {
  const config = createDefaultCloseUpConfig()
  config.shotMode = 'flat'
  config.flat.front = image('front')
  const request = buildCloseUpRequest(config)
  assert.deepEqual(request.images, [image('front').src])
  assert.match(request.prompt, /full-garment flat-lay base image/)
  assert.match(request.prompt, /entire silhouette/)
  assert.match(request.prompt, /pure white background/)
  assert.match(request.prompt, /1:1 aspect ratio/)
  assert.doesNotMatch(
    request.prompt,
    /Dress the provided model|Prioritize these garment parts/
  )
})

for (const mode of ['smart', 'reference'] as const) {
  test(`${mode} 模式的补充图和参考图不能替代必填正面图`, () => {
    const config = createDefaultCloseUpConfig().flat
    config.generationMode = mode
    config.supplement = image('supplement')
    config.reference = image('reference')
    assert.throws(
      () => buildFlatLayRequest(config),
      /Upload the required front garment image/
    )
    config.front = { ...image('front'), src: '' }
    assert.throws(
      () => buildFlatLayRequest(config),
      /Upload the required front garment image/
    )
  })
}

test('参考图模式必须有布局参考图', () => {
  const config = createDefaultCloseUpConfig().flat
  config.front = image('front')
  config.generationMode = 'reference'
  assert.throws(
    () => buildFlatLayRequest(config),
    /Upload a flat-lay layout reference/
  )
})

for (const withSupplement of [false, true]) {
  test(`参考图模式素材角色与顺序正确，补充图=${withSupplement}`, () => {
    const config = createDefaultCloseUpConfig().flat
    config.front = image('front')
    config.generationMode = 'reference'
    config.reference = image('reference')
    config.supplement = withSupplement ? image('supplement') : null
    const request = buildFlatLayRequest(config)
    const expected = [image('front').src]
    if (withSupplement) expected.push(image('supplement').src)
    expected.push(image('reference').src)
    assert.deepEqual(request.images, expected)
    assert.match(request.prompt, /image 1: primary front garment image/)
    assert.ok(
      request.prompt.includes(
        `image ${expected.length}: flat-lay layout reference only`
      )
    )
    assert.match(
      request.prompt,
      /not its garment, colors, print, logos or text/
    )
  })
}

test('切回智能生成后不发送保留的布局参考图', () => {
  const config = createDefaultCloseUpConfig().flat
  config.front = image('front')
  config.supplement = image('supplement')
  config.reference = image('hidden-reference')
  const request = buildFlatLayRequest(config)
  assert.deepEqual(request.images, [
    image('front').src,
    image('supplement').src,
  ])
  assert.match(request.prompt, /image 2: optional supplementary shot/)
  assert.match(request.prompt, /arrangement automatically/)
  assert.doesNotMatch(request.prompt, /flat-lay layout reference only/)
})

test('服装类型、商家补充要求与比例进入提示词', () => {
  const config = createDefaultCloseUpConfig().flat
  config.front = image('front')
  config.garmentType = ' 衬衫 '
  config.note = ' 保持正面印花完整，背景浅灰 '
  config.ratio = '4:5'
  const request = buildFlatLayRequest(config)
  assert.match(request.prompt, /Uploaded garment type: 衬衫\./)
  assert.match(
    request.prompt,
    /Additional requirements:\n保持正面印花完整，背景浅灰/
  )
  assert.match(request.prompt, /override default styling and background/)
  assert.match(request.prompt, /4:5 aspect ratio/)
  config.ratio = 'smart'
  assert.doesNotMatch(buildFlatLayRequest(config).prompt, /aspect ratio/)
})

test('平铺不混入其他模式的素材、模特、部位和备注', () => {
  const config = createDefaultCloseUpConfig()
  config.shotMode = 'flat'
  config.flat.front = image('flat-front')
  config.front = image('old-front')
  config.side = image('old-side')
  config.back = image('old-back')
  config.threed.front = image('old-3d')
  config.model = image('old-model')
  config.references = [image('old-reference')]
  config.parts = ['cuff']
  config.note = 'OUTER_NOTE'
  config.genMode = 'merged'
  config.outputMode = 'replicate'
  config.ratio = '9:16'
  const request = buildCloseUpRequest(config)
  assert.deepEqual(request.images, [image('flat-front').src])
  assert.doesNotMatch(
    request.prompt,
    /OUTER_NOTE|Merge all picked parts|Prioritize these garment parts|9:16/
  )
})

for (const shotMode of ['position', 'threed'] as const) {
  test(`平铺配置不影响 ${shotMode} 模式的请求`, () => {
    const config = createDefaultCloseUpConfig()
    config.shotMode = shotMode
    config.front = image('position-front')
    config.threed.front = image('3d-garment')
    config.references = [image('detail-reference')]
    const before = buildCloseUpRequest(config)
    config.flat.front = image('flat-front')
    config.flat.supplement = image('flat-supplement')
    config.flat.reference = image('flat-reference')
    config.flat.generationMode = 'reference'
    config.flat.note = 'FLAT_NOTE'
    assert.deepEqual(buildCloseUpRequest(config), before)
    const expected =
      shotMode === 'position'
        ? [image('position-front').src, image('detail-reference').src]
        : [image('3d-garment').src]
    assert.deepEqual(before.images, expected)
  })
}

for (const mode of ['smart', 'reference'] as const) {
  test(`3D ${mode} 模式必须上传正面图，其他模式素材不能替代`, () => {
    const config = createDefaultCloseUpConfig()
    config.shotMode = 'threed'
    config.front = image('position-front')
    config.flat.front = image('flat-front')
    config.threed.generationMode = mode
    config.threed.supplement = image('supplement')
    config.threed.reference = image('reference')
    assert.throws(
      () => buildCloseUpRequest(config),
      /Upload the required front garment image/
    )
    config.threed.front = { ...image('front'), src: '' }
    assert.throws(
      () => buildCloseUpRequest(config),
      /Upload the required front garment image/
    )
  })
}

test('3D 单张正面图生成完整立体底图，不走平铺、部位或模特换衣逻辑', () => {
  const config = createDefaultCloseUpConfig()
  config.shotMode = 'threed'
  config.threed.front = image('3d-front')
  config.front = image('position-front')
  config.side = image('side')
  config.back = image('back')
  config.references = [image('detail-reference')]
  config.model = image('person')
  config.parts = ['cuff']
  config.genMode = 'merged'
  config.outputMode = 'replicate'
  config.note = 'POSITION_NOTE'
  config.ratio = '9:16'
  config.flat.front = image('flat-front')
  config.flat.note = 'FLAT_NOTE'
  const request = buildCloseUpRequest(config)
  assert.deepEqual(request.images, [image('3d-front').src])
  assert.match(request.prompt, /full-garment 3D white-background base image/)
  assert.match(request.prompt, /3D ghost-mannequin presentation/)
  assert.match(request.prompt, /entire silhouette/)
  assert.match(request.prompt, /pure white background/)
  assert.match(request.prompt, /1:1 aspect ratio/)
  assert.doesNotMatch(
    request.prompt,
    /POSITION_NOTE|FLAT_NOTE|9:16|Prioritize these garment parts|Dress the provided model|full-garment flat-lay base image|Merge all picked parts/
  )
})

test('3D 参考模式拒绝缺失或空的风格参考', () => {
  const config = createDefaultCloseUpConfig().threed
  config.front = image('front')
  config.generationMode = 'reference'
  assert.throws(() => buildThreeDRequest(config), /Upload a 3D style reference/)
  config.reference = { ...image('reference'), src: '' }
  assert.throws(() => buildThreeDRequest(config), /Upload a 3D style reference/)
})

for (const withSupplement of [false, true]) {
  test(`3D 参考模式区分主图、补充图和风格参考，补充图=${withSupplement}`, () => {
    const config = createDefaultCloseUpConfig().threed
    config.front = image('front')
    config.supplement = withSupplement ? image('supplement') : null
    config.reference = image('reference')
    config.generationMode = 'reference'
    const request = buildThreeDRequest(config)
    const expected = [image('front').src]
    if (withSupplement) expected.push(image('supplement').src)
    expected.push(image('reference').src)
    assert.deepEqual(request.images, expected)
    assert.ok(
      request.prompt.includes(
        `image ${expected.length}: 3D style reference only`
      )
    )
    assert.match(
      request.prompt,
      /not its garment, colors, print, logos, people or text/
    )
    assert.match(request.prompt, /3D or 2.5D dimensional presentation/)
    assert.doesNotMatch(request.prompt, /flat-lay layout reference only/)
  })
}

test('3D 智能模式不发送隐藏参考，类型、比例和补充要求真实生效', () => {
  const config = createDefaultCloseUpConfig().threed
  config.front = image('front')
  config.supplement = image('supplement')
  config.reference = image('hidden-reference')
  config.garmentType = ' 羽绒服 '
  config.note = ' 保持印花完整，浅灰背景 '
  config.ratio = '4:5'
  const request = buildThreeDRequest(config)
  assert.deepEqual(request.images, [
    image('front').src,
    image('supplement').src,
  ])
  assert.match(request.prompt, /image 2: optional supplementary shot/)
  assert.match(request.prompt, /Uploaded garment type: 羽绒服\./)
  assert.match(
    request.prompt,
    /Additional requirements:\n保持印花完整，浅灰背景/
  )
  assert.match(request.prompt, /override default styling and background/)
  assert.match(request.prompt, /4:5 aspect ratio/)
  assert.doesNotMatch(request.prompt, /3D style reference only/)
  config.ratio = 'smart'
  assert.doesNotMatch(buildThreeDRequest(config).prompt, /aspect ratio/)
})

for (const shotMode of ['position', 'flat'] as const) {
  test(`3D 素材和参数不污染 ${shotMode} 请求`, () => {
    const config = createDefaultCloseUpConfig()
    config.shotMode = shotMode
    config.front = image('position-front')
    config.flat.front = image('flat-front')
    const before = buildCloseUpRequest(config)
    config.threed.front = image('3d-front')
    config.threed.supplement = image('3d-supplement')
    config.threed.reference = image('3d-reference')
    config.threed.generationMode = 'reference'
    config.threed.note = 'THREED_NOTE'
    config.threed.ratio = '4:5'
    assert.deepEqual(buildCloseUpRequest(config), before)
  })
}
