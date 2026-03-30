#!/usr/bin/env python3
"""
generate_mask.py
================
Generates data/inverted_mask.geojson — a single Polygon with:
  - Exterior ring : entire world (counter-clockwise — GeoJSON right-hand rule)
  - Interior ring : South Bronx bounding box as a cut-out hole (clockwise)

When loaded as a Mapbox fill layer coloured #F9F9F9 (the page background),
everything *outside* the South Bronx disappears — creating a floating diorama.

No external dependencies. Standard library only.

Usage:
    python generate_mask.py
Output:
    data/inverted_mask.geojson
"""

import os, json

OUTPUT_PATH = os.path.join("data", "inverted_mask.geojson")

# ── South Bronx study area ────────────────────────────────────────────────────
BRONX = {"west": -73.93, "south": 40.80, "east": -73.85, "north": 40.85}

# ── GeoJSON Right-Hand Rule ───────────────────────────────────────────────────
# RFC 7946 §3.1.6:
#   Exterior rings  →  counter-clockwise (CCW)
#   Interior rings  →  clockwise (CW)  ← holes
#
# Verify CCW exterior:   SW→SE→NE→NW→SW  (east, north, west, south) = CCW ✓
# Verify CW  interior:   SW→NW→NE→SE→SW  (north, east, south, west) = CW  ✓


def build_mask(bbox: dict) -> dict:
    w, s, e, n = bbox["west"], bbox["south"], bbox["east"], bbox["north"]

    # Exterior: world bounding box, counter-clockwise
    exterior = [
        [-180.0, -90.0],   # SW
        [ 180.0, -90.0],   # SE  →  go east
        [ 180.0,  90.0],   # NE  →  go north
        [-180.0,  90.0],   # NW  →  go west
        [-180.0, -90.0],   # SW  →  close (south)
    ]

    # Interior: South Bronx hole, clockwise
    interior = [
        [w, s],   # SW
        [w, n],   # NW  →  go north
        [e, n],   # NE  →  go east
        [e, s],   # SE  →  go south
        [w, s],   # SW  →  close (west)
    ]

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "name": "diorama_mask",
                    "fill_hint": "#F9F9F9",
                    "note": "Exterior CCW (world), interior CW (South Bronx hole). RFC 7946 compliant.",
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [exterior, interior],
                },
            }
        ],
    }


def main() -> None:
    os.makedirs("data", exist_ok=True)

    mask = build_mask(BRONX)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(mask, f, indent=2)

    ext  = mask["features"][0]["geometry"]["coordinates"][0]
    hole = mask["features"][0]["geometry"]["coordinates"][1]

    print(f"Written → {OUTPUT_PATH}")
    print(f"  Exterior ring : {len(ext)} pts  (world, CCW)")
    print(f"  Interior ring : {len(hole)} pts  "
          f"([{BRONX['west']},{BRONX['south']}] → [{BRONX['east']},{BRONX['north']}], CW)")
    print()
    print("  Right-hand rule check:")
    print("    Exterior CCW:  SW→SE→NE→NW→SW  ✓")
    print("    Interior CW:   SW→NW→NE→SE→SW  ✓")
    print()
    print("  Load in Mapbox as a fill layer:")
    print("    fill-color:   '#F9F9F9'  ← must match your page background")
    print("    fill-opacity:  1")


if __name__ == "__main__":
    main()
