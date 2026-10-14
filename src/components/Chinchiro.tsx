import { useEffect, useRef, useState } from 'react'
import { ChinchiroScene, type ImpactKind } from './chinchiro/scene'
import { handLabel, isFinalHand, judgeChinchiro, MAX_THROWS, type ChinchiroHand } from '../utils/chinchiro'
import './Chinchiro.css'

/** これより強い加速度（m/s²、重力抜き）で「振っている」とみなす */
const SHAKE_START = 14
/** これより弱い状態が続いたら振り終わり */
const SHAKE_END = 5
const SHAKE_END_MS = 120

type MotionPermission = 'unknown' | 'needs-request' | 'granted' | 'denied' | 'unsupported'

type Throw = { values: number[]; hand: ChinchiroHand }

export function Chinchiro() {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ChinchiroScene | null>(null)
  const sound = useRef(new DiceSound())
  const [throws, setThrows] = useState<Throw[]>([])
  const [phase, setPhase] = useState<'hand' | 'rolling' | 'settled'>('hand')
  const [motion, setMotion] = useState<MotionPermission>(() => initialMotionPermission())

  const last = throws[throws.length - 1]
  const finished = last ? isFinalHand(last.hand, throws.length) : false

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const s = sound.current
    const scene = new ChinchiroScene(container, {
      onThrow: () => setPhase('rolling'),
      onImpact: (kind, speed) => s.impact(kind, speed),
      onSettled: (values, out) => {
        setPhase('settled')
        setThrows(prev => [...prev, { values, hand: judgeChinchiro(values, out) }])
      },
    })
    sceneRef.current = scene
    return () => {
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => () => sound.current.close(), [])

  // スマホを振って投げる
  useEffect(() => {
    if (motion !== 'granted') return
    let shaking = false
    let peak = { x: 0, y: 0, m: 0 }
    let calmSince = 0
    let lastT = performance.now()

    const onMotion = (e: DeviceMotionEvent) => {
      const scene = sceneRef.current
      if (!scene?.canThrow) return
      const a = e.acceleration
      if (!a || a.x == null || a.y == null || a.z == null) return
      const now = performance.now()
      const dt = Math.min(0.1, (now - lastT) / 1000)
      lastT = now
      const m = Math.hypot(a.x, a.y, a.z)

      if (!shaking) {
        if (m < SHAKE_START) return
        shaking = true
        peak = { x: 0, y: 0, m: 0 }
        calmSince = 0
      }

      const r = e.rotationRate
      scene.shakeHand(a.x, a.y, { alpha: r?.alpha ?? 0, beta: r?.beta ?? 0, gamma: r?.gamma ?? 0 }, dt)
      sound.current.rattle(m)
      if (m > peak.m) peak = { x: a.x, y: a.y, m }

      if (m < SHAKE_END) {
        if (!calmSince) calmSince = now
        if (now - calmSince < SHAKE_END_MS) return
        shaking = false
        // いちばん強く振った向きと強さで投げる（画面の上方向 = 奥）
        const speed = Math.max(4, (peak.m - 10) * 1.0)
        const h = Math.hypot(peak.x, peak.y)
        const dirX = h > 1 ? peak.x / h : 0
        const dirZ = h > 1 ? -peak.y / h : -1
        scene.throwWithVelocity(dirX * speed, dirZ * speed, 2)
      } else {
        calmSince = 0
      }
    }
    window.addEventListener('devicemotion', onMotion)
    return () => window.removeEventListener('devicemotion', onMotion)
  }, [motion])

  const requestMotion = async () => {
    sound.current.unlock()
    const req = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission
    if (!req) {
      setMotion('granted')
      return
    }
    try {
      setMotion((await req()) === 'granted' ? 'granted' : 'denied')
    } catch {
      setMotion('denied')
    }
  }

  const next = () => {
    if (finished) setThrows([])
    sceneRef.current?.gatherToHand()
    setPhase('hand')
  }

  return (
    <div className="chinchiro" onPointerDown={() => sound.current.unlock()}>
      <div className="chinchiro-canvas" ref={containerRef} />

      <div className="chinchiro-top">
        <span className="chinchiro-count">
          {Math.min(throws.length + (phase === 'settled' ? 0 : 1), MAX_THROWS)}投目 / {MAX_THROWS}
        </span>
        {throws.length > 0 && (
          <span className="chinchiro-history">
            {throws.map((t, i) => (
              <span key={i}>{handLabel(t.hand)}</span>
            ))}
          </span>
        )}
      </div>

      {phase === 'settled' && last && (
        <div className={`chinchiro-result hand-${last.hand.kind}`} onClick={next}>
          <div className="chinchiro-result-dice">{last.values.join(' ・ ')}</div>
          <div className="chinchiro-result-name">{handLabel(last.hand)}</div>
          <div className="chinchiro-result-next">
            {finished ? 'タップでもう一回' : 'タップで振り直す'}
          </div>
        </div>
      )}

      {phase === 'hand' && (
        <div className="chinchiro-bottom">
          <div className="chinchiro-hint">
            さいころをなぞって向きを変える（タップで90°）・それ以外をつかんで投げる
          </div>
          {motion === 'needs-request' && (
            <button className="chinchiro-motion-btn" onClick={requestMotion}>
              スマホを振って投げる
            </button>
          )}
          {motion === 'granted' && <div className="chinchiro-hint">スマホを振っても投げられます</div>}
          {motion === 'denied' && <div className="chinchiro-hint">振る操作は許可されていません</div>}
        </div>
      )}
    </div>
  )
}

function initialMotionPermission(): MotionPermission {
  // PC のブラウザにも DeviceMotionEvent はあるが、振れないので出さない
  if (typeof DeviceMotionEvent === 'undefined' || !('ontouchstart' in window)) return 'unsupported'
  const req = (DeviceMotionEvent as unknown as { requestPermission?: unknown }).requestPermission
  // iPhone はボタンを押して許可を取る必要がある。Android はそのまま使える
  if (typeof req === 'function') return 'needs-request'
  return 'granted'
}

/** さいころの音。音源ファイルは使わずにその場で作る */
class DiceSound {
  private ctx: AudioContext | null = null
  private lastAt = 0

  unlock() {
    try {
      this.ctx ??= new AudioContext()
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      // 音が出せなくても遊べる
    }
  }

  impact(kind: ImpactKind, speed: number) {
    if (speed < 0.8) return
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    const now = ctx.currentTime
    if (now - this.lastAt < 0.025) return
    this.lastAt = now
    const vol = Math.min(1, speed / 10) * 0.5

    if (kind === 'bowl') {
      // 瀬戸物に当たるチンという音
      this.tone(2400 + Math.random() * 300, vol, 0.35)
      this.tone(3900, vol * 0.4, 0.2)
    } else if (kind === 'dice') {
      this.tone(1600, vol * 0.7, 0.06)
    } else {
      this.tone(260, vol, 0.08)
    }
    if (speed > 4) navigator.vibrate?.(8)
  }

  /** 手の中でカラカラ鳴る音 */
  rattle(strength: number) {
    const ctx = this.ctx
    if (!ctx || ctx.state !== 'running') return
    if (ctx.currentTime - this.lastAt < 0.07) return
    this.lastAt = ctx.currentTime
    this.tone(1200 + Math.random() * 600, Math.min(0.25, strength / 80), 0.04)
  }

  private tone(freq: number, vol: number, dur: number) {
    const ctx = this.ctx!
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    gain.gain.setValueAtTime(vol, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + dur)
  }

  close() {
    void this.ctx?.close()
    this.ctx = null
  }
}
