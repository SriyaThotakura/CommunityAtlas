// ── CONFIGURATION ─────────────────────────────────────────────────────────────
const MAPBOX_TOKEN   = 'pk.eyJ1Ijoic3JpeWF0aG90YWt1cmEiLCJhIjoiY21kYzhuMG1hMTVrbjJpcHpnZ3Awdjc1dCJ9.bEGwdPmOH5kVaT9RWduC5Q';
const MAP_STYLE      = 'mapbox://styles/sriyathotakura/cmnbydkcb000401qw67z5gm5x'; // PASTE CUSTOM STUDIO STYLE URL HERE
const GEOJSON_PATH   = './south-bronx-map/data/sturla_grid_with_percentages.geojson';
const MASK_PATH      = './south-bronx-map/data/inverted_mask.geojson';
const S311_PATH      = './south-bronx-map/data/complaints_311.geojson';
const FLOOD_PATH     = './south-bronx-map/data/floodnet_sensors_extended.geojson';
const COMMUNITY_PATH = './south-bronx-map/data/community_nodes_extended.geojson';
const HIGHWAY_PATH      = './south-bronx-map/data/cross_bronx_expressway.geojson';
const STURLA_FINAL_PATH = './south-bronx-map/data/sturla_2017_c.geojson';

// ── Chapter → map view definitions ───────────────────────────────────────────
// Standard views:  bearing -45, pitch 60, fixed 2200 ms duration.
// Cinematic views: speed + curve instead — mutually exclusive with duration.

const SECTION_VIEWS = {
  'chapter-1': {
    center:  [-73.895, 40.835],
    zoom:    13.5,
    bearing: -45,
    pitch:   60,
    label:   '01 — The Atmospheric Trap',
  },

  // Nine metres below the city - Frame the Cross Bronx cut
  'chapter-2': {
    center:  [-73.8825, 40.8385],
    zoom:    15.5,
    bearing: 107,
    pitch:   65,
    label:   '02 — Nine metres below the city',
  },

  'chapter-3': {
    center:  [-73.885, 40.825],
    zoom:    14.5,
    bearing: -45,
    pitch:   60,
    label:   '03 — Convergence Zones',
  },
};

// ── Chapter → layer visibility config ────────────────────────────────────────
// All highway + community layers start with layout.visibility = 'none'.
// setChapterLayers() makes the right subset visible as the user scrolls.

const CHAPTER_LAYERS = {
  'chapter-1': {
    show: ['sturla-glow-fill', 'sturla-glow-blur', 'sturla-ambient', 'sturla-trench', 'sturla-outline'],
    hide: [
      'highway-trench', 'highway-trench-core', 'highway-elevated',
      '311-circles', 'floodnet-circles', 'community-circles',
    ],
  },
  'chapter-2': {
    show: [
      'sturla-glow-fill', 'sturla-glow-blur', 'sturla-ambient', 'sturla-trench', 'sturla-outline',
      'highway-trench', 'highway-trench-core', 'highway-elevated',
    ],
    hide: ['311-circles', 'floodnet-circles', 'community-circles'],
  },
  'chapter-3': {
    show: [
      'sturla-glow-fill', 'sturla-glow-blur', 'sturla-ambient', 'sturla-trench', 'sturla-outline',
      'highway-trench', 'highway-trench-core', 'highway-elevated',
      '311-circles', 'floodnet-circles', 'community-circles',
    ],
    hide: [],
  },
};

// ── Diorama frame — study-area bounding box ───────────────────────────────────
const BRONX_FRAME = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-73.93, 40.80], [-73.93, 40.85],
      [-73.85, 40.85], [-73.85, 40.80],
      [-73.93, 40.80],
    ]],
  },
  properties: {},
};

// ── Initialise map ────────────────────────────────────────────────────────────

// Disable Mapbox telemetry and events completely
mapboxgl.config.API_URL = 'https://api.mapbox.com';
mapboxgl.config.REQUIRE_ACCESS_TOKEN = true;
mapboxgl.config.EVENTS_URL = '';
mapboxgl.config.ACCESS_TOKEN = MAPBOX_TOKEN;

// Override Mapbox's request method to block events completely
const originalFetch = window.fetch;
const originalXHROpen = XMLHttpRequest.prototype.open;
const originalXHRSend = XMLHttpRequest.prototype.send;

