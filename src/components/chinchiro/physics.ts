import * as THREE from 'three'
import * as CANNON from 'cannon-es'

/*
 * ちんちろの物理演算（描画とは切り離してあり、テストからも動かせる）。
 *
 * 出目はアプリの乱数では決めない。投げる前のさいころの向き・手の位置・
 * 投げた速さと向き（指やスマホの動き）だけで決まり、あとは物理演算に任せる。
 * なので投げ方を工夫すれば「自分で乱数調整している」感覚になる。
 */

// ---------------------------------------------------------------- 寸法
export const DIE = 0.9
const HALF = DIE / 2
/** お椀の底の半径・縁の半径・深さ */
export const BOWL_BOTTOM = 2.2
export const BOWL_RIM = 4.4
export const BOWL_DEPTH = 3.4
export const OUTER_R = BOWL_RIM + 0.45
const WALL_T = 0.3
const SEGMENTS = 40
/** 1単位 ≒ 2cm。本物の重力だと速すぎて目で追えないので少し緩める */
const GRAVITY = 30
export const STEP = 1 / 180
/** 全部がこの秒数だけ止まっていたら役を出す */
export const SETTLE_SECONDS = 0.25
export const MAX_THROW_SPEED = 40
/** throwInto の強さの割り当て（strength 0→1 でこの幅だけ増える） */
export const THROW = { horizontal: 3, downMin: 2, down: 10, spinMin: 6, spin: 12, swirlMin: 4, swirl: 6 }
/** お椀との摩擦。釉薬で滑るので小さめ（小さいほど中でよく動き回る） */
export const BOWL_FRICTION = 0.1

export const HAND_Y = 5.6
export const HAND_HOME = { x: 0, y: HAND_Y, z: 3.0 }
/** 手の中での3つの並び（三角形） */
const HAND_OFFSETS = [
  { x: -0.85, z: 0.5 },
  { x: 0.85, z: 0.5 },
  { x: 0, z: -0.95 },
]

/** BoxGeometry の面の順（+x, -x, +y, -y, +z, -z）に割り当てる目。向かい合う面の和は7 */
export const FACE_VALUES = [2, 5, 1, 6, 3, 4]
const FACE_NORMALS = [
  new CANNON.Vec3(1, 0, 0),
  new CANNON.Vec3(-1, 0, 0),
  new CANNON.Vec3(0, 1, 0),
  new CANNON.Vec3(0, -1, 0),
  new CANNON.Vec3(0, 0, 1),
  new CANNON.Vec3(0, 0, -1),
]

export type ImpactKind = 'bowl' | 'dice' | 'table'

