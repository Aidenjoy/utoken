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
import {
  ArrowUp,
  Box,
  Camera,
  Clapperboard,
  Globe,
  Grid3x3,
  Loader2,
  MousePointer2,
  Orbit,
  PanelRight,
  RotateCcw,
  Sun,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import {
  getCanvasGeneration,
  submitCanvasGeneration,
  uploadCanvasFile,
} from '../api'
import type { CanvasTheme } from '../canvas-theme'
import {
  canvasId,
  type CanvasDirectorCamera,
  type CanvasDirectorState,
  type CanvasNode,
} from '../types'

// ===== 3D 导演台工作台（对齐 BeefTV：机位预设/Inspector/全景背景/截图封面） =====

interface DirectorCameraPreset {
  id: string
  labelKey: string
  offset: [number, number, number]
  focalLength: number
  roll?: number
}

// 机位预设（移植 BeefTV director-camera-presets：相对主体的偏移 + 焦距）
const DIRECTOR_CAMERA_PRESETS: DirectorCameraPreset[] = [
  { id: 'current', labelKey: 'Current view', offset: [0, 0, 0], focalLength: 35 },
  { id: 'front-medium', labelKey: 'Front medium', offset: [0, 0.2, 4.5], focalLength: 50 },
  { id: 'front-close', labelKey: 'Front close-up', offset: [0, 0.25, 2.1], focalLength: 70 },
  { id: 'front-wide', labelKey: 'Front wide', offset: [0, 1.2, 9], focalLength: 28 },
  { id: 'side-follow', labelKey: 'Side follow', offset: [4.5, 0.2, -1.3], focalLength: 50 },
  { id: 'side-close', labelKey: 'Side close', offset: [2.2, 0.2, -0.3], focalLength: 70 },
  { id: 'back-medium', labelKey: 'Back medium', offset: [0, 0.2, -4.5], focalLength: 50 },
  { id: 'top-wide', labelKey: 'Top wide', offset: [0, 8, 3], focalLength: 28 },
  { id: 'top-45', labelKey: 'Top 45°', offset: [0, 5, 5], focalLength: 35 },
  { id: 'low-up', labelKey: 'Low angle up', offset: [0, -0.7, 3.3], focalLength: 50 },
  { id: 'low-wide', labelKey: 'Low angle wide', offset: [0, -0.6, 5], focalLength: 24 },
  { id: 'shoulder-left', labelKey: 'Over shoulder left', offset: [-0.9, 0.1, -1.3], focalLength: 50 },
  { id: 'shoulder-right', labelKey: 'Over shoulder right', offset: [0.9, 0.1, -1.3], focalLength: 50 },
  { id: 'bird-eye', labelKey: 'Bird eye', offset: [0, 12, 0.05], focalLength: 28 },
  { id: 'dutch', labelKey: 'Dutch angle', offset: [0, 0.2, 4.5], focalLength: 50, roll: Math.PI / 8 },
]

const DEFAULT_DIRECTOR_STATE: Required<
  Pick<
    CanvasDirectorState,
    | 'sceneScale'
    | 'scenePan'
    | 'sceneRotation'
    | 'skyColor'
    | 'panoRotation'
    | 'panoRadius'
    | 'showLabels'
    | 'snapToGrid'
    | 'ambient'
    | 'showGrid'
    | 'subjectYaw'
    | 'subjectPos'
  >
> = {
  sceneScale: 100,
  scenePan: [0, 0, 0],
  sceneRotation: [0, 0, 0],
  skyColor: '#060608',
  panoRotation: 0,
  panoRadius: 60,
  showLabels: true,
  snapToGrid: false,
  ambient: 70,
  showGrid: true,
  subjectYaw: 0,
  subjectPos: [0, 0, 0],
}

function focalToFov(focalLength: number): number {
  return (2 * Math.atan(24 / (2 * focalLength)) * 180) / Math.PI
}

interface DirectorEngine {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  stage: THREE.Group
  subject: THREE.Group
  labelSprite: THREE.Sprite
  grid: THREE.GridHelper
  ambient: THREE.AmbientLight
  panoMesh: THREE.Mesh
  panoMat: THREE.MeshBasicMaterial
  markers: Map<string, THREE.Group>
  gizmoScene: THREE.Scene
  gizmoCam: THREE.PerspectiveCamera
  raycaster: THREE.Raycaster
  groundPlane: THREE.Plane
  frame: number
}

interface CanvasDirectorWorkspaceProps {
  node: CanvasNode
  theme: CanvasTheme
  projectId: number
  imageModelConfigured: boolean
  references: { id: string; title: string; url: string }[]
  saveState: 'saved' | 'saving' | 'dirty'
  onClose: () => void
  onPatchDirector: (state: CanvasDirectorState) => void
  onBeginEdit: () => void
  onEndEdit: () => void
  onOpenSettings: () => void
}

export function CanvasDirectorWorkspace(props: CanvasDirectorWorkspaceProps) {
  const {
    node,
    theme,
    projectId,
    imageModelConfigured,
    references,
    saveState,
    onClose,
    onPatchDirector,
    onBeginEdit,
    onEndEdit,
    onOpenSettings,
  } = props
  const { t } = useTranslation()

  const [state, setState] = React.useState<CanvasDirectorState>(
    () => node.metadata.director ?? {}
  )
  const stateRef = React.useRef(state)
  const [selectedCameraId, setSelectedCameraId] = React.useState<string | null>(
    null
  )
  const selectedCameraRef = React.useRef<string | null>(null)
  const [viewMode, setViewMode] = React.useState<'director' | 'camera'>(
    'director'
  )
  const viewModeRef = React.useRef(viewMode)
  const [tool, setTool] = React.useState<'select' | 'orbit'>('select')
  const toolRef = React.useRef(tool)
  const [inspectorOpen, setInspectorOpen] = React.useState(true)
  const [scenePrompt, setScenePrompt] = React.useState('')
  const [generatingPano, setGeneratingPano] = React.useState(false)
  const [capturing, setCapturing] = React.useState(false)

  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const engineRef = React.useRef<DirectorEngine | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const panoAliveRef = React.useRef(true)
  const inspectorRefs = React.useRef<Record<string, HTMLDivElement | null>>({})

  const patch = (partial: Partial<CanvasDirectorState>) => {
    const next = { ...stateRef.current, ...partial }
    stateRef.current = next
    setState(next)
    onPatchDirector(next)
  }

  const get = <K extends keyof typeof DEFAULT_DIRECTOR_STATE>(
    key: K
  ): (typeof DEFAULT_DIRECTOR_STATE)[K] =>
    (stateRef.current[key] ?? DEFAULT_DIRECTOR_STATE[key]) as (typeof DEFAULT_DIRECTOR_STATE)[K]

  // 打开期间的所有调整合并为单步撤销
  React.useEffect(() => {
    onBeginEdit()
    panoAliveRef.current = true
    return () => {
      panoAliveRef.current = false
      onEndEdit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  React.useEffect(() => {
    viewModeRef.current = viewMode
    const engine = engineRef.current
    if (engine) {
      engine.controls.enabled = viewMode === 'director'
      if (viewMode === 'director') {
        const subjectWorld = new THREE.Vector3()
        engine.subject.getWorldPosition(subjectWorld)
        engine.controls.target.set(subjectWorld.x, subjectWorld.y + 1, subjectWorld.z)
      }
    }
  }, [viewMode])

  React.useEffect(() => {
    toolRef.current = tool
  }, [tool])

  React.useEffect(() => {
    selectedCameraRef.current = selectedCameraId
  }, [selectedCameraId])

  // ----- three.js 初始化（单 rAF 循环 + 阻尼轨道 + 轴球 gizmo） -----
  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.autoClear = false
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(get('skyColor'))
    scene.fog = new THREE.Fog(get('skyColor'), 40, 160)

    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / Math.max(1, container.clientHeight),
      0.1,
      600
    )
    camera.position.set(0, 2.4, 6.5)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.target.set(0, 1, 0)
    controls.minDistance = 0.8
    controls.maxDistance = 120
    controls.maxPolarAngle = Math.PI - 0.04

    // 灯光：暖主光 + 冷轮廓光 + 补光
    const ambient = new THREE.AmbientLight(0xffffff, 0.7)
    const keyLight = new THREE.DirectionalLight(0xfff1dd, 2.4)
    keyLight.position.set(5, 9, 4)
    keyLight.castShadow = true
    keyLight.shadow.mapSize.set(1024, 1024)
    keyLight.shadow.camera.left = -12
    keyLight.shadow.camera.right = 12
    keyLight.shadow.camera.top = 12
    keyLight.shadow.camera.bottom = -12
    const rimLight = new THREE.DirectionalLight(0x5f8dff, 1.4)
    rimLight.position.set(-6, 4, -7)
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.35)
    fillLight.position.set(0, 3, -8)
    scene.add(ambient, keyLight, rimLight, fillLight)

    // 舞台：地面 + 网格 + 主体（受场景缩放/平移/旋转控制）
    const stage = new THREE.Group()
    scene.add(stage)
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(60, 64),
      new THREE.MeshStandardMaterial({ color: 0x0e0e15, roughness: 0.95 })
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.02
    ground.receiveShadow = true
    stage.add(ground)
    const grid = new THREE.GridHelper(60, 60, 0x3a3a55, 0x1c1c2c)
    stage.add(grid)

    const subject = new THREE.Group()
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x8b93ff,
      roughness: 0.45,
      metalness: 0.1,
    })
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.85, 8, 16), bodyMat)
    body.position.y = 0.95
    body.castShadow = true
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 24, 16), bodyMat)
    head.position.y = 1.78
    head.castShadow = true
    const baseRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.02, 8, 48),
      new THREE.MeshBasicMaterial({ color: 0x8b93ff })
    )
    baseRing.rotation.x = -Math.PI / 2
    baseRing.position.y = 0.01
    subject.add(body, head, baseRing)
    const initialPos = get('subjectPos')
    subject.position.set(initialPos[0], initialPos[1], initialPos[2])
    subject.rotation.y = (get('subjectYaw') * Math.PI) / 180
    stage.add(subject)

    // 主体标签（canvas 纹理 sprite）
    const labelCanvas = document.createElement('canvas')
    labelCanvas.width = 256
    labelCanvas.height = 64
    const labelCtx = labelCanvas.getContext('2d')
    if (labelCtx) {
      labelCtx.fillStyle = 'rgba(10,10,16,.85)'
      labelCtx.beginPath()
      labelCtx.roundRect(4, 8, 248, 48, 12)
      labelCtx.fill()
      labelCtx.fillStyle = '#e6e8ff'
      labelCtx.font = '600 26px sans-serif'
      labelCtx.textAlign = 'center'
      labelCtx.textBaseline = 'middle'
      labelCtx.fillText(node.title.slice(0, 16), 128, 33)
    }
    const labelTexture = new THREE.CanvasTexture(labelCanvas)
    const labelSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: labelTexture, depthTest: false })
    )
    labelSprite.scale.set(1.7, 0.42, 1)
    labelSprite.position.y = 2.35
    subject.add(labelSprite)

    // 全景球（半径 1，按 panoRadius 缩放）
    const panoMat = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      fog: false,
    })
    const panoMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), panoMat)
    panoMesh.visible = false
    scene.add(panoMesh)

    // 轴球 gizmo
    const gizmoScene = new THREE.Scene()
    const axisLen = 1.1
    gizmoScene.add(
      new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), axisLen, 0xff5f6d, 0.28, 0.16),
      new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), axisLen, 0x4ade80, 0.28, 0.16),
      new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), axisLen, 0x60a5fa, 0.28, 0.16)
    )
    const gizmoCam = new THREE.PerspectiveCamera(50, 1, 0.1, 20)

    const engine: DirectorEngine = {
      renderer,
      scene,
      camera,
      controls,
      stage,
      subject,
      labelSprite,
      grid,
      ambient,
      panoMesh,
      panoMat,
      markers: new Map(),
      gizmoScene,
      gizmoCam,
      raycaster: new THREE.Raycaster(),
      groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      frame: 0,
    }
    engineRef.current = engine

    // ----- 指针交互：点选机位 / 拖拽主体 -----
    const pointer = new THREE.Vector2()
    let draggingSubject = false
    const setPointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || toolRef.current !== 'select') return
      if (viewModeRef.current === 'camera') return
      setPointer(event)
      engine.raycaster.setFromCamera(pointer, camera)
      const markerObjects = [...engine.markers.values()]
      const markerHits = engine.raycaster.intersectObjects(markerObjects, true)
      if (markerHits.length > 0) {
        let obj: THREE.Object3D | null = markerHits[0].object
        while (obj && !obj.userData.cameraId) obj = obj.parent
        if (obj?.userData.cameraId) {
          setSelectedCameraId(obj.userData.cameraId as string)
          return
        }
      }
      const subjectHits = engine.raycaster.intersectObject(subject, true)
      if (subjectHits.length > 0) {
        draggingSubject = true
        controls.enabled = false
        renderer.domElement.setPointerCapture(event.pointerId)
      }
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!draggingSubject) return
      setPointer(event)
      engine.raycaster.setFromCamera(pointer, camera)
      const hit = new THREE.Vector3()
      if (engine.raycaster.ray.intersectPlane(engine.groundPlane, hit)) {
        // 舞台可能缩放/平移，换算回舞台局部坐标
        stage.worldToLocal(hit)
        let x = hit.x
        let z = hit.z
        if (stateRef.current.snapToGrid) {
          x = Math.round(x * 2) / 2
          z = Math.round(z * 2) / 2
        }
        subject.position.x = x
        subject.position.z = z
      }
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!draggingSubject) return
      draggingSubject = false
      controls.enabled = viewModeRef.current === 'director'
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId)
      }
      const next = { ...stateRef.current }
      next.subjectPos = [subject.position.x, 0, subject.position.z]
      stateRef.current = next
      setState(next)
      onPatchDirector(next)
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointercancel', onPointerUp)

    const resizeObserver = new ResizeObserver(() => {
      const width = container.clientWidth
      const height = Math.max(1, container.clientHeight)
      renderer.setSize(width, height)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    })
    resizeObserver.observe(container)

    const renderCam = new THREE.PerspectiveCamera()
    const loop = () => {
      engine.frame = requestAnimationFrame(loop)
      const s = stateRef.current
      const scale = (s.sceneScale ?? 100) / 100
      stage.scale.setScalar(scale)
      const pan = s.scenePan ?? [0, 0, 0]
      stage.position.set(pan[0], pan[1], pan[2])
      const rot = s.sceneRotation ?? [0, 0, 0]
      stage.rotation.set(
        (rot[0] * Math.PI) / 180,
        (rot[1] * Math.PI) / 180,
        (rot[2] * Math.PI) / 180
      )
      subject.rotation.y = ((s.subjectYaw ?? 0) * Math.PI) / 180
      ambient.intensity = (s.ambient ?? 70) / 100
      grid.visible = s.showGrid ?? true
      labelSprite.visible = s.showLabels ?? true
      panoMesh.rotation.y = ((s.panoRotation ?? 0) * Math.PI) / 180
      panoMesh.scale.setScalar(s.panoRadius ?? 60)
      controls.update()

      // 机位视角：用选中机位参数驱动渲染相机
      let activeCam: THREE.PerspectiveCamera = camera
      const selectedId = selectedCameraRef.current
      if (viewModeRef.current === 'camera' && selectedId) {
        const cam = (s.cameras ?? []).find((c) => c.id === selectedId)
        if (cam) {
          renderCam.aspect = camera.aspect
          renderCam.near = 0.1
          renderCam.far = 600
          renderCam.fov = focalToFov(cam.focalLength)
          renderCam.position.set(...cam.position)
          renderCam.up.set(0, 1, 0)
          renderCam.lookAt(new THREE.Vector3(...cam.target))
          if (cam.roll) renderCam.rotateZ(cam.roll)
          renderCam.updateProjectionMatrix()
          activeCam = renderCam
        }
      }

      const width = container.clientWidth
      const height = Math.max(1, container.clientHeight)
      renderer.setScissorTest(false)
      renderer.setViewport(0, 0, width, height)
      renderer.clear()
      renderer.render(scene, activeCam)

      // 右上角轴球
      const gizmoSize = 88
      const gx = width - gizmoSize - 12
      const gy = height - gizmoSize - 12
      gizmoCam.position.set(0, 0, 3.4).applyQuaternion(activeCam.quaternion)
      gizmoCam.up.copy(activeCam.up)
      gizmoCam.lookAt(0, 0, 0)
      renderer.setScissorTest(true)
      renderer.setScissor(gx, gy, gizmoSize, gizmoSize)
      renderer.setViewport(gx, gy, gizmoSize, gizmoSize)
      renderer.clearDepth()
      renderer.render(gizmoScene, gizmoCam)
      renderer.setScissorTest(false)
    }
    engine.frame = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(engine.frame)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointercancel', onPointerUp)
      controls.dispose()
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
          obj.geometry?.dispose()
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
          materials.forEach((material) => {
            const mat = material as THREE.MeshBasicMaterial
            mat.map?.dispose()
            mat.dispose()
          })
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
      engineRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ----- 机位 marker 重建 -----
  React.useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.markers.forEach((marker) => {
      engine.scene.remove(marker)
      marker.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          ;(obj.material as THREE.Material).dispose()
        }
      })
    })
    engine.markers.clear()
    const cameras = state.cameras ?? []
    cameras.forEach((cam) => {
      const active = cam.id === selectedCameraId
      const color = active ? 0xffc24d : 0x9aa3c0
      const group = new THREE.Group()
      group.userData.cameraId = cam.id
      const bodyMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.24, 0.17, 0.32),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4 })
      )
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.07, 0.09, 0.14, 16),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4 })
      )
      lens.rotation.x = Math.PI / 2
      lens.position.z = -0.22
      group.add(bodyMesh, lens)
      group.position.set(...cam.position)
      group.lookAt(new THREE.Vector3(...cam.target))
      if (cam.roll) group.rotateZ(cam.roll)
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(...cam.position),
        new THREE.Vector3(...cam.target),
      ])
      const line = new THREE.Line(
        lineGeo,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 })
      )
      line.userData.cameraId = cam.id
      engine.scene.add(group, line)
      engine.markers.set(cam.id, group)
      group.userData.line = line
    })
    // 清理时把连线一并移除
    const markers = engine.markers
    return () => {
      markers.forEach((marker) => {
        const line = marker.userData.line as THREE.Line | undefined
        if (line) {
          engine.scene.remove(line)
          line.geometry.dispose()
          ;(line.material as THREE.Material).dispose()
        }
      })
    }
  }, [state.cameras, selectedCameraId])

  // ----- 全景纹理 -----
  React.useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    const url = state.panoramaUrl
    if (!url) {
      engine.panoMesh.visible = false
      return
    }
    let cancelled = false
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      url,
      (texture) => {
        if (cancelled) {
          texture.dispose()
          return
        }
        texture.colorSpace = THREE.SRGBColorSpace
        engine.panoMat.map?.dispose()
        engine.panoMat.map = texture
        engine.panoMat.needsUpdate = true
        engine.panoMesh.visible = true
      },
      undefined,
      () => {
        if (!cancelled) toast.error(t('Failed to load panorama image'))
      }
    )
    return () => {
      cancelled = true
    }
  }, [state.panoramaUrl, t])

  // ----- 天空颜色 -----
  React.useEffect(() => {
    const engine = engineRef.current
    if (!engine) return
    const color = new THREE.Color(state.skyColor ?? '#060608')
    engine.scene.background = color
    if (engine.scene.fog instanceof THREE.Fog) engine.scene.fog.color.copy(color)
  }, [state.skyColor])

  const addCamera = (preset: DirectorCameraPreset) => {
    const engine = engineRef.current
    const subjectWorld = new THREE.Vector3()
    if (engine) engine.subject.getWorldPosition(subjectWorld)
    else subjectWorld.set(...get('subjectPos'))
    const target = new THREE.Vector3(
      subjectWorld.x,
      subjectWorld.y + 1.1,
      subjectWorld.z
    )
    let position: THREE.Vector3
    if (preset.id === 'current' && engine) {
      position = engine.camera.position.clone()
    } else {
      const offset = new THREE.Vector3(...preset.offset)
      offset.applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        (get('subjectYaw') * Math.PI) / 180
      )
      position = target.clone().add(offset)
    }
    const camera: CanvasDirectorCamera = {
      id: canvasId('cam'),
      presetId: preset.id,
      label: t(preset.labelKey),
      position: [position.x, position.y, position.z],
      target: [target.x, target.y, target.z],
      focalLength: preset.focalLength,
      roll: preset.roll,
    }
    const cameras = [...(stateRef.current.cameras ?? []), camera]
    patch({ cameras })
    setSelectedCameraId(camera.id)
  }

  const removeCamera = (id: string) => {
    patch({
      cameras: (stateRef.current.cameras ?? []).filter((cam) => cam.id !== id),
    })
    if (selectedCameraRef.current === id) {
      setSelectedCameraId(null)
      setViewMode('director')
    }
  }

  const updateCamera = (id: string, partial: Partial<CanvasDirectorCamera>) => {
    patch({
      cameras: (stateRef.current.cameras ?? []).map((cam) =>
        cam.id === id ? { ...cam, ...partial } : cam
      ),
    })
  }

  const resetView = () => {
    const engine = engineRef.current
    if (!engine) return
    setViewMode('director')
    engine.camera.position.set(0, 2.4, 6.5)
    engine.controls.target.set(0, 1, 0)
  }

  // 截图 → 上传 → 节点封面
  const captureCover = async () => {
    const engine = engineRef.current
    if (!engine || capturing) return
    setCapturing(true)
    try {
      engine.renderer.render(engine.scene, engine.camera)
      const dataUrl = engine.renderer.domElement.toDataURL('image/png')
      const blob = await (await fetch(dataUrl)).blob()
      const file = new File([blob], `director-cover-${Date.now()}.png`, {
        type: 'image/png',
      })
      const res = await uploadCanvasFile(file)
      if (res.success && res.data?.url) {
        patch({ coverUrl: res.data.url })
        toast.success(t('Cover saved'))
      } else {
        toast.error(res.message || t('Failed to save cover'))
      }
    } catch {
      toast.error(t('Failed to save cover'))
    } finally {
      setCapturing(false)
    }
  }

  const uploadPanorama = async (file: File) => {
    try {
      const res = await uploadCanvasFile(file)
      if (res.success && res.data?.url) patch({ panoramaUrl: res.data.url })
      else toast.error(res.message || t('Upload failed'))
    } catch {
      // 全局拦截器已提示
    }
  }

  // 全景生成：组件内自行轮询，不占用节点 loading（避免编辑器轮询接管）
  const generatePanorama = async () => {
    const prompt = scenePrompt.trim()
    if (!prompt || generatingPano) return
    if (!imageModelConfigured) {
      onOpenSettings()
      return
    }
    setGeneratingPano(true)
    try {
      const res = await submitCanvasGeneration({
        projectId,
        nodeId: node.id,
        kind: 'image',
        prompt: `Seamless 360 degree equirectangular panorama environment: ${prompt}. Full spherical coverage, cinematic lighting, no text.`,
        size: '2560x1440',
      })
      if (!res.success || !res.data) {
        toast.error(res.message || t('Generation failed'))
        return
      }
      const generationId = res.data.generationId
      for (let i = 0; i < 150; i += 1) {
        if (!panoAliveRef.current) return
        await new Promise((resolve) => setTimeout(resolve, 2000))
        if (!panoAliveRef.current) return
        const poll = await getCanvasGeneration(generationId)
        const gen = poll.data
        if (!poll.success || !gen) continue
        if (gen.status === 'success') {
          patch({ panoramaUrl: gen.resultUrl })
          toast.success(t('Panorama generated'))
          return
        }
        if (gen.status === 'failed' || gen.status === 'cancelled') {
          toast.error(gen.errorMsg || t('Generation failed'))
          return
        }
      }
      toast.error(t('Generation timed out'))
    } catch {
      // 全局拦截器已提示
    } finally {
      if (panoAliveRef.current) setGeneratingPano(false)
    }
  }

  const cameras = state.cameras ?? []
  const selectedCamera =
    cameras.find((cam) => cam.id === selectedCameraId) ?? null
  let saveLabel = t('Saved')
  if (saveState === 'saving') saveLabel = t('Saving...')
  else if (saveState === 'dirty') saveLabel = t('Unsaved changes')
  const panelBg = theme.toolbar.panel
  const border = `1px solid ${theme.toolbar.border}`
  const sectionTitle = 'px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide'

  const renderSlider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void,
    suffix = ''
  ) => (
    <label className='flex items-center gap-2 px-3 py-1 text-[11px]'>
      <span className='w-24 shrink-0' style={{ color: theme.node.muted }}>
        {label}
      </span>
      <input
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className='min-w-0 flex-1 accent-current'
        style={{ color: theme.accent.primary }}
        aria-label={label}
      />
      <span
        className='w-12 shrink-0 text-right tabular-nums'
        style={{ color: theme.node.text }}
      >
        {value}
        {suffix}
      </span>
    </label>
  )

  const renderToggle = (
    label: string,
    value: boolean,
    onChange: (value: boolean) => void
  ) => (
    <label className='flex cursor-pointer items-center justify-between px-3 py-1.5 text-[11px]'>
      <span style={{ color: theme.node.muted }}>{label}</span>
      <button
        type='button'
        role='switch'
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className='relative h-4.5 w-8 rounded-full transition-colors'
        style={{
          background: value ? theme.accent.primary : theme.node.stroke,
        }}
      >
        <span
          className='absolute top-0.5 size-3.5 rounded-full bg-white transition-all'
          style={{ left: value ? 'calc(100% - 16px)' : '2px' }}
        />
      </button>
    </label>
  )

  const renderAxisInputs = (
    label: string,
    value: [number, number, number],
    onChange: (value: [number, number, number]) => void
  ) => (
    <div className='flex items-center gap-1.5 px-3 py-1 text-[11px]'>
      <span className='w-24 shrink-0' style={{ color: theme.node.muted }}>
        {label}
      </span>
      {(['X', 'Y', 'Z'] as const).map((axis, index) => (
        <label key={axis} className='flex min-w-0 flex-1 items-center gap-0.5'>
          <span className='text-[9px]' style={{ color: theme.node.faint }}>
            {axis}
          </span>
          <input
            type='number'
            step={0.1}
            value={value[index]}
            onChange={(event) => {
              const next = [...value] as [number, number, number]
              const parsed = Number(event.target.value)
              next[index] = Number.isFinite(parsed) ? parsed : 0
              onChange(next)
            }}
            aria-label={`${label} ${axis}`}
            className='h-6 w-full min-w-0 rounded-md px-1 text-[10px] tabular-nums outline-none'
            style={{
              background: theme.node.panel,
              color: theme.node.text,
              border: `1px solid ${theme.node.stroke}`,
            }}
          />
        </label>
      ))}
    </div>
  )

  const scrollToSection = (key: string) => {
    setInspectorOpen(true)
    requestAnimationFrame(() => {
      inspectorRefs.current[key]?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  const railItems = [
    { id: 'scene', icon: Box, label: t('Scene'), section: 'scene' },
    { id: 'cameras', icon: Camera, label: t('Cameras'), section: 'cameras' },
    { id: 'panorama', icon: Globe, label: t('Panorama'), section: 'panorama' },
    { id: 'lighting', icon: Sun, label: t('Lighting'), section: 'lighting' },
    { id: 'grid', icon: Grid3x3, label: t('Grid & snap'), section: 'display' },
    { id: 'labels', icon: Tag, label: t('Labels'), section: 'display' },
  ]

  const toolButtonClass =
    'flex size-8 items-center justify-center rounded-lg transition-colors'

  return (
    <div
      data-canvas-no-zoom
      className='fixed inset-0 z-[120] flex flex-col'
      style={{ background: theme.canvas.background, color: theme.node.text }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {/* 顶栏 */}
      <div
        className='flex h-12 shrink-0 items-center gap-2 px-3'
        style={{ borderBottom: border, background: panelBg }}
      >
        <button
          type='button'
          onClick={onClose}
          className={toolButtonClass}
          style={{ color: theme.node.muted }}
          aria-label={t('Close director studio')}
          title={t('Close director studio')}
        >
          <X aria-hidden='true' className='size-4' />
        </button>
        <Clapperboard
          aria-hidden='true'
          className='size-4'
          style={{ color: theme.accent.primary }}
        />
        <span className='text-sm font-semibold'>{t('3D Director Studio')}</span>
        <span className='text-[10px]' style={{ color: theme.node.faint }}>
          {saveLabel}
        </span>
        <button
          type='button'
          onClick={() => setInspectorOpen((prev) => !prev)}
          className={`${toolButtonClass} ml-auto`}
          style={{
            color: inspectorOpen ? theme.accent.primary : theme.node.muted,
          }}
          aria-label={t('Toggle inspector')}
          title={t('Toggle inspector')}
        >
          <PanelRight aria-hidden='true' className='size-4' />
        </button>
      </div>

      <div className='flex min-h-0 flex-1'>
        {/* 左侧图标 rail */}
        <div
          className='flex w-11 shrink-0 flex-col items-center gap-1 py-2'
          style={{ borderRight: border, background: panelBg }}
        >
          {railItems.map((item) => (
            <button
              key={item.id}
              type='button'
              onClick={() => scrollToSection(item.section)}
              className={toolButtonClass}
              style={{ color: theme.node.muted }}
              aria-label={item.label}
              title={item.label}
            >
              <item.icon aria-hidden='true' className='size-4' />
            </button>
          ))}
        </div>

        {/* 机位预设 dock */}
        <div
          className='canvas-scroll flex w-48 shrink-0 flex-col overflow-y-auto py-2'
          style={{ borderRight: border, background: panelBg }}
          data-canvas-wheel-scroll
        >
          <p className={sectionTitle} style={{ color: theme.node.faint }}>
            {t('Add camera')}
          </p>
          {DIRECTOR_CAMERA_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type='button'
              onClick={() => addCamera(preset)}
              className='mx-2 flex h-7 items-center gap-1.5 rounded-md px-2 text-left text-[11px] transition-colors'
              style={{ color: theme.node.muted }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = theme.toolbar.itemHover
                event.currentTarget.style.color = theme.node.text
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = 'transparent'
                event.currentTarget.style.color = theme.node.muted
              }}
            >
              <Camera aria-hidden='true' className='size-3 shrink-0' />
              {t(preset.labelKey)}
            </button>
          ))}
          {cameras.length > 0 && (
            <>
              <p className={sectionTitle} style={{ color: theme.node.faint }}>
                {t('Cameras')} ({cameras.length})
              </p>
              {cameras.map((cam) => (
                <div
                  key={cam.id}
                  className='mx-2 flex h-7 items-center gap-1 rounded-md px-2 text-[11px]'
                  style={{
                    background:
                      cam.id === selectedCameraId
                        ? theme.accent.primarySoft
                        : 'transparent',
                    color:
                      cam.id === selectedCameraId
                        ? theme.node.text
                        : theme.node.muted,
                  }}
                >
                  <button
                    type='button'
                    onClick={() => setSelectedCameraId(cam.id)}
                    className='min-w-0 flex-1 truncate text-left'
                    title={cam.label}
                  >
                    {cam.label}
                  </button>
                  <button
                    type='button'
                    onClick={() => removeCamera(cam.id)}
                    className='flex size-5 shrink-0 items-center justify-center rounded'
                    style={{ color: theme.accent.danger }}
                    aria-label={t('Delete camera')}
                    title={t('Delete camera')}
                  >
                    <Trash2 aria-hidden='true' className='size-3' />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        {/* 3D 视口 */}
        <div className='relative min-w-0 flex-1'>
          <div ref={containerRef} className='absolute inset-0' />
          <div
            className='absolute top-3 left-1/2 flex -translate-x-1/2 rounded-full p-0.5'
            style={{ background: panelBg, border }}
          >
            {(
              [
                { value: 'director', label: t('Director view') },
                { value: 'camera', label: t('Camera view') },
              ] as const
            ).map((option) => (
              <button
                key={option.value}
                type='button'
                disabled={option.value === 'camera' && !selectedCamera}
                onClick={() => setViewMode(option.value)}
                className='flex h-6 items-center rounded-full px-3 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40'
                style={
                  viewMode === option.value
                    ? {
                        background: theme.accent.primary,
                        color: theme.accent.onPrimary,
                      }
                    : { color: theme.node.muted }
                }
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type='button'
            onClick={resetView}
            className='absolute top-28 right-3 flex h-7 items-center gap-1 rounded-lg px-2 text-[11px]'
            style={{ background: panelBg, border, color: theme.node.muted }}
          >
            <RotateCcw aria-hidden='true' className='size-3' />
            {t('Reset view')}
          </button>
          {viewMode === 'camera' && selectedCamera && (
            <div
              className='absolute bottom-3 left-3 rounded-lg px-2.5 py-1 text-[11px]'
              style={{ background: panelBg, border, color: theme.node.text }}
            >
              {selectedCamera.label} · {selectedCamera.focalLength}mm
            </div>
          )}
        </div>

        {/* Inspector */}
        {inspectorOpen && (
          <div
            className='canvas-scroll w-72 shrink-0 overflow-y-auto pb-4'
            style={{ borderLeft: border, background: panelBg }}
            data-canvas-wheel-scroll
          >
            <div
              className='px-3 py-2.5 text-xs font-semibold'
              style={{ borderBottom: border }}
            >
              {t('3D Scene')}
            </div>

            <div
              ref={(el) => {
                inspectorRefs.current.scene = el
              }}
            >
              <p className={sectionTitle} style={{ color: theme.node.faint }}>
                {t('Scene')}
              </p>
              {renderSlider(
                t('Scene scale'),
                state.sceneScale ?? 100,
                10,
                300,
                1,
                (value) => patch({ sceneScale: value }),
                '%'
              )}
              {renderAxisInputs(
                t('Scene pan'),
                state.scenePan ?? [0, 0, 0],
                (value) => patch({ scenePan: value })
              )}
              {renderAxisInputs(
                t('Scene rotation'),
                state.sceneRotation ?? [0, 0, 0],
                (value) => patch({ sceneRotation: value })
              )}
              {renderSlider(
                t('Subject yaw'),
                state.subjectYaw ?? 0,
                -180,
                180,
                1,
                (value) => patch({ subjectYaw: value }),
                '°'
              )}
            </div>

            <div
              ref={(el) => {
                inspectorRefs.current.panorama = el
              }}
            >
              <p className={sectionTitle} style={{ color: theme.node.faint }}>
                {t('Panorama background')}
              </p>
              <div className='px-3 pb-1'>
                {state.panoramaUrl ? (
                  <div
                    className='relative h-20 overflow-hidden rounded-lg'
                    style={{ border: `1px solid ${theme.node.stroke}` }}
                  >
                    <img
                      src={state.panoramaUrl}
                      alt={t('Panorama background')}
                      className='size-full object-cover'
                      draggable={false}
                    />
                    <button
                      type='button'
                      onClick={() => patch({ panoramaUrl: undefined })}
                      className='absolute top-1 right-1 flex size-5 items-center justify-center rounded bg-black/60 text-white'
                      aria-label={t('Remove panorama')}
                      title={t('Remove panorama')}
                    >
                      <X aria-hidden='true' className='size-3' />
                    </button>
                  </div>
                ) : (
                  <p className='text-[11px]' style={{ color: theme.node.muted }}>
                    {t('No panorama added yet')}
                  </p>
                )}
                <p
                  className='pt-1 text-[10px] leading-relaxed'
                  style={{ color: theme.node.faint }}
                >
                  {t(
                    'Upload or pick an image from the left, or describe a scene below to generate one.'
                  )}
                </p>
                <div className='flex flex-wrap items-center gap-1 pt-1.5'>
                  <button
                    type='button'
                    onClick={() => fileInputRef.current?.click()}
                    className='flex h-7 items-center gap-1 rounded-md px-2 text-[10px]'
                    style={{
                      border: `1px solid ${theme.node.stroke}`,
                      color: theme.node.muted,
                    }}
                  >
                    <Upload aria-hidden='true' className='size-3' />
                    {t('Upload')}
                  </button>
                  {references.map((ref) => (
                    <button
                      key={ref.id}
                      type='button'
                      onClick={() => patch({ panoramaUrl: ref.url })}
                      className='size-7 overflow-hidden rounded-md'
                      style={{ border: `1px solid ${theme.node.stroke}` }}
                      title={ref.title}
                      aria-label={ref.title}
                    >
                      <img
                        src={ref.url}
                        alt={ref.title}
                        className='size-full object-cover'
                        draggable={false}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <label className='flex items-center justify-between px-3 py-1 text-[11px]'>
                <span style={{ color: theme.node.muted }}>
                  {t('Sky color')}
                </span>
                <input
                  type='color'
                  value={state.skyColor ?? '#060608'}
                  onChange={(event) => patch({ skyColor: event.target.value })}
                  aria-label={t('Sky color')}
                  className='h-6 w-12 cursor-pointer rounded border-none bg-transparent'
                />
              </label>
              {renderSlider(
                t('Pano rotation'),
                state.panoRotation ?? 0,
                -180,
                180,
                1,
                (value) => patch({ panoRotation: value }),
                '°'
              )}
              {renderSlider(
                t('Sphere radius'),
                state.panoRadius ?? 60,
                20,
                120,
                1,
                (value) => patch({ panoRadius: value })
              )}
            </div>

            <div
              ref={(el) => {
                inspectorRefs.current.cameras = el
              }}
            >
              <p className={sectionTitle} style={{ color: theme.node.faint }}>
                {t('Cameras')}
              </p>
              {selectedCamera ? (
                <>
                  {renderSlider(
                    t('Focal length'),
                    selectedCamera.focalLength,
                    18,
                    135,
                    1,
                    (value) =>
                      updateCamera(selectedCamera.id, { focalLength: value }),
                    'mm'
                  )}
                  {renderSlider(
                    t('Roll'),
                    Math.round(
                      ((selectedCamera.roll ?? 0) * 180) / Math.PI
                    ),
                    -45,
                    45,
                    1,
                    (value) =>
                      updateCamera(selectedCamera.id, {
                        roll: (value * Math.PI) / 180,
                      }),
                    '°'
                  )}
                </>
              ) : (
                <p
                  className='px-3 pb-1 text-[10px]'
                  style={{ color: theme.node.faint }}
                >
                  {t('Select a camera to adjust its lens.')}
                </p>
              )}
            </div>

            <div
              ref={(el) => {
                inspectorRefs.current.lighting = el
              }}
            >
              <p className={sectionTitle} style={{ color: theme.node.faint }}>
                {t('Lighting')}
              </p>
              {renderSlider(
                t('Ambient light'),
                state.ambient ?? 70,
                0,
                100,
                1,
                (value) => patch({ ambient: value }),
                '%'
              )}
            </div>

            <div
              ref={(el) => {
                inspectorRefs.current.display = el
              }}
            >
              <p className={sectionTitle} style={{ color: theme.node.faint }}>
                {t('Display')}
              </p>
              {renderToggle(t('Show grid'), state.showGrid ?? true, (value) =>
                patch({ showGrid: value })
              )}
              {renderToggle(
                t('Snap to grid'),
                state.snapToGrid ?? false,
                (value) => patch({ snapToGrid: value })
              )}
              {renderToggle(
                t('Character labels'),
                state.showLabels ?? true,
                (value) => patch({ showLabels: value })
              )}
            </div>
          </div>
        )}
      </div>

      {/* 底部工具 + 场景描述 composer */}
      <div
        className='flex shrink-0 items-center gap-2 px-3 py-2.5'
        style={{ borderTop: border, background: panelBg }}
      >
        <button
          type='button'
          onClick={() => setTool('select')}
          className={toolButtonClass}
          style={{
            background:
              tool === 'select' ? theme.accent.primarySoft : 'transparent',
            color: tool === 'select' ? theme.node.text : theme.node.muted,
          }}
          aria-label={t('Select / move subject')}
          title={t('Select / move subject')}
        >
          <MousePointer2 aria-hidden='true' className='size-4' />
        </button>
        <button
          type='button'
          onClick={() => setTool('orbit')}
          className={toolButtonClass}
          style={{
            background:
              tool === 'orbit' ? theme.accent.primarySoft : 'transparent',
            color: tool === 'orbit' ? theme.node.text : theme.node.muted,
          }}
          aria-label={t('Orbit camera')}
          title={t('Orbit camera')}
        >
          <Orbit aria-hidden='true' className='size-4' />
        </button>
        <button
          type='button'
          disabled={capturing}
          onClick={() => void captureCover()}
          className={toolButtonClass}
          style={{ color: theme.node.muted }}
          aria-label={t('Capture cover')}
          title={t('Capture cover')}
        >
          {capturing ? (
            <Loader2 aria-hidden='true' className='size-4 animate-spin' />
          ) : (
            <Clapperboard aria-hidden='true' className='size-4' />
          )}
        </button>
        <input
          value={scenePrompt}
          onChange={(event) => setScenePrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void generatePanorama()
          }}
          placeholder={t('Describe the scene you want to build')}
          aria-label={t('Describe the scene you want to build')}
          className='h-9 min-w-0 flex-1 rounded-xl bg-transparent px-3 text-xs outline-none'
          style={{
            color: theme.node.text,
            border: `1px solid ${theme.node.stroke}`,
          }}
        />
        <button
          type='button'
          disabled={!scenePrompt.trim() || generatingPano}
          onClick={() => void generatePanorama()}
          className='flex size-9 shrink-0 items-center justify-center rounded-full transition-opacity disabled:cursor-not-allowed disabled:opacity-40'
          style={{
            background: theme.accent.primary,
            color: theme.accent.onPrimary,
          }}
          aria-label={t('Generate panorama')}
          title={t('Generate panorama')}
        >
          {generatingPano ? (
            <Loader2 aria-hidden='true' className='size-4 animate-spin' />
          ) : (
            <ArrowUp aria-hidden='true' className='size-4' />
          )}
        </button>
      </div>
      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
        className='hidden'
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void uploadPanorama(file)
          event.target.value = ''
        }}
      />
    </div>
  )
}