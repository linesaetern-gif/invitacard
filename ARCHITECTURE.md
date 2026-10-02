# invita — architecture

This document explains **why** invita is built the way it is. For setup and the
step-by-step build-out, see the [README](../README.md).

1. [Goals that shaped the design](#1-goals-that-shaped-the-design)
2. [Tech stack and why](#2-tech-stack-and-why)
3. [System architecture](#3-system-architecture)
4. [Data model](#4-data-model)
5. [Security model](#5-security-model)
6. [Internationalisation (Lao · Thai · English)](#6-internationalisation-lao--thai--english)
7. [The RSVP form](#7-the-rsvp-form)
8. [The host dashboard](#8-the-host-dashboard)
9. [Mock → real: the seams](#9-mock--real-the-seams)
10. [Known limits and roadmap](#10-known-limits-and-roadmap)

---

## 1. Goals that shaped the design

* **A guest should need one tap.** No account, no password, no form before the
  answer. Anything optional comes *after* the answer is saved.
* **Phones first.** Most guests open a link from a chat app on a mid-range phone
  over mobile data. Pages are server-rendered, light on JavaScript, and tested
  down to 320 px wide.
* **Three languages as equals.** Lao and Thai are not an afterthought: their
  scripts affect fonts, line height, line breaking, date formats and layout.
* **Privacy by construction.** Invitation links are unguessable, guests cannot
  query tables at all, and password hashes sit where no client can read them.
* **One small team can run it.** Managed Postgres, managed auth, managed
  storage, one deployable web app.

## 2. Tech stack and why

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | **Next.js 16** (App Router) + React 19 + TypeScript (strict) | Server rendering gives fast first paint on slow phones and real HTML for link previews in chat apps. Server Components keep secrets and the service-role key on the server. Server Actions fit the "one tap submits" form. |
| Styling | **Tailwind CSS v4** | Utility classes make mobile-first responsive work quick; theme tokens (`@theme`) hold the blue palette, fonts and status colours in one CSS file. |
| i18n | **next-intl v4** | First-class App Router support, locale-prefixed routes (`/lo/…`, `/th/…`, `/en/…`), ICU message syntax (placeholders, plurals), typed `Link`/`useRouter` that keep the locale, and a proxy that detects the browser language. |
| Database | **Supabase (PostgreSQL)** | A relational model fits events → guests → answers → messages. Row Level Security gives per-host isolation in the database itself. SQL views and functions keep rules (deadline, party-size cap, invite-only) next to the data. |
| Auth | **Supabase Auth** (hosts only) | Hosts sign in (magic link / OAuth). Guests never sign in. |
| Realtime | **Supabase Realtime** (Postgres changes) | The dashboard subscribes to its event's `guests` rows; RLS decides what each host may receive. |
| Storage | **Supabase Storage** | Hero image, background music, video teaser, with per-host folder policies. |
| E-mail / SMS | **SendGrid / Twilio**, via an outbox table | Sending is slow and fails. A queue table plus a small worker keeps RSVP fast and makes retries and idempotency possible. |
| Hosting | **Vercel** (or any Node host) | Natural fit for Next.js; Vercel Cron triggers the message worker. |

**Why not Firebase?** It would work, but invita's questions are relational and
aggregate-heavy (counts by status and group, expected headcount, "everyone still
pending"). In Postgres those are one SQL view; in Firestore they need denormalised
counters or fan-out queries. Security rules for "guests can answer only their own
row, hosts see only their own events" are also easier to review and test as SQL
policies and functions than as rules scattered across collections.

**Why next-intl rather than rolling our own?** The hard parts are routing,
message formatting and keeping the locale across navigation, not looking up
strings. next-intl does those with little code, and keeps per-locale JSON files
that translators can edit without touching React.

## 3. System architecture

```
                         ┌───────────────────────────────────────────────┐
  Guest (phone)          │                Next.js app (Vercel)           │
  ───────────────        │                                               │
  /lo/i/<slug>?g=<tok> ─▶│  Server Component: page.tsx                   │
                         │    └─ get_public_invitation(slug,tok,pwd) ────┼──┐
  taps "Attending"     ─▶│  Server Action: submitRsvp                    │  │  service_role
                         │    └─ validate → submit_rsvp(...) ────────────┼──┤  (server only)
                         │                                               │  │
  Host (laptop/phone)    │  /<locale>/dashboard/**  (signed-in only)     │  ▼
  ───────────────        │    ├─ reads/writes tables under RLS ──────────┼─▶ ┌────────────────────────┐
  dashboard, guests,   ─▶│    └─ browser Realtime subscription ──────────┼─▶ │  Supabase              │
  exports, broadcasts    │                                               │   │  Postgres + RLS        │
                         │  /api/ics/<slug>   .ics calendar file         │   │  Auth · Storage        │
                         │  /api/cron/send    (secret-protected)  ◀──────┼─┐ │  Realtime              │
                         └───────────────────────────────────────────────┘ │ └──────────┬─────────────┘
                                          ▲  Vercel Cron / pg_cron ────────┘            │ message_log
                                          │                                             ▼ (outbox)
                                          └── claim_queued_messages() ── SendGrid (e-mail) · Twilio (SMS)
```

### 3.1 Guest opens an invitation

1. The link is `/<locale>/i/<slug>?g=<invite_token>`. The token is a random
   24-character string created by the database, unique per guest.
2. `page.tsx` (server) calls `get_public_invitation(slug, token, password)` with the
   service-role key. The function returns the event, its questions, and, if the
   token matches, that guest's name and current answer. It answers `not_found`,
   `password_required` or `password_invalid` when appropriate.
3. The page renders `InvitationView`. Dates are formatted on the server, with an
   explicit time zone, so server and browser always agree (no hydration mismatch).

### 3.2 Guest answers

1. Tapping *Attending* or *Not attending* calls the submitter with
   `{ status, enforceRequired: false }`. The answer is saved immediately.
2. The form then offers optional details. *Save details* calls the submitter again
   with `enforceRequired: true`, so the host's required questions are enforced
   only at that point.
3. `submit_rsvp()` re-checks everything on the server: event published, password,
   personal link required (invite-only) or allowed to create a guest (open link),
   deadline, party-size cap, answers match the questions. The client-side
   validation in `lib/validation.ts` is only for friendly, instant feedback.

### 3.3 Host watches the dashboard

1. The browser loads the guest list (RLS limits rows to the host's own events) and
   subscribes to changes on those rows.
2. Each change updates local state; `lib/stats.ts` recomputes totals, per-group
   counts, response rate and expected headcount with pure functions, so every tile,
   the bar and the table update together without a refetch.
3. The same numbers also exist as SQL views (`event_rsvp_stats`,
   `event_group_stats`) for exports, e-mailed summaries and tests.

### 3.4 Reminders and broadcasts (outbox pattern)

* A host schedules *"remind everyone still pending 3 days before"* (`reminder_rules`) or
  sends a one-off *broadcast*.
* `enqueue_due_reminders()` and `enqueue_broadcast()` insert one `message_log` row per
  recipient and channel, rendering the text in each guest's own language. Both are
  **idempotent**: running them twice does not send twice.
* A worker route calls `claim_queued_messages(n)` (uses `FOR UPDATE SKIP LOCKED`, so
  concurrent workers never take the same row), sends through SendGrid or Twilio, and
  marks the row `sent` or `failed` with the error.

## 4. Data model

```
auth.users 1──1 hosts 1──* events 1──* guests *──1 guest_groups
                             │  │         │
                             │  │         └─ answers (jsonb: question id → value)
                             │  ├──* event_questions
                             │  ├──1 event_secrets      (password hash, no client access)
                             │  ├──* reminder_rules
                             │  └──* broadcasts
                             └──* message_log (outbox: queued → sending → sent | failed)
```

Design decisions worth knowing:

* **The guest list *is* the RSVP list.** One row per guest, with `status`
  (`pending | attending | declined`), `party_size`, `message`, `answers` and
  `responded_at`. Fewer joins, and "pending" is simply "has not answered yet".
* **Localised content is JSON per language** (`title`, `description`, venue, schedule
  items, question labels), e.g. `{"lo": "…", "th": "…", "en": "…"}`, rather than a
  translations table. Hosts edit all languages on one screen, and the app falls back
  to English when a language is missing.
* **Custom questions are rows**, with a type (`text`, `textarea`, `select`,
  `checkbox`, `number`), options, and a required flag. Answers are stored as JSON keyed
  by question id, so adding a question never needs a migration.
* **Groups per event** (`guest_groups`) are seeded with VIP, Family, Friends and
  Colleagues, and the host can rename or add more for seating.
* **Password hashes** live in `event_secrets`, not on `events`, because RLS works per
  row, not per column: any policy that lets a host read their event would otherwise
  expose the hash column to the browser.
* **Roles.** Function access is revoked from everyone and then granted back narrowly.
  `get_public_invitation`, `submit_rsvp`, `enqueue_due_reminders` and
  `claim_queued_messages` are executable by `service_role` only. Signed-in hosts may
  call `set_event_password` and `enqueue_broadcast`, and both check that the caller owns
  the event. The `anon` role has no table or function access.

## 5. Security model

| Threat | Defence |
| --- | --- |
| Guessing someone's invitation link | 24-character random token per guest; a wrong token is treated as no token. |
| Strangers RSVPing to an invite-only event | `submit_rsvp` requires a valid token when `rsvp_mode = invite_only`. In `open` mode a new guest row is created. |
| Reading other hosts' data | RLS on every table; `is_event_host(event_id)` is the single ownership check. Tested with two hosts. |
| Guests reading tables or the password hash | Guests have no table access; the hash sits in `event_secrets` with RLS enabled and **no policies**. |
| Brute-forcing an invitation password | bcrypt (pgcrypto) hashes; add rate limiting on the password screen and RSVP route (see roadmap). |
| Service-role key leaking | Used only in server code; never prefixed `NEXT_PUBLIC_`. |
| Spam through the cron/worker endpoints | Protected by `CRON_SECRET`. |
| Calendar entries leaking a personal link | The Google/`.ics` entries carry the **public** page URL only, never a guest token. |
| Search engines indexing invitations | `robots: noindex, nofollow` on invitation and dashboard pages. |
| Spreadsheet formula injection in exports | Prefix cells starting with `= + - @` (see README, Step 3). |
| Uploads | Bucket limited to 50 MB and image/audio/video MIME types; write access only under the host's own `<host_id>/…` folder. |

The event-media bucket is **public-read** so `<img>`, `<audio>` and `<video>` just
work. For password-protected events whose media must also stay private, switch to a
private bucket and hand out short-lived signed URLs from the server.

A note on privacy: guest names, phone numbers, e-mail addresses and answers are
personal data. Publish a privacy notice, honour deletion requests, and collect only
what the event needs.

## 6. Internationalisation (Lao · Thai · English)

**Routing.** Every page lives under `/<locale>/…` (`localePrefix: 'always'`), which
makes every URL shareable in a specific language. The proxy detects the browser
language on first visit and remembers the choice. The default is Lao.

**Strings.** All UI text is in `messages/{lo,th,en}.json` with identical keys and
placeholders. A quick check script compares them, and the browser tests fail on any
missing key.

**Typography.**
* Fonts are loaded with `next/font/google`: Inter for Latin, **Noto Sans Lao** and
  **Noto Sans Thai** for those scripts. One font stack lists all three, so the browser
  uses each font only for the characters it covers, and a Thai name inside a Lao
  sentence still renders correctly.
* Lao and Thai have stacked vowel and tone marks, so `globals.css` raises the line
  heights of every text size when `<html lang>` is `lo` or `th`; otherwise marks collide
  with the line above.
* Numbers in tables use tabular figures; headline numbers do not.

**Line breaking.** Thai and Lao have no spaces between words, so where a line may
wrap depends on the browser's and operating system's dictionary support, and a long
unbroken run can push a narrow screen wider than the viewport. Containers therefore
use `min-w-0` and `break-words`, and grids use a single column on phones. Checked at
320 px in Chromium; check real Android and iOS devices too.

**Dates and numbers.**
* `Intl.DateTimeFormat` with the event's explicit time zone (Asia/Vientiane in the
  sample), so the guest sees the event's local time wherever they are.
* The Thai locale uses the **Buddhist-era year** (2569 instead of 2026), as Thai readers
  expect.
* Dates are formatted on the **server** and passed down as strings. Client components
  never call `Intl` for dates, so a browser that lacks Lao locale data cannot cause a
  server/client mismatch.
* Node must have full ICU (all official builds do); a "small-icu" build would silently
  fall back to English formatting.

**Host-written content.** Stored per language and chosen with `pickLocalized`, which
uses the guest's language and falls back to English when that text is empty. Make
English (or whichever language you treat as the base) mandatory in the event editor.

**Translation quality.** The Lao and Thai strings were drafted by an AI assistant.
Have native speakers review them, especially the invitation tone and the legal and
privacy wording.

## 7. The RSVP form

`components/rsvp/RsvpForm.tsx` is the heart of the guest experience.

* **Phases:** `choose` → `saving` → `done`. After the first tap the form shows a
  confirmation and a collapsed set of optional details.
* **Two buttons, one decision.** Large (≥ 44 px) *Attending* and *Not attending*
  buttons; the chosen one stays visibly selected, and the guest can change their mind
  until the deadline.
* **Details only when attending:** party size (stepper, capped by the guest's
  allowance) and the host's custom questions; a message to the host is always allowed.
* **Accessibility:** each field has a label and an error tied with `aria-describedby`;
  on a failed save, focus moves to the first invalid field; status changes are announced
  with `aria-live`.
* **Server is the judge.** The form validates for speed, but `submit_rsvp()` re-validates
  every rule.
* **Deadline text** is precomputed on the server and passed in, so it cannot differ
  between server and browser.

## 8. The host dashboard

**What it shows.** Total invited, attending, declined, pending (four KPI tiles); the
response rate as the single hero figure; a stacked status bar; a legend with counts;
expected headcount (sum of party sizes of those attending); a table by group; the
latest replies. A *Live* badge and a **Simulate an RSVP** button let you watch it react
before any backend exists.

**Choosing the form.** The question is "how does the whole guest list split into
three statuses?", a part-to-whole question, so it is a single stacked bar rather than
a pie or three separate bars. The same data also appears as the group table, so the
numbers are never available only as colour.

**Colour decisions.**
* Attending `#2563eb` (brand blue), declined `#475569` (slate), pending `#93c5fd`
  (pale blue, reads as "not filled in yet"). Colour follows the **status**, never its
  rank or size.
* The theme is blue and white, which limits how many clearly different hues exist. The
  palette validator flags the slate and pale-blue steps (they are grey and a tint rather
  than distinct hues). That is accepted because **colour is never the only carrier**:
  every segment has a legend entry with its count and percentage, a tooltip (on hover
  *and* keyboard focus), and a matching row in the table.

**Bar geometry.** 16 px thick, a square start and a 4 px rounded end, 2 px gaps between
segments, and a 24 px-tall interactive area so the tooltip is easy to hit on a phone.
Segments with a count of zero are not drawn.

**Motion.** The hero number fades in when it changes; users who prefer reduced motion
get no animation.

## 9. Mock → real: the seams

| Today (mock) | Replace with | Where |
| --- | --- | --- |
| `getSampleEvent`, `findDemoGuest` | `get_public_invitation()` via the server admin client | `app/[locale]/i/[slug]/page.tsx` |
| `submitRsvpMock` | A Server Action that validates and calls `submit_rsvp()` | `lib/rsvp-service.ts` (the exact call is written in the comment) |
| In-memory guest list + "Simulate" | Initial `select` + Realtime subscription | `hooks/useGuestsLive.ts` (written in the comment) |
| `createMockGuests` | Rows from `guests` joined to `guest_groups` | `components/dashboard/SummaryDashboard.tsx` |
| Pass-through `proxy.ts` | Refresh Supabase session; guard `/dashboard/**` | `src/proxy.ts` |

Realtime caveat: Postgres-changes events for `DELETE` carry less information than
inserts and updates and cannot always be filtered the same way. When the host deletes a
guest, refetch the list instead of relying on the event payload (check the current
Supabase Realtime documentation for the exact behaviour in your version).

## 10. Known limits and roadmap

**Known limits of this starter**

* Mock data only; nothing is persisted yet.
* No host sign-in, guest-management screens, questionnaire builder, export, password
  screen, media uploader or message worker (README Steps 1–5).
* The Lao/Thai copy is unreviewed. Lao script appearance on real devices is unchecked.
* Dependency versions in `package.json` are ranges chosen from knowledge of the
  ecosystem, not from a lockfile; the first `npm install` will produce one.

**Roadmap ideas**

* Seating-plan view driven by `guest_groups`; table assignments.
* QR codes and short links; per-guest "open" tracking (opt-in).
* Additional channels (LINE, WhatsApp) behind the same outbox.
* Plus-one names (not just a count) as a built-in question type.
* Event templates and a host-facing live preview of the invitation.
* Rate limiting and bot protection at the edge; audit log for host actions.
