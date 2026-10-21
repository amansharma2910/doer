---
type: fix_plan
issue: signout-leaves-page-frozen
severity: high
status: verified
related_feature: daily-task-planner
linear_issue: null
created: 2026-10-21
updated: 2026-10-21
---

# Fix plan: signing out leaves the page frozen on the dashboard

Severity is high because the user appears signed in after signing out, which is
the one moment the interface must be believed.

## 1. Issue

Clicking "Sign out" destroys the session server-side and clears the cookie, but
the page does not change. The dashboard stays on screen, still showing the
previous user's name, until the page is reloaded manually. After a reload the
sign-in screen appears correctly.

## 2. Business Impact

The control appears not to work, and on a shared machine the screen keeps showing
one person's day to whoever is in front of it. Nothing is leaked from the server,
since the session is genuinely destroyed and every subsequent request would be
refused, but the screen is the only thing the user can see.

The same defect also freezes a *failed* sign-out. `onSettled` fires on error too,
so a network failure currently clears the cache and leaves a frozen, apparently
signed-in dashboard rather than a usable one.

## 3. Root Cause

`frontend/src/lib/hooks.ts`, `useLogout`, calls `queryClient.clear()` in
`onSettled`. In TanStack Query 5.104.5, `clear()` destroys each `Query` and drops
it from the cache's map, but never detaches the observers watching it. The
mounted `useMe` observer is left pointing at a destroyed object that still
carries `status: "success"` and the previous user's data.

Nothing notifies React. `App.tsx` therefore keeps reading `isLoading: false`,
`error: undefined`, `user: <the signed-out user>`, and keeps rendering the
dashboard. Window-focus refetch cannot rescue it either: that path iterates the
cache's map, and the orphaned query is no longer in it.

The decisive constraint, confirmed by probes against the installed library: once
`clear()` has run, no cache-level API can reach that observer.
`invalidateQueries`, `refetchQueries`, `resetQueries` scoped to the key,
`setQueryData` and `fetchQuery` all either match nothing or build a new `Query`
with no observers attached. `fetchQuery` genuinely issues the request and still
never reaches the interface. A fix must therefore avoid orphaning the observer
rather than try to wake it afterwards.

## 4. Chosen Strategy and Rationale

Replace `clear()` with `resetQueries()`. Queries stay in the cache with their
observers attached, `reset()` returns each to its initial state, and the active
ones refetch, so React is notified and `App` re-evaluates into the 401 branch and
renders the sign-in screen.

The no-leak property that motivated `clear()` is preserved: every cached value
becomes `undefined`, leaving only empty key entries that garbage collect. The
cost is four to six requests that refetch into a 401, two of them retried once
under the global `retry: 1`.

Rejected: resetting only the `me` key, which fixes the navigation while leaving
the previous account's tasks and day in the cache, exactly the flash `clear()`
was added to prevent. Also rejected: a full page reload, which is unconditionally
correct but discards the SPA's one advantage here and cannot be tested without a
DOM.

Explicitly not an option: any sequence ending in `clear()` or `removeQueries()`
over the `me` key. "Reset, then clear for good measure" re-orphans the observer
mid-fetch and sticks on "Loading" permanently, which is worse than the defect.

Included by explicit decision rather than by scope creep: hardening
`App.tsx`. Its loading branch gates on `isLoading`, which is
`isPending && isFetching`, so a query that is pending with no fetch in flight
falls past the 401 branch into "Could not reach the API. Is it running on port
8787?". That state is not reachable on the sign-out path, but it is reachable
offline, where a paused fetch makes the application blame the API for the user's
connection. The branch will gate on `isPending`, with a distinct message when the
fetch is paused.

## 5. Affected Files

- `frontend/src/lib/hooks.ts`: `useLogout` calls `resetQueries`. The teardown is
  extracted as an exported function so it can be tested without React.
- `frontend/src/App.tsx`: gate on `isPending`, and name the offline case.
- `frontend/src/__tests__/hooks.test.ts`: the regression test described below.
- `frontend/src/pages/Dashboard.tsx`: the `SignOut` control the defect was
  reached through.
- `backend/tests/test_api.py`: `TestLogout`, covering an endpoint that had
  existed since M1 with no tests.

## 6. Regression Risk

1. **Request volume on sign-out.** Four to six doomed requests, where today there
   are none. All are refused and none blocks the transition.
2. **The mutation cache is no longer cleared.** `clear()` wiped it; `resetQueries`
   does not. Nothing in this application reads `useMutationState` or shares a
   mutation key, so this is unobservable. It is a deliberate difference rather
   than an oversight.
3. **`App.tsx` gating on `isPending`.** An offline first load now shows an offline
   message indefinitely rather than a false API-outage message. That is the
   intended change, and it is the honest state.
4. **The `useDay` estimate poll** reads tasks through the cache and stops when
   that data is gone. True of `clear()` as well; no change.

## 7. Test Plan

The frontend has no component-testing infrastructure: `vite.config.ts` has no
`test` block, so vitest runs in the node environment, and there is no jsdom and
no testing-library. Adding them for one assertion is not worth it.

Instead the teardown becomes a plain function over a `QueryClient`, which makes
the defect testable with the library alone:

- Construct a `QueryClient` and a `QueryObserver` for the `me` key with
  `_optimisticResults: "optimistic"`, subscribed through
  `notifyManager.batchCalls`, exactly as `useBaseQuery` subscribes it.
- Resolve it to a user, then point the query function at a 401.
- Run the teardown and assert the observer leaves its stale success, rather than
  continuing to report the signed-out user.
- Assert that another key's data is `undefined` afterwards, which is the no-leak
  property.

Acceptance: that test fails against `clear()` and passes against `resetQueries`,
the rest of the frontend suite stays green, and signing out in the running
application lands on the sign-in screen with no manual reload.

Result on 2026-10-21: 74 frontend tests pass, two of them new. The regression
test was run against the original `clear()` and failed with its own diagnostic,
"the observer is still reporting the signed-out user, so the page stays frozen",
then passed once restored, so it genuinely covers the defect rather than the
fix. `tsc --noEmit` clean.

The Docker daemon came back afterwards: 208 backend tests pass, including all
three of `TestLogout`, and the production database's row counts were unchanged
across the run.

Still unverified: the behaviour in a browser. Every claim above rests on the
library's own machinery and on the test suites, not on a human watching the page
change.

A version caveat worth carrying: the root cause above is specific to
`@tanstack/react-query` 5.104.5, which is what the lockfile resolves. The
manifest declares `^5.59.0`, so a minor upgrade can change the internals this
reasoning and the regression test depend on. The test fails loudly if it does.

## 8. Rollback Plan

Two one-line changes and one new test. Reverting the commit restores the previous
behaviour. No backend change, no schema change, no stored state touched.
