---
type: roadmap
created: 2026-10-20
updated: 2026-10-25
---

# Roadmap

## Milestones

Derived from implementation plan `daily-task-planner` v1 and ADR 0001 (accepted).
All seven complete on 2026-10-21.

Prerequisites, both satisfied as stated: the tracking plan (`docs/metrics/daily-task-planner_tracking_plan.md`)
was written before M1 so instrumentation landed with each transition rather than
after, and the repository was initialized with a `.gitignore` covering `.venv`,
`node_modules`, `__pycache__`, `.env`, and `.DS_Store` before any scaffolding existed.

The second prerequisite was met and still proved insufficient. That list
enumerates the artifacts anticipated at the time, and `frontend/.pnpm-store`
was not among them, so 122 MB entered history during M5 and was only removed on
2026-10-21. Recorded here because the prerequisite reads as a guarantee and is
not one: see `docs/fixes/fix_plan_pnpm-store-committed-to-history.md`.

- [x] **M1: Foundations.** Docker Compose, uv on Python 3.13, Alembic baseline,
      Google OAuth with `calendar.freebusy`, Fernet-encrypted tokens, session
      cookie, materialized logical days with DST-correct arithmetic, preference
      blocks, the event writer and its append-only trigger.
- [x] **M2: Task core.** CRUD, the 4-primary cap with remedies, completed-task
      immutability enforced by trigger, reversal only before close, carry-forward
      with precedence, lazy idempotent close.
- [x] **M3: Assistant and estimation.** 15-minute buckets on `claude-haiku-4-5`,
      inline attempt plus in-process sweeper, per-user cache, confirmable chat
      proposals on `claude-opus-5`.
- [x] **M4: Capacity and scoring.** `freebusy.query` with window clipping and
      interval merging, snapshot reuse on failure, net capacity, the at-risk flag,
      the 75% verdict with the 2-primary neutral floor.
- [x] **M5: Surfaces.** Dashboard, collapsible chat, manual add, drag reorder,
      hand-built two-view heatmap, settings.
- [x] **M6: Metrics verification and aggregates.** `daily_metrics`, cost rollup
      from real token counts, event coverage verified transition by transition.
- [x] **M7: Production container parity.** The runtime image was built and
      smoke-tested at every milestone boundary and is green.

**Deferred to v2 by ADR 0001:** remote hosting (Cloud Run plus managed Postgres is
the indicated path, since a GCP project is already mandatory for OAuth), CI, error
reporting, push-based calendar sync, and any background worker or Redis.

## Feature Checklist

- [x] daily-task-planner: Daily commitment planner with 4-task cap, 75% success rule, user-defined logical day, and read-only Google Calendar capacity input (plan: v1, status: in_progress)
- [ ] provisional-day-signal: Live on-track or behind state for the day in progress in the history heatmap, additive to the persisted verdict (plan: v1, status: draft)
- [x] timeline-window-drag: Drag and resize the dashed preference block window directly on the day timeline, snapping to wall-clock half hours and to block edges, magnetically kept clear of existing blocks (plan: v1, status: approved)
- [x] interface-overhaul: Restructure the web interface into Today, History and Settings behind a persistent navbar, rebuilt on an explicit design token layer, adding task start, day detail and history statistics (plan: v1, status: approved)

**product-website is deliberately not a row here.** It was built on 2026-10-24
with no plan, so it has no version and no status from the lifecycle enum, and a
row reading `(plan: none, status: unplanned)` would not parse under the format
CLAUDE.md fixes for the future Linear sync. Inventing a `v1` that no file backs
would be worse. It is carried in full under Unplanned Work instead, which is the
section for work that skipped planning rather than drifted from it.

timeline-window-drag is ticked as of 2026-10-23: both manual gates pass, the
changelog carries an entry, and the plan reads `approved`. It is **not** `shipped`,
and the distinction is real rather than bookkeeping. Nothing is deployed anywhere;
ADR 0001 defers hosting to v2, so the application runs on one machine. The release
checklist (`docs/releases/timeline-window-drag_release_checklist.md`) sits at
`ready` for the same reason, and names the one readiness gap: no tracking plan
exists for this feature, so nothing measures whether direct manipulation actually
made block setup faster. metrics-mode owns that.

Plan status stays `in_progress` rather than `shipped`: release-mode sets `shipped`
at ship time, and nothing has shipped, because deployment is deliberately out of
v1 scope. The implementation is complete.

interface-overhaul is ticked as of 2026-10-23. All four delivery phases are
implemented and green: `pnpm lint` clean, 316 frontend tests across 13 files
(up from 158 across 6), 214 backend tests (up from 208), and a production build
that succeeds. Those counts are as measured on 2026-10-23; the suite now stands
at 324 across 14 files and 220 backend tests, re-measured 2026-10-24. The plan
reads `approved`, ADR 0003 is accepted, plan §12 carries 27 acceptance criteria
and 44 test definitions, and `docs/features/interface-overhaul_doc.md` describes
the result.

It is **not** `shipped`, for the same reason timeline-window-drag is not:
nothing is deployed anywhere, ADR 0001 defers hosting to v2, and release-mode
sets `shipped` at ship time. No release checklist has been written for it.

