/**
 * 智能画布坐标变换校验（零依赖，直接 `bun run scripts/canvas-geometry-check.ts`）
 *
 * 为什么不放在 src 里用测试框架：本项目未引入 vitest，且坐标变换是纯函数，
 * 用表驱动脚本即可给出精确断言；脚本位于 tsconfig 的 include 之外，不参与构建。
 *
 * 覆盖：视口缩放平移、图层位移缩放旋转、源图裁剪，以及它们的组合与往返一致性。
 */
import {
  canvasPointToLayerLocal,
  fitViewport,
  layerLocalToCanvasPoint,
  sourceToViewportPoint,
  viewportPixelToSourcePixel,
  viewportToCanvasPoint,
  viewportToSourcePoint,
  zoomViewportAt,
  type TransformableLayer,
  type Viewport,
} from '../src/features/canvas/lib/geometry.ts'

let failures = 0
let checks = 0

function near(actual: number, expected: number, tolerance = 1e-6): boolean {
  return Math.abs(actual - expected) <= tolerance
}

function assertPoint(
  label: string,
  actual: { x: number; y: number },
  expected: { x: number; y: number },
  tolerance = 1e-6
): void {
  checks += 1
  if (
    !near(actual.x, expected.x, tolerance) ||
    !near(actual.y, expected.y, tolerance)
  ) {
    failures += 1
    console.error(
      `✗ ${label}: 期望 (${expected.x}, ${expected.y})，实际 (${actual.x}, ${actual.y})`
    )
    return
  }
  console.log(`✓ ${label}`)
}

function assertNumber(label: string, actual: number, expected: number): void {
  checks += 1
  if (!near(actual, expected)) {
    failures += 1
    console.error(`✗ ${label}: 期望 ${expected}，实际 ${actual}`)
    return
  }
  console.log(`✓ ${label}`)
}

const identityViewport: Viewport = { scale: 1, offsetX: 0, offsetY: 0 }

function layer(
  overrides: Partial<TransformableLayer> = {}
): TransformableLayer {
  return {
    x: 0,
    y: 0,
    width: 2000,
    height: 2000,
    scale: 1,
    rotation: 0,
    ...overrides,
  }
}

// 1. 无变换：视口点即原图像素点
assertPoint(
  '无变换时视口点等于原图像素点',
  viewportToSourcePoint({ x: 100, y: 100 }, identityViewport, layer()),
  { x: 100, y: 100 }
)

// 2. 视口缩放 + 平移
assertPoint(
  '视口缩放 2 倍并平移 (100,50) 后仍能映射回同一原图像素',
  viewportToSourcePoint(
    { x: 300, y: 250 },
    { scale: 2, offsetX: 100, offsetY: 50 },
    layer()
  ),
  { x: 100, y: 100 }
)
assertPoint(
  '视口点转画布点（缩放 1.5、平移 30/20）',
  viewportToCanvasPoint(
    { x: 330, y: 320 },
    { scale: 1.5, offsetX: 30, offsetY: 20 }
  ),
  { x: 200, y: 200 }
)

// 3. 图层位移：图层从 (200,100) 开始，画布点先减去图层原点
assertPoint(
  '图层位移 (200,100) 后本地坐标 = 画布坐标 - 图层原点',
  canvasPointToLayerLocal(
    { x: 300, y: 150 },
    layer({ x: 200, y: 100, width: 800, height: 400 })
  ),
  { x: 100, y: 50 }
)

// 4. 图层缩放：局部坐标要按缩放反算
assertPoint(
  '图层缩放 2 倍：中心右侧 100 画布像素 = 本地 50',
  canvasPointToLayerLocal(
    { x: 300, y: 200 },
    layer({ width: 400, height: 400, scale: 2 })
  ),
  { x: 250, y: 200 }
)

// 5. 图层旋转 90°：原本左中位置会转到画布上方中点
assertPoint(
  '图层顺时针旋转 90° 时画布上方中点映射到本地左中',
  canvasPointToLayerLocal(
    { x: 100, y: 0 },
    layer({ width: 200, height: 200, rotation: 90 })
  ),
  { x: 0, y: 100 }
)
assertPoint(
  '旋转后的本地坐标能反算回画布坐标',
  layerLocalToCanvasPoint(
    { x: 0, y: 100 },
    layer({ width: 200, height: 200, rotation: 90 })
  ),
  { x: 100, y: 0 }
)

