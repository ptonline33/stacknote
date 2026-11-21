// app.js — UI, interactions and workflow wiring for StackNote.

import {
  STORAGE_KEY, BUILTIN_VARS, BUILTIN_VAR_HELP, DEFAULT_SETTINGS,
  uid, esc, clone, fmtStamp, todayCount, loadState, saveState,
  normalizeState, findItem, touchUsage, seedState, SECTION_LABELS
} from './data.js';
import {
  compose, buildVars, resolve, detectFields, renderBlock, collectKB,
  blockTitle, blockSnippet, copyText,
  SUPABASE_SQL, syncTest, syncPush, syncPull
} from './core.js';

const MOD = /Mac|iPod|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
const ARR = { template: 'templates', kb: 'kb', email: 'emails', kit: 'kits' };
const TABS = [
  { id: 'builder', label: 'Builder', icon: '▦' },
  { id: 'library', label: 'Library', icon: '▤' },
  { id: 'kits', label: 'Quick Kits', icon: '⚡' },
  { id: 'history', label: 'History', icon: '◷' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
];

let state = loadState();
const ui = {
  tab: 'builder',
  libTab: 'template',
  libSearch: '',
  historySearch: '',
  mobileView: 'library',
  contextOpen: true,
  modal: false,
  modalMeta: {},
  confirmCb: null,
  promptCb: null,
  palette: null,
  deferredInstall: null,
  lastTextarea: null,
  focusBlockId: null
};

const $ = (sel) => document.querySelector(sel);
const view = $('#view');

/* ------------------------------------------------------------------ */
/* Theme + small utilities                                            */
/* ------------------------------------------------------------------ */

function applyTheme() {
  const pref = state.settings.theme || 'dark';
  const resolved = pref === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : pref;
  document.documentElement.dataset.theme = resolved;
  $('meta[name="theme-color"]')?.setAttribute('content', resolved === 'light' ? '#f2f5fb' : '#0a0f1c');
}

function save() { saveState(state); }

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const icon = kind === 'ok' ? '✓' : kind === 'err' ? '!' : '›';
  el.innerHTML = `<span class="t-icon">${icon}</span><span>${esc(message)}</span>`;
  $('#toast-root').appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .2s';
    setTimeout(() => el.remove(), 220);
  }, 3200);
}

function firstLine(text, max = 96) {
  const line = String(text || '').split('\n').find((l) => l.trim()) || '(empty)';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function showSep(sep) {
  return String(sep ?? '\n\n').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
}

function highlight(text) {
  return esc(text).replace(/\{\{[^}]+\}\}/g, (m) => `<span class="ph">${m}</span>`);
}

function itemLabel(kind, it) {
  if (kind === 'kb') return `${it.number || 'KB?'} — ${it.title || 'Untitled'}`;
  return it.name || 'Untitled';
}

function itemTag(kind, it) {
  if (kind === 'template') return it.category || 'General';
  if (kind === 'kb') return 'KB';
  if (kind === 'email') return 'Email';
  return `${(it.blocks || []).length} blocks`;
}

function itemSub(kind, it) {
  if (kind === 'template') return firstLine(it.shortDescription || it.description || it.body);
  if (kind === 'kb') return firstLine(it.notes || it.url || '');
  if (kind === 'email') return `Subject: ${firstLine(it.subject)}`;
  return (it.blocks || []).map((b) => blockTitle(state, b)).join(' · ') || 'Empty kit';
}

function bodyPreview(kind, it) {
  if (kind === 'template') {
    return [
      it.shortDescription ? `Short description: ${it.shortDescription}` : '',
      it.description ? `Description: ${it.description}` : '',
      it.body ? `Work notes: ${it.body}` : ''
    ].filter(Boolean).join('\n\n') || '(empty)';
  }
  if (kind === 'kb') return `${it.url || ''}\n${it.notes || ''}`.trim();
  return `Subject: ${it.subject || ''}\n\n${it.body || ''}`.trim();
}

function searchable(kind, it) {
  return [it.name, it.number, it.title, it.category, it.shortDescription, it.description,
    it.subject, it.body, it.notes, it.url].filter(Boolean).join(' ');
}

function sortedItems(kind, search = ui.libSearch) {
  const list = [...(state[ARR[kind]] || [])];
  const q = String(search).trim().toLowerCase();
  const filtered = q
    ? list.filter((it) => searchable(kind, it).toLowerCase().includes(q))
    : list;
  const sort = ui.libSort || state.settings.sort || 'used';
  filtered.sort((a, b) => {
    const an = itemLabel(kind, a), bn = itemLabel(kind, b);
    if (sort === 'alpha') return an.localeCompare(bn);
    if (sort === 'recent') {
      return new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0);
    }
    if (!!b.favorite !== !!a.favorite) return b.favorite ? 1 : -1;
    if ((b.uses || 0) !== (a.uses || 0)) return (b.uses || 0) - (a.uses || 0);
    return an.localeCompare(bn);
  });
  return filtered;
}

function setSetting(path, value) {
  if (path.startsWith('supabase.')) {
    state.settings.supabase[path.slice(9)] = String(value);
  } else {
    state.settings[path] = value;
  }
  if (path === 'theme') { applyTheme(); renderHeader(); }
  if (path === 'sort') { ui.libSort = value; renderLibLists(); }
}

/* ------------------------------------------------------------------ */
/* Header / tabs                                                       */
/* ------------------------------------------------------------------ */

