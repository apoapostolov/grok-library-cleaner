/*
 * Grok Library Cleaner 1.0
 *
 * - Trash glyph on every library tile: one click deletes that asset immediately, no dialog.
 * - "Delete all" in the Library header: scans the library, shows what it found, then purges
 *   only the confirmed selection with human-paced, randomised spacing and a stop switch.
 * - Four selectable classes: plain images (image.jpg), edited images (edited-image.jpg),
 *   videos (generated_video.mp4) and other files.
 *
 * Endpoints (verified against the live site, logged-in session):
 *   GET    /rest/assets?...                    -> {assets, nextPageToken}; pageSize caps at 60
 *   DELETE /rest/assets-metadata/<assetId>     -> 200, removes the asset. This is the real delete.
 *   POST   /rest/media/post/delete             -> always 404 for library assets; the app fires it
 *                                                 first and ignores the failure. Do not rely on it.
 *   Throttling: HTTP 429, gRPC code 8, no Retry-After header; window clears in ~15-40 s.
 */
(() => {
  'use strict';
  if (window.__grokLibraryCleaner) return;
  window.__grokLibraryCleaner = true;

  const TILE_BTN = 'button[data-library-item-id]';
  // The real delete is a DELETE on the asset metadata. The app also fires
  // POST /rest/media/post/delete first, which answers 404 for library assets and
  // is ignored; doing only that call is why nothing was ever deleted.
  const API_DELETE = '/rest/assets-metadata';
  const API_LIST = '/rest/assets';
  const PAGE_SIZE = '60';

  const DEFAULTS = {
    minDelay: 800,
    maxDelay: 2400,
    longPauseEveryMin: 6,
    longPauseEveryMax: 14,
    longPauseMin: 3500,
    longPauseMax: 9000,
    includePlain: true,
    includeEdited: true,
    includeVideos: false,
    includeOther: false,
    maxPerRun: 0,
    maxSizeMB: 0, // 0 = accept every size
    downloadFirst: false, // opt in: save a copy before deleting
    folder: '', // empty means straight into Downloads, no invented name
    savePrompts: true, // write a .md beside each file when a prompt exists
  };

  let settings = { ...DEFAULTS };
  let phase = 'idle'; // idle | scan | confirm | run
  let stopRequested = false;
  let armTimer = null;
  let toastEl = null;

  // ---------------------------------------------------------------- utils

  const rand = (min, max) => min + Math.random() * (max - min);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (v, fallback, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  const fmtInt = (n) => Number(n).toLocaleString('en-US');
  const plural = (n, one, many) => fmtInt(n) + ' ' + (n === 1 ? one : many);

  const kindOf = (mime) => {
    const m = String(mime || '');
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    return 'other';
  };

  /**
   * Plain generated images are named "image.jpg", edited ones "edited-image.jpg".
   * auxKeys.image_edit_is_root_user_uploaded is NOT a marker: it also appears on
   * untouched image.jpg assets, so the file name is the only reliable signal.
   */
  const isEditedAsset = (asset) =>
    kindOf(asset && asset.mimeType) === 'image' &&
    /^edited[-_\s]/i.test(String((asset && asset.name) || ''));

  const classOf = (asset) => {
    const kind = kindOf(asset && asset.mimeType);
    if (kind === 'image') return isEditedAsset(asset) ? 'edited' : 'plain';
    return kind;
  };

  const fmtSeconds = (s) => {
    if (!Number.isFinite(s) || s <= 0) return '0s';
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return m ? m + 'm ' + sec + 's' : sec + 's';
  };

  const TRASH_SVG =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>' +
    '<path d="M10 11v6"/><path d="M14 11v6"/></svg>';

  // ------------------------------------------------------------- settings

  function applySettings(raw) {
    const s = raw || {};
    settings = {
      minDelay: num(s.minDelay, DEFAULTS.minDelay, 300, 60000),
      maxDelay: num(s.maxDelay, DEFAULTS.maxDelay, 300, 120000),
      longPauseEveryMin: num(s.longPauseEveryMin, DEFAULTS.longPauseEveryMin, 2, 200),
      longPauseEveryMax: num(s.longPauseEveryMax, DEFAULTS.longPauseEveryMax, 2, 200),
      longPauseMin: num(s.longPauseMin, DEFAULTS.longPauseMin, 1000, 300000),
      longPauseMax: num(s.longPauseMax, DEFAULTS.longPauseMax, 1000, 600000),
      // The pre 1.1 single "includeImages" flag meant both image classes.
      includePlain: s.includePlain !== undefined ? s.includePlain === true : s.includeImages !== false,
      includeEdited: s.includeEdited !== undefined ? s.includeEdited === true : s.includeImages !== false,
      includeVideos: s.includeVideos === true,
      includeOther: s.includeOther === true,
      maxPerRun: num(s.maxPerRun, 0, 0, 50000),
      maxSizeMB: num(s.maxSizeMB, 0, 0, 4096),
      downloadFirst: s.downloadFirst === true,
      folder: String(s.folder || '').trim(),
      savePrompts: s.savePrompts !== false,
    };
    if (settings.maxDelay < settings.minDelay) settings.maxDelay = settings.minDelay;
    if (settings.longPauseEveryMax < settings.longPauseEveryMin) {
      settings.longPauseEveryMax = settings.longPauseEveryMin;
    }
    if (settings.longPauseMax < settings.longPauseMin) settings.longPauseMax = settings.longPauseMin;
  }

  try {
    chrome.storage.local.get('settings').then((v) => applySettings(v && v.settings), () => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) applySettings(changes.settings.newValue);
    });
  } catch (e) {
    /* no extension storage context (manual injection for testing) */
  }

  // ---------------------------------------------------------- delete API

  async function deleteOnce(id) {
    const res = await fetch(API_DELETE + '/' + encodeURIComponent(id), {
      method: 'DELETE',
      credentials: 'include',
    });
    let body = null;
    try {
      body = await res.clone().json();
    } catch (e) {
      body = null;
    }
    return { status: res.status, ok: res.ok, retryAfter: res.headers.get('retry-after'), body };
  }

  async function deleteWithRetry(id) {
    let attempt = 0;
    while (attempt < 4) {
      if (stopRequested) return { stopped: true };
      let r;
      try {
        r = await deleteOnce(id);
      } catch (e) {
        await sleep(rand(1500, 3500) * Math.pow(1.6, attempt));
        attempt += 1;
        continue;
      }
      if (r.ok) return { ok: true };
      // 404 means the asset is already gone, which is the outcome we want.
      if (r.status === 404) return { ok: true, gone: true };
      if (r.status === 401 || r.status === 403) return { auth: true, status: r.status };
      if (r.status === 429) {
        const ra = parseFloat(r.retryAfter || '0');
        const wait = ra > 0 ? ra * 1000 : rand(18000, 32000) * Math.pow(1.5, attempt);
        await sleep(Math.min(wait, 120000));
        attempt += 1;
        continue;
      }
      if (r.status >= 500) {
        await sleep(Math.min(rand(1800, 4500) * Math.pow(1.6, attempt), 60000));
        attempt += 1;
        continue;
      }
      return { ok: false, status: r.status, body: r.body };
    }
    return { ok: false, status: 'retries exhausted' };
  }

  /**
   * Enumerates the library newest-first. pageSize is capped server side at 60, so a 5000
   * asset library costs roughly 85 sequential pages; each page rests, and every 429 is
   * absorbed with a cooldown before the same page is retried.
   */
  async function listAllAssets(onProgress, stopWhen) {
    const out = [];
    let token = null;
    let pages = 0;
    let partial = false;
    while (pages < 400) {
      if (stopRequested) break;
      const params = new URLSearchParams({
        pageSize: PAGE_SIZE,
        orderBy: 'ORDER_BY_CREATE_TIME',
        sortDirection: 'SORT_DIRECTION_DESCENDING',
        source: 'SOURCE_ANY',
        isLatest: 'true',
        includeImagineFiles: 'true',
      });
      if (token) params.set('pageToken', token);

      let res = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        if (stopRequested) return out;
        res = await fetch(API_LIST + '?' + params.toString(), { credentials: 'include' });
        if (res.status !== 429) break;
        if (onProgress) onProgress({ pages, count: out.length, throttled: true });
        await sleep(rand(18000, 32000) * Math.pow(1.35, attempt));
      }
      if (!res || !res.ok) throw new Error('asset list failed: HTTP ' + (res ? res.status : 'no response'));

      const json = await res.json();
      for (const a of json.assets || []) if (a && a.assetId) out.push(a);
      token = json.nextPageToken || null;
      pages += 1;
      if (onProgress) onProgress({ pages, count: out.length });
      if (stopWhen && stopWhen(out)) {
        partial = true;
        break;
      }
      if (token) await sleep(rand(1200, 2000));
    }
    // Exhausted the 400 page cap while the server still had more to give.
    if (token && !partial) partial = true;
    return { assets: out, pages, partial };
  }

  function selected(asset) {
    const cls = classOf(asset);
    if (cls === 'plain') return settings.includePlain;
    if (cls === 'edited') return settings.includeEdited;
    if (cls === 'video') return settings.includeVideos;
    return settings.includeOther;
  }

  const sizeCap = () => (settings.maxSizeMB > 0 ? settings.maxSizeMB * 1024 * 1024 : 0);

  function classify(assets) {
    const counts = { plain: 0, edited: 0, video: 0, other: 0 };
    const chosen = { plain: 0, edited: 0, video: 0, other: 0 };
    const targets = [];
    const cap = sizeCap();
    let tooBig = 0;
    for (const a of assets) {
      if (!a || a.isDeleted) continue;
      const cls = classOf(a);
      counts[cls] += 1;
      if (!selected(a)) continue;
      // sizeBytes ships with every list row, so the cap costs no extra request
      if (cap && (Number(a.sizeBytes) || 0) > cap) {
        tooBig += 1;
        continue;
      }
      chosen[cls] += 1;
      targets.push(a);
    }
    return { counts, chosen, targets, tooBig };
  }

  const mixShort = (c) =>
    [c.plain && 'images ' + fmtInt(c.plain), c.edited && 'edited ' + fmtInt(c.edited), c.video && 'videos ' + fmtInt(c.video), c.other && 'files ' + fmtInt(c.other)]
      .filter(Boolean)
      .join(' · ') || 'nothing';

  function filtersLabel() {
    const parts = [];
    if (settings.includePlain) parts.push('images');
    if (settings.includeEdited) parts.push('edited');
    if (settings.includeVideos) parts.push('videos');
    if (settings.includeOther) parts.push('files');
    return parts.join(' + ') || 'nothing selected';
  }

  // ---------------------------------------------------------------- toast

  const TOAST_ICONS = {
    success:
      '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 8.4l3.6 3.6L13 5"/></svg>',
    error:
      '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<circle cx="8" cy="8" r="6"/><path d="M8 4.8v3.6"/><path d="M8 11.2h.01"/></svg>',
    busy:
      '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M2.6 5.2h10.8"/><path d="M12.6 5.2l-.9 8H4.3l-.9-8"/><path d="M6.4 7.8v3.2"/>' +
      '<path d="M9.6 7.8v3.2"/></svg>',
    confirm:
      '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M8 3v5.4"/><path d="M8 11.8h.01"/></svg>',
  };

  const TONES = {
    idle: 'busy',
    run: 'busy',
    done: 'success',
    success: 'success',
    error: 'error',
    confirm: 'confirm',
    busy: 'busy',
  };

  let toastTimer = null;

  function toastNode() {
    if (toastEl && document.body.contains(toastEl)) return toastEl;
    toastEl = document.createElement('div');
    toastEl.className = 'glc-toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    // Static markup only; library data is never interpolated into innerHTML.
    toastEl.innerHTML =
      '<div class="glc-toast-row">' +
      '<span class="glc-toast-icon"></span>' +
      '<div class="glc-toast-text">' +
      '<div class="glc-toast-title"></div><div class="glc-toast-detail"></div>' +
      '</div>' +
      '<button type="button" class="glc-toast-close" aria-label="Dismiss notification"></button>' +
      '</div>' +
      '<div class="glc-toast-track"><div class="glc-toast-fill"></div></div>' +
      '<div class="glc-toast-actions"></div>';
    toastEl.querySelector('.glc-toast-close').innerHTML =
      '<svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" ' +
      'stroke-width="1.6" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>';
    document.body.appendChild(toastEl);
    return toastEl;
  }

  function hideToast() {
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (!toastEl) return;
    const el = toastEl;
    el.dataset.leaving = '1';
    setTimeout(() => {
      el.remove();
      if (toastEl === el) toastEl = null;
    }, 170);
  }

  /**
   * One surface for every message. Accepts either a ready-made detail string or
   * the older [label, value] line pairs, and an optional progress descriptor:
   * { value, max } for a determinate bar, { indeterminate: true } for a sweep.
   */
  function showToast(opts) {
    const el = toastNode();
    const tone = TONES[opts.tone || opts.state || 'busy'] || 'busy';
    el.dataset.tone = tone;
    el.dataset.leaving = '0';
    el.setAttribute('role', tone === 'error' ? 'alert' : 'status');

    const detail =
      opts.detail !== undefined
        ? String(opts.detail)
        : (opts.lines || []).map(([label, value]) => (label ? label + ' ' : '') + value).join('  ·  ');

    el.querySelector('.glc-toast-icon').innerHTML = TOAST_ICONS[tone] || TOAST_ICONS.busy;
    el.querySelector('.glc-toast-title').textContent = opts.title || '';
    const detailEl = el.querySelector('.glc-toast-detail');
    detailEl.textContent = detail;
    detailEl.style.display = detail ? '' : 'none';

    const track = el.querySelector('.glc-toast-track');
    if (opts.progress) {
      track.style.display = '';
      if (opts.progress.indeterminate) {
        track.dataset.indeterminate = '1';
        el.querySelector('.glc-toast-fill').style.width = '';
      } else {
        track.dataset.indeterminate = '0';
        const max = Math.max(1, Number(opts.progress.max) || 1);
        const pct = Math.min(100, Math.max(0, (Number(opts.progress.value) || 0) / max * 100));
        el.querySelector('.glc-toast-fill').style.width = (pct > 0 ? Math.max(2, pct) : 0) + '%';
      }
    } else {
      track.style.display = 'none';
    }

    const actions = el.querySelector('.glc-toast-actions');
    actions.textContent = '';
    for (const action of opts.actions || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'glc-toast-btn';
      if (action.kind) btn.dataset.kind = action.kind;
      btn.textContent = action.label;
      btn.addEventListener('click', action.onClick);
      actions.appendChild(btn);
    }
    actions.style.display = (opts.actions || []).length ? 'flex' : 'none';

    const close = el.querySelector('.glc-toast-close');
    close.style.display = (opts.actions || []).length ? 'none' : '';
    close.onclick = hideToast;

    // re-run the entrance animation when the same toast is rewritten
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';

    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    if (opts.autoHide) {
      toastTimer = setTimeout(() => {
        if (opts.autoHideGuard ? opts.autoHideGuard() : true) hideToast();
      }, opts.autoHide);
    }
    return el;
  }

  function flashSuccess(title, detail) {
    if (phase !== 'idle') return; // a run owns the toast while it is working
    showToast({ tone: 'success', title, detail, autoHide: 3200 });
  }

  function flashError(title, detail) {
    showToast({ tone: 'error', title, detail, autoHide: 6500 });
  }

  // ------------------------------------------------------------- archiving

  const PAD = (n) => String(n).padStart(2, '0');

  function stampOf(iso) {
    const d = iso ? new Date(iso) : new Date();
    const when = isNaN(d) ? new Date() : d;
    return (
      when.getFullYear() +
      '-' +
      PAD(when.getMonth() + 1) +
      '-' +
      PAD(when.getDate()) +
      '_' +
      PAD(when.getHours()) +
      PAD(when.getMinutes()) +
      '-' +
      PAD(when.getSeconds())
    );
  }

  function slugOf(text, max = 50) {
    return String(text || '')
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '');
  }

  function fileKindOf(asset) {
    const mime = String(asset.mimeType || '');
    const name = String(asset.name || '');
    if (mime.startsWith('video/')) return 'video';
    if (/^edited-/i.test(name)) return 'edit';
    if (mime.startsWith('image/')) return 'image';
    return 'file';
  }

  function extOf(asset) {
    const fromName = /\.([a-z0-9]{2,5})$/i.exec(String(asset.name || ''));
    if (fromName) return fromName[1].toLowerCase();
    const mime = String(asset.mimeType || '');
    if (mime === 'image/png') return 'png';
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'video/mp4') return 'mp4';
    return 'bin';
  }

  /* mediaGenInput is where the real prompt lives, keyed by generation kind. */
  function promptOf(meta) {
    const input = meta && meta.mediaGenInput;
    if (!input || typeof input !== 'object') return '';
    for (const key of Object.keys(input)) {
      const branch = input[key];
      if (branch && typeof branch.prompt === 'string' && branch.prompt.trim()) return branch.prompt.trim();
    }
    return '';
  }

  function genSummary(meta) {
    const input = meta && meta.mediaGenInput;
    if (!input || typeof input !== 'object') return '';
    const branch = input[Object.keys(input)[0]] || {};
    const bits = [];
    if (branch.modelName) bits.push(branch.modelName);
    if (branch.mode) bits.push('mode ' + branch.mode);
    if (branch.aspectRatio) bits.push(branch.aspectRatio);
    if (branch.duration) bits.push(branch.duration + 's');
    if (branch.resolutionName) bits.push(branch.resolutionName);
    if (branch.numOfImages) bits.push(branch.numOfImages + ' images');
    if (Array.isArray(branch.inputAssets) && branch.inputAssets.length) {
      bits.push(branch.inputAssets.length + (branch.inputAssets.length === 1 ? ' input' : ' inputs'));
    }
    return bits.join(' · ');
  }

  /* the saved file name */
  function baseNameOf(asset, prompt) {
    const stamp = stampOf(asset.createTime);
    const kind = fileKindOf(asset);
    const raw = String(asset.name || '').replace(/\.[^.]+$/, '');
    // Grok's own file names say nothing a human needs, so they never become a slug.
    const generic = /^(image|edited[-_ ]?image|generated[-_ ]?video|file)$/i.test(raw);
    const slug = slugOf(prompt) || (generic ? '' : slugOf(raw));
    const parts = [stamp, kind];
    if (slug && slug !== kind) parts.push(slug);
    parts.push(String(asset.assetId || '').slice(0, 8));
    return parts.join('_');
  }

  function bytesLabel(n) {
    if (!n) return 'unknown size';
    if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB (' + fmtInt(n) + ' bytes)';
    if (n >= 1024) return Math.round(n / 1024) + ' KB (' + fmtInt(n) + ' bytes)';
    return n + ' bytes';
  }

  function mdFor(asset, meta, prompt, fileName) {
    const created = asset.createTime ? new Date(asset.createTime) : null;
    const url = asset.sourceConversationId ? 'https://grok.com/c/' + asset.sourceConversationId : '';
    const headline = prompt.split('\n')[0];
    const title = headline.length > 72 ? headline.slice(0, 71).trimEnd() + '…' : headline;
    const lines = [
      '# ' + title,
      '',
      '- File: ' + fileName,
      '- Asset: ' + asset.assetId,
      '- Type: ' + fileKindOf(asset) + ' (' + (asset.mimeType || 'unknown') + ')',
      '- Size: ' + bytesLabel(Number(asset.sizeBytes) || 0),
    ];
    if (asset.width && asset.height) lines.push('- Dimensions: ' + asset.width + 'x' + asset.height);
    if (created && !isNaN(created)) lines.push('- Created: ' + created.toISOString());
    const gen = genSummary(meta);
    if (gen) lines.push('- Generation: ' + gen);
    if (url) lines.push('- Conversation: ' + url);
    lines.push('- Library: https://grok.com/library', '', '## Prompt', '', '```text', prompt, '```', '');
    return lines.join('\n');
  }

  async function assetMeta(id) {
    const res = await fetch('/rest/assets/' + encodeURIComponent(id), {
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error('metadata HTTP ' + res.status);
    return res.json();
  }

  /* Save a copy, then say whether the delete may proceed. */
  async function archiveAsset(asset) {
    if (!settings.downloadFirst) return { ok: true, skipped: true };
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      return { ok: false, error: 'extension context missing, reload the page' };
    }

    let full = asset;
    let meta = null;
    if (settings.savePrompts || !asset.key) {
      try {
        meta = await assetMeta(asset.assetId);
        full = Object.assign({}, asset, meta);
      } catch (err) {
        if (!asset.key) return { ok: false, error: 'no metadata: ' + err.message };
      }
    }
    if (!full.key) return { ok: false, error: 'asset has no storage key' };

    const prompt = promptOf(meta);
    const base = baseNameOf(full, prompt);
    const folder = String(settings.folder || '').replace(/^\/+|\/+$/g, '');
    const dir = (folder ? folder + '/' : '') + base.slice(0, 10);
    const file = base + '.' + extOf(full);

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'glc-save',
        url: 'https://assets.grok.com/' + full.key,
        path: dir + '/' + file,
        expectedSize: Number(full.sizeBytes) || 0,
        md: prompt ? mdFor(full, meta, prompt, file) : '',
        mdPath: dir + '/' + base + '.md',
      });
      if (!res) return { ok: false, error: 'background did not answer' };
      return res.ok
        ? { ok: true, path: res.path, md: res.md }
        : { ok: false, error: res.error || 'download failed' };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err) };
    }
  }

  function shortPath(path) {
    const parts = String(path || '').split(/[\\/]/);
    return parts.slice(-2).join('/');
  }

  // ----------------------------------------------------------- tile glyph

  function addGlyph(tileButton) {
    const id = tileButton.getAttribute('data-library-item-id');
    if (!id) return;
    const tile = tileButton.parentElement;
    if (!tile || tile.querySelector(':scope > .glc-glyph')) return;

    const glyph = document.createElement('button');
    glyph.type = 'button';
    glyph.className = 'glc-glyph';
    glyph.title = 'Delete (immediately)';
    glyph.setAttribute('aria-label', 'Delete this item');
    glyph.innerHTML = TRASH_SVG; // static constant

    glyph.addEventListener(
      'click',
      async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (glyph.dataset.busy === '1') return;
        glyph.dataset.busy = '1';

        const saved = await archiveAsset({ assetId: id });
        if (!saved.ok) {
          glyph.dataset.busy = '0';
          glyph.dataset.error = '1';
          setTimeout(() => {
            delete glyph.dataset.error;
          }, 700);
          flashError('Not saved, not deleted', saved.error);
          return;
        }

        const res = await deleteWithRetry(id);
        if (res.ok) {
          const name = tileButton.getAttribute('aria-label') || 'item';
          hideTile(tile);
          flashSuccess(
            'Deleted ' + name,
            saved.path ? 'Saved to ' + shortPath(saved.path) : res.gone ? 'It was already gone' : 'Removed'
          );
          return;
        }
        glyph.dataset.busy = '0';
        glyph.dataset.error = '1';
        setTimeout(() => {
          delete glyph.dataset.error;
        }, 700);
        if (res.auth) flashError('Session expired', 'Sign in to Grok again, then reload.');
        else if (res.stopped) flashError('Cancelled', 'Nothing else was deleted.');
        else flashError('Delete failed', 'HTTP ' + res.status + ' for ' + id.slice(0, 8) + '…');
      },
      true
    );

    tile.appendChild(glyph);
  }

  function hideTile(tile) {
    tile.classList.add('glc-hidden');
    setTimeout(() => tile.remove(), 220);
  }

  function removeTileById(id) {
    const btn = document.querySelector(TILE_BTN + '[data-library-item-id="' + id + '"]');
    if (btn && btn.parentElement) hideTile(btn.parentElement);
  }

  // --------------------------------------------------------- header button

  function headerButton() {
    return document.querySelector('.glc-header-btn');
  }

  function ensureHeaderButton() {
    if (headerButton()) return;
    const upload = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === 'Upload files'
    );
    if (!upload) return;
    const group = upload.parentElement && upload.parentElement.parentElement;
    if (!group) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'glc-header-btn';
    btn.textContent = 'Delete all';
    btn.title = 'Scan the library, then delete what you confirm';
    btn.addEventListener('click', onHeaderClick, true);
    group.insertBefore(btn, group.firstChild);
  }

  function resetHeaderButton() {
    const btn = headerButton();
    if (!btn) return;
    btn.dataset.armed = '0';
    btn.dataset.running = '0';
    btn.textContent = 'Delete all';
    btn.disabled = false;
  }

  function onHeaderClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const btn = headerButton();
    if (!btn) return;

    if (phase === 'run') {
      stopRequested = true;
      btn.textContent = 'Stopping…';
      return;
    }
    if (phase === 'scan' || phase === 'confirm') {
      cancelAll();
      return;
    }
    if (btn.dataset.armed === '1') {
      clearTimeout(armTimer);
      btn.dataset.armed = '0';
      startScan();
      return;
    }
    btn.dataset.armed = '1';
    btn.textContent = 'Click again: ' + filtersLabel();
    armTimer = setTimeout(() => {
      if (phase === 'idle') resetHeaderButton();
    }, 5000);
  }

  function cancelAll() {
    stopRequested = true;
    phase = 'idle';
    resetHeaderButton();
    hideToast();
  }

  // ------------------------------------------------------------------ scan

  async function startScan() {
    if (phase !== 'idle') return;
    if (
      !settings.includePlain &&
      !settings.includeEdited &&
      !settings.includeVideos &&
      !settings.includeOther
    ) {
      flashError('Nothing selected', 'Turn on images, edited images, videos or files in the popup.');
      return;
    }

    phase = 'scan';
    stopRequested = false;
    const btn = headerButton();
    if (btn) {
      btn.dataset.running = '1';
      btn.textContent = 'Scanning…';
    }

    const stopAction = { label: 'Cancel', kind: 'danger', onClick: cancelAll };

    let scanned;
    const limit = settings.maxPerRun;
    try {
      scanned = await listAllAssets(
        (p) => {
          showToast({
            tone: 'busy',
            title: p.throttled ? 'Rate limited, cooling down' : 'Scanning library',
            detail:
              plural(p.count, 'asset', 'assets') +
              ' · ' +
              plural(p.pages, 'page', 'pages') +
              (p.throttled ? ' · waiting ~20-30s' : ''),
            progress: { indeterminate: true },
            actions: [stopAction],
          });
        },
        limit > 0 ? (arr) => classify(arr).targets.length >= limit : null
      );
    } catch (e) {
      phase = 'idle';
      resetHeaderButton();
      showToast({
        tone: 'error',
        title: 'Could not read the library',
        detail: String((e && e.message) || e),
        actions: [{ label: 'Dismiss', onClick: hideToast }],
      });
      return;
    }

    if (stopRequested) {
      cancelAll();
      return;
    }

    const assets = scanned.assets;
    const { counts, targets, tooBig } = classify(assets);
    let queue = targets;
    if (settings.maxPerRun > 0 && queue.length > settings.maxPerRun) {
      queue = queue.slice(0, settings.maxPerRun);
    }

    const mix =
      'images ' +
      counts.plain +
      ' · edited ' +
      counts.edited +
      ' · videos ' +
      counts.video +
      ' · files ' +
      counts.other;

    const queueCounts = { plain: 0, edited: 0, video: 0, other: 0 };
    for (const a of queue) queueCounts[classOf(a)] += 1;

    phase = 'confirm';
    if (btn) btn.textContent = 'Awaiting confirm';

    if (!queue.length) {
      phase = 'idle';
      resetHeaderButton();
      showToast({
        tone: 'success',
        title: 'Nothing to delete',
        detail:
          tooBig && !queue.length
            ? 'all ' + plural(tooBig, 'match', 'matches') + ' are over ' + settings.maxSizeMB + ' MB'
            : mix + ' · filters: ' + filtersLabel(),
        actions: [{ label: 'Close', onClick: hideToast }],
      });
      return;
    }

    showToast({
      tone: 'confirm',
      title: 'Delete ' + plural(queue.length, 'item', 'items') + '?',
      detail:
        mixShort(queueCounts) +
        ' · scanned ' +
        plural(assets.length, 'asset', 'assets') +
        (scanned.partial ? ' (partial)' : '') +
        (tooBig ? ' · skipping ' + fmtInt(tooBig) + ' over ' + settings.maxSizeMB + ' MB' : '') +
        (settings.downloadFirst
          ? ' · saving to ' + (settings.folder ? 'Downloads/' + settings.folder : 'Downloads')
          : ' · no copies saved'),
      actions: [
        {
          label: 'Delete ' + fmtInt(queue.length),
          kind: 'danger',
          onClick: () => {
            phase = 'run';
            runDeletion(queue, mix);
          },
        },
        { label: 'Cancel', onClick: cancelAll },
      ],
    });
  }

  // ---------------------------------------------------------------- delete

  async function runDeletion(queue, mix) {
    const btn = headerButton();
    if (btn) {
      btn.dataset.running = '1';
      btn.textContent = 'Stop';
    }

    const startedAt = Date.now();
    let deleted = 0;
    let failed = 0;
    let savedCount = 0;
    let unsaved = 0;
    let lastUnsaved = '';
    let authStopped = false;
    const total = queue.length;

    const stopAction = { label: 'Stop', kind: 'danger', onClick: () => (stopRequested = true) };

    const render = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const doneCount = deleted + failed;
      const remaining = total - doneCount;
      const perItem = doneCount > 0 ? elapsed / doneCount : 0;
      showToast({
        tone: 'busy',
        title: stopRequested ? 'Stopping…' : 'Deleting ' + fmtInt(deleted) + ' of ' + fmtInt(total),
        detail:
          (settings.downloadFirst ? fmtInt(savedCount) + ' saved · ' : '') +
          fmtInt(failed) +
          ' failed · ' +
          fmtSeconds(elapsed) +
          ' elapsed · ' +
          (doneCount > 2 ? '~' + fmtSeconds(perItem * remaining) + ' left' : 'estimating…'),
        progress: { value: doneCount, max: total },
        actions: stopRequested ? [] : [stopAction],
      });
    };

    render();
    await sleep(rand(400, 1200));

    let nextLongAt = Math.round(rand(settings.longPauseEveryMin, settings.longPauseEveryMax));

    for (let i = 0; i < queue.length; i += 1) {
      if (stopRequested) break;
      const asset = queue[i];
      const saved = await archiveAsset(asset);
      const res = saved.ok ? await deleteWithRetry(asset.assetId) : { ok: false, unsaved: saved.error };

      if (res.stopped) break;
      if (res.auth) {
        authStopped = true;
        break;
      }
      if (res.ok) {
        deleted += 1;
        if (saved.path) savedCount += 1;
        removeTileById(asset.assetId);
      } else {
        failed += 1;
        if (res.unsaved) {
          unsaved += 1;
          lastUnsaved = res.unsaved;
        }
      }
      render();

      if (i + 1 < queue.length && !stopRequested) {
        if ((i + 1) % nextLongAt === 0) {
          await sleep(rand(settings.longPauseMin, settings.longPauseMax));
          nextLongAt = i + 1 + Math.round(rand(settings.longPauseEveryMin, settings.longPauseEveryMax));
        } else {
          let wait = rand(settings.minDelay, settings.maxDelay);
          if (Math.random() < 0.1) wait += rand(200, 900);
          await sleep(wait);
        }
      }
    }

    phase = 'idle';
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    if (btn) {
      btn.dataset.running = '0';
      btn.dataset.armed = '0';
      btn.textContent = 'Delete all';
    }

    showToast({
      tone: authStopped ? 'error' : stopRequested ? 'confirm' : failed ? 'error' : 'success',
      title: authStopped
        ? 'Stopped: session expired'
        : stopRequested
          ? 'Stopped at ' + deleted
          : failed
            ? 'Finished with ' + failed + ' failed'
            : 'Deleted ' + plural(deleted, 'item', 'items'),
      detail:
        (settings.downloadFirst ? fmtInt(savedCount) + ' saved · ' : '') +
        fmtInt(deleted) +
        ' deleted · ' +
        fmtInt(failed) +
        ' failed · ' +
        fmtSeconds(elapsed) +
        (unsaved ? ' · ' + fmtInt(unsaved) + ' kept back: ' + lastUnsaved : ''),
      progress: { value: total - Math.max(0, total - deleted - failed), max: total },
      actions: [
        { label: 'Reload library', onClick: () => location.reload() },
        { label: 'Close', onClick: hideToast },
      ],
    });
  }

  // --------------------------------------------------------------- wiring

  function decorate() {
    document.querySelectorAll(TILE_BTN).forEach(addGlyph);
    ensureHeaderButton();
  }

  let scheduled = false;
  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      decorate();
    });
  }

  const observer = new MutationObserver(scheduleDecorate);
  observer.observe(document.body, { childList: true, subtree: true });

  // Safety net for scroll-restored rows the observer can miss.
  setInterval(decorate, 1500);

  decorate();

  // Console hook so the pipeline can be exercised without the extension host.
  window.__grokLibraryCleanerApi = {
    list: listAllAssets,
    preview: async () => {
      const res = await listAllAssets();
      const { counts, chosen, targets, tooBig } = classify(res.assets);
      return {
        scanned: res.assets.length,
        pages: res.pages,
        partial: res.partial,
        counts,
        chosen,
        queue: targets.length,
        tooBig,
        maxSizeMB: settings.maxSizeMB,
        downloadFirst: settings.downloadFirst,
        folder: settings.folder,
        filters: filtersLabel(),
      };
    },
    // Development helper: resolve naming, prompt and .md without downloading.
    archivePreview: async (id) => {
      const meta = await assetMeta(id);
      const prompt = promptOf(meta);
      const base = baseNameOf(meta, prompt);
      const file = base + '.' + extOf(meta);
      const day = base.slice(0, 10);
      const dir = (settings.folder ? settings.folder + '/' : '') + day;
      return {
        file,
        path: dir + '/' + file,
        mdPath: prompt ? dir + '/' + base + '.md' : null,
        prompt,
        generation: genSummary(meta),
        md: prompt ? mdFor(meta, meta, prompt, file) : '',
      };
    },
    // Development helpers: render a toast state without touching the library.
    toast: showToast,
    flashSuccess,
    flashError,
    configure: (patch) => {
      applySettings({ ...settings, ...(patch || {}) });
      return { ...settings };
    },
    start: startScan,
    stop: cancelAll,
    settings: () => settings,
    decorate,
  };
})();
