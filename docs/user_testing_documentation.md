# User Testing Documentation

## How to Use This Document

This document contains step-by-step manual test instructions for human testers. You do not need to have seen the codebase. Each flow lists numbered steps giving the exact action to take and the observable result to expect. Report any step whose actual result differs from the expected result, quoting the flow name and step number.

## Before You Start

**Starting the app.** From the project root:

```bash
docker compose up -d
```

The `api` container runs `alembic upgrade head` as part of its start command, so
migrations are applied for you. Run them by hand only when you are starting the
API outside compose:

```bash
docker compose exec api alembic upgrade head
```

Wait until `docker compose logs api` reports application startup complete. The API container listens on port 8000 internally and is published on **8787**, so the startup line says 8000 while you reach it at `http://localhost:8787`. Open the app at `http://localhost:5173`.

If every page errors immediately after a fresh checkout, check `docker compose logs api` for a migration failure. The container applies migrations on start, so a broken schema means they errored rather than that they were skipped.

**Test account.** Use the Google account that is registered on the OAuth client (see `docs/setup/gcp_setup.md`). If the consent screen shows "Google hasn't verified this app", that is expected on the External path: click **Advanced**, then **Go to Doer**.

**Testing the clock.** Several flows below depend on a logical day starting, ending, or crossing 03:00. Testers must not be expected to stay awake until 03:00 to verify day-boundary behavior. Two supported techniques, in order of preference:

1. **Reshape the day.** Change the day shape in Settings so the day under test starts a few minutes ago and ends a few minutes from now. This exercises real boundary logic with no special tooling.
2. **Dev-only clock override.** If the build exposes a development time override, use it as documented in the running app. This control must never be reachable in a deployed build.

If neither technique is available in the build you are testing, mark every flow tagged **[clock]** as blocked rather than skipping it, and report it.

**Reporting.** For every failure, record the flow name, the step number, what you saw, the time, and the account timezone in Settings.

## Flows

### Flow 1: First-time sign-in and calendar connection

| Step | Action | Expected result |
|---|---|---|
| 1.1 | Open `http://localhost:5173` while signed out. | A sign-in screen appears with a single Google sign-in option. No email or password fields exist. |
| 1.2 | Click sign in with Google. | The Google consent screen opens. It lists the app name Doer, and requests identity plus calendar availability. It requests no write access to your calendar. |
| 1.3 | Complete consent. | You land on the dashboard, signed in. |
| 1.4 | Open Settings and find the calendar connection. | The calendar shows as connected, with a last-synced time. |
| 1.5 | Sign out using the sign-out control. | The dashboard leaves the screen immediately, with no manual reload, and you land on the signed-out screen. Staying on the dashboard until you reload is a failure. |
| 1.5a | Sign back in. | Sign-in completes without showing the consent screen again. |
| 1.6 | Leave the app untouched for more than one hour, then reload the dashboard. | The dashboard loads normally. You are not asked to reconnect the calendar. (If you are, the access token is not being refreshed. Report it.) |

### Flow 2: Defining the day and preference blocks

| Step | Action | Expected result |
|---|---|---|
| 2.1 | Open Settings and set the day to start at 14:00 with a duration of 15 hours. | Settings accepts the shape and shows the day as running 14:00 to 05:00 the following date. |
| 2.2 | Add a preference block: Deep work, 15:00 to 18:00. | The block appears in the day's block list, in time order. |
| 2.3 | Add a second block: Personal project, 21:00 to 23:00. | Both blocks appear in time order. |
| 2.4 | Attempt to add a block that overlaps an existing one. | The overlap is rejected with a clear message. No overlapping blocks exist in the list. |
| 2.5 | Add a Social block, 23:00 to 00:30. | Accepted. A block crossing midnight is valid inside this day shape. |
| 2.6 | Return to the dashboard. | The dashboard shows today's capacity reflecting 5 hours of focus blocks (Deep work plus Personal project), not the full 15 hour span. Social and personal time do not count as capacity. |

### Flow 3: Adding tasks manually

| Step | Action | Expected result |
|---|---|---|
| 3.1 | On the dashboard, click the plus button. | A short add-task form opens: title, optional notes, a primary or non-primary choice, and a preference type. There is no field asking you to enter a duration. |
| 3.2 | Add a primary task titled "Write the quarterly update" and submit. | The task appears immediately in the pending list. Its estimate shows as pending or still calculating. |
| 3.3 | Watch the task for up to 5 seconds. | The estimate resolves in place to a duration that is a multiple of 15 minutes. The task does not move or flicker position when it updates. |
| 3.4 | Add three more primary tasks. | All four appear in the pending list, each with a resolved estimate. |
| 3.5 | Attempt to add a fifth primary task. | The attempt is refused. The message explains the 4-task limit and offers to either demote an existing primary or add this one as non-primary. It is not a blocking modal with no way out. |
| 3.6 | Accept the offer to add it as non-primary. | The task is created as non-primary and appears visually distinct from the primaries. |
| 3.7 | Add three more non-primary tasks. | All are accepted. There is no limit on non-primary tasks. |
| 3.8 | Open a task and override its estimate to 20 minutes. | The saved estimate reads 30 minutes, snapped up to the next 15-minute bucket. |

