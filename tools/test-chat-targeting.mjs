// Regression checks for chat targeting against the real shipped scripts.
// Run: node tools/test-chat-targeting.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.dataset = {};
    this.attrs = {};
    this.children = [];
    this.parentElement = null;
    this.listeners = {};
    this.style = { setProperty() {} };
    this.textContent = '';
    this.className = '';
    this.title = '';
    this.type = '';
    this.checked = false;
    this.innerHTML = '';
    this.offsetWidth = 0;
    this.isConnected = true;
    const classes = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      toggle: (c, on) => {
        const next = on === undefined ? !classes.has(c) : !!on;
        next ? classes.add(c) : classes.delete(c);
        return next;
      },
      contains: (c) => classes.has(c),
    };
  }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  insertBefore(child, ref) {
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(child);
    else this.children.splice(i, 0, child);
    child.parentElement = this;
    return child;
  }
  remove() {
    if (this.parentElement) {
      const i = this.parentElement.children.indexOf(this);
      if (i >= 0) this.parentElement.children.splice(i, 1);
      this.parentElement = null;
    }
    this.isConnected = false;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  removeAttribute(name) {
    delete this.attrs[name];
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  dispatch(type, extra = {}) {
    for (const fn of this.listeners[type] || []) {
      fn({ preventDefault() {}, stopPropagation() {}, target: this, ...extra });
    }
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  _descendants() {
    const out = [];
    for (const child of this.children) {
      out.push(child, ...child._descendants());
    }
    return out;
  }
  querySelectorAll(sel) {
    const pool = sel.startsWith(':scope > ') ? this.children : this._descendants();
    if (sel === 'button[draggable="true"]') {
      return pool.filter((c) => c.tagName === 'BUTTON' && c.getAttribute('draggable') === 'true');
    }
    if (sel === '[data-sidebar-item-label]') {
      return pool.filter((c) => c.dataset.sidebarItemLabel !== undefined);
    }
    if (sel === ':scope > .glc-chat-check') {
      return pool.filter((c) => c.className.includes('glc-chat-check'));
    }
    if (sel === ':scope > .glc-chat-delete') {
      return pool.filter((c) => c.className.includes('glc-chat-delete'));
    }
    return [];
  }
  contains(el) {
    for (let cur = el; cur; cur = cur.parentElement) if (cur === this) return true;
    return false;
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
}

function makeRow(reactId, stampedId) {
  const wrap = new El('div');
  wrap.dataset.reorderItem = 'recent';
  const btn = new El('button');
  btn.setAttribute('draggable', 'true');
  const label = new El('span');
  label.dataset.sidebarItemLabel = '';
  label.textContent = 'chat ' + reactId;
  btn.appendChild(label);
  if (reactId) {
    Object.defineProperty(btn, '__reactFiber', {
      value: { memoizedProps: { conversation: { conversationId: reactId } }, return: null },
      enumerable: true,
      configurable: true,
    });
  }
  wrap.appendChild(btn);
  if (stampedId) wrap.dataset.glcConversationId = stampedId;
  return { wrap, btn, label };
}

function makeDoc(rows, tokenByRow = []) {
  const body = new El('body');
  const sidebar = new El('aside');
  sidebar.id = 'app-sidebar';
  const root = new El('div');
  root.dataset.reorderItem = 'recent';
  const footer = new El('footer');
  rows.forEach((r, i) => {
    if (tokenByRow[i]) r.wrap.setAttribute('data-glc-chat-target', tokenByRow[i]);
    root.appendChild(r.wrap);
  });
  sidebar.appendChild(root);
  sidebar.appendChild(footer);
  body.appendChild(sidebar);
  body.contains = (el) => {
    for (let cur = el; cur; cur = cur.parentElement) if (cur === body) return true;
    return false;
  };
  const doc = {
    body,
    createElement: (tag) => new El(tag),
    querySelector(sel) {
      if (sel === '#app-sidebar [data-reorder-item="recent"]') return root;
      if (sel === '#app-sidebar footer') return footer;
      if (sel === '#app-sidebar .glc-chat-selected-btn') {
        return footer.children.find((c) => c.className.includes('glc-chat-selected-btn')) || null;
      }
      const m = /^\[data-glc-chat-target="(.+)"\]$/.exec(sel);
      if (m) {
        return rows.map((r) => r.wrap).find((w) => w.getAttribute('data-glc-chat-target') === m[1]) || null;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '#app-sidebar [data-reorder-item="recent"] button[draggable="true"]') {
        return rows.map((r) => r.btn);
      }
      if (sel === '#app-sidebar [data-reorder-item="recent"] .glc-chat-row') {
        return rows.filter((r) => r.wrap.classList.contains('glc-chat-row')).map((r) => r.wrap);
      }
      if (sel === '#app-sidebar .glc-chat-selected-btn') {
        return footer.children.filter((c) => c.className.includes('glc-chat-selected-btn'));
      }
      return [];
    },
  };
  return { doc, root, footer };
}

JSON.parse(read('manifest.json'));
new vm.Script(read('background.js'));
new vm.Script(read('content.js'));

// ---------------------------------------------------- background injections
let handler = null;
const calls = [];
let mainDoc = null;
const bg = vm.createContext({
  chrome: {
    runtime: { onMessage: { addListener: (fn) => { handler = fn; } } },
    scripting: {
      executeScript: (opts) => {
        calls.push(opts);
        const ctx = vm.createContext({ document: mainDoc });
        const fn = vm.runInContext('(' + opts.func.toString() + ')', ctx);
        return Promise.resolve([{ result: fn(...(opts.args || [])) }]);
      },
    },
    tabs: { query: async () => [], sendMessage() {}, create: async () => ({ id: 1 }) },
    downloads: { download: async () => 1, onChanged: { addListener() {}, removeListener() {} }, search: async () => [] },
  },
  setTimeout: () => 0,
  clearTimeout() {},
  console,
});
vm.runInContext(read('background.js'), bg);
assert.ok(handler, 'background message handler registered');

function ask(msg) {
  return new Promise((resolve) => {
    assert.equal(handler(msg, { tab: { id: 7 } }, resolve), true);
  });
}

async function backgroundChecks() {
  const a = makeRow('chat-A');
  const b = makeRow('chat-B');
  mainDoc = makeDoc([a, b], ['glc-chat-1', 'glc-chat-2']).doc;

  // Ask for the second row first. The old code read the first marked row.
  assert.equal((await ask({ type: 'glc-chat-id', token: 'glc-chat-2' })).id, 'chat-B');
  assert.equal((await ask({ type: 'glc-chat-id', token: 'glc-chat-1' })).id, 'chat-A');
  assert.deepEqual(Array.from(calls[0].args), ['glc-chat-2']);
  assert.equal(calls[0].world, 'MAIN');
  assert.equal((await ask({ type: 'glc-chat-id', token: 'bad")]} ;' })).id, '');

  // A row reused for another chat must take the new id; an unreadable one clears.
  const reused = makeRow('chat-new', 'chat-old');
  const plain = makeRow('chat-plain');
  const gone = makeRow('', 'chat-gone');
  mainDoc = makeDoc([reused, plain, gone]).doc;
  assert.equal((await ask({ type: 'glc-stamp-chats' })).stamped, 3);
  assert.equal(reused.wrap.dataset.glcConversationId, 'chat-new');
  assert.equal(plain.wrap.dataset.glcConversationId, 'chat-plain');
  assert.equal(gone.wrap.dataset.glcConversationId, undefined);
  assert.equal((await ask({ type: 'glc-stamp-chats' })).stamped, 0);
  console.log('background: per-row tokens and row reuse OK');
}

// -------------------------------------------------------------- content.js
async function contentChecks() {
  const rows = [makeRow('fresh-A', 'old-A'), makeRow('fresh-B', 'old-B')];
  const { doc, footer } = makeDoc(rows);
  const messages = [];
  const pending = new Map();
  const chromeStub = {
    storage: { local: { get: () => Promise.resolve({}) }, onChanged: { addListener() {} } },
    runtime: {
      onMessage: { addListener() {} },
      getManifest: () => ({ version: '1.2.0' }),
      sendMessage: (msg) => {
        messages.push(msg);
        if (msg.type === 'glc-chat-id') return new Promise((resolve) => pending.set(msg.token, resolve));
        if (msg.type === 'glc-stamp-chats') return Promise.resolve({ stamped: 0 });
        return Promise.resolve({});
      },
    },
  };
  const ctx = vm.createContext({
    window: {},
    document: doc,
    chrome: chromeStub,
    location: { pathname: '/c/other', assign() {}, reload() {} },
    MutationObserver: class { observe() {} },
    requestAnimationFrame: (fn) => fn(),
    setInterval: () => 0,
    setTimeout: () => 0,
    clearTimeout() {},
    console,
  });
  vm.runInContext(read('content.js'), ctx);
  const api = ctx.window.__grokLibraryCleanerApi;
  assert.ok(api, 'content script installed its test hook');
  api.decorate();

  const boxes = rows.map((r) => r.wrap.querySelector(':scope > .glc-chat-check'));
  assert.ok(boxes.every(Boolean), 'each chat row got a checkbox');
  boxes.forEach((box) => {
    box.checked = true;
    box.dispatch('change');
  });

  const lookups = messages.filter((m) => m.type === 'glc-chat-id');
  assert.equal(lookups.length, 2, 'one lookup per click');
  assert.notEqual(lookups[0].token, lookups[1].token, 'each click has its own token');
  assert.match(lookups[0].token, /^glc-chat-\d+$/);

  // Resolve the second click first; neither row may inherit the other's id.
  pending.get(lookups[1].token)({ id: 'resolved-B' });
  pending.get(lookups[0].token)({ id: 'resolved-A' });
  await new Promise((r) => setImmediate(r));
  assert.equal(rows[0].wrap.dataset.glcConversationId, 'resolved-A');
  assert.equal(rows[1].wrap.dataset.glcConversationId, 'resolved-B');
  assert.equal(rows[0].wrap.getAttribute('data-glc-chat-target'), null, 'target marker cleared');
  assert.equal(rows[1].wrap.getAttribute('data-glc-chat-target'), null, 'target marker cleared');

  const selected = () => footer.children.find((c) => c.className.includes('glc-chat-selected-btn'));
  assert.equal(selected().textContent, 'Delete selected (2)');

  // Grok reuses the first row: the old chat must leave the selection with it.
  Object.defineProperty(rows[0].btn, '__reactFiber', {
    value: { memoizedProps: { conversation: { conversationId: 'reused-C' } }, return: null },
    enumerable: true,
    configurable: true,
  });
  rows[0].wrap.dataset.glcConversationId = 'reused-C';
  api.decorate();
  assert.equal(selected().textContent, 'Delete selected (1)');
  assert.equal(boxes[0].checked, false);
  assert.equal(boxes[1].checked, true);
  console.log('content: independent lookups and stale-row selection cleanup OK');
}

await backgroundChecks();
await contentChecks();
console.log('all chat targeting checks passed');
