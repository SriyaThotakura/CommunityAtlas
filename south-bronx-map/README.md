# South Bronx Community NLP + Environmental Data Map

Interactive web map integrating community interview NLP, 311 complaints, FloodNet sensors,
EPA EJScreen metrics, and STURLA spatial analysis for South Bronx. All computation is client-side; Python scripts
generate data files from live APIs and your raw interview transcript.

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

## Running STURLA Analysis

The STURLA (Spatial Typology of Urban Resilience Landscape Attributes) analysis provides
detailed land-use classification and environmental impact assessment for the South Bronx.

### Generate STURLA Grid Data

```bash
python sturla_generator.py
```

Outputs:
- `data/sturla_grid_with_percentages.geojson` — 30m grid cells with land-cover percentages
- `data/sturla_final_classes.geojson` — STURLA classified landscape types
- Uses pre-computed analysis results from notebook analysis when available

### Run STURLA Spatial Analysis

```bash
python sturla_analysis.py
```

Outputs:
- `data/sturla_analysis.geojson` — Complete STURLA analysis with PM2.5 predictions
- `data/feature_importances.json` — Random Forest feature importance results
- Integrates landscape feature impact on pollution levels

**STURLA Classes:**
- `tg` — Trees & Grass (residential/green spaces)
- `g` — Grass only
- `gp` — Grass & Pavement (transitional zones)
- `tp` — Trees & Pavement
- `p` — Pavement only (highway/trench zones)
- `bp` — Buildings & Pavement
- `bpg` — Buildings, Pavement & Grass (mixed urban)
- `b` — Buildings only

**Key Findings:**
- Pavement coverage explains 63.3% of PM2.5 variance
- Green space explains 30.8% of PM2.5 variance
- Building coverage explains 5.8% of PM2.5 variance

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
2. Geocodes place names against South Bronx bounding box using a built-in lookup
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
    sturlaPath: 'south-bronx-map/data/sturla_analysis.geojson',
  });

  initPolicySimulator(map);
</script>
```

The map must be served over HTTP (not opened as a `file://` path) for `fetch()` to work.
Run `python -m http.server 8080` from the `CommunityMap/` directory and open
`http://localhost:8080/your-map.html`.

---

## Convergence zone detection

After all layers load, `map_community.js` runs `detectConvergenceZones()`:

For each community testimony node, it checks whether **both** of the following are
true within a 300 m radius:

1. A 311 complaint cluster with `density_score > 0.6` exists nearby.
2. A FloodNet sensor with `flood_event_count > 2` exists nearby.
3. A STURLA zone with high PM2.5 predictions exists nearby.

If all conditions are met, node is designated a **High Priority Zone** and
rendered as a dashed coral circle. These zones are exposed at `map._cl_convZones`
and feed policy simulator's intervention ranking.

The 300 m / 0.6 / 2-event thresholds can be adjusted in `detectConvergenceZones()`
inside `map_community.js`.

---

## Policy simulator

The floating panel (bottom-left) accepts free text — a community statement or policy
excerpt. On submit it:

1. Classifies text into a risk category using seed keyword matching.
2. Finds most relevant convergence zones for that category.
3. Ranks four interventions (Rain Garden, Permeable Paving, Tree Corridor,
   CLT Buffer) by: complaint-reduction potential + community mention frequency +
   FloodNet sensor proximity + STURLA environmental impact.
4. Highlights top convergence zone on map with an animated ring.
5. Shows a supporting community quote from nodes near that zone.
6. Displays projected ABM spread reduction using existing simulation engine
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
    sturla_grid_with_percentages.geojson ← generated by sturla_generator.py
    sturla_final_classes.geojson         ← STURLA landscape classifications
    sturla_analysis.geojson              ← generated by sturla_analysis.py
    feature_importances.json              ← Random Forest analysis results
    sturla_2008_b.geojson              ← Historical STURLA analysis (2008)
    sturla_2017_c.geojson              ← Historical STURLA analysis (2017)
    sturla_cbe_corridor_full.png        ← Full CBE corridor visualization
    sturla_feature_importance*.png       ← Feature importance charts
  nlp_pipeline.py
  fetch_data.py
  sturla_generator.py
  sturla_analysis.py
  map_community.js
  policy_simulator_nlp.js
  requirements.txt
  README.md
