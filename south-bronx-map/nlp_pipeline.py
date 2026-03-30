#!/usr/bin/env python3
"""
NLP Pipeline — South Bronx Community Interview Data
====================================================
Input : interviews/raw_transcript.txt  (one paragraph per statement)
Output: data/community_nodes.geojson
        data/nlp_summary.json

Pass 1 — spaCy NER → place extraction → Nominatim geocoding
Pass 2 — VADER sentiment → urgency + agency scores
Pass 3 — TF-IDF keyword matching → 4 risk categories (flood/air_quality/heat/displacement)
"""

import os, re, json, time, warnings
warnings.filterwarnings("ignore")

import numpy as np
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.cluster import KMeans
import requests

# ── Configuration ──────────────────────────────────────────────────────────────

BBOX = {"south": 40.8000, "north": 40.8400, "west": -73.9500, "east": -73.8900}

SEED_KEYWORDS = {
    "flood":        ["water","flooding","storm","drain","basement","rain","sewer","overflow","flood","puddle","tide","surge"],
    "air_quality":  ["truck","diesel","smell","asthma","breathe","pollution","exhaust","dust","fumes","emission","air","pm25","respiratory"],
    "heat":         ["hot","summer","cool","shade","tree","temperature","heatwave","cooling","heat","pavement","ac","humid"],
    "displacement": ["rent","eviction","landlord","moved","afford","housing","gentrification","leave","price","priced","tenant","relocate"],
}

# Hand-coded South Bronx place → [lng, lat]
KNOWN_PLACES = {
    "bronx river":             [-73.8752, 40.8297],
    "starlight park":          [-73.8742, 40.8325],
    "concrete plant park":     [-73.8898, 40.8212],
    "concrete plant":          [-73.8889, 40.8238],
    "bruckner expressway":     [-73.8570, 40.8158],
    "bruckner":                [-73.8570, 40.8158],
    "soundview park":          [-73.8608, 40.8102],
    "bronx river houses":      [-73.8692, 40.8343],
    "west farms bus depot":    [-73.8822, 40.8176],
    "west farms":              [-73.8822, 40.8176],
    "sheridan boulevard":      [-73.8702, 40.8362],
    "sheridan blvd":           [-73.8702, 40.8362],
    "hunts point":             [-73.8820, 40.8150],
    "mott haven":              [-73.9230, 40.8090],
    "port morris":             [-73.9100, 40.8020],
    "longwood":                [-73.8980, 40.8220],
    "longwood avenue":         [-73.8980, 40.8220],
    "crotona park":            [-73.8880, 40.8380],
    "tremont":                 [-73.9000, 40.8500],
    "149th street":            [-73.9200, 40.8130],
    "westchester avenue":      [-73.8690, 40.8260],
    "westchester ave":         [-73.8690, 40.8260],
    "manor avenue":            [-73.8659, 40.8217],
    "castle hill":             [-73.8640, 40.8180],
    "tiffany street":          [-73.8985, 40.8172],
    "southern boulevard":      [-73.8860, 40.8310],
    "lafayette avenue":        [-73.8600, 40.8140],
    "story avenue":            [-73.8840, 40.8230],
    "spofford avenue":         [-73.8900, 40.8190],
    "lincoln hospital":        [-73.9260, 40.8160],
    "cross bronx expressway":  [-73.8860, 40.8310],
    "cross bronx":             [-73.8860, 40.8310],
}

# ── Geocoding ──────────────────────────────────────────────────────────────────

_geocache: dict = {}

