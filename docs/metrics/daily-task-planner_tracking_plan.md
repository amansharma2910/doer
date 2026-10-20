---
type: tracking_plan
feature: daily-task-planner
status: draft
review_due: null
linear_issue: null
created: 2026-10-21
updated: 2026-10-21
---

# Tracking Plan: Doer Daily Task Planner

## 1. Business Objective Anchor

From plan §2: validate that the 75% commitment contract changes behavior for a single user, before investing in multi-user capability. Secondary objective: accumulate an estimation accuracy corpus that a future version can use to calibrate per user.

Every metric below traces to one of those two. Metrics that do not are listed as rejected in §2.4, because the plan's standing instruction to "log as much as possible" otherwise produces a table nobody can query.

## 2. Metric Set

### 2.1 North star

**Rolling 7-day success rate.** Of the scoreable days in the trailing 7 (days with at least 2 scheduled primaries), the share whose verdict is success.

- Formula: `count(verdict = success) / count(verdict in (success, failure))` over the trailing 7 anchor dates.
- Neutral and unscheduled days are excluded from both numerator and denominator, never counted as failures.
- Readable from the eighth scored day onward. Reported alongside its denominator at all times, because a rate over 2 days is not the same claim as a rate over 7.

This metric directly encodes the contract the product is built around. Its known weakness is that it can be gamed by shrinking commitments, which is what the guardrails in §2.3 exist to detect.

### 2.2 Leading indicators

| Metric | Definition | Reads on |
|---|---|---|
| Scored-day coverage | Scored days divided by elapsed logical days, trailing 14 | Whether the instrument is used at all. A precondition for every other number here. |
| Over-commitment rate | Share of scoreable days flagged at risk **at any point**, trailing 14 | Whether planning is getting more realistic. Expected to fall if the contract is working. Measured from a latching flag (`logical_days.ever_at_risk`) rather than the live one: the live flag clears the moment enough work is completed, so reading it at close would record `false` for most days that were in fact flagged. |
| Estimation error | Median absolute percentage error between estimated and actual minutes, per completed task with a known actual | The secondary objective. Also the calibration baseline for a future version. |
| Carry-forward load | Median count of tasks carried forward per day, trailing 14 | Whether commitments are being met. A rising line means the day is consistently over-subscribed regardless of what the verdict says. |

### 2.3 Guardrails

These must not degrade. Each exists because the north star can be moved the wrong way without them.

| Guardrail | Threshold | Why |
|---|---|---|
| Median committed minutes per scored day | Must not decline more than 20% from the trailing 14-day baseline | Catches success-rate gains bought by committing to less. |
| Median scheduled primaries per scored day | Must not fall below 3 | Same gaming vector, counted in tasks rather than minutes. |
| Neutral-day rate | Must not exceed 25% of scored days, trailing 14 | Scheduling 1 primary makes a day unscoreable. A rising neutral rate is scoring avoidance, and it is the single easiest way to never fail. |
| Estimation latency, p95 | Under 5 seconds | Plan acceptance criterion AC-07. A slow estimate degrades the add-task flow. |
| Unestimated primary rate | Under 5% of primaries at day open | Unestimated primaries make capacity indeterminate, which silently disables the at-risk signal. |
| Inference cost per day | Under the ceilings in §5 | Keeps a single-user app from quietly becoming expensive. |

### 2.4 Rejected as vanity