**Gates.** Flows 18 and 19 were run manually and reported passing by the user.
Flows 20 to 22 were exercised directly in the running application at desktop and
mobile widths, which found three defects that the automated suite could not: the
anchor date rendered as the raw string `2026-10-23` in the recessed label style,
a running task reading `0m in`, and an in-progress tint too quiet to answer
"which one am I on". Four steps across Flows 20 and 21 are covered by automated
test but were not exercised live, at the user's decision: the four-primary
remedy, the at-risk dot, completing a started task, and drag reordering. The
assistant path (Flow 21.6 to 21.8) was deliberately not run, because it bills the
real model. Most of Flow 22 cannot be run by anyone yet: no day has ever been
scored, so the streak, the rolling rate and a populated day detail have no data
to show.

**Two defects were closed that nothing had reported**, both invisible to the
previous suite because no test asserted a colour. Dark mode defined four of
seven colour roles, leaving `success`, `failure` and `risk` at values chosen for
light paper. And the palette failed WCAG AA in *both* schemes: `muted` sat at
3.11:1 on light paper while being the most frequent class in the application,
and `risk` at 2.79:1, below even the 3:1 graphic threshold.

**Four more were found by `doc-crawler` after every phase gate had passed**, and
each now has a regression test. The rolling 7-day figure counted the grid's
forward padding, so it held one real day on a Sunday and seven only on a
Saturday. `formatAnchorDate` rendered `/history/2026-13-45` as a confident
"Sunday, February 14", because `Number("")` is 0 rather than NaN and `new Date`
rolls out-of-range parts over. Today rendered a loading state forever on any
failure that was not a 409. And History and Settings had no loading or error
state at all, while a test named "every screen has a designed loading, empty and
error state" asserted only Today's. That last one is the clearest case in this
change set of a test title outrunning its coverage.

**One scope reversal, recorded rather than absorbed.** `package.json` gained
three development dependencies (`jsdom`, `@testing-library/react`,
`@testing-library/user-event`). The runtime manifest is byte-identical. This
document cites "`package.json` is unchanged" as a success twice above, in
narration about `timeline-window-drag`, where it was true; from 2026-10-23 only
the runtime half of that claim holds, and future documents should say so. ADR
0002's deferral of a DOM test harness is withdrawn on the condition ADR 0002 set
for itself. ADR 0002 is not superseded.

**The load-bearing premise is still unverified.** This work built before
measuring, justified on the user's statement that the interface suppressed the
daily use that validation depends on. Nothing here tests that. It is cheap to
check once days accumulate, because the north star is already instrumented.

## Fixes

- [x] stale-block-snapshot: Preference block edits did not reach the day in progress, so the "set up a work block" nudge survived the user acting on it (fix: high, status: verified)
- [x] heatmap-utc-date-shift: The history grid was labelled in UTC while cells are keyed by anchor dates in the user's timezone, so every label ran a day early (fix: high, status: verified)
- [x] tests-wipe-production-database: The suite dropped the schema of whatever DATABASE_URL named, and the api container names production, so running it destroyed all application data (fix: critical, status: verified)
- [x] signout-leaves-page-frozen: queryClient.clear() orphaned the mounted observers on stale success, so signing out left the dashboard on screen until a manual reload (fix: high, status: verified)
- [x] time-inputs-show-12-hour-clock: The three Settings time fields rendered a 12-hour clock with AM/PM, because `<input type="time">` takes its format from the browser locale and cannot be constrained; replaced with a custom 24-hour ClockInput (fix: low, status: verified)
- [x] pnpm-store-committed-to-history: The compose web service wrote pnpm's package store onto the host bind mount and nothing ignored it, so 122 MB and 7,863 files entered git history, 98.1% of the repository by size (fix: medium, status: verified)
- [x] block-edits-leave-stale-ui: A preference block edit left the Settings list and the day timeline showing a day shape that no longer existed, and a failed delete looked identical to one that succeeded (fix: high, status: verified)
- [ ] repeat-signin-shows-account-picker-twice: Treating a missing refresh token as fatal sent every returning user through a second authorization leg, so signing in after signing out rendered the Google account picker twice (fix: medium, status: applied)

Seven of the eight fixes are verified. Flow 17, the manual gate on the clock
field, was run and reported passing on 2026-10-23, alongside Flow 16 for the
timeline drag.

`repeat-signin-shows-account-picker-twice` is `applied` rather than `verified`,
and the unticked box is deliberate. The code change is complete: 220 backend
tests pass, six of them new and the first automated coverage of
`/auth/google/login` and `/auth/google/callback` in the project, and four of the
six fail against the original source. But nothing automated can prove that
Google renders the account picker once, because that is Google's behaviour in a
real browser. The remaining gate is a live sign-out and sign-in by the user.
`block-edits-leave-stale-ui` was registered in this same pass, having been
applied and verified on 2026-10-24 before the roadmap was next written.

## Business Objective Coverage