def geocode_place(name: str) -> list | None:
    """Known lookup → Nominatim within South Bronx bbox → None."""
    key = name.lower().strip()

    for known, coords in KNOWN_PLACES.items():
        if known in key or key in known:
            return list(coords)

    if key in _geocache:
        return _geocache[key]

    try:
        params = {
            "q": f"{name}, Bronx, New York",
            "format": "json",
            "limit": 1,
            "viewbox": f"{BBOX['west']},{BBOX['south']},{BBOX['east']},{BBOX['north']}",
            "bounded": 1,
        }
        r = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params=params,
            headers={"User-Agent": "SouthBronxCommunityAtlas/1.0"},
            timeout=6,
        )
        time.sleep(1.1)  # respect 1 req/s rate limit
        data = r.json()
        if data:
            coords = [round(float(data[0]["lon"]), 6), round(float(data[0]["lat"]), 6)]
            _geocache[key] = coords
            return coords
    except Exception as exc:
        print(f"    Nominatim error for '{name}': {exc}")

    _geocache[key] = None
    return None


def random_bronx_point() -> list:
    """Fallback: random point inside study bbox."""
    rng = np.random.default_rng()
    lng = rng.uniform(BBOX["west"] + 0.005, BBOX["east"] - 0.005)
    lat = rng.uniform(BBOX["south"] + 0.005, BBOX["north"] - 0.005)
    return [round(float(lng), 6), round(float(lat), 6)]


# ── NLP helpers ────────────────────────────────────────────────────────────────

def load_spacy():
    try:
        import spacy
        return spacy.load("en_core_web_sm")
    except OSError:
        print("  Downloading spaCy model en_core_web_sm …")
        os.system("python -m spacy download en_core_web_sm")
        import spacy
        return spacy.load("en_core_web_sm")


def extract_places(doc) -> list[str]:
    """Return unique place-like entities from a spaCy doc."""
    seen, out = set(), []
    for ent in doc.ents:
        if ent.label_ in {"GPE", "LOC", "FAC", "ORG"} and ent.text not in seen:
            seen.add(ent.text)
            out.append(ent.text)
    return out


def score_sentiment(text: str, analyzer: SentimentIntensityAnalyzer) -> tuple[float, int]:
    s = analyzer.polarity_scores(text)
    urgency = round(abs(s["compound"]), 4)
    agency  = 1 if s["compound"] > 0 else 0
    return urgency, agency


def keyword_hits(text: str, keywords: list[str]) -> int:
    t = text.lower()
    return sum(1 for kw in keywords if kw in t)


