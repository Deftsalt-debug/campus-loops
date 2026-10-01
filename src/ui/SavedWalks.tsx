import { useId, useRef, useState, type ChangeEvent } from 'react'
import { exportSavedPlans, importSavedPlans, MAX_BACKUP_BYTES, MAX_SAVED_PLANS, type SavedPlan } from '../storage/savedPlans'
import { download } from './format'
import './SavedWalks.css'

interface SavedWalksProps {
  savedPlans: SavedPlan[]
  onOpen: (hash: string) => void
  onRemove: (hash: string) => void
  onImported: () => void
  notify: (message: string) => void
}

export function SavedWalks({ savedPlans, onOpen, onRemove, onImported, notify }: SavedWalksProps) {
  const inputId = useId()
  const helpId = useId()
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const report = (message: string) => { setStatus(message); notify(message) }

  const exportBackup = () => {
    const result = exportSavedPlans()
    if (!result.ok) { report(result.message); return }
    try {
      download('campus-loops-saved-walks.json', 'application/json', result.json)
      report(`Backup prepared with ${result.count} saved walk${result.count === 1 ? '' : 's'}. Keep it somewhere safe.`)
    } catch { report('The backup could not be downloaded. Please try again in your browser.') }
  }

  const restoreBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setStatus('Reading saved-walk backup…')
    try {
      if (file.size > MAX_BACKUP_BYTES) {
        report('Choose a saved-walk backup smaller than 64 KB. Nothing was imported.')
        return
      }
      const result = importSavedPlans(await file.text())
      if (!result.ok) { report(result.message); return }
      onImported()
      report(`Imported ${result.imported} walk${result.imported === 1 ? '' : 's'}; skipped ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'}. ${result.total} of ${MAX_SAVED_PLANS} saved slots used.`)
    } catch { report('The backup could not be read. Please choose the file again. Nothing was imported.') } finally {
      input.value = ''
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <details className="more saved-walks card">
      <summary>Saved walks <span className="count">{savedPlans.length}</span></summary>
      <p className="hint">Only on this device. Opening a saved walk checks it again. Preview walks keep their chosen date.</p>
      {savedPlans.length ? (
        <ul>
          {savedPlans.map((plan) => (
            <li key={plan.hash}>
              <button type="button" className="saved-open" onClick={() => onOpen(plan.hash)}>{plan.name}</button>
              <button type="button" className="btn ghost" aria-label={`Remove saved walk: ${plan.name}`} onClick={() => onRemove(plan.hash)}>Remove</button>
            </li>
          ))}
        </ul>
      ) : <p className="hint">No saved walks yet. Save a suggested walk or restore a backup below.</p>}
      <div className="saved-backup" aria-busy={busy}>
        <button type="button" className="btn ghost" onClick={exportBackup} disabled={busy}>Export backup</button>
        <div className="saved-restore">
          <label htmlFor={inputId}>Restore saved walks</label>
          <input id={inputId} type="file" accept=".json,application/json" aria-describedby={helpId} disabled={busy} onChange={(event) => { void restoreBackup(event) }} />
        </div>
        <p className="hint" id={helpId}>A Campus Loops JSON backup up to 64 KB. Restoring adds walks without replacing existing ones, up to {MAX_SAVED_PLANS} total. Backups include route names, dates and preferences; keep them private.</p>
        <p className="saved-backup-status" role="status" aria-atomic="true">{status}</p>
      </div>
    </details>
  )
}