- daily-task-planner: **Instrumented, not yet measured.** The objective is to
  validate that the 75% commitment contract changes behavior for a single user
  before investing in multi-user capability. All 31 events in the tracking plan are
  emitted, and `daily_metrics` rows are written at close, so the data needed for a
  verdict now exists. No verdict can be cited yet because no real days have been
  recorded. North star is the rolling 7-day success rate, guarded against
  commitment-shrinking by three anti-gaming guardrails. Review fires after **30
  scored days**, a usage threshold rather than a calendar date. `review_due` stays
  null until release-mode sets it.
- interface-overhaul: **Serves the objective indirectly, and is not separately
  measured.** Implemented 2026-10-23. It removes interface friction as a
  competing explanation for low usage. It carries no tracking plan and adds no
  events, by its own W4, so whether it worked will show up in the existing
  north star rather than in a figure of its own. One of its requirements does
  feed the existing plan: M7 wired `POST /tasks/{id}/start`, which is the only
  way `actual_minutes` is ever populated. Every pending task row now carries a
  start control, so the estimation-error indicator no longer measures a subset
  that is empty by construction. That **narrows, and does not close**, the first
  of the three Drift Notes under Next Up item 3: starting remains optional, so
  the subset can still be thin.

## Unplanned Work

**product-website, built 2026-10-24, revised 2026-10-25.** A product marketing
page at `site/index.html`: one self-contained static file with no build step, no
script and no network request, written to send a reader to the GitHub repository
to star and clone it. It carries the application's design tokens as literals so
the page and the app read as one object.

The revision removed three sections at the user's instruction: calendar and
privacy, the quickstart, and the account of what the project is not. The first
two duplicated `README.md` and `docs/`, and the third was not wanted on a product
page. The page now runs the rule, the logical day, the over-commitment signal,
the screens and the assistant, and points at the README for setup rather than
printing it.

The same pass corrected the hosting framing. The first draft was written as
though no hosted version could exist, reading ADR 0001's deferral as a property
of the software. It is a decision about this project's own hosting: Doer is
self-hostable, and the page now says so. That distinction is worth holding, since
the earlier wording appeared in this document too and is corrected here with it.

interview-mode was recommended once and declined in favour of building directly,
so no plan exists and none was retrofitted. The consequence is that the audience
and messaging decisions behind the copy are recorded nowhere, and a rewrite would
restart from scratch. `docs/features/product-website_doc.md` records what was
built; it does not record why those choices were made.

No frontmatter carries `unplanned: true`, because no plan file exists to carry
it. This entry is the only record, which is the gap in the convention worth
knowing: the field tracks planned work that drifted, not work that skipped
planning entirely.

Three follow-ups it created, all listed in Next Up: the repository is still
private so every call to action is dead, the token copy has no test behind it,
and the page restates product constants that cannot notice when they move.

Two exclusions worth stating, so the empty list is not read as a claim that
nothing happened. Defect work is tracked under Fixes above, not here. And by
agreement on 2026-10-21, layout-only fixes (no behavior change, no contract
change, no data-shape change) are applied without a fix plan, so they carry no
frontmatter and appear in neither section; commit `6e21e0a` is the first of
those. That SHA was `7d67df6` until the 2026-10-21 history rewrite re-pointed it.

## Scope and Document Corrections

Recorded here because each changed a commitment made in an earlier document.

1. **Carry-forward precedence (AC-21)** was added after implementation surfaced a
   direct collision between two Must requirements: carry-forward is unconditional,
   and a day holds at most four primaries.
2. **`calendar.freebusy` replaced `calendar.readonly`.** Least privilege, and
   titles never reach the server. It also means the calendar list cannot be
   enumerated, so v1 reads the primary calendar only.
3. **The OAuth publishing status was wrong in ADR 0001 as first written.** Testing
   mode with an External user type expires refresh tokens after 7 days.
4. **Six backend and two frontend dependencies** were specified and proved
   unnecessary. Removed from the manifests rather than left as aspiration.
5. **The API runs on port 8787**, not 8000, which was occupied on the development
   machine.
6. **AC-13 freezes the day shape, not the preference blocks.** Plan line 54 defines
   day shape as start time and duration; the implementation generalized the freeze
   to cover blocks as well, which made the dashboard's own nudge unactionable until
   the next day. Corrected by `docs/fixes/fix_plan_stale-block-snapshot.md`. AC-13's
   wording is worth tightening if plan v2 is ever written.
7. **The test suite never had its own database.** Plan §11 line 279 states that
   the suite "creates and migrates its own `doer_test` database and never touches
   the development one", and `docs/doer/DOCUMENTATION.md` repeated it. Neither was
   true: nothing created that database and nothing confined the suite to it, which
   is how the 2026-10-21 data loss happened. The property is now enforced by two
   assertions in `backend/tests/conftest.py`, so the separation is guarded rather
   than designed in. Plan v1 is left as written, being the record of what was
   planned; `DOCUMENTATION.md` is corrected.
8. **Development runs more than three compose services.** `README.md` and
   `docs/adr/0001-local-first-fastapi-monolith.md` both describe db, api and web.
   An always-on `backup` service and a profile-gated `tests` service now exist.
   The README is corrected; the ADR is left as written, since ADRs record the
   decision of their time.