def assign_by_keywords(text: str) -> str | None:
    scores = {cat: keyword_hits(text, kws) for cat, kws in SEED_KEYWORDS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else None


def assign_tfidf_fallback(statements: list[dict]) -> list[str]:
    """
    For statements not resolved by keyword matching.
    Anchors clusters with seed documents so labels align to categories.
    """
    if not statements:
        return []

    cats   = list(SEED_KEYWORDS.keys())
    seeds  = [" ".join(kws * 4) for kws in SEED_KEYWORDS.values()]
    texts  = [s["text"] for s in statements]

    vec  = TfidfVectorizer(max_features=600, stop_words="english", ngram_range=(1, 2))
    mat  = vec.fit_transform(seeds + texts)

    km = KMeans(n_clusters=4, random_state=42, n_init=15, max_iter=300)
    km.fit(mat)

    # Map each cluster id → category using the first 4 (seed) rows
    seed_assignments = km.labels_[:4]
    cluster_map: dict[int, str] = {}
    for seed_idx, cid in enumerate(seed_assignments):
        cluster_map.setdefault(cid, cats[seed_idx])

    # Fill any cluster not covered by seeds
    for cid in range(4):
        cluster_map.setdefault(cid, cats[cid % 4])

    stmt_labels = km.labels_[4:]
    return [cluster_map[cid] for cid in stmt_labels]


# ── Summary builder ────────────────────────────────────────────────────────────

def build_summary(processed: list[dict]) -> dict:
    cats = list(SEED_KEYWORDS.keys())
    summary: dict = {"total_statements": len(processed), "categories": cats}

    for cat in cats:
        group = [s for s in processed if s["risk_category"] == cat]
        if not group:
            summary[cat] = {"count": 0, "avg_urgency": 0.0, "avg_agency": 0.0, "top_keywords": []}
            continue

        texts = [s["text"] for s in group]
        try:
            vec  = TfidfVectorizer(max_features=100, stop_words="english")
            mat  = vec.fit_transform(texts)
            top_kw = list(
                np.array(vec.get_feature_names_out())[mat.sum(axis=0).A1.argsort()[::-1][:8]]
            )
        except Exception:
            top_kw = SEED_KEYWORDS[cat][:5]

        summary[cat] = {
            "count":       len(group),
            "avg_urgency": round(float(np.mean([s["urgency"] for s in group])), 4),
            "avg_agency":  round(float(np.mean([s["agency"]  for s in group])), 4),
            "top_keywords": top_kw,
        }

    return summary


# ── Main pipeline ──────────────────────────────────────────────────────────────

def run_pipeline(
    transcript_path: str = "interviews/raw_transcript.txt",
    output_dir: str      = "data",
) -> None:
    os.makedirs(output_dir, exist_ok=True)

    # ── Load transcript ─────────────────────────────────────────────────────
    print(f"\n[1/6] Loading transcript: {transcript_path}")
    with open(transcript_path, encoding="utf-8") as f:
        raw = f.read()

    statements_raw = [p.strip() for p in re.split(r"\n\s*\n", raw) if p.strip()]
    print(f"      {len(statements_raw)} statements found.")

    # ── Load models ─────────────────────────────────────────────────────────
    print("[2/6] Loading NLP models …")
    nlp      = load_spacy()
    analyzer = SentimentIntensityAnalyzer()

    # ── Pass 1: NER + geocoding ─────────────────────────────────────────────
    print("[3/6] Pass 1 — Named Entity Recognition + geocoding …")
    processed: list[dict] = []

    for i, text in enumerate(statements_raw, 1):
        doc    = nlp(text)
        places = extract_places(doc)

        coords = None
        for place in places:
            coords = geocode_place(place)
            if coords:
                break
        if not coords:
            coords = random_bronx_point()

        processed.append({"text": text, "places": places, "coords": coords})
        label = places[:2] if places else ["(no places detected)"]
        print(f"      [{i:02d}/{len(statements_raw)}] {label} → {coords}")

    # ── Pass 2: Sentiment ───────────────────────────────────────────────────
    print("[4/6] Pass 2 — Sentiment + urgency scoring …")
    for s in processed:
        s["urgency"], s["agency"] = score_sentiment(s["text"], analyzer)

    # ── Pass 3: Topic clustering ────────────────────────────────────────────
    print("[5/6] Pass 3 — Topic clustering …")
    uncategorised: list[dict] = []

    for s in processed:
        cat = assign_by_keywords(s["text"])
        s["risk_category"] = cat
        if cat is None:
            uncategorised.append(s)

    if uncategorised:
        print(f"      {len(uncategorised)} statements → TF-IDF fallback …")
        fb_cats = assign_tfidf_fallback(uncategorised)
        for s, cat in zip(uncategorised, fb_cats):
            s["risk_category"] = cat

    # ── Write GeoJSON ───────────────────────────────────────────────────────
    print("[6/6] Writing outputs …")
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": s["coords"]},
            "properties": {
                "type":             "community",
                "risk_category":    s["risk_category"],
                "urgency":          s["urgency"],
                "agency":           s["agency"],
                "quote":            s["text"],
                "places_mentioned": s["places"],
                "source":           "interview",
            },
        }
        for s in processed
    ]

    nodes_path = os.path.join(output_dir, "community_nodes.geojson")
    with open(nodes_path, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "features": features}, f, indent=2, ensure_ascii=False)
    print(f"      → {nodes_path}  ({len(features)} nodes)")

    summary = build_summary(processed)
    summary_path = os.path.join(output_dir, "nlp_summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print(f"      → {summary_path}")

    print("\n── Results ──────────────────────────────────────────────────────")
    for cat in list(SEED_KEYWORDS.keys()):
        d = summary[cat]
        print(f"  {cat:<15} {d['count']:>2} statements  urgency={d['avg_urgency']:.3f}  agency={d['avg_agency']:.2f}")
    print(f"  total: {summary['total_statements']} statements\n")


if __name__ == "__main__":
    run_pipeline()