### Flow 4: Adding tasks through the Doer Assistant

| Step | Action | Expected result |
|---|---|---|
| 4.1 | On the dashboard, find the chat panel. | The chat is collapsed by default and does not dominate the screen. |
| 4.2 | Expand the chat and type: "Today I want to finish the investor update, review two pull requests, and call the bank." | The assistant replies with three distinct proposed tasks, each with a title and an estimate. |
| 4.3 | Inspect the proposal before confirming. | Nothing has been added to the task list yet. The proposal is editable. |
| 4.4 | Edit one proposed task's title, then confirm. | Exactly the confirmed tasks appear in the pending list, with your edit applied. |
| 4.5 | Expand the chat and ask it to break a task into subtasks. | The assistant does not produce subtasks. This is intended behavior for v1, not a bug. |
| 4.6 | Type something that is not a task, for example "how am I doing this week". | The assistant does not silently create a task from it. (v1 is scoped to capture and estimation, so a polite non-answer is acceptable; a spurious task is a failure.) |

### Flow 5: The quiet over-commitment signal

| Step | Action | Expected result |
|---|---|---|
| 5.1 | With the day shape from Flow 2 (5 hours of focus blocks, so a threshold of 2 hours 30 minutes), add primary tasks totalling under 2 hours. | The day reads normal. No orange, no warning. |
| 5.2 | Add primaries until the total estimate exceeds 2 hours 30 minutes. | The day's cell and the dashboard indicator turn orange. |
| 5.3 | Observe how the warning is delivered. | There is no modal, no popup, no alert sound, and no red text. The signal is colour only. If the app interrupts you, that is a failure. |
| 5.4 | Remove a task so the total drops back under the threshold. | The orange state clears. |
| 5.5 | Add a task and immediately, before its estimate resolves, check the day indicator. | The day reads indeterminate or unknown rather than safe. An unestimated task must never make an over-committed day look fine. |

### Flow 6: Completing tasks and the completed section

| Step | Action | Expected result |
|---|---|---|
| 6.1 | Complete one primary task. | It leaves the pending list and appears in the completed section, which is small and visually recessed rather than celebratory. |
| 6.2 | Attempt to delete the completed task. | Deletion is refused with a clear explanation. There is no path in the interface that removes it. |
| 6.3 | Un-complete the task while the day is still open. | It returns to the pending list. |
| 6.4 | Complete it again, then complete a second primary. | Both appear in the completed section. |
| 6.5 | Complete a non-primary task. | It appears in the completed section but is distinguishable from primaries. |

### Flow 7: Reordering tasks

| Step | Action | Expected result |
|---|---|---|
| 7.1 | With at least three pending tasks in the same preference block, drag the bottom one to the top. | The order changes as you drag and settles where you drop it. |
| 7.2 | Reload the page. | The new order persists. |
| 7.3 | Add a new task to that block. | It appears at the bottom of the block, not the top. |
| 7.4 | Attempt to drag a task from one preference block into another. | Either the move is refused, or the task's preference type updates to match its new block. A task must never appear under a block it does not belong to. |

### Flow 8: Day rollover and carry-forward **[clock]**

| Step | Action | Expected result |
|---|---|---|
| 8.1 | Set up a day with 4 primaries, complete 3, and leave 1 pending plus 2 non-primaries pending. | The dashboard shows 1 pending primary and 2 pending non-primaries. |
| 8.2 | Advance past the end of the logical day using one of the clock techniques above. | Nothing crashes. |
| 8.3 | Reload the dashboard. | A new logical day is open. The incomplete primary and both non-primaries have carried forward. The three completed tasks have not. |
| 8.4 | Inspect a carried task. | It shows a carry-forward indicator or count. Its original creation date is preserved, not reset to today. |
| 8.5 | Delete one carried task. | Deletion succeeds, because it is incomplete. |
| 8.6 | Check the previous day in the heatmap. | It scores success: 3 of 4 primaries is 75%. |
| 8.7 | Attempt to un-complete one of the previous day's completed tasks. | Rejected. The closed day's verdict cannot be rewritten. |
| 8.8 | Close the app entirely, advance past two more day boundaries, then reopen it. | All elapsed days have closed, each with its own verdict, and carry-forward has happened exactly once per task, not once per elapsed day. A task carried across two days shows a count of 2, not 1 or 4. |

### Flow 9: Late-night attribution **[clock]**