// Block fetch requests to Mapbox events
window.fetch = function(url, options) {
  // Handle different URL parameter types
  const urlStr = typeof url === 'string' ? url : (url && url.toString ? url.toString() : '');
  if (urlStr && (urlStr.includes('events.mapbox.com') || urlStr.includes('api.mapbox.com/events'))) {
    return Promise.resolve(new Response('', { status: 204, statusText: 'No Content' }));
  }
  return originalFetch.apply(this, arguments);
};

// Block XMLHttpRequest to Mapbox events
XMLHttpRequest.prototype.open = function(method, url, ...args) {
  // Handle different URL parameter types
  const urlStr = typeof url === 'string' ? url : (url && url.toString ? url.toString() : '');
  if (urlStr && (urlStr.includes('events.mapbox.com') || urlStr.includes('api.mapbox.com/events'))) {
    this._blocked = true;
    return;
  }
  return originalXHROpen.apply(this, [method, url, ...args]);
};

XMLHttpRequest.prototype.send = function(data) {
  if (this._blocked) {
    return;
  }
  return originalXHRSend.apply(this, arguments);
};

mapboxgl.accessToken = MAPBOX_TOKEN;

const map = new mapboxgl.Map({
  container:       'map',
  style:           MAP_STYLE,
  center:          [-73.885, 40.835],
  zoom:            14.5,
  pitch:           60,
  bearing:         -45,
  antialias:       true,
  scrollZoom:      false,
  dragRotate:      false,
  touchZoomRotate: false,
  keyboard:        false,
  // Disable Mapbox events/telemetry
  trackResize:     true,
  attributionControl: {
    compact: true
  }
});

map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

// ── Load everything on style ready ───────────────────────────────────────────

map.on('load', () => {

  // 3D terrain — exaggeration 1.5 carves the Cross Bronx trench into the DEM
  // Handle Canvas2D limitation in private browsing/fingerprinting protection
  try {
    map.addSource('mapbox-dem', {
      type:     'raster-dem',
      url:      'mapbox://mapbox.mapbox-terrain-dem-v1',
      tileSize: 512,
      maxzoom:  14,
    });
    map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
    console.log('✅ 3D terrain loaded successfully');
  } catch (terrainError) {
    console.warn('⚠️ 3D terrain disabled due to Canvas2D limitations:', terrainError.message);
    // Continue without terrain - map will still work but flat
  }

  // Fetch all data sources in parallel; community layers degrade gracefully to
  // null if their files are missing — STURLA is the only hard dependency.
  const sturlaFetch = fetch(GEOJSON_PATH)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status} — ${GEOJSON_PATH}`);
      return r.json();
    })
    .then(data => {
      // Validate STURLA data structure
      if (!data || !data.features || !Array.isArray(data.features)) {
        throw new Error('Invalid STURLA data structure');
      }
      // Ensure all features have required properties
      data.features = data.features.filter(feature => {
        if (!feature.properties) return false;
        // Ensure pm25_concentration is a number or can be converted
        if (feature.properties.pm25_concentration !== null &&
            feature.properties.pm25_concentration !== undefined) {
          feature.properties.pm25_concentration = parseFloat(feature.properties.pm25_concentration) || 0;
        }
        return true;
      });
      return data;
    });

  const maskFetch = fetch(MASK_PATH)
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  const s311Fetch = fetch(S311_PATH)
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  const floodFetch = fetch(FLOOD_PATH)
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  const communityFetch = fetch(COMMUNITY_PATH)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data || !data.features) return null;
      // Validate and clean community data
      data.features = data.features.filter(feature => {
        if (!feature.properties) return false;
        // Ensure urgency is a number
        if (feature.properties.urgency !== null && 
            feature.properties.urgency !== undefined) {
          feature.properties.urgency = parseFloat(feature.properties.urgency) || 0;
        }
        return true;
      });
      return data;
    })
    .catch(() => null);

  const highwayFetch = fetch(HIGHWAY_PATH)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status} — ${HIGHWAY_PATH}`);
      return r.json();
    });

  const sturlaFinalFetch = fetch(STURLA_FINAL_PATH)
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

  Promise.all([sturlaFetch, maskFetch, s311Fetch, floodFetch, communityFetch, highwayFetch, sturlaFinalFetch])
    .then(([geojson, maskGeojson, s311, flood, community, highway, sturlaFinal]) => {
      addBuildings();
      addSturlaLayer(geojson, sturlaFinal);         // glow uses sturla_final_classes if available
      addHighwayZones(highway);                     // all highway layers start hidden
      addCommunityLayers(s311, flood, community);   // all community layers start hidden
      if (maskGeojson) addMaskLayers(maskGeojson);  // mask always on top
      hideLoading();
      setChapterLayers('chapter-1');                // init to chapter-1 state
    })
    .catch(err => {
      console.error('[app.js] Failed to load STURLA data:', err.message);
      console.error('Fix: python south-bronx-map/sturla_analysis.py');
      hideLoading('No data — run sturla_analysis.py');
    });

});

