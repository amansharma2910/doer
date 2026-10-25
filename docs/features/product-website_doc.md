# Product Website

Added 2026-10-24. One file, `site/index.html`, hosted anywhere that serves static
files. No plan preceded it: see the Unplanned Work section of `docs/roadmap.md`.

Revised 2026-10-25, when three sections were removed at the user's instruction:
the calendar and privacy section, the quickstart, and the account of what the
project is not. The first two duplicated `README.md` and `docs/`; the third was
not wanted on a product page. Self-hosting wording was corrected in the same
pass, because the page had been written as though no hosted version could exist,
where the real position is that Doer is self-hostable and simply is not hosted by
the author today.

## Drift Notes

1. **The design tokens are duplicated with nothing enforcing the copy.** Every
   colour, radius, shadow and type size on the page is a literal taken from
   `frontend/src/index.css`, in both schemes. All of them agree today, checked
   pair by pair. Nothing keeps them agreeing: `frontend/src/__tests__/tokens.test.ts`
   imports `../index.css?raw` and asserts against that file alone, `tsconfig.json`
   includes only `src`, and no script in `frontend/package.json` reaches outside
   `frontend/`. The page is covered by no lint, no type check, no test and no
   build. `muted` owes 4.5:1 and `risk-mark` owes 3:1, and a drifted copy of
   either fails silently on a public page. This is the first thing to check when
   a token changes.
2. **The page restates product rules that live in code.** The four-slot cap, the
   75% verdict, the two-primary floor and the four route paths are written out in
   prose. Their sources are `MAX_PRIMARIES`, `SUCCESS_RATIO` and
   `MIN_PRIMARIES_TO_SCORE` in `backend/doer/models/task.py` and the routes in
   `frontend/src/App.tsx`. Neither can notice the page. The port numbers were a
   fifth such constant until 2026-10-25; they left with the quickstart, which
   severed the only coupling the page had to `docker-compose.yml`.
3. **The GitHub repository is private as of 2026-10-24.** Five links on the page
   point at `github.com/amansharma2910/doer`, which returns 404 to anonymous
   visitors. Every call to action is dead until the repository is made public.
   The 2026-10-25 revision made this worse rather than smaller: removing the
   quickstart replaced on-page setup instructions with three pointers to the
   README, so a reader who cannot reach the repository can now learn nothing
   about running the project at all.
4. **No `og:image`.** Shared links unfurl without a preview image.
5. **Two claims lost their supporting context on 2026-10-25.** The over-commitment
   section still says capacity is figured "minus the busy time on your calendar",
   and the assistant section still says both models "run on your own Anthropic API
   key". Each implies a third-party data flow, and the section that disclosed what
   is actually read and sent (`freebusy` intervals only, titles never reaching the
   server) was removed. Nothing on the page is now false; what is gone is the
   disclosure that made the implication safe to read. The page also no longer
   mentions Google OAuth anywhere, so a reader cannot learn from it that signing in
   needs a Google client at all, or that the calendar is optional.

## 1. What it does

It is the public page for Doer, written for someone who has never seen the
project and whose next action is starring or cloning the repository. Those two
are the only calls to action on it.

It describes Doer as self-hosted: a Docker Compose stack the reader runs wherever
they put it, on their own machine or their own server, against their own
Postgres. That is a statement about how it is run, not a claim that hosting it is
impossible. The page carried the stronger framing until 2026-10-25 and no longer
does; do not reintroduce it, and note that ADR 0001's deferral of deployment is a
decision about this project's own hosting rather than a property of the software.

Its spine, in order: the rule, the logical day, the over-commitment signal, the
screens, and the assistant, closing on the two calls to action. Setup is not on
the page; it points at the README three times instead.

## 2. Implementation detail

**One file, no dependencies.** A single `<style>` block and static markup. No
script tag, no stylesheet link, no webfont, no image file. The favicon is an
inline `data:` SVG and every glyph is hand-drawn inline, matching the reasoning
in `frontend/src/components/icons.tsx`. It makes zero automatic network requests,
so it can be served from any host, including one with a restrictive CSP.

**The token layer is copied, not imported.** The page declares its own `:root`
block holding the literal values from `frontend/src/index.css`, plus the same
`@media (prefers-color-scheme: dark)` override, so it follows the application
into both schemes. Only the tokens the page actually draws with are carried over;
a copied value nothing renders would be drift surface with no symptom. The
`--color-` prefix is dropped, since no Tailwind utility generation is involved.