// 6. 源图裁剪：本地坐标按裁剪窗口比例映射到原图像素
assertPoint(
  '裁剪 (100,50,200x200) 时本地 (200,200) 对应原图 (200,150)',
  viewportToSourcePoint(
    { x: 200, y: 200 },
    identityViewport,
    layer({
      width: 400,
      height: 400,
      crop: { x: 100, y: 50, width: 200, height: 200 },
    })
  ),
  { x: 200, y: 150 }
)

// 7. 组合：视口缩放平移 × 图层位移缩放旋转 × 裁剪，往返必须一致
const combos: Array<{
  label: string
  viewport: Viewport
  layer: TransformableLayer
  point: { x: number; y: number }
}> = [
  {
    label: '视口 2x + 图层位移 + 旋转 30°',
    viewport: { scale: 2, offsetX: -120, offsetY: 64 },
    layer: layer({ x: 300, y: 180, width: 1024, height: 1024, rotation: 30 }),
    point: { x: 820, y: 410 },
  },
  {
    label: '视口 0.37x + 图层缩放 1.8 + 裁剪',
    viewport: { scale: 0.37, offsetX: 15, offsetY: 22 },
    layer: layer({
      x: 40,
      y: 60,
      width: 900,
      height: 600,
      scale: 1.8,
      rotation: -12,
      crop: { x: 120, y: 80, width: 640, height: 420 },
    }),
    point: { x: 210, y: 260 },
  },
  {
    label: '视口 6x + 图层旋转 135° + 窄裁剪',
    viewport: { scale: 6, offsetX: 30, offsetY: -18 },
    layer: layer({
      x: 12,
      y: 24,
      width: 512,
      height: 512,
      scale: 1,
      rotation: 135,
      crop: { x: 0, y: 0, width: 256, height: 128 },
    }),
    point: { x: 180, y: 140 },
  },
]

for (const combo of combos) {
  const source = viewportToSourcePoint(combo.point, combo.viewport, combo.layer)
  const back = sourceToViewportPoint(source, combo.viewport, combo.layer)
  assertPoint(`往返一致：${combo.label}`, back, combo.point, 1e-4)
}

// 8. 画笔半径换算：1 个视口像素等于多少原图像素
assertNumber(
  '视口 2x、图层 0.5x、裁剪 1/2：1 视口像素 = 2 原图像素',
  viewportPixelToSourcePixel(
    { scale: 2, offsetX: 0, offsetY: 0 },
    layer({
      width: 400,
      height: 400,
      scale: 0.5,
      crop: { x: 0, y: 0, width: 200, height: 200 },
    })
  ),
  2
)
assertNumber(
  '无变换时 1 视口像素 = 1 原图像素',
  viewportPixelToSourcePixel(identityViewport, layer()),
  1
)

// 9. 视口自适应：整幅可见且居中，不放大超过 100%
const fitted = fitViewport(2048, 1024, 1200, 800, 40)
assertNumber('自适应缩放取宽高较小者', fitted.scale, (1200 - 80) / 2048)
assertNumber('自适应后水平居中', fitted.offsetX * 2 + 2048 * fitted.scale, 1200)
assertNumber('自适应后垂直居中', fitted.offsetY * 2 + 1024 * fitted.scale, 800)
assertNumber('小画布不放大', fitViewport(100, 100, 1200, 800).scale, 1)

// 10. 以锚点缩放：锚点下的原图像素不移动
const base: Viewport = { scale: 1, offsetX: 40, offsetY: 20 }
const anchor = { x: 300, y: 260 }
const before = viewportToSourcePoint(anchor, base, layer())
const zoomed = zoomViewportAt(base, anchor, 3)
const after = viewportToSourcePoint(anchor, zoomed, layer())
assertPoint('滚轮缩放保持锚点下的像素不动', after, before, 1e-4)
assertNumber(
  '缩放倍率被限制在上限内',
  zoomViewportAt(base, anchor, 999).scale,
  8
)
assertNumber(
  '缩放倍率被限制在下限内',
  zoomViewportAt(base, anchor, 0.0001).scale,
  0.05
)

console.log(`\n共 ${checks} 项断言，失败 ${failures} 项`)
if (failures > 0) {
  process.exit(1)
}
