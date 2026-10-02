# invita

**Online RSVP & digital invitations in Lao, Thai and English.**
A guest opens a link, taps *Attending* or *Not attending*, and they're done — no
account, no sign-up. The host watches the answers arrive on a live dashboard.

Blue-and-white, mobile-first, built with Next.js, Tailwind CSS and Supabase.

> This repository is the **foundation**: the complete database, the guest
> invitation page with the interactive RSVP form, and the host dashboard summary,
> all running on mock data so you can see and touch everything before wiring a
> backend. [Where each feature stands](#what-works-today-and-what-is-still-mock)
> is listed below, and [Next steps](#next-steps-step-by-step) takes you from
> here to a live product.

---

## Contents

1. [Quick start](#quick-start)
2. [What to click](#what-to-click)
3. [What works today, and what is still mock](#what-works-today-and-what-is-still-mock)
4. [Project layout](#project-layout)
5. [Languages](#languages)
6. [The database](#the-database)
7. [Next steps (step by step)](#next-steps-step-by-step)
8. [How this was verified](#how-this-was-verified)

---

## Quick start

You need **Node.js 20.9 or newer** (use the current LTS). Node must include full
ICU data (every official build does) so Lao and Thai dates format correctly on
the server.

```bash
npm install
cp .env.example .env.local     # the defaults are enough for the mock demo
npm run dev
```

Open <http://localhost:3000>. You land on the Lao version of the site; the
language switcher in the top bar changes to Thai or English and remembers the
choice.

Other scripts: `npm run build`, `npm start`, `npm run typecheck`.

> **Next.js 15 or older?** The file `src/proxy.ts` is called `src/middleware.ts`
> before Next.js 16. Rename it; nothing else changes.

## What to click

| URL | What you see |
| --- | --- |
| `/lo`, `/th`, `/en` | Landing page |
| `/en/i/sample?g=demo-guest` | **A guest's personal link.** Greets "Somchai Vongsa" by name and unlocks the RSVP form. Tap *Attending*, watch the answer save instantly, then optionally add party size, the host's custom questions and a message. |
| `/en/i/sample` | The same invitation **without** a personal link. This sample event is invite-only, so the form is locked and explains why. |
| `/en/dashboard` | **Host dashboard.** Total invited / attending / declined / pending, response rate, headcount, a status bar, a breakdown by group (VIP, Family, Friends, Colleagues) and the latest replies. Press **Simulate an RSVP** (or turn on **Auto**) to watch every number and bar update live. |
| `/en/i/sample` → *Add to calendar* | Google Calendar opens a pre-filled event; Apple Calendar downloads a `.ics` file from `/api/ics/sample`. |

Replace `en` with `th` or `lo` on any URL.

## What works today, and what is still mock

| Feature | State |
| --- | --- |
| Three languages + switcher, Lao/Thai typography, date formatting | **Working** |
| 1-tap RSVP, then optional details; party size; custom questions with required-field checks | **Working** (answers are held in memory; no backend yet) |
| Personal links, invite-only vs open-link behaviour | **Working in the UI**; enforced by the database functions (see below) once connected |
| Google Maps directions + embedded map | **Working** (set `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY` for the official embed) |
| Add to Google Calendar / Apple Calendar | **Working** |
| Hero image, background-music toggle, video teaser | **Working** (media URLs are mock; Storage bucket and policies are in `0002_storage.sql`) |
| Dashboard: stats, status bar, group table, recent responses, live updates | **Working on mock data**; the Supabase Realtime swap-in is written out in `src/hooks/useGuestsLive.ts` |
| Database schema, row-level security, RPC functions, outbox, reminders | **Written and tested** against PostgreSQL 16 (see [How this was verified](#how-this-was-verified)); not yet connected to the app |
| Host sign-in | Not built (Supabase Auth, Step 1) |
| Password-gate screen for protected invitations | Not built. The database already enforces it (`get_public_invitation` returns `password_required` / `password_invalid`); the screen is Step 2 |
| Guest list add/edit/delete, CSV/Excel export, questionnaire builder | Not built (Step 3). Tables, groups and questions exist |
| E-mail/SMS sending (SendGrid/Twilio) | Not built (Step 4). The queue, reminder rules and broadcast functions exist |
| Host editor for hero/music/video upload | Not built (Step 5) |

## Project layout

```
invita/
├─ messages/                 en.json · th.json · lo.json     every UI string
├─ src/
│  ├─ proxy.ts               locale detection / redirect (middleware.ts on Next ≤ 15)
│  ├─ i18n/                  locales, routing, request config, navigation helpers
│  ├─ app/
│  │  ├─ globals.css         Tailwind v4 theme: blue palette, fonts, Lao/Thai line-heights
│  │  ├─ [locale]/           landing · /i/[slug] invitation · /dashboard
│  │  └─ api/ics/[slug]/     .ics download for Apple/Outlook/Android calendars
│  ├─ components/
│  │  ├─ rsvp/               RsvpForm (the core), PartySizeStepper, QuestionField
│  │  ├─ invitation/         hero, details, schedule, map, music, video, add-to-calendar
│  │  ├─ dashboard/          SummaryDashboard + StatTile, StatusBar, GroupBreakdown, …
│  │  ├─ landing/ · ui/      landing page · logo, icons, shared Tailwind class strings
│  │  └─ LanguageSwitcher.tsx
│  ├─ hooks/                 useGuestsLive (mock → Realtime), useNow
│  └─ lib/                   types, validation, stats, calendar (iCal), maps, format,
│                            i18n-text, rsvp-service (mock → Server Action), mock-data
├─ supabase/
│  ├─ migrations/            0001_init.sql (schema + RLS + functions) · 0002_storage.sql
│  └─ tests/                 stubs.sql + smoke.sql (59 assertions, plain Postgres or Supabase)
└─ docs/ARCHITECTURE.md      stack rationale, data flow, security model, roadmap
```

Two seams are deliberately small so the mock can be replaced without touching
the UI:

* **`RsvpSubmitter`** (`src/lib/types.ts`). `<RsvpForm onSubmit={…}>` only depends on
  this function type. Today it is `submitRsvpMock`; later it is a Server Action.
* **`useGuestsLive`** keeps the same return shape whether the list is mock or
  streaming from Supabase Realtime.

## Languages

Lao (`lo`, the default), Thai (`th`) and English (`en`).

* Every visible string lives in `messages/<locale>.json`. The three files have
  identical keys and identical `{placeholders}`.
* **The Lao and Thai text was drafted by an AI assistant and needs review by
  native speakers** before launch, especially formal invitation phrasing.
* Content that hosts write (event title, venue, schedule, custom questions) is
  stored per language as `{ "lo": …, "th": …, "en": … }` and falls back
  to English when a language is empty (`src/lib/i18n-text.ts`).
* Thai and Lao are written without spaces between words, so layouts use
  `min-w-0` and `break-words` where text could otherwise overflow narrow phones,
  and `globals.css` gives both scripts taller line-heights than Latin text.
* Thai dates use the Buddhist-era year, as Thai readers expect.
* **Adding a language:** add its code to `src/i18n/config.ts`, copy
  `messages/en.json` to `messages/<code>.json`, translate, add its entry to
  `localeMeta` (native name, short label, Intl tag) in the same file, and add a font in
  `src/app/[locale]/layout.tsx` if the script needs one. The switcher picks the new
  language up automatically. Add the code to the `locale_code` enum in the database too.

## The database

`supabase/migrations/0001_init.sql` creates (all with row-level security on):

| Table | Purpose |
| --- | --- |
| `hosts` | One row per signed-in host (created automatically from `auth.users`) |
| `events` | An invitation: slug, languages, schedule, venue and coordinates, hero/music/video URLs, RSVP mode, deadline, party-size cap |
| `event_secrets` | bcrypt password hashes for protected invitations, in their own table with **no** client policies |
| `event_questions` | The host's custom RSVP questions (dietary, plus-one, licence plate, …) |
| `guest_groups` | VIP / Family / Friends / … for seating |
| `guests` | The guest list **and** each guest's RSVP, with a unique 24-character personal link token |
| `reminder_rules`, `broadcasts`, `message_log` | Scheduled reminders, mass messages, and the e-mail/SMS outbox |

Two views, `event_rsvp_stats` and `event_group_stats`, produce the dashboard
numbers. Guests never touch tables: the server calls `get_public_invitation()`
and `submit_rsvp()`, which are executable only by the `service_role`.

Apply it on a Supabase project (SQL editor, or the Supabase CLI):

```bash
supabase link --project-ref <your-ref>
supabase db push
```

Run the database checks on a local Supabase (`supabase start && supabase db reset`)
with `psql "$DATABASE_URL" -f supabase/tests/smoke.sql`, or against plain
PostgreSQL 15+ by first running `supabase/tests/stubs.sql` (see the header of that
file; never run the stubs on Supabase itself).

## Next steps (step by step)

Work through these in order; each one leaves the app in a working state.

### Step 1 — Connect Supabase and host sign-in

1. Create a Supabase project and apply the migrations (above).
2. `npm i @supabase/supabase-js @supabase/ssr`.
3. Fill in `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` and `INVITA_ACCESS_COOKIE_SECRET`
   (`openssl rand -hex 32`) in `.env.local`. The service-role key is
   **server-only**; never prefix it with `NEXT_PUBLIC_`.
4. Add `src/lib/supabase/{server,client,admin}.ts` (the standard `@supabase/ssr`
   helpers) and extend `src/proxy.ts` to refresh the session and redirect
   signed-out visitors away from `/<locale>/dashboard/**`.
5. Build a sign-in page (e-mail magic link is the lowest-friction option).
   The `hosts` row is created for you by a trigger.

### Step 2 — Make the invitation page and RSVP real

1. In `app/[locale]/i/[slug]/page.tsx`, replace `getSampleEvent` /
   `findDemoGuest` with a server call to `get_public_invitation(slug, token, password)`
   through the admin client.
2. Add a Server Action `submitRsvpAction` that runs `validateRsvpValues` and then
   calls `submit_rsvp(...)` (the exact call is sketched in `src/lib/rsvp-service.ts`).
   Pass it as `<RsvpForm onSubmit={submitRsvpAction} />`.
3. Build the password screen: when the function answers `password_required` or
   `password_invalid`, show a one-field form, and on success store the password in
   an httpOnly cookie signed with `INVITA_ACCESS_COOKIE_SECRET`.
4. Translate the codes `submit_rsvp` returns into the form's `RsvpResult` errors
   (`closed`, `invalid_token`, `invalid`, `missing_required`, `network`):
   `closed` → `closed`; `invalid_token` and `invite_only` → `invalid_token`;
   `invalid_party_size` and `invalid` → `invalid`; `missing_required` → `missing_required`
   (the form's own checks normally catch it first).
   `not_found` and `password` mean the page itself should not have rendered the form,
   so send the guest back to the invitation or the password screen. Anything the form
   does not recognise shows the generic "try again" message.

### Step 3 — Real dashboard and guest management

1. Replace the mock in `useGuestsLive` with the Realtime subscription written in
   the comment at the top of that file (the `guests` table is already in the
   `supabase_realtime` publication).
2. Guest list page: add/edit/delete guests, assign groups, copy each guest's
   personal link (`/<locale>/i/<slug>?g=<invite_token>`). Row-level security already
   scopes every query to the signed-in host.
3. Questionnaire builder: CRUD over `event_questions`.
4. CSV export is one server route that streams the guest list with answers as
   columns (prefix cells starting with `=`, `+`, `-` or `@` with `'` to prevent
   spreadsheet formula injection). Excel: either open the CSV with a UTF-8 BOM, which
   keeps Lao and Thai intact, or use `exceljs` for a real `.xlsx`.

### Step 4 — E-mail and SMS

1. Create SendGrid (with a verified sender) and Twilio accounts and fill the keys
   in `.env.local`.
2. A route handler under `app/api/cron/send/route.ts`, protected by `CRON_SECRET`,
   calls `claim_queued_messages(50)` (safe to run concurrently), sends each row via
   SendGrid or Twilio, and marks it `sent` or `failed`.
3. Schedule two cron jobs (Vercel Cron or Supabase `pg_cron`): `enqueue_due_reminders`
   then the send route, every few minutes. Both are idempotent.
4. "Mass broadcast" in the dashboard inserts a `broadcasts` row and calls
   `enqueue_broadcast`.
5. Before sending SMS to Lao or Thai numbers, check Twilio's country coverage and
   sender-ID rules for each; they vary and may need pre-registration.

### Step 5 — Host customization and media

1. Event editor: titles, schedule, venue (with coordinates for exact directions),
   languages, RSVP mode, deadline, party-size cap.
2. Uploads to the `event-media` bucket using the `<host_id>/<event_id>/<file>` path
   convention the Storage policies enforce. Resize hero images on upload.
3. Short-link or QR code for sharing.

### Step 6 — Launch checklist

* Deploy to Vercel; set every variable from `.env.example` there.
* Have native speakers review the Lao and Thai copy.
* Verify on real phones (Lao script rendering varies by OS and font).
* Add rate limiting on the RSVP route and the password screen.
* Add a privacy notice: guests' names, phone numbers and answers are personal data.
* Back up the database and rehearse restoring it.

## How this was verified

Honest scope, so you know what to trust and what to check:

* **Database**: the migrations were applied to a throwaway PostgreSQL 16 server
  with Supabase-style stand-ins for the `auth` and `storage` schemas, and
  `supabase/tests/smoke.sql` passed all 59 assertions (host isolation by RLS,
  personal-link and invite-only rules, password gate, deadline, party-size cap,
  required answers, stats views, broadcast/reminder idempotency, outbox claiming,
  storage policies). It has not been run on a real Supabase project.
* **UI**: the components were rendered with real React server rendering and the
  real Tailwind 4 compiler in headless Chromium, using the real message files, in
  all three languages: 122 checks passed (hydration, RSVP flow and validation,
  keyboard focus, calendar and map links, dashboard maths and live updates,
  tooltips on hover and keyboard focus, no horizontal scroll at 320, 390 and
  768 px, no missing translation keys).
* **Not run**: `npm install`, `next build` and the project's own `tsc` were not
  possible in the environment this was built in (the npm registry was not
  reachable), so the page shell around the components (`layout.tsx`, `proxy.ts`,
  fonts) and the exact dependency versions in `package.json` are untested. The
  first `npm install && npm run build` on your machine is the real test; expect to
  fix small version or typing details. A loose type-check of the source, with `next`
  and `next-intl` stubbed to their documented signatures, found no real errors.
* **Not verifiable here**: how Lao script looks in the fonts on your devices, and
  the quality of the Lao/Thai wording.
