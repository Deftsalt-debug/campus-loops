import type { RouteGeometry } from '../geo';
import { formatMinutes } from '../time/clock';
import type { Plan } from '../types';

// KML imports into Google My Maps (mymaps.google.com > Create > Import), which
// then shows the exact route inside the Google Maps app under Saved > Maps.
// GPX works with most other map and fitness apps.

const xmlText = (s: string) => [...s].map((ch) => {
  const cp = ch.codePointAt(0)!;
  // XML 1.0 permits tabs, newlines, CR and these Unicode ranges.
  return cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0xd7ff) ||
    (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff) ? ch : '\uFFFD';
}).join('');
const escapeXml = (s: string) =>
  xmlText(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

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

// ---- Calendar (.ics, RFC 5545) ----

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and newlines. */
function escapeIcsText(s: string): string {
  // RFC 5545 excludes ASCII controls except HTAB. Keep line breaks only long
  // enough to escape them, and replace unpaired surrogates before UTF-8 encoding.
  const text = [...s].map((ch) => {
    const cp = ch.codePointAt(0)!;
    return cp === 9 || cp === 10 || cp === 13 ||
      (cp >= 0x20 && cp !== 0x7f && (cp < 0xd800 || cp > 0xdfff)) ? ch : '\uFFFD';
  }).join('');
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Fold content lines at 75 octets (UTF-8), never splitting a character. */
function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    // Continuation lines start with a space, which counts towards their 75 octets.
    const limit = parts.length === 0 ? 75 : 74;
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** 20261002T043000Z */
function icsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export interface IcsOptions {
  startAt: Date;
  /** DTSTAMP; pass a fixed value in tests. */
  stamp: Date;
  startName: string;
  startCoords: [number, number];
  /** Distinguishes routes when a map revision reuses node and edge identifiers. */
  datasetVersion?: string;
  /** Link back to this exact plan. */
  url?: string;
}

/** Compact, deterministic route identity; FNV-1a is used as a fingerprint, not for security. */
function icsRouteIdentity(plan: Plan, opts: IcsOptions): string {
  // A plan ID describes its stop sequence and is shared across different starts.
  // JSON framing keeps distinct identifiers/edge sequences unambiguous. Exclude
  // presentation text, links and DTSTAMP so re-exporting the same outing is stable.
  const identity = JSON.stringify([
    opts.datasetVersion ?? '', plan.id, plan.startNodeId, plan.edgeIds, opts.startCoords,
  ]);
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(identity)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * A calendar event for the outing, from leaving the start to getting back
 * (buffer included), with the itinerary in the description and a reminder
 * 10 minutes before. Times are UTC, so every calendar app shows local time correctly.
 */
export function planToIcs(plan: Plan, opts: IcsOptions): string {
  // URI values are not TEXT fields: validate and serialize instead of escaping them.
  let url: string | undefined;
  if (opts.url !== undefined) {
    if (/[\r\n]/.test(opts.url)) throw new RangeError('Calendar URL must be a single-line web URL');
    try {
      const parsed = new URL(opts.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported protocol');
      url = parsed.href;
    } catch {
      throw new RangeError('Calendar URL must be an absolute HTTP or HTTPS URL');
    }
  }
  const startSec = (((opts.startAt.getTime() / 1000 + 330 * 60) % 86_400) + 86_400) % 86_400;
  const end = new Date(opts.startAt.getTime() + plan.totalSec * 1000);
  const description = planToText(plan, opts.startName, startSec) + (url ? `\n${url}\n` : '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Campus Loops//Walk planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:walk-${icsRouteIdentity(plan, opts)}-${icsUtc(opts.startAt)}@campus-loops`,
    `DTSTAMP:${icsUtc(opts.stamp)}`,
    `DTSTART:${icsUtc(opts.startAt)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${escapeIcsText(`Walk: ${plan.name}`)}`,
    `LOCATION:${escapeIcsText(`${opts.startName}, MIT Manipal`)}`,
    `GEO:${opts.startCoords[0].toFixed(6)};${opts.startCoords[1].toFixed(6)}`,
    `DESCRIPTION:${escapeIcsText(description.trim())}`,
    ...(url ? [`URL:${url}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT10M',
    `DESCRIPTION:${escapeIcsText(`Walk from ${opts.startName} in 10 minutes`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
