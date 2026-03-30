#!/usr/bin/env python3
"""
Data Fetcher — South Bronx Environmental Datasets
==================================================
fetch_311_data()      → data/complaints_311.geojson
fetch_floodnet_data() → data/floodnet_sensors.geojson
fetch_ejscreen_data() → data/ejscreen_tracts.geojson

All outputs are valid WGS84 GeoJSON readable directly by Leaflet.
Each function falls back to placeholder data if the live API is unavailable.
"""

import os, json, math, time, requests
from datetime import datetime, timedelta
from collections import defaultdict

# ── Config ─────────────────────────────────────────────────────────────────────

BBOX = {"south": 40.8000, "north": 40.8400, "west": -73.9500, "east": -73.8900}

SB_ZIPCODES = [
    "10451","10452","10453","10454","10455",
    "10456","10457","10458","10459","10460",
]

COMPLAINT_TYPES_311 = [
    "FLOODING", "WATER SYSTEM", "AIR QUALITY",
    "UNSANITARY CONDITION", "HEAT/HOT WATER",
]

CATEGORY_MAP_311 = {
    "FLOODING":             "flood",
    "WATER SYSTEM":         "flood",
    "AIR QUALITY":          "air_quality",
    "UNSANITARY CONDITION": "air_quality",
    "HEAT/HOT WATER":       "heat",
}

OUTPUT_DIR = "data"

# ── Shared helpers ─────────────────────────────────────────────────────────────

def in_bbox(lat: float, lng: float) -> bool:
    return (
        BBOX["south"] <= lat <= BBOX["north"] and
        BBOX["west"]  <= lng <= BBOX["east"]
    )


def normalise(values: list[float]) -> list[float]:
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi == lo:
        return [0.5] * len(values)
    return [round((v - lo) / (hi - lo), 4) for v in values]


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    p1, p2  = math.radians(lat1), math.radians(lat2)
    dp, dl  = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def write_geojson(features: list, path: str) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, indent=2)


# ── 311 Complaints ─────────────────────────────────────────────────────────────

def fetch_311_data(output_dir: str = OUTPUT_DIR) -> str:
    """
    Pull 311 service requests for South Bronx zip codes from NYC Open Data.
    Aggregates complaints into ~100 m grid cells and normalises density.
    """
    print("\n[311] Fetching complaint data from NYC Open Data …")

    cutoff = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%dT00:00:00.000")
    zip_clause  = ", ".join(f"'{z}'" for z in SB_ZIPCODES)
    type_clause = ", ".join(f"'{t}'" for t in COMPLAINT_TYPES_311)

    base      = "https://data.cityofnewyork.us/resource/erm2-nwe9.json"
    rows: list[dict] = []
    offset    = 0
    limit     = 5000   # larger batch = fewer round-trips
    max_rows  = 15000  # cap: enough for dense spatial aggregation

    while len(rows) < max_rows:
        params = {
            "$select": "complaint_type,incident_zip,latitude,longitude,created_date",
            "$where": (
                f"incident_zip IN ({zip_clause}) "
                f"AND complaint_type IN ({type_clause}) "
                f"AND created_date >= '{cutoff}' "
                f"AND latitude IS NOT NULL AND longitude IS NOT NULL"
            ),
            "$limit":  limit,
            "$offset": offset,
            "$order":  "created_date DESC",
        }
        try:
            resp = requests.get(base, params=params, timeout=30)
            resp.raise_for_status()
            batch = resp.json()
        except requests.RequestException as e:
            print(f"  API error at offset {offset}: {e}")
            break

        if not batch:
            break
        rows.extend(batch)
        print(f"  {len(rows)} complaints fetched …", end="\r")
        if len(batch) < limit:
            break
        offset += limit

    if not rows:
        print("  No data returned — using placeholder data.")
        return _write_placeholder_311(output_dir)

    print(f"\n  {len(rows)} total complaints. Aggregating …")

    # Grid: round lat/lng to 3 dp ≈ 100 m
    buckets: dict = defaultdict(lambda: {"counts": defaultdict(int), "lats": [], "lngs": []})

    for row in rows:
        try:
            lat = float(row["latitude"])
            lng = float(row["longitude"])
        except (ValueError, KeyError):
            continue
        if not in_bbox(lat, lng):
            continue

        key = (round(lat, 3), round(lng, 3))
        ctype = row.get("complaint_type", "UNKNOWN")
        buckets[key]["counts"][ctype] += 1
        buckets[key]["lats"].append(lat)
        buckets[key]["lngs"].append(lng)

    features, counts = [], []
    for key, bucket in buckets.items():
        total      = sum(bucket["counts"].values())
        dominant_r = max(bucket["counts"], key=bucket["counts"].get)
        avg_lat    = sum(bucket["lats"]) / len(bucket["lats"])
        avg_lng    = sum(bucket["lngs"]) / len(bucket["lngs"])
        counts.append(total)
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(avg_lng, 6), round(avg_lat, 6)]},
            "properties": {
                "type":               "311",
                "complaint_type":     dominant_r,
                "dominant_category":  CATEGORY_MAP_311.get(dominant_r, "flood"),
                "count":              total,
                "breakdown":          dict(bucket["counts"]),
                "density_score":      0.0,
            },
        })

    norms = normalise(counts)
    for feat, score in zip(features, norms):
        feat["properties"]["density_score"] = score

    out = os.path.join(output_dir, "complaints_311.geojson")
    write_geojson(features, out)
    print(f"  → {out}  ({len(features)} locations)")
    return out


