# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

South Bronx Community Atlas — a forensic mapping project documenting infrastructural conflict around the Cross Bronx Expressway. Two layers of work exist side-by-side:

1. **Root HTML maps** — static Mapbox GL JS maps, no build step.
2. **`south-bronx-map/`** — a Python NLP pipeline + vanilla JS modules that add community testimony, 311 complaint, and FloodNet sensor layers on top of the existing maps.

## Running the Project

**Always serve from the `CommunityMap/` root** — not from inside `south-bronx-map/`. The JS modules use `fetch()` with relative paths.

```bash
# From CommunityMap/
python -m http.server 8080
# → http://localhost:8080/comunity.html
```

## HTML Map Files

| File | Purpose |
|---|---|
| `comunity.html` | Primary atlas. Multi-layer Mapbox map: DEM terrain, 3D trench extrusions, Cross Bronx route (above/below ground), photo popups, all location pins. |
| `map.html` | Isometric terrain variant. Mapbox v3.4.0, `style.load` event, custom HTML markers, `flyTo` on load. |
| `index.html` | Minimal prototype — single dashed route line. |
| `plan.html` | Mermaid.js workflow diagram only, no map. |

All three map files share the same hardcoded Mapbox token and use **Mapbox GL JS** (v3.2.0 or v3.4.0). GeoJSON data (routes, trench polygons, pins) is **inline in `<script>` blocks** — no external data files.

**Layer stack (comunity.html)**:
1. DEM source → `setTerrain` (exaggeration 1.8) + sky + hillshade
2. Water/park fills from `composite` source
3. Above-ground and below-ground Cross Bronx route lines
4. Trench zone polygons → `fill-extrusion` (base: −15, height: 15)
5. Circle layers for pins (blue = photo, red = no photo) + symbol labels
6. Click → popup; image pins inject `<img src="${locationImage}">` from local PNGs

**Camera**: `pitch: 60, bearing: -30`. `map.html` uses `pitch: 72, bearing: -36`.

**Always use `map.on('style.load', ...)` not `map.on('load', ...)` with `satellite-streets-v12`** to avoid tile source race conditions.

## south-bronx-map/ — NLP + Data Pipeline

### Python setup (one-time)

```bash
cd south-bronx-map
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

### Generate data

```bash
# 1. Process interview transcript → community_nodes.geojson + nlp_summary.json
python nlp_pipeline.py

# 2. Fetch live 311 / FloodNet / EJScreen data
python fetch_data.py
```

`interviews/raw_transcript.txt` — one paragraph per community statement. Each paragraph becomes one GeoJSON node.

All scripts **fall back to placeholder data** in `data/` if APIs are unreachable, so the map always renders.

**311 fetch is capped at 15,000 rows** (5,000/batch × 3 calls) to avoid the endpoint returning 50k+ records for HEAT/HOT WATER complaints alone.

### NLP pipeline internals

Three sequential passes in `nlp_pipeline.py`:
1. **spaCy NER** → extract GPE/LOC/FAC entities → geocode against `KNOWN_PLACES` lookup first, then Nominatim (1 req/s rate limit) within South Bronx bbox
2. **VADER** → `urgency = abs(compound)`, `agency = 1 if compound > 0`
3. **Keyword matching** → assign `flood / air_quality / heat / displacement`; TF-IDF + KMeans fallback for zero-keyword statements

### GeoJSON node schema

```json
{
  "type": "community",
  "risk_category": "flood",
  "urgency": 0.82,
  "agency": 0,
  "quote": "exact statement",
  "places_mentioned": ["149th Street"],
  "source": "interview"
}
```

### Frontend JS modules

**`map_community.js`** — `initCommunityLayers(map, opts)` global function. Loads 3 GeoJSON files via `fetch()`, builds layers, adds toggle panel (top-right).

> ⚠️ **IMPORTANT**: `map_community.js` was written targeting **Leaflet** (`L.marker`, `L.layerGroup`, `L.popup`) but `comunity.html` uses **Mapbox GL JS**. They are currently incompatible. Any integration work must rewrite `map_community.js` to use `mapboxgl.Marker`, `mapboxgl.Popup`, `map.addSource/addLayer`, and `map.setLayoutProperty` for visibility toggling. The D3 hexbin overlay should project points using `map.project([lng, lat])` and re-render on `map.on('render', ...)`.

**`policy_simulator_nlp.js`** — `initPolicySimulator(map, opts)` global function. Client-side only. Reads `map._cl_communityData`, `map._cl_s311Data`, `map._cl_floodData`, `map._cl_convZones` (all set by `map_community.js`). Classifies free text → ranks 4 interventions → highlights top convergence zone on map.

### Convergence zone detection

After layers load, checks each community node for overlap within 300 m of:
- A 311 cluster with `density_score > 0.6`
- A FloodNet sensor with `flood_event_count > 2`

Both must be true. Results exposed at `map._cl_convZones`. Thresholds adjustable in `detectConvergenceZones()` in `map_community.js`.

### Integration into comunity.html (pending Mapbox rewrite)

```html
<!-- Add before </body>, after Mapbox GL JS -->
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/d3-hexbin@0.2/build/d3-hexbin.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script src="south-bronx-map/map_community.js"></script>
<script src="south-bronx-map/policy_simulator_nlp.js"></script>
<script>
  // Inside the existing map.on('load', ...) callback:
  initCommunityLayers(map, {
    nodesPath: 'south-bronx-map/data/community_nodes.geojson',
    s311Path:  'south-bronx-map/data/complaints_311.geojson',
    floodPath: 'south-bronx-map/data/floodnet_sensors.geojson',
  });
  initPolicySimulator(map);
</script>
```

## Coordinate Reference

Study area bbox: `40.8000–40.8400 N`, `73.9500–73.8900 W`. All coordinates WGS84 `[lng, lat]`.

Key anchors:
- Bronx River: `[-73.8752, 40.8297]`
- Starlight Park: `[-73.8742, 40.8325]`
- 1244 Manor Ave (YMPJ): `[-73.8659, 40.8217]`
- Bruckner Expressway: `[-73.8570, 40.8158]`
- Soundview Park: `[-73.8608, 40.8102]`
- West Farms Bus Depot: `[-73.8822, 40.8176]`
- Bronx River Houses: `[-73.8692, 40.8343]`