const BRAND_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="19" y="10" width="35" height="34" rx="6" fill="#061022" opacity="0.28"/><rect x="10" y="19" width="35" height="36" rx="6" fill="#061022" opacity="0.75"/><g fill="#061022"><rect x="16" y="27" width="23" height="3.4" rx="1.7" fill="#e9eefb" opacity="0.95"/><rect x="16" y="34" width="23" height="3.4" rx="1.7" fill="#e9eefb" opacity="0.8"/><rect x="16" y="41" width="15" height="3.4" rx="1.7" fill="#e9eefb" opacity="0.65"/></g></svg>`;

const COPY_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

function renderHeader() {
  const cfg = state.settings.supabase || {};
  const syncOn = !!(cfg.url && cfg.key && cfg.workspace);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const resolvedTheme = document.documentElement.dataset.theme;
  $('#header-root').innerHTML = `
    <div class="brand">
      <div class="brand-mark">${BRAND_SVG}</div>
      <div>
        <div class="brand-name">StackNote</div>
        <div class="brand-tag">ServiceNow note builder</div>
      </div>
    </div>
    <div class="header-actions">
      <span class="chip hide-sm" title="Installable PWA — works without a network connection"><span class="dot" style="background:var(--success)"></span>Offline-ready</span>
      <span class="chip ${syncOn ? 'ok' : 'off'} hide-sm"><span class="dot"></span>${syncOn ? 'Sync on' : 'Local only'}</span>
      <button class="btn btn-sm" data-action="palette" title="Command palette"><span class="kbd">${MOD} K</span> Quick find</button>
      <button class="btn btn-sm btn-ghost" data-action="shortcuts" title="Keyboard shortcuts">?</button>
      ${ui.deferredInstall && !standalone ? '<button class="btn btn-sm btn-primary" data-action="install">↓ Install app</button>' : ''}
      <button class="icon-btn" data-action="theme-toggle" title="Toggle light / dark">${resolvedTheme === 'light' ? '☾' : '☀'}</button>
    </div>`;
}

function renderTabs() {
  const counts = {
    library: state.templates.length + state.kb.length + state.emails.length,
    kits: state.kits.length,
    history: state.history.length
  };
  $('#tabs-root').innerHTML = TABS.map((t) => `
    <button class="tab ${ui.tab === t.id ? 'active' : ''}" data-action="tab" data-tab="${t.id}">
      <span aria-hidden="true">${t.icon}</span>${t.label}
      ${counts[t.id] !== undefined ? `<span class="count">${counts[t.id]}</span>` : ''}
    </button>`).join('');
}

/* ------------------------------------------------------------------ */
/* Builder                                                            */
/* ------------------------------------------------------------------ */

function renderContext(fields) {
  const c = state.context || {};
  const extras = fields.length ? `
    <div class="context-extras">
      ${fields.map((key) => `
        <div class="field">
          <label class="context-extra-badge" for="f-${esc(key)}">✦ ${esc(key)}</label>
          <input class="input" id="f-${esc(key)}" data-field="${esc(key)}"
                 value="${esc(state.fields[key] || '')}" placeholder="optional value">
        </div>`).join('')}
    </div>` : '';
  return `
    <div class="context">
      <div class="context-head">
        <button class="icon-btn" data-action="context-toggle" title="Show / hide">${ui.contextOpen ? '▾' : '▸'}</button>
        <h2>Ticket context</h2>
        <span class="hint">Fill once — every <code>{{placeholder}}</code> below updates live.</span>
        <div style="flex:1"></div>
        <button class="btn btn-sm" data-action="new-ticket">↺ New ticket</button>
      </div>
      ${ui.contextOpen ? `
      <div class="context-grid">
        <div class="field">
          <label for="ctx-ticket">Ticket number</label>
          <input class="input" id="ctx-ticket" data-context="ticket" value="${esc(c.ticket || '')}" placeholder="INC0012345" autocomplete="off">
        </div>
        <div class="field">
          <label for="ctx-caller">Caller / user</label>
          <input class="input" id="ctx-caller" data-context="caller" value="${esc(c.caller || '')}" placeholder="Jane Doe" autocomplete="off">
        </div>
        <div class="field">
          <label for="ctx-phone">Phone / contact number <span class="muted">({{phone}})</span></label>
          <input class="input" id="ctx-phone" data-context="phone" value="${esc(c.phone || '')}" placeholder="+1 555 010 1234" autocomplete="off" inputmode="tel">
        </div>
        <div class="field">
          <label for="ctx-sd">Short description</label>
          <input class="input" id="ctx-sd" data-context="shortdesc" value="${esc(c.shortdesc || '')}" placeholder="Cannot sign in to VPN" autocomplete="off">
        </div>
        <div class="field">
          <label for="ctx-kbnum">KB# quick entry <span class="muted">({{kbnum}} / {{kb}})</span></label>
          <input class="input" id="ctx-kbnum" data-context="kbnum" value="${esc(c.kbnum || '')}" placeholder="KB0012345, KB0099888" autocomplete="off">
        </div>
        <div class="field">
          <label for="ctx-agent">Your name / initials</label>
          <input class="input" id="ctx-agent" data-setting="agent" value="${esc(state.settings.agent || '')}" placeholder="e.g. A. Patel" autocomplete="off">
        </div>
      </div>
      <div class="hint" style="padding:0 14px 8px">✦ A <b>KB#</b> typed above is merged into <code>{{kb}}</code> / <code>{{kbnum}}</code> and appended to Work notes if no template already includes it.</div>
      ${extras}
      ${fields.length ? '<div class="hint" style="padding:0 14px 12px">✦ Custom fields above were detected automatically from the templates in your stack.</div>' : ''}
      ` : ''}
    </div>`;
}

const LIB_TABS = [
  { id: 'template', label: 'Notes' },
  { id: 'kb', label: 'KB' },
  { id: 'email', label: 'Email' },
  { id: 'kit', label: 'Kits' }
];

function libItemHtml(kind, it) {
  const isKit = kind === 'kit';
  return `
    <div class="item" data-action="${isKit ? 'load-kit' : 'add'}" data-kind="${kind}" data-id="${esc(it.id)}"
         title="${isKit ? 'Load this kit into the stack' : 'Add to the stack'}">
      <div class="item-top">
        <span class="item-name">${esc(itemLabel(kind, it))}</span>
        <span class="tag ${kind === 'kit' ? 'gray' : ''}">${esc(itemTag(kind, it))}</span>
        <span style="flex:1"></span>
        ${isKit ? '' : `<button class="icon-btn ${it.favorite ? 'on' : ''}" data-action="fav" data-kind="${kind}" data-id="${esc(it.id)}" title="Pin as favorite">${it.favorite ? '★' : '☆'}</button>`}
        ${isKit ? '' : `<button class="icon-btn" data-action="copy-item" data-kind="${kind}" data-id="${esc(it.id)}" title="Copy just this item">⧉</button>`}
      </div>
      <div class="item-snippet">${esc(itemSub(kind, it))}</div>
      <div class="item-meta"><span>used ${it.uses || 0}×</span></div>
    </div>`;
}

function renderLibListInner() {
  const list = sortedItems(ui.libTab);
  if (!list.length) {
    return `<div class="empty"><span class="big">⌕</span>${ui.libSearch ? 'Nothing matches that search.' : 'Nothing here yet — click “New” to add one.'}</div>`;
  }
  return list.map((it) => libItemHtml(ui.libTab, it)).join('');
}

function renderLibraryPanel() {
  const isKit = ui.libTab === 'kit';
  return `
    <div class="panel" data-panel="library">
      <div class="panel-head">
        <div class="panel-title">Library <span class="sub">click to add</span></div>
        <div class="panel-actions">
          ${isKit
            ? '<button class="btn btn-sm" data-action="save-kit" title="Save the current stack as a reusable kit">+ Save stack</button>'
            : `<button class="btn btn-sm" data-action="new-item" data-kind="${ui.libTab}">+ New</button>`}
        </div>
      </div>
      <div class="lib-tabs">
        ${LIB_TABS.map((t) => `<button class="lib-tab ${ui.libTab === t.id ? 'active' : ''}" data-action="lib-tab" data-lib="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div class="lib-tools">
        <div class="search-wrap search">
          <span class="s-icon">⌕</span>
          <input class="input" data-lib-search aria-label="Search library" placeholder="Search…" value="${esc(ui.libSearch)}">
        </div>
        <select class="select" data-setting="sort" style="width:104px" title="Sort order">
          <option value="used" ${state.settings.sort === 'used' ? 'selected' : ''}>Most used</option>
          <option value="alpha" ${state.settings.sort === 'alpha' ? 'selected' : ''}>A–Z</option>
          <option value="recent" ${state.settings.sort === 'recent' ? 'selected' : ''}>Recent</option>
        </select>
      </div>
      <div class="lib-list" id="lib-list">${renderLibListInner()}</div>
    </div>`;
}

function renderStackPanel(vars) {
  const blocks = state.stack || [];
  const typeLabel = { template: 'Note', kb: 'KB', email: 'Email', text: 'Text' };
  const blocksHtml = blocks.map((b, i) => {
    let body = '';
    if (b.type === 'kb') {
      const chips = (b.ids || []).map((id) => {
        const k = findItem(state, 'kb', id);
        if (!k) return '';
        return `<span class="kb-chip"><b>${esc(k.number || 'KB?')}</b>${esc((k.title || '').slice(0, 40))}<button data-action="kb-remove" data-id="${esc(b.id)}" data-kbid="${esc(id)}" title="Remove">×</button></span>`;
      }).join('');
      body = `<div class="kb-chips">${chips || '<span class="muted small">No articles yet.</span>'}</div>
              <button class="btn btn-sm" style="margin-top:9px" data-action="palette" data-mode="kb">+ Add KB article</button>`;
    } else if (b.type === 'text') {
      body = `<textarea class="textarea" data-block-text="${esc(b.id)}" placeholder="Type a quick note…">${esc(b.content || '')}</textarea>`;
    } else {
      body = `<div class="block-snippet" data-snippet="${esc(b.id)}">${esc(blockSnippet(state, b, vars) || '(empty)')}</div>`;
    }
    return `
      <div class="block type-${b.type}">
        <div class="block-head">
          <span class="block-type">${typeLabel[b.type] || b.type}</span>
          <span class="block-title">${esc(blockTitle(state, b))}</span>
          <div class="block-controls">
            <button class="icon-btn" data-action="move-block" data-dir="up" data-id="${esc(b.id)}" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon-btn" data-action="move-block" data-dir="down" data-id="${esc(b.id)}" title="Move down" ${i === blocks.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="icon-btn" data-action="copy-block" data-id="${esc(b.id)}" title="Copy just this block">⧉</button>
            <button class="icon-btn danger" data-action="remove-block" data-id="${esc(b.id)}" title="Remove block">×</button>
          </div>
        </div>
        <div class="block-body">${body}</div>
      </div>`;
  }).join('');

  return `
    <div class="panel" data-panel="stack">
      <div class="panel-head">
        <div class="panel-title">Your stack <span class="sub">${blocks.length} block${blocks.length === 1 ? '' : 's'}</span></div>
        <div class="panel-actions">
          <button class="btn btn-sm" data-action="add-text">+ Quick text</button>
          <button class="btn btn-sm btn-ghost" data-action="clear-stack">Clear</button>
        </div>
      </div>
      <div class="panel-body">
        ${blocks.length
          ? `<div class="stack-list">${blocksHtml}</div>`
          : `<div class="stack-empty"><div style="font-size:26px;margin-bottom:8px">▤</div><b>Your stack is empty</b><div class="small" style="margin-top:6px">Pick a note template, KB article or email on the left.<br>Or press <span class="kbd">${MOD} K</span> to search everything.</div></div>`}
      </div>
    </div>`;
}

function previewStats(composed) {
  const text = composed.text;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  return `${text.length} chars · ${words} words · ${composed.parts.length} block${composed.parts.length === 1 ? '' : 's'}`;
}

function previewWarn(composed) {
  if (!composed.unfilled.length) return '';
  const names = composed.unfilled.map((k) => `{{${k}}}`).join(', ');
  return `<div class="preview-warn"><span>⚠</span><span><b>${composed.unfilled.length} field${composed.unfilled.length === 1 ? '' : 's'} not filled:</b> ${esc(names)}. Fill them in Ticket context above, or give the template a default like <code>{{ticket|N/A}}</code>.</span></div>`;
}

const SECTION_PLACEHOLDER = '<span class="muted">No text for this field yet — add a note template that fills it.</span>';

function snFieldRow(key, label, text) {
  const value = String(text || '');
  return `
    <div class="sn-field">
      <div class="sn-field-head">
        <span class="sn-label">${esc(label)}</span>
        <button class="btn btn-sm" data-action="copy-field" data-field="${key}" ${value.trim() ? '' : 'disabled'} title="Copy just this ServiceNow field">${COPY_SVG} Copy</button>
      </div>
      <div class="sn-field-preview" id="sn-${key}" title="${esc(value.slice(0, 400))}">${value.trim() ? highlight(value) : SECTION_PLACEHOLDER}</div>
    </div>`;
}

function renderPreviewPanel(composed) {
  const sections = composed.sections || {};
  return `
    <div class="panel" data-panel="preview">
      <div class="panel-head">
        <div class="panel-title">Ready to paste <span class="sub">live preview</span></div>
        <div class="panel-actions"><span class="chip">${MOD} ↵</span></div>
      </div>
      <div class="panel-body">
        ${snFieldRow('shortDescription', 'Short description', sections.shortDescription)}
        ${snFieldRow('description', 'Description', sections.description)}
        <div class="sn-field">
          <div class="sn-field-head"><span class="sn-label">Work notes</span><span class="muted small">main copy · ${MOD} ↵</span></div>
          <div class="preview-box" id="preview-box">${highlight(composed.text)}</div>
        </div>
        <div class="preview-stats" id="preview-stats">${composed.text ? previewStats(composed) : 'Nothing yet — add a block on the left.'}</div>
        <div id="preview-warn">${previewWarn(composed)}</div>
        <div class="copy-actions">
          <button class="btn btn-primary btn-lg" data-action="copy">${COPY_SVG} Copy work notes</button>
          <button class="btn btn-lg" data-action="copy-next" title="Copy and reset for the next ticket">Copy &amp; next →</button>
        </div>
        <div class="hint" style="margin-top:10px">Each field has its own <b>Copy</b> button above. Paste into the matching ServiceNow field: <b>Short description</b>, <b>Description</b>, <b>Work notes</b>. Nothing leaves this browser unless you enable cloud sync.</div>
      </div>
    </div>`;
}

function renderBuilder() {
  const composed = compose(state);
  const fields = detectFields(state);
  return `
    <div class="view-head">
      <div>
        <h1>Build a note</h1>
        <p>Stack reusable blocks, then copy the whole thing in one click.</p>
      </div>
      <div class="spacer"></div>
      <span class="chip"><span class="dot" style="background:var(--accent)"></span>${todayCount(state.history)} copied today</span>
    </div>
    ${renderContext(fields)}
    <div class="seg">
      ${[['library', '1 · Library'], ['stack', '2 · Stack'], ['preview', '3 · Preview']].map(([v, l]) =>
        `<button class="${ui.mobileView === v ? 'active' : ''}" data-action="set-mobile-view" data-view="${v}">${l}</button>`).join('')}
    </div>
    <div class="builder-grid" data-mobile="${ui.mobileView}">
      ${renderLibraryPanel()}
      ${renderStackPanel(composed.vars)}
      ${renderPreviewPanel(composed)}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Library management view                                            */
/* ------------------------------------------------------------------ */

function cardHtml(kind, it) {
  return `
    <div class="card">
      <div class="card-top">
        <div style="min-width:0">
          <div class="card-title">${esc(itemLabel(kind, it))}</div>
          <div class="card-sub">${esc(itemTag(kind, it))} · used ${it.uses || 0}×${it.favorite ? ' · ★ favorite' : ''}</div>
        </div>
        <div style="flex:1"></div>
        <button class="icon-btn ${it.favorite ? 'on' : ''}" data-action="fav" data-kind="${kind}" data-id="${esc(it.id)}" title="Pin as favorite">${it.favorite ? '★' : '☆'}</button>
      </div>
      <div class="card-body">${esc(bodyPreview(kind, it) || '(empty)')}</div>
      <div class="card-foot">
        <button class="btn btn-sm" data-action="add" data-kind="${kind}" data-id="${esc(it.id)}">+ Add</button>
        <button class="btn btn-sm" data-action="copy-item" data-kind="${kind}" data-id="${esc(it.id)}">⧉ Copy</button>
        <div class="spacer"></div>
        <button class="btn btn-sm" data-action="edit" data-kind="${kind}" data-id="${esc(it.id)}">✎ Edit</button>
        <button class="icon-btn" data-action="duplicate" data-kind="${kind}" data-id="${esc(it.id)}" title="Duplicate">⧉</button>
        <button class="icon-btn danger" data-action="delete" data-kind="${kind}" data-id="${esc(it.id)}" title="Delete">×</button>
      </div>
    </div>`;
}

function renderFullLibInner() {
  const sections = [
    { kind: 'template', title: 'Note templates', desc: 'Reusable work notes / close notes' },
    { kind: 'kb', title: 'Knowledge Base articles', desc: 'KB numbers you reference often' },
    { kind: 'email', title: 'Email templates', desc: 'Replies you send all day' }
  ];
  return sections.map((s) => {
    const items = sortedItems(s.kind);
    return `
      <div class="section">
        <div class="section-head">
          <h2>${s.title} <span class="muted small">(${items.length})</span></h2>
          <span class="hint">${s.desc}</span>
          <div class="spacer"></div>
          <button class="btn btn-sm btn-primary" data-action="new-item" data-kind="${s.kind}">+ New</button>
        </div>
        ${items.length
          ? `<div class="card-grid">${items.map((it) => cardHtml(s.kind, it)).join('')}</div>`
          : '<div class="empty">No items match your search.</div>'}
      </div>`;
  }).join('');
}

function renderLibrary() {
  return `
    <div class="view-head">
      <div><h1>Library</h1><p>Everything you copy, in one place. Edit or add your own.</p></div>
      <div class="spacer"></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <div class="search-wrap">
          <span class="s-icon">⌕</span>
          <input class="input" data-lib-search placeholder="Search all libraries…" value="${esc(ui.libSearch)}" style="width:230px">
        </div>
        <select class="select" data-setting="sort" style="width:130px" title="Sort order">
          <option value="used" ${state.settings.sort === 'used' ? 'selected' : ''}>Most used</option>
          <option value="alpha" ${state.settings.sort === 'alpha' ? 'selected' : ''}>A–Z</option>
          <option value="recent" ${state.settings.sort === 'recent' ? 'selected' : ''}>Recent</option>
        </select>
      </div>
    </div>
    <div class="stat-strip">
      <div class="stat"><b>${state.templates.length}</b><span>Note templates</span></div>
      <div class="stat"><b>${state.kb.length}</b><span>KB articles</span></div>
      <div class="stat"><b>${state.emails.length}</b><span>Email templates</span></div>
      <div class="stat"><b>${todayCount(state.history)}</b><span>Notes copied today</span></div>
    </div>
    <div id="full-lib-lists">${renderFullLibInner()}</div>`;
}

/* ------------------------------------------------------------------ */
/* Kits + History + Settings                                           */
/* ------------------------------------------------------------------ */

function renderKits() {
  const kits = state.kits || [];
  return `
    <div class="view-head">
      <div>
        <h1>Quick Kits</h1>
        <p>Save a whole stack as a one-click workflow. Perfect for ticket types you handle every day.</p>
      </div>
      <div class="spacer"></div>
      <button class="btn btn-primary" data-action="save-kit">+ Save current stack as Kit</button>
    </div>
    <div class="hint" style="margin-bottom:14px">A Kit remembers the note templates, KB articles and emails in your stack. Load it from the Builder's <b>Kits</b> tab or with <span class="kbd">${MOD} K</span> — no re-stacking needed.</div>
    ${kits.length ? `<div class="card-grid">${kits.map((k) => `
      <div class="card">
        <div class="card-top">
          <div style="min-width:0"><div class="card-title">⚡ ${esc(k.name)}</div><div class="card-sub">${(k.blocks || []).length} blocks · used ${k.uses || 0}×</div></div>
        </div>
        <div class="card-body">${esc((k.blocks || []).map((b) => blockTitle(state, b)).join('\n') || '(empty)')}</div>
        <div class="card-foot">
          <button class="btn btn-sm btn-primary" data-action="load-kit" data-id="${esc(k.id)}">Load kit →</button>
          <div class="spacer"></div>
          <button class="btn btn-sm" data-action="rename-kit" data-id="${esc(k.id)}">✎ Rename</button>
          <button class="icon-btn danger" data-action="delete-kit" data-id="${esc(k.id)}" title="Delete kit">×</button>
        </div>
      </div>`).join('')}</div>` : '<div class="empty"><span class="big">⚡</span>No kits yet. Build a stack in the Builder, then save it here.</div>'}`;
}

function renderHistoryListInner() {
  const q = ui.historySearch.trim().toLowerCase();
  const list = (state.history || []).filter((h) =>
    !q || `${h.ticket || ''} ${h.text || ''}`.toLowerCase().includes(q));
  if (!list.length) return '<div class="empty"><span class="big">◷</span>Nothing copied yet. Your copy history appears here for quick re-copying.</div>';
  return list.map((h) => `
    <div class="history-item">
      <div class="history-time">${esc(fmtStamp(h.at))}${h.ticket ? `<br><span class="tag">${esc(h.ticket)}</span>` : ''}</div>
      <div class="history-text">${esc(firstLine(h.text, 300))}</div>
      <div class="history-actions">
        <button class="btn btn-sm" data-action="history-copy" data-id="${esc(h.id)}">⧉ Copy again</button>
        <button class="btn btn-sm" data-action="history-load" data-id="${esc(h.id)}" title="Put these blocks back in the stack">↩ Load</button>
        <button class="icon-btn danger" data-action="history-delete" data-id="${esc(h.id)}" title="Delete entry">×</button>
      </div>
    </div>`).join('');
}

function renderHistory() {
  return `
    <div class="view-head">
      <div><h1>Copy history</h1><p>Re-copy something you sent earlier, or load its blocks back into the stack.</p></div>
      <div class="spacer"></div>
      <input class="input" data-history-search placeholder="Search history…" value="${esc(ui.historySearch)}" style="width:220px">
      <button class="btn btn-sm btn-danger" data-action="history-clear">Clear all</button>
    </div>
    <div class="stat-strip">
      <div class="stat"><b>${todayCount(state.history)}</b><span>Copied today</span></div>
      <div class="stat"><b>${state.history.length}</b><span>Total entries</span></div>
      <div class="stat"><b>${state.settings.historyLimit || 100}</b><span>Entries kept</span></div>
    </div>
    <div class="panel"><div class="panel-body flush" id="history-list">${renderHistoryListInner()}</div></div>`;
}

function settingPanel(title, inner) {
  return `<div class="panel"><div class="panel-head"><div class="panel-title">${title}</div></div><div class="panel-body">${inner}</div></div>`;
}

function renderSettings() {
  const s = state.settings;
  const sup = s.supabase || {};
  const sep = s.separator ?? '\n\n';
  const preset = sep === '\n\n' ? 'blank' : sep === '\n' ? 'single' : sep === '\n\n---\n\n' ? 'divider' : 'custom';
  const varChips = BUILTIN_VARS.map((v) =>
    `<span class="var-chip" title="${esc(BUILTIN_VAR_HELP[v] || '')}">{{${v}}}</span>`).join('');

  return `
    <div class="view-head">
      <div><h1>Settings</h1><p>Tune the workflow, back up your data, or sync across devices.</p></div>
    </div>
    <div class="settings-grid">
      ${settingPanel('Appearance', `
        <div class="field">
          <label for="set-theme">Theme</label>
          <select class="select" id="set-theme" data-setting="theme">
            <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option>
            <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option>
            <option value="system" ${s.theme === 'system' ? 'selected' : ''}>Match system</option>
          </select>
        </div>
        <p class="hint" style="margin-top:12px">StackNote is an installable PWA. On Chrome/Edge use the <b>Install app</b> button in the header (or browser menu → Install). It works offline over HTTPS.</p>`)}

      ${settingPanel('Note composition', `
        <div class="field">
          <label for="set-sep">Between blocks</label>
          <select class="select" id="set-sep" data-action="sep-select">
            <option value="blank" ${preset === 'blank' ? 'selected' : ''}>Blank line</option>
            <option value="single" ${preset === 'single' ? 'selected' : ''}>Single line break</option>
            <option value="divider" ${preset === 'divider' ? 'selected' : ''}>Divider line (---)</option>
            <option value="custom" ${preset === 'custom' ? 'selected' : ''}>Custom…</option>
          </select>
        </div>
        <div class="field" style="margin-top:10px">
          <label>Custom separator <span class="muted">(use \\n for a new line)</span></label>
          <input class="input" data-setting="separator" data-sep-literal value="${esc(showSep(sep))}" placeholder="\\n\\n">
        </div>
        <hr class="divider">
        <div class="field">
          <label>Header template <span class="muted">(optional, prepended to every note)</span></label>
          <textarea class="textarea" data-setting="header" placeholder="e.g. Work notes — {{ticket}} ({{date}})">${esc(s.header || '')}</textarea>
        </div>
        <div class="field" style="margin-top:10px">
          <label>Footer template <span class="muted">(optional)</span></label>
          <textarea class="textarea" data-setting="footer" placeholder="e.g. Handled by {{agent}}">${esc(s.footer || '')}</textarea>
        </div>
        <hr class="divider">
        <div class="form-row">
          <div class="field">
            <label>KB heading</label>
            <input class="input" data-setting="kbHeading" value="${esc(s.kbHeading || '')}" placeholder="KB Articles:">
          </div>
          <div class="field">
            <label>KB line format</label>
            <input class="input" data-setting="kbFormat" value="${esc(s.kbFormat || '')}" placeholder="• {{number}} — {{title}}">
          </div>
        </div>
        <p class="hint" style="margin-top:8px">KB lines accept <code>{{number}}</code>, <code>{{title}}</code>, <code>{{url}}</code>, <code>{{notes}}</code>. Anywhere else use:</p>
        <div class="var-chips">${varChips}</div>
        <hr class="divider">
        <p class="hint">Each <b>note template</b> has three ServiceNow fields — <b>Short description</b>, <b>Description</b> and <b>Work notes</b> — each with its own Copy button in the preview. Header / footer above apply to Work notes only. A <b>KB#</b> typed into Ticket context is merged into <code>{{kb}}</code> and appended to Work notes if no template already includes it.</p>`)}

      ${settingPanel('Workflow', `
        <label class="checkbox"><input type="checkbox" data-setting="autoClear" ${s.autoClear ? 'checked' : ''}> Clear the stack after a normal copy</label>
        <p class="hint" style="margin:2px 0 12px">Leave this off if you like to keep the stack visible. <b>Copy &amp; next</b> always clears it.</p>
        <label class="checkbox"><input type="checkbox" data-setting="resetFieldsOnNext" ${s.resetFieldsOnNext !== false ? 'checked' : ''}> “Copy &amp; next” clears ticket context + custom fields</label>
        <hr class="divider">
        <div class="form-row">
          <div class="field">
            <label>Agent / signature name</label>
            <input class="input" data-setting="agent" value="${esc(s.agent || '')}" placeholder="{{agent}}">
          </div>
          <div class="field">
            <label>History entries to keep</label>
            <input class="input" type="number" min="10" max="1000" data-setting="historyLimit" value="${esc(s.historyLimit || 100)}">
          </div>
        </div>
        <div class="field" style="margin-top:10px">
          <label>Default library sort</label>
          <select class="select" data-setting="sort">
            <option value="used" ${s.sort === 'used' ? 'selected' : ''}>Most used (favorites first)</option>
            <option value="alpha" ${s.sort === 'alpha' ? 'selected' : ''}>A–Z</option>
            <option value="recent" ${s.sort === 'recent' ? 'selected' : ''}>Recently edited</option>
          </select>
        </div>
        <hr class="divider">
        <div class="field">
          <label>${MOD} K — when I select a template / KB / email / kit</label>
          <select class="select" data-setting="paletteMode">
            <option value="copy" ${s.paletteMode === 'copy' ? 'selected' : ''}>Copy it to clipboard (recommended)</option>
            <option value="stack" ${s.paletteMode === 'stack' ? 'selected' : ''}>Add it to the stack</option>
            <option value="both" ${s.paletteMode === 'both' ? 'selected' : ''}>Copy AND add to stack</option>
          </select>
          <p class="hint" style="margin-top:6px">Variables like <code>{{ticket}}</code> are filled from Ticket context before copying. Hold <b>Shift</b> while clicking / pressing Enter to do the opposite action. Clicking items in the Library panel always adds to the stack.</p>
        </div>`)}

      ${settingPanel('Your data', `
        <p class="hint">Everything is stored in this browser's local storage. Export a backup before clearing browser data or switching devices.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn btn-primary" data-action="export">↓ Export backup (JSON)</button>
          <button class="btn" data-action="import">↑ Import backup</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
        </div>
        <hr class="divider">
        <div class="panel danger-zone" style="box-shadow:none">
          <div class="panel-body" style="padding:12px">
            <b class="small">Reset to starter content</b>
            <p class="hint" style="margin:4px 0 10px">Deletes your templates, KB articles, emails, kits and history, and restores the examples.</p>
            <button class="btn btn-sm btn-danger" data-action="reset-data">Reset all data</button>
          </div>
        </div>`)}

      ${settingPanel('Cloud sync (optional, Supabase)', `
        <p class="hint">Sync your libraries between devices. Create a free Supabase project, run the SQL below once, then paste the values here. Stack, copy history and credentials stay on this device.</p>
        <div class="field" style="margin-top:10px"><label>Project URL</label>
          <input class="input" data-setting="supabase.url" value="${esc(sup.url || '')}" placeholder="https://xxxxx.supabase.co" autocomplete="off"></div>
        <div class="field" style="margin-top:10px"><label>Anon / public key</label>
          <input class="input" data-setting="supabase.key" value="${esc(sup.key || '')}" placeholder="eyJhbGciOi…" autocomplete="off"></div>
        <div class="field" style="margin-top:10px"><label>Workspace code</label>
          <input class="input" data-setting="supabase.workspace" value="${esc(sup.workspace || '')}" placeholder="a long random code, e.g. desk-9f3a-…" autocomplete="off"></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-sm" data-action="sync-test">Test</button>
          <button class="btn btn-sm btn-primary" data-action="sync-push">↑ Push</button>
          <button class="btn btn-sm" data-action="sync-pull">↓ Pull</button>
          <button class="btn btn-sm" data-action="show-sql">Show SQL</button>
          <button class="btn btn-sm btn-ghost" data-action="copy-sql">⧉ Copy SQL</button>
        </div>
        <p class="hint" style="margin-top:10px">Last sync: <span id="last-sync">${esc(s.lastSync ? fmtStamp(s.lastSync) : 'never')}</span></p>
        <div class="preview-warn" style="margin-top:8px"><span>⚠</span><span>Supabase anon keys are public. Use a long random workspace code and don't store confidential data. See the README for a hardened, auth-based setup.</span></div>`)}

      ${settingPanel('Keyboard shortcuts', `
        <div class="shortcut-row"><span>Quick find — <b>select copies that item</b></span><span class="spacer"></span><span class="kbd">${MOD} K</span></div>
        <div class="shortcut-row"><span>…with Shift — add it to the stack instead</span><span class="spacer"></span><span class="kbd">${MOD} K ⇧ ↵</span></div>
        <div class="shortcut-row"><span>Copy the whole note</span><span class="spacer"></span><span class="kbd">${MOD} ↵</span></div>
        <div class="shortcut-row"><span>Copy &amp; start next ticket</span><span class="spacer"></span><span class="kbd">${MOD} ⇧ ↵</span></div>
        <div class="shortcut-row"><span>Focus library search</span><span class="spacer"></span><span class="kbd">/</span></div>
        <div class="shortcut-row"><span>Close dialog / palette</span><span class="spacer"></span><span class="kbd">Esc</span></div>
        <div class="shortcut-row"><span>This help</span><span class="spacer"></span><span class="kbd">?</span></div>
        <hr class="divider">
        <p class="hint">Tip: type <code>{{ticket}}</code> in any template and it fills from Ticket context before copying. Unknown placeholders like <code>{{hostname}}</code> automatically appear as fields above the builder. Palette behaviour is configurable in the Workflow panel.</p>
        <button class="btn btn-sm" data-action="shortcuts" style="margin-top:10px">Open shortcuts guide</button>`)}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Render orchestration                                                */
/* ------------------------------------------------------------------ */

function renderMobileCopybar() {
  const bar = $('#mobile-copybar');
  if (!bar) return;
  const composed = compose(state);
  bar.innerHTML = `
    <span class="m-count">${state.stack.length} blocks · ${composed.text.length} chars</span>
    <button class="btn btn-primary" data-action="copy">${COPY_SVG} Copy work notes</button>
    <button class="btn" data-action="set-mobile-view" data-view="preview">Preview</button>`;
}

function updateLive() {
  const composed = compose(state);
  const box = $('#preview-box');
  if (box) box.innerHTML = highlight(composed.text);
  const stats = $('#preview-stats');
  if (stats) stats.textContent = composed.text ? previewStats(composed) : 'Nothing yet — add a block on the left.';
  const warn = $('#preview-warn');
  if (warn) warn.innerHTML = previewWarn(composed);
  for (const key of ['shortDescription', 'description']) {
    const value = composed.sections?.[key] || '';
    const el = document.getElementById('sn-' + key);
    if (el) {
      el.innerHTML = value.trim() ? highlight(value) : SECTION_PLACEHOLDER;
      el.title = value.slice(0, 400);
    }
    const btn = document.querySelector(`[data-action="copy-field"][data-field="${key}"]`);
    if (btn) btn.disabled = !value.trim();
  }
  document.querySelectorAll('[data-snippet]').forEach((el) => {
    const b = (state.stack || []).find((x) => x.id === el.dataset.snippet);
    if (b) el.textContent = blockSnippet(state, b, composed.vars) || '(empty)';
  });
  const count = $('#mobile-copybar .m-count');
  if (count) count.textContent = `${state.stack.length} blocks · ${composed.text.length} chars`;
}

function renderView() {
  const ae = document.activeElement;
  let restore = null;
  if (ae && ae.dataset) {
    if (ae.dataset.context) restore = `[data-context="${ae.dataset.context}"]`;
    else if (ae.dataset.field) restore = `[data-field="${ae.dataset.field}"]`;
    else if (ae.dataset.blockText) restore = `[data-block-text="${ae.dataset.blockText}"]`;
    else if (ae.dataset.libSearch !== undefined) restore = '[data-lib-search]';
    else if (ae.dataset.historySearch !== undefined) restore = '[data-history-search]';
  }
  const renderers = {
    builder: renderBuilder,
    library: renderLibrary,
    kits: renderKits,
    history: renderHistory,
    settings: renderSettings
  };
  view.innerHTML = (renderers[ui.tab] || renderBuilder)();

  if (ui.focusBlockId) {
    const ta = view.querySelector(`[data-block-text="${ui.focusBlockId}"]`);
    if (ta) ta.focus();
    ui.focusBlockId = null;
  } else if (restore) {
    const el = view.querySelector(restore);
    if (el) {
      el.focus();
      if (el.setSelectionRange && el.type === 'text') {
        try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) { /* noop */ }
      }
    }
  }
  renderTabs();
  renderHeader();
  renderMobileCopybar();
  updateLive();
}

function renderLibLists() {
  const a = $('#lib-list');
  if (a) a.innerHTML = renderLibListInner();
  const b = $('#full-lib-lists');
  if (b) b.innerHTML = renderFullLibInner();
}

function renderHistoryList() {
  const el = $('#history-list');
  if (el) el.innerHTML = renderHistoryListInner();
}

/* ------------------------------------------------------------------ */
/* Modals                                                              */
/* ------------------------------------------------------------------ */

function openModal({ title, body, foot, wide = false }) {
  ui.modal = true;
  $('#modal-root').innerHTML = `
    <div class="modal-backdrop" data-action="modal-backdrop">
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head"><h2>${esc(title)}</h2><div style="flex:1"></div>
          <button class="icon-btn" data-action="close-modal" aria-label="Close">×</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">${foot}</div>
      </div>
    </div>`;
  const first = $('#modal-root [autofocus]');
  if (first) first.focus();
}

function closeModal() {
  $('#modal-root').innerHTML = '';
  ui.modal = false;
  ui.confirmCb = null;
  ui.promptCb = null;
  ui.modalMeta = {};
}

function confirmDialog(title, message, onYes, yesLabel = 'Confirm') {
  ui.confirmCb = onYes;
  openModal({
    title,
    body: `<p style="font-size:13px;line-height:1.6">${message}</p>`,
    foot: `<div style="flex:1"></div>
      <button class="btn" data-action="close-modal">Cancel</button>
      <button class="btn btn-danger" data-action="modal-confirm">${esc(yesLabel)}</button>`
  });
}

function promptDialog(title, label, value, onOk, okLabel = 'Save') {
  ui.promptCb = onOk;
  openModal({
    title,
    body: `<div class="field"><label for="prompt-input">${esc(label)}</label>
      <input class="input" id="prompt-input" data-prompt-input value="${esc(value || '')}" autofocus></div>`,
    foot: `<div style="flex:1"></div>
      <button class="btn" data-action="close-modal">Cancel</button>
      <button class="btn btn-primary" data-action="modal-ok">${esc(okLabel)}</button>`
  });
  const inp = $('#prompt-input');
  if (inp) { inp.focus(); inp.select(); }
}

function editorFields(kind, it) {
  const v = (key, def = '') => esc(it?.[key] ?? def);
  if (kind === 'template') return `
    <div class="form-row">
      <div class="field"><label for="ed-name">Name</label><input class="input" id="ed-name" value="${v('name')}" placeholder="e.g. Password reset" autofocus></div>
      <div class="field"><label for="ed-category">Category</label><input class="input" id="ed-category" value="${v('category', 'General')}" placeholder="Access / Hardware / …"></div>
    </div>
    <div class="field"><label for="ed-short">Short description <span class="muted">(ServiceNow field — one line)</span></label>
      <textarea class="textarea" id="ed-short" placeholder="e.g. Password reset for {{caller}}">${v('shortDescription')}</textarea></div>
    <div class="field"><label for="ed-desc">Description <span class="muted">(ServiceNow field — what the user reported)</span></label>
      <textarea class="textarea" id="ed-desc" placeholder="e.g. {{caller}} reported being unable to sign in…">${v('description')}</textarea></div>
    <div class="field"><label for="ed-body">Work notes <span class="muted">(the main note you paste into the ticket)</span></label>
      <textarea class="textarea tall" id="ed-body" placeholder="Write the work notes…">${v('body')}</textarea></div>
    ${varButtons('ed-body')}
    <p class="hint" style="margin-top:-4px">Click into any of the three fields above first, then click a variable to insert it at the cursor. All three are optional — leave a field blank if that ticket type doesn't need it.</p>`;
  if (kind === 'kb') return `
    <div class="form-row">
      <div class="field"><label for="ed-number">KB number</label><input class="input" id="ed-number" value="${v('number')}" placeholder="KB0012345" autofocus></div>
      <div class="field"><label for="ed-name">Title</label><input class="input" id="ed-name" value="${v('name')}" placeholder="What the article covers"></div>
    </div>
    <div class="field"><label for="ed-url">URL <span class="muted">(optional)</span></label><input class="input" id="ed-url" value="${v('url')}" placeholder="https://…service-now.com/kb?id=…"></div>
    <div class="field"><label for="ed-notes">Notes <span class="muted">(optional)</span></label><textarea class="textarea" id="ed-notes" placeholder="When to use it…">${v('notes')}</textarea></div>`;
  return `
    <div class="field"><label for="ed-name">Name</label><input class="input" id="ed-name" value="${v('name')}" placeholder="e.g. Request more info" autofocus></div>
    <div class="field"><label for="ed-subject">Subject</label><input class="input" id="ed-subject" value="${v('subject')}" placeholder="Subject line"></div>
    <div class="field"><label for="ed-body">Email body</label>
      <textarea class="textarea tall" id="ed-body" placeholder="Hi {{caller}},…">${v('body')}</textarea>
      ${varButtons('ed-body')}</div>`;
}

function varButtons(targetId) {
  const chips = BUILTIN_VARS.map((v) =>
    `<button type="button" class="var-chip" data-action="insert-var" data-var="{{${v}}}" data-target="${targetId}" title="${esc(BUILTIN_VAR_HELP[v] || '')}">+ {{${v}}}</button>`).join('');
  return `<div class="var-chips"><span class="hint" style="align-self:center">Insert:</span>${chips}</div>`;
}

function openEditor(kind, id) {
  const it = id ? findItem(state, kind, id) : null;
  const titles = { template: 'Note template', kb: 'Knowledge Base article', email: 'Email template' };
  const fav = it?.favorite ? 'checked' : '';
  openModal({
    title: `${it ? 'Edit' : 'New'} ${titles[kind] || 'item'}`,
    wide: true,
    body: `${editorFields(kind, it)}
      <label class="checkbox"><input type="checkbox" id="ed-fav" ${fav}> ★ Favorite (pins to the top of the library)</label>
      <p class="hint">Placeholders like <code>{{ticket}}</code> fill automatically. Add a default with <code>{{ticket|N/A}}</code>. Any custom placeholder becomes a field in the Builder.</p>`,
    foot: `${it ? `<button class="btn btn-danger" data-action="modal-delete" data-kind="${kind}" data-id="${esc(id)}">Delete</button>` : ''}
      <div style="flex:1"></div>
      <button class="btn" data-action="close-modal">Cancel</button>
      <button class="btn btn-primary" data-action="modal-save" data-kind="${kind}" data-id="${esc(id || '')}">Save</button>`
  });
  ui.modalMeta = { kind, id };
}

function saveEditor(kind, id) {
  const val = (sel) => $(sel)?.value ?? '';
  const fav = $('#ed-fav')?.checked || false;
  const list = state[ARR[kind]];
  const now = new Date().toISOString();
  let item = id ? findItem(state, kind, id) : null;

  if (kind === 'template') {
    const name = val('#ed-name').trim() || 'Untitled template';
    if (!item) { item = { id: uid('tpl'), uses: 0, updatedAt: now }; list.unshift(item); }
    Object.assign(item, {
      name,
      category: val('#ed-category').trim() || 'General',
      shortDescription: val('#ed-short'),
      description: val('#ed-desc'),
      body: val('#ed-body'),
      favorite: fav,
      updatedAt: now
    });
  } else if (kind === 'kb') {
    const number = val('#ed-number').trim() || 'KB?';
    const name = val('#ed-name').trim() || 'Untitled article';
    if (!item) { item = { id: uid('kb'), uses: 0, updatedAt: now }; list.unshift(item); }
    Object.assign(item, { number, name, title: name, url: val('#ed-url').trim(), notes: val('#ed-notes').trim(), favorite: fav, updatedAt: now });
  } else {
    const name = val('#ed-name').trim() || 'Untitled email';
    if (!item) { item = { id: uid('eml'), uses: 0, updatedAt: now }; list.unshift(item); }
    Object.assign(item, { name, subject: val('#ed-subject'), body: val('#ed-body'), favorite: fav, updatedAt: now });
  }
  save();
  closeModal();
  renderView();
  toast(`${item.name || item.number} saved ✓`, 'ok');
}

function showShortcuts() {
  openModal({
    title: 'Work faster with StackNote',
    body: `
      <p class="hint">A few habits that make ticket notes almost instant:</p>
      <div class="shortcut-row"><span><b>${MOD} K</b> — command palette</span><span class="spacer"></span><span class="kbd">${MOD} K</span></div>
      <p class="hint" style="margin:0 0 12px">Type a few letters of any template, KB number, email, kit or action and hit Enter — the item's content is <b>copied to your clipboard immediately</b>, with variables already filled. Hold <b>Shift</b> while selecting to add it to the stack instead. Change this in Settings → Workflow.</p>
      <div class="shortcut-row"><span><b>Quick Kits</b> — one click for a whole ticket type</span></div>
      <p class="hint" style="margin:0 0 12px">Save a stack (e.g. Password reset + KB + confirmation email) as a Kit, then load it instantly.</p>
      <div class="shortcut-row"><span><b>ServiceNow fields</b> — one template, three copy buttons</span></div>
      <p class="hint" style="margin:0 0 12px">Every note template can fill <b>Short description</b>, <b>Description</b> and <b>Work notes</b>. The preview has a Copy button for each, plus <code>{{kbnum}}</code> / <code>{{kb}}</code> for a KB# typed into Ticket context.</p>
      <div class="shortcut-row"><span><b>Smart variables</b></span></div>
      <p class="hint" style="margin:0 0 12px">Use <code>{{ticket}}</code>, <code>{{caller}}</code>, <code>{{kb}}</code> — and any custom placeholder you invent. Unknown ones become input fields automatically. Add <code>|default</code> as a fallback.</p>
      <div class="shortcut-row"><span><b>Copy &amp; next</b></span><span class="spacer"></span><span class="kbd">${MOD} ⇧ ↵</span></div>
      <p class="hint" style="margin:0 0 12px">Copies everything, logs it to History and resets the ticket context so you're ready for the next one.</p>
      <div class="shortcut-row"><span><b>Copy history</b></span></div>
      <p class="hint" style="margin:0">Re-copy or reload anything you copied earlier today — great when a ticket bounces back.</p>`,
    foot: '<div style="flex:1"></div><button class="btn btn-primary" data-action="close-modal">Got it</button>'
  });
}

function showSQL() {
  openModal({
    title: 'Supabase setup SQL',
    wide: true,
    body: `<p class="hint">Run this once in your Supabase project's <b>SQL Editor</b>, then fill in the Project URL + anon key above.</p>
      <pre class="code">${esc(SUPABASE_SQL)}</pre>`,
    foot: `<div style="flex:1"></div><button class="btn" data-action="copy-sql">⧉ Copy SQL</button><button class="btn btn-primary" data-action="close-modal">Done</button>`
  });
}

/* ------------------------------------------------------------------ */
/* Command palette                                                     */
/* ------------------------------------------------------------------ */

function paletteItems() {
  const p = ui.palette;
  const items = [];
  const add = (group, icon, name, sub, payload, extra = '') => items.push({ group, icon, name, sub, payload, extra });

  if (p.mode === 'all' || p.mode === 'template') {
    for (const t of sortedItems('template', '')) add('Note templates', '▤', t.name, `${t.category || 'General'} · used ${t.uses || 0}×`, { type: 'add', kind: 'template', id: t.id }, t.favorite ? '★' : '');
  }
  if (p.mode === 'all' || p.mode === 'kb') {
    for (const k of sortedItems('kb', '')) add('KB articles', 'KB', `${k.number || 'KB?'} — ${k.title || ''}`, k.notes || k.url || '', { type: 'add', kind: 'kb', id: k.id }, k.favorite ? '★' : '');
  }
  if (p.mode === 'all' || p.mode === 'email') {
    for (const e of sortedItems('email', '')) add('Email templates', '✉', e.name, e.subject || '', { type: 'add', kind: 'email', id: e.id }, e.favorite ? '★' : '');
  }
  if (p.mode === 'all') {
    for (const k of state.kits) add('Quick Kits', '⚡', k.name, `${(k.blocks || []).length} blocks`, { type: 'load-kit', id: k.id });
    add('Actions', '⧉', 'Copy work notes', `${MOD} ↵`, { type: 'action', action: 'copy' });
    add('Actions', '→', 'Copy & start next ticket', `${MOD} ⇧ ↵`, { type: 'action', action: 'copy-next' });
    add('Actions', '+', 'Add quick text', 'Free-form block', { type: 'action', action: 'add-text' });
    add('Actions', '⚡', 'Save current stack as Kit', 'One-click workflow', { type: 'action', action: 'save-kit' });
    add('Actions', '⌫', 'Clear the stack', '', { type: 'action', action: 'clear-stack' });
    add('Actions', '↺', 'New ticket (clear context)', '', { type: 'action', action: 'new-ticket' });
    add('Create', '▤', 'New note template', '', { type: 'action', action: 'new-item', kind: 'template' });
    add('Create', 'KB', 'New KB article', '', { type: 'action', action: 'new-item', kind: 'kb' });
    add('Create', '✉', 'New email template', '', { type: 'action', action: 'new-item', kind: 'email' });
    add('Go to', '▤', 'Library', '', { type: 'action', action: 'tab', tab: 'library' });
    add('Go to', '⚡', 'Quick Kits', '', { type: 'action', action: 'tab', tab: 'kits' });
    add('Go to', '◷', 'Copy history', '', { type: 'action', action: 'tab', tab: 'history' });
    add('Go to', '⚙', 'Settings', '', { type: 'action', action: 'tab', tab: 'settings' });
    add('Actions', '☀', 'Toggle light / dark theme', '', { type: 'action', action: 'theme-toggle' });
    add('Actions', '↓', 'Export backup (JSON)', '', { type: 'action', action: 'export' });
    add('Actions', '↑', 'Sync: Push to Supabase', '', { type: 'action', action: 'sync-push' });
    add('Actions', '↓', 'Sync: Pull from Supabase', '', { type: 'action', action: 'sync-pull' });
  }

  const q = p.query.trim().toLowerCase();
  if (!q) return items;
  const tokens = q.split(/\s+/);
  return items
    .map((it) => {
      const hay = `${it.name} ${it.sub}`.toLowerCase();
      if (!tokens.every((t) => hay.includes(t))) return null;
      let score = 0;
      if (it.name.toLowerCase().startsWith(q)) score += 3;
      if (it.name.toLowerCase().includes(q)) score += 2;
      if (it.extra === '★') score += 1;
      if (it.group === 'Actions' || it.group === 'Go to') score -= 1;
      return { ...it, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function paletteModeHint() {
  const mode = state.settings.paletteMode || 'copy';
  return mode === 'copy' ? 'copy' : mode === 'stack' ? '+ stack' : 'copy + stack';
}

function renderPaletteResults() {
  const el = $('#palette-results');
  if (!el) return;
  const items = paletteItems();
  ui.palette.items = items;
  if (ui.palette.selected >= items.length) ui.palette.selected = 0;
  if (!items.length) {
    el.innerHTML = '<div class="empty">No matches. Try a template name, KB number or action.</div>';
    return;
  }
  const hint = paletteModeHint();
  let lastGroup = '';
  el.innerHTML = items.map((it, i) => {
    let head = '';
    if (it.group !== lastGroup) { head = `<div class="palette-group">${esc(it.group)}</div>`; lastGroup = it.group; }
    const isItem = it.payload.type === 'add' || it.payload.type === 'load-kit';
    return `${head}<div class="palette-item ${i === ui.palette.selected ? 'sel' : ''}" data-action="palette-item" data-index="${i}">
      <span class="pi-icon">${esc(it.icon)}</span>
      <span class="pi-main"><span class="pi-name">${esc(it.name)} ${it.extra ? `<span style="color:var(--warn)">${esc(it.extra)}</span>` : ''}</span>
        <span class="pi-sub">${esc(it.sub || '')}</span></span>
      <span class="pi-hint">${i === ui.palette.selected ? '↵ ' : ''}${isItem ? esc(hint) : 'run'}</span>
    </div>`;
  }).join('');
}

function renderPalette() {
  const mode = state.settings.paletteMode || 'copy';
  const primary = mode === 'copy' ? 'copy' : mode === 'stack' ? 'add to stack' : 'copy + add';
  const secondary = mode === 'stack' ? 'copy' : 'add to stack';
  $('#palette-root').innerHTML = `
    <div class="palette-backdrop" data-action="palette-backdrop">
      <div class="palette" role="dialog" aria-modal="true" aria-label="Quick find">
        <div class="palette-input-wrap">
          <span style="color:var(--muted)">⌕</span>
          <input class="input" data-palette-input placeholder="${ui.palette.mode === 'all' ? 'Search templates, KB, emails, kits, actions…' : 'Search KB articles…'}" autocomplete="off">
        </div>
        <div class="palette-results" id="palette-results"></div>
        <div class="palette-foot"><span>↑↓ navigate</span><span>↵ ${primary}</span><span>⇧ + select → ${secondary}</span><span>Esc close</span><span style="margin-left:auto">${MOD} K</span></div>
      </div>
    </div>`;
  renderPaletteResults();
  $('#palette-root [data-palette-input]')?.focus();
}

function openPalette(mode = 'all') {
  if (ui.modal) closeModal();
  ui.palette = { query: '', mode, selected: 0, items: [] };
  renderPalette();
}

function closePalette() {
  $('#palette-root').innerHTML = '';
  ui.palette = null;
}

async function runPaletteItem(item, shift = false) {
  const p = item.payload;
  closePalette();

  if (p.type === 'action') {
    await handleAction(p.action, p, null, {});
    renderView();
    return;
  }

  let mode = state.settings.paletteMode || 'copy';
  if (shift) mode = mode === 'stack' ? 'copy' : 'stack';
  const doCopy = mode === 'copy' || mode === 'both';
  const doStack = mode === 'stack' || mode === 'both';

  let copied = false;
  if (doCopy) {
    const kind = p.type === 'load-kit' ? 'kit' : p.kind;
    const text = itemCopyText(kind, p.id);
    if (!text || !text.trim()) toast('That item is empty — nothing copied.', 'err');
    else {
      copied = await copyText(text);
      if (!copied) toast('Clipboard was blocked by the browser.', 'err');
    }
  }

  if (doStack) {
    if (p.type === 'load-kit') loadKit(p.id);
    else addBlock(p.kind, p.id);
  }

  if (copied) toast(`Copied “${item.name}”${doStack ? ' & added to stack' : ''} ✓`, 'ok');
  renderView();
}

/* ------------------------------------------------------------------ */
/* Workflow actions                                                    */
/* ------------------------------------------------------------------ */

function purgeRefs(kind, id) {
  state.stack = (state.stack || []).filter((b) => !((b.type === kind) && b.refId === id));
  if (kind === 'kb') {
    for (const b of state.stack) if (b.type === 'kb') b.ids = (b.ids || []).filter((x) => x !== id);
    state.stack = state.stack.filter((b) => b.type !== 'kb' || (b.ids && b.ids.length));
  }
  for (const k of state.kits || []) {
    k.blocks = (k.blocks || []).filter((b) => !((b.type === kind) && b.refId === id));
    if (kind === 'kb') {
      for (const b of k.blocks) if (b.type === 'kb') b.ids = (b.ids || []).filter((x) => x !== id);
      k.blocks = k.blocks.filter((b) => b.type !== 'kb' || (b.ids && b.ids.length));
    }
  }
}

function addBlock(kind, id) {
  if (kind === 'kb') {
    let block = (state.stack || []).find((b) => b.type === 'kb');
    if (!block) { block = { id: uid('blk'), type: 'kb', ids: [] }; state.stack.push(block); }
    if (!block.ids.includes(id)) block.ids.push(id);
    const item = findItem(state, 'kb', id);
    toast(`${item?.number || 'KB'} added`, 'ok');
  } else {
    state.stack.push({ id: uid('blk'), type: kind, refId: id });
    toast(`${findItem(state, kind, id)?.name || 'Block'} added`, 'ok');
  }
  save();
}

function addText() {
  const id = uid('blk');
  state.stack.push({ id, type: 'text', content: '' });
  save();
  ui.focusBlockId = id;
  renderView();
}

function validateBlocks(blocks) {
  return (blocks || []).map((b) => {
    if (b.type === 'kb') {
      const ids = (b.ids || []).filter((id) => findItem(state, 'kb', id));
      return ids.length ? { id: uid('blk'), type: 'kb', ids } : null;
    }
    if (b.type === 'text') return { id: uid('blk'), type: 'text', content: b.content || '' };
    const kind = b.type === 'template' ? 'template' : 'email';
    return findItem(state, kind, b.refId) ? { id: uid('blk'), type: kind, refId: b.refId } : null;
  }).filter(Boolean);
}

function loadKit(id) {
  const kit = findItem(state, 'kit', id);
  if (!kit) { toast('Kit not found.', 'err'); return; }
  state.stack = validateBlocks(kit.blocks);
  kit.uses = (kit.uses || 0) + 1;
  ui.tab = 'builder';
  syncUrl();
  save();
  toast(`Loaded “${kit.name}” (${state.stack.length} blocks) ✓`, 'ok');
}

function saveKit() {
  if (!state.stack.length) { toast('Build a stack first, then save it as a Kit.', 'err'); return; }
  promptDialog('Save Quick Kit', 'Kit name', `My workflow ${state.kits.length + 1}`, (name) => {
    const clean = (name || '').trim();
    if (!clean) { toast('Give the kit a name.', 'err'); return; }
    state.kits.unshift({ id: uid('kit'), name: clean, blocks: clone(state.stack), uses: 0, createdAt: new Date().toISOString() });
    save();
    closeModal();
    renderView();
    toast(`Kit “${clean}” saved ✓`, 'ok');
  });
}

async function doCopy(next = false) {
  const composed = compose(state);
  if (!composed.text.trim()) { toast('Nothing to copy — add a block first.', 'err'); return; }
  const ok = await copyText(composed.text);
  if (!ok) { toast('Clipboard was blocked. Select the preview text and press Ctrl+C instead.', 'err'); return; }

  touchUsage(state);
  state.history.unshift({
    id: uid('h'), at: new Date().toISOString(),
    ticket: state.context?.ticket || '', text: composed.text, blocks: clone(state.stack)
  });
  const limit = Number(state.settings.historyLimit) || 100;
  state.history = state.history.slice(0, limit);

  if (next) {
    state.stack = [];
    if (state.settings.resetFieldsOnNext !== false) {
      state.context = { ticket: '', caller: '', phone: '', shortdesc: '', kbnum: '' };
      state.fields = {};
    }
    toast('Copied — ready for the next ticket ✓', 'ok');
  } else if (state.settings.autoClear) {
    state.stack = [];
    toast(`Copied ${composed.text.length} characters — stack cleared ✓`, 'ok');
  } else {
    toast(`Copied ${composed.text.length} characters ✓`, 'ok');
  }
  save();
  renderView();
}

function itemCopyText(kind, id) {
  const it = findItem(state, kind, id);
  if (!it) return '';
  if (kind === 'kit') {
    // A kit copies the fully composed note of all its blocks with current variables.
    const temp = { ...state, stack: clone(it.blocks || []) };
    return compose(temp).text.trim();
  }
  const vars = buildVars(state);
  const unfilled = new Set();
  if (kind === 'template') return resolve(it.body, vars, unfilled).trim();
  if (kind === 'email') {
    const subject = resolve(it.subject, vars, unfilled).trim();
    const body = resolve(it.body, vars, unfilled).trim();
    return subject && body ? `Subject: ${subject}\n\n${body}` : (subject || body);
  }
  return resolve(state.settings.kbFormat || '• {{number}} — {{title}}', {
    ...vars, number: it.number || '', title: it.title || it.name || '', url: it.url || '', notes: it.notes || ''
  }, unfilled, true).trim();
}

async function copyItem(kind, id) {
  const text = itemCopyText(kind, id);
  if (!text) { toast('That item is empty.', 'err'); return; }
  const ok = await copyText(text);
  toast(ok ? 'Copied to clipboard ✓' : 'Clipboard blocked by the browser.', ok ? 'ok' : 'err');
}

async function copyBlock(id) {
  const b = (state.stack || []).find((x) => x.id === id);
  if (!b) return;
  const text = renderBlock(state, b, buildVars(state), new Set()).trim();
  if (!text) { toast('That block is empty.', 'err'); return; }
  const ok = await copyText(text);
  toast(ok ? 'Block copied ✓' : 'Clipboard blocked.', ok ? 'ok' : 'err');
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stacknote-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Backup downloaded ✓', 'ok');
}

function importData(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch (_) { toast('That file is not valid JSON.', 'err'); return; }
  confirmDialog('Import backup?', 'This replaces your templates, KB articles, emails and kits with the ones in this file. Your local history and sync credentials are kept.', () => {
    const merged = normalizeState(parsed);
    merged.settings.supabase = clone(state.settings.supabase);
    merged.settings.lastSync = state.settings.lastSync;
    merged.history = state.history;
    merged.stack = state.stack;
    state = merged;
    save();
    closeModal();
    applyTheme();
    renderView();
    toast('Backup imported ✓', 'ok');
  }, 'Import');
}

function syncUrl() {
  try {
    const url = new URL(window.location.href);
    if (ui.tab === 'builder') url.searchParams.delete('view');
    else url.searchParams.set('view', ui.tab);
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch (_) { /* noop */ }
}

/* ------------------------------------------------------------------ */
/* Central action dispatcher                                           */
/* ------------------------------------------------------------------ */

async function handleAction(action, d, el, opts = {}) {
  switch (action) {
    case 'tab':
      ui.tab = d.tab; syncUrl(); renderView();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
    case 'lib-tab': ui.libTab = d.lib; renderView(); break;
    case 'set-mobile-view':
      ui.mobileView = d.view;
      document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.view === d.view));
      $('.builder-grid')?.setAttribute('data-mobile', d.view);
      break;
    case 'context-toggle': ui.contextOpen = !ui.contextOpen; renderView(); break;
    case 'new-ticket':
      state.context = { ticket: '', caller: '', phone: '', shortdesc: '', kbnum: '' };
      state.fields = {};
      save(); renderView(); toast('Cleared for a new ticket');
      break;
    case 'theme-toggle':
      state.settings.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      save(); applyTheme(); renderHeader(); renderView();
      break;
    case 'install':
      if (ui.deferredInstall) {
        ui.deferredInstall.prompt();
        ui.deferredInstall = null;
        renderHeader();
      } else toast('Use your browser menu → “Install app” / “Add to Home Screen”.');
      break;
    case 'shortcuts': showShortcuts(); break;
    case 'palette': openPalette(d.mode || 'all'); break;
    case 'palette-item': {
      const it = ui.palette?.items?.[Number(d.index)];
      if (it) runPaletteItem(it, opts.shift);
      break;
    }
    case 'palette-backdrop': closePalette(); break;
    case 'modal-backdrop': closeModal(); break;

    case 'add': addBlock(d.kind, d.id); renderView(); break;
    case 'add-text': addText(); break;
    case 'remove-block':
      state.stack = state.stack.filter((b) => b.id !== d.id); save(); renderView(); break;
    case 'move-block': {
      const i = state.stack.findIndex((b) => b.id === d.id);
      const j = d.dir === 'up' ? i - 1 : i + 1;
      if (i >= 0 && j >= 0 && j < state.stack.length) {
        const [b] = state.stack.splice(i, 1);
        state.stack.splice(j, 0, b);
        save(); renderView();
      }
      break;
    }
    case 'kb-remove': {
      const b = state.stack.find((x) => x.id === d.id);
      if (b) {
        b.ids = (b.ids || []).filter((x) => x !== d.kbid);
        if (!b.ids.length) state.stack = state.stack.filter((x) => x.id !== d.id);
        save(); renderView();
      }
      break;
    }
    case 'copy-block': await copyBlock(d.id); break;
    case 'clear-stack':
      if (!state.stack.length) { toast('Stack is already empty.'); break; }
      confirmDialog('Clear the stack?', 'Removes all blocks currently in the stack. Your templates and KB articles stay in the library.', () => {
        state.stack = []; save(); closeModal(); renderView(); toast('Stack cleared');
      }, 'Clear stack');
      break;
    case 'copy': await doCopy(false); break;
    case 'copy-next': await doCopy(true); break;
    case 'copy-field': {
      const composed = compose(state);
      const key = d.field;
      const text = composed.sections?.[key] || '';
      if (!text.trim()) { toast('Nothing to copy for that field yet.', 'err'); break; }
      const ok = await copyText(text);
      toast(ok ? `Copied ${SECTION_LABELS[key] || key} ✓` : 'Clipboard was blocked by the browser.', ok ? 'ok' : 'err');
      break;
    }

    case 'fav': {
      const it = findItem(state, d.kind, d.id);
      if (it) { it.favorite = !it.favorite; save(); renderView(); }
      break;
    }
    case 'copy-item': await copyItem(d.kind, d.id); break;
    case 'edit': openEditor(d.kind, d.id); break;
    case 'duplicate': {
      const it = findItem(state, d.kind, d.id);
      if (!it) break;
      const copy = clone(it);
      copy.id = uid(d.kind);
      copy.name = `${it.name || it.number || 'Item'} (copy)`;
      copy.title = it.title ? `${it.title} (copy)` : copy.title;
      copy.favorite = false;
      copy.uses = 0;
      copy.updatedAt = new Date().toISOString();
      state[ARR[d.kind]].unshift(copy);
      save(); renderView(); toast('Duplicated ✓', 'ok');
      break;
    }
    case 'delete': {
      const it = findItem(state, d.kind, d.id);
      confirmDialog('Delete this item?', `“${esc(itemLabel(d.kind, it || {}))}” will be removed from the library and from any kits. This cannot be undone.`, () => {
        state[ARR[d.kind]] = state[ARR[d.kind]].filter((x) => x.id !== d.id);
        purgeRefs(d.kind, d.id);
        save(); closeModal(); renderView(); toast('Deleted');
      }, 'Delete');
      break;
    }
    case 'new-item': openEditor(d.kind, null); break;

    case 'save-kit': saveKit(); break;
    case 'load-kit': loadKit(d.id); renderView(); break;
    case 'rename-kit': {
      const k = findItem(state, 'kit', d.id);
      if (!k) break;
      promptDialog('Rename kit', 'Kit name', k.name, (name) => {
        if ((name || '').trim()) { k.name = name.trim(); save(); closeModal(); renderView(); toast('Renamed ✓', 'ok'); }
        else { toast('Give the kit a name.', 'err'); }
      });
      break;
    }
    case 'delete-kit':
      confirmDialog('Delete kit?', 'The kit will be removed. The templates inside it stay in your library.', () => {
        state.kits = state.kits.filter((k) => k.id !== d.id);
        save(); closeModal(); renderView(); toast('Kit deleted');
      }, 'Delete');
      break;

    case 'history-copy': {
      const h = state.history.find((x) => x.id === d.id);
      if (h) { const ok = await copyText(h.text); toast(ok ? 'Copied again ✓' : 'Clipboard blocked.', ok ? 'ok' : 'err'); }
      break;
    }
    case 'history-load': {
      const h = state.history.find((x) => x.id === d.id);
      if (h) {
        state.stack = validateBlocks(h.blocks);
        ui.tab = 'builder'; syncUrl(); save(); renderView(); toast('Blocks loaded into the stack ✓', 'ok');
      }
      break;
    }
    case 'history-delete':
      state.history = state.history.filter((x) => x.id !== d.id); save(); renderView(); break;
    case 'history-clear':
      if (!state.history.length) { toast('History is already empty.'); break; }
      confirmDialog('Clear all history?', 'All copied-note entries will be deleted from this device.', () => {
        state.history = []; save(); closeModal(); renderView(); toast('History cleared');
      }, 'Clear all');
      break;

    case 'export': exportData(); break;
    case 'import': $('#import-file')?.click(); break;
    case 'reset-data':
      confirmDialog('Reset all data?', 'This deletes your templates, KB articles, emails, kits and history and restores the starter examples. Export a backup first if you want to keep them.', () => {
        state = seedState(); save(); closeModal(); applyTheme(); renderView(); toast('Starter content restored');
      }, 'Reset everything');
      break;

    case 'show-sql': showSQL(); break;
    case 'copy-sql': {
      const ok = await copyText(SUPABASE_SQL);
      toast(ok ? 'SQL copied ✓' : 'Clipboard blocked.', ok ? 'ok' : 'err');
      break;
    }
    case 'sync-test':
      try { await syncTest(state); toast('Supabase connection OK ✓', 'ok'); }
      catch (err) { toast(err.message, 'err'); }
      break;
    case 'sync-push':
      try {
        const at = await syncPush(state);
        state.settings.lastSync = at; save();
        const s = $('#last-sync'); if (s) s.textContent = fmtStamp(at);
        toast('Pushed to Supabase ✓', 'ok');
      } catch (err) { toast(err.message, 'err'); }
      break;
    case 'sync-pull':
      try {
        const merged = await syncPull(state);
        state = merged; save(); closeModal(); applyTheme(); renderView();
        toast('Pulled from Supabase ✓', 'ok');
      } catch (err) { toast(err.message, 'err'); }
      break;

    case 'sep-select': {
      const map = { blank: '\n\n', single: '\n', divider: '\n\n---\n\n' };
      const chosen = el && el.value !== undefined ? el.value : d.value;
      if (chosen !== 'custom' && map[chosen]) {
        state.settings.separator = map[d.value];
        const inp = $('[data-sep-literal]');
        if (inp) inp.value = showSep(state.settings.separator);
        save(); updateLive();
      }
      break;
    }
    case 'insert-var': {
      const modal = $('#modal-root');
      // Insert into whichever editor field the user last focused.
      let ta = ui.lastTextarea;
      if (!ta || ta.tagName !== 'TEXTAREA' || !modal.contains(ta)) ta = null;
      if (!ta) ta = $('#' + d.target) || modal.querySelector('textarea');
      if (ta) {
        const start = ta.selectionStart ?? ta.value.length;
        const end = ta.selectionEnd ?? start;
        ta.setRangeText(d.var, start, end, 'end');
        ta.focus();
      }
      break;
    }
    case 'close-modal': case 'modal-cancel': closeModal(); break;
    case 'modal-confirm': { const cb = ui.confirmCb; if (cb) cb(); break; }
    case 'modal-ok': { const cb = ui.promptCb; const v = $('[data-prompt-input]')?.value; if (cb) cb(v); break; }
    case 'modal-save': saveEditor(d.kind, d.id || null); break;
    case 'modal-delete': {
      closeModal();
      confirmDialog('Delete this item?', 'This cannot be undone.', () => {
        state[ARR[d.kind]] = state[ARR[d.kind]].filter((x) => x.id !== d.id);
        purgeRefs(d.kind, d.id);
        save(); closeModal(); renderView(); toast('Deleted');
      }, 'Delete');
      break;
    }
    default: break;
  }
}

// The click listener already filters backdrop clicks to the backdrop element
// itself, so the dispatcher can simply close the overlay.

/* ------------------------------------------------------------------ */
/* Event listeners                                                     */
/* ------------------------------------------------------------------ */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'modal-backdrop' || action === 'palette-backdrop') {
    if (e.target !== el) return;
  }
  if (el.tagName === 'BUTTON' || el.tagName === 'A') e.preventDefault();
  handleAction(action, el.dataset, el, { shift: e.shiftKey });
});

document.addEventListener('focusin', (e) => {
  if (e.target.tagName === 'TEXTAREA') ui.lastTextarea = e.target;
});

document.addEventListener('input', (e) => {
  const el = e.target;
  const ds = el.dataset || {};
  if (ds.libSearch !== undefined) { ui.libSearch = el.value; renderLibLists(); return; }
  if (ds.historySearch !== undefined) { ui.historySearch = el.value; renderHistoryList(); return; }
  if (ds.paletteInput !== undefined) {
    if (ui.palette) { ui.palette.query = el.value; ui.palette.selected = 0; renderPaletteResults(); }
    return;
  }
  if (ds.context) { state.context[ds.context] = el.value; save(); updateLive(); return; }
  if (ds.field) { state.fields[ds.field] = el.value; save(); updateLive(); return; }
  if (ds.blockText) {
    const b = (state.stack || []).find((x) => x.id === ds.blockText);
    if (b) { b.content = el.value; save(); updateLive(); }
    return;
  }
  if (ds.setting) {
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (ds.sepLiteral !== undefined) {
      value = String(value).replace(/\\r/g, '\r').replace(/\\n/g, '\n');
      const sel = $('[data-action="sep-select"]');
      if (sel) sel.value = 'custom';
    }
    if (ds.setting === 'historyLimit') value = Math.max(10, Math.min(1000, Number(value) || 100));
    setSetting(ds.setting, value);
    save();
    updateLive();
    return;
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'import-file' && e.target.files?.[0]) {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = () => importData(String(reader.result || ''));
    reader.readAsText(file);
    e.target.value = '';
    return;
  }
  if (e.target.dataset?.action === 'sep-select') {
    handleAction('sep-select', e.target.dataset, e.target);
  }
});

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (mod && key === 'k') { e.preventDefault(); openPalette(); return; }
  if (mod && e.key === 'Enter') { e.preventDefault(); doCopy(e.shiftKey); return; }

  if (e.key === 'Escape') {
    if (ui.palette) { closePalette(); return; }
    if (ui.modal) { closeModal(); return; }
  }

  if (ui.palette) {
    if (e.key === 'ArrowDown' || (mod && key === 'n')) {
      e.preventDefault();
      ui.palette.selected = Math.min(ui.palette.selected + 1, Math.max(0, (ui.palette.items?.length || 1) - 1));
      renderPaletteResults(); return;
    }
    if (e.key === 'ArrowUp' || (mod && key === 'p')) {
      e.preventDefault();
      ui.palette.selected = Math.max(0, ui.palette.selected - 1);
      renderPaletteResults(); return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const it = ui.palette.items?.[ui.palette.selected];
      if (it) runPaletteItem(it, e.shiftKey);
      return;
    }
    return;
  }

  if (ui.modal) {
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      $('#modal-root [data-action="modal-save"], #modal-root [data-action="modal-ok"], #modal-root [data-action="modal-confirm"]')?.click();
    }
    return;
  }

  const tag = document.activeElement?.tagName || '';
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (!typing && e.key === '/') {
    e.preventDefault();
    if (ui.tab === 'builder' || ui.tab === 'library') {
      if (ui.tab === 'library') { const s = $('[data-lib-search]'); if (s) s.focus(); }
      else { ui.mobileView = 'library'; const s = $('[data-lib-search]'); if (s) s.focus(); }
    }
    return;
  }
  if (!typing && e.key === '?') { e.preventDefault(); showShortcuts(); }
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  ui.deferredInstall = e;
  renderHeader();
});
window.addEventListener('appinstalled', () => {
  ui.deferredInstall = null;
  renderHeader();
  toast('StackNote installed ✓', 'ok');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
  });
}

function boot() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('view');
  if (requested && TABS.some((t) => t.id === requested)) ui.tab = requested;
  ui.libSort = state.settings.sort || 'used';
  applyTheme();
  renderView();
  $('#build-stamp').textContent = 'StackNote v1.0 · offline PWA';
  if (!state.history.length && !state.stack.length) {
    setTimeout(() => toast(`Tip: press ${MOD} K to find anything instantly.`), 700);
  }
}

boot();