This is the flow the product exists for. Test it carefully.

| Step | Action | Expected result |
|---|---|---|
| 9.1 | Confirm the day shape runs 14:00 to 05:00. | Settings shows the day crossing midnight. |
| 9.2 | Arrange for the current time to be 03:00, which is inside the day that started at 14:00 on the previous calendar date. | The dashboard still shows the day that began on the previous date. It has not rolled over at midnight. |
| 9.3 | Complete a primary task at 03:00. | The task completes normally. |
| 9.4 | Open the heatmap. | The completion is counted on the cell for the date the day began, which is the previous calendar date. It must not appear on today's calendar date. |
| 9.5 | Advance to 05:30, past day end, and reload. | A new logical day opens, anchored to the current calendar date. |

### Flow 10: Scoring rules

| Step | Action | Expected result |
|---|---|---|
| 10.1 | Create a day with 4 primaries and complete 3. Close the day. | Verdict: success. The heatmap view 2 cell is green. |
| 10.2 | Create a day with 4 primaries and complete 2. Close the day. | Verdict: failure. The cell is red. |
| 10.3 | Create a day with 2 primaries and complete 1. Close the day. | Verdict: failure. One of two is 50%, below the bar. |
| 10.4 | Create a day with 1 primary and complete it. Close the day. | Verdict: neutral. The cell is not green. A single-task day is not scoreable. |
| 10.5 | Create a day with 1 primary and do not complete it. Close the day. | Verdict: neutral. Not red. |
| 10.6 | Create a day with 0 tasks. Close the day. | No verdict and no colour in either view. |
| 10.7 | Create a day with 2 primaries, complete both, and also complete 5 non-primaries. | Verdict: success, driven by the primaries. The non-primaries did not change the verdict. |

### Flow 11: The heatmap

| Step | Action | Expected result |
|---|---|---|
| 11.1 | Open the heatmap with several days of history. | A GitHub-style grid appears with a visible control to switch between two views. |
| 11.2 | Select view 1. | Cells are shades of green scaled by the number of tasks completed. A day with more completions is brighter and more opaque than a day with fewer. A day with zero completions has no colour. |
| 11.3 | Compare a day where you completed 2 primaries and 5 non-primaries against a day where you completed 4 primaries only. | View 1 counts all completions together, so the 7-completion day is brighter. |
| 11.4 | Select view 2. | Cells are green for success, red for failure, and uncoloured for neutral or unscheduled days. The count no longer affects the shade. |
| 11.5 | Find a day that was flagged over-committed. | It reads orange in both views. |
| 11.6 | Hover or select any cell. | The detail shown matches that day's actual tasks and verdict. |

### Flow 12: Calendar degraded modes

| Step | Action | Expected result |
|---|---|---|
| 12.1 | Note today's capacity figure with the calendar connected. | Capacity reflects focus-block time minus calendar busy time. |
| 12.2 | Add a calendar event covering one hour inside a focus block, then refresh the calendar in Doer. | Capacity drops by one hour. The threshold drops proportionally. |
| 12.3 | Add a calendar event entirely outside all focus blocks, then refresh. | Capacity is unchanged. |
| 12.4 | Check that no calendar event titles are visible anywhere in Doer. | Doer shows busy time, never event names. If you can see a meeting title, that is a failure. |
| 12.5 | Revoke Doer's access at `myaccount.google.com/permissions`, then reload the dashboard. | The app still loads and is fully usable. A non-blocking banner invites you to reconnect. Capacity now reflects focus-block time with no busy-time subtraction, and the day is marked as computed without calendar data. |
| 12.6 | Reconnect the calendar. | Consent completes and capacity returns to including busy time. |
| 12.7 | With the dashboard already loaded, stop your machine's network connection, then act on a task. | The app does not hang or throw on the calendar. Do **not** reload: offline, the app cannot mount the dashboard at all, so a reload shows only the failure to load and proves nothing about the snapshot. |
| 12.8 | Restore the network, then check the capacity line against a calendar snapshot older than the current day's start. | The last synced snapshot is used and a staleness indicator appears. If no snapshot that old is available, mark this step blocked rather than passing it. |

### Flow 13: Missing configuration

| Step | Action | Expected result |
|---|---|---|
| 13.1 | Remove all preference blocks from the day shape, then open the dashboard. | The day reads indeterminate. Capacity is not silently computed from the full day span, and the day is not shown as safe. |
| 13.2 | Observe the guidance given. | The dashboard prompts you to define at least one focus block. |
| 13.3 | Add one focus block back. | Capacity computes and the indeterminate state clears. |

### Flow 14: Estimation failure