export class DicePhysics {
  readonly world: CANNON.World
  readonly dice: CANNON.Body[] = []
  readonly bowlBody: CANNON.Body
  readonly tableBody: CANNON.Body
  /** 転がっている間のぶつかり（音やバイブ用） */
  onImpact: ((kind: ImpactKind, speed: number) => void) | null = null
  private rolling = false

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAVITY, 0) })
    this.world.broadphase = new CANNON.SAPBroadphase(this.world)
    this.world.allowSleep = true

    const diceMat = new CANNON.Material('dice')
    const bowlMat = new CANNON.Material('bowl')
    const tableMat = new CANNON.Material('table')
    // ガラスやプラスチックのさいころが瀬戸物の上で跳ねる感じにするため、はね返りを強めにしてある
    this.world.addContactMaterial(new CANNON.ContactMaterial(diceMat, bowlMat, { friction: BOWL_FRICTION, restitution: 0.78 }))
    this.world.addContactMaterial(new CANNON.ContactMaterial(diceMat, tableMat, { friction: 0.35, restitution: 0.55 }))
    this.world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, { friction: 0.12, restitution: 0.72 }))

    this.tableBody = buildTable(tableMat)
    this.bowlBody = buildBowl(bowlMat)
    this.world.addBody(this.tableBody)
    this.world.addBody(this.bowlBody)

    for (let i = 0; i < 3; i++) {
      const body = new CANNON.Body({
        mass: 1,
        shape: new CANNON.Box(new CANNON.Vec3(HALF, HALF, HALF)),
        material: diceMat,
        linearDamping: 0.01,
        angularDamping: 0.02,
        allowSleep: true,
        sleepSpeedLimit: 0.08,
        sleepTimeLimit: 0.4,
      })
      // 最初の向きはばらばらにしておく（ここも乱数ではなく固定）
      body.quaternion.setFromEuler(i * 1.1, i * 0.7, i * 0.4)
      body.addEventListener('collide', (e: { body: CANNON.Body; contact: CANNON.ContactEquation }) => {
        if (!this.rolling || !this.onImpact) return
        const speed = Math.abs(e.contact.getImpactVelocityAlongNormal())
        const kind: ImpactKind =
          e.body === this.bowlBody ? 'bowl' : e.body === this.tableBody ? 'table' : 'dice'
        this.onImpact(kind, speed)
      })
      this.world.addBody(body)
      this.dice.push(body)
    }
    this.placeInHand(HAND_HOME)
  }

  /** 手の中に持つ（重力もぶつかりも無効。向きはそのまま） */
  placeInHand(hand: { x: number; y: number; z: number }) {
    this.rolling = false
    this.dice.forEach((body, i) => {
      body.type = CANNON.Body.KINEMATIC
      body.collisionResponse = false
      body.velocity.setZero()
      body.angularVelocity.setZero()
      body.position.set(hand.x + HAND_OFFSETS[i].x, hand.y, hand.z + HAND_OFFSETS[i].z)
    })
  }

  /** 手を離す。速さは水平方向で MAX_THROW_SPEED まで */
  launch(vx: number, vz: number, vy = 0, spin = 1.2) {
    const h = Math.hypot(vx, vz)
    if (h > MAX_THROW_SPEED) {
      vx *= MAX_THROW_SPEED / h
      vz *= MAX_THROW_SPEED / h
    }
    this.dice.forEach((body, i) => {
      body.type = CANNON.Body.DYNAMIC
      body.collisionResponse = true
      body.updateMassProperties()
      body.wakeUp()
      body.velocity.set(vx, vy, vz)
      // 転がる向きに回転をかける。さいころごとに少しずつひねりを変える
      body.angularVelocity.set(vz * spin, (i - 1) * 4, -vx * spin)
    })
    this.rolling = true
  }

  /**
   * 投げる（スワイプでもスマホを振るのでも共通）。strength は 0〜1、
   * dirX/dirZ は投げた向き（水平）。
   * 手の位置は関係なく、いつもお椀の真ん中の上から中へ落とす。いきなり外へは
   * 飛ばさず、強いほど下向きの勢いと回転が強くなって中で激しく跳ねる。
   * ションベンになるのは、着地してから跳ね返って縁を越えたときだけ。
   */
  throwInto(strength: number, dirX: number, dirZ: number) {
    const s = Math.min(1, Math.max(0, strength))
    const len = Math.hypot(dirX, dirZ) || 1
    const dx = dirX / len
    const dz = dirZ / len
    this.placeInHand({ x: -dx * 0.5, y: HAND_Y, z: -dz * 0.5 + 0.3 })
    const h = 1 + s * THROW.horizontal
    // 横向きの勢いも足して、お椀の内側をぐるっと回るように動かす
    const w = THROW.swirlMin + s * THROW.swirl
    this.launch(dx * h - dz * w, dz * h + dx * w, -(THROW.downMin + s * THROW.down), 0)
    // 投げた向きに前転するような回転。さいころごとにひねりを変える
    this.dice.forEach((body, i) => {
      const w = THROW.spinMin + s * THROW.spin
      body.angularVelocity.set(dz * w + (i - 1) * 3, (i - 1) * (4 + s * 10), -dx * w + (1 - i) * 2)
    })
  }

  rotateDie(index: number, axis: { x: number; y: number; z: number }, angle: number) {
    const body = this.dice[index]
    const dq = new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(axis.x, axis.y, axis.z), angle)
    body.quaternion = dq.mult(body.quaternion)
    body.quaternion.normalize()
  }

  step(dt: number) {
    this.world.step(STEP, dt, 12)
  }

  /**
   * 止まったか。斜面に寄りかかったさいころはごくわずかに震え続けて
   * 眠り状態にならないことがあるので、目に見えない程度の動きは止まったとみなす。
   */
  isStill() {
    return this.dice.every(b => b.velocity.length() < 0.2 && b.angularVelocity.length() < 0.4)
  }

  /** 出目と、お椀の外に出たさいころがあるか */
  read() {
    return {
      values: this.dice.map(topFace),
      out: this.dice.some(b => Math.hypot(b.position.x, b.position.z) > BOWL_RIM + 0.2),
    }
  }
}

