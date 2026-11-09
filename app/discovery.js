/* Burton & Burton Property Intelligence — reusable discovery engine (v0.1.1)
 *
 * One engine for every neighborhood. Each project folder supplies:
 *   project.json     – titles, labels, map, filters, disclaimers
 *   properties.json  – the property records (see schema/property.schema.json)
 *   data.js          – generated copy of both (tools/build.py) so the page also
 *                      works when opened straight from disk (file://)
 *
 * Behaviour is carried over from Elgin Road v0.1. v0.1.1 fixes:
 *   - vacant lots showed "See source acres"
 *   - interest filter was missing "Not for us"; no filter above the top price cap
 *   - typed notes were lost when switching property before pressing Save
 *   - directory prices now carry an "est." label
 *   - all record text is HTML-escaped (data will come from automated pipelines)
 *   - CSV export uses readable interest labels and guards against spreadsheet formulas
 */
(function () {
  'use strict';

  var RATINGS = [
    ['love', '❤️ Love it', '❤️'],
    ['interested', '👍 Interested', '👍'],
    ['maybe', '🤔 Maybe', '🤔'],
    ['no', '✕ Not for us', '✕']
  ];
  var ratingLabel = {}, ratingIcon = {};
  RATINGS.forEach(function (r) { ratingLabel[r[0]] = r[1].replace(/^\S+\s/, ''); ratingIcon[r[0]] = r[2]; });

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function money(n) { return '$' + Number(n).toLocaleString('en-US'); }
  function $(id) { return document.getElementById(id); }

  async function load() {
    var cfg = null, props = null, gate = window.BBPI_GATE;
    if (gate) {                                  // published, encrypted site: wait for the welcome screen
      var unlocked = await gate.unlocked;
      cfg = unlocked.config; props = unlocked.properties;
      var img = await gate.asset(cfg.map.image);  // decrypted to a private in-memory URL
      cfg = Object.assign({}, cfg, { map: Object.assign({}, cfg.map, { image: img }) });
      return start(cfg, props, gate);
    }
    if (/^https?:$/.test(location.protocol)) {
      try {
        var res = await Promise.all([fetch('project.json', { cache: 'no-cache' }), fetch('properties.json', { cache: 'no-cache' })]);
        if (res[0].ok && res[1].ok) { cfg = await res[0].json(); props = await res[1].json(); }
      } catch (e) { /* fall back to bundle */ }
    }
    if ((!cfg || !props) && window.PROJECT_BUNDLE) { cfg = window.PROJECT_BUNDLE.config; props = window.PROJECT_BUNDLE.properties; }
    if (!cfg || !Array.isArray(props)) {
      document.body.innerHTML = '<p class="loaderror">Property data could not be loaded. If you opened this file directly, run <code>python3 tools/build.py</code> first.</p>';
      return;
    }
    start(cfg, props);
  }

  function lotAcres(x) {
    if (x.acres != null) return x.acres;
    var m = /([\d.]+)\s*ac\b/.exec(x.facts || '');   // acreage stated in the supplied facts line
    return m ? m[1] : null;
  }

  function shell(cfg, data, gate) {
    var homes = data.filter(function (x) { return x.type === 'Home'; }).length;
    var lots = data.filter(function (x) { return x.type === 'Vacant lot'; }).length;
    var counts = [];
    if (homes) counts.push(homes + (homes === 1 ? ' home' : ' homes'));
    if (lots) counts.push(lots + (lots === 1 ? ' vacant lot' : ' vacant lots'));
    if (cfg.introTagline) counts.push(cfg.introTagline);
    var m = cfg.map || {};
    document.title = cfg.pageTitle || cfg.headline;
    document.body.className = '';
    document.body.innerHTML =
      '<header><div><small>' + esc(cfg.locationLine) + '</small><h1>' + esc(cfg.headline) + '</h1><small>' + esc(cfg.subtitle) + '</small></div>' +
      '<div class="brand">' + (cfg.preparedBy || []).map(esc).join('<br>') + (cfg.edition ? '<br><span class="edition">' + esc(cfg.edition) + '</span>' : '') +
      (gate ? '<br><button class="lockbtn" id="lock" title="Close the collection on this device">Lock collection</button>' : '') + '</div></header>' +
      '<section class="intro"><div><h2>' + esc(cfg.introHeading) + '</h2><p>' + esc(counts.join(' · ')) + '</p></div><button id="export" class="primary">Export my selections ↓</button></section>' +
      '<main class="layout"><section class="mapcard"><div class="mapbar"><strong>' + esc(m.title) + '</strong><button id="zoom" class="toggle">Zoom map +</button></div>' +
      '<div class="mapframe" id="mapframe"><img src="' + esc(m.image) + '" alt="' + esc(m.alt) + '"></div>' +
      '<div class="mapnote">' + esc(m.note) + (m.credit ? '<span class="mapcredit">' + esc(m.credit) + '</span>' : '') + '</div></section>' +
      '<section class="side"><div class="toolbar"><input id="search" placeholder="Search address..." aria-label="Search address">' +
      '<select id="water" aria-label="Water relationship"><option value="">All water relationships</option>' + (cfg.waterOptions || []).map(function (w) { return '<option>' + esc(w) + '</option>'; }).join('') + '</select>' +
      '<select id="price" aria-label="Estimated value"><option value="">All estimated values</option>' + (cfg.priceBands || []).map(function (b, i) { return '<option value="' + i + '">' + esc(b.label) + '</option>'; }).join('') + '</select>' +
      '<select id="rating" aria-label="Your interest"><option value="">All properties</option>' + RATINGS.map(function (r) { return '<option value="' + r[0] + '">' + r[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="propertylist" id="list"></div><div class="profile" id="profile"></div></section></main>' +
      '<footer class="foot">' + esc(cfg.footer) + '</footer>';
  }

  function start(cfg, data, gate) {
    shell(cfg, data, gate);
    if (gate) $('lock').onclick = gate.lock;
    var key = cfg.storageKey || ('bb-' + cfg.id);
    var selected = data.find(function (x) { return x.number === cfg.defaultPropertyNumber; }) || data[0];
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { saved = {}; }

    function state() { return saved[selected.address] || { rating: '', notes: '' }; }
    function persist() { try { localStorage.setItem(key, JSON.stringify(saved)); } catch (e) { /* private mode */ } }

    function renderList() {
      var q = $('search').value.toLowerCase(), w = $('water').value, r = $('rating').value;
      var band = (cfg.priceBands || [])[$('price').value];
      var filtered = data.filter(function (x) {
        return x.address.toLowerCase().includes(q) && (!w || x.water === w) &&
          (!band || ((band.max == null || x.estimate <= band.max) && (band.min == null || x.estimate >= band.min))) &&
          (!r || (saved[x.address] || {}).rating === r);
      });
      $('list').innerHTML = filtered.map(function (x) {
        return '<div class="row ' + (x.address === selected.address ? 'selected' : '') + '" data-n="' + esc(x.number) + '">' +
          '<span><b>' + esc(x.address) + '</b><small>' + esc(x.water) + (x.type === 'Vacant lot' ? ' · vacant land' : '') + '</small></span>' +
          '<span style="text-align:right"><b><span class="est">EST.</span>' + money(x.estimate) + '</b><small>' + (ratingIcon[(saved[x.address] || {}).rating] || '') + '</small></span></div>';
      }).join('') || '<p style="padding:12px">No matching properties</p>';
      document.querySelectorAll('.row').forEach(function (el) {
        el.onclick = function () { selected = data.find(function (x) { return x.number === +el.dataset.n; }); render(); };
      });
    }

    function renderProfile() {
      var x = selected, s = state(), acres = lotAcres(x);
      var loved = Object.values(saved).filter(function (v) { return v.rating === 'love'; }).length;
      var interested = Object.values(saved).filter(function (v) { return v.rating === 'interested'; }).length;
      $('profile').innerHTML =
        '<div class="eyebrow">' + esc(x.type) + ' · ' + esc(cfg.locality) + '</div><h2>' + esc(x.address) + '</h2>' +
        '<div class="price">' + money(x.estimate) + '</div>' +
        '<div class="muted">Preliminary estimate · likely range ' + money(x.low) + '–' + money(x.high) + ' · ' + esc(String(x.confidence).toLowerCase()) + ' confidence</div>' +
        '<div class="specs">' +
        '<div class="spec"><label>Water relationship</label><b>' + esc(x.water) + (x.waterUnconfirmed ? ' (unconfirmed)' : '') + '</b></div>' +
        '<div class="spec"><label>Lot</label><b>' + (acres != null ? esc(acres) + ' acres' : '—') + '</b></div>' +
        '<div class="spec"><label>Bedrooms / baths</label><b>' + esc(x.beds != null ? x.beds : '—') + ' / ' + esc(x.baths != null ? x.baths : '—') + '</b></div>' +
        '<div class="spec"><label>Living area</label><b>' + (x.sqft ? Number(x.sqft).toLocaleString() + ' sq ft' : 'Land only') + '</b></div>' +
        '<div class="spec"><label>Year built</label><b>' + esc(x.year || '—') + '</b></div>' +
        '<div class="spec"><label>Research confidence</label><b>' + esc(x.confidence) + '</b></div></div>' +
        '<div class="photo">Historical photo gallery coming soon<br>MLS image permissions and dates to be verified</div>' +
        '<div class="eyebrow">Your interest in this property</div>' +
        '<div class="ratings">' + RATINGS.map(function (r) { return '<button class="' + (s.rating === r[0] ? 'active' : '') + '" data-rate="' + r[0] + '">' + r[1] + '</button>'; }).join('') + '</div>' +
        '<textarea id="notes" rows="2" placeholder="What do you like or dislike?">' + esc(s.notes || '') + '</textarea>' +
        '<div class="actions" style="margin-top:10px"><button id="save" class="primary">Save preference</button><button id="similar">Find similar homes</button></div>' +
        '<div class="favorites"><b>My shortlist:</b> ' + loved + ' loved · ' + interested + ' interested<br><small>Selections are stored locally on this device; use Export to share them.</small></div>';

      document.querySelectorAll('[data-rate]').forEach(function (b) {
        b.onclick = function () { saved[x.address] = { rating: b.dataset.rate, notes: $('notes').value }; persist(); render(); };
      });
      $('notes').oninput = function () { saved[x.address] = Object.assign({}, state(), { notes: $('notes').value }); persist(); };
      $('save').onclick = function () { saved[x.address] = Object.assign({}, state(), { notes: $('notes').value }); persist(); render(); };
      $('similar').onclick = function () {
        var options = data.filter(function (z) { return z.number !== x.number && z.type === x.type; })
          .map(function (z) { return { z: z, score: (z.water === x.water ? 4 : 0) + (z.beds === x.beds ? 2 : 0) - Math.abs(z.estimate - x.estimate) / 500000 }; })
          .sort(function (a, b) { return b.score - a.score; }).slice(0, 5).map(function (v) { return v.z.address; });
        alert(options.length ? 'Similar properties to explore:\n\n' + options.join('\n') : 'No similar properties found.');
      };
    }

    function render() { renderList(); renderProfile(); }

    ['search', 'water', 'price', 'rating'].forEach(function (id) { $(id).addEventListener('input', renderList); });
    $('zoom').onclick = function () { var on = $('mapframe').classList.toggle('zoom'); $('zoom').textContent = on ? 'Zoom map −' : 'Zoom map +'; };
    $('export').onclick = function () {
      var cell = function (v) { v = String(v == null ? '' : v); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
      var lines = ['Address,Interest,Notes,Preliminary Estimate (USD)'];
      data.forEach(function (x) {
        var s = saved[x.address];
        if (s && (s.rating || s.notes)) lines.push([x.address, ratingLabel[s.rating] || '', s.notes || '', x.estimate].map(cell).join(','));
      });
      if (lines.length === 1) return alert('Select a few properties first.');
      var blob = new Blob([lines.join('\r\n')], { type: 'text/csv' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = cfg.exportFilename || (cfg.id + '_selections.csv');
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    };
    render();
  }

  load();
})();
