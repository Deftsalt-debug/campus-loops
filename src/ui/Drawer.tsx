import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon } from './icons'
import './Drawer.css'

export type DrawerTab = 'saved' | 'notes' | 'about'

interface Panel { label: string; count?: number; render: () => ReactNode }

interface Props {
  tab: DrawerTab | null
  panels: Record<DrawerTab, Panel>
  onTab: (tab: DrawerTab) => void
  onClose: () => void
}

const ORDER: DrawerTab[] = ['saved', 'notes', 'about']

/**
 * Secondary tools live off the main path, in a modal sheet: from the right on
 * wide screens, from the bottom on phones. Native <dialog> provides the focus
 * trap, Escape and inert background; this adds an animated exit.
 */
export function Drawer({ tab, panels, onTab, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (tab && !dialog.open) dialog.showModal()
    if (!tab && dialog.open) dialog.close()
  }, [tab])

  const finish = () => {
    setClosing(false)
    ref.current?.close()
    onClose()
  }
  const requestClose = () => {
    if (closing) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) finish()
    else setClosing(true)
  }
  // The exit animation may never run (hidden tab, no CSS). Do not leave the sheet stuck open.
  useEffect(() => {
    if (!closing) return
    const t = window.setTimeout(finish, 400)
    return () => window.clearTimeout(t)
  })

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta = ({ ArrowRight: 1, ArrowLeft: -1 } as Record<string, number>)[e.key]
    if (!delta && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const next = ORDER[e.key === 'Home' ? 0 : e.key === 'End' ? ORDER.length - 1 : (i + delta + ORDER.length) % ORDER.length]
    onTab(next)
    document.getElementById(`drawer-tab-${next}`)?.focus()
  }

  return (
    <dialog
      ref={ref}
      className={`drawer${closing ? ' is-closing' : ''}`}
      aria-labelledby={tab ? `drawer-tab-${tab}` : undefined}
      onCancel={(e) => { e.preventDefault(); requestClose() }}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose() }}
      onAnimationEnd={(e) => { if (closing && e.target === e.currentTarget) finish() }}
    >
      {tab && (
        <div className="drawer-sheet">
          <header className="drawer-head">
            <div className="drawer-tabs" role="tablist" aria-label="Your things">
              {ORDER.map((id, i) => (
                <button key={id} id={`drawer-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls="drawer-panel"
                  tabIndex={tab === id ? 0 : -1} onClick={() => onTab(id)} onKeyDown={(e) => onTabKey(e, i)}>
                  {panels[id].label}{panels[id].count !== undefined && <span className="count">{panels[id].count}</span>}
                </button>
              ))}
            </div>
            <button type="button" className="icon-btn" onClick={requestClose} aria-label="Close"><Icon name="close" /></button>
          </header>
          <div key={tab} id="drawer-panel" className="drawer-body" role="tabpanel" aria-labelledby={`drawer-tab-${tab}`} tabIndex={0}>
            {panels[tab].render()}
          </div>
        </div>
      )}
    </dialog>
  )
}