9. **ADR 0003 records four decisions the implementation did not follow.** The ADR
   is left as written, as ADR 0001 and plan v1 were, because an ADR records the
   decision of its time; the divergences belong here. (a) §3 specifies a token
   layer in three tiers, primitives, semantic and component; `index.css` is one
   flat `@theme` block in which every token is semantic. (b) §3 specifies that
   `keys.tasks` becomes `["tasks", anchor]`; it did not, and `hooks.ts` keeps
   `keys.tasks` as `["tasks","current"]` with `keys.tasksAt(anchor)` beside it,
   which `interface-overhaul_doc.md` §4 describes correctly, so the two documents
   disagree with each other. (c) §4 flags that `Settings.tsx` has a second
   data-access pattern and says P4 should resolve it or leave it deliberately,
   "not discovered"; all four phases are complete, the divergence is unresolved,
   and the block-edit fix extended the pattern rather than retiring it. (d) §4
   says `day_timeline.test.tsx` and `clock_input.test.tsx` should be rewritten
   against the DOM harness; both still run in the node environment against
   `renderToStaticMarkup`, and `day_timeline.test.tsx` still carries the comment
   "ADR 0002 declined a DOM test harness", which ADR 0003 withdrew.
10. **AC-IO-07 is written as a stronger claim than the test enforces.** It reads
   "No component hard-codes a color, size, radius or shadow". Colour is enforced
   and holds. Five arbitrary-value sizes remain in `Nav`, `DayHeader` and
   `Heatmap`, and `tokens.test.ts` forbids four colour patterns and no size
   pattern. Plan v1 is left as written, being the record of what was planned;
   `interface-overhaul_doc.md` and `CHANGELOG.md` are corrected.
11. **Four test IDs defined in the interface-overhaul plan are cited by no test.**
   T-IO-24 (a drag whose drop target is in another preference group is ignored),
   T-IO-38 (`colorFor` keeps all 12 assertions after the move: the 12 cases exist
   in `heatmap.test.ts` but cite `T-HEAT-01` to `04`), and T-IO-43 and T-IO-44,
   which are defined as the rewritten DOM-harness versions of the two node-env
   test files and so could not exist while 9(d) stands. The reverse direction is
   clean: every AC-IO and T-IO cited in code exists in the plan.
12. **A second test title outruns its assertion.** `polish.test.tsx` still names a
   block "the bottom band is one token, not four agreeing numbers (D4)" while the
   block asserts three tokens and the relation between two of them. The
   documentation was corrected to three tokens on 2026-10-24; the test title was
   not. This is the same failure mode as the loading-state test recorded above,
   and it is now a pattern rather than an incident.
13. **`README.md` stated the scoring rule as "finish at least 3 of them".** The
   rule is a 75% ratio with a two-primary floor, so three of four is one point on
   it. Corrected 2026-10-24.
14. **`docs/features/daily-task-planner_doc.md` understated the refusal surface.**
   It said four refusals are raised through `rule_error`; there are six. Its
   example JSON also did not match the string the code emits, differing in case
   and in the remedy wording, which matters because a client matches on it.
   Corrected 2026-10-24.

## Documentation sweep, 2026-10-24

A full reconciliation of every document under `docs/`, plus `README.md` and
`.env.example`, against the code. Run as documentation-mode with two
`doc-crawler` passes, one per half of the codebase, then this roadmap pass.

**Ownership lines crossed, recorded rather than quietly taken.** documentation-mode
owns only `docs/doer/DOCUMENTATION.md` and `docs/features/`. The user asked for
all documents, so four files outside that row were edited for factual content
only: `README.md` (no owner), `docs/releases/CHANGELOG.md` (release-mode),
`docs/setup/gcp_setup.md` (no owner), and `docs/user_testing_documentation.md`
(qa-mode, where the existing blanket amendment was extended rather than any flow
or gate being rewritten). `.env.example` was also corrected. **No lifecycle state
was touched by the sweep**: no `status`, no `review_due`, no checkbox recording a
verification event, and no plan or ADR body.

**Two frontmatter states look wrong and are deliberately left alone.**
`implementation_plan_interface-overhaul_1.md` reads `approved` while the feature
is built, and `fix_plan_repeat-signin-shows-account-picker-twice.md` reads
`applied` rather than `verified`. Both are correct as they stand, for the reasons
recorded above and at item 20. A sweep must not convert either.

**What the crawlers found that nothing had reported.** Three new defects, now
Drift Notes 7, 8 and 10 and items 22 to 24 below. Five wrong rows in the backend
cross-module map, two in the frontend one, and a claim that one component could
not be rendered outside a router when four cannot. A structure tree missing
`main.tsx`, which is where the global query defaults live. And the counted
assertions: twelve `recompute_capacity` call sites rather than eleven, six
`rule_error` sites rather than four, five DOM test files rather than four, 324
tests across 14 files rather than 316 across 13.

