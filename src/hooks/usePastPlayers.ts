import { useEffect, useState } from 'react'

// 一度でも名前を入れた人。この端末にだけ残り、共有はしない
const MAX = 40

function load(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string') : []
  } catch {
    return []
  }
}

/** 先頭（最近）に入れて重複を消す */
function merge(list: string[], names: string[]): string[] {
  const fresh = names.map(n => n.trim()).filter(Boolean)
  return [...new Set([...fresh, ...list])].slice(0, MAX)
}

/**
 * 過去の参加者リスト。initialNames（今の表に入っている名前）も最初に覚えておく。
 * ignore に当てはまる名前（初期値の "Player 1" など）は覚えない。
 */
export function usePastPlayers(key: string, initialNames: string[], ignore?: (name: string) => boolean) {
  const keep = (names: string[]) => names.filter(n => !ignore?.(n.trim()))
  const [list, setList] = useState<string[]>(() => merge(load(key), keep(initialNames)))
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(list))
    } catch {
      // ignore
    }
  }, [key, list])
  return {
    list,
    remember: (names: string[]) => setList(prev => merge(prev, keep(names))),
    forget: (name: string) => setList(prev => prev.filter(n => n !== name)),
  }
}
