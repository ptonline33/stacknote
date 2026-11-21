// data.js — persistent state, seed content and small shared helpers.

export const STORAGE_KEY = 'stacknote:v1';

export const BUILTIN_VARS = [
  'ticket', 'caller', 'phone', 'shortdesc', 'kbnum', 'date', 'time', 'datetime',
  'agent', 'kb', 'kblist'
];

export const BUILTIN_VAR_HELP = {
  ticket: 'Ticket number (INC / REQ / RITM…)',
  caller: 'Caller / affected user name',
  phone: 'Caller phone / contact number (Ticket context)',
  shortdesc: 'Short description of the ticket',
  kbnum: 'KB# typed into the quick-entry field (also merged into {{kb}})',
  date: 'Today\'s date',
  time: 'Current time',
  datetime: 'Date and time',
  agent: 'Your name / initials (Settings)',
  kb: 'Comma-separated KB numbers (library + quick-entry)',
  kblist: 'Full formatted KB list in this note'
};

/** ServiceNow field labels, shared by the composer and the preview. */
export const SECTION_LABELS = {
  shortDescription: 'Short description',
  description: 'Description',
  workNotes: 'Work notes'
};

export function uid(prefix = 'id') {
  const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${rnd}`;
}

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function fmtStamp(iso) {
  if (!iso) return '—';
  return `${fmtDate(iso)} · ${fmtTime(iso)}`;
}

export function todayCount(history) {
  const today = new Date().toDateString();
  return history.filter((h) => new Date(h.at).toDateString() === today).length;
}

export const DEFAULT_SETTINGS = {
  theme: 'dark',                 // 'dark' | 'light' | 'system'
  agent: '',
  separator: '\n\n',             // what joins blocks
  header: '',
  footer: '',
  kbHeading: 'KB Articles:',
  kbFormat: '• {{number}} — {{title}}',
  autoClear: false,              // clear stack after a normal copy
  resetFieldsOnNext: true,       // "Copy & next" clears context + custom fields
  paletteMode: 'copy',           // 'copy' | 'stack' | 'both' — what selecting a palette item does
  historyLimit: 100,
  sort: 'used',                  // 'used' | 'alpha' | 'recent'
  supabase: { url: '', key: '', workspace: '' },
  lastSync: null
};

/**
 * Starter text for the three ServiceNow fields on each built-in template.
 * Kept separate so existing users' saved starter templates can be upgraded
 * in normalizeState() without touching any templates they created themselves.
 */
export const SEED_FIELD_EXAMPLES = {
  'seed-tpl-pwreset': {
    shortDescription: 'Password reset for {{caller}}',
    description: '{{caller}} contacted the Service Desk unable to sign in to their account. A password reset was requested for {{ticket}}. Callback number: {{phone|not provided}}.'
  },
  'seed-tpl-unlock': {
    shortDescription: 'Account unlock for {{caller}}',
    description: "{{caller}}'s account was locked after repeated sign-in failures. The user contacted the Service Desk to request an unlock for {{ticket}}."
  },
  'seed-tpl-access': {
    shortDescription: 'Access request — {{entitlement|role or group}} for {{caller}}',
    description: '{{caller}} requires {{entitlement|the requested role or group}} to perform their duties. Manager / data-owner approval is required before fulfilment. Ticket {{ticket}}.'
  },
  'seed-tpl-laptop': {
    shortDescription: 'Hardware issue — {{asset|laptop / docking station}} for {{caller}}',
    description: '{{caller}} reported a problem with {{asset|their device}}. Symptoms and diagnostics are recorded in the work notes. Ticket {{ticket}}; contact {{phone|not provided}}.'
  },
  'seed-tpl-software': {
    shortDescription: '{{app|Application}} install / repair for {{caller}}',
    description: '{{caller}} needs {{app|the application}} installed or repaired on their device. Ticket {{ticket}}.'
  },
  'seed-tpl-vpn': {
    shortDescription: 'VPN / connectivity issue for {{caller}}',
    description: '{{caller}} cannot connect to the VPN / internal resources. Reported on {{date}} at {{time}}. Ticket {{ticket}}.'
  },
  'seed-tpl-followup': {
    shortDescription: 'Awaiting information — {{ticket}}',
    description: 'Additional information is required from {{caller}} to continue investigating {{shortdesc}}. Ticket {{ticket}}; callback {{phone|not provided}}.'
  },
  'seed-tpl-resolve': {
    shortDescription: 'Resolved — {{shortdesc}}',
    description: '{{shortdesc}} reported by {{caller}} on {{date}}. Resolution details are recorded in the work notes. Ticket {{ticket}}.'
  },
  'seed-tpl-escalate': {
    shortDescription: 'Escalation to {{team|L2}} — {{shortdesc}}',
    description: '{{ticket}} — {{shortdesc}} requires review by {{team|the specialist team}}. Steps taken and findings are in the work notes. Impact: {{impact|standard}}.'
  }
};

function tpl(id, name, category, body, favorite = false) {
  const ex = SEED_FIELD_EXAMPLES[id] || { shortDescription: '', description: '' };
  return {
    id, name, category,
    shortDescription: ex.shortDescription,
    description: ex.description,
    body, // Work notes
    favorite, uses: 0, updatedAt: new Date().toISOString()
  };
}

function kb(id, number, title, url, notes, favorite = false) {
  return { id, number, title, url, notes, favorite, uses: 0, updatedAt: new Date().toISOString() };
}

function email(id, name, subject, body, favorite = false) {
  return { id, name, subject, body, favorite, uses: 0, updatedAt: new Date().toISOString() };
}

function kit(id, name, blocks) {
  return { id, name, blocks, uses: 0, createdAt: new Date().toISOString() };
}

export function seedState() {
  return {
    v: 1,
    settings: clone(DEFAULT_SETTINGS),
    context: { ticket: '', caller: '', phone: '', shortdesc: '', kbnum: '' },
    fields: {},
    templates: [
      tpl('seed-tpl-pwreset', 'Password reset', 'Access',
        'Password reset completed for {{caller}}.\n\n• Verified the caller\'s identity per the authentication standard.\n• Reset the password in the SSO portal and delivered a temporary password through the approved channel.\n• Confirmed the user signed in successfully; verified MFA enrollment where required.\n\nTicket: {{ticket}}\nKB: {{kb|N/A}}', true),
      tpl('seed-tpl-unlock', 'Account unlock', 'Access',
        'Account unlock completed for {{caller}}.\n\n• Confirmed identity and checked the lockout source (failed sign-ins / expired password / conditional access).\n• Cleared the lockout and had the user sign in successfully.\n• Advised on password manager use to prevent repeat lockouts.\n\nTicket: {{ticket}}\nKB: {{kb|N/A}}'),
      tpl('seed-tpl-access', 'Role / group access request', 'Access',
        'Access request processed for {{caller}}.\n\n• Requested entitlement: {{entitlement|the role or group requested}}\n• Approval verified (manager / data owner) and recorded on the ticket.\n• Access granted and confirmed with the user.\n\nTicket: {{ticket}}\nKB: {{kb|N/A}}'),
      tpl('seed-tpl-laptop', 'Laptop / hardware triage', 'Hardware',
        'Hardware triage performed for {{caller}} on asset {{asset|asset tag}}.\n\n• Reproduced the reported issue and gathered error details / screenshots.\n• Ran standard diagnostics (power, display, docking station, peripherals).\n• Applied the fix or escalated to the hardware team with findings attached.\n\nTicket: {{ticket}}'),
      tpl('seed-tpl-software', 'Software install / repair', 'Software',
        'Software support completed for {{caller}} regarding {{app|the application}}.\n\n• Confirmed entitlement / license availability.\n• Installed or repaired the application via the approved deployment method.\n• Launched the app with the user and verified core functionality.\n\nTicket: {{ticket}}\nKB: {{kb|N/A}}'),
      tpl('seed-tpl-vpn', 'VPN / connectivity', 'Network',
        'Connectivity issue handled for {{caller}}.\n\n• Confirmed network, VPN client version and authentication status.\n• Collected client logs and tested connectivity to internal resources.\n• Restored connectivity or escalated to Network Operations with diagnostics attached.\n\nTicket: {{ticket}}\nKB: {{kb|N/A}}'),
      tpl('seed-tpl-followup', 'More info / follow-up needed', 'General',
        'Follow-up required on {{ticket}}.\n\n• Reached out to {{caller}} for additional information / a convenient callback window.\n• Awaiting response; will update once received.\n\nNext check: {{nextcheck|next business day}}'),
      tpl('seed-tpl-resolve', 'Resolution & close notes', 'General',
        'Resolution summary for {{ticket}} — {{shortdesc}}.\n\n• Root cause: {{rootcause|see investigation notes}}\n• Resolution: {{resolution|see work notes}}\n• KB articles referenced: {{kb|N/A}}\n• User confirmed the issue is resolved.\n\nClosing as Resolved. — {{agent}} {{date}}', true),
      tpl('seed-tpl-escalate', 'Escalation / L2 handoff', 'Escalation',
        'Escalating {{ticket}} to {{team|the assignment group}}.\n\n• Summary: {{shortdesc}}\n• Steps already taken and findings: see work notes above.\n• Impact / urgency: {{impact|standard}}\n• Requested action: {{requested|review and advise}}\n• KB articles reviewed: {{kb|N/A}}')
    ],
    kb: [
      kb('seed-kb-pw', 'KB0012345', 'Resetting a password in the SSO portal', 'https://<instance>.service-now.com/kb?id=KB0012345', 'Standard self-service and assisted password reset procedure.', true),
      kb('seed-kb-vpn', 'KB0012890', 'VPN client installation and first-time setup', 'https://<instance>.service-now.com/kb?id=KB0012890', 'Install package, config profile and MFA prompt troubleshooting.'),
      kb('seed-kb-access', 'KB0034120', 'Requesting access to shared drives and groups', 'https://<instance>.service-now.com/kb?id=KB0034120', 'Approval flow and fulfillment steps for file/share access.'),
      kb('seed-kb-mfa', 'KB0056789', 'MFA re-enrollment procedure', 'https://<instance>.service-now.com/kb?id=KB0056789', 'Steps to re-register authenticator after a device change.'),
      kb('seed-kb-dock', 'KB0099112', 'Docking station and external monitor troubleshooting', 'https://<instance>.service-now.com/kb?id=KB0099112', 'Display / power / firmware checks for docking issues.')
    ],
    emails: [
      email('seed-em-info', 'Request more information', 'Additional information needed for {{ticket}}',
        'Hi {{caller}},\n\nTo progress your ticket {{ticket}} ({{shortdesc}}), could you please send us:\n\n• {{details|the information we need}}\n\nOnce we have this we will continue the investigation. If you would prefer a callback, just let us know a convenient time.\n\nRegards,\n{{agent}}\nService Desk', true),
      email('seed-em-resolved', 'Ticket resolved', 'Your ticket {{ticket}} has been resolved',
        'Hi {{caller}},\n\nYour ticket {{ticket}} — {{shortdesc}} — has now been resolved.\n\nSummary: {{resolution|the fix has been applied}}\n\nIf the issue returns or you are not satisfied with the outcome, please reply to this email and we will reopen the ticket.\n\nRegards,\n{{agent}}\nService Desk', true),
      email('seed-em-callback', 'Callback scheduled', 'Callback scheduled for {{ticket}}',
        'Hi {{caller}},\n\nWe have scheduled a callback regarding {{ticket}} for {{callbacktime|the agreed time}}.\n\nPlease have any relevant details or error messages to hand.\n\nRegards,\n{{agent}}\nService Desk'),
      email('seed-em-escalate', 'Escalation notice', '{{ticket}} escalated to {{team|the specialist team}}',
        'Team,\n\nEscalating {{ticket}} ({{shortdesc}}) for your review.\n\nFindings so far and steps taken are in the work notes; diagnostics are attached.\n\nRequested action: {{requested|please review and advise}}\n\nThanks,\n{{agent}}')
    ],
    kits: [
      kit('seed-kit-pw', 'Password reset — full pack', [
        { id: 'seed-blk-1', type: 'template', refId: 'seed-tpl-pwreset' },
        { id: 'seed-blk-2', type: 'kb', ids: ['seed-kb-pw', 'seed-kb-mfa'] },
        { id: 'seed-blk-3', type: 'email', refId: 'seed-em-resolved' }
      ]),
      kit('seed-kit-access', 'Access request — full pack', [
        { id: 'seed-blk-4', type: 'template', refId: 'seed-tpl-access' },
        { id: 'seed-blk-5', type: 'kb', ids: ['seed-kb-access'] },
        { id: 'seed-blk-6', type: 'email', refId: 'seed-em-info' }
      ])
    ],
    stack: [],
    history: []
  };
}

/** Merge a stored/imported object over defaults so missing keys never break the UI. */
export function normalizeState(raw) {
  const base = seedState();
  if (!raw || typeof raw !== 'object') return base;
  const out = {
    v: 1,
    settings: { ...clone(DEFAULT_SETTINGS), ...(raw.settings || {}) },
    context: { ticket: '', caller: '', phone: '', shortdesc: '', kbnum: '', ...(raw.context || {}) },
    fields: (raw.fields && typeof raw.fields === 'object' && !Array.isArray(raw.fields)) ? { ...raw.fields } : {},
    templates: Array.isArray(raw.templates) ? raw.templates : base.templates,
    kb: Array.isArray(raw.kb) ? raw.kb : base.kb,
    emails: Array.isArray(raw.emails) ? raw.emails : base.emails,
    kits: Array.isArray(raw.kits) ? raw.kits : base.kits,
    stack: Array.isArray(raw.stack) ? raw.stack : [],
    history: Array.isArray(raw.history) ? raw.history : []
  };
  out.settings.supabase = { url: '', key: '', workspace: '', ...(raw.settings?.supabase || {}) };
  // Basic per-item defaults.
  const fix = (item, defaults) => ({ ...defaults, ...item });
  out.templates = out.templates.map((t) => {
    const item = fix(t, {
      name: 'Untitled', category: 'General', shortDescription: '', description: '',
      body: '', favorite: false, uses: 0, updatedAt: new Date().toISOString()
    });
    // Upgrade unchanged built-in examples so existing users see all three fields.
    const example = SEED_FIELD_EXAMPLES[item.id];
    if (example) {
      if (!item.shortDescription) item.shortDescription = example.shortDescription;
      if (!item.description) item.description = example.description;
    }
    return item;
  });
  out.kb = out.kb.map((k) => fix(k, { number: '', title: '', url: '', notes: '', favorite: false, uses: 0, updatedAt: new Date().toISOString() }));
  out.emails = out.emails.map((e) => fix(e, { name: 'Untitled', subject: '', body: '', favorite: false, uses: 0, updatedAt: new Date().toISOString() }));
  out.kits = out.kits.map((k) => fix(k, { name: 'Untitled', blocks: [], uses: 0, createdAt: new Date().toISOString() }));
  return out;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    return normalizeState(JSON.parse(raw));
  } catch (err) {
    console.warn('StackNote: could not load saved data, using starter data.', err);
    return seedState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn('StackNote: could not save data.', err);
    return false;
  }
}

export function findItem(state, kind, id) {
  const key = { template: 'templates', kb: 'kb', email: 'emails', kit: 'kits' }[kind];
  return key ? (state[key] || []).find((x) => x.id === id) : null;
}

export function touchUsage(state) {
  const blocks = state.stack || [];
  const inc = (kind, id) => {
    const item = findItem(state, kind, id);
    if (item) {
      item.uses = (item.uses || 0) + 1;
      item.updatedAt = new Date().toISOString();
    }
  };
  for (const b of blocks) {
    if (b.type === 'template') inc('template', b.refId);
    else if (b.type === 'email') inc('email', b.refId);
    else if (b.type === 'kb') for (const id of (b.ids || [])) inc('kb', id);
  }
}