**What was added rather than corrected.** `docs/doer/DOCUMENTATION.md` gained a
section 6 describing the nine tables and the shape of the route surface. Neither
contract was documented anywhere in that file, and they are the two most exposed
to drift. The per-route table stays in the feature doc and is not duplicated.

## Verification

Checked on 2026-10-21 rather than asserted:

- All 21 acceptance criteria (AC-01 to AC-21) have at least one automated test.
- All 76 named test cases (T-*) in plan §11.3 are implemented. 208 backend tests
  plus 74 frontend tests as of 2026-10-21, the last check of the day; 7 live tests
  excluded from the default run. Figures here have been stale twice in one day, so
  treat any count in a document as the date it carries, not as current.
- Re-measured 2026-10-24: **220 backend tests collected** by default with 7 live
  deselected, and **324 frontend tests across 14 files**, all passing. The backend
  figure was counted by collection rather than by running the suite, which is the
  safe way to count it. The 76 T-* and 21 AC-* of plan v1, and the 44 T-IO-* and
  27 AC-IO-* of the overhaul plan, were re-counted from the plans themselves and
  all four figures are as previously recorded. Four T-IO ids are cited by no
  test: see correction 11.
- All 31 events in the tracking plan are emitted by the code.
- The runtime container builds and serves both the SPA and the API.

## Next Up

**One item is active and waiting on the user.** The fix for the double account
picker is applied and documented, and needs a live sign-out and sign-in to move
to `verified`. See item 20. Everything else below is the standing backlog.

**Five items were added by the 2026-10-24 documentation sweep**, numbered 22 to
26. Three are defects nothing had reported, one is the unowned README, and one is
the test change that would have caught most of what the sweep found by hand.

**interface-overhaul is complete and documented.**

The chain ran end to end on 2026-10-23: interview-mode, roadmap-mode,
architecture-mode (ADR 0003), qa-mode, four implementation phases each gated on
lint, tests and build, then documentation-mode and this pass. What remains for
this feature is listed as items 16 to 19 below.

**Five items were added by the product website**, numbered 27 to 31. Items 30
and 31 arrived with the 2026-10-25 revision. Item 27 is a blocker on the page
being useful at all, and item 30 is the same blocker grown sharper.

The numbered list below is the standing backlog and is otherwise unchanged.

1. **Use it.** Nothing further is needed to start recording days. The validation
   question is behavioral and cannot be answered by more building.
2. **Create the GCP project** when calendar-aware capacity is wanted; the app works
   without it, degraded to raw focus-block capacity. See `docs/setup/gcp_setup.md`.
3. **Eleven Drift Notes stand** in `docs/doer/DOCUMENTATION.md`, up from six
   earlier on 2026-10-24. Note 11 arrived with the product website and is item 27
   below. The count in this item read "nine" when the sweep wrote it while the
   document already held ten; both are now reconciled against the file. Carried over: `actual_minutes` covers only explicitly started
   tasks; a user row cannot be deleted once it has events; calendar busy time is
   un-subtracted by any task mutation until the next stale sync (the denominator
   there is now twelve call sites, not eleven); a pre-rewrite clone still holds
   122 MB on disk; there is no `.dockerignore`; and the `calendar_connected`
   series is not comparable across 2026-10-24. Added by the sweep: `POST /tasks`
   accepts an `anchor_date` it silently ignores; the runtime image would call an
   absolute `localhost:8787`; and "no component holds a literal" is true of
   colour only. One was closed: `.env.example` is now complete against `Settings`.
   The three new ones are items 22 to 24 below.
4. **provisional-day-signal, plan v1 is draft.** Architecture-mode next: the two
   open questions that decide the shape are how "substantially elapsed" is defined
   and whether `scheduled_primary` becomes live-when-open in the same change.
