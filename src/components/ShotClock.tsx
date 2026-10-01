import { useCallback, useEffect, useRef, useState } from 'react'
import './ShotClock.css'

export const SHOT_CLOCK_OPTIONS = [5, 10, 15, 30] as const

/** これより短い間隔で2回目のタップが来たらダブルタップとみなす */
const DOUBLE_TAP_MS = 280
/** 残りがこの秒数以下になったら色を変える */
const WARN_SECONDS = 5

type Props = {
  seconds: number
}

/**
 * タップでリセット、ダブルタップでストップ/スタート。
 * 1回目のタップはダブルタップかどうか確定するまで待ってからリセットする。
 * そうしないと、止めようとしたダブルタップの1回目で時間が戻ってしまう。
 */
export function ShotClock({ seconds }: Props) {
  const total = seconds * 1000
  const [remaining, setRemaining] = useState(total)
  const [running, setRunning] = useState(false)

  // 動いている間は「いつ0になるか」を持ち、止まっている間は remaining だけを持つ
  const deadlineRef = useRef<number | null>(null)
  const tapTimerRef = useRef<number | null>(null)
  const firedRef = useRef(false)
  const audioRef = useRef<AudioContext | null>(null)

  const beep = useCallback(() => {
    try {
      const ctx = audioRef.current ?? new AudioContext()
      audioRef.current = ctx
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
      osc.connect(gain).connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.6)
    } catch {
      // 音が出せない環境でも時計としては動かす
    }
    navigator.vibrate?.([200, 100, 200])
  }, [])

  // 秒数を切り替えたら止めて満タンに戻す
  useEffect(() => {
    deadlineRef.current = null
    firedRef.current = false
    setRunning(false)
    setRemaining(total)
  }, [total])

  useEffect(() => {
    if (!running) return
    // requestAnimationFrame だと画面が裏に回ったとき止まり、0秒の音が鳴らないのでタイマーで回す
    const id = window.setInterval(() => {
      if (deadlineRef.current === null) return
      const left = Math.max(0, deadlineRef.current - performance.now())
      setRemaining(left)
      if (left === 0 && !firedRef.current) {
        firedRef.current = true
        beep()
      }
    }, 50)
    return () => clearInterval(id)
  }, [running, beep])

  // 動いている間は画面を消さない
  useEffect(() => {
    if (!running || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    navigator.wakeLock.request('screen').then(l => { lock = l }).catch(() => {})
    return () => { void lock?.release() }
  }, [running])

  useEffect(() => () => {
    if (tapTimerRef.current !== null) clearTimeout(tapTimerRef.current)
    void audioRef.current?.close()
  }, [])

  const reset = () => {
    firedRef.current = false
    setRemaining(total)
    if (running) deadlineRef.current = performance.now() + total
  }

  const toggle = () => {
    if (running) {
      deadlineRef.current = null
      setRunning(false)
      return
    }
    // 0のまま再開しても意味がないので、満タンから始める
    const start = remaining > 0 ? remaining : total
    firedRef.current = false
    setRemaining(start)
    deadlineRef.current = performance.now() + start
    setRunning(true)
  }

  const handleTap = () => {
    // iOS は無音のジェスチャー中でないと音声を有効にできないので、ここで起こしておく
    if (audioRef.current?.state === 'suspended') void audioRef.current.resume()

    if (tapTimerRef.current !== null) {
      clearTimeout(tapTimerRef.current)
      tapTimerRef.current = null
      toggle()
      return
    }
    tapTimerRef.current = window.setTimeout(() => {
      tapTimerRef.current = null
      reset()
    }, DOUBLE_TAP_MS)
  }

  const shown = Math.ceil(remaining / 1000)
  const expired = remaining === 0
  const warn = !expired && shown <= WARN_SECONDS && shown < seconds
  const progress = remaining / total

  return (
    <div
      className={`shot-clock ${running ? 'running' : 'paused'} ${warn ? 'warn' : ''} ${expired ? 'expired' : ''}`}
      onPointerUp={handleTap}
    >
      <div className="shot-clock-bar">
        <div className="shot-clock-bar-fill" style={{ transform: `scaleX(${progress})` }} />
      </div>
      <div className="shot-clock-time">{shown}</div>
      <div className="shot-clock-status">
        {expired ? 'TIME' : running ? '' : 'STOP'}
      </div>
      <div className="shot-clock-hint">タップでリセット ・ ダブルタップでストップ/スタート</div>
    </div>
  )
}
