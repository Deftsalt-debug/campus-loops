import type { RouteGeometry } from '../geo';
import { formatMinutes } from '../time/clock';
import type { Plan } from '../types';

// KML imports into Google My Maps (mymaps.google.com > Create > Import), which
// then shows the exact route inside the Google Maps app under Saved > Maps.
// GPX works with most other map and fitness apps.

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const minutes = (sec: number) => Math.round(sec / 60);

function stopLabel(plan: Plan, i: number): string {
  const v = plan.visits[i];
  return `${i + 1}. ${v.name}${v.dwellSec > 0 ? ` (${minutes(v.dwellSec)} min)` : ' (pass by)'}`;
}

export function planToKml(plan: Plan, route: RouteGeometry, startName: string, attribution: string): string {
  const coords = route.path.map(([lat, lng]) => `${lng.toFixed(7)},${lat.toFixed(7)},0`).join(' ');
  const point = (name: string, description: string, [lat, lng]: [number, number], style: string) => `
    <Placemark>
      <name>${escapeXml(name)}</name>
      <description>${escapeXml(description)}</description>
      <styleUrl>#${style}</styleUrl>
      <Point><coordinates>${lng.toFixed(7)},${lat.toFixed(7)},0</coordinates></Point>
    </Placemark>`;
  const stops = route.stops
    .map((s, i) => point(stopLabel(plan, i), `Arrive about +${minutes(plan.visits[i].arriveOffsetSec)} min`, s.at, s.passBy ? 'passby' : 'stop'))
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(plan.name)}</name>
    <description>${escapeXml(`${plan.explanation} ${minutes(plan.totalSec)} min planned, ${(plan.distanceM / 1000).toFixed(2)} km. ${attribution}`)}</description>
    <Style id="route"><LineStyle><color>ff4f6e0b</color><width>5</width></LineStyle></Style>
    <Style id="start"><IconStyle><color>ff4f6e0b</color></IconStyle></Style>
    <Style id="stop"><IconStyle><color>ff1f77ff</color></IconStyle></Style>
    <Style id="passby"><IconStyle><color>ff999999</color><scale>0.7</scale></IconStyle></Style>
    <Placemark>
      <name>${escapeXml(`Route: ${plan.name}`)}</name>
      <styleUrl>#route</styleUrl>
      <LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
    </Placemark>${point(`Start and finish: ${startName}`, 'Return here at the end.', route.start, 'start')}${stops}
  </Document>
</kml>
`;
}

export function planToGpx(plan: Plan, route: RouteGeometry, startName: string, attribution: string): string {
  const wpt = (name: string, [lat, lng]: [number, number]) =>
    `  <wpt lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}"><name>${escapeXml(name)}</name></wpt>\n`;
  const points = route.path.map(([lat, lng]) => `      <trkpt lat="${lat.toFixed(7)}" lon="${lng.toFixed(7)}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Campus Loops" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(plan.name)}</name><desc>${escapeXml(attribution)}</desc></metadata>
${wpt(`Start: ${startName}`, route.start)}${route.stops.map((s, i) => wpt(stopLabel(plan, i), s.at)).join('')}  <trk>
    <name>${escapeXml(plan.name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`;
}

/** Plain-text itinerary for copying into a chat. Clock times assume leaving at `startSec` (IST seconds after midnight). */
export function planToText(plan: Plan, startName: string, startSec: number): string {
  const at = (offsetSec: number) => formatMinutes((startSec + offsetSec) / 60);
  const lines = [
    plan.name,
    plan.fit,
    plan.explanation,
    '',
    `${at(0)}  Leave ${startName}`,
    ...plan.visits.map((v) =>
      v.dwellSec > 0 ? `${at(v.arriveOffsetSec)}  ${v.name} (${minutes(v.dwellSec)} min)` : `${at(v.arriveOffsetSec)}  Pass ${v.name}`,
    ),
    `${at(plan.totalSec - plan.bufferSec)}  Back at ${startName} (+${minutes(plan.bufferSec)} min buffer)`,
    '',
    `${minutes(plan.walkingSec)} min walking, ${(plan.distanceM / 1000).toFixed(2)} km, ${
      plan.spendHighInr === 0 ? 'free' : `about ₹${plan.spendLowInr}–${plan.spendHighInr} per person`
    }.`,
    ...plan.warnings,
  ];
  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n').trim() + '\n';
}
