import * as THREE from 'three'
import {
  BOWL_BOTTOM, BOWL_DEPTH, BOWL_RIM, DIE, DicePhysics, FACE_VALUES, HAND_HOME, HAND_Y, OUTER_R, SETTLE_SECONDS,
  type ImpactKind,
} from './physics'

export type { ImpactKind }

/** 指を離したときの速さ（ワールド単位/秒）にかける係数 */
const RELEASE_SCALE = 0.4
/** これより遅く離したら投げずに手を戻す */
const MIN_RELEASE_SPEED = 6

export type SceneEvents = {
  /** 全部止まったとき。out はお椀の外に出たさいころがあるか */
  onSettled: (values: number[], out: boolean) => void
  onImpact: (kind: ImpactKind, speed: number) => void
  onThrow: () => void
}

type Phase = 'hand' | 'rolling' | 'settled'

type Drag =
  | { kind: 'rotate'; die: number; lastX: number; lastY: number; moved: number }
  | { kind: 'hand'; history: { t: number; p: THREE.Vector3 }[] }

export class ChinchiroScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200)
  private physics = new DicePhysics()
  private meshes: THREE.Mesh[] = []
  private raycaster = new THREE.Raycaster()
  private handPos = new THREE.Vector3(HAND_HOME.x, HAND_HOME.y, HAND_HOME.z)
  private phase: Phase = 'hand'
  private drag: Drag | null = null
  private stillTime = 0
  private rollTime = 0
  private raf = 0
  private lastFrame = 0
  private resizeObserver: ResizeObserver
  private disposables: { dispose: () => void }[] = []

  private container: HTMLElement
  private events: SceneEvents

  constructor(container: HTMLElement, events: SceneEvents) {
    this.container = container
    this.events = events
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.style.touchAction = 'none'
    this.renderer.domElement.style.display = 'block'
    container.appendChild(this.renderer.domElement)

    this.buildLights()
    this.buildTable()
    this.buildBowl()
    this.buildDice()
    this.physics.onImpact = (kind, speed) => this.events.onImpact(kind, speed)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('pointercancel', this.onPointerUp)

    this.lastFrame = performance.now()
    this.raf = requestAnimationFrame(this.loop)
  }

  // ------------------------------------------------------------ 組み立て

  private buildLights() {
    this.scene.background = new THREE.Color('#1a0f0a')
    this.scene.add(new THREE.HemisphereLight('#fff6e8', '#3a2414', 1.1))
    const sun = new THREE.DirectionalLight('#ffffff', 2.2)
    sun.position.set(4, 14, 6)
    sun.castShadow = true
    sun.shadow.mapSize.set(1024, 1024)
    // 曲面のお椀に縞模様（シャドウアクネ）が出ないようにずらす
    sun.shadow.bias = -0.0005
    sun.shadow.normalBias = 0.03
    const s = sun.shadow.camera as THREE.OrthographicCamera
    s.left = -9
    s.right = 9
    s.top = 9
    s.bottom = -9
    s.near = 1
    s.far = 40
    this.scene.add(sun)
  }

  private buildTable() {
    const geo = new THREE.PlaneGeometry(60, 60)
    const mat = new THREE.MeshStandardMaterial({ color: '#5a3520', roughness: 0.85 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.receiveShadow = true
    this.scene.add(mesh)
    this.disposables.push(geo, mat)
  }

  /** お椀の見た目（当たり判定は physics.ts） */
  private buildBowl() {
    const profile: THREE.Vector2[] = []
    profile.push(new THREE.Vector2(0, 0.02))
    profile.push(new THREE.Vector2(BOWL_BOTTOM, 0.02))
    for (let i = 1; i <= 12; i++) {
      const t = i / 12
      profile.push(new THREE.Vector2(BOWL_BOTTOM + (BOWL_RIM - BOWL_BOTTOM) * t, BOWL_DEPTH * t))
    }
    profile.push(new THREE.Vector2(OUTER_R - 0.05, BOWL_DEPTH + 0.06))
    profile.push(new THREE.Vector2(OUTER_R, BOWL_DEPTH - 0.05))
    profile.push(new THREE.Vector2(OUTER_R - 0.15, 0.3))
    profile.push(new THREE.Vector2(OUTER_R - 0.4, 0.0))

    const geo = new THREE.LatheGeometry(profile, 72)
    const mat = new THREE.MeshStandardMaterial({ color: '#f4efe4', roughness: 0.18, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(geo, mat)
    // 影を落とさせると自分の内側が影で灰色になるので、受けるだけにする
    mesh.receiveShadow = true
    this.scene.add(mesh)

    // 縁の藍色の線
    const bandGeo = new THREE.TorusGeometry(OUTER_R - 0.02, 0.06, 8, 96)
    const bandMat = new THREE.MeshStandardMaterial({ color: '#23408e', roughness: 0.3 })
    const band = new THREE.Mesh(bandGeo, bandMat)
    band.rotation.x = Math.PI / 2
    band.position.y = BOWL_DEPTH - 0.25
    this.scene.add(band)
    this.disposables.push(geo, mat, bandGeo, bandMat)
  }

  private buildDice() {
    const geo = new THREE.BoxGeometry(DIE, DIE, DIE)
    const mats = FACE_VALUES.map(v => {
      const tex = new THREE.CanvasTexture(drawFace(v))
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 4
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 })
      this.disposables.push(tex, mat)
      return mat
    })
    this.disposables.push(geo)

    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(geo, mats)
      mesh.castShadow = true
      this.scene.add(mesh)
      this.meshes.push(mesh)
    }
  }

  // ------------------------------------------------------------ 手

  private placeDiceInHand() {
    this.physics.placeInHand(this.handPos)
  }

  /** 止まったさいころを手に戻す。向きはそのまま（見ながら持ち直せる） */
  gatherToHand() {
    this.handPos.set(HAND_HOME.x, HAND_HOME.y, HAND_HOME.z)
    this.phase = 'hand'
    this.placeDiceInHand()
  }

  /** スマホを振っている間、手の中でさいころを揺らす */
  shakeHand(ax: number, ay: number, rotation: { alpha: number; beta: number; gamma: number }, dt: number) {
    if (this.phase !== 'hand' || this.drag) return
    const k = 0.03
    this.handPos.set(
      HAND_HOME.x + THREE.MathUtils.clamp(ax * k, -0.8, 0.8),
      HAND_Y,
      HAND_HOME.z + THREE.MathUtils.clamp(-ay * k, -0.8, 0.8),
    )
    const deg = Math.PI / 180
    const e = new THREE.Euler()
    const q = new THREE.Quaternion()
    const axis = new THREE.Vector3()
    for (let i = 0; i < 3; i++) {
      const s = 0.5 + i * 0.2
      e.set(rotation.beta * deg * dt * s, rotation.alpha * deg * dt * s, rotation.gamma * deg * dt * s)
      q.setFromEuler(e)
      const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)))
      if (angle < 1e-6) continue
      axis.set(q.x, q.y, q.z).normalize()
      this.physics.rotateDie(i, axis, q.w < 0 ? -angle : angle)
    }
    this.placeDiceInHand()
  }

  /** 投げる。vx/vz はワールドの水平方向の速さ */
  throwWithVelocity(vx: number, vz: number, vy = 0) {
    if (this.phase !== 'hand') return
    this.physics.launch(vx, vz, vy)
    this.phase = 'rolling'
    this.stillTime = 0
    this.rollTime = 0
    this.events.onThrow()
  }

  get canThrow() {
    return this.phase === 'hand'
  }

  // ------------------------------------------------------------ 指の操作

  private ndc(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect()
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  }

  private handPlanePoint(e: PointerEvent) {
    this.raycaster.setFromCamera(this.ndc(e), this.camera)
    const p = new THREE.Vector3()
    const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -HAND_Y), p)
    return hit ? p : null
  }

  private onPointerDown = (e: PointerEvent) => {
    if (this.phase !== 'hand') return
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId)
    } catch {
      // 指が離れた後に届いたイベントなどでは取れないことがある
    }
    this.raycaster.setFromCamera(this.ndc(e), this.camera)
    const hits = this.raycaster.intersectObjects(this.meshes)
    if (hits.length > 0) {
      const die = this.meshes.findIndex(m => m === hits[0].object)
      this.drag = { kind: 'rotate', die, lastX: e.clientX, lastY: e.clientY, moved: 0 }
      return
    }
    const p = this.handPlanePoint(e)
    if (!p) return
    this.drag = { kind: 'hand', history: [{ t: performance.now(), p }] }
    this.moveHandTo(p)
  }

  private onPointerMove = (e: PointerEvent) => {
    const drag = this.drag
    if (!drag || this.phase !== 'hand') return
    if (drag.kind === 'rotate') {
      const dx = e.clientX - drag.lastX
      const dy = e.clientY - drag.lastY
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      drag.moved += Math.hypot(dx, dy)
      const len = Math.hypot(dx, dy)
      if (len === 0) return
      // 指でなぞった方向にさいころを転がす（画面に平行な軸で回す）
      const axis = new THREE.Vector3(dy, dx, 0).normalize().applyQuaternion(this.camera.quaternion)
      this.rotateDie(drag.die, axis, len * 0.012)
      return
    }
    const p = this.handPlanePoint(e)
    if (!p) return
    const now = performance.now()
    drag.history.push({ t: now, p })
    while (drag.history.length > 2 && now - drag.history[0].t > 100) drag.history.shift()
    this.moveHandTo(p)
  }

  private onPointerUp = (e: PointerEvent) => {
    const drag = this.drag
    this.drag = null
    if (!drag || this.phase !== 'hand') return
    if (drag.kind === 'rotate') {
      // タップしただけなら手前に90度転がして、次の面を上にする
      if (drag.moved < 6) {
        const axis = new THREE.Vector3(1, 0, 0)
        this.rotateDie(drag.die, axis, Math.PI / 2)
      }
      return
    }
    const p = this.handPlanePoint(e) ?? drag.history[drag.history.length - 1].p
    drag.history.push({ t: performance.now(), p })
    const first = drag.history[0]
    const last = drag.history[drag.history.length - 1]
    const dt = (last.t - first.t) / 1000
    const v = dt > 0 ? last.p.clone().sub(first.p).divideScalar(dt) : new THREE.Vector3()
    if (Math.hypot(v.x, v.z) < MIN_RELEASE_SPEED) {
      // ゆっくり離しただけなら投げない
      this.handPos.set(HAND_HOME.x, HAND_HOME.y, HAND_HOME.z)
      this.placeDiceInHand()
      return
    }
    this.throwWithVelocity(v.x * RELEASE_SCALE, v.z * RELEASE_SCALE)
  }

  private moveHandTo(p: THREE.Vector3) {
    // お椀の上あたりから大きく外れないようにする
    const r = Math.hypot(p.x, p.z)
    const max = 6
    const x = r > max ? (p.x * max) / r : p.x
    const z = r > max ? (p.z * max) / r : p.z
    this.handPos.set(x, HAND_Y, Math.min(z, 5))
    this.placeDiceInHand()
  }

  private rotateDie(index: number, axis: THREE.Vector3, angle: number) {
    this.physics.rotateDie(index, axis, angle)
  }

  // ------------------------------------------------------------ ループ

  private loop = (now: number) => {
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000)
    this.lastFrame = now
    this.physics.step(dt)

    for (const [i, body] of this.physics.dice.entries()) {
      const mesh = this.meshes[i]
      mesh.position.set(body.position.x, body.position.y, body.position.z)
      mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
    }

    if (this.phase === 'rolling') this.checkSettled(dt)

    this.renderer.render(this.scene, this.camera)
    this.raf = requestAnimationFrame(this.loop)
  }

  private checkSettled(dt: number) {
    this.rollTime += dt
    this.stillTime = this.physics.isStill() ? this.stillTime + dt : 0
    if (this.stillTime < SETTLE_SECONDS && this.rollTime < 12) return

    this.phase = 'settled'
    const { values, out } = this.physics.read()
    this.events.onSettled(values, out)
  }

  private resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h)
    const aspect = w / h
    this.camera.aspect = aspect
    // 縦長の画面でもお椀がまるごと入る距離まで引く
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const dist = Math.max(6.8 / tan, 6.2 / (tan * aspect))
    const dir = new THREE.Vector3(0, 0.9, 0.42).normalize()
    const target = new THREE.Vector3(0, 0.5, 0.6)
    this.camera.position.copy(target).addScaledVector(dir, dist)
    this.camera.lookAt(target)
    this.camera.updateProjectionMatrix()
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this.onPointerDown)
    el.removeEventListener('pointermove', this.onPointerMove)
    el.removeEventListener('pointerup', this.onPointerUp)
    el.removeEventListener('pointercancel', this.onPointerUp)
    this.disposables.forEach(d => d.dispose())
    this.renderer.dispose()
    el.remove()
  }
}

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.27, 0.22], [0.73, 0.22], [0.27, 0.5], [0.73, 0.5], [0.27, 0.78], [0.73, 0.78]],
}

function drawFace(value: number): HTMLCanvasElement {
  const size = 256
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  g.fillStyle = '#d8d2c4'
  g.fillRect(0, 0, size, size)
  g.fillStyle = '#fbf9f3'
  g.beginPath()
  g.roundRect(6, 6, size - 12, size - 12, 40)
  g.fill()
  // 1の目は赤くて大きい
  const r = value === 1 ? 46 : 22
  g.fillStyle = value === 1 ? '#c8102e' : '#1b1b1b'
  for (const [x, y] of PIPS[value]) {
    g.beginPath()
    g.arc(x * size, y * size, r, 0, Math.PI * 2)
    g.fill()
  }
  return c
}
