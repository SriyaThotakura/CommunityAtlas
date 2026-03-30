"""
sturla_analysis.py
==================
Spatial Decision Tree analysis linking highway geometry to PM2.5 exposure.

Outputs: data/sturla_analysis.geojson
         data/feature_importances.json

Usage:
    python sturla_analysis.py                        # generates mock complaints CSV
    python sturla_analysis.py --csv path/to/file.csv # uses your own CSV

CSV must have columns: lat, lon, complaint_type, pm25_level, temperature
"""

import os, json, argparse
import numpy as np
import pandas as pd
import geopandas as gpd
from shapely.geometry import box, Point, LineString, MultiLineString
from shapely.ops import unary_union
from sklearn.tree import DecisionTreeRegressor, export_text
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import r2_score, mean_absolute_error

# ── Configuration ──────────────────────────────────────────────────────────────

# WGS84 bounding box: [minx, miny, maxx, maxy]
BBOX_WGS84 = (-73.93, 40.80, -73.87, 40.84)

# Projected CRS for metric distance calculations (UTM Zone 18N)
CRS_METRIC = "EPSG:32618"
CRS_WGS84  = "EPSG:4326"

GRID_SIZE_M = 100   # 100 m × 100 m cells

OUTPUT_DIR  = "data"

# ── Cross Bronx Expressway geometry (WGS84, approximate) ──────────────────────
# Digitised from west (Alexander Hamilton Bridge) to east (Bruckner interchange)
CROSS_BRONX_COORDS = [
    (-73.9270, 40.8450),  # Alexander Hamilton Bridge
    (-73.9200, 40.8450),
    (-73.9100, 40.8440),  # Jerome Ave
    (-73.9010, 40.8430),
    (-73.8900, 40.8400),  # Crotona Park
    (-73.8830, 40.8370),
    (-73.8760, 40.8350),  # Bronx River Pkwy crossing
    (-73.8680, 40.8320),
    (-73.8600, 40.8290),
    (-73.8570, 40.8280),  # Bruckner Interchange
    (-73.8500, 40.8280),
]

# STURLA distance thresholds (metres, from CBX centreline)
STURLA_TRENCH_M  =  60   # → 'p'  (pavement / trench cut)
STURLA_BUFFER_M  = 250   # → 'tpl' (transitional pavement/land)
# > 250 m          → 'tg' (residential/green)

# ── Mock complaint generator ───────────────────────────────────────────────────

def generate_mock_complaints(n: int = 600, seed: int = 42) -> pd.DataFrame:
    """
    Synthetic complaint dataset that mirrors real South Bronx patterns:
    - PM2.5 elevated within 300 m of the expressway
    - Temperature elevated in low-tree areas (near highway, industrial blocks)
    - Asthma complaints cluster near the expressway
    """
    rng = np.random.default_rng(seed)

    # Random points within bbox
    lon = rng.uniform(BBOX_WGS84[0], BBOX_WGS84[2], n)
    lat = rng.uniform(BBOX_WGS84[1], BBOX_WGS84[3], n)

    # Build CBX line for distance calculation
    cbx = LineString(CROSS_BRONX_COORDS)
    cbx_gdf = gpd.GeoDataFrame(geometry=[cbx], crs=CRS_WGS84).to_crs(CRS_METRIC)
    pts_gdf  = gpd.GeoDataFrame(
        geometry=[Point(x, y) for x, y in zip(lon, lat)], crs=CRS_WGS84
    ).to_crs(CRS_METRIC)

    dist_m = pts_gdf.geometry.apply(lambda p: cbx_gdf.geometry[0].distance(p))

    # PM2.5: base 8 µg/m³, +12 within 300 m (exponential decay), + noise
    pm25 = (
        8.0
        + 12.0 * np.exp(-dist_m.values / 300)
        + rng.normal(0, 1.5, n)
    ).clip(2, 35)

    # Temperature: slightly elevated near highway (heat island)
    temperature = (
        28.0
        + 4.0 * np.exp(-dist_m.values / 400)
        + rng.normal(0, 1.2, n)
    ).clip(20, 40)

    # Complaint type: Asthma clusters near highway
    p_asthma = np.clip(0.15 + 0.60 * np.exp(-dist_m.values / 350), 0, 0.85)
    p_heat   = np.clip(0.25 + 0.30 * np.exp(-dist_m.values / 500), 0, 0.50)
    p_noise  = 1 - p_asthma - p_heat
    p_noise  = np.clip(p_noise, 0.05, 0.80)

    # Normalise rows
    p_stack = np.stack([p_asthma, p_heat, p_noise], axis=1)
    p_stack = p_stack / p_stack.sum(axis=1, keepdims=True)

    complaint_types = np.array(
        [rng.choice(["Asthma", "Heat", "Noise"], p=row) for row in p_stack]
    )

    return pd.DataFrame({
        "lat":            lat,
        "lon":            lon,
        "complaint_type": complaint_types,
        "pm25_level":     pm25.round(2),
        "temperature":    temperature.round(1),
    })


# ── Grid builder ───────────────────────────────────────────────────────────────