| Step | Action | Expected result |
|---|---|---|
| 14.1 | With the Anthropic API made unreachable (disconnect the network or use an invalid key in the test environment), add a task. | The task is created immediately and is marked unestimated. The app does not error or lose the task. |
| 14.2 | Check the day's capacity indicator. | The day reads indeterminate rather than safe, because an unestimated primary is unaccounted capacity. |
| 14.3 | Restore the API and wait for the retry window, or trigger a refresh. | The estimate resolves and the day's capacity state updates. |
| 14.4 | Enter a manual estimate on a task that is still unestimated. | The manual value is accepted, snapped to a 15-minute bucket, and counts toward capacity. |

### Flow 15: Minimalism check

This flow has no pass or fail assertion in code. It is a judgment pass, and it is the reason a human runs these tests at all.

| Step | Action | Expected result |
|---|---|---|
| 15.1 | Open the dashboard on a normal day with 3 pending and 1 completed task. | The pending tasks are the clear visual focus. The completed section is present but recessed. |
| 15.2 | Count the interactive elements visible without scrolling. | The dashboard shows today only. There is no backlog, no project list, no sidebar of other views. |
| 15.3 | Trigger the over-committed state. | The signal reads as information, not as alarm. Report it if it feels like nagging. |
| 15.4 | Use the app for one real day end to end. | Nothing interrupted you, nothing notified you, and the day's outcome was unambiguous at the end. |

### Flow 16: Dragging the block window on the day timeline

This flow is the **only** gate on the drag behaviour. The geometry beneath it is covered by automated tests, but the pointer and keyboard wiring is not, by a deliberate decision recorded in ADR 0002. Treat a failed step here exactly as you would a failed automated test: it blocks.

**A note on the time fields.** All three fields on this page use a 24-hour clock
with no AM or PM, as of 2026-10-23. **From** and **Until** accept only `:00` and
`:30`. **Starts** accepts any minute, because the day's start shifts the whole
half-hour grid. Flow 17 covers the fields themselves.

**Setup.** This flow uses the same day shape as Flow 2: a day starting at **14:00** running **15 hours**, so it ends at 05:00. Set it in Settings if you have not already run Flow 2. Then make the block list contain exactly one block, **Deep work, 15:00 to 18:00**, removing any others. The timeline bar under "How your day is split" now shows one green block with free time either side of it, and a dashed window at 14:00 to 15:00. That dashed window is the block you are about to add; it is not saved until you press Add block.

Throughout this flow, the **From** and **Until** fields below the bar should mirror the dashed window at all times. Check them on every step. If the bar and the fields ever disagree, that is a failure; note which one looked right.

| Step | Action | Expected result |
|---|---|---|
| 16.1 | Hover over the middle of the dashed window. | The cursor becomes a grab cursor. Handles are visible at the window's left and right edges. |
| 16.2 | Press and hold in the middle of the window, drag slowly to the right past the green block, and release in the open space after 18:00. | The window moves in half-hour steps, never smoothly with the cursor. From and Until show clean half-hour times, for example 19:00 and 20:00. |
| 16.3 | Drag the body left and right without releasing, and watch the window's width. | The width never changes while you are dragging the body. Only its position does. |
| 16.4 | Drag the body left towards the green block and keep pushing past it. | The window stops flush against the block's right edge, reading 18:00 as its start, with no visible gap and no sliver of empty space between them. It stays there as you keep pushing. |
| 16.5 | Keep dragging left, further past the block. | At some point the window jumps to the near side of the block and sits flush against it, reading 14:00 to 15:00. It never at any moment overlaps the green block, and it never pushes or resizes the block. |
| 16.6 | Reverse direction and drag back to the right. | The window pops across again at the same place it popped before. It never overlaps the block in either direction. |
| 16.7 | Drag the window all the way to the right-hand end of the bar. | The window stops at the end of the day. No part of it extends past the bar's right edge, and Until reads 05:00. |
| 16.8 | Drag the window all the way to the left-hand end. | The window stops at 14:00, reading 14:00 to 15:00. Both handles are still visible and grabbable; neither is cut off by the bar's edge. |
| 16.9 | Grab the **right** handle and drag it left, towards the window's own left edge, and keep going. | Only the right edge moves; the left edge stays at 14:00. The window shrinks to 30 minutes, reading 14:00 to 14:30, and stops. It never reaches zero width and the two edges never swap places. |
| 16.10 | Drag the right handle back to the right, past 15:00, and keep going. | The right edge stops flush at 15:00, against the green block. It does **not** jump to the far side of the block, even though 18:00 onwards is free. This differs from step 16.5 on purpose: bodies jump, edges do not. |
| 16.11 | Grab the **left** handle, drag it right towards the window's own right edge, and keep going. | Only the left edge moves. The window shrinks to 30 minutes, reading 14:30 to 15:00, and stops. |
| 16.12 | Drag the left handle back to the left and keep going. | The left edge stops at 14:00, the start of the day, and goes no further. |
| 16.13 | Position the window somewhere clean, press **Add block**, then press Remove on the block you just added. | The block appears in the list with the times the window showed, then disappears again. The dashed window reappears in a free stretch. |
| 16.14 | Remove the Deep work block, then add one running **15:00 to 15:45** by setting Until with the arrow keys from 15:00 and stopping at 15:30, then widening it on the bar. If you cannot reach 15:45 at all, that is expected and this step is satisfied: From and Until accept only :00 and :30 as of 2026-10-23. Instead, use an existing odd block if your account has one, or skip to 16.16. | Recorded so a tester is not left hunting. The window's own length can still be odd when the app proposes it, because a suggestion inherits the granularity of whatever block it follows. |
| 16.15 | If you have an odd-length window from any route, drag it up against a green block from the right-hand side. | It parks exactly flush against the block, with no gap, even though its other edge is not on a half hour. If no odd-length window is reachable, mark this step blocked rather than passed. |
| 16.16 | Press and hold the window body, and **while still holding**, switch to another application and back to the browser, then finish the drag. | The window is still where you left it and the drag finishes normally. It must not jump back to a suggested position partway through. |
| 16.17 | Hover over the green Deep work block itself. | Its tooltip still appears, reading "deep work: 15:00 to 18:00". If no tooltip appears, the new overlay is blocking it. |
| 16.18 | Press Tab until focus reaches the timeline. | Focus lands on the window body and on each handle, with a visible focus ring. |
| 16.19 | With the window body focused, press the left and right arrow keys. | The window moves one half-hour step per press, obeying the same parking and popping rules as the pointer. |
| 16.20 | With a handle focused, press the left and right arrow keys. | Only that edge moves, one step per press, with the same 30-minute floor. |
| 16.21 | Narrow the browser window to roughly phone width and repeat steps 16.2 and 16.9. | The bar shrinks with the page. The window is still draggable and both handles are still grabbable, even though they are now only a few pixels apart. |
| 16.22 | Set the day duration to 24 hours and repeat step 16.2 with a 30-minute window. | Still draggable. This is the narrowest the window ever gets, around 13 pixels, and is the hardest case for grabbing it. Report it if it feels unusable rather than merely small. |
| 16.23 | Switch your operating system between light and dark appearance with the timeline on screen. | The window, its handles and the blocks all remain legible in both. |

