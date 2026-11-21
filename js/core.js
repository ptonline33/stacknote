// core.js — variable resolution, note composition, clipboard and optional sync.

import { BUILTIN_VARS, clone, findItem, normalizeState } from './data.js';

const KB_LINE_KEYS = ['number', 'title', 'url', 'notes'];

// Built-in derived values are legitimately empty sometimes (no KB articles yet,
// no agent name configured). Don't flag them as missing fields.
const SILENT_WHEN_EMPTY = new Set([
  'kb', 'kblist', 'kbnum', 'agent', 'date', 'time', 'datetime'
]);

/** KB numbers typed into the quick-entry field (comma / space / semicolon separated). */
export function typedKBNumbers(state) {
  const raw = String(state.context?.kbnum || '');
  return [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}

/** Render a bare KB number through the configured KB line format. */
function typedKBLine(state, num, vars) {
  const format = state.settings?.kbFormat || '• {{number}} — {{title}}';
  let line = resolve(format, {
    ...vars, number: num, title: '', url: '', notes: ''
  }, new Set(), true).trim();
  line = line.replace(/\(\s*\)/g, '').replace(/\[\s*\]/g, '');
  line = line.replace(/[\s—–\-:|,]+$/g, '').trim();
  return line || num;
}

/** Replace {{key}} / {{key|fallback}} tokens. Missing values are recorded. */
export function resolve(text, vars, unfilled = new Set(), silent = false) {
  return String(text ?? '').replace(/\{\{([^{}]+)\}\}/g, (match, inner) => {
    const pieces = inner.split('|');
    const key = (pieces.shift() || '').trim().toLowerCase();
    const fallback = pieces.length ? pieces.join('|').trim() : '';
    const value = vars[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
    if (fallback) return fallback;
    if (silent || SILENT_WHEN_EMPTY.has(key)) return '';
    unfilled.add(key);
    return match;
  });
}

/** KB articles currently in the stack, in insertion order, de-duplicated. */
export function collectKB(state) {
  const ids = [];
  for (const block of state.stack || []) {
    if (block.type === 'kb') for (const id of (block.ids || [])) if (!ids.includes(id)) ids.push(id);
  }
  return ids.map((id) => findItem(state, 'kb', id)).filter(Boolean);
}

/** All variable values available to templates right now. */
export function buildVars(state) {
  const d = new Date();
  const settings = state.settings || {};
  const base = {
    ticket: state.context?.ticket || '',
    caller: state.context?.caller || '',
    phone: state.context?.phone || '',
    asset: state.context?.asset || '',
    shortdesc: state.context?.shortdesc || '',
    date: d.toLocaleDateString(),
    time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    datetime: d.toLocaleString(),
    agent: settings.agent || ''
  };
  for (const [k, v] of Object.entries(state.fields || {})) {
    const key = String(k).toLowerCase();
    // Built-in context fields always take precedence over legacy custom fields.
    if (!(key in base)) base[key] = v ?? '';
  }

  const kbItems = collectKB(state);
  const typed = typedKBNumbers(state);
  const format = settings.kbFormat || '• {{number}} — {{title}}';
  const lines = kbItems.map((k) =>
    resolve(format, {
      ...base,
      number: k.number || '', title: k.title || '', url: k.url || '', notes: k.notes || ''
    }, new Set(), true).trim()
  );
  for (const num of typed) lines.push(typedKBLine(state, num, base));

  base.kbnum = state.context?.kbnum || '';
  base.kb = [...new Set([
    ...kbItems.map((k) => k.number).filter(Boolean), ...typed
  ])].join(', ');
  base.kblist = lines.join('\n');
  return base;
}

/** Custom (non built-in) placeholders used anywhere in the current composition. */
export function detectFields(state) {
  const found = new Set(Object.keys(state.fields || {}));
  const texts = [
    state.settings?.header, state.settings?.footer,
    state.settings?.kbFormat, state.settings?.kbHeading
  ];
  for (const block of state.stack || []) {
    if (block.type === 'text') texts.push(block.content);
    else if (block.type === 'template') {
      const t = findItem(state, 'template', block.refId);
      if (t) { texts.push(t.shortDescription); texts.push(t.description); texts.push(t.body); }
    } else if (block.type === 'email') {
      const e = findItem(state, 'email', block.refId);
      if (e) { texts.push(e.subject); texts.push(e.body); }
    } else if (block.type === 'kb') {
      texts.push(state.settings?.kbFormat);
      texts.push(state.settings?.kbHeading);
    }
  }
  for (const text of texts) {
    String(text ?? '').replace(/\{\{([^{}]+)\}\}/g, (_m, inner) => {
      const key = inner.split('|')[0].trim().toLowerCase();
      if (key && !BUILTIN_VARS.includes(key) && !KB_LINE_KEYS.includes(key)) found.add(key);
      return '';
    });
  }
  return [...found].sort();
}

/** Render one stack block into text. */
export function renderBlock(state, block, vars, unfilled) {
  const settings = state.settings || {};
  if (block.type === 'template') {
    const t = findItem(state, 'template', block.refId);
    return t ? resolve(t.body, vars, unfilled) : '';
  }
  if (block.type === 'email') {
    const e = findItem(state, 'email', block.refId);
    if (!e) return '';
    const subject = resolve(e.subject, vars, unfilled).trim();
    const body = resolve(e.body, vars, unfilled).trim();
    if (subject && body) return `Subject: ${subject}\n\n${body}`;
    return subject || body;
  }
  if (block.type === 'text') {
    return resolve(block.content, vars, unfilled);
  }
  if (block.type === 'kb') {
    const format = settings.kbFormat || '• {{number}} — {{title}}';
    const lines = [];
    for (const id of (block.ids || [])) {
      const k = findItem(state, 'kb', id);
      if (!k) continue;
      lines.push(resolve(format, {
        ...vars,
        number: k.number || '', title: k.title || '', url: k.url || '', notes: k.notes || ''
      }, unfilled, true).trim());
    }
    const heading = resolve(settings.kbHeading || 'KB Articles:', vars, unfilled).trim();
    return [heading, ...lines.filter(Boolean)].filter(Boolean).join('\n');
  }
  return '';
}

/** Compose the final note plus per-ServiceNow-field sections. */
export function compose(state) {
  const unfilled = new Set();
  const vars = buildVars(state);
  const settings = state.settings || {};
  const sep = settings.separator ?? '\n\n';
  const parts = [];
  const shortParts = [];
  const descParts = [];

  const header = resolve(settings.header || '', vars, unfilled).trim();
  if (header) parts.push(header);

  for (const block of state.stack || []) {
    if (block.type === 'template') {
      const t = findItem(state, 'template', block.refId);
      if (t) {
        const shortText = resolve(t.shortDescription || '', vars, unfilled).trim();
        if (shortText) shortParts.push(shortText);
        const description = resolve(t.description || '', vars, unfilled).trim();
        if (description) descParts.push(description);
      }
    }
    const text = renderBlock(state, block, vars, unfilled).trim();
    if (text) parts.push(text);
  }

  // A KB# typed into Ticket context always reaches the note, even when no
  // template references {{kb}} and no KB article was stacked.
  const typed = typedKBNumbers(state);
  if (typed.length) {
    const joined = parts.join(sep);
    const missing = typed.filter((n) => !joined.includes(n));
    if (missing.length) parts.push(`KB#: ${missing.join(', ')}`);
  }

  const footer = resolve(settings.footer || '', vars, unfilled).trim();
  if (footer) parts.push(footer);

  const text = parts.join(sep);
  return {
    text,
    parts,
    vars,
    unfilled: [...unfilled].sort(),
    sections: {
      shortDescription: shortParts.join(sep),
      description: descParts.join(sep),
      workNotes: text
    }
  };
}

export function blockTitle(state, block) {
  if (block.type === 'template') return findItem(state, 'template', block.refId)?.name || 'Missing template';
  if (block.type === 'email') return findItem(state, 'email', block.refId)?.name || 'Missing email';
  if (block.type === 'kb') {
    const n = (block.ids || []).length;
    return n === 1 ? '1 KB article' : `${n} KB articles`;
  }
  return 'Quick text';
}

export function blockSnippet(state, block, vars) {
  const text = renderBlock(state, block, vars, new Set()).trim();
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

/** Copy text to the clipboard, with a fallback for restricted browsers. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) { /* fall through to legacy path */ }

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
  ta.remove();
  return ok;
}

/* ------------------------------------------------------------------ */
/* Optional Supabase cross-device sync (no SDK, plain REST)             */
/* ------------------------------------------------------------------ */

export const SUPABASE_SQL = `-- StackNote optional cross-device sync (Supabase)
-- Run this in the Supabase SQL Editor, then paste the Project URL + anon key
-- into StackNote -> Settings -> Cloud sync.

create table if not exists public.stacknote_workspaces (
  id          text primary key,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.stacknote_workspaces enable row level security;

drop policy if exists "stacknote anon access" on public.stacknote_workspaces;
create policy "stacknote anon access"
  on public.stacknote_workspaces
  for all
  to anon
  using (true)
  with check (true);

grant usage on schema public to anon;
grant select, insert, update on public.stacknote_workspaces to anon;

notify pgrst, 'reload schema';`;

/** The shared portion of state. Local history, stack and credentials stay local. */
export function syncPayload(state) {
  const payload = clone(state);
  delete payload.history;
  delete payload.stack;
  if (payload.settings) {
    delete payload.settings.supabase;
    delete payload.settings.lastSync;
  }
  return payload;
}

function sbConfig(state) {
  const cfg = state.settings?.supabase || {};
  const url = (cfg.url || '').trim().replace(/\/+$/, '');
  const key = (cfg.key || '').trim();
  const workspace = (cfg.workspace || '').trim();
  if (!url || !key || !workspace) {
    throw new Error('Add your Project URL, anon key and workspace code in Settings → Cloud sync.');
  }
  return { url, key, workspace };
}

async function sbFetch({ url, key }, path, options = {}) {
  const res = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 240);
    throw new Error(`Supabase returned ${res.status}: ${detail}`);
  }
  return res;
}