**The mockups are drawings, not screenshots.** The Today card and the heatmap are
built from the same CSS the application uses: 10px slot diamonds rotated 45
degrees, a 7px `risk-mark` dot, 20px check squares at `radius-mark`, and 11px
heatmap cells at 3px gaps with an inset hairline ring. They are diagrams of real
components rather than captured images, which is what lets them stay in both
schemes and at any width. The heatmap's 182 cells were generated once and
written into the file, so the page needs no script to draw them.

**The day diagram carries its annotation above the bar.** The 03:00 completion
and the 05:00 day end are 13 percent apart on a 15-hour track, so two labels on
the same row collide at every width. The moment moved above the track with a
right-anchored label and a hairline connector; the row beneath holds only the
three boundaries.

**Responsive rules.** The four screen cards are one column below 46rem and a 2x2
block above it, chosen over `auto-fit` because three columns leave one card
orphaned beside an empty half-row. The masthead's three section links are hidden
below 30rem, where they wrapped two words deep. The heatmap scrolls inside its own
container, so the page body never scrolls horizontally. The same was true of the
code blocks until 2026-10-25; they and their CSS left with the quickstart, along
with the only `<pre>` and `<code>` elements the file ever had.

## 3. Key files and entry points

| Concern | Location |
|---|---|
| The entire page | `site/index.html` |
| The values it copies | `frontend/src/index.css`, the `@theme` block and the dark `:root` override |
| The rules it restates | `backend/doer/models/task.py` (`MAX_PRIMARIES`, `SUCCESS_RATIO`, `MIN_PRIMARIES_TO_SCORE`) |
| The routes it lists | `frontend/src/App.tsx` |
| The setup it points at | `README.md`, which since 2026-10-25 is the only place the page sends a reader for it |

## 4. Interfaces and contracts

The page ships no code interface. It does publish claims that a reader will act
on, and each is checked against the system rather than written from memory:

| Claim on the page | Source of truth |
|---|---|
| The four-slot cap, the 75% verdict, the two-primary floor | `MAX_PRIMARIES`, `SUCCESS_RATIO`, `MIN_PRIMARIES_TO_SCORE` in `backend/doer/models/task.py` |
| The four routes, `/today`, `/history`, `/history/:anchor`, `/settings` | `frontend/src/App.tsx` |
| Deletion of a completed task refused by both the service and a trigger, editing refused by the route | `backend/doer/services/task_service.py`, `backend/doer/api/tasks.py`, `tasks_completed_no_delete` |
| It runs as a Docker Compose stack against your own Postgres | `docker-compose.yml`, as a description of the stack rather than of any port or command |
| Estimation in fifteen minute buckets on a smaller model, retried and cached, on your own Anthropic key | `backend/doer/services/estimation.py`, `backend/doer/config.py` |

The 2026-10-25 revision took five further rows with it: the quickstart commands,
the 5173 and 8787 ports, migrations running on container start, the Google OAuth
prerequisite, and the `calendar.freebusy` scope. Four of those were the page's
only couplings to `docker-compose.yml`, `.env.example` and
`docs/setup/gcp_setup.md`, which can no longer drift against it because it no
longer speaks about them.

One statement is still deliberately hedged rather than asserted: day close is the
thing that runs on no timer, not the process, which does run a sweeper. Three
other hedges were written for the same reason and are gone with their sections,
which is worth knowing before any of that material is restored. Calendar
availability was described as read when the day opens and on demand rather than
continuously, because there is no push subscription and Drift Note 10 of
`docs/doer/DOCUMENTATION.md` records the missing TTL. A failed calendar read was
described as keeping the last answer and labelling it out of date rather than as
never being stale. And the model paragraph named notes and block kind alongside
the title, because `services/estimation.py` sends all three. Restoring any of
that copy means restoring the hedge with it.

## 5. For someone reading the source

Read the comment at the top of the `<style>` block first. It states the coupling
to `frontend/src/index.css` and the fact that nothing enforces it, which is the
only thing about this file that can go wrong quietly.

After that the file is ordinary: one `:root` block, a dark override of the same
shape, component classes roughly in the order the page uses them, then markup
with no abstraction over it. Two classes break that order and are worth not being
surprised by: `.facts` is declared among the card rules but is first used in the
commitment section well above them, and `.two` is declared after the footer rules
but is first used in the logical-day section. There is nothing to run and nothing
to build. Open it in a browser, or serve the directory, and that is the whole
development loop.

Serving it locally is worth one warning. A plain `python3 -m http.server` lets
Chrome hold the page hard enough that an ordinary reload returns the old bytes
after an edit, with the server logging a 200 for the new ones. Send
`Cache-Control: no-store` or hard reload, or you will debug a file that is
already correct.

When changing a product rule, change it in the code first and then here. The page
cannot be told that a constant moved.