Not tracked as success metrics, though some are captured as raw events for other purposes: total tasks created (rewards logging, not completing), total chat messages sent (rewards talking to the assistant), cumulative completed tasks (monotonic, never signals a problem), session count and time in app (Doer's design intent is less time in app, not more), and total days used without the scored qualifier.

## 3. Event Taxonomy

Naming is snake_case `object_action`. Every event carries these base properties implicitly and they are not repeated per event: `event_id` (uuid), `user_id`, `occurred_at` (timestamptz UTC), `logical_day_id` and `anchor_date` where a logical day is in scope, and `schema_version` (integer, starting at 1).

**Instrumentation constraint, binding on all events:** each event row is written inside the same database transaction as the state change it records. This is what makes acceptance criterion AC-08 ("exactly one event row per transition") provable rather than aspirational, and it is why events are not emitted from an after-request hook or a background publisher. A transaction that rolls back takes its event with it.

### 3.1 Identity and calendar

| Event | Required properties | Fires at |
|---|---|---|
| `user_signed_in` | `method` (always `google`), `is_first_sign_in` | Auth callback handler, after session establishment |
| `calendar_connected` | `scope` (`calendar.freebusy`), `granted_at` | Auth callback handler, when a refresh token is first stored |
| `calendar_revoked` | `detected_at`, `reason` (`invalid_grant`, `user_revoked`, `refresh_failed`) | Token refresh path, on a terminal refresh failure |
| `calendar_queried` | `window_start`, `window_end`, `calendar_count`, `interval_count`, `busy_minutes_total`, `latency_ms`, `source` (`live`, `cache`), `is_stale` | Calendar service, after each `freebusy.query` resolves or falls back |
| `calendar_query_failed` | `error_class`, `http_status`, `fell_back_to` (`cache`, `none`) | Calendar service, on query failure |

### 3.2 Logical day

| Event | Required properties | Fires at |
|---|---|---|
| `logical_day_opened` | `start_at`, `end_at`, `duration_minutes`, `timezone`, `day_shape_snapshot` | Day service, in the transaction that inserts the logical day row |
| `day_capacity_computed` | `focus_block_minutes`, `busy_minutes_subtracted`, `capacity_base_minutes`, `ratio`, `threshold_minutes`, `calendar_state` (`connected`, `revoked`, `stale`, `absent`), `is_indeterminate`, `indeterminate_reason` (`no_focus_blocks`, `unestimated_primaries`, null) | Capacity service, each time capacity is recomputed |
| `day_risk_flag_raised` | `committed_minutes`, `threshold_minutes`, `primary_count` | Capacity service, on the transition from not-at-risk to at-risk |
| `day_risk_flag_cleared` | `committed_minutes`, `threshold_minutes`, `primary_count` | Capacity service, on the reverse transition |
| `logical_day_closed` | `closed_at`, `close_trigger` (`lazy_read`, `sweep`), `days_closed_in_batch` | Day service, in the transaction guarded by the uniqueness constraint on (user, anchor date) |
| `day_scored` | `total_task_count`, `scheduled_primary_count`, `completed_primary_count`, `completion_ratio`, `verdict` (`success`, `failure`, `neutral`, `unscheduled`), `was_at_risk`, `committed_minutes`, `completed_minutes` | Scoring service, in the same transaction as `logical_day_closed` |

`day_scored` is the single most important event in this plan. The north star, three of four leading indicators, and three guardrails all derive from it. It carries `total_task_count` as well as the primary counts, because without it a replay cannot distinguish a day with no tasks at all (`unscheduled`) from one with only non-primary tasks (`neutral`).

### 3.3 Tasks

| Event | Required properties | Fires at |
|---|---|---|
| `task_created` | `task_id`, `is_primary`, `preference_type`, `source` (`chat`, `manual`), `title_length`, `target_anchor_date` | Task service create, in the insert transaction |
| `task_estimated` | `task_id`, `estimate_minutes`, `raw_model_minutes`, `was_snapped`, `was_clamped`, `clamp_direction`, `model`, `input_tokens`, `output_tokens`, `latency_ms`, `attempt`, `cache_hit` | Estimation service, on a successful resolve |
| `task_estimation_failed` | `task_id`, `attempt`, `error_class`, `will_retry`, `next_attempt_at` | Estimation service, on each failed attempt |
| `task_estimate_overridden` | `task_id`, `previous_minutes`, `new_minutes`, `was_snapped` | Task service update, when the estimate field changes by user action |
| `task_started` | `task_id`, `started_at` | Task service, on the optional start action |
| `task_completed` | `task_id`, `is_primary`, `estimate_minutes`, `actual_minutes`, `carry_forward_count`, `completed_at` | Task service complete, in the update transaction |
| `task_completion_reversed` | `task_id`, `was_completed_at`, `reversed_at` | Task service, on reversal while the day is open |
| `task_completion_reversal_rejected` | `task_id`, `reason` (`day_closed`) | Task service, on a rejected reversal |
| `task_carried_forward` | `task_id`, `from_anchor_date`, `to_anchor_date`, `carry_forward_count`, `is_primary` | Day close transaction, once per carried task |
| `task_promoted` | `task_id`, `trigger` (`user`) | Task service, on non-primary to primary |
| `task_demoted` | `task_id`, `trigger` (`user`, `carry_forward_precedence`) | Task service, and the day close transaction when precedence demotes an excess pre-assigned task |
| `task_updated` | `task_id`, `fields_changed` (array) | Task service update, excluding estimate-only changes, which have their own event |
| `task_deleted` | `task_id`, `was_primary`, `carry_forward_count` | Task service delete, incomplete tasks only |
| `task_delete_rejected` | `task_id`, `reason` (`completed_immutable`) | Task service delete guard |
| `task_reordered` | `task_id`, `preference_type`, `from_index`, `to_index` | Task service reorder endpoint |
| `primary_cap_rejected` | `attempted_source` (`chat`, `manual`), `remedy_offered` | Task service create guard, on the 5th primary |

### 3.4 Assistant

| Event | Required properties | Fires at |
|---|---|---|
| `assistant_turn_sent` | `turn_id`, `input_length` | Chat endpoint, on receiving a user message |
| `assistant_proposal_returned` | `turn_id`, `proposed_task_count`, `model`, `input_tokens`, `output_tokens`, `latency_ms` | Chat service, after the model response is parsed |
| `assistant_proposal_confirmed` | `turn_id`, `confirmed_count`, `edited_count`, `discarded_count` | Chat service, on user confirmation |
| `assistant_proposal_discarded` | `turn_id`, `proposed_task_count` | Chat service, when a proposal is dismissed without confirming |

`edited_count` is the quality signal here: a rising share of edited proposals means the parse or the estimate is drifting.

## 4. Aggregate Tables

`daily_metrics`, one row per (user, anchor date), written in the day close transaction and recomputable from the event log:

`scheduled_primary_count`, `scheduled_non_primary_count`, `completed_primary_count`, `completed_non_primary_count`, `carried_in_count`, `carried_out_count`, `total_estimated_minutes`, `total_actual_minutes`, `unestimated_primary_count`, `capacity_base_minutes`, `busy_minutes_subtracted`, `threshold_minutes`, `committed_minutes`, `was_at_risk`, `is_indeterminate`, `verdict`, `completion_ratio`, `calendar_state`, `estimation_calls`, `estimation_input_tokens`, `estimation_output_tokens`, `chat_turns`, `chat_input_tokens`, `chat_output_tokens`, `inference_cost_usd`.

The aggregate table is a read convenience, never a source of truth. Test T-EVT-03 asserts it matches values derived independently from the event log, and T-EVT-04 asserts the log reproduces every stored verdict.

## 5. Unit Economics

Model assignment: **`claude-haiku-4-5` for estimation**, **`claude-opus-5` for chat parsing**.

Two API-surface consequences of using Haiku 4.5, which matter for both cost accounting and implementation:

1. `output_config.effort` is not supported on Haiku 4.5 and returns an error. Do not carry an effort setting over from the chat path.
2. Thinking on Haiku 4.5 uses the older `thinking: {type: "enabled", budget_tokens: N}` form, not adaptive thinking. For bucket estimation, omit the `thinking` parameter entirely: the task does not need reasoning, and omitting it keeps output tokens at roughly the size of the answer.

Pricing per million tokens: Haiku 4.5 at $1.00 input and $5.00 output; Opus 5 at $5.00 input and $25.00 output.

| Operation | Model | Assumed tokens | Cost per call | Ceiling |
|---|---|---|---|---|
| Task estimation | Haiku 4.5 | ~530 in, ~20 out | ~$0.0007 | $0.005 per estimate |
| Chat turn | Opus 5 | ~800 in, ~300 out | ~$0.0115 | $0.05 per turn |

Projected steady state at 10 tasks and 3 chat turns per day: about $0.04 per day, roughly **$1.30 per month**. Monthly ceiling: **$5**, which leaves nearly 4x headroom.

Cost is computed from logged token counts rather than estimated, since `task_estimated` and `assistant_proposal_returned` both carry `input_tokens` and `output_tokens`. `inference_cost_usd` on `daily_metrics` is the rollup. Prices are recorded in configuration, not hardcoded in the rollup query, so a price change does not silently rewrite history.

Two notes on cost mechanics:

- The estimation prompt is around 530 tokens, which is **below the roughly 1024-token minimum cacheable prefix**, so prompt caching will not engage and should not be assumed in the cost model. If the prompt grows past that floor, revisit.
- The estimate cache keyed on normalized task text (test T-EST-10) is a local cache, not a prompt cache, and is the main lever if volume ever rises.

## 6. Review Checkpoint

**Trigger: 30 scored days.** A usage threshold rather than a calendar date, because 30 calendar days containing 6 days of real use would produce a verdict with no evidence behind it. A scored day is one with a verdict of success or failure; neutral and unscheduled days do not count toward the threshold.

`review_due` stays `null` until release-mode sets it at ship time.

At the review, answer these in order:

1. **Was the instrument used?** Scored-day coverage over the period. Below 50% means the verdict is about adoption, not about the contract.
2. **Did the contract produce a real mix?** The distribution of success, failure, and neutral. All-success means the bar is too low; all-failure means it is too high. Either invalidates the 75% threshold as currently set.
3. **Did behavior change?** Rolling 7-day success rate in the first third of the period against the last third, read alongside the guardrails. A rising success rate with declining committed minutes is gaming, not improvement, and must be reported as such.
4. **Did the at-risk flag predict failure?** Failure rate on at-risk days against failure rate on non-at-risk days. Plan §7 criterion 3 requires better than chance. If it is not, the 50% capacity threshold is wrong and should be retuned before any further investment.
5. **Is estimation improving or static?** Estimation error trend. A flat line over 30 days means the calibration opportunity in the secondary objective is not materializing from a fixed prompt.

The verdict is written back into this file, status moves to `reviewed`, and roadmap-mode updates Business Objective Coverage. This file never edits docs/roadmap.md directly.

## 6.1 Implementation Notes (added 2026-10-21)

Recorded after the implementation so the plan and the code do not drift apart silently.

- **`task_started` is optional in practice.** The event and the endpoint exist, but nothing forces a user to start a task before completing it. `actual_minutes` is therefore populated only for tasks that were explicitly started, and the estimation-error indicator is computed over that subset. If the subset stays small, that indicator is the first thing to distrust at review time.
- **`inference_cost_usd` is zero for unpriced models.** `cost_for` returns zero rather than raising when a model is not in its price table, so pointing `ESTIMATION_MODEL` or `CHAT_MODEL` at an unlisted model silently zeroes the cost rollup instead of failing loudly. Prices are in `backend/doer/services/metrics.py`.
- **Lazy close is bounded at 400 days.** Both `close_elapsed_days` and `elapsed_anchor_dates` stop after 400 iterations to survive a misconfigured clock. A gap longer than that would close partially and silently.

## 7. Constraints on Implementation

- Events are written in the same transaction as their state change. No after-request hooks, no background publisher.
- The event log is append-only. No update or delete path exists, including for schema corrections. A correction is a new event.
- `schema_version` is stamped on every event so a later property change does not require rewriting history.
- This plan must be satisfiable without migrating the `logical_days` table or the task state machine, both of which are fixed by ADR 0001. Nothing in §3 requires either.
- No calendar event titles, descriptions, attendees, or locations appear in any event property. The `calendar.freebusy` scope means they never reach the server, and no event here reintroduces them.
- Event properties carry no raw task titles. `title_length` is logged instead, which supports estimation-quality analysis without putting user content in the metrics stream.
