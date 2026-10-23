/* Settings popup: stores pacing and type filters under chrome.storage.local.settings */
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
  maxSizeMB: 0,
  downloadFirst: false,
  folder: '',
  savePrompts: true,
};

const NUMBER_FIELDS = [
  ['minDelay', 'minDelay'],
  ['maxDelay', 'maxDelay'],
  ['longPauseEveryMin', 'every'],
  ['longPauseEveryMax', 'everyMax'],
  ['longPauseMin', 'pause'],
  ['longPauseMax', 'pauseMax'],
  ['maxPerRun', 'maxPerRun'],
  ['maxSizeMB', 'maxSizeMB'],
];

const CHECKBOXES = [
  'includePlain',
  'includeEdited',
  'includeVideos',
  'includeOther',
  'downloadFirst',
  'savePrompts',
];

/* Downloads land under Downloads/<folder>, so keep it to one plain path segment. */
function cleanFolder(value) {
  const cleaned = String(value || '')
    .replace(/[<>:"\\|?*]/g, '')
    .replace(/^[.\/\s]+|[.\/\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 60);
  return cleaned;
}

/* The folder and prompt fields only mean something while saving is on. */
function syncSave(settings) {
  const on = document.getElementById('downloadFirst').checked;
  const folder = document.getElementById('folder');
  const prompts = document.getElementById('savePrompts');
  folder.disabled = !on;
  prompts.disabled = !on;
  folder.style.opacity = on ? '' : '0.45';
  prompts.parentElement.style.opacity = on ? '' : '0.45';
  if (settings) {
    folder.value = on ? settings.folder || '' : folder.value;
  }
}

function fill(settings) {
  const s = { ...DEFAULTS, ...(settings || {}) };
  // Migrate the pre 1.1 single "includeImages" flag.
  if (s.includeImages !== undefined) {
    if (s.includePlain === undefined) s.includePlain = s.includeImages !== false;
    if (s.includeEdited === undefined) s.includeEdited = s.includeImages !== false;
  }
  for (const [key, id] of NUMBER_FIELDS) document.getElementById(id).value = s[key];
  for (const key of CHECKBOXES) document.getElementById(key).checked = s[key] !== false && s[key] === true;
  document.getElementById('folder').value = s.folder || '';
  syncSave(s);
}

function read() {
  const v = (id) => Number(document.getElementById(id).value);
  const out = {
    minDelay: Math.min(60000, Math.max(300, v('minDelay') || DEFAULTS.minDelay)),
    maxDelay: Math.min(120000, Math.max(300, v('maxDelay') || DEFAULTS.maxDelay)),
    longPauseEveryMin: Math.min(200, Math.max(2, v('every') || DEFAULTS.longPauseEveryMin)),
    longPauseEveryMax: Math.min(200, Math.max(2, v('everyMax') || DEFAULTS.longPauseEveryMax)),
    longPauseMin: Math.min(300000, Math.max(1000, v('pause') || DEFAULTS.longPauseMin)),
    longPauseMax: Math.min(600000, Math.max(1000, v('pauseMax') || DEFAULTS.longPauseMax)),
    maxPerRun: Math.min(50000, Math.max(0, v('maxPerRun') || 0)),
    maxSizeMB: Math.min(4096, Math.max(0, Math.round((v('maxSizeMB') || 0) * 10) / 10)),
  };
  for (const key of CHECKBOXES) out[key] = document.getElementById(key).checked;
  out.folder = cleanFolder(document.getElementById('folder').value);
  if (out.maxDelay < out.minDelay) out.maxDelay = out.minDelay;
  if (out.longPauseEveryMax < out.longPauseEveryMin) out.longPauseEveryMax = out.longPauseEveryMin;
  if (out.longPauseMax < out.longPauseMin) out.longPauseMax = out.longPauseMin;
  return out;
}

const store = (globalThis.chrome && chrome.storage && chrome.storage.local) || null;

if (store) {
  store.get('settings').then(
    (v) => fill(v && v.settings),
    () => fill(DEFAULTS)
  );
} else {
  fill(DEFAULTS); // keeps the form usable when storage is unreachable
}

document.getElementById('save').addEventListener('click', async () => {
  const settings = read();
  const status = document.getElementById('status');
  if (!store) {
    status.textContent = 'Storage is unavailable in this context.';
    return;
  }
  await store.set({ settings });
  fill(settings);
  status.textContent = 'Saved. Applies to the open library tab.';
  setTimeout(() => {
    status.textContent = '';
  }, 3000);
});

for (const [, id] of NUMBER_FIELDS) {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('save').click();
  });
}

/* Proves the download path really works for the chosen folder. */
document.getElementById('downloadFirst').addEventListener('change', () => syncSave());
syncSave();

document.getElementById('selftest').addEventListener('click', async () => {
  const status = document.getElementById('status');
  const folder = cleanFolder(document.getElementById('folder').value);
  status.textContent = 'Testing downloads in ' + folder + '…';
  try {
    const res = await chrome.runtime.sendMessage({ type: 'glc-selftest', folder });
    status.textContent = res && res.ok
      ? 'Saved ' + res.path
      : 'Failed: ' + ((res && res.error) || 'no answer from the extension');
  } catch (err) {
    status.textContent = 'Failed: ' + String((err && err.message) || err);
  }
});