**Phase-shifted day.** Blocks are stored as an offset from the start of the day, not as a wall-clock time, so moving the day's start moves every block with it. This is the case most likely to be subtly wrong, and the only one where correct arithmetic and a wrong pixel conversion look different on screen. Run it last.

| Step | Action | Expected result |
|---|---|---|
| 16.24 | Set the day start to **14:15**, keeping the 15 hour duration, and save. | The day now runs 14:15 to 05:15, and the Deep work block has moved with it, now reading **15:15 to 18:15**. |
| 16.25 | Drag the dashed window's body across the open part of the bar. | The times it lands on are 14:30, 15:00, 15:30 and so on: still real half hours, not 14:15, 14:45, 15:15. The day's odd start does not drag the whole grid off the half hours with it. |
| 16.26 | Drag the window up against the Deep work block from the left. | It parks flush at **15:15**, which is not a half hour. This is correct and is the point: the window snaps to half hours *and* to the edges of blocks, so parking never leaves an unusable gap. |
| 16.27 | Drag the window's left edge to the very start of the day, then shrink it from the right as far as it will go. | The left edge can sit at 14:15, but the smallest window starting there is **14:15 to 15:00**, 45 minutes. A 15 minute window reading 14:15 to 14:30 must not be reachable: no window is ever shorter than 30 minutes, including at the day's own edges. |
| 16.28 | Set the day start back to 14:00. | The block returns to 15:00 to 18:00 and the grid returns to the plain half hours. |

**Reporting note for this flow.** If the window ever visually overlaps a green block during a body drag, even for a single frame, record it with the step number and what you were doing. That is the one invariant the whole design rests on.

### Flow 17: The time fields

Three fields on Settings take a clock time: **Starts**, under "Your day", and
**From** and **Until**, under "How your day is split". All three were replaced on
2026-10-23. They are no longer the browser's own time control, so their behaviour
is now the same on every machine, which it was not before.

Two rules differ between them, deliberately. **From** and **Until** accept only
`:00` and `:30`, matching the timeline drag. **Starts** accepts any minute,
because the day's start shifts the entire half-hour grid: a day beginning at 14:15
puts the half hours at 14:30 and 15:00.

