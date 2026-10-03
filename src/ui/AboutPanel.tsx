import osmSnapshot from '../../data/osm/snapshot.json'
import type { Dataset } from '../core/types'
import { clearLogs, readLogs } from '../storage/calibrationLog'
import { calibrationSummaryText } from './calibration'
import { ripple } from './effects'
import { download } from './format'

interface Props {
  dataset: Dataset
  logCount: number
  onLogsChanged: () => void
  notify: (message: string) => void
}

/** Data provenance, privacy, and the calibration log: everything the walk itself does not need. */
export function AboutPanel({ dataset, logCount, onLogsChanged, notify }: Props) {
  const { status, logs } = readLogs()
  const exportLogs = () => {
    const { status: currentStatus, logs: readable } = readLogs()
    if (currentStatus === 'unavailable') { notify('Browser storage is unavailable. No calibration backup was created.'); return }
    if (!readable.length) { notify('No readable calibration logs are available to export.'); return }
    try {
      download('campus-loops-walks.json', 'application/json', JSON.stringify(readable, null, 2))
      notify(currentStatus === 'corrupt' ? 'Readable calibration logs exported. Unreadable entries were excluded.' : 'Calibration logs exported')
    } catch { notify('The calibration backup could not be downloaded. Your logs are still on this device.') }
  }
  return (
    <div className="about">
      {dataset.isFixture && (
        <section className="notice">
          <p><b>Public demo · Check before you go.</b> Paths and places come from OpenStreetMap and haven't been walked or checked yet.
            Prices and some opening hours are placeholders.</p>
          {dataset.datasetVersion.startsWith('manipal-demo-') && <p>
            Map snapshot: <time dateTime={osmSnapshot.retrievedAt.slice(0, 10)}>{osmSnapshot.retrievedAt.slice(0, 10)}</time>.
            {' '}Checked against OpenStreetMap on <time dateTime={osmSnapshot.checkedLiveOn}>{osmSnapshot.checkedLiveOn}</time>.
            {' '}Venue pins use saved source locations; walking routes use nearby path anchors. Entrances, gates, steps and shelter still need local checks.
            {' '}<a href="https://www.openstreetmap.org/#map=16/13.3475/74.7925" target="_blank" rel="noopener noreferrer">View the source map</a>.
          </p>}
        </section>
      )}

      <section>
        <h3>Current venues and hours</h3>
        <p className="hint">Open a venue’s Google Maps link to check its current listing and entrance. Venue pins show source-mapped locations; walking routes connect to nearby paths. Listings can change or be incomplete.</p>
        <p className="hint">The street map comes from OpenFreeMap, which rebuilds its OpenStreetMap-derived basemap weekly. It does not refresh this app’s saved venue catalogue or route data.</p>
        <p className="hint">This app calculates estimates from saved campus data. It does not fetch live opening hours, prices, closures or walking times. Reopening a walk recalculates the plan without refreshing that data. Google Maps chooses its own walking route; KML and GPX exports keep this app’s saved route.</p>
      </section>

      <section>
        <h3>Privacy</h3>
        <p className="hint">
          OpenFreeMap supplies the street map and sees your IP address and requests for the map area you view, styles, fonts and icons. If this site configures another tile provider, that provider receives the corresponding map requests. Google receives your search or route when you open a Google Maps link. Shared links contain the
          start point, route and preferences. Saved walks, field notes and calibration logs stay on this device unless you export them. No accounts or analytics.
        </p>
      </section>

      <section className="calib">
        <h3>Calibration log <span className="count">{logCount}</span></h3>
        {status === 'corrupt' && <p className="notice" role="status">Some calibration data is unreadable. New logs are paused to preserve it. Export readable logs first; Clear then removes all stored calibration data so you can start again.</p>}
        <p className="hint">{calibrationSummaryText(logs)}</p>
        {status === 'unavailable' && <p className="notice" role="status">Browser storage is unavailable. Calibration logs cannot be saved, exported or cleared.</p>}
        <div className="row">
          <button type="button" className="btn" onPointerDown={ripple} onClick={exportLogs} disabled={status === 'unavailable' || logs.length === 0}>Export JSON</button>
          <button type="button" className="btn ghost" onPointerDown={ripple} onClick={() => { const ok = clearLogs(); onLogsChanged(); notify(ok ? 'Calibration log cleared' : 'Storage is unavailable in this browser') }}>Clear</button>
          <button type="button" className="btn ghost" onPointerDown={ripple} onClick={onLogsChanged}>Refresh</button>
        </div>
      </section>

      <section>
        <h3>Data</h3>
        <p className="hint">{dataset.licence}</p>
        <p className="hint">Data version {dataset.datasetVersion}. Daylight outings only. Times are India Standard Time.</p>
        <p className="hint">
          <a href="https://github.com/Deftsalt-debug/campus-loops/issues" target="_blank" rel="noopener noreferrer">Report a path, price, or app issue</a>
          {' · '}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Map data licence</a>
        </p>
      </section>
    </div>
  )
}
