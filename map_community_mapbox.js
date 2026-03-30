/**
 * map_community_mapbox.js
 * ===================
 * Adds three toggleable community data layers to an existing Mapbox GL JS map.
 *
 * Usage (after Mapbox GL JS, Turf.js, D3 + d3-hexbin, and Chart.js are loaded):
 *   initCommunityLayers(map, {
 *     nodesPath:   'south-bronx-map/data/community_nodes.geojson',   // optional — defaults shown
 *     s311Path:    'south-bronx-map/data/complaints_311.geojson',
 *     floodPath:   'south-bronx-map/data/floodnet_sensors.geojson',
 *   });
 *
 * Required script tags in your HTML (add before this file):
 *   <script src="https://api.mapbox.com/mapbox-gl-js/v3.2.0/mapbox-gl.js"></script>
 *   <script src="https://unpkg.com/@turf/turf/turf.min.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/d3-hexbin@0.2/build/d3-hexbin.min.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
 */

(function (global) {
  'use strict';

  // ── Palette / constants ────────────────────────────────────────────────────

  const CAT_COLOR = {
    flood:        '#3B8BD4',
    air_quality:  '#D85A30',
    heat:         '#EF9F27',
    displacement: '#7F77DD',
  };

  const CAT_LABEL = {
    flood:        'Flood',
    air_quality:  'Air Quality',
    heat:         'Heat',
    displacement: 'Displacement',
  };

  const INTERVENTION_COLORS = {
    'CLT Buffer':       '#7F77DD',
    'Tree Corridor':    '#4CAF50',
    'Rain Garden':      '#3B8BD4',
    'Permeable Paving': '#EF9F27',
  };

  // ── CSS injection ──────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('cl-community-styles')) return;
    const style = document.createElement('style');
    style.id = 'cl-community-styles';
    style.textContent = `
      /* Pulsing community node */
      .cl-pulse-ring {
        border-radius: 50%;
        animation: cl-pulse 2s ease-out infinite;
        opacity: 0.55;
        position: absolute;
        top: 0; left: 0;
      }
      @keyframes cl-pulse {
        0%   { transform: scale(1);   opacity: 0.55; }
        60%  { transform: scale(1.6); opacity: 0.15; }
        100% { transform: scale(1.6); opacity: 0;    }
      }
      .cl-node-inner {
        border-radius: 50%;
        border: 2.5px solid rgba(255,255,255,0.85);
        box-shadow: 0 2px 6px rgba(0,0,0,0.35);
        position: absolute;
        top: 0; left: 0;
        cursor: pointer;
      }
      .cl-node-wrap {
        position: relative;
        pointer-events: none;
      }
      .cl-node-inner { pointer-events: auto; }

      /* FloodNet diamond marker */
      .cl-diamond {
        width: 14px; height: 14px;
        transform: rotate(45deg);
        border: 2px solid rgba(255,255,255,0.9);
        box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        cursor: pointer;
      }

      /* Convergence zone label */
      .cl-conv-label {
        background: rgba(229,75,65,0.88);
        color: #fff;
        font-weight: 700;
        font-size: 11px;
        padding: 3px 7px;
        border-radius: 10px;
        white-space: nowrap;
        box-shadow: 0 1px 5px rgba(0,0,0,0.3);
        pointer-events: none;
      }

      /* Layer toggle panel */
      #cl-layer-panel {
        position: absolute;
        top: 12px; right: 12px;
        z-index: 1000;
        background: rgba(255,255,255,0.96);
        border-radius: 12px;
        padding: 12px 14px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.18);
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-size: 13px;
        min-width: 220px;
      }
      #cl-layer-panel h4 {
        margin: 0 0 10px;
        font-size: 13px;
        color: #12345b;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .cl-toggle-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 7px 0;
        cursor: pointer;
        user-select: none;
      }
      .cl-toggle-row input[type=checkbox] { cursor: pointer; }
      .cl-swatch {
        width: 16px; height: 16px;
        border-radius: 3px;
        flex: 0 0 auto;
      }
      .cl-badge {
        margin-left: auto;
        background: #eef;
        color: #334;
        font-size: 11px;
        font-weight: 700;
        padding: 1px 6px;
        border-radius: 8px;
        min-width: 22px;
        text-align: center;
      }

      /* Popup styling */
      .cl-popup { font-family: 'Helvetica Neue', Arial, sans-serif; min-width: 200px; }
      .cl-popup-title { font-weight: 700; font-size: 14px; color: #12345b; margin-bottom: 6px; }
      .cl-cat-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 700;
        color: #fff;
        margin-bottom: 8px;
      }
      .cl-urgency-bar-wrap {
        background: #eee;
        border-radius: 4px;
        height: 6px;
        margin: 6px 0 4px;
      }
      .cl-urgency-bar {
        height: 6px;
        border-radius: 4px;
        background: linear-gradient(90deg, #EF9F27, #E24B4A);
      }
      .cl-agency-label {
        font-size: 11px;
        font-weight: 600;
        padding: 2px 7px;
        border-radius: 8px;
        display: inline-block;
        margin-top: 4px;
      }
      .cl-quote {
        font-size: 12px;
        color: #444;
        line-height: 1.55;
        margin-top: 8px;
        border-left: 3px solid #ccc;
        padding-left: 8px;
        font-style: italic;
      }
      .cl-sparkline-wrap { margin-top: 8px; }
    `;
    document.head.appendChild(style);
  }

  // ── Geometry helpers ───────────────────────────────────────────────────────

  function lngLatDist(a, b) {
    // haversine, metres
    const R = 6371000;
    const dLat = (b[1] - a[1]) * Math.PI / 180;
    const dLng = (b[0] - a[0]) * Math.PI / 180;
    const sinA = Math.sin(dLat / 2), sinB = Math.sin(dLng / 2);
    const q = sinA * sinA + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * sinB * sinB;
    return R * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
  }

  // ── Layer 1 — Community testimony (custom markers) ────────────────────────

  function buildCommunityLayer(map, geojson) {
    const features = geojson.features;
    const markers = [];

    features.forEach(function (feat) {
      const p      = feat.properties;
      const coords = feat.geometry.coordinates;
      const color  = CAT_COLOR[p.risk_category] || '#888';
      const size   = Math.round(8 + (p.urgency || 0.5) * 18);  // 8–26 px
      const ringS  = size + 8;

      const el = document.createElement('div');
      el.className = 'cl-node-wrap';
      el.style.width = ringS + 'px';
      el.style.height = ringS + 'px';
      el.innerHTML = `
        <div class="cl-pulse-ring" style="width:${ringS}px;height:${ringS}px;background:${color};"></div>
        <div class="cl-node-inner" style="width:${size}px;height:${size}px;
             top:${(ringS-size)/2}px;left:${(ringS-size)/2}px;background:${color};"></div>
      `;

      const popup = new mapboxgl.Popup({
        offset: [0, -ringS/2],
        closeButton: false,
        closeOnClick: false
      });

      // Create popup content
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        
        const catColor  = CAT_COLOR[p.risk_category] || '#888';
        const urgencyPct = Math.round((p.urgency || 0) * 100);
        const agencyText = p.agency ? 'Solution-oriented' : 'Problem description';
        const agencyBg   = p.agency ? '#4CAF50' : '#E57373';

        const shortQ = p.quote && p.quote.length > 220
          ? p.quote.slice(0, 220) + '…'
          : (p.quote || '');

        const placesHtml = p.places_mentioned && p.places_mentioned.length
          ? `<div style="font-size:11px;color:#666;margin-top:6px;">
               📍 ${p.places_mentioned.slice(0, 3).join(', ')}
             </div>`
          : '';

        const popupHtml = `
          <div class="cl-popup">
            <div class="cl-popup-title">Community Voice</div>
            <span class="cl-cat-badge" style="background:${catColor};">
              ${CAT_LABEL[p.risk_category] || p.risk_category}
            </span>
            <div class="cl-urgency-bar-wrap">
              <div class="cl-urgency-bar" style="width:${urgencyPct}%"></div>
            </div>
            <div style="font-size:11px;color:#888;">Urgency: ${urgencyPct}%</div>
            <span class="cl-agency-label" style="background:${agencyBg};color:#fff;">
              ${agencyText}
            </span>
            <div class="cl-quote">"${shortQ}"</div>
            ${placesHtml}
          </div>`;

        popup.setLngLat(coords).setHTML(popupHtml).addTo(map);
      });

      el.addEventListener('mouseenter', function () {
        // Highlight nearby 311 complaints
        if (map._cl_s311Features) {
          map.setPaintProperty('cl-s311-layer', 'circle-opacity', [
            'case',
            ['<=', ['number', ['distance', ['geometry'], ['literal', coords]]], 200], 0.9,
            0.3
          ]);
        }
      });

      el.addEventListener('mouseleave', function () {
        if (map._cl_s311Features) {
          map.setPaintProperty('cl-s311-layer', 'circle-opacity', 0.65);
        }
      });

      const marker = new mapboxgl.Marker({
        element: el,
        anchor: 'center',
        offset: [0, 0]
      }).setLngLat(coords);

      marker._popup = popup;
      markers.push(marker);
    });

    return {
      addTo: function () {
        markers.forEach(marker => marker.addTo(map));
      },
      remove: function () {
        markers.forEach(marker => marker.remove());
      },
      getMarkers: function () { return markers; }
    };
  }

  // ── Layer 2 — 311 hexbin (Mapbox GL JS layers) ───────────────────────────────

  function buildHexbinLayer(map, geojson) {
    if (typeof d3 === 'undefined') {
      console.warn('[CommunityLayers] d3 not loaded — 311 hexbin layer disabled.');
      return null;
    }
    if (typeof d3.hexbin === 'undefined') {
      console.warn('[CommunityLayers] d3-hexbin not loaded — 311 hexbin layer disabled. ' +
        'Add <script src="https://cdn.jsdelivr.net/npm/d3-hexbin@0.2/build/d3-hexbin.min.js">');
      return null;
    }

    // Store features for interaction
    map._cl_s311Features = geojson.features;

    // Add source and layer
    map.addSource('cl-s311-source', {
      type: 'geojson',
      data: geojson
    });

    const colorScale = d3.scaleLinear()
      .domain([0, 0.4, 1])
      .range(['#EAF3DE', '#F4AA44', '#E24B4A']);

    map.addLayer({
      id: 'cl-s311-layer',
      type: 'circle',
      source: 'cl-s311-source',
      paint: {
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['get', 'density_score'],
          0, 4,
          1, 12
        ],
        'circle-color': [
          'interpolate',
          ['linear'],
          ['get', 'density_score'],
          0, '#EAF3DE',
          0.4, '#F4AA44',
          1, '#E24B4A'
        ],
        'circle-opacity': 0.65,
        'circle-stroke-color': 'rgba(255,255,255,0.5)',
        'circle-stroke-width': 0.8
      }
    });

    // Click handler for 311 complaints
    map.on('click', 'cl-s311-layer', function (e) {
      const features = e.features;
      if (!features || features.length === 0) return;

      const feat = features[0];
      const props = feat.properties;
      const coords = feat.geometry.coordinates;

      const popupHtml = `
        <div style="font-family:sans-serif">
          <strong style="color:#12345b">311 Complaint</strong>
          <div style="font-size:11px;color:#777;margin:4px 0">
            ${props.complaint_type || 'Unknown'} · density ${Math.round((props.density_score || 0) * 100)}th pctile
          </div>
          <div style="font-size:12px">
            Count: <strong>${props.count || 1}</strong>
          </div>
        </div>`;

      new mapboxgl.Popup()
        .setLngLat(coords)
        .setHTML(popupHtml)
        .addTo(map);
    });

    map.on('mouseenter', 'cl-s311-layer', function () {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'cl-s311-layer', function () {
      map.getCanvas().style.cursor = '';
    });

    return {
      show: function () {
        map.setLayoutProperty('cl-s311-layer', 'visibility', 'visible');
      },
      hide: function () {
        map.setLayoutProperty('cl-s311-layer', 'visibility', 'none');
      },
      isVisible: function () {
        return map.getLayoutProperty('cl-s311-layer', 'visibility') !== 'none';
      },
      getCount: function () { return geojson.features.length; }
    };
  }

  // ── Layer 3 — FloodNet sensors (custom markers) ───────────────────────────

  function buildFloodnetLayer(map, geojson) {
    const features = geojson.features;
    const markers = [];
    const readingsStore = {};

    features.forEach(function (feat) {
      const p      = feat.properties;
      const coords = feat.geometry.coordinates;

      // Colour by flood event frequency
      let color;
      if (p.flood_event_count >= 4)      color = '#E24B4A';
      else if (p.flood_event_count >= 1) color = '#EF9F27';
      else                               color = '#5DCAA5';

      const el = document.createElement('div');
      el.className = 'cl-diamond';
      el.style.background = color;

      const popup = new mapboxgl.Popup({
        offset: [0, -8],
        closeButton: false,
        closeOnClick: false
      });

      el.addEventListener('click', function (e) {
        e.stopPropagation();
        
        const canvasId  = 'cl-spark-' + p.sensor_id.replace(/[^a-z0-9]/gi, '_');
        const readings  = readingsStore[p.sensor_id] || [];

        const sparkHtml = readings.length
          ? `<div class="cl-sparkline-wrap"><canvas id="${canvasId}" height="50" width="200"></canvas></div>`
          : `<div style="font-size:11px;color:#999;margin-top:6px;">No historical readings loaded</div>`;

        const statusText  = color === '#E24B4A' ? '⚠ High flood risk'
                          : color === '#EF9F27' ? '⚡ Moderate flood risk'
                          : '✓ Low flood risk';

        const popupHtml = `
          <div class="cl-popup">
            <div class="cl-popup-title">${p.location_name}</div>
            <div style="font-size:11px;color:${color};font-weight:700;margin-bottom:6px;">${statusText}</div>
            <table style="font-size:12px;width:100%;border-collapse:collapse">
              <tr><td style="color:#666;padding:2px 0">Peak depth</td>
                  <td style="text-align:right;font-weight:700">${p.peak_depth_cm} cm</td></tr>
              <tr><td style="color:#666;padding:2px 0">Flood events (12 mo)</td>
                  <td style="text-align:right;font-weight:700">${p.flood_event_count}</td></tr>
              <tr><td style="color:#666;padding:2px 0">Last event</td>
                  <td style="text-align:right">${p.last_event_date}</td></tr>
              <tr><td style="color:#666;padding:2px 0">Sensor ID</td>
                  <td style="text-align:right;font-size:10px;color:#aaa">${p.sensor_id}</td></tr>
            </table>
            ${sparkHtml}
          </div>`;

        popup.setLngLat(coords).setHTML(popupHtml).addTo(map);

        // Render sparkline after popup DOM is ready
        if (readings.length && typeof Chart !== 'undefined') {
          setTimeout(function () {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            new Chart(canvas, {
              type: 'line',
              data: {
                labels: readings.map(function (r) { return r.date || ''; }),
                datasets: [{
                  data:         readings.map(function (r) { return r.depth || 0; }),
                  borderColor:  color,
                  borderWidth:  1.5,
                  pointRadius:  0,
                  fill:         true,
                  backgroundColor: color + '22',
                  tension:      0.3,
                }],
              },
              options: {
                plugins:  { legend: { display: false } },
                scales:   {
                  x: { display: false },
                  y: { display: true, grid: { color: '#eee' }, ticks: { font: { size: 10 } } },
                },
                animation: false,
              },
            });
          }, 50);
        }
      });

      const marker = new mapboxgl.Marker({
        element: el,
        anchor: 'center',
        offset: [0, 0]
      }).setLngLat(coords);

      marker._popup = popup;
      markers.push(marker);
    });

    return {
      addTo: function () {
        markers.forEach(marker => marker.addTo(map));
      },
      remove: function () {
        markers.forEach(marker => marker.remove());
      },
      getMarkers: function () { return markers; },
      _readingsStore: readingsStore
    };
  }

  // ── Convergence zone detection ─────────────────────────────────────────────

  function detectConvergenceZones(map, communityData, s311Data, floodData) {
    if (typeof turf === 'undefined') {
      console.warn('[CommunityLayers] turf.js not loaded — convergence zones disabled.');
      return { addTo: function () {}, remove: function () {}, _zones: [] };
    }

    const zones = [];

    communityData.features.forEach(function (node) {
      const nc = node.geometry.coordinates;  // [lng, lat]

      // Check 311 density > 0.6 within 300 m
      const near311 = s311Data.features.some(function (f) {
        return (
          f.properties.density_score > 0.6 &&
          lngLatDist(nc, f.geometry.coordinates) <= 300
        );
      });

      // Check FloodNet flood_event_count > 2 within 300 m
      const nearFlood = floodData.features.some(function (f) {
        return (
          f.properties.flood_event_count > 2 &&
          lngLatDist(nc, f.geometry.coordinates) <= 300
        );
      });

      if (near311 && nearFlood) {
        zones.push(node);
      }
    });

    console.log('[CommunityLayers] Convergence zones detected:', zones.length);

    // Create convergence zone features
    const convergenceFeatures = zones.map(function (node) {
      const nc = node.geometry.coordinates;
      return {
        type: 'Feature',
        properties: {
          ...node.properties,
          zone_type: 'convergence'
        },
        geometry: {
          type: 'Point',
          coordinates: nc
        }
      };
    });

    // Add source and layers for convergence zones
    map.addSource('cl-convergence-source', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: convergenceFeatures
      }
    });

    // Circle layer for convergence zones
    map.addLayer({
      id: 'cl-convergence-circles',
      type: 'circle',
      source: 'cl-convergence-source',
      paint: {
        'circle-radius': 24, // ~300m at typical zoom
        'circle-color': '#E24B4A',
        'circle-opacity': 0.07,
        'circle-stroke-color': '#E24B4A',
        'circle-stroke-width': 2.5,
        'circle-stroke-opacity': 0.8
      }
    });

    // Symbol layer for labels
    map.addLayer({
      id: 'cl-convergence-labels',
      type: 'symbol',
      source: 'cl-convergence-source',
      layout: {
        'text-field': '⚑ High Priority Zone',
        'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        'text-size': 11,
        'text-offset': [0, 2],
        'text-anchor': 'top'
      },
      paint: {
        'text-color': '#E24B4A',
        'text-halo-color': 'rgba(255,255,255,0.9)',
        'text-halo-width': 1
      }
    });

    // Click handler
    map.on('click', 'cl-convergence-circles', function (e) {
      const features = e.features;
      if (!features || features.length === 0) return;

      const feat = features[0];
      const props = feat.properties;
      const coords = feat.geometry.coordinates;

      const popupHtml = `
        <div class="cl-popup">
          <div class="cl-popup-title" style="color:#E24B4A">⚑ High Priority Convergence Zone</div>
          <div style="font-size:12px;color:#555;margin:6px 0;">
            This location has overlapping community testimony, 311 complaints
            (density >0.6), and FloodNet flood events (>2).
          </div>
          <div class="cl-quote">"${(props.quote||'').slice(0,180)}…"</div>
          <div style="font-size:11px;color:#999;margin-top:8px;">
            Risk: <strong style="color:${CAT_COLOR[props.risk_category]}">${CAT_LABEL[props.risk_category]||props.risk_category}</strong>
            · Urgency: ${Math.round((props.urgency||0)*100)}%
          </div>
          <div style="font-size:11px;color:#aaa;margin-top:4px;">
            Feeds CLT intervention placement engine
          </div>
        </div>`;

      new mapboxgl.Popup()
        .setLngLat(coords)
        .setHTML(popupHtml)
        .addTo(map);
    });

    map.on('mouseenter', 'cl-convergence-circles', function () {
      map.getCanvas().style.cursor = 'pointer';
    });

    map.on('mouseleave', 'cl-convergence-circles', function () {
      map.getCanvas().style.cursor = '';
    });

    return {
      addTo: function () {
        // Layers are already added to map
      },
      remove: function () {
        if (map.getLayer('cl-convergence-circles')) {
          map.removeLayer('cl-convergence-circles');
        }
        if (map.getLayer('cl-convergence-labels')) {
          map.removeLayer('cl-convergence-labels');
        }
        if (map.getSource('cl-convergence-source')) {
          map.removeSource('cl-convergence-source');
        }
      },
      _zones: zones
    };
  }

  // ── Layer toggle panel ─────────────────────────────────────────────────────

  function buildTogglePanel(layers) {
    // Remove old panel if re-initialising
    const old = document.getElementById('cl-layer-panel');
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = 'cl-layer-panel';

    panel.innerHTML = `
      <h4>Community Layers</h4>
      <label class="cl-toggle-row" id="cl-row-infra">
        <input type="checkbox" checked>
        <span class="cl-swatch" style="background:#FF6B35;transform:rotate(45deg);"></span>
        Infrastructural Conflicts
        <span class="cl-badge" id="cl-badge-infra">–</span>
      </label>
      <label class="cl-toggle-row" id="cl-row-community">
        <input type="checkbox" checked>
        <span class="cl-swatch" style="background:#E24B4A;"></span>
        Community Testimony
        <span class="cl-badge" id="cl-badge-community">–</span>
      </label>
      <label class="cl-toggle-row" id="cl-row-s311">
        <input type="checkbox" checked>
        <span class="cl-swatch" style="background:#3B8BD4;"></span>
        311 Complaints
        <span class="cl-badge" id="cl-badge-s311">–</span>
      </label>
      <label class="cl-toggle-row" id="cl-row-flood">
        <input type="checkbox" checked>
        <span class="cl-swatch" style="background:#5DCAA5;transform:rotate(45deg);"></span>
        FloodNet Sensors
        <span class="cl-badge" id="cl-badge-flood">–</span>
      </label>
      <label class="cl-toggle-row" id="cl-row-conv">
        <input type="checkbox" checked>
        <span class="cl-swatch" style="background:#E24B4A;opacity:0.6;border:2px dashed #E24B4A;"></span>
        Convergence Zones
        <span class="cl-badge" id="cl-badge-conv">–</span>
      </label>`;

    document.body.appendChild(panel);

    function bind(rowId, badgeId, layer, getCount) {
      const row = document.getElementById(rowId);
      if (!row || !layer) return;
      const cb = row.querySelector('input');

      // Set badge count
      const badge = document.getElementById(badgeId);
      if (badge && getCount) badge.textContent = getCount();

      cb.addEventListener('change', function () {
        if (cb.checked) {
          if (layer.show)  layer.show();   // hexbin layer
          else             layer.addTo(layers.map);
        } else {
          if (layer.hide)  layer.hide();
          else             layer.remove();
        }
      });
    }

    bind('cl-row-infra', 'cl-badge-infra', layers.infra, function () { return layers.infraCount; });
    bind('cl-row-community', 'cl-badge-community', layers.community, function () { return layers.communityCount; });
    bind('cl-row-s311', 'cl-badge-s311', layers.s311, function () { return layers.s311Count; });
    bind('cl-row-flood', 'cl-badge-flood', layers.flood, function () { return layers.floodCount; });
    bind('cl-row-conv', 'cl-badge-conv', layers.conv, function () { return (layers.convCount || 0); });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * initCommunityLayers(map, options)
   *
   * @param {mapboxgl.Map} map  Existing Mapbox GL JS map instance.
   * @param {object} [opts]
   *   nodesPath  {string}  Path to community_nodes.geojson
   *   s311Path   {string}  Path to complaints_311.geojson
   *   floodPath  {string}  Path to floodnet_sensors.geojson
   */
  function initCommunityLayers(map, opts) {
    console.log('initCommunityLayers called with:', opts);
    opts = opts || {};
    const nodesPath = opts.nodesPath || 'south-bronx-map/data/community_nodes.geojson';
    const s311Path  = opts.s311Path  || 'south-bronx-map/data/complaints_311.geojson';
    const floodPath = opts.floodPath || 'south-bronx-map/data/floodnet_sensors.geojson';

    console.log('Data paths:', { nodesPath, s311Path, floodPath });
    injectStyles();

    // Graceful fetch with fallback to empty FeatureCollection
    function safeFetch(url, label) {
      return fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
          return r.json();
        })
        .catch(function (e) {
          console.warn('[CommunityLayers] Could not load ' + label + ' (' + url + '):', e.message);
          return { type: 'FeatureCollection', features: [] };
        });
    }

    console.log('Starting to fetch data files...');
    Promise.all([
      safeFetch(nodesPath, 'community_nodes'),
      safeFetch(s311Path,  '311_complaints'),
      safeFetch(floodPath, 'floodnet_sensors'),
    ]).then(function ([nodes, s311, flood]) {
      console.log('Data loaded:', {
        nodes: nodes.features.length,
        s311: s311.features.length,
        flood: flood.features.length
      });

      // Convergence zones (needs all three datasets)
      const convLayer = detectConvergenceZones(map, nodes, s311, flood);
      convLayer.addTo(map);

      // Expose for policy simulator
      map._cl_communityData = nodes;
      map._cl_s311Data      = s311;
      map._cl_floodData     = flood;
      map._cl_convZones     = convLayer._zones || [];

      // Toggle panel
      buildTogglePanel({
        map,
        community:      communityLayer,
        communityCount: nodes.features.length,
        s311:           hexbinLayer,
        s311Count:      s311.features.length,
        flood:          floodLayer,
        floodCount:     flood.features.length,
        conv:           convLayer,
        convCount:      (convLayer._zones || []).length,
      });

      console.log(
        '[CommunityLayers] Loaded — nodes:', nodes.features.length,
        '· 311:', s311.features.length,
        '· sensors:', flood.features.length,
        '· convergence zones:', (convLayer._zones || []).length
      );
    });
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  global.initCommunityLayers = initCommunityLayers;
  global._clCatColor         = CAT_COLOR;     // used by policy_simulator_nlp.js
  global._clCatLabel         = CAT_LABEL;

}(window));