| Step | Action | Expected result |
|---|---|---|
| 17.1 | Look at all three fields. | No AM or PM appears anywhere on the page. Every time reads as two digits, a colon, two digits. Midnight reads **00:00**, not 12:00 AM. One o'clock in the afternoon reads **13:00**, not 1:00 PM. |
| 17.2 | Click the Starts field once, on its **hour** half. | The field takes focus and the hour is highlighted. |
| 17.3 | Press the up arrow repeatedly from 09:00 until you pass noon. | The hour counts 10, 11, 12, **13**, 14. It must not go back to 1, and no AM or PM must appear. This is the originally reported fault. |
| 17.4 | Set the hour to 23 and press up once more. | It reads **00**. The clock wraps to the start of the day rather than stopping. |
| 17.5 | Press the down arrow once from 00. | It reads **23**. The wrap works in both directions. |
| 17.6 | Click directly on the **minute** half of the Starts field. | The minutes highlight, not the hours. Clicking a segment must select that segment. |
| 17.7 | With the minutes selected, press the up arrow. | The minutes count up one at a time. Starts accepts any minute. |
| 17.8 | Press the right and left arrow keys. | Focus moves between the hour and minute halves without changing the time. |
| 17.9 | With the hour selected, type **1** then **4**. | The field shows 14. A single digit that cannot begin a legal hour, such as 9, should resolve on its own without waiting for a second. |
| 17.10 | Type **14:15** into Starts and click elsewhere. | It keeps 14:15 exactly. Starts does not round. |
| 17.11 | In the **From** field, select the minutes and press the up arrow several times. | The minutes go 00, 30, 00, carrying the hour as they wrap. If the field starts on some other value, because the app proposed a time following an existing block, the first press moves it onto 00 or 30 and it stays there afterwards. |
| 17.12 | Type **22** into the From field's minutes. | It settles on **30**, the nearer of the two values the field accepts. |
| 17.13 | Type **45** into the From field's minutes. | It settles on **30**. Going back to 30 rather than forward to the next hour is deliberate: the hour is a segment you did not touch, and moving it would be the greater surprise. Report it if it feels wrong, but it is not a fault. |
| 17.14 | Press Tab from the field before Starts, through Starts, to the field after it. | Each clock field is a **single** tab stop. Tab must not have to be pressed twice to get past one. |
| 17.14a | Move to the minute half of a field with the right arrow, Tab away, then Shift-Tab back to it. | Focus returns to the **minute** half, not the hour. This is correct: the field remembers where you were, the way the native control did. |
| 17.15 | Focus a clock field, type one digit, then press Backspace. | The field goes back to the time it was showing before you typed. Nothing anywhere reads "NaN". The rest of the page does not react to a half-entered time at all: the Add block button keeps whatever state it had, which is correct, since a partial entry is not a new time and must not be treated as one. |
| 17.16 | Set Until past the end of your day, for example 07:00 on a day ending at 05:00, then click away. | It pulls back to the end of the day. It must not do this while you are still typing, only once you leave the field. |
| 17.17 | Set a block with the fields, press Add block, and check the list below. | The block appears with exactly the times the fields showed, in 24-hour form. |

**Reporting note.** If AM or PM appears anywhere at all, or if an hour refuses to
pass 12, record the step and your computer's language and region settings. Those
settings used to decide this behaviour and no longer should.

---

## Interface Overhaul Flows (18 to 24)

These flows cover the `interface-overhaul` work. Each is tagged with the delivery
phase whose boundary it gates: a phase is not finished until its flows pass, which
is acceptance criterion AC-IO-01.

Flows 1 to 17 above still apply. Several describe the old two-page layout and name
"the dashboard"; read that as the **Today** screen. Where an older flow says a
control is revealed by hovering a task row, that is exactly what Flow 21 checks has
changed.

### Flow 18: Navigation and the three screens **[P1]**

| Step | Action | Expected result |
|---|---|---|
| 18.1 | Sign in and look at where you land. | You are on **Today**. The address bar reads `/today`. |
| 18.2 | Type `http://localhost:5173/` and press enter. | You arrive at Today, and the address bar reads `/today`. |
| 18.3 | Find the navigation. | Today, History and Settings are all visible at once. You can tell which one you are on without reading the page content. |
| 18.4 | Click each of the three in turn. | Each loads its own screen. Nothing flashes a loading state for data that was already on screen a moment ago. |
| 18.5 | Press the browser Back button twice. | You return through the screens you visited, in order. |
| 18.6 | Open `http://localhost:5173/settings` directly. | Settings loads. This path worked before the overhaul and must still work. |
| 18.7 | Type a path that does not exist, such as `/nonsense`. | Today loads. No error page. |
| 18.8 | Reach every screen using only the Tab and Enter keys. | Possible, and the focused item is always visibly marked. |
| 18.9 | Sign out. | The navigation disappears along with the rest of the app, and you land on the sign-in screen. It must not linger. |
| 18.10 | Stop the API with `docker compose stop api`, then reload. | You see the API-unreachable message, with **no navigation bar**. Restart with `docker compose start api`. |
| 18.11 | Turn off your network, then reload. | You see the offline message, not the API-unreachable one. The difference matters: one blames your connection, the other blames the server. |

