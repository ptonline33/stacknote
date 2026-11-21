# StackNote

A small, fast **PWA for ServiceNow agents** who write the same kinds of ticket
notes all day. Stack reusable blocks — note templates, Knowledge Base articles
and email replies — and copy the whole finished note with **one click**.

It is served over **HTTPS**, works **offline**, and can be **installed** on a
work desktop or phone. By default **nothing leaves your browser**: all data is
stored in `localStorage`. Optional cross-device sync via Supabase is available
if you want it.

---

## The workflow

1. **Fill the ticket context once** at the top (ticket number, caller, phone /
   contact number, short description, **KB# quick entry**, your initials).
   Every `{{placeholder}}` in every template updates live as you type.
2. **Pick blocks** from the Library on the left:
   - **Notes** — templates with a Short description, Description and Work notes
   - **KB** — KB numbers you reference (several can be stacked; they render as
     a `KB Articles:` list, and `{{kb}}` inserts the numbers anywhere)
   - **Email** — subject + body replies you send often
   - **Kits** — saved one-click stacks (see below)
3. **Rearrange / edit** blocks in the middle. Add free-form "Quick text" when
   something is ticket-specific.
4. **Copy each ServiceNow field** from the preview panel — it shows
   **Short description**, **Description** and **Work notes** separately, each
   with its own Copy button. The main **Copy work notes** button
   (`Ctrl/⌘ + Enter`) copies everything (templates + KB list + emails).
5. **Copy & next** (`Ctrl/⌘ + Shift + Enter`) copies, logs the note to History,
   and clears the context so you're instantly ready for the next ticket.

### ServiceNow fields

Every **note template** now has three text areas, one per ServiceNow field:

| Field | Editor label | Copy button |
| --- | --- | --- |
| Short description | `Short description` | `Copy` above the preview |
| Description | `Description` | `Copy` above the preview |
| Work notes | `Work notes` | the main `Copy work notes` button |

All three are optional — leave any blank. They all accept the same variables.
Header/footer templates and KB/email/quick-text blocks apply to **Work notes**
only. The starter examples are filled in for all three fields.

**KB# quick entry** — type any KB number (or several, comma-separated) straight
into Ticket context without adding it to the KB library. It becomes
`{{kbnum}}`, is merged into `{{kb}}` / `{{kblist}}`, and is appended to Work
notes as a `KB#: …` line if no template already includes it. So a template
containing `KB: {{kb|N/A}}` picks it up automatically.

### Efficiency features

| Feature | What it does |
| --- | --- |
| **Command palette** (`Ctrl/⌘ + K`) | Fuzzy search every template, KB number, email, kit and action. **Selecting one copies that item's content straight to the clipboard** (variables already filled) — hold **Shift** while selecting to add it to the stack instead. Configurable in Settings → Workflow. |
| **Smart variables** | `{{ticket}}`, `{{caller}}`, `{{date}}`, `{{kb}}` … plus **any placeholder you invent**. Unknown ones (e.g. `{{hostname}}`) automatically become input fields in the context bar. Add a fallback with `{{ticket\|N/A}}`. |
| **Quick Kits** | Save a whole stack (e.g. *Password reset + 2 KB articles + confirmation email*) and reload it in one click. Two examples are included. |
| **Copy history** | Re-copy or reload anything you copied earlier today — handy when a ticket bounces back. |
| **Most-used sorting + favorites** | The templates you actually use float to the top of the library. |
| **One-click item copy** | The `⧉` button on any library item copies just that item (variables already filled). |
| **Header / footer templates** | Optionally prepend/append a standard line to every note (Settings). |
| **Offline PWA** | Installable, cached by a service worker, works on restricted networks. |

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl/⌘ + K` | Command palette — **selecting an item copies it to the clipboard** |
| `Ctrl/⌘ + K` then `Shift + Enter` / `Shift + click` | Add that item to the stack instead of copying |
| `Ctrl/⌘ + Enter` | Copy the composed Work notes |
| `Ctrl/⌘ + Shift + Enter` | Copy & start next ticket |
| `/` | Focus library search |
| `?` | Shortcuts guide |
| `Esc` | Close dialog / palette |

> **Palette behaviour** is set in **Settings → Workflow**: `Copy to clipboard`
> (default), `Add to stack`, or `Copy AND add to stack`. Shift always does the
> opposite action. Selecting a **Quick Kit** copies the fully composed note
> from all of its blocks. Quick copies (`Ctrl/⌘ K` or the `⧉` button in the
> library) copy a template's **Work notes** — use the preview panel's dedicated
> buttons for Short description and Description. All variables are filled from
> the current Ticket context first, so `{{ticket}}` and `{{kb}}` are ready.

### Built-in variables

`{{ticket}}` `{{caller}}` `{{phone}}` `{{shortdesc}}` `{{kbnum}}` `{{date}}`
`{{time}}` `{{datetime}}` `{{agent}}` `{{kb}}` (comma-separated KB numbers,
library + quick-entry) `{{kblist}}` (full KB block). KB line formats
additionally accept `{{number}}` `{{title}}` `{{url}}` `{{notes}}`.

`{{phone}}` comes from the **Phone / contact number** field in Ticket context.
It's optional — if a template doesn't use it, just leave the field blank. Use
`{{phone|N/A}}` when you want an explicit fallback in a template that does use
it. Add it to any template with the `+ {{phone}}` chip in the editor.

---

## Run locally

No build step, no dependencies — it's plain HTML/CSS/ES modules.

```bash
cd stacknote
python3 -m http.server 8080
# open http://localhost:8080
```

A local HTTP server is needed because ES modules and service workers don't work
from `file://`.

---

## Deploy

### Vercel (HTTPS out of the box)

```bash
npm i -g vercel
vercel login
vercel --prod
```

`vercel.json` adds security headers and makes sure `sw.js` / `index.html` are
never cached stale. Vercel serves the site over HTTPS automatically, which is
what makes the PWA installable and the clipboard API available at work.

### GitHub

```bash
git init && git add . && git commit -m "StackNote: ServiceNow note builder PWA"
gh repo create stacknote --public --source=. --push
```

Connecting the GitHub repo to Vercel gives automatic deploys on every push.

---

## Optional: Supabase cross-device sync

Not required — the app is fully functional without it. Enable it only if you
want your libraries shared between, say, your work PC and your phone.

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run [`supabase/schema.sql`](supabase/schema.sql)
   (also available in-app under **Settings → Cloud sync → Show SQL**).
3. In StackNote → **Settings → Cloud sync**, paste:
   - **Project URL** (e.g. `https://xxxxx.supabase.co`)
   - **anon / public key** (Project Settings → API)
   - a long random **workspace code** (e.g. `desk-9f3a-71bd-…`) — use the
     same code on every device you want to share.
4. Press **Test**, then **Push** from the device with the good data and
   **Pull** on the others.

Synced: templates, KB articles, emails, kits, context/field values and
preferences. **Not** synced (kept local): copy history, the in-progress stack,
and the Supabase credentials themselves.

> ⚠️ **Security note:** Supabase anon keys are public by design, and the
> included RLS policy allows anon access so the app works without a login.
> The workspace code acts as a shared secret — use a long random one and do
> **not** store confidential information in templates. For a hardened setup,
> enable Supabase Auth and replace the policy with `auth.uid()`-scoped policies.

---

## Privacy

No analytics, no tracking, no external requests (no fonts, CDNs or SDKs). The
only network calls are to Vercel for the app files and — only if you configure
it — your own Supabase project. Everything else stays in this browser. Use
**Settings → Your data → Export backup** to keep a JSON copy.

---

## Files

```
index.html                 app shell
styles.css                 theme + responsive layout
js/data.js                 state, persistence, starter content
js/core.js                 variables, composition, clipboard, Supabase REST
js/app.js                  UI, interactions, shortcuts, PWA wiring
manifest.webmanifest       PWA manifest
sw.js                      offline service worker
icons/                     generated PNG icons (192 / 512 / maskable / Apple)
tools/generate-icons.py    regenerate icons (Python stdlib only)
supabase/schema.sql        optional sync table + policy
vercel.json                deployment headers
```

Starter templates, KB articles, emails and kits are examples — edit or delete
them freely in the **Library** tab.