def build_grid(bbox_wgs84: tuple, cell_size_m: float) -> gpd.GeoDataFrame:
    """Create a regular square grid in metric CRS, return in WGS84."""
    # Project bbox corners to metric
    bbox_gdf = gpd.GeoDataFrame(
        geometry=[box(*bbox_wgs84)], crs=CRS_WGS84
    ).to_crs(CRS_METRIC)
    minx, miny, maxx, maxy = bbox_gdf.total_bounds

    # Generate grid cells
    xs = np.arange(minx, maxx, cell_size_m)
    ys = np.arange(miny, maxy, cell_size_m)

    cells = [
        box(x, y, x + cell_size_m, y + cell_size_m)
        for y in ys
        for x in xs
    ]

    grid = gpd.GeoDataFrame(geometry=cells, crs=CRS_METRIC)
    grid["cell_id"] = range(len(grid))
    print(f"  Grid: {len(grid)} cells ({cell_size_m:.0f} m × {cell_size_m:.0f} m)")
    return grid


# ── STURLA classification ──────────────────────────────────────────────────────

def classify_sturla(grid_metric: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    Assign STURLA land-use class to each cell based on distance to CBX:
      'p'   → pavement / trench cut  (≤ STURLA_TRENCH_M)
      'tpl' → transitional/land      (≤ STURLA_BUFFER_M)
      'tg'  → residential/green      (> STURLA_BUFFER_M)
    """
    cbx_line = LineString(CROSS_BRONX_COORDS)
    cbx_gdf  = gpd.GeoDataFrame(geometry=[cbx_line], crs=CRS_WGS84).to_crs(CRS_METRIC)
    cbx_geom = cbx_gdf.geometry[0]

    # Distance from each cell centroid to CBX
    centroids = grid_metric.geometry.centroid
    dist_m    = centroids.apply(lambda p: cbx_geom.distance(p))

    grid_metric = grid_metric.copy()
    grid_metric["dist_highway_m"] = dist_m.round(1)
    grid_metric["STURLA_class"] = np.where(
        dist_m <= STURLA_TRENCH_M,  "p",
        np.where(dist_m <= STURLA_BUFFER_M, "tpl", "tg")
    )

    counts = grid_metric["STURLA_class"].value_counts().to_dict()
    print(f"  STURLA classes: {counts}")
    return grid_metric


# ── Spatial join: complaints → grid ───────────────────────────────────────────

def join_complaints(
    grid_metric: gpd.GeoDataFrame,
    complaints_df: pd.DataFrame
) -> gpd.GeoDataFrame:
    """Spatially join complaint points to grid cells. Aggregate pm25 and top complaint."""
    pts = gpd.GeoDataFrame(
        complaints_df,
        geometry=gpd.points_from_xy(complaints_df["lon"], complaints_df["lat"]),
        crs=CRS_WGS84,
    ).to_crs(CRS_METRIC)

    joined = gpd.sjoin(pts, grid_metric[["cell_id", "geometry"]], how="left", predicate="within")

    # Aggregate per cell
    agg = (
        joined.groupby("cell_id")
        .agg(
            mean_pm25      = ("pm25_level",    "mean"),
            mean_temp      = ("temperature",   "mean"),
            complaint_count= ("complaint_type","count"),
            top_complaint  = ("complaint_type", lambda x: x.value_counts().index[0]),
        )
        .reset_index()
    )

    grid_metric = grid_metric.merge(agg, on="cell_id", how="left")

    # Fill cells with no complaints using median pm25 + spatial interpolation fallback
    median_pm25 = complaints_df["pm25_level"].median()
    grid_metric["mean_pm25"]       = grid_metric["mean_pm25"].fillna(median_pm25)
    grid_metric["mean_temp"]       = grid_metric["mean_temp"].fillna(complaints_df["temperature"].median())
    grid_metric["complaint_count"] = grid_metric["complaint_count"].fillna(0).astype(int)
    grid_metric["top_complaint"]   = grid_metric["top_complaint"].fillna("None")

    print(f"  Complaints joined: {len(pts)} points → {(agg['cell_id'].nunique())} cells with data")
    return grid_metric


# ── Decision Tree model ────────────────────────────────────────────────────────

def run_decision_tree(grid: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, dict]:
    """
    Features  X: STURLA_class (label-encoded), dist_highway_m
    Target    y: mean_pm25

    Returns updated grid with 'predicted_pm25' column and importances dict.
    """
    le = LabelEncoder()
    sturla_encoded = le.fit_transform(grid["STURLA_class"])

    X = np.column_stack([
        sturla_encoded,
        grid["dist_highway_m"].values,
    ])
    y = grid["mean_pm25"].values

    model = DecisionTreeRegressor(
        max_depth      = 5,
        min_samples_leaf = 10,
        random_state   = 42,
    )
    model.fit(X, y)

    grid = grid.copy()
    grid["predicted_pm25"] = model.predict(X).round(3)

    # Feature importances
    feat_names   = ["STURLA_class_encoded", "dist_highway_m"]
    importances  = dict(zip(feat_names, model.feature_importances_.round(4)))

    r2  = r2_score(y, grid["predicted_pm25"])
    mae = mean_absolute_error(y, grid["predicted_pm25"])

    print(f"\n── Model results ──────────────────────────────────────────────────")
    print(f"  R²  : {r2:.4f}")
    print(f"  MAE : {mae:.4f} µg/m³")
    print(f"  Feature importances:")
    for feat, imp in sorted(importances.items(), key=lambda x: -x[1]):
        bar = "█" * int(imp * 40)
        print(f"    {feat:<28} {imp:.4f}  {bar}")
    print(f"\n  Tree rules (depth ≤ 3):")
    print(export_text(model, feature_names=feat_names, max_depth=3))

    return grid, {
        "feature_importances": importances,
        "r2_score": round(r2, 4),
        "mae_ug_m3": round(mae, 4),
        "sturla_label_encoding": dict(zip(le.classes_, le.transform(le.classes_).tolist())),
        "model_params": {
            "max_depth": 5,
            "min_samples_leaf": 10,
            "n_features": 2,
            "n_cells": len(grid),
        }
    }


# ── GeoJSON export ─────────────────────────────────────────────────────────────

def export_geojson(grid_metric: gpd.GeoDataFrame, out_dir: str) -> str:
    """
    Re-project to WGS84, keep only required + useful columns, write GeoJSON.
    Required properties: STURLA_class, predicted_pm25, top_complaint_type
    """
    grid_wgs84 = grid_metric.to_crs(CRS_WGS84).copy()

    grid_wgs84 = grid_wgs84.rename(columns={"top_complaint": "top_complaint_type"})

    keep_cols = [
        "geometry",
        "cell_id",
        "STURLA_class",
        "dist_highway_m",
        "predicted_pm25",
        "mean_pm25",
        "mean_temp",
        "complaint_count",
        "top_complaint_type",
    ]
    grid_out = grid_wgs84[keep_cols]

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "sturla_analysis.geojson")
    grid_out.to_file(out_path, driver="GeoJSON")
    print(f"\n  → {out_path}  ({len(grid_out)} features)")
    return out_path


# ── Main ───────────────────────────────────────────────────────────────────────

def main(csv_path: str | None = None) -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # ── Complaints data ──────────────────────────────────────────────────────
    if csv_path and os.path.exists(csv_path):
        print(f"[1/5] Loading complaints from {csv_path} …")
        complaints = pd.read_csv(csv_path)
        required = {"lat", "lon", "complaint_type", "pm25_level", "temperature"}
        missing  = required - set(complaints.columns)
        if missing:
            raise ValueError(f"CSV missing columns: {missing}")
    else:
        print("[1/5] Generating mock complaints dataset (n=600) …")
        complaints = generate_mock_complaints()
        mock_path  = os.path.join(OUTPUT_DIR, "community_complaints_mock.csv")
        complaints.to_csv(mock_path, index=False)
        print(f"  Mock CSV saved → {mock_path}")

    print(f"  {len(complaints)} complaint records loaded.")
    print(f"  PM2.5 range: {complaints['pm25_level'].min():.1f}–{complaints['pm25_level'].max():.1f} µg/m³")

    # ── Build grid ───────────────────────────────────────────────────────────
    print(f"\n[2/5] Building {GRID_SIZE_M} m grid over South Bronx bbox …")
    grid = build_grid(BBOX_WGS84, GRID_SIZE_M)

    # ── STURLA classification ────────────────────────────────────────────────
    print("\n[3/5] Classifying STURLA classes from highway geometry …")
    grid = classify_sturla(grid)

    # ── Spatial join ─────────────────────────────────────────────────────────
    print("\n[4/5] Joining complaints to grid cells …")
    grid = join_complaints(grid, complaints)

    # ── Decision Tree ─────────────────────────────────────────────────────────
    print("\n[5/5] Running DecisionTreeRegressor …")
    grid, results = run_decision_tree(grid)

    # ── Export ───────────────────────────────────────────────────────────────
    geojson_path = export_geojson(grid, OUTPUT_DIR)

    feat_path = os.path.join(OUTPUT_DIR, "feature_importances.json")
    with open(feat_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"  → {feat_path}")

    # ── Summary ───────────────────────────────────────────────────────────────
    imp = results["feature_importances"]
    highway_pct = round(imp.get("dist_highway_m", 0) * 100, 1)
    sturla_pct  = round(imp.get("STURLA_class_encoded", 0) * 100, 1)

    print(f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  STURLA ANALYSIS — COMPLETE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Highway geometry explains {highway_pct}% of PM2.5 variance
  STURLA class encodes       {sturla_pct}% of PM2.5 variance
  Model R²:  {results['r2_score']}
  Model MAE: {results['mae_ug_m3']} µg/m³

  Output: {geojson_path}
  Load in QGIS, Mapbox, or your Leaflet/Mapbox map.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
""")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="STURLA spatial PM2.5 analysis")
    parser.add_argument("--csv", type=str, default=None,
                        help="Path to complaints CSV (lat,lon,complaint_type,pm25_level,temperature)")
    args = parser.parse_args()
    main(csv_path=args.csv)