def _write_placeholder_311(output_dir: str) -> str:
    """Load the placeholder file shipped with the repo."""
    src = os.path.join(output_dir, "complaints_311.geojson")
    if os.path.exists(src):
        print(f"  Using existing placeholder: {src}")
        return src
    raise FileNotFoundError(
        "No 311 data retrieved and no placeholder file found. "
        "Run from the south-bronx-map/ directory."
    )


# ── FloodNet Sensors ───────────────────────────────────────────────────────────

def fetch_floodnet_data(output_dir: str = OUTPUT_DIR) -> str:
    """
    Fetch NYC FloodNet sensor list and 12-month peak readings.
    Falls back to placeholder sensors if API is unreachable.
    """
    print("\n[FloodNet] Fetching sensor data …")
    features: list[dict] = []

    try:
        resp = requests.get("https://api.floodnet.nyc/v1/sensors", timeout=15)
        resp.raise_for_status()
        payload = resp.json()
        sensors = payload if isinstance(payload, list) else payload.get("sensors", [])
        print(f"  {len(sensors)} total sensors retrieved.")

        one_year_ago = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")

        for sensor in sensors:
            # Flexible coordinate extraction
            lat = (
                sensor.get("latitude") or
                sensor.get("lat") or
                (sensor.get("location") or {}).get("latitude")
            )
            lng = (
                sensor.get("longitude") or
                sensor.get("lng") or
                (sensor.get("location") or {}).get("longitude")
            )
            if lat is None or lng is None:
                continue
            try:
                lat, lng = float(lat), float(lng)
            except ValueError:
                continue
            if not in_bbox(lat, lng):
                continue

            sid           = str(sensor.get("id") or sensor.get("sensor_id") or "unk")
            location_name = sensor.get("name") or sensor.get("location_name") or f"Sensor {sid}"

            # Fetch measurements
            peak_cm, event_count, last_date = 0.0, 0, "N/A"
            try:
                m_resp = requests.get(
                    f"https://api.floodnet.nyc/v1/sensors/{sid}/measurements",
                    params={"start": one_year_ago, "resolution": "1d"},
                    timeout=10,
                )
                m_data = m_resp.json()
                measurements = m_data if isinstance(m_data, list) else m_data.get("measurements", [])

                for m in measurements:
                    depth = float(m.get("depth", 0) or m.get("value", 0) or 0)
                    if depth > peak_cm:
                        peak_cm = depth
                    if depth > 2.0:
                        event_count += 1
                        last_date = m.get("timestamp") or m.get("time") or last_date
            except Exception as me:
                print(f"    Readings unavailable for {sid}: {me}")

            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]},
                "properties": {
                    "type":             "floodnet",
                    "sensor_id":        sid,
                    "location_name":    location_name,
                    "peak_depth_cm":    round(peak_cm, 2),
                    "flood_event_count": event_count,
                    "last_event_date":  last_date,
                    "source":           "floodnet_live",
                },
            })

        print(f"  {len(features)} sensors inside South Bronx bbox.")

    except requests.RequestException as e:
        print(f"  FloodNet API unavailable ({e}). Using placeholder sensors.")

    if not features:
        features = _placeholder_floodnet_sensors()

    out = os.path.join(output_dir, "floodnet_sensors.geojson")
    write_geojson(features, out)
    print(f"  → {out}  ({len(features)} sensors)")
    return out


def _placeholder_floodnet_sensors() -> list[dict]:
    return [
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-73.8740,40.8320]},"properties":{"type":"floodnet","sensor_id":"SB-001","location_name":"Starlight Park – Bronx River","peak_depth_cm":14.5,"flood_event_count":6,"last_event_date":"2024-09-29","source":"placeholder"}},
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-73.8822,40.8176]},"properties":{"type":"floodnet","sensor_id":"SB-002","location_name":"West Farms Bus Depot","peak_depth_cm":8.2,"flood_event_count":3,"last_event_date":"2024-07-11","source":"placeholder"}},
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-73.8570,40.8158]},"properties":{"type":"floodnet","sensor_id":"SB-003","location_name":"Bruckner at Soundview","peak_depth_cm":22.1,"flood_event_count":9,"last_event_date":"2024-09-29","source":"placeholder"}},
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-73.8900,40.8200]},"properties":{"type":"floodnet","sensor_id":"SB-004","location_name":"Hunts Point – Spofford Ave","peak_depth_cm":4.0,"flood_event_count":1,"last_event_date":"2023-12-18","source":"placeholder"}},
        {"type":"Feature","geometry":{"type":"Point","coordinates":[-73.8692,40.8343]},"properties":{"type":"floodnet","sensor_id":"SB-005","location_name":"Bronx River Houses","peak_depth_cm":11.7,"flood_event_count":5,"last_event_date":"2024-09-29","source":"placeholder"}},
    ]


