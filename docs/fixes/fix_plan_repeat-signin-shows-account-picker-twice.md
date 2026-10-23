---
type: fix_plan
issue: repeat-signin-shows-account-picker-twice
severity: medium
status: applied
related_feature: daily-task-planner
linear_issue: null
created: 2026-10-24
updated: 2026-10-24
---

# Fix plan: a repeat sign-in shows the Google account picker twice

Severity is medium because sign-in does eventually complete and nothing is lost,
but every returning user pays the extra round trip, and the same code path can
reach an unbounded redirect loop.

## 1. Issue

After signing out and signing back in, Google's account chooser appears, the user
picks an account, a loading screen flashes, and the chooser appears a second
time. The second pick succeeds. A first-ever sign-in is unaffected.

The defect has been present since M1 (`1843e55`), so it is an original defect
rather than a regression. Nothing in the test suite exercises
`/auth/google/login` or `/auth/google/callback`, which is why it shipped.

`docs/setup/gcp_setup.md` section 7, verification step 3 states the acceptance
condition as "signing in a second time still works without re-consent". The
shipped code cannot satisfy that for any already-consented account, so this is
unambiguously unintended behaviour rather than a design choice.

## 2. Business Impact

Returning to the app is the cheapest moment it has, and today it costs two
account picks plus a consent screen. Doer is a daily-use tool, so re-entry
friction is paid repeatedly rather than once.

Two quieter costs:

- The refresh token is rotated on every repeat sign-in (`auth.py:87`), which
  counts against Google's per-client-per-account refresh-token limit. Enough
  sign-ins and Google starts invalidating the oldest grants.
- A `calendar_connected` event fires on every repeat sign-in
  (`auth.py:101-107`), not only when a calendar grant is genuinely established.
  The tracking plan's series for that event is inflated by an unknown amount
  for the life of the defect.

## 3. Root Cause

Google issues a refresh token only on the *first* consent for an account. On
later authorizations it returns an access token alone, unless `prompt=consent`
is sent.

`authorize_url` (`backend/doer/services/google_oauth.py:52-65`) deliberately
sends no `prompt` on the first leg. That is correct: it is what lets Google skip
the consent screen for an already-consented account. It also guarantees no
refresh token comes back.

`_parse_token_response` (`google_oauth.py:99-117`) then raises
`missing_refresh_token` whenever `refresh_token` is absent and
`allow_missing_refresh` is false. `exchange_code` (`google_oauth.py:68-81`)
calls it with the default, and has no keyword to say otherwise: the parameter
exists but only `refresh_access_token` (line 96) ever passes it. The raise
discards the perfectly usable access token along with the error.

`callback` catches that and 307s to `/auth/google/login?force_consent=true`
(`backend/doer/api/auth.py:52-58`). That redirect is the loading flash, and the
second authorization leg re-renders the chooser.

The decisive detail: **the callback already contains the correct handling, and
it is unreachable.** Line 86 guards the token write with
`if bundle.refresh_token:`, so a repeat sign-in returning no refresh token would
leave the stored one untouched and sign the user in cleanly. Control never
reaches line 86 because the parser raised at `google_oauth.py:106` first.

The stored token really is still there. `destroy_session`
(`backend/doer/api/deps.py:47-51`) deletes only the `AuthSession` row and the
session cookie. It never touches `OAuthToken`, so `refresh_token_encrypted`,
`status="active"` and `revoked_at=None` survive sign-out exactly as the previous
sign-in wrote them.

### Secondary defect on the same path

The re-ask carries no record of which leg it is on. `login`
(`auth.py:25-31`) mints a fresh state each time, so if a `prompt=consent`
exchange also returns no refresh token, the callback redirects again, and again.
The user-visible result is `ERR_TOO_MANY_REDIRECTS`. It is reachable today and
stays reachable, more narrowly, after the primary fix, so it is closed in the
same edit rather than left behind.

## 4. Chosen Strategy and Rationale

Tolerate a missing refresh token during the code exchange, then force consent
only when the user genuinely has no usable grant.

1. Give `exchange_code` an `allow_missing_refresh` keyword and forward it to the
   parser. This is the structural gap: without it, `auth.py` has no way to
   express "a missing refresh token is survivable here".
2. Call it with `allow_missing_refresh=True` from the callback and delete the
   early re-ask branch, which makes the existing guard at line 86 reachable.
3. Re-ask for consent only *after* identity is known, when the stored grant
   cannot actually be used. The condition mirrors `token_store.py:37-39`, the
   only other consumer of these rows: no refresh token in the bundle **and**
   (the `OAuthToken` row is missing, **or** `status != "active"`, **or**
   `refresh_token_encrypted` is the empty-bytes placeholder written at line 83).