function buildTable(material: CANNON.Material) {
  // 床と、画面の外まで転がっていかないための見えない柵
  const body = new CANNON.Body({ mass: 0, material })
  body.addShape(new CANNON.Plane(), new CANNON.Vec3(), new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0))
  const fence = (x: number, z: number, hx: number, hz: number) =>
    body.addShape(new CANNON.Box(new CANNON.Vec3(hx, 4, hz)), new CANNON.Vec3(x, 4, z))
  fence(-7.5, 0, 0.5, 10)
  fence(7.5, 0, 0.5, 10)
  fence(0, -8.5, 8, 0.5)
  fence(0, 7.5, 8, 0.5)
  return body
}

/**
 * お椀の当たり判定。斜めの板を円形に並べて内側の斜面を作る。
 * その外にもう一枚まっすぐな壁を立てて、外に出たさいころが
 * 斜面の下にもぐり込まないようにしてある。
 */
function buildBowl(material: CANNON.Material) {
  const body = new CANNON.Body({ mass: 0, material })
  // 底。テーブルの床より少しだけ高くして、さいころがお椀の素材（よく滑る）に
  // 当たるようにする。四角いが、はみ出した角は斜面の下に隠れる
  const floor = BOWL_BOTTOM + 0.5
  body.addShape(new CANNON.Box(new CANNON.Vec3(floor, 0.1, floor)), new CANNON.Vec3(0, -0.09, 0))
  const slope = Math.atan2(BOWL_DEPTH, BOWL_RIM - BOWL_BOTTOM)
  const slant = Math.hypot(BOWL_DEPTH, BOWL_RIM - BOWL_BOTTOM)
  const up = new THREE.Vector3(0, 1, 0)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  for (let i = 0; i < SEGMENTS; i++) {
    const phi = (i / SEGMENTS) * Math.PI * 2
    const radial = new THREE.Vector3(Math.cos(phi), 0, Math.sin(phi))
    const tangent = new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi))

    // 内側の斜面（板の内側の面がちょうど見た目の内面に来るよう外へずらす）
    const along = radial.clone().multiplyScalar(Math.cos(slope)).addScaledVector(up, Math.sin(slope))
    const outward = new THREE.Vector3().crossVectors(along, tangent)
    m.makeBasis(tangent, outward, along)
    q.setFromRotationMatrix(m)
    const center = radial.clone().multiplyScalar((BOWL_BOTTOM + BOWL_RIM) / 2)
      .setY(BOWL_DEPTH / 2)
      .addScaledVector(outward, WALL_T / 2)
    const width = (Math.PI * 2 * BOWL_RIM) / SEGMENTS
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(width * 0.6, WALL_T / 2, slant / 2 + 0.05)),
      new CANNON.Vec3(center.x, center.y, center.z),
      new CANNON.Quaternion(q.x, q.y, q.z, q.w),
    )

    // 外側のまっすぐな壁
    const outerWidth = (Math.PI * 2 * OUTER_R) / SEGMENTS
    const oc = radial.clone().multiplyScalar(OUTER_R - 0.15)
    const oq = new THREE.Quaternion().setFromAxisAngle(up, -phi)
    body.addShape(
      new CANNON.Box(new CANNON.Vec3(0.15, BOWL_DEPTH / 2, outerWidth * 0.6)),
      new CANNON.Vec3(oc.x, BOWL_DEPTH / 2, oc.z),
      new CANNON.Quaternion(oq.x, oq.y, oq.z, oq.w),
    )
  }
  return body
}

/** いちばん上を向いている面の目 */
function topFace(body: CANNON.Body): number {
  let best = 0
  let bestDot = -Infinity
  FACE_NORMALS.forEach((n, i) => {
    const dot = body.quaternion.vmult(n).y
    if (dot > bestDot) {
      bestDot = dot
      best = i
    }
  })
  return FACE_VALUES[best]
}
