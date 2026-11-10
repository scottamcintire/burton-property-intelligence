/* Burton & Burton Property Intelligence — private collection welcome + decryption.
 *
 * Used only on the published (encrypted) site produced by tools/publish.py.
 * The public files contain no password and no password hash. Property data, the map
 * and photos are AES-256-GCM ciphertext. The password is turned into a key with
 * PBKDF2-SHA-256 (iterations in access.json). That key unlocks the collection key.
 * Without the right password nothing can be decrypted, so there's no hidden page
 * behind this screen to reach.
 *
 * Access is remembered for the browser session (sessionStorage holds the collection
 * key, never the password). Closing the tab/browser, or "Lock collection", forgets it.
 */
(function () {
  'use strict';
  var te = new TextEncoder(), td = new TextDecoder();
  var resolveUnlock;
  var gate = window.BBPI_GATE = { unlocked: new Promise(function (r) { resolveUnlock = r; }) };
  var access = null, key = null, assetCache = {};

  function b64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function tob64(buf) { var u = new Uint8Array(buf), s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function sessionName() { return 'bbpi-access:' + access.projectId + ':' + access.build; }
  function aad(name) { return te.encode(access.projectId + ':' + name); }

  async function fetchBytes(path) {
    var r = await fetch(path, { cache: 'no-cache' });
    if (!r.ok) throw new Error('Could not load ' + path + ' (' + r.status + ')');
    return new Uint8Array(await r.arrayBuffer());
  }
  async function decryptFile(bytes, name) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: aad(name) }, key, bytes.slice(12));
  }
  async function openCollection(rawKey) {
    key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
    var plain = await decryptFile(await fetchBytes(access.data), 'data');
    return JSON.parse(td.decode(plain));
  }
  async function unwrapWithPassword(password) {
    var base = await crypto.subtle.importKey('raw', te.encode(password.trim().normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    for (var i = 0; i < access.slots.length; i++) {
      var s = access.slots[i];
      var kek = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: access.kdf.hash, salt: b64(s.salt), iterations: access.kdf.iterations },
        base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      try { return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(s.iv), additionalData: aad('key') }, kek, b64(s.key)); }
      catch (e) { /* wrong password for this slot */ }
    }
    return null;
  }

  gate.asset = function (path) {
    var a = access && access.assets[path];
    if (!a) return Promise.resolve(path);
    if (!assetCache[path]) {
      assetCache[path] = fetchBytes(a.file).then(function (b) { return decryptFile(b, 'asset:' + path); })
        .then(function (p) { return URL.createObjectURL(new Blob([p], { type: a.type })); });
    }
    return assetCache[path];
  };
  gate.lock = function () { try { sessionStorage.removeItem(sessionName()); } catch (e) {} location.reload(); };

  function finish(bundle) {
    var el = document.querySelector('.gate');
    var go = function () { resolveUnlock(bundle); };
    if (el) { el.classList.add('gate-out'); setTimeout(go, 450); } else go();
  }

  function render(state) {
    var w = access.welcome || {};
    document.title = w.pageTitle || 'Private Property Collection';
    document.body.innerHTML =
      '<div class="gate"><main class="gate-card">' +
      '<div class="gate-brand">' + esc(w.brand) + '</div><div class="gate-rule"></div>' +
      '<div class="gate-collection">' + esc(w.collection) + '</div>' +
      '<h1>' + esc(w.heading) + '</h1>' +
      '<p class="gate-sub">' + esc(w.subheading) + '</p>' +
      '<p class="gate-note">' + esc(w.note) + '</p>' +
      (state === 'opening'
        ? '<p class="gate-opening">Opening your collection…</p>'
        : '<form class="gate-form" id="gate-form" novalidate>' +
          '<label class="gate-label" for="gate-pw">Access password</label>' +
          '<div class="gate-field"><input id="gate-pw" name="password" type="password" autocomplete="current-password" spellcheck="false" autocapitalize="off" required>' +
          '<button type="button" class="gate-show" id="gate-show" aria-label="Show password">Show</button></div>' +
          '<button type="submit" class="gate-enter" id="gate-enter">' + esc(w.button || 'Enter Collection') + '</button>' +
          '<p class="gate-msg" id="gate-msg" role="alert" aria-live="polite">' + (state === 'error' ? 'This page could not load securely. Please use the https:// link you were given.' : '') + '</p>' +
          '</form>') +
      '</main>' + (w.footnote ? '<div class="gate-foot">' + esc(w.footnote) + '</div>' : '') + '</div>';
    if (state === 'opening' || state === 'error') return;

    var pw = document.getElementById('gate-pw'), btn = document.getElementById('gate-enter'), msg = document.getElementById('gate-msg');
    pw.focus();
    document.getElementById('gate-show').onclick = function () {
      var show = pw.type === 'password'; pw.type = show ? 'text' : 'password';
      this.textContent = show ? 'Hide' : 'Show'; this.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); pw.focus();
    };
    document.getElementById('gate-form').onsubmit = async function (ev) {
      ev.preventDefault();
      if (!pw.value.trim()) { msg.textContent = 'Please enter your access password.'; return; }
      btn.disabled = true; pw.disabled = true; btn.textContent = 'Opening…'; msg.textContent = '';
      var card = document.querySelector('.gate-card');
      try {
        var raw = await unwrapWithPassword(pw.value);
        if (!raw) {
          btn.disabled = false; pw.disabled = false; btn.textContent = (access.welcome || {}).button || 'Enter Collection';
          msg.textContent = 'That password did not open the collection. Please check it and try again.';
          card.classList.remove('gate-shake'); void card.offsetWidth; card.classList.add('gate-shake');
          pw.select(); return;
        }
        var bundle = await openCollection(raw);
        try { sessionStorage.setItem(sessionName(), tob64(raw)); } catch (e) { /* private mode: ask again next time */ }
        finish(bundle);
      } catch (e) {
        btn.disabled = false; pw.disabled = false; btn.textContent = (access.welcome || {}).button || 'Enter Collection';
        msg.textContent = 'The collection could not be opened (' + e.message + '). Please refresh and try again.';
      }
    };
  }

  async function init() {
    document.body.classList.add('gate-body');
    try {
      var r = await fetch('access.json', { cache: 'no-cache' });
      access = await r.json();
    } catch (e) {
      document.body.innerHTML = '<p class="loaderror">This collection could not be loaded. Please check the link.</p>';
      return;
    }
    if (!window.crypto || !crypto.subtle) { render('error'); return; }
    var saved = null;
    try { saved = sessionStorage.getItem(sessionName()); } catch (e) {}
    if (saved) {
      render('opening');
      try { return finish(await openCollection(b64(saved))); }
      catch (e) { try { sessionStorage.removeItem(sessionName()); } catch (x) {} }
    }
    render('form');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