### Why the condition is narrow rather than "never force consent"

The forced-consent redirect is currently the *only* re-consent route in the
application. The "Reconnect" control in `frontend/src/components/DayHeader.tsx`
routes through `useRefreshCalendar` to `token_store.access_token_for`, which
refuses a non-active grant outright (`token_store.py:37-39`) and cannot
re-consent. Grep confirms nothing else in the repository ever produces
`force_consent=true`.

So once `token_store.py:50-63` marks a grant revoked, the double-prompt flow is
how a user gets a working refresh token back. Deleting the re-ask outright, the
smallest possible diff, would fix the reported symptom and silently strand every
user with a revoked grant. Keeping it behind the narrow condition fixes the
symptom and leaves recovery intact.

The empty-bytes clause is not hypothetical: `auth.py:83` creates the row with
`refresh_token_encrypted=b""` before the conditional write. Without that clause
a user could be signed in holding a placeholder that fails later, at calendar
read time, instead of at sign-in where it is diagnosable.

### Rejected alternatives

**Always send `prompt=consent` on the first leg.** One line, and it does
collapse to a single chooser pass. But it shows the consent screen on every
sign-in forever, rotates the refresh token every time, and contradicts ADR 0001's
"a single consent screen". It trades a once-per-session annoyance for a smaller
permanent one.

**Unconditionally tolerate the missing refresh token and delete the re-ask.**
Smallest diff, covered above: it removes revocation recovery and admits the
placeholder case.

### Loop guard

`login` encodes the forced-consent leg into the state value itself
(`"c:" + token`) rather than taking a second cookie. The state is already
round-tripped through Google and compared against the httponly state cookie
(`auth.py:46`), so an attacker cannot forge the prefix without also matching a
cookie they cannot read. The callback refuses to re-ask when the prefix is
present, returning a 502 with the original error instead of redirecting.

### Included by explicit decision

Two items agreed in planning, both on lines this change already touches, neither
an expansion of the diagnosis:

- **`login_hint` on the re-ask.** At the narrowed re-ask the email is in hand
  from `fetch_userinfo`, so the redirect can carry `login_hint` and skip the
  chooser on the recovery path. It is not available on the *first* leg: the
  session cookie has just been deleted, so `/auth/google/login` has no identity
  to hint with. That asymmetry is why `login_hint` cannot substitute for the
  main fix.
- **`calendar_connected` gating.** The event moves behind "a refresh token was
  actually newly stored", so it stops firing on sign-ins that reuse an existing
  grant. This changes an existing metrics series rather than only correcting
  future points, and is noted below for metrics-mode.

## 5. Affected Files

- `backend/doer/services/google_oauth.py`: `exchange_code` gains
  `allow_missing_refresh`; `authorize_url` gains `login_hint`. The module
  docstring's second gotcha is reworded, since it currently states the rule that
  produced the defect.
- `backend/doer/api/auth.py`: `login` accepts `login_hint` and marks the forced
  leg in the state; `callback` tolerates the missing refresh token, re-asks only
  on an unusable grant, guards the loop, and gates `calendar_connected`.
- `backend/tests/test_api.py`: new `TestGoogleSignIn` class, described below.

Not touched, deliberately: `frontend/src/lib/api.ts` and
`frontend/src/pages/SignIn.tsx` need no change, and the working tree already
carries the unrelated interface-overhaul work. This fix stays backend-only so the
two remain separable.

Documentation:

- `docs/setup/gcp_setup.md`, section 7 step 3 and section 8 gotcha 2. **Written
  by fix-mode as an explicit exception to the file-ownership table**, because
  `docs/setup/*` appears in no mode's row and would otherwise stay stale.
  Section 7 step 3 already stated the condition this fix establishes, so it is
  sharpened into a check the reader can actually perform rather than rewritten.
  Gotcha 2 described Google's behaviour correctly but Doer's response to it
  wrongly, and is rewritten.
- `docs/features/daily-task-planner_doc.md:123`, which describes the
  `force_consent` query parameter. Owned by documentation-mode and left to it.

## 6. Regression Risk

1. **A revoked grant must still reach consent.** This is the main risk and the
   reason for the narrow condition. Covered by a test asserting the redirect
   still happens for `status="revoked"` and for the empty-bytes placeholder.
2. **First-ever sign-in must stay single-prompt.** The first consent returns a
   refresh token, so it takes the same branch as before and never reaches the
   re-ask. Covered by a test.
3. **The refresh token stops rotating on repeat sign-in.** Intended. Nothing in
   this codebase holds a Google refresh token out of band, so the old value
   simply stops being replaced with an identical-capability new one. The test
   asserts the stored ciphertext is byte-identical across a repeat sign-in.