5. **timeline-window-drag is built, verified and in the changelog.** ADR 0002
   (accepted 2026-10-22) settles grid-plus-flush snapping, an unclipped overlay
   layer for the handles, pure geometry in `daytime.ts` with a humble component,
   and no DOM test harness. The survey behind it found plan v1's M1, M2 and M6
   mutually unsatisfiable whenever a block or a window is off the half-hour grid;
   those requirements were corrected in place, a clarification rather than a scope
   change, so the plan stays at v1.

   Implemented 2026-10-23 in `frontend/src/lib/daytime.ts`,
   `frontend/src/components/DayTimeline.tsx` and `frontend/src/pages/Settings.tsx`.
   The frontend suite went from 74 tests to 117: 33 new geometry cases and 10 new
   markup cases, with every pre-existing test unmodified. `pnpm lint` and the
   production build are green and `package.json` is unchanged, so ADR 0002's
   no-new-dependency decision held in practice. (The suite has since reached 158
   with the clock field fix; see item 6.)

   **Flow 16 passed**, run manually and reported by the user on 2026-10-23. ADR
   0002 named it the gate on the roughly 60 lines of pointer wiring that ship
   without automated coverage, so the feature is now verified end to end. All 28
   steps, including the phase-shifted day at 14:15.

   **Shipped as far as this project ships.** Commit `ecfcfc9`. release-mode ran on
   2026-10-23: the changelog carries Added, Changed and Fixed entries under
   `[Unreleased]`, the release checklist is written at `ready`, and the plan is
   `approved` at the user's instruction. `shipped` is deliberately not set, because
   there is no deployment for it to describe.

   **One gap remains, and it is a measurement gap rather than a quality one.**
   No tracking plan exists for this feature, so no event fires when anyone drags,
   resizes, or types a block time. The 31-event inventory is unchanged. The stated
   reason for building direct manipulation was that typing two clock strings is
   slow and error-prone, and nothing currently tests whether that is now false.
   metrics-mode owns it.

   **Two additions beyond the plan, both deliberate.**
   `frontend/src/__tests__/day_timeline.test.tsx` renders the component with
   `react-dom/server`, which needs no DOM and no new dependency, and asserts
   markup structure only: ARIA on both handles, three tab stops, the overlay
   passing pointer events through, and the read-only bar rendering unchanged with
   no handler passed. It does not test gestures and does not reopen the harness
   decision. Separately, `doc-crawler` found a real defect by executing the
   module: an edge drag could pass straight through a block when the window
   already straddled one, because such a block is neither entirely left of the
   window nor entirely right of it and the barrier fell back to the day's edge.
   Fixed, with three tests.

   **The `freeGaps` question is settled.** Dropped on the user's instruction,
   2026-10-23. `firstFreeGap` and its tests are untouched, which honours S5 more
   strongly than rewriting them would. ADR 0002 carries a dated withdrawal of the
   clause rather than a deletion, so the decision as accepted stays legible.

6. **time-inputs-show-12-hour-clock is verified.** The
   three Settings time fields rendered a 12-hour clock because
   `<input type="time">` takes its format from the browser's locale. Verified
   against engine source rather than assumed: Firefox never reads the `lang`
   attribute for this control, and release Chromium discards it behind a flag that
   ships with no status, which its own feature file defines as disabled
   everywhere. The CSS route to hiding AM/PM is Chromium-only and leaves the hour
   still cycling 1 to 12. Both apparent one-line fixes would have shipped and
   failed, which is why the analysis was worth doing before the code.

   The reported symptom was itself a misreading the control invited: `12:00 AM` is
   the display of the value `00:00`, so stepping to `01:00` was correct. No data
   was ever wrong, and every other time surface in the app already read 24-hour.

   Applied 2026-10-23 as `frontend/src/components/ClockInput.tsx` plus three call
   sites and new clock arithmetic in `daytime.ts`. The suite is at 158 tests
   across 6 files, lint and build green, `package.json` still unchanged.

   **Two decisions here were changed behaviour, not restored behaviour**, and are
   recorded as dated amendments to ADR 0002, `timeline-window-drag_doc.md` and the
   timeline plan rather than as edits, so a revert restores their original meaning:
   From and Until now accept only `:00` and `:30`, which closes one of the four
   routes to an off-grid time that ADR 0002 relied on; and Starts keeps free minute
   entry, because snapping it would make the phase-shifted grid unreachable through
   the interface and Flow 16.24 to 16.28 unrunnable.

   **Flow 17 passed**, all 18 steps, run manually and reported on 2026-10-23. The
   fix plan is `verified`.

   **Found by review, not by tests.** `doc-crawler` caught a regression introduced
   by the fix itself: `onCommit` fired before React had applied the value `settle()`
   had just emitted, so the end-of-day clamp evaluated against a stale time
   whenever the last keystroke left a pending digit. The settled value is now
   passed to `onCommit` directly. It also caught that arrow-stepping a snapped
   field by 30 from an off-grid seed never reached the grid (15:45, 16:15, 16:45),
   fixed by `stepToMultiple`, and an accessibility regression against the native
   control, fixed by giving each segment real spinbutton semantics under roving
   focus. Earlier in the same change, the first version of the control had no
   working pointer path to the minute segment at all.

   While here, every line number was dropped from ADR 0002 and only file names
   kept. Eight of its citations had drifted, and a document whose references
   cannot be trusted is worse than one that is less precise.

7. **Harden the test separation with a database role.** `doer` and `doer_test`
   share a cluster, a role and a password, so the suite is kept off production by
   two assertions rather than by permissions. A role with no rights on `doer` is
   the version that holds against a malformed URL or a future rewrite of the
   harness. Deferred deliberately in
   `docs/fixes/fix_plan_tests-wipe-production-database.md`.
8. **Closed on 2026-10-24 by the documentation sweep.** Both halves of this item
   are done. The changelog gap was larger than recorded here: not three fixes but
   all seven that carry a fix plan, plus the heatmap endpoint change, the whole
   interface overhaul, sign-out, task start and the `anchor` parameter. All are
   now under `[Unreleased]`. The `.env.example` and `gcp_setup.md` disagreement is
   settled in favour of `gcp_setup.md`: port 5432 is published and the compose
   `api` service overrides `DATABASE_URL` in its `environment:` block, which beats
   `env_file:`, so the value in `.env` is read only by host commands and `db` never
   resolves for them. `.env.example` now reads `localhost` and says why. See
   "Documentation sweep, 2026-10-24" below for the ownership lines this crossed.