export async function syncTest(state) {
  const cfg = sbConfig(state);
  await sbFetch(cfg, '/rest/v1/stacknote_workspaces?select=id&limit=1');
  return true;
}

export async function syncPush(state) {
  const cfg = sbConfig(state);
  const body = {
    id: cfg.workspace,
    data: syncPayload(state),
    updated_at: new Date().toISOString()
  };
  await sbFetch(cfg, '/rest/v1/stacknote_workspaces', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body)
  });
  return new Date().toISOString();
}

export async function syncPull(state) {
  const cfg = sbConfig(state);
  const res = await sbFetch(cfg,
    `/rest/v1/stacknote_workspaces?id=eq.${encodeURIComponent(cfg.workspace)}&select=data,updated_at`);
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('No workspace found with that code. Push from your other device first.');
  }
  const remote = rows[0].data;
  if (!remote || typeof remote !== 'object') throw new Error('Remote workspace is empty.');

  // Keep local credentials, local copy history and the current in-progress stack.
  const localSupabase = clone(state.settings?.supabase || {});
  const merged = normalizeState(remote);
  merged.settings.supabase = localSupabase;
  merged.settings.lastSync = rows[0].updated_at || new Date().toISOString();
  merged.history = state.history || [];
  merged.stack = state.stack || [];
  return merged;
}