// ── 3D Buildings — ghosted context massing ───────────────────────────────────
// Added before STURLA so data extrusions always render on top.

function addBuildings() {
  try {
    // Check if composite source exists in the style
    const style = map.getStyle();
    const hasCompositeSource = style && style.sources && style.sources.composite;
    
    if (hasCompositeSource) {
      map.addLayer({
        id:             '3d-buildings',
        source:         'composite',
        'source-layer': 'building',
        filter:         ['==', 'extrude', 'true'],
        type:           'fill-extrusion',
        minzoom:        13,
        paint: {
          'fill-extrusion-color':   '#FFFFFF',
          'fill-extrusion-height':  ['get', 'height'],
          'fill-extrusion-base':    ['get', 'min_height'],
          'fill-extrusion-opacity': 0.3,
        },
      });
      console.log('✅ 3D buildings layer added successfully');
    } else {
      console.warn('⚠️ Composite source not found in map style - 3D buildings disabled');
    }
  } catch (buildingsError) {
    console.warn('⚠️ Failed to add 3D buildings layer:', buildingsError.message);
    // Continue without buildings - map will still work
  }
}

// ── STURLA Neon Glow + Volumetric Fog ─────────────────────────────────────────
// Three-layer stack replicating the Mapbox Studio "duplicate & blur" glow hack:
//   1. sturla-glow-fill  — flat fill at 0.7 opacity (the "bottom" blurred copy)
//   2. sturla-glow-blur  — line layer with line-blur:8 on cell edges (the blur)
//   3. sturla-extrusion  — fill-extrusion at 0.35 opacity (the crisp top copy)
//
// Color key (sturla_class):
//   p   →  harsh neon red   (#FF0044)   — paved / high PM2.5
//   tpl →  mid grey         (#666666)   — trees/paved/light
//   tg  →  bright cyan      (#00FFCC)   — trees/green / residential

