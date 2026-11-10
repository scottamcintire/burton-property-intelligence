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
      return start(cfg, props, gate, gate.asset);
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

  function spec(label, value, note, title) {
    return '<div class="spec"' + (title ? ' title="' + esc(title) + '"' : '') + '><label>' + esc(label) + '</label><b>' + esc(value) + '</b>' +
      (note ? '<small class="specnote">' + esc(note) + '</small>' : '') + '</div>';
  }
  function fmtBaths(v) {                      // research notation: "2.1" = 2 full, 1 half
    if (v == null || v === '') return '—';
    var m = /^(\d+)(?:\.(\d))?$/.exec(String(v));
    if (!m) return String(v);
    return m[2] && m[2] !== '0' ? m[1] + ' full, ' + m[2] + ' half' : m[1];
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
      '<main class="layout"><section class="mapcard"><div class="mapbar"><strong id="maptitle">' + esc(m.title) + '</strong>' +
      '<span class="mapbtns"><button id="showmap" class="toggle active" aria-pressed="true">Map</button><button id="zoom" class="toggle">Zoom map +</button></span></div>' +
      '<div class="mapframe" id="mapframe"><div class="mapstage" id="mapstage"><img src="' + esc(m.image) + '" alt="' + esc(m.alt) + '">' +
      '<svg class="lots" id="lots" viewBox="0 0 100 100" preserveAspectRatio="none" role="group" aria-label="Properties on the map">' +
      data.filter(function (x) { return x.mapHotspot && x.mapHotspot.verified && x.mapHotspot.points; }).map(function (x) {
        return '<polygon class="lot" data-n="' + esc(x.number) + '" tabindex="0" role="button" aria-label="' + esc(x.address) + '" points="' +
          x.mapHotspot.points.map(function (p) { return p[0] + ',' + p[1]; }).join(' ') + '"><title>' + esc(x.address) + '</title></polygon>';
      }).join('') + '</svg></div>' +
      '<div class="photoview hidden" id="photoview"><div class="photomain"><img id="photomain" alt=""><div class="photocap" id="photocap"></div></div>' +
      '<div class="thumbs" id="thumbs"></div></div></div>' +
      '<div class="mapnote">' + esc(m.note) + (m.credit ? '<span class="mapcredit">' + esc(m.credit) + '</span>' : '') + '</div></section>' +
      '<section class="side"><div class="toolbar"><input id="search" placeholder="Search address..." aria-label="Search address">' +
      '<select id="water" aria-label="Water relationship"><option value="">All water relationships</option>' + (cfg.waterOptions || []).map(function (w) { return '<option>' + esc(w) + '</option>'; }).join('') + '</select>' +
      '<select id="price" aria-label="Estimated value"><option value="">All estimated values</option>' + (cfg.priceBands || []).map(function (b, i) { return '<option value="' + i + '">' + esc(b.label) + '</option>'; }).join('') + '</select>' +
      '<select id="rating" aria-label="Your interest"><option value="">All properties</option>' + RATINGS.map(function (r) { return '<option value="' + r[0] + '">' + r[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="propertylist" id="list"></div><div class="profile" id="profile"></div></section></main>' +
      '<footer class="foot">' + esc(cfg.footer) + '</footer>';
  }

  function start(cfg, data, gate, assetUrl) {
    function taxes(x) {                        // estimate: assessed value × town rate (config)
      var t = cfg.tax;
      if (!t || !x.assessment) return { text: '—', note: x.assessment ? '' : 'Assessment not on file' };
      return { text: money(Math.round(x.assessment * t.rate / 1000)), note: (t.fiscalYear || '') + ' assessment ' + money(x.assessment) };
    }
    assetUrl = assetUrl || function (p) { return Promise.resolve(p); };
    shell(cfg, data, gate);
    if (gate) $('lock').onclick = gate.lock;
    var key = cfg.storageKey || ('bb-' + cfg.id);
    var selected = data.find(function (x) { return x.number === cfg.defaultPropertyNumber; }) || data[0];
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (e) { saved = {}; }

    function state() { return saved[selected.address] || { rating: '', notes: '' }; }
    function persist() { try { localStorage.setItem(key, JSON.stringify(saved)); } catch (e) { /* private mode */ } }

    /* ---- Automatic sending of choices (optional; project.json → saveTo.url) ----
       Each change is kept in this browser first, then sent to the team's private Google Sheet
       a moment later. Failed sends are retried every 30 seconds and on the next visit. */
    var remote = cfg.saveTo && cfg.saveTo.url ? cfg.saveTo : null;
    var timers = {}, inflight = {}, byAddr = {};
    data.forEach(function (x) { byAddr[x.address] = x; });
    function unsent(addr) {
      var s = saved[addr]; if (!s || !byAddr[addr]) return false;
      var t = s.sent || {};
      return (s.rating || '') !== (t.rating || '') || (s.notes || '') !== (t.notes || '');
    }
    function payload(addr) {
      var x = byAddr[addr], s = saved[addr];
      return JSON.stringify({ token: remote.token, project: cfg.id, address: addr, number: x.number,
        interest: ratingLabel[s.rating] || '', notes: s.notes || '', estimate: x.estimate, clientTime: new Date().toISOString() });
    }
    function showStatus(addr) {
      var el = $('savestatus'); if (!el || selected.address !== addr) return;
      var s = saved[addr], text = '';
      if (s && (s.rating || s.notes)) {
        if (!remote) text = 'Saved ✓';
        else if (inflight[addr] || timers[addr]) text = 'Saving…';
        else text = unsent(addr) ? 'Not saved yet, retrying…' : 'Saved ✓';
      }
      el.textContent = text;
    }
    function queue(addr, ms) {
      if (!remote) return showStatus(addr);
      clearTimeout(timers[addr]);
      timers[addr] = setTimeout(function () { send(addr); }, ms);
      showStatus(addr);
    }
    async function send(addr) {
      clearTimeout(timers[addr]); delete timers[addr];
      if (!remote || inflight[addr] || !unsent(addr)) return showStatus(addr);
      var snap = { rating: saved[addr].rating || '', notes: saved[addr].notes || '' }, ok = false;
      inflight[addr] = true; showStatus(addr);
      try {
        var r = await fetch(remote.url, { method: 'POST', body: payload(addr) });   // text/plain: no preflight
        var j = await r.json();
        if (!j.ok) throw new Error(j.error || 'not saved');
        saved[addr] = Object.assign({}, saved[addr], { sent: snap }); persist(); ok = true;
      } catch (e) { /* kept locally; retried below */ }
      delete inflight[addr];
      if (ok && unsent(addr)) queue(addr, 800);   // changed while sending
      else showStatus(addr);
    }
    function flushAll() { Object.keys(saved).forEach(function (a) { if (unsent(a) && !timers[a]) send(a); }); }
    if (remote) {
      setInterval(flushAll, 30000);
      addEventListener('pagehide', function () {
        Object.keys(saved).forEach(function (a) {
          if (unsent(a) && navigator.sendBeacon) navigator.sendBeacon(remote.url, new Blob([payload(a)], { type: 'text/plain' }));
        });
      });
    }

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
      var L = $('list'), selRow = L.querySelector('.row.selected');   // keep the selected house in view (3-row list)
      if (selRow && (selRow.offsetTop < L.scrollTop || selRow.offsetTop + selRow.offsetHeight > L.scrollTop + L.clientHeight)) L.scrollTop = selRow.offsetTop;
      document.querySelectorAll('.row').forEach(function (el) {
        el.onclick = function () { choose(+el.dataset.n); };
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
        spec('Bedrooms', x.beds != null ? x.beds : '—') +
        spec('Baths', fmtBaths(x.baths)) +
        spec('Square feet', x.sqft ? Number(x.sqft).toLocaleString() : 'Land only') +
        spec('Lot', acres != null ? acres + ' acres' : '—') +
        spec('Year built', x.year || '—') +
        spec('Est. annual taxes', taxes(x).text, taxes(x).note, (cfg.tax || {}).note) +
        spec('Water relationship', x.water + (x.waterUnconfirmed ? ' (unconfirmed)' : '')) +
        spec('Research confidence', x.confidence) + '</div>' +
        ((x.features || []).length ? '<div class="eyebrow">Features</div><div class="features">' + x.features.map(function (f) {
          return '<span class="feature">' + esc(f.label) + (f.note ? ' <small>· ' + esc(f.note) + '</small>' : '') + '</span>';
        }).join('') + '</div>' : '') +
        '<div class="eyebrow">Your interest in this property</div>' +
        '<div class="ratings">' + RATINGS.map(function (r) { return '<button class="' + (s.rating === r[0] ? 'active' : '') + '" data-rate="' + r[0] + '">' + r[1] + '</button>'; }).join('') + '</div>' +
        '<textarea id="notes" rows="2" placeholder="What do you like or dislike?">' + esc(s.notes || '') + '</textarea>' +
        '<div class="actions" style="margin-top:10px;align-items:center"><button id="similar">Find similar homes</button><span class="savestatus" id="savestatus" aria-live="polite"></span></div>' +
        '<div class="favorites"><b>My shortlist:</b> ' + loved + ' loved · ' + interested + ' interested<br><small>Your choices and notes are saved automatically. Use Export to download a copy.</small></div>';

      document.querySelectorAll('[data-rate]').forEach(function (b) {
        b.onclick = function () {
          saved[x.address] = Object.assign({}, saved[x.address], { rating: b.dataset.rate, notes: $('notes').value });
          persist(); render(); queue(x.address, 1200);
        };
      });
      $('notes').oninput = function () {
        saved[x.address] = Object.assign({}, state(), { notes: $('notes').value });
        persist(); queue(x.address, 2500);
      };
      $('notes').onblur = function () { if (timers[x.address]) send(x.address); };
      showStatus(x.address);
      $('similar').onclick = function () {
        var options = data.filter(function (z) { return z.number !== x.number && z.type === x.type; })
          .map(function (z) { return { z: z, score: (z.water === x.water ? 4 : 0) + (z.beds === x.beds ? 2 : 0) - Math.abs(z.estimate - x.estimate) / 500000 }; })
          .sort(function (a, b) { return b.score - a.score; }).slice(0, 5).map(function (v) { return v.z.address; });
        alert(options.length ? 'Similar properties to explore:\n\n' + options.join('\n') : 'No similar properties found.');
      };
    }

    function render() { renderList(); renderProfile(); highlightLot(); }

    /* ---- Map ⇄ photo viewer ----
       Selecting a house (map or list) shows its first photo in place of the map; houses without
       photos keep the map and highlight their lot. The Map button returns to the map. */
    var view = 'map', photoIndex = 0;
    function photosOf(x) { return (x.photos || []).slice(0, 6); }
    function highlightLot() {
      document.querySelectorAll('.lot').forEach(function (l) { l.classList.toggle('sel', +l.dataset.n === selected.number); });
    }
    function setView(v) {
      view = v;
      $('mapstage').classList.toggle('hidden', v !== 'map');
      $('photoview').classList.toggle('hidden', v !== 'photo');
      $('mapframe').classList.toggle('photomode', v === 'photo');
      $('showmap').classList.toggle('active', v === 'map'); $('showmap').setAttribute('aria-pressed', v === 'map');
      $('zoom').disabled = v !== 'map';
      $('maptitle').textContent = v === 'map' ? (cfg.map || {}).title : selected.address + ' · Photos';
    }
    function showPhoto(i) {
      var ph = photosOf(selected); if (!ph.length) return;
      photoIndex = (i + ph.length) % ph.length;
      var p = ph[photoIndex], img = $('photomain'), forAddr = selected.address;
      img.classList.add('loading'); img.alt = (p.caption || selected.address) + ' (photo ' + (photoIndex + 1) + ' of ' + ph.length + ')';
      img.style.width = ''; img.onload = function () {           // small assessor photos: enlarge (up to 2.5x) instead of a postage stamp
        var box = img.parentNode.getBoundingClientRect();
        if (img.naturalWidth && img.naturalWidth < 700) {
          var k = Math.min(2.5, box.width * 0.9 / img.naturalWidth, box.height * 0.9 / img.naturalHeight);
          if (k > 1) img.style.width = Math.round(img.naturalWidth * k) + 'px';
        }
      };
      assetUrl(p.src).then(function (u) { if (selected.address === forAddr) { img.src = u; img.classList.remove('loading'); } });
      $('photocap').textContent = 'Photo ' + (photoIndex + 1) + ' of ' + ph.length + (p.caption ? ' · ' + p.caption : '') +
        ' · Source: ' + p.source + ', ' + p.date;
      document.querySelectorAll('.thumb').forEach(function (t) { t.classList.toggle('active', +t.dataset.i === photoIndex); });
    }
    function showPhotos() {
      var ph = photosOf(selected);
      if (!ph.length) { setView('map'); return false; }
      $('thumbs').innerHTML = ph.map(function (p, i) {
        return '<button class="thumb" data-i="' + i + '" aria-label="Photo ' + (i + 1) + '"><img alt=""></button>';
      }).join('');
      document.querySelectorAll('.thumb').forEach(function (t) {
        var i = +t.dataset.i, forAddr = selected.address;
        assetUrl(ph[i].src).then(function (u) { if (selected.address === forAddr) t.querySelector('img').src = u; });
        t.onclick = function () { showPhoto(i); };
      });
      setView('photo'); showPhoto(0); return true;
    }
    function choose(n) {
      selected = data.find(function (x) { return x.number === n; });
      render();
      if (!showPhotos()) {                          // no photos: stay on the map, bring the lot into view
        var lot = document.querySelector('.lot[data-n="' + n + '"]');
        if (lot && $('mapframe').classList.contains('zoom')) {
          var b = lot.getBoundingClientRect(), f = $('mapframe').getBoundingClientRect();
          $('mapframe').scrollBy({ left: b.left + b.width / 2 - f.left - f.width / 2, top: b.top + b.height / 2 - f.top - f.height / 2, behavior: 'smooth' });
        }
      }
    }
    document.querySelectorAll('.lot').forEach(function (l) {
      l.addEventListener('click', function () { choose(+l.dataset.n); });
      l.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(+l.dataset.n); } });
    });
    $('showmap').onclick = function () { setView('map'); };
    document.addEventListener('keydown', function (e) {
      if (view !== 'photo' || /INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName)) return;
      if (e.key === 'ArrowRight') { showPhoto(photoIndex + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { showPhoto(photoIndex - 1); e.preventDefault(); }
      if (e.key === 'Escape') setView('map');
    });

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
    if (remote) flushAll();
  }

  load();
})();
