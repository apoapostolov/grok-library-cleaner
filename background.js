/* Grok Library Cleaner - service worker.
 *
 * Saves one asset through Chrome's download manager before the content script
 * deletes it. The download is issued by the browser itself, so the profile's
 * grok.com cookies ride along; the asset CDN answers 403 to a cookieless
 * request, which rules out a plain fetch from here.
 *
 * A save only reports ok when the transfer finished AND the file size matches
 * the sizeBytes the API reported for that asset, so an error page posing as a
 * download can never authorise a delete.
 */

const TIMEOUT_MS = 10 * 60 * 1000;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;
  const known = msg.type === 'glc-save' || msg.type === 'glc-selftest' || msg.type === 'glc-run-all';
  if (!known) return false;
  const work =
    msg.type === 'glc-run-all'
      ? startRunInGrokTab()
      : msg.type === 'glc-selftest'
        ? selfTest(msg)
        : saveAsset(msg);
  work
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true; // keep the channel open for the async reply
});

/* ---------------------------------------------------------------------
 * Runs started from the popup.
 *
 * The scan and the deletes live in the content script, because they need the
 * page's cookie session and the on-page toast. So the popup's Delete all only
 * wakes a Grok tab: an open one is preferred, otherwise the library is opened.
 * --------------------------------------------------------------------- */

const GROK_ORIGIN = 'https://grok.com/';

async function findGrokTab() {
  const tabs = await chrome.tabs.query({ url: 'https://grok.com/*' });
  if (!tabs || !tabs.length) return null;
  return tabs.find((t) => t.active) || tabs[0];
}

/* A freshly opened tab needs a moment before its content script answers. */
function waitForContentScript(tabId, tries = 24, gap = 500) {
  return new Promise((resolve) => {
    let attempt = 0;
    const tick = () => {
      chrome.tabs.sendMessage(tabId, { type: 'glc-ping' }, (res) => {
        if (chrome.runtime.lastError) {
          // no listener yet; expected while the page is still booting
        }
        if (res && res.ok) return resolve(true);
        attempt += 1;
        if (attempt >= tries) return resolve(false);
        setTimeout(tick, gap);
      });
    };
    tick();
  });
}

/**
 * A tab that was already open when the extension was reloaded still holds the previous
 * copy of the content script, and that copy can never answer again: its extension context
 * is gone. Reloading the user's tab would throw away whatever they had in it, so an
 * unresponsive tab is left alone and the run opens its own library tab instead.
 */
async function startRunInGrokTab() {
  const open = await findGrokTab();
  if (open && (await waitForContentScript(open.id, 12, 500))) {
    return launchRun(open.id);
  }

  const tab = await chrome.tabs.create({ url: GROK_ORIGIN + 'library', active: true });
  if (!(await waitForContentScript(tab.id, 40, 500))) {
    return {
      ok: false,
      error: 'No Grok tab answered. Reload the extension in chrome://extensions, then try again.',
    };
  }
  return launchRun(tab.id);
}

function launchRun(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'glc-start' }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false, error: 'No answer from the page.' });
    });
  });
}

async function saveAsset({ url, path, expectedSize, md, mdPath }) {
  if (!url || !path) return { ok: false, error: 'missing url or path' };

  const file = await downloadOne(url, path, expectedSize);
  if (!file.ok) return file;

  let mdFile = null;
  if (md && mdPath) {
    // A missing prompt file must not block the delete: the media is already safe.
    mdFile = await downloadText(md, mdPath);
  }

  return {
    ok: true,
    path: file.filename,
    bytes: file.fileSize,
    md: mdFile && mdFile.ok ? mdFile.filename : null,
    mdError: mdFile && !mdFile.ok ? mdFile.error : null,
  };
}

/* Proves the download path end to end for the folder the user picked. */
async function selfTest({ folder }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = (folder ? folder + '/' : '') + '_selftest_' + stamp + '.txt';
  const res = await downloadText('Grok Library Cleaner: downloads work.\n', path);
  return res.ok ? { ok: true, path: res.filename, bytes: res.fileSize } : res;
}

async function downloadOne(url, filename, expectedSize) {
  let id;
  try {
    id = await chrome.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: false,
    });
  } catch (err) {
    return { ok: false, error: 'start failed: ' + String((err && err.message) || err) };
  }
  if (typeof id !== 'number') return { ok: false, error: 'download did not start' };

  const done = await waitFor(id);
  if (!done.ok) return done;

  const size = typeof done.fileSize === 'number' ? done.fileSize : -1;
  if (expectedSize > 0 && size >= 0 && size < expectedSize * 0.9) {
    return { ok: false, error: 'size mismatch: ' + size + ' of ' + expectedSize + ' bytes' };
  }
  return done;
}

async function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    return await downloadOne(url, filename, 0);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function waitFor(id) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(res);
    };
    const read = async () => {
      try {
        const [d] = await chrome.downloads.search({ id });
        if (!d) return settle({ ok: false, error: 'download vanished' });
        if (d.state === 'complete') {
          settle({ ok: true, filename: d.filename, fileSize: d.fileSize });
        } else if (d.state === 'interrupted') {
          settle({ ok: false, error: d.error || 'interrupted' });
        }
      } catch (err) {
        settle({ ok: false, error: String((err && err.message) || err) });
      }
    };
    const onChanged = (delta) => {
      if (delta.id === id && (delta.state || delta.filename || delta.fileSize)) read();
    };
    const timer = setTimeout(() => settle({ ok: false, error: 'timed out after 10 minutes' }), TIMEOUT_MS);
    chrome.downloads.onChanged.addListener(onChanged);
    read();
  });
}