function addSturlaLayer(geojson, sturlaFinal) {

  // Source for the 3D extrusion — uses sturla_grid_with_percentages.geojson (has pm25_concentration + sturla_class)
  map.addSource('sturla-grid', {
    type: 'geojson',
    data: geojson,
  });

  // Source for glow layers — uses sturla_grid_with_percentages.geojson (has pct_building/pct_pave/pct_green)
  // Falls back to sturla-grid if the file wasn't loaded.
  const glowSource = sturlaFinal ? 'sturla-final' : 'sturla-grid';
  if (sturlaFinal) {
    map.addSource('sturla-final', { type: 'geojson', data: sturlaFinal });
    console.log(`[app.js] ${sturlaFinal.features.length} sturla_grid_with_percentages cells loaded.`);
  }

  // Color expression: whichever of pct_building / pct_pave / pct_green is highest
  // wins. This avoids 'b is in every compound class' problem.
  const finalColorExpr = [
    'case',
    // pct_building > both others → harsh red
    ['>',
      ['to-number', ['get', 'pct_building'], 0],
      ['max',
        ['to-number', ['get', 'pct_pave'], 0],
        ['to-number', ['get', 'pct_green'], 0]
      ]
    ], '#FF0044',
    // pct_green > pct_pave (building already lost above) → bright cyan
    ['>',
      ['to-number', ['get', 'pct_green'], 0],
      ['to-number', ['get', 'pct_pave'], 0]
    ], '#00FFCC',
    // Trees and pavement mixed → purple
    ['all',
      ['==', ['get', 'sturla_class'], 'tp']
    ], '#9966FF',
    // Buildings and pavement mixed → dark orange
    ['all',
      ['==', ['get', 'sturla_class'], 'bp']
    ], '#CC5500',
    // Pavement only → red
    ['all',
      ['==', ['get', 'sturla_class'], 'p']
    ], '#FF0044',
    // Additional classes
    ['all',
      ['==', ['get', 'sturla_class'], 'h']
    ], '#FFD700',     // honey - high vegetation
    ['all',
      ['==', ['get', 'sturla_class'], 'bwp']
    ], '#8B4513',    // olive - building + water + pavement
    ['all',
      ['==', ['get', 'sturla_class'], 'm']
    ], '#4CAF50',     // brown - mixed moderate
    ['all',
      ['==', ['get', 'sturla_class'], 'gw']
    ], '#2196F3',    // indigo - green + water
    ['all',
      ['==', ['get', 'sturla_class'], 'tgw']
    ], '#9C27B0',    // teal - trees + green + water
    // Default for any other classes
    '#333333'
  ];

  // Updated color expression for all STURLA classes from latest analysis
  const legacyColorExpr = [
    'match', ['get', 'sturla_class'],
    'p',   '#FF0044',     // harsh neon red — paved / high PM2.5
    'bp',  '#FF6600',     // orange — buildings + pavement
    'gp',  '#FFAA00',     // yellow-orange — grass + pavement
    'tg',  '#00FFCC',     // bright cyan — trees + grass / residential
    'bpg', '#9966FF',     // purple — mixed urban
    'tp',  '#66FF66',     // lime — trees + pavement
    'g',   '#00CC66',     // green — grass only
    'b',   '#CC66CC',     // magenta — buildings only
    '#333333'              // dark grey — other/unknown
  ];

  const glowColorExpr  = sturlaFinal ? finalColorExpr : legacyColorExpr;

  // ── LAYER 1: Glow base fill — the "bottom duplicate" ──────────────────────
  // Flat fill at high opacity. Provides the solid colour ground plane that
  // the blur layer will radiate outward from.
  map.addLayer({
    id:     'sturla-glow-fill',
    type:   'fill',
    source: glowSource,
    paint: {
      'fill-color':   glowColorExpr,
      'fill-opacity': 0.7,
    },
  });

  // ── LAYER 2: Blur hack — the "5–10 px blur" duplicate ─────────────────────
  // Mapbox GL JS has no fill-blur. A wide line layer on polygon edges with
  // line-blur:8 spreads colour ~30–40 m outward from each cell boundary,
  // creating the radiating neon halo seen in the Studio blur reference.
  map.addLayer({
    id:     'sturla-glow-blur',
    type:   'line',
    source: glowSource,
    paint: {
      'line-color':   glowColorExpr,
      'line-width':   18,
      'line-blur':     8,
      'line-opacity': 0.45,
    },
  });

  // ── LAYER 3a: Ambient grid — non-paved cells, flat + muted ───────────────
  // All cells where sturla_class != 'p'. Flat height (0) so they read as a
  // ground plane. Muted mint at 0.25 opacity.
  map.addLayer({
    id:     'sturla-ambient',
    type:   'fill-extrusion',
    source: 'sturla-grid',
    filter: ['!=', ['get', 'sturla_class'], 'p'],
    layout: { 'visibility': 'none' },
    paint: {
      'fill-extrusion-color':   '#a8dadc',
      'fill-extrusion-opacity': 0.25,
      'fill-extrusion-height':  0,
      'fill-extrusion-base':    0,
    },
  });

  // ── LAYER 3b: Trench spikes — paved (class 'p'), crimson, full PM2.5 height ─
  // The "Atmospheric Trap" zone. Height = pm25_concentration × 100 so an 18 µg/m³
  // cell reads as 1,800 m — a visible crimson spike above the ambient plane.
  map.addLayer({
    id:     'sturla-trench',
    type:   'fill-extrusion',
    source: 'sturla-grid',
    filter: ['==', ['get', 'sturla_class'], 'p'],
    layout: { 'visibility': 'none' },
    paint: {
      'fill-extrusion-color':             '#e63946',
      'fill-extrusion-opacity':           0.85,
      'fill-extrusion-height': [
        '*', ['to-number', ['get', 'pm25_concentration'], 0], 100
      ],
      'fill-extrusion-base':              0,
      'fill-extrusion-vertical-gradient': true,
    },
  });

  // Optional: Add subtle grid outline for definition (much lighter than before)
  map.addLayer({
    id:     'sturla-outline',
    type:   'line',
    source: 'sturla-grid',
    paint: {
      'line-color': [
        'match', ['get', 'sturla_class'],
        'p',   'rgba(255, 0, 85, 0.3)',   // Paved — neon crimson
        'tpl', 'rgba(255, 204, 0, 0.2)',  // Trees/Paved/Light — neon yellow
        'tg',  'rgba(0, 255, 170, 0.15)', // Trees/Green — neon mint
        'rgba(128, 128, 128, 0.1)'        // fallback
      ],
      'line-width': [
        'match', ['get', 'sturla_class'],
        'p', 0.6,
             0.2
      ],
    },
  });

  // ── Hover tooltip — minimal, follows cursor, dismisses on leave ─────────────
  const hoverTip = new mapboxgl.Popup({
    closeButton:  false,
    closeOnClick: false,
    className:    'sturla-popup',
    offset:       8,
  });

  map.on('mousemove', 'sturla-trench', e => {
    map.getCanvas().style.cursor = 'pointer';
    const p = e.features[0].properties;
    const pm25 = p.pm25_concentration || p.dist_to_cbe || 0;
    hoverTip.setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:Inter,sans-serif;font-size:11px;line-height:1.5;padding:3px 6px">
          <strong style="font-size:12px;font-weight:700;color:#e63946">${parseFloat(pm25).toFixed(1)} µg/m³</strong>
          &nbsp;<code style="font-size:10px;font-weight:700;background:rgba(0,0,0,0.08);padding:0 3px">${p.sturla_class}</code><br>
          <span style="color:#9A9A9A;font-size:10px">Paved — high exposure · click for detail</span>
        </div>`)
      .addTo(map);
  });

  map.on('mouseleave', 'sturla-trench', () => {
    map.getCanvas().style.cursor = '';
    hoverTip.remove();
  });

  map.on('mousemove', 'sturla-ambient', e => {
    map.getCanvas().style.cursor = 'pointer';
    const p = e.features[0].properties;
    const pm25 = p.pm25_concentration || p.dist_to_cbe || 0;
    hoverTip.setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:Inter,sans-serif;font-size:11px;line-height:1.5;padding:3px 6px">
          <strong style="font-size:12px;font-weight:700">${parseFloat(pm25).toFixed(1)} µg/m³</strong>
          &nbsp;<code style="font-size:10px;font-weight:700;background:rgba(0,0,0,0.08);padding:0 3px">${p.sturla_class}</code><br>
          <span style="color:#9A9A9A;font-size:10px">Vegetated / ambient · click for detail</span>
        </div>`)
      .addTo(map);
  });

  map.on('mouseleave', 'sturla-ambient', () => {
    map.getCanvas().style.cursor = '';
    hoverTip.remove();
  });

  // ── Click popup — full cell inspection card ───────────────────────────────
  const classLabels = {
    p:   'Paved — Trench Zone',
    tpl: 'Trees / Paved / Light',
    tg:  'Trees / Green',
  };

  const inspectPopup = new mapboxgl.Popup({
    closeButton:  true,
    closeOnClick: true,
    className:    'sturla-inspect',
    offset:       [0, -6],
    maxWidth:     '268px',
  });

  ['sturla-trench', 'sturla-ambient'].forEach(layerId => map.on('click', layerId, e => {
    hoverTip.remove();
    const p = e.features[0].properties;
    const pm25 = p.pm25_concentration || p.dist_to_cbe || 0;
    const label = classLabels[p.sturla_class] || p.sturla_class;
    const inTrench = p.sturla_class === 'p';

    inspectPopup.setLngLat(e.lngLat)
      .setHTML(`
        <div style="font-family:Inter,'Helvetica Neue',sans-serif">
          <div style="font-size:9px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;
                      color:#9A9A9A;padding:12px 14px 8px;border-bottom:1px solid #ECECEC">
            ${inTrench ? '<span style="color:#e63946">▲ Paved / High Exposure</span>' : 'Cell Inspection'}
          </div>
          <div style="padding:8px 12px">
            <strong style="font-size:14px;color:#e63946">${parseFloat(pm25).toFixed(2)} µg/m³</strong>
            <br><code style="font-size:11px;font-weight:700;background:rgba(0,0,0,0.08);padding:2px 4px">${label}</code>
            ${inTrench ? '<br><span style="color:#9A9A9A;font-size:10px">High PM2.5 exposure zone • Paved surface with trapped pollutants</span>' : '<br><span style="color:#9A9A9A;font-size:10px">Click for detailed land cover breakdown</span>'}
          </div>
            </tr>
            <tr style="border-bottom:1px solid #ECECEC">
              <td style="padding:8px 14px;color:#555555;font-weight:500">Predicted PM2.5</td>
              <td style="padding:8px 14px;font-weight:700;color:#C8321A;text-align:right">${pm} µg/m³</td>
            </tr>
            <tr>
              <td style="padding:8px 14px;color:#555555;font-weight:500">Land Cover</td>
              <td style="padding:8px 14px;font-weight:600;text-align:right;font-size:11px">${Math.round(p.pct_green)}% green / ${Math.round(p.pct_pave)}% paved</td>
            </tr>
          </table>
        </div>`)
      .addTo(map);
  }));

  console.log(`[app.js] ${geojson.features.length} STURLA cells loaded.`);
}

