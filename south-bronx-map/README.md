# South Bronx Community NLP + Environmental Data Map

Interactive web map integrating community interview NLP, 311 complaints, FloodNet sensors,
and EPA EJScreen metrics for the South Bronx. All computation is client-side; Python scripts
generate the data files from live APIs and your raw interview transcript.

---

## Setup

```bash
# 1. Create and activate a virtual environment
python -m venv .venv
source .venv/bin/activate       # macOS / Linux
.venv\Scripts\activate          # Windows

# 2. Install dependencies
pip install -r requirements.txt

# 3. Download spaCy model (first run only)
python -m spacy download en_core_web_sm
```

---

## Running the NLP pipeline

Drop your interview transcript into `interviews/raw_transcript.txt`.
Each paragraph (blank-line separated) is treated as one community statement.

```bash
python nlp_pipeline.py
```

Outputs:
- `data/community_nodes.geojson` — one GeoJSON point per statement, geocoded and scored
- `data/nlp_summary.json` — cluster sizes, top keywords, average urgency per category

**What it does:**
1. Runs spaCy NER to extract place names and infrastructure references.
2. Geocodes place names against the South Bronx bounding box using a built-in lookup
   table first, then Nominatim (rate-limited to 1 req/s).
3. Scores each statement with VADER: `urgency = abs(compound)`, `agency = 1` if positive.
4. Classifies statements into `flood / air_quality / heat / displacement` by keyword
   overlap; falls back to TF-IDF + KMeans for statements with no keyword matches.

---

## Fetching live environmental data

```bash
python fetch_data.py
```

Outputs:
- `data/complaints_311.geojson` — 311 complaints aggregated to ~100 m grid cells
- `data/floodnet_sensors.geojson` — FloodNet sensor readings (12-month peak + event count)
- `data/ejscreen_tracts.geojson` — EJScreen block-group cumulative impact scores

Each function falls back to the placeholder files already in `data/` if an API is
unreachable. The placeholders contain representative South Bronx data and are
sufficient for development and portfolio presentation.

**Data sources:**
- 311 complaints: [NYC Open Data — Service Requests](https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9)
  — filtered to zip codes 10451–10460, complaint types FLOODING / WATER SYSTEM /
  AIR QUALITY / UNSANITARY CONDITION / HEAT/HOT WATER, last 3 years.
- FloodNet sensors: [NYC FloodNet API](https://api.floodnet.nyc/v1/sensors)
  — filtered spatially to South Bronx bbox (40.80–40.84 N, 73.95–73.89 W).
- EJScreen: [EPA EJScreen ArcGIS Feature Service](https://ejscreen.epa.gov/ArcGIS/rest/services/ejscreenBatch/ejscreenBatch/MapServer/11/query)
  — block groups for Bronx County (FIPS 36005), fields: CANCER, RESP, PWDIS, PTRAF, P_PM25.

---

## Integrating into your existing Leaflet map

Add these script tags **before your closing `</body>`** in your map HTML file,
after Leaflet is already loaded:

```html
<!-- Dependencies for community layers -->
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/d3-hexbin@0.2/build/d3-hexbin.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>

<!-- Community layer modules (order matters) -->
<script src="south-bronx-map/map_community.js"></script>
<script src="south-bronx-map/policy_simulator_nlp.js"></script>

<script>
  // After your existing map initialisation:
  initCommunityLayers(map, {
    nodesPath: 'south-bronx-map/data/community_nodes.geojson',
    s311Path:  'south-bronx-map/data/complaints_311.geojson',
    floodPath: 'south-bronx-map/data/floodnet_sensors.geojson',
  });

  initPolicySimulator(map);
</script>
```

The map must be served over HTTP (not opened as a `file://` path) for `fetch()` to work.
Run `python -m http.server 8080` from the `CommunityMap/` directory and open
`http://localhost:8080/your-map.html`.

---

## Convergence zone detection

After all three layers load, `map_community.js` runs `detectConvergenceZones()`:

For each community testimony node, it checks whether **both** of the following are
true within a 300 m radius:

1. A 311 complaint cluster with `density_score > 0.6` exists nearby.
2. A FloodNet sensor with `flood_event_count > 2` exists nearby.

If both conditions are met the node is designated a **High Priority Zone** and
rendered as a dashed coral circle. These zones are exposed at `map._cl_convZones`
and feed the policy simulator's intervention ranking.

The 300 m / 0.6 / 2-event thresholds can be adjusted in `detectConvergenceZones()`
inside `map_community.js`.

---

## Policy simulator

The floating panel (bottom-left) accepts free text — a community statement or policy
excerpt. On submit it:

1. Classifies the text into a risk category using seed keyword matching.
2. Finds the most relevant convergence zones for that category.
3. Ranks the four interventions (Rain Garden, Permeable Paving, Tree Corridor,
   CLT Buffer) by: complaint-reduction potential + community mention frequency +
   FloodNet sensor proximity.
4. Highlights the top convergence zone on the map with an animated ring.
5. Shows a supporting community quote from nodes near that zone.
6. Displays projected ABM spread reduction using the existing simulation engine
   with a per-rank damping factor.

---

## File structure

```
south-bronx-map/
  interviews/
    raw_transcript.txt      ← your interview transcript (one paragraph per statement)
  data/
    community_nodes.geojson ← generated by nlp_pipeline.py
    complaints_311.geojson  ← generated by fetch_data.py
    floodnet_sensors.geojson
    ejscreen_tracts.geojson
    nlp_summary.json
  nlp_pipeline.py
  fetch_data.py
  map_community.js
  policy_simulator_nlp.js
  requirements.txt
  README.md
```
