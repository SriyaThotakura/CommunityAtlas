/**
 * policy_simulator_nlp.js
 * =======================
 * Upgrades an existing tactical console with NLP-driven intervention ranking.
 * All logic is client-side — no backend required.
 *
 * Usage (after map_community.js has initialised):
 *   initPolicySimulator(map, { containerId: 'my-console-div' });
 *
 * The simulator reads map._cl_communityData, map._cl_s311Data,
 * map._cl_floodData, and map._cl_convZones — all set by map_community.js.
 */

(function (global) {
  'use strict';

  // ── Seed keyword sets (mirror of Python pipeline) ──────────────────────────

  const SEED_KEYWORDS = {
    flood:        ['water','flooding','storm','drain','basement','rain','sewer','overflow','flood','puddle'],
    air_quality:  ['truck','diesel','smell','asthma','breathe','pollution','exhaust','dust','fumes','emission','air'],
    heat:         ['hot','summer','cool','shade','tree','temperature','heatwave','cooling','heat','pavement','ac'],
    displacement: ['rent','eviction','landlord','moved','afford','housing','gentrification','leave','price','tenant'],
  };

  // ── Intervention catalogue ─────────────────────────────────────────────────
  // complaint_reduction: estimated % 311 complaint reduction based on research
  // best_for: risk categories this intervention primarily addresses

  const INTERVENTIONS = [
    {
      name:                'Rain Garden',
      best_for:            ['flood'],
      complaint_reduction: { flood: 0.35, air_quality: 0.05, heat: 0.12, displacement: 0.02 },
      description:         'Bioretention areas absorb stormwater runoff, reducing basement flooding and drain overflow events.',
      color:               '#3B8BD4',
    },
    {
      name:                'Permeable Paving',
      best_for:            ['flood', 'heat'],
      complaint_reduction: { flood: 0.28, air_quality: 0.04, heat: 0.15, displacement: 0.01 },
      description:         'Allows stormwater infiltration, reduces surface runoff and urban heat island effect.',
      color:               '#EF9F27',
    },
    {
      name:                'Tree Corridor',
      best_for:            ['heat', 'air_quality'],
      complaint_reduction: { flood: 0.10, air_quality: 0.25, heat: 0.40, displacement: 0.05 },
      description:         'Street tree canopy reduces heat exposure by 4–8°C and absorbs particulate matter from diesel traffic.',
      color:               '#4CAF50',
    },
    {
      name:                'CLT Buffer',
      best_for:            ['displacement', 'air_quality'],
      complaint_reduction: { flood: 0.05, air_quality: 0.15, heat: 0.08, displacement: 0.45 },
      description:         'Community Land Trust permanently removes land from speculative market, anchoring affordable housing and enabling green infrastructure.',
      color:               '#7F77DD',
    },
  ];

  // ── ABM damping factor lookup per intervention rank ────────────────────────
  // Simulates spread reduction when fed back into existing ABM engine

  const ABM_DAMPING = { 1: 0.38, 2: 0.24, 3: 0.14, 4: 0.07 };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function keywordScore(text, keywords) {
    const t = text.toLowerCase();
    return keywords.reduce(function (n, kw) { return n + (t.includes(kw) ? 1 : 0); }, 0);
  }

  function classifyText(text) {
    const scores = {};
    Object.keys(SEED_KEYWORDS).forEach(function (cat) {
      scores[cat] = keywordScore(text, SEED_KEYWORDS[cat]);
    });
    const best = Object.keys(scores).reduce(function (a, b) {
      return scores[a] >= scores[b] ? a : b;
    });
    return { category: best, scores };
  }

  function lngLatDist(a, b) {
    const R = 6371000;
    const dLat = (b[1] - a[1]) * Math.PI / 180;
    const dLng = (b[0] - a[0]) * Math.PI / 180;
    const sinA = Math.sin(dLat / 2), sinB = Math.sin(dLng / 2);
    const q = sinA * sinA + Math.cos(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * sinB * sinB;
    return R * 2 * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
  }

  /**
   * Score each intervention for a given risk category and convergence zone.
   * Components:
   *   1. complaint_reduction potential for the category (0–1)
   *   2. community mention frequency in category nodes (0–1, normalised)
   *   3. FloodNet sensor proximity bonus (0–0.2)
   */
  function rankInterventions(category, zoneNode, floodData) {
    const zoneLng = zoneNode ? zoneNode.geometry.coordinates[0] : null;
    const zoneLat = zoneNode ? zoneNode.geometry.coordinates[1] : null;

    // Count community nodes per category for mention frequency
    const communityData = (global.map && global.map._cl_communityData) || { features: [] };
    const catNodes = communityData.features.filter(function (f) {
      return f.properties.risk_category === category;
    });
    const maxCatCount = Math.max(1, catNodes.length);

    const ranked = INTERVENTIONS.map(function (iv) {
      // Component 1: complaint reduction
      const c1 = iv.complaint_reduction[category] || 0;

      // Component 2: mention frequency (how relevant to this category)
      const mentionScore = iv.best_for.includes(category)
        ? catNodes.length / maxCatCount
        : 0;
      const c2 = mentionScore * 0.4;  // weight 0.4

      // Component 3: FloodNet proximity bonus
      let c3 = 0;
      if (zoneLng !== null && floodData && floodData.features) {
        const nearSensor = floodData.features.find(function (f) {
          return (
            f.properties.flood_event_count > 0 &&
            lngLatDist([zoneLng, zoneLat], f.geometry.coordinates) <= 500
          );
        });
        if (nearSensor) c3 = Math.min(0.2, nearSensor.properties.flood_event_count * 0.025);
      }

      return {
        intervention: iv,
        score:        Math.min(1, c1 + c2 + c3),
        c1, c2, c3,
      };
    });

    ranked.sort(function (a, b) { return b.score - a.score; });
    return ranked;
  }

  /**
   * Find top N convergence zones most relevant to a risk category.
   * Relevance = zone's risk_category match + urgency.
   */
  function findTopZones(category, convZones, n) {
    n = n || 3;
    const scored = (convZones || []).map(function (z) {
      const match = z.properties.risk_category === category ? 0.5 : 0;
      return { zone: z, relevance: match + (z.properties.urgency || 0) };
    });
    scored.sort(function (a, b) { return b.relevance - a.relevance; });
    return scored.slice(0, n).map(function (s) { return s.zone; });
  }

  /** Pick a supporting community quote from nodes near a zone. */
  function pickSupportingQuote(category, zoneNode, communityData) {
    if (!zoneNode || !communityData) return null;
    const zc = zoneNode.geometry.coordinates;
    const candidates = (communityData.features || [])
      .filter(function (f) {
        return (
          f.properties.risk_category === category &&
          f.properties.urgency > 0.6 &&
          lngLatDist(zc, f.geometry.coordinates) <= 600
        );
      })
      .sort(function (a, b) { return b.properties.urgency - a.properties.urgency; });

    return candidates.length ? candidates[0].properties.quote : null;
  }

  // ── Animated ring on map ───────────────────────────────────────────────────

  let _activeRingLayer = null;

  function highlightZoneOnMap(map, zoneNode) {
    if (_activeRingLayer) map.removeLayer(_activeRingLayer);
    if (!zoneNode) return;

    const nc = zoneNode.geometry.coordinates;
    _activeRingLayer = L.circle([nc[1], nc[0]], {
      radius:      320,
      color:       '#E24B4A',
      weight:      3,
      dashArray:   '6 4',
      fillOpacity: 0,
      opacity:     0.9,
      className:   'cl-highlight-ring',
    }).addTo(map);

    // Pulse CSS
    if (!document.getElementById('cl-ring-pulse-style')) {
      const s = document.createElement('style');
      s.id = 'cl-ring-pulse-style';
      s.textContent = `
        @keyframes cl-ring-pulse {
          0%   { stroke-opacity: 0.9; stroke-width: 3; }
          50%  { stroke-opacity: 0.3; stroke-width: 7; }
          100% { stroke-opacity: 0.9; stroke-width: 3; }
        }
        .cl-highlight-ring path { animation: cl-ring-pulse 1.5s ease-in-out infinite; }
      `;
      document.head.appendChild(s);
    }

    map.setView([nc[1], nc[0]], Math.max(map.getZoom(), 15), { animate: true, duration: 0.8 });
  }

  // ── UI builder ─────────────────────────────────────────────────────────────

  function injectSimulatorStyles() {
    if (document.getElementById('cl-sim-styles')) return;
    const s = document.createElement('style');
    s.id = 'cl-sim-styles';
    s.textContent = `
      #cl-policy-sim {
        position: absolute;
        bottom: 14px; left: 14px;
        z-index: 1000;
        background: rgba(255,255,255,0.97);
        border-radius: 14px;
        padding: 14px 16px;
        box-shadow: 0 4px 18px rgba(0,0,0,0.18);
        font-family: 'Helvetica Neue', Arial, sans-serif;
        font-size: 13px;
        width: 310px;
        max-height: 85vh;
        overflow-y: auto;
      }
      #cl-policy-sim h4 {
        margin: 0 0 10px;
        font-size: 13px;
        color: #12345b;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      #cl-sim-input {
        width: 100%;
        box-sizing: border-box;
        min-height: 70px;
        border: 1.5px solid #dde;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 12px;
        font-family: inherit;
        resize: vertical;
        outline: none;
        transition: border-color 0.2s;
      }
      #cl-sim-input:focus { border-color: #3B8BD4; }
      #cl-sim-submit {
        width: 100%;
        margin-top: 8px;
        padding: 8px;
        background: #12345b;
        color: #fff;
        border: none;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.2s;
      }
      #cl-sim-submit:hover { background: #1b4f8a; }
      #cl-sim-output { margin-top: 12px; }
      .cl-sim-cat-chip {
        display: inline-block;
        padding: 3px 10px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 700;
        color: #fff;
        margin-bottom: 8px;
      }
      .cl-iv-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin: 8px 0;
        padding: 8px;
        border-radius: 8px;
        border: 1.5px solid #eee;
        transition: border-color 0.2s;
      }
      .cl-iv-row:first-child { border-color: #cce; background: #f5f5ff; }
      .cl-iv-rank {
        width: 20px; height: 20px;
        border-radius: 50%;
        background: #12345b;
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        display: flex; align-items: center; justify-content: center;
        flex: 0 0 auto;
      }
      .cl-iv-dot {
        width: 12px; height: 12px;
        border-radius: 3px;
        flex: 0 0 auto;
        margin-top: 4px;
      }
      .cl-iv-name { font-weight: 700; font-size: 12px; color: #12345b; }
      .cl-iv-desc { font-size: 11px; color: #666; line-height: 1.4; margin-top: 2px; }
      .cl-iv-score-bar {
        height: 4px;
        border-radius: 2px;
        margin-top: 5px;
      }
      .cl-abm-badge {
        display: inline-block;
        margin-top: 10px;
        padding: 4px 10px;
        background: #e8f5e9;
        color: #2e7d32;
        border-radius: 8px;
        font-size: 11px;
        font-weight: 700;
      }
      .cl-sim-quote {
        font-size: 11px;
        color: #555;
        font-style: italic;
        line-height: 1.5;
        border-left: 3px solid #3B8BD4;
        padding-left: 8px;
        margin: 10px 0 0;
      }
      .cl-sim-zone-info {
        font-size: 11px;
        color: #888;
        margin-top: 6px;
      }
      .cl-sim-empty {
        font-size: 12px;
        color: #aaa;
        text-align: center;
        padding: 16px 0;
      }
    `;
    document.head.appendChild(s);
  }

  function renderResults(outputEl, result) {
    const catColors = global._clCatColor || {};
    const catLabels = global._clCatLabel || {};

    const catColor = catColors[result.category] || '#888';
    const catLabel = catLabels[result.category] || result.category;

    // Category chip
    let html = `
      <div>
        <span class="cl-sim-cat-chip" style="background:${catColor}">
          ${catLabel}
        </span>
        <span style="font-size:11px;color:#aaa;margin-left:6px">
          ${result.topZones.length} convergence zone${result.topZones.length !== 1 ? 's' : ''} identified
        </span>
      </div>`;

    // Zone info
    if (result.topZones.length) {
      const z = result.topZones[0];
      const nc = z.geometry.coordinates;
      html += `<div class="cl-sim-zone-info">
        📍 Top zone: ${nc[1].toFixed(4)}°N, ${Math.abs(nc[0]).toFixed(4)}°W
        · urgency ${Math.round((z.properties.urgency||0)*100)}%
      </div>`;
    } else {
      html += `<div class="cl-sim-zone-info" style="color:#E24B4A">
        ⚠ No convergence zones found — showing study-wide ranking
      </div>`;
    }

    // Intervention ranking
    html += '<div style="margin-top:10px;font-size:12px;font-weight:700;color:#12345b">Ranked Interventions</div>';

    result.ranked.forEach(function (item, idx) {
      const iv    = item.intervention;
      const pct   = Math.round(item.score * 100);
      const abmR  = Math.round((ABM_DAMPING[idx + 1] || 0.05) * 100);
      html += `
        <div class="cl-iv-row">
          <div class="cl-iv-rank">${idx + 1}</div>
          <div class="cl-iv-dot" style="background:${iv.color}"></div>
          <div style="flex:1;min-width:0">
            <div class="cl-iv-name">${iv.name}</div>
            <div class="cl-iv-desc">${iv.description}</div>
            <div class="cl-iv-score-bar" style="width:${pct}%;background:${iv.color}"></div>
            <div style="font-size:10px;color:#aaa;margin-top:3px">
              Score ${pct}% · ABM spread −${abmR}%
            </div>
          </div>
        </div>`;
    });

    // Top intervention ABM badge
    const topAbm = Math.round((ABM_DAMPING[1] || 0.38) * 100);
    html += `<div class="cl-abm-badge">
      ↓ ${topAbm}% projected ABM spread reduction with ${result.ranked[0].intervention.name}
    </div>`;

    // Supporting quote
    if (result.quote) {
      const short = result.quote.length > 200 ? result.quote.slice(0, 200) + '…' : result.quote;
      html += `<div class="cl-sim-quote">"${short}"</div>`;
    }

    outputEl.innerHTML = html;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * initPolicySimulator(map, opts)
   *
   * @param {L.Map} map
   * @param {object} [opts]
   *   containerId {string}  ID of an existing container div (optional).
   *                         If omitted a floating panel is created.
   */
  function initPolicySimulator(map, opts) {
    opts = opts || {};

    injectSimulatorStyles();

    let container = opts.containerId
      ? document.getElementById(opts.containerId)
      : null;

    if (!container) {
      const old = document.getElementById('cl-policy-sim');
      if (old) old.remove();
      container = document.createElement('div');
      container.id = 'cl-policy-sim';
      document.body.appendChild(container);
    }

    container.innerHTML = `
      <h4>Policy Simulator</h4>
      <textarea id="cl-sim-input"
        placeholder="Paste a community statement or policy text…
e.g. 'The flooding on my street after every storm destroys the basement storage'"></textarea>
      <button id="cl-sim-submit">Analyse &amp; Rank Interventions</button>
      <div id="cl-sim-output">
        <div class="cl-sim-empty">Enter text above to simulate interventions.</div>
      </div>`;

    const submitBtn = document.getElementById('cl-sim-submit');
    const outputEl  = document.getElementById('cl-sim-output');

    submitBtn.addEventListener('click', function () {
      const text = (document.getElementById('cl-sim-input').value || '').trim();
      if (!text) {
        outputEl.innerHTML = '<div class="cl-sim-empty" style="color:#E24B4A">Please enter some text first.</div>';
        return;
      }

      // Step 1 — classify
      const classification = classifyText(text);
      const { category } = classification;

      // Step 2 — find convergence zones
      const convZones = map._cl_convZones || [];
      const topZones  = findTopZones(category, convZones, 3);

      // Step 3 — rank interventions
      const floodData = map._cl_floodData || { features: [] };
      const topZone   = topZones[0] || null;
      const ranked    = rankInterventions(category, topZone, floodData);

      // Step 4 — supporting quote
      const communityData = map._cl_communityData || { features: [] };
      const quote         = pickSupportingQuote(category, topZone, communityData);

      // Highlight top zone on map
      highlightZoneOnMap(map, topZone);

      // Render
      renderResults(outputEl, { category, topZones, ranked, quote });
    });

    // Allow Enter key to submit (Shift+Enter = new line)
    document.getElementById('cl-sim-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitBtn.click();
      }
    });

    console.log('[PolicySimulator] Initialised.');
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  global.initPolicySimulator = initPolicySimulator;

}(window));