// ── Diorama mask layers ───────────────────────────────────────────────────────

function addMaskLayers(maskGeojson) {
  // Flood-fill — paints page background (#F9F9F9) over everything outside
  // the South Bronx bounding box, creating the floating diorama effect.
  map.addSource('diorama-mask', { type: 'geojson', data: maskGeojson });
  map.addLayer({
    id:     'diorama-fill',
    type:   'fill',
    source: 'diorama-mask',
    paint: {
      'fill-color':   '#F9F9F9',
      'fill-opacity': 1,
    },
  });

  // Architectural frame — 1.5 px black line traces the study-area boundary
  map.addSource('diorama-frame', { type: 'geojson', data: BRONX_FRAME });
  map.addLayer({
    id:     'diorama-frame-line',
    type:   'line',
    source: 'diorama-frame',
    paint: {
      'line-color': '#1A1A1A',
      'line-width': 1.5,
    },
  });
}

// ── Highway zoning layer — trench vs elevated corridor ───────────────────────
// Both layers start with visibility:none. Chapter 2 onward reveals them.
// Two stacked layers on the trench produce the glow effect (blur halo + core).

function addHighwayZones(highwayData) {

  // Add the Cross Bronx Expressway data source
  map.addSource('cross-bronx-source', {
    type: 'geojson',
    data: highwayData
  });

  // Trench halo — wide blurred layer for glow
  map.addLayer({
    id:     'highway-trench',
    type:   'line',
    source: 'cross-bronx-source',
    filter: ['==', ['get', 'zone'], 'trench'],
    layout: {
      'line-cap':   'round',
      'line-join':  'round',
      'visibility': 'none',
    },
    paint: {
      'line-color':   '#FF3333',
      'line-width':   8,
      'line-blur':    4,
      'line-opacity': 0.85,
    },
  });

  // Trench core — bright centre line on top of the halo
  map.addLayer({
    id:     'highway-trench-core',
    type:   'line',
    source: 'cross-bronx-source',
    filter: ['==', ['get', 'zone'], 'trench'],
    layout: {
      'line-cap':   'round',
      'line-join':  'round',
      'visibility': 'none',
    },
    paint: {
      'line-color':   '#FF3333',
      'line-width':   2.5,
      'line-opacity': 1,
    },
  });

  // Elevated approach — infrastructure blue
  map.addLayer({
    id:     'highway-elevated',
    type:   'line',
    source: 'cross-bronx-source',
    filter: ['==', ['get', 'zone'], 'elevated'],
    layout: {
      'line-cap':   'round',
      'line-join':  'round',
      'visibility': 'none',
    },
    paint: {
      'line-color':   '#3B82F6',
      'line-width':   4,
      'line-opacity': 0.75,
    },
  });
}

