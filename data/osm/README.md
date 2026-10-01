# MIT Manipal map provenance

The saved snapshot was acquired on **1 October 2026**. A fresh request to the same [OpenStreetMap API bounding box](https://api.openstreetmap.org/api/0.6/map.json?bbox=74.786,13.3395,74.7985,13.3555) on that date returned identical content for all **7,099 elements** (6,055 nodes, 1,024 ways and 20 relations). The newest element edit was **2 September 2026**. The original raw file was retained; its SHA-256 and acquisition date are in `snapshot.json`.

This establishes agreement with the current OSM database, not a campus survey. Map tiles are fetched separately by the browser; refreshing their appearance does not change the route graph.

## Refresh and review

1. Run `npm run data:osm -- --fetch` to download the bounded snapshot and update its acquisition date and checksum. A changed coordinate invalidates that node's cached elevation.
2. Run `npm run data:osm -- --elevation` if any node heights are missing. The public elevation service is rate limited and the script caches its results.
3. Run `npm run data:check` and `npm test`. Both the check and `npm run data:geojson` default to the dataset used by the app; pass a path to inspect another dataset.
4. Review new or changed paths, place anchors, restrictions and supported hours locally before release. Imported output is validated before replacing the app dataset. Keep `isFixture: true` until a documented field survey is complete.

An offline rebuild preserves the acquisition date; it does not relabel old data as freshly downloaded. A checksum mismatch stops the import. The dataset version includes the snapshot date, importer revision and a checksum prefix, so links to older route data are rejected rather than silently reinterpreted.

## Interpretation and limitations

- Explicit pedestrian access overrides general access. Private, permit-only, customer-only, destination-only and conditional restrictions are excluded from general leisure routes; private gates and impassable mapped barriers cannot bridge the graph. See [OSM pedestrian access](https://wiki.openstreetmap.org/wiki/Key:foot) and [access values](https://wiki.openstreetmap.org/wiki/Key:access).
- Vehicle one-way streets remain walkable in both directions unless pedestrian restrictions say otherwise. Reverse pedestrian one-ways and `oneway:foot=no` exceptions are respected. See [OSM pedestrian one-way rules](https://wiki.openstreetmap.org/wiki/Key:oneway:foot).
- Food Court 1 and Food Court 2 starts are derived from their existing mapped building features. They snap approximately 41 m and 31 m to nearby path nodes. All starts and stops are approximate path anchors, not surveyed entrances.
- Café prices, free-stop assumptions and outdoor availability are placeholders. Only supported simple OSM `opening_hours` expressions are parsed; explicit closures and malformed, overlapping, overnight or complex rules leave the stop unavailable. Demo estimates are used only when hours are absent. Missing steps or cover tags do not prove an accessible or sheltered route.
- The library and planetarium stops describe their exterior only. [MIT Central Library's official site](https://mitmpllibportal.manipal.edu/about-us-4) describes access for members of specified MAHE institutions; the map does not promise visitor admission, library use, planetarium tickets, or entry at any particular time.
- Road crossings, gate access, construction, monsoon flooding, lighting, entrance positions and stop prices/hours still require local review. No field verification or change to these real-world conditions is claimed.

Paths and places are © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright). Elevations use SRTM via [OpenTopoData](https://www.opentopodata.org/), whose resolution does not resolve individual steps or ramps.