9. **Tracking plan wanted for timeline-window-drag.** The feature is built,
   verified and in the changelog, and no event measures it. Block definition is on
   the critical path to the capacity model working at all, and the case for direct
   manipulation was that typing two clock strings is slow and error-prone. That
   claim is currently untested. metrics-mode owns it; named in the release
   checklist as the single unmet readiness item.
10. **Sign-out is unplanned and unmeasured.** Plan v1 §4 lists no requirement for
   session termination and AC-01 to AC-21 contain no criterion for it, so the
   control fills an unenumerated gap rather than satisfying a commitment. It also
   emits no event, where sign-in emits `user_signed_in`, so the tracking plan's
   31-event inventory is unchanged while a new user-facing transition exists.
   Worth a decision in metrics-mode rather than a silent asymmetry.
11. **Fix plan wanted for the Docker build context.** No `.dockerignore` exists, so
   the context carries roughly 264 MB of ignored-but-copied artifacts, and
   `Dockerfile:27` copies the host's darwin-arm64 `node_modules` over the linux
   install from line 26. The size half is cosmetic; the overlay half is a
   correctness question that no build has been run to settle. Declined as
   out-of-scope in `docs/fixes/fix_plan_pnpm-store-committed-to-history.md`.
12. **Closed on 2026-10-24.** `README.md` appears in no row of CLAUDE.md's file
   ownership table, so this item was waiting on a user decision. The user asking
   for all documents to be updated was taken as that decision. The index now
   reaches every directory under `docs/`, all three ADRs and all four plans; the
   Tests section names `cd frontend && pnpm test`; and the history-rewrite
   re-clone guidance has a section of its own rather than living only in
   `docs/doer/DOCUMENTATION.md`. One further correction was made while there: the
   opening line stated the rule as "finish at least 3 of them", which is one point
   on a curve rather than the rule. The code is a 75% ratio with a two-primary
   floor. **`README.md` still has no owner**, which is the part this item did not
   close.
13. **Fix plan wanted for the busy-subtraction wipe.** Nine of the eleven
   `recompute_capacity` call sites pass no `busy`, inflating a calendar-connected
   user's threshold after any task write. Found during the stale-block-snapshot
   analysis and deliberately left out of that fix's scope.
14. **Post-launch review** after 30 scored days: re-enter metrics-mode, answer the
   five questions in tracking plan §6 in order, and write the verdict back.
15. **release-mode** only if and when deployment is wanted. That is a v2 decision,
   and ADR 0001 names Cloud Run plus managed Postgres as the indicated path.
16. **The interface overhaul has no release checklist.** The changelog half of
   this item was closed on 2026-10-24: the `Surfaces` line no longer describes a
   dashboard and a collapsible chat, and the overhaul now has `Added` and
   `Changed` entries. The release checklist is still missing and release-mode
   still owns it. Note that writing one does not imply shipping: the
   timeline-window-drag checklist sits at `ready` precisely because there is
   nowhere to deploy.
17. **Four manual steps are covered by test but were never run live**, by the
   user's decision on 2026-10-23: the four-primary remedy, the at-risk dot,
   completing a started task, and drag reordering. The assistant path was
   deliberately skipped because it bills the real model. Most of Flow 22 is
   unrunnable until days have actually been scored.
18. **The heatmap has no month or weekday labels.** Twenty-six columns of
   squares with no axis is hard to read as a record, and the user named the
   heatmap a motivator and an analytics window. Found while verifying P3,
   deliberately not built because it is outside plan v1's scope. Needs a
   decision, and interview-mode if the answer is yes.
19. **Five Drift Notes stand in `docs/features/interface-overhaul_doc.md`**, all
   four of the originals re-verified against source on 2026-10-24 and still true:
   `vite.config.ts` is outside `tsconfig.json`'s `include` so its `test` block is
   not type-checked; `WEEKS = 26` is declared in `History.tsx` and `Heatmap.tsx`
   and the two must agree; the heatmap axis gap at item 18; and `lib/elapsed.ts`
   has no direct test. The fifth was added by the sweep: the token tests assert
   declaration rather than adoption for everything that is not a colour, so
   `--shadow-raised` and `--spacing-field` are declared, asserted and consumed by
   nothing, and a newly hard-coded size would fail no test.
20. **Verify the sign-in fix live.** Sign out, sign back in with a real Google
   account, and confirm one account picker, no consent screen, and a landing
   straight on the app. That is the only outstanding condition in
   `docs/fixes/fix_plan_repeat-signin-shows-account-picker-twice.md`, and no test
   can stand in for it. Two things to know while checking: the fix stops the
   refresh token rotating on every sign-in, which also stops it consuming Google's
   per-account token limit; and it changes when revocation is noticed, from
   sign-in to the next calendar read, so a grant revoked at Google now shows the
   degraded calendar state first and re-consents on the following sign-in.