// ── Community data layers — 311, FloodNet, NLP testimony ─────────────────────
// All layers start hidden (visibility:none). Chapter 3 reveals them.
// Each argument can be null if the file was not found — layers degrade silently.

function addCommunityLayers(s311, flood, community) {

  // ── 311 Complaints — amber circles, sized by complaint count ──────────────
  if (s311) {
    map.addSource('311-data', { type: 'geojson', data: s311 });
    map.addLayer({
      id:     '311-circles',
      type:   'circle',
      source: '311-data',
      layout: { 'visibility': 'none' },
      paint: {
        'circle-color':        '#F59E0B',
        'circle-opacity':      0.75,
        'circle-stroke-color': '#1A1A1A',
        'circle-stroke-width': 0.5,
        'circle-radius': [
          'interpolate', ['linear'],
          ['to-number', ['get', 'count'], 1],
          1,  4,
          50, 14,
        ],
      },
    });

    map.on('mouseenter', '311-circles', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', '311-circles', () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('click', '311-circles', e => {
      const p = e.features[0].properties;
      new mapboxgl.Popup({ offset: 8, maxWidth: '240px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-family:Inter,sans-serif;font-size:12px;padding:10px 14px">
            <div style="font-size:9px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;
                        color:#9A9A9A;margin-bottom:8px">311 Complaint Cluster</div>
            <div style="font-weight:700;font-size:20px;color:#F59E0B;line-height:1">${p.count}</div>
            <div style="font-size:11px;color:#555555;margin-top:4px;font-weight:600;text-transform:capitalize">
              ${(p.dominant_category || p.complaint_type || '').replace(/_/g, ' ')}
            </div>
            <div style="font-size:10px;color:#9A9A9A;margin-top:6px">
              Density score: ${parseFloat(p.density_score).toFixed(3)}
            </div>
          </div>`)
        .addTo(map);
    });

    console.log(`[app.js] ${s311.features.length} 311 complaint clusters loaded.`);
  }

  // ── FloodNet Sensors — blue circles, sized by flood event count ───────────
  if (flood) {
    map.addSource('floodnet-data', { type: 'geojson', data: flood });
    map.addLayer({
      id:     'floodnet-circles',
      type:   'circle',
      source: 'floodnet-data',
      layout: { 'visibility': 'none' },
      paint: {
        'circle-color':        '#3B82F6',
        'circle-opacity':      0.8,
        'circle-stroke-color': '#1A1A1A',
        'circle-stroke-width': 1,
        'circle-radius': [
          'interpolate', ['linear'],
          ['to-number', ['get', 'flood_event_count'], 1],
          1,  6,
          10, 18,
        ],
      },
    });

    map.on('mouseenter', 'floodnet-circles', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'floodnet-circles', () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('click', 'floodnet-circles', e => {
      const p = e.features[0].properties;
      new mapboxgl.Popup({ offset: 8, maxWidth: '240px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-family:Inter,sans-serif;font-size:12px;padding:10px 14px">
            <div style="font-size:9px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;
                        color:#9A9A9A;margin-bottom:8px">FloodNet Sensor — ${p.sensor_id}</div>
            <div style="font-weight:700;font-size:13px;color:#1A1A1A">${p.location_name}</div>
            <div style="font-weight:700;font-size:18px;color:#3B82F6;margin-top:8px;line-height:1">
              ${p.peak_depth_cm}&nbsp;<span style="font-size:12px;font-weight:400">cm peak</span>
            </div>
            <div style="font-size:11px;color:#555555;margin-top:4px">
              ${p.flood_event_count} flood events recorded
            </div>
            <div style="font-size:10px;color:#9A9A9A;margin-top:4px">
              Last event: ${p.last_event_date}
            </div>
          </div>`)
        .addTo(map);
    });

    console.log(`[app.js] ${flood.features.length} FloodNet sensors loaded.`);
  }

  // ── Community NLP Testimony — coloured by risk category, sized by urgency ──
  if (community) {
    map.addSource('community-data', { type: 'geojson', data: community });
    map.addLayer({
      id:     'community-circles',
      type:   'circle',
      source: 'community-data',
      layout: { 'visibility': 'none' },
      paint: {
        'circle-color': [
          'match', ['get', 'risk_category'],
          'flood',        '#3B82F6',   // blue
          'air_quality',  '#C8321A',   // forensic red
          'heat',         '#F59E0B',   // amber
          'displacement', '#7C3AED',   // purple
          '#9A9A9A'                    // fallback grey
        ],
        'circle-opacity':      0.85,
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 1.5,
        'circle-radius': [
          'interpolate', ['linear'],
          ['to-number', ['get', 'urgency'], 0],
          0, 5,
          1, 16,
        ],
      },
    });

    map.on('mouseenter', 'community-circles', () => {
      map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'community-circles', () => {
      map.getCanvas().style.cursor = '';
    });
    map.on('click', 'community-circles', e => {
      const p = e.features[0].properties;

      // Mapbox serialises array properties to JSON strings — parse defensively.
      let places = [];
      try {
        places = typeof p.places_mentioned === 'string'
          ? JSON.parse(p.places_mentioned)
          : (Array.isArray(p.places_mentioned) ? p.places_mentioned : []);
      } catch (_) { /* ignore */ }

      const categoryLabel = (p.risk_category || '').replace(/_/g, ' ');

      new mapboxgl.Popup({ offset: 8, maxWidth: '300px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-family:Inter,sans-serif;font-size:12px;padding:10px 14px">
            <div style="font-size:9px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;
                        color:#9A9A9A;margin-bottom:8px">Community Testimony</div>
            <div style="font-size:10px;font-weight:700;text-transform:capitalize;color:#555555;
                        margin-bottom:8px;letter-spacing:0.05em">${categoryLabel}</div>
            <p style="font-style:italic;line-height:1.6;color:#1A1A1A;font-size:12px;
                      margin-bottom:8px;border-left:3px solid #ECECEC;padding-left:10px">
              "${p.quote}"
            </p>
            <div style="display:flex;gap:12px;font-size:10px;color:#9A9A9A">
              <span>Urgency: <strong style="color:#1A1A1A">${parseFloat(p.urgency).toFixed(2)}</strong></span>
              ${places.length ? `<span>${places.join(', ')}</span>` : ''}
            </div>
          </div>`)
        .addTo(map);
    });

    console.log(`[app.js] ${community.features.length} community testimony nodes loaded.`);
  }
}

// ── setChapterLayers — toggle layer visibility for the active chapter ─────────
// Guards with map.getLayer() so missing layers (e.g. if data fetch failed)
// don't throw and break the scroll experience.

function setChapterLayers(chapterKey) {
  const config = CHAPTER_LAYERS[chapterKey];
  if (!config) return;

  config.show.forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
  });
  config.hide.forEach(id => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  });
}

// ── IntersectionObserver — scroll drives both camera and layer visibility ─────

const sectionLabelIndex = document.getElementById('section-label-index');
const sectionLabelText  = document.getElementById('section-label-text');

function flyToView(viewKey) {
  const view = SECTION_VIEWS[viewKey];
  if (!view) return;

  // Cinematic views (speed + curve set) use Mapbox's own flight math.
  // DO NOT mix with duration/easing — they are mutually exclusive.
  const flyParams = {
    center:  view.center,
    zoom:    view.zoom,
    bearing: view.bearing,
    pitch:   view.pitch,
  };

  if (view.speed != null) {
    flyParams.speed = view.speed;   // 0.3 = ~¼ of default pace
    flyParams.curve = view.curve;   // 1.0 = linear arc, no zoom-out bulge
  } else {
    flyParams.duration = 2200;
    flyParams.easing   = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  map.flyTo(flyParams);

  sectionLabelText.style.opacity = '0';
  setTimeout(() => {
    const parts = view.label.split('—');
    sectionLabelIndex.textContent = parts[0] ? parts[0].trim() : '—';
    sectionLabelText.textContent  = parts[1] ? parts[1].trim() : view.label;
    sectionLabelText.style.opacity = '1';
  }, 300);
}

const observer = new IntersectionObserver(
  entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const viewKey = entry.target.dataset.view;
      if (viewKey) {
        flyToView(viewKey);
        setChapterLayers(viewKey);
      }

      document.querySelectorAll('.interview-section').forEach(s =>
        s.classList.remove('is-active')
      );
      entry.target.classList.add('is-active');
    });
  },
  {
    root:      document.getElementById('scroll-panel'),
    threshold: 0.45,
  }
);

document.querySelectorAll('.interview-section').forEach(s => observer.observe(s));

flyToView('chapter-1');

// ── Helpers ───────────────────────────────────────────────────────────────────

function hideLoading(msg) {
  const el = document.getElementById('map-loading');
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.style.color = '#C8321A';
  } else {
    el.classList.add('hidden');
  }
}