4. **`calendar_connected` stops firing on repeat sign-ins.** Intended, and a
   real discontinuity in that series rather than a silent correction. Flagged
   for metrics-mode.
5. **State format change.** The `"c:"` prefix lives entirely inside one request
   pair and the cookie holding it has a 600-second lifetime. A sign-in already
   in flight across the deploy fails state validation and the user retries. No
   stored state is affected. The marker cannot collide with a generated state:
   `secrets.token_urlsafe` emits only the URL-safe base64 alphabet, which has no
   colon.
6. **`login_hint` is settable by anyone calling `/auth/google/login`.** It is not
   a redirect vector: `AUTH_ENDPOINT`, `client_id` and `redirect_uri` are all
   fixed server-side, and the value is URL-encoded into a query parameter. The
   worst case is a pre-filled address on Google's own account picker. Noted so
   the question does not have to be re-asked.

## 7. Test Plan

`respx` is already a dependency and already used at the Google HTTP boundary in
`backend/tests/test_calendar.py`, so the token and userinfo endpoints can be
mocked without new infrastructure. No OAuth fixture exists yet; one is added
alongside the tests.

New `TestGoogleSignIn` in `backend/tests/test_api.py`, each case driving the real
`/auth/google/callback` with a matching state cookie:

1. **Repeat sign-in with an active grant completes in one leg.** Token endpoint
   returns an access token and no refresh token. Assert: 307 to
   `frontend_origin`, a `doer_session` cookie is set, and
   `refresh_token_encrypted` is byte-identical to its value before the request.
   This is the regression test for the reported defect; it fails on the current
   code with a redirect to `/auth/google/login?force_consent=true`.
2. **A revoked grant still redirects to forced consent.** Same response, but the
   row has `status="revoked"`. Assert the redirect to
   `/auth/google/login?force_consent=true`, and that it carries `login_hint`.
3. **The empty-bytes placeholder still redirects to forced consent.** Row exists
   with `refresh_token_encrypted=b""` and `status="active"`.
4. **First sign-in is unaffected.** No user row, token endpoint returns a refresh
   token. Assert the user and token rows are created and the response is a 307 to
   `frontend_origin`.
5. **The loop guard holds.** A callback whose state carries the forced-consent
   prefix, returning no refresh token for a user with no usable grant, returns
   502 rather than redirecting again.
6. **`calendar_connected` fires only on a new grant.** Assert the event is
   recorded in case 4 and not in case 1, while `user_signed_in` is recorded in
   both.

Acceptance: case 1 fails against the current code and passes after the change,
the rest of the backend suite stays green, and `ruff` is clean.

**What these tests cannot establish.** Every case above asserts what the backend
does with a mocked Google. None of them proves the chooser renders once, because
that is Google's behaviour in a real browser. The plan does not move to
`verified` on unit tests alone: it requires a live sign-out and sign-in against
a real Google account, confirming one chooser, no consent screen, and a landing
straight on the app.

### Result on 2026-10-24

220 backend tests pass, six of them new. `ruff check` and `ruff format --check`
are clean on all three changed files. Pre-existing lint and format drift in
`alembic/versions/*`, `doer/api/tasks.py` and the untouched region of
`tests/test_api.py` is unchanged by this fix and was confirmed present on HEAD.

The new tests were run against the original source with the test file left in
place. Four of the six failed, which is what makes them a regression suite rather
than a description of the new code:

- `test_a_repeat_signin_completes_in_one_leg` failed with a 307 to
  `/auth/google/login?force_consent=true`, which is the second account picker the
  user reported.
- `test_a_repeat_signin_does_not_claim_the_calendar_was_connected` failed, so the
  spurious event was real.
- `test_a_revoked_grant_still_asks_for_consent` failed on the missing
  `login_hint`.
- `test_the_forced_leg_fails_rather_than_redirecting_again` returned a 307 rather
  than a 502, confirming the unbounded redirect was reachable.

The two that passed against the original code are the ones whose behaviour this
fix deliberately preserves: the empty-bytes placeholder still forces consent, and
a first sign-in is untouched.

Status stays `applied` rather than `verified`. The remaining acceptance condition
is the live one: sign out, sign back in with a real Google account, and confirm a
single chooser with no consent screen. Nothing above can stand in for that.

## 8. Rollback Plan

Two source files and one test file, no schema change and no migration. Stored
rows are read differently but written with strictly fewer updates than before, so
no data written under the fix is unreadable by the old code. Reverting the commit
restores the previous behaviour, including its double prompt.