21. **The `calendar_connected` series is not comparable across 2026-10-24.**
   Until the sign-in fix, the event fired on every repeat sign-in rather than only
   when a grant was established, so historical counts are inflated by an unknown
   amount. Recorded as Drift Note 6 in `docs/doer/DOCUMENTATION.md`. metrics-mode
   should decide whether the pre-fix window is discarded or annotated before the
   post-launch review reads it.
22. **Fix plan wanted: `POST /tasks` accepts an `anchor_date` it ignores.**
   `TaskCreate.anchor_date` is declared in `schemas/task.py` and so appears in the
   published OpenAPI schema, but the handler never reads it. The day always comes
   from `_resolve_day`, so a client posting it to backdate a task receives a 201
   and the task lands on today. Either wire it up or remove it; a documented
   parameter that silently does nothing is worse than either. Found by
   `doc-crawler` on 2026-10-24. Drift Note 7.
23. **Fix plan wanted: the runtime image would call an absolute `localhost:8787`.**
   `lib/api.ts` falls back to that origin when `VITE_API_BASE` is unset, the
   `web-build` stage sets no such variable, and `.env.example` does not carry it.
   Since the runtime container serves the SPA same-origin under `SERVE_STATIC=1`,
   the parity bundle would call a different origin than the one serving it. M7
   builds and smoke-tests that image at every milestone, so this has not bitten,
   but it means the deferred deployment is slightly more than configuration,
   which is the specific promise ADR 0001 made. Drift Note 8.
24. **Calendar freshness has no TTL, and one route skips close.**
   `calendar.is_stale` is true only when the snapshot predates `day.start_at`, so
   after a day's first successful sync nothing re-syncs automatically and only
   `POST /days/current/refresh-calendar` will. That route also omits the
   `close_elapsed_days` call that `GET /days/current` makes, so it can materialize
   today while yesterday sits unclosed. Both may well be intended; neither is
   written down, and the first interacts with item 13, since a task write wipes
   the busy subtraction that nothing will then restore until the next day. Needs a
   decision before a fix plan. Drift Note 10.
25. **`README.md` still has no owner.** Item 12's content gap is closed, but the
   structural question it raised is not: no row of CLAUDE.md's file ownership
   table names the repository's entry point, so it is updated only when somebody
   asks for it directly. Worth either adding it to documentation-mode's row or
   deciding deliberately that it stays unowned.
26. **Adopt-not-declare for the non-colour tokens.** `tokens.test.ts` forbids four
   colour patterns and checks that every other token is *declared*. Extending it
   to forbid arbitrary-value sizes would close Drift Note 9 and retire the five
   remaining literals, and would make AC-IO-07 true as written rather than true
   of colour only. Small, and it is the test that would have caught all of this.
27. **Make the repository public, or the website has no destination.** Seven links
    on `site/index.html` point at `github.com/amansharma2910/doer`, which returned
    404 to an anonymous request on 2026-10-24. Star and clone are the page's only
    two calls to action and both are dead until this changes. It is one setting,
    and it blocks everything the page is for. Drift Note 1 of
    `docs/features/product-website_doc.md`.
28. **Nothing enforces the website's copy of the design tokens.** Every colour,
    radius, shadow and type value in `site/index.html` is a literal taken from
    `frontend/src/index.css`, and all of them agree today, checked pair by pair.
    `tokens.test.ts` reads `../index.css?raw` and cannot see outside `frontend/`,
    `tsconfig.json` includes only `src`, and no script touches the file, so a
    token changed in one place and not the other fails nothing. `muted` owes
    4.5:1 and `risk-mark` owes 3:1, so the failure mode is a public page quietly
    below AA. The cheap version is a test that greps both files for the same
    literals; the thorough version is generating the page's `:root` block from
    `index.css`. Drift Note 11.
29. **The website restates product constants in prose.** Four of them as of
    2026-10-25: the four-slot cap, the 75% verdict, the two-primary floor and the
    four route paths, sourced from `backend/doer/models/task.py` and
    `frontend/src/App.tsx`. The port numbers were a fifth until the quickstart
    was removed, which severed the page's only coupling to `docker-compose.yml`.
    The first draft already got the headline rule wrong, stating it as "at least
    three", which is one point on the curve and the exact wording item 11 removed
    from `README.md`. It was caught by `doc-crawler` before anything was
    committed, which is the argument for keeping that crawl in the loop whenever
    the page changes.
30. **Removing the quickstart sharpened item 27 rather than shrinking it.** The
    page now carries no setup instructions and points at the README three times
    instead, across five links to a repository that is private. A reader who
    cannot reach it can no longer learn anything about running the project from
    the page. Making the repository public closes both items; nothing else does.
31. **Two claims on the website lost their disclosure.** The over-commitment
    section still figures capacity "minus the busy time on your calendar" and the
    assistant section still says both models run on your own Anthropic key. Each
    implies a third-party data flow, and the section stating what is actually
    read and sent went with the removals. Nothing on the page is false; what is
    gone is the context that made those sentences safe to read, and the page no
    longer mentions Google OAuth at all, so a reader cannot learn that sign-in
    needs a Google client or that the calendar is optional. A single line in the
    privacy register would close it without restoring a section. Drift Note 5 of
    `docs/features/product-website_doc.md`.