### Flow 19: Dark mode, contrast and width **[P1]**

The colour half of this flow failed when it was written, which is why it exists.
Four of the seven colours changed with the scheme and three did not; all eight
roles now do, and three values moved to clear WCAG AA, which they did not before
in either scheme. Run it as verification, not as a known failure.

| Step | Action | Expected result |
|---|---|---|
| 19.1 | Set your operating system to light mode and open Today. | Light background, dark text. |
| 19.2 | Switch the system to dark mode without reloading. | The whole app follows immediately. |
| 19.3 | In dark mode, over-commit the day so the risk dot appears. | The orange dot is clearly legible against the dark background. It must not look washed out or glaring. |
| 19.4 | In dark mode, complete a task and look at the green marker. | Legible against dark, not a light-mode green sitting on a dark panel. |
| 19.5 | In dark mode, open History and look at the heatmap. | Every filled square is legible. Compare against light mode: both should read well, neither should look like the other mode's colours borrowed. |
| 19.6 | In dark mode, trigger an error, for example by adding a fifth primary task. | The warning text is legible against dark. |
| 19.7 | Narrow the browser window to 375px wide. Visit all three screens. | Nothing is cut off and the page never scrolls sideways. Only up and down. |
| 19.8 | At 375px, find the section links (Today, History, Settings). | They are in a bar along the bottom of the screen, reachable with a thumb, and they appear in exactly one place. The slim bar at the top stays, carrying only the Doer name, your name and Sign out. That is correct: the sections move, the header does not. |
| 19.9 | Widen to full screen and revisit all three. | Navigation is back at the top. Content does not stretch into one unreadably wide line. |
| 19.10 | At 375px, open History. | The heatmap fits or scrolls sideways **within its own box**. The page itself still must not scroll sideways. |
| 19.11 | At 375px, open Settings and use the day timeline. | The timeline is usable by touch. Blocks can be read and removed. |

### Flow 20: The four-slot day header **[P2]**

| Step | Action | Expected result |
|---|---|---|
| 20.1 | Start a day with no tasks and look at the top of Today. | Four empty slots. The first two are marked differently from the last two. |
| 20.2 | Add one task as one of today's four. | One slot fills. The marking on the first two slots is still visible, and the header indicates the day cannot be scored yet. |
| 20.3 | Add a second. | Two slots filled, and the scoring-floor marking is **gone**. The day can now be scored. |
| 20.4 | Add a third and a fourth. | Three then four slots filled. At four, the header says so. |
| 20.5 | Try to add a fifth as one of the four. | Refused, with a message offering a way forward. The control that enacts that way forward is **clickable**, not greyed out. |
| 20.6 | Click that control. | The task is added as an extra. This is the single most important step in this flow: a greyed-out remedy was a real defect once. |
| 20.7 | Add enough work to exceed the time your day holds. | A small orange dot appears near the day. |
| 20.8 | Watch for anything else. | **Nothing else happens.** No popup, no banner, no sound, no browser notification, no red. If anything demands your attention, that is a failure. |
| 20.9 | Remove work until you are back under. | The dot disappears. |
| 20.10 | Read the two time figures under the slots. | They say what you have committed and what comfortably fits. Both in hours and minutes, not decimals. |

### Flow 21: Task rows, entry and starting work **[P2]**

| Step | Action | Expected result |
|---|---|---|
| 21.1 | Look at a task row **without moving your mouse over it**. | Start, Edit, Promote and Delete are all visible as icons. They were invisible until hover before this change, which is what this step exists to catch. |
| 21.2 | On a phone or in a touch simulator, tap a task row's actions. | They work. There is no hover on touch, so a control only reachable by hover is unreachable. |
| 21.3 | Tab to a task row and operate its actions with the keyboard alone. | Each action is reachable and activatable. The focused one is visibly marked. |
| 21.4 | Find the two ways to add a task. | Both are visible and read as a pair. One adds what you type directly; the other proposes tasks for you to confirm. Which is which is obvious without clicking. |
| 21.5 | Add a task with the direct path. | It appears immediately in the list. |
| 21.6 | Use the assistant path and describe two or three things in a sentence. | Proposed tasks appear. **Nothing is added yet.** |
| 21.7 | Edit one proposal's title, then confirm. | Exactly what is on screen is what gets added. |
| 21.8 | Repeat 21.6 and choose to discard. | Nothing is added. |
| 21.9 | Start a task. | The row changes to show it is in progress, and elapsed time is shown. |
| 21.10 | Start a second task while the first is still running. | Allowed. Both show as in progress. This is deliberate: there is no way to un-start a task, so blocking the second would trap you. |
| 21.11 | Start the same task twice. | Nothing happens the second time and no error appears. |
| 21.12 | Complete a task you started, wait a few minutes first. | It moves to the completed section, and the time it actually took is recorded. |
| 21.13 | Complete a task you never started. | It completes normally. No actual time is recorded, which is correct. |
| 21.14 | Drag a task onto a different group heading. | The move is ignored. Tasks reorder only within their own group. |
| 21.15 | Let tasks carry over to a new day so some are pushed out of the four. | A notice names which tasks were moved out. It must still be there. |

