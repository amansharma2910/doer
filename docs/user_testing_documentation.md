# User Testing Documentation

## How to Use This Document

This document contains step-by-step manual test instructions for human testers. You do not need to have seen the codebase. Each flow lists numbered steps giving the exact action to take and the observable result to expect. Report any step whose actual result differs from the expected result, quoting the flow name and step number.

## Before You Start

**Starting the app.** From the project root:

```bash
docker compose up -d
docker compose exec api alembic upgrade head   # first run only, or after an update
```

Wait until `docker compose logs api` reports application startup complete. The API container listens on port 8000 internally and is published on **8787**, so the startup line says 8000 while you reach it at `http://localhost:8787`. Open the app at `http://localhost:5173`.

If every page errors immediately after a fresh checkout, the migration step above was almost certainly skipped. Nothing runs it automatically.

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
| 1.5 | Sign out and sign back in. | Sign-in completes without showing the consent screen again. |
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
| 12.7 | Stop your machine's network connection and reload. | The app does not hang or error on the calendar. The last synced snapshot is used, and a staleness indicator appears if it predates the day start. |

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
