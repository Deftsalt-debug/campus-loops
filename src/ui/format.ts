import { formatMinutes } from '../core/time/clock'

/** IST seconds after midnight -> "16:05". */
export const clock = (sec: number) => formatMinutes(sec / 60)

export const mins = (sec: number) => `${Math.round(sec / 60)} min`

export const km = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`)

export const rupees = (low: number, high: number) => (high === 0 ? 'Free' : low === high ? `₹${high}` : `₹${low}–${high}`)

/** Value for <input type="datetime-local"> in IST, e.g. "2026-10-01T16:00". */
export function istInputValue(date: Date): string {
  return new Date(date.getTime() + 330 * 60_000).toISOString().slice(0, 16)
}

export function fromIstInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const d = new Date(`${value}:00+05:30`)
  return Number.isNaN(d.getTime()) || istInputValue(d) !== value ? null : d
}

export function download(filename: string, mime: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'route'
