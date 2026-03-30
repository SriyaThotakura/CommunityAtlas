/**
 * map_community.js
 * ================
 * Adds three toggleable community data layers to an existing Leaflet map.
 *
 * Usage (after Leaflet, Turf.js, D3 + d3-hexbin, and Chart.js are loaded):
 *   initCommunityLayers(map, {
 *     nodesPath:   'data/community_nodes.geojson',   // optional — defaults shown
 *     s311Path:    'data/complaints_311.geojson',
 *     floodPath:   'data/floodnet_sensors.geojson',
 *   });
 *
 * Required script tags in your HTML (add before this file):
 *   <script src="https://unpkg.com/leaflet/dist/leaflet.js"></script>
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

  // ── Layer 1 — Community testimony (pulsing DivIcon) ────────────────────────

  function buildCommunityLayer(map, geojson) {
    const group = L.layerGroup();

    geojson.features.forEach(function (feat) {
      const p      = feat.properties;
      const coords = feat.geometry.coordinates;
      const color  = CAT_COLOR[p.risk_category] || '#888';
      const size   = Math.round(8 + (p.urgency || 0.5) * 18);  // 8–26 px
      const ringS  = size + 8;

      const html = `
        <div class="cl-node-wrap" style="width:${ringS}px;height:${ringS}px;">
          <div class="cl-pulse-ring" style="width:${ringS}px;height:${ringS}px;background:${color};"></div>
          <div class="cl-node-inner" style="width:${size}px;height:${size}px;
               top:${(ringS-size)/2}px;left:${(ringS-size)/2}px;background:${color};"></div>
        </div>`;

      const icon = L.divIcon({
        html,
        className: '',
        iconSize:   [ringS, ringS],
        iconAnchor: [ringS / 2, ringS / 2],
      });

      const marker = L.marker([coords[1], coords[0]], { icon });

      // Hover: highlight 311 complaints within 200 m (requires _s311Group set later)
      marker.on('mouseover', function () {
        if (map._cl_s311Group) {
          map._cl_s311Group.eachLayer(function (lyr) {
            if (lyr._latlng) {
              const d = lngLatDist(coords, [lyr._latlng.lng, lyr._latlng.lat]);
              if (d <= 200) lyr.setStyle && lyr.setStyle({ weight: 3, color: '#fff' });
            }
          });
        }
      });
      marker.on('mouseout', function () {
        if (map._cl_s311Group) {
          map._cl_s311Group.eachLayer(function (lyr) {
            lyr.setStyle && lyr.setStyle({ weight: 1, color: 'rgba(255,255,255,0.4)' });
          });
        }
      });

      // Click popup
      marker.on('click', function () {
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

        L.popup({ maxWidth: 280, className: 'cl-community-popup' })
          .setLatLng([coords[1], coords[0]])
          .setContent(popupHtml)
          .openOn(map);
      });

      marker.addTo(group);
    });

    return group;
  }

  // ── Layer 2 — 311 hexbin (D3 SVG overlay) ─────────────────────────────────

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

    // Create a positioned SVG in the overlay pane
    const overlayPane = map.getPanes().overlayPane;
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.style.cssText = 'position:absolute;top:0;left:0;overflow:visible;pointer-events:none;';
    overlayPane.appendChild(svgEl);

    const svg = d3.select(svgEl);
    const g   = svg.append('g').attr('class', 'cl-hexbin-g leaflet-zoom-hide');

    const colorScale = d3.scaleLinear()
      .domain([0, 0.4, 1])
      .range(['#EAF3DE', '#F4AA44', '#E24B4A']);

    let visible = true;

    function metersToPixels(meters) {
      const zoom    = map.getZoom();
      const lat     = map.getCenter().lat;
      const mPerPx  = (156543.03392 * Math.cos(lat * Math.PI / 180)) / Math.pow(2, zoom);
      return Math.max(10, Math.min(60, meters / mPerPx));
    }

    function render() {
      if (!visible) { g.style('display', 'none'); return; }
      g.style('display', '');

      const bounds  = map.getBounds();
      const topLeft = map.latLngToLayerPoint(bounds.getNorthWest());
      const hexR    = metersToPixels(300);

      // Sync SVG position
      const mapSize = map.getSize();
      svgEl.style.left   = topLeft.x + 'px';
      svgEl.style.top    = topLeft.y + 'px';
      svgEl.setAttribute('width',  mapSize.x);
      svgEl.setAttribute('height', mapSize.y);

      const hexbinFn = d3.hexbin().radius(hexR);

      const pts = geojson.features
        .filter(function (f) {
          return bounds.contains([f.geometry.coordinates[1], f.geometry.coordinates[0]]);
        })
        .map(function (f) {
          const lp = map.latLngToLayerPoint([
            f.geometry.coordinates[1],
            f.geometry.coordinates[0],
          ]);
          const pt = [lp.x - topLeft.x, lp.y - topLeft.y];
          pt.density  = f.properties.density_score || 0;
          pt.ctype    = f.properties.complaint_type || 'UNKNOWN';
          pt.count    = f.properties.count || 1;
          pt.breakdown = f.properties.breakdown || {};
          return pt;
        });

      const bins = hexbinFn(pts);

      const hexes = g.selectAll('path.cl-hex').data(bins);

      hexes.enter()
        .append('path').attr('class', 'cl-hex')
        .merge(hexes)
        .attr('d', hexbinFn.hexagon())
        .attr('transform', function (d) { return 'translate(' + d.x + ',' + d.y + ')'; })
        .attr('fill', function (d) {
          const avg = d.reduce(function (s, p) { return s + p.density; }, 0) / d.length;
          return colorScale(avg);
        })
        .attr('fill-opacity', 0.65)
        .attr('stroke', 'rgba(255,255,255,0.5)')
        .attr('stroke-width', 0.8)
        .style('cursor', 'pointer')
        .style('pointer-events', 'auto')
        .on('click', function (event, d) {
          const avg  = d.reduce(function (s, p) { return s + p.density; }, 0) / d.length;
          const total = d.reduce(function (s, p) { return s + (p.count || 1); }, 0);

          // Aggregate breakdown
          const breakdown = {};
          d.forEach(function (p) {
            Object.entries(p.breakdown).forEach(function ([type, cnt]) {
              breakdown[type] = (breakdown[type] || 0) + cnt;
            });
          });

          const barsHtml = Object.entries(breakdown)
            .sort(function (a, b) { return b[1] - a[1]; })
            .map(function ([type, cnt]) {
              const pct = Math.round((cnt / total) * 100);
              return `<div style="margin:4px 0">
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px">
                  <span>${type}</span><strong>${cnt}</strong>
                </div>
                <div style="background:#eee;height:5px;border-radius:3px">
                  <div style="width:${pct}%;background:${colorScale(avg)};height:5px;border-radius:3px"></div>
                </div>
              </div>`;
            }).join('');

          const lp  = L.point(d.x + topLeft.x, d.y + topLeft.y);
          const ll  = map.layerPointToLatLng(lp);

          L.popup({ maxWidth: 240 })
            .setLatLng(ll)
            .setContent(`
              <div style="font-family:sans-serif">
                <strong style="color:#12345b">311 Complaint Cluster</strong>
                <div style="font-size:11px;color:#777;margin:4px 0">${total} complaints · density ${(avg*100).toFixed(0)}th pctile</div>
                ${barsHtml}
              </div>`)
            .openOn(map);
        });

      hexes.exit().remove();
    }

    map.on('moveend zoomend viewreset', render);
    render();

    return {
      show:       function () { visible = true;  render(); },
      hide:       function () { visible = false; render(); },
      isVisible:  function () { return visible; },
      getCount:   function () { return geojson.features.length; },
      _svgEl:     svgEl,
    };
  }

  // ── Layer 3 — FloodNet sensors (diamond DivIcon) ───────────────────────────

  function buildFloodnetLayer(map, geojson) {
    const group = L.layerGroup();

    // Store readings for sparklines keyed by sensor_id
    const readingsStore = {};

    geojson.features.forEach(function (feat) {
      const p      = feat.properties;
      const coords = feat.geometry.coordinates;

      // Colour by flood event frequency
      let color;
      if (p.flood_event_count >= 4)      color = '#E24B4A';
      else if (p.flood_event_count >= 1) color = '#EF9F27';
      else                               color = '#5DCAA5';

      const html = `<div class="cl-diamond" style="background:${color};"></div>`;
      const icon = L.divIcon({
        html,
        className:  '',
        iconSize:   [16, 16],
        iconAnchor: [8, 8],
      });

      const marker = L.marker([coords[1], coords[0]], { icon });

      marker.on('click', function () {
        const canvasId  = 'cl-spark-' + p.sensor_id.replace(/[^a-z0-9]/gi, '_');
        const readings  = readingsStore[p.sensor_id] || [];

        const sparkHtml = readings.length
          ? `<div class="cl-sparkline-wrap"><canvas id="${canvasId}" height="50" width="200"></canvas></div>`
          : `<div style="font-size:11px;color:#999;margin-top:6px;">No historical readings loaded</div>`;

        const statusText  = color === '#E24B4A' ? '⚠ High flood risk'
                          : color === '#EF9F27' ? '⚡ Moderate flood risk'
                          : '✓ Low flood risk';

        L.popup({ maxWidth: 260 })
          .setLatLng([coords[1], coords[0]])
          .setContent(`
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
            </div>`)
          .openOn(map);

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

      marker.addTo(group);
    });

    group._readingsStore = readingsStore;
    return group;
  }

  // ── Convergence zone detection ─────────────────────────────────────────────

  function detectConvergenceZones(map, communityData, s311Data, floodData) {
    if (typeof turf === 'undefined') {
      console.warn('[CommunityLayers] turf.js not loaded — convergence zones disabled.');
      return L.layerGroup();
    }

    const group = L.layerGroup();
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

    zones.forEach(function (node) {
      const nc = node.geometry.coordinates;
      const p  = node.properties;

      // Dashed coral circle
      const circle = L.circle([nc[1], nc[0]], {
        radius:    300,
        color:     '#E24B4A',
        weight:    2.5,
        dashArray: '8 5',
        fillColor: '#E24B4A',
        fillOpacity: 0.07,
      });
      circle.addTo(group);

      // Label
      const labelIcon = L.divIcon({
        html: '<div class="cl-conv-label">⚑ High Priority Zone</div>',
        className: '',
        iconAnchor: [60, 10],
      });
      L.marker([nc[1] + 0.0022, nc[0]], { icon: labelIcon }).addTo(group);

      circle.on('click', function () {
        L.popup({ maxWidth: 270 })
          .setLatLng([nc[1], nc[0]])
          .setContent(`
            <div class="cl-popup">
              <div class="cl-popup-title" style="color:#E24B4A">⚑ High Priority Convergence Zone</div>
              <div style="font-size:12px;color:#555;margin:6px 0;">
                This location has overlapping community testimony, 311 complaints
                (density &gt;0.6), and FloodNet flood events (&gt;2).
              </div>
              <div class="cl-quote">"${(p.quote||'').slice(0,180)}…"</div>
              <div style="font-size:11px;color:#999;margin-top:8px;">
                Risk: <strong style="color:${CAT_COLOR[p.risk_category]}">${CAT_LABEL[p.risk_category]||p.risk_category}</strong>
                · Urgency: ${Math.round((p.urgency||0)*100)}%
              </div>
              <div style="font-size:11px;color:#aaa;margin-top:4px;">
                Feeds CLT intervention placement engine
              </div>
            </div>`)
          .openOn(map);
      });
    });

    // Expose zone list for policy simulator
    group._zones = zones;
    return group;
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
      <label class="cl-toggle-row" id="cl-row-community">
        <input type="checkbox" checked>
        <span class="cl-swatch" style="background:${CAT_COLOR.flood};"></span>
        Community Testimony
        <span class="cl-badge" id="cl-badge-community">–</span>
      </label>
      <label class="cl-toggle-row" id="cl-row-s311">
        <input type="checkbox" checked>
        <span class="cl-swatch" style="background:#E24B4A;"></span>
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
          else             layers.map.removeLayer(layer);
        }
      });
    }

    bind('cl-row-community', 'cl-badge-community', layers.community,
         function () { return layers.communityCount; });
    bind('cl-row-s311',      'cl-badge-s311',      layers.s311,
         function () { return layers.s311Count; });
    bind('cl-row-flood',     'cl-badge-flood',      layers.flood,
         function () { return layers.floodCount; });
    bind('cl-row-conv',      'cl-badge-conv',       layers.conv,
         function () { return layers.convCount; });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * initCommunityLayers(map, options)
   *
   * @param {L.Map} map        Existing Leaflet map instance.
   * @param {object} [opts]
   *   nodesPath  {string}  Path to community_nodes.geojson
   *   s311Path   {string}  Path to complaints_311.geojson
   *   floodPath  {string}  Path to floodnet_sensors.geojson
   */
  function initCommunityLayers(map, opts) {
    opts = opts || {};
    const nodesPath = opts.nodesPath || 'data/community_nodes.geojson';
    const s311Path  = opts.s311Path  || 'data/complaints_311.geojson';
    const floodPath = opts.floodPath || 'data/floodnet_sensors.geojson';

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

    Promise.all([
      safeFetch(nodesPath, 'community_nodes'),
      safeFetch(s311Path,  '311_complaints'),
      safeFetch(floodPath, 'floodnet_sensors'),
    ]).then(function ([nodes, s311, flood]) {

      // Build layers
      const communityGroup = buildCommunityLayer(map, nodes);
      const hexbinLayer    = buildHexbinLayer(map, s311);
      const floodGroup     = buildFloodnetLayer(map, flood);

      // Add to map
      communityGroup.addTo(map);
      if (!hexbinLayer) {
        // Fallback: simple circle markers if D3 hexbin unavailable
        buildCircleFallback(map, s311).addTo(map);
      }
      floodGroup.addTo(map);

      // Store 311 group reference so community nodes can highlight neighbours
      map._cl_s311Group = hexbinLayer ? null : map._cl_s311Fallback;

      // Convergence zones (needs all three datasets)
      const convGroup = detectConvergenceZones(map, nodes, s311, flood);
      convGroup.addTo(map);

      // Expose for policy simulator
      map._cl_communityData = nodes;
      map._cl_s311Data      = s311;
      map._cl_floodData     = flood;
      map._cl_convZones     = convGroup._zones || [];

      // Toggle panel
      buildTogglePanel({
        map,
        community:      communityGroup,
        communityCount: nodes.features.length,
        s311:           hexbinLayer,
        s311Count:      s311.features.length,
        flood:          floodGroup,
        floodCount:     flood.features.length,
        conv:           convGroup,
        convCount:      (convGroup._zones || []).length,
      });

      console.log(
        '[CommunityLayers] Loaded — nodes:', nodes.features.length,
        '· 311:', s311.features.length,
        '· sensors:', flood.features.length,
        '· convergence zones:', (convGroup._zones || []).length
      );
    });
  }

  // Fallback when D3-hexbin not available: simple circles
  function buildCircleFallback(map, geojson) {
    const group = L.layerGroup();
    geojson.features.forEach(function (f) {
      const c = f.geometry.coordinates;
      const r = 6 + (f.properties.density_score || 0) * 12;
      L.circleMarker([c[1], c[0]], {
        radius: r, color: '#E24B4A', fillColor: '#E24B4A',
        fillOpacity: 0.45, weight: 1,
      }).bindTooltip(f.properties.complaint_type + ' (' + f.properties.count + ')').addTo(group);
    });
    map._cl_s311Fallback = group;
    return group;
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  global.initCommunityLayers = initCommunityLayers;
  global._clCatColor         = CAT_COLOR;     // used by policy_simulator_nlp.js
  global._clCatLabel         = CAT_LABEL;

}(window));
