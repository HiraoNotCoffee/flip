import { useState } from 'react'
import './PastPlayers.css'

interface Props {
  list: string[]
  /** もう表に入っている名前（押せなくする） */
  used: string[]
  onPick: (name: string) => void
  onForget: (name: string) => void
  hint?: string
}

export function PastPlayersBar({ list, used, onPick, onForget, hint = '押すと名前の欄に入ります' }: Props) {
  const [editing, setEditing] = useState(false)
  if (list.length === 0) return null
  const usedSet = new Set(used.map(n => n.trim()))
  return (
    <div className="past-players">
      <div className="past-players-head">
        <span className="past-players-label">過去の参加者</span>
        <span className="past-players-hint">{editing ? '× で消す' : hint}</span>
        <button className="past-players-edit" onClick={() => setEditing(v => !v)}>
          {editing ? '完了' : '編集'}
        </button>
      </div>
      <div className="past-players-list">
        {list.map(name =>
          editing ? (
            <button key={name} className="past-players-chip editing" onClick={() => onForget(name)}>
              {name} <span className="past-players-x">×</span>
            </button>
          ) : (
            <button
              key={name}
              className={`past-players-chip ${usedSet.has(name) ? 'used' : ''}`}
              disabled={usedSet.has(name)}
              // 名前の欄のフォーカスを外さずに押せるようにする
              onPointerDown={e => e.preventDefault()}
              onMouseDown={e => e.preventDefault()}
              onClick={() => onPick(name)}
            >
              {name}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