### Flow 22: History, statistics and day detail **[P3]**

| Step | Action | Expected result |
|---|---|---|
| 22.1 | Open History. | The heatmap has room to breathe. Both views, Tasks done and Days kept, are still switchable, and the explanation below still reads. |
| 22.2 | Look above the heatmap. | A rolling 7-day success rate, a current streak, and days kept in the period. |
| 22.3 | Click a square for a day on which you did work. | You go to that day's own view. The address bar shows the date. |
| 22.4 | Read that view. | It shows what you committed, what fit, the verdict, and the tasks of that day with which were finished. |
| 22.5 | Reload the page while on it. | The same day is still shown. The address is a real link you could send to yourself. |
| 22.6 | Go back, then click a square for a day you never used. | A clear "nothing was scheduled" message. Not an error, not a blank screen. |
| 22.7 | Click today's square. | Today's view opens. It is open and unscored, and says so rather than showing a verdict. |
| 22.8 | Edit the address to a date far in the past, before you ever used the app. | Nothing-scheduled state. No error. |
| 22.9 | Edit the address to a future date, and then to nonsense such as `/history/banana`. | Handled gracefully both times. No crash, no blank page, no raw error text. |
| 22.10 | Check the streak against your own history. | Days you failed reset it to zero. Days with too little scheduled to score are **skipped**: they neither add to the streak nor break it. |
| 22.11 | Have a day with a task that is still waiting for its estimate, then watch Today. | The estimate arrives on its own within a few seconds. You should never have to reload to see it. This is a known fragile coupling; report it immediately if a reload is required. |
| 22.12 | With your day shifted past midnight, finish a task at 01:00 and check History. | It counts on the day that **began the previous afternoon**, not on the new calendar date. This is the whole point of the logical day. |

### Flow 23: Settings, motion and polish **[P4]**

| Step | Action | Expected result |
|---|---|---|
| 23.1 | Open Settings. | Day shape and the block editor. The long paragraph explaining focus time and the percentage is gone, replaced by compact figures carrying the same numbers. |
| 23.2 | Check those figures against what the paragraph used to say. | Same numbers, fewer words. If a number is now missing rather than shortened, report it. |
| 23.3 | Run Flow 16 and Flow 17 again in full. | Both pass unchanged. The timeline drag and the 24-hour clock fields must survive the restyle. |
| 23.4 | Turn on "Reduce motion" in your operating system's accessibility settings and reload. | Nothing animates anywhere. Things appear and disappear instantly. |
| 23.5 | Turn it off again. | Completing, adding and promoting a task animate smoothly. |
| 23.6 | Open each screen with a slow connection, using the browser's network throttling. | Each shows a designed waiting state naming what it is waiting for. Not the bare word "Loading", and never a screen full of zeroes presented as real figures. |
| 23.7 | Sign in to an account with no tasks and no blocks at all. | Each screen explains what to do next. Not a blank area and not the bare words "Nothing planned yet". |
| 23.8 | Stop the API with `docker compose stop api`, then visit each of the three screens in turn. | Each says plainly that it could not load, and which other screens still work. None of them sits on a waiting state forever, and none shows zeroes as though they were real. Restart with `docker compose start api`. |

### Flow 24: Design judgment pass **[all phases]**

Like Flow 15, this has no assertion in code. It is the reason the overhaul was
requested, and a reviewer's "no" here is a failure regardless of what else passed.

| Step | Action | Expected result |
|---|---|---|
| 24.1 | Open Today on a normal day with three pending and one completed task. | The pending tasks are the clear focus. Completed work is present but recessed. |
| 24.2 | Ask someone who has never seen the app to find their history, then add a task. | They manage both without being told where to look. |
| 24.3 | Look at the type across all three screens. | Sizes form a deliberate scale. You should not be able to find two headings of the same rank at different sizes. |
| 24.4 | Look at the spacing between sections across all three screens. | Consistent. Gaps are not visibly arbitrary. |
| 24.5 | Compare light and dark side by side. | Both look designed. Neither reads as the other with the colours flipped. |
| 24.6 | Use the app for one real day, end to end. | Nothing interrupted you, nothing notified you, the day's outcome was unambiguous, and opening it was not unpleasant. |
| 24.7 | State plainly whether it still looks like it was assembled rather than designed. | If it does, say so and say where. That answer outranks every passing test above it. |