# ── EJScreen ───────────────────────────────────────────────────────────────────

def fetch_ejscreen_data(output_dir: str = OUTPUT_DIR) -> str:
    """
    Fetch EPA EJScreen block-group data for Bronx County via ArcGIS REST.
    Filters to South Bronx bbox and computes cumulative_impact_score (0–1).
    """
    print("\n[EJScreen] Fetching census tract data …")
    features: list[dict] = []

    # ArcGIS Feature Service — EJScreen Block Groups layer for NY
    # Layer 11 = Block Groups national
    EJSCREEN_FS = (
        "https://ejscreen.epa.gov/ArcGIS/rest/services/ejscreenBatch/ejscreenBatch/MapServer/11/query"
    )

    try:
        # Filter: Bronx County FIPS = 36005
        params = {
            "where":     "STATE_NAME='New York' AND CNTY_NAME='Bronx'",
            "outFields": "ID,CANCER,RESP,PWDIS,PTRAF,P_PM25,Shape",
            "returnGeometry": "true",
            "outSR":     "4326",
            "f":         "geojson",
        }
        resp = requests.get(EJSCREEN_FS, params=params, timeout=45)
        resp.raise_for_status()
        data = resp.json()
        raw_features = data.get("features", [])
        print(f"  {len(raw_features)} block groups returned for Bronx County.")

        for feat in raw_features:
            geom  = feat.get("geometry", {})
            props = feat.get("properties", {})

            # Centroid bbox filter
            coords_flat = []
            gtype = geom.get("type", "")
            if gtype == "Polygon":
                coords_flat = [pt for ring in geom.get("coordinates", []) for pt in ring]
            elif gtype == "MultiPolygon":
                coords_flat = [pt for poly in geom.get("coordinates", []) for ring in poly for pt in ring]

            if not coords_flat:
                continue

            clat = sum(p[1] for p in coords_flat) / len(coords_flat)
            clng = sum(p[0] for p in coords_flat) / len(coords_flat)
            if not in_bbox(clat, clng):
                continue

            raw_pctiles = [
                float(props.get("CANCER") or 0),
                float(props.get("RESP")   or 0),
                float(props.get("PWDIS")  or 0),
                float(props.get("PTRAF")  or 0),
                float(props.get("P_PM25") or 0),
            ]
            non_zero = [p for p in raw_pctiles if p > 0]
            cumulative = round(sum(non_zero) / (len(non_zero) * 100), 4) if non_zero else 0.5

            features.append({
                "type":     "Feature",
                "geometry": geom,
                "properties": {
                    "type":                    "ejscreen",
                    "tract_id":                props.get("ID", ""),
                    "cancer_pctile":           raw_pctiles[0],
                    "resp_pctile":             raw_pctiles[1],
                    "wastewater_pctile":       raw_pctiles[2],
                    "traffic_pctile":          raw_pctiles[3],
                    "pm25_pctile":             raw_pctiles[4],
                    "cumulative_impact_score": cumulative,
                    "source":                  "ejscreen_live",
                },
            })

        print(f"  {len(features)} block groups inside South Bronx bbox.")

    except requests.RequestException as e:
        print(f"  EJScreen API unavailable ({e}). Using placeholder tracts.")

    if not features:
        features = _placeholder_ejscreen_tracts()

    out = os.path.join(output_dir, "ejscreen_tracts.geojson")
    write_geojson(features, out)
    print(f"  → {out}  ({len(features)} tracts)")
    return out


def _placeholder_ejscreen_tracts() -> list[dict]:
    specs = [
        ("36005024900", "Hunts Point", [-73.887, 40.814], 0.91),
        ("36005025100", "Longwood",    [-73.897, 40.822], 0.88),
        ("36005025900", "Crotona",     [-73.887, 40.840], 0.79),
        ("36005026300", "West Farms",  [-73.879, 40.834], 0.83),
        ("36005026700", "Soundview",   [-73.862, 40.814], 0.85),
    ]
    d = 0.008
    out = []
    for tid, name, (cx, cy), score in specs:
        out.append({
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[cx-d,cy-d],[cx+d,cy-d],[cx+d,cy+d],[cx-d,cy+d],[cx-d,cy-d]]],
            },
            "properties": {
                "type": "ejscreen", "tract_id": tid,
                "cancer_pctile":           round(score * 95, 1),
                "resp_pctile":             round(score * 92, 1),
                "wastewater_pctile":       round(score * 78, 1),
                "traffic_pctile":          round(score * 99, 1),
                "pm25_pctile":             round(score * 88, 1),
                "cumulative_impact_score": score,
                "source": "placeholder",
            },
        })
    return out


# ── Entry point ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    fetch_311_data()
    fetch_floodnet_data()
    fetch_ejscreen_data()
    print("\nAll data files written to ./data/")
