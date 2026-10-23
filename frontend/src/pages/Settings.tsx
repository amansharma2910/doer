import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { ClockInput } from "../components/ClockInput";
import { DayTimeline } from "../components/DayTimeline";
import { Problem, Waiting } from "../components/states";
import {
  clampEndToDay,
  dayEndClock,
  endForStart,
  isClock,
  findOverlap,
  firstFreeGap,
  formatDuration,
  offsetToClock,
  toOffsets,
} from "../lib/daytime";
import { keys, useBlocks } from "../lib/hooks";
import {
  FOCUS_KINDS,
  PREFERENCE_LABELS,
  type PreferenceBlock,
  type PreferenceKind,
  type User,
} from "../lib/types";

export function Settings({ user }: { user: User }) {
  // No page container and no Back link: the shell supplies the column, and the
  // navigation bar is a better way back than a one-way link to Today was.
  return (
    <>
      <header className="border-b border-line pb-4">
        <h1 className="text-body font-medium">Settings</h1>
        <p className="mt-1 text-note text-muted">
          When your day runs, and how it is divided. Both feed what Doer thinks you
          can take on.
        </p>
      </header>

      <DayShapeForm user={user} />
      <BlocksEditor user={user} />
    </>
  );
}

function DayShapeForm({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [startTime, setStartTime] = useState(user.day_start_time.slice(0, 5));
  const [hours, setHours] = useState(user.day_duration_minutes / 60);
  // Held as a percentage because that is how people think about load.
  // The API takes a ratio, so it is converted on the way out.
  const [loadPercent, setLoadPercent] = useState(Math.round(user.capacity_ratio * 100));

  const save = useMutation({
    mutationFn: () =>
      api<unknown>("/settings/day-shape", {
        method: "PATCH",
        body: JSON.stringify({
          day_start_time: `${startTime}:00`,
          day_duration_minutes: Math.round(hours * 60),
          capacity_ratio: Number((loadPercent / 100).toFixed(2)),
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.me }),
  });

  const endsAt = computeEnd(startTime, hours);

  return (
    <section className="mt-section">
      <h2 className="text-note uppercase tracking-wide text-muted">Your day</h2>

      <div className="mt-4 flex flex-wrap items-end gap-6 text-body">
        <Field label="Starts">
          <ClockInput
            label="Day start"
            value={startTime}
            onChange={setStartTime}
          />
        </Field>
        <Field label="Runs for">
          <input
            type="number"
            min={1}
            max={24}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="w-16 bg-transparent tabular-nums outline-none"
          />
          <span className="ml-1 text-muted">hours</span>
        </Field>
        <Field label="Comfortable load">
          <input
            type="number"
            min={10}
            max={100}
            step={5}
            value={loadPercent}
            onChange={(e) => setLoadPercent(Number(e.target.value))}
            className="w-14 bg-transparent tabular-nums outline-none"
          />
          <span className="ml-1 text-muted">% of focus time</span>
        </Field>
      </div>

      {/* Was a sentence. The end time is derived from two fields a few
          centimetres away, so it belongs beside them as a figure. The caveat
          that follows it is the only part that needed words. */}
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
        <Derived label="Ends at" value={endsAt} />
      </dl>
      <p className="mt-2 text-note text-muted">
        Changes apply from your next day, never to one already underway.
      </p>

      <button
        onClick={() => save.mutate()}
        className="mt-4 rounded-control border border-line px-3 py-1.5 text-note
                   hover:bg-wash"
      >
        {save.isPending ? "Saving" : "Save"}
      </button>

      {save.error instanceof ApiError && (
        <p className="mt-2 text-note text-risk">{String(save.error.message)}</p>
      )}
    </section>
  );
}

function BlocksEditor({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { data: blocks = [], isPending, error } = useBlocks();

  const dayStart = user.day_start_time.slice(0, 5);
  const [kind, setKind] = useState<PreferenceKind>("deep_work");
  const [from, setFrom] = useState(() => offsetToClock(60, dayStart));
  const [to, setTo] = useState(() => offsetToClock(300, dayStart));
  const edited = useRef(false);

  // Point the form at the first free stretch rather than at a slot that is
  // already taken, so the first thing someone tries does not fail.
  useEffect(() => {
    if (edited.current) return;
    const gap = firstFreeGap(blocks, user.day_duration_minutes);
    if (gap) {
      setFrom(offsetToClock(gap.start, dayStart));
      setTo(offsetToClock(gap.end, dayStart));
    }
  }, [blocks, dayStart, user.day_duration_minutes]);

  const range = toOffsets(from, to, dayStart, user.day_duration_minutes);
  const collision =
    "start" in range ? findOverlap(range.start, range.end, blocks) : null;
  const valid = "start" in range && collision === null;

  /**
   * Refetch everything a block edit can move.
   *
   * Two properties, both learned the hard way and both held by
   * `useTaskMutation` already.
   *
   * It runs on `onSettled`, not `onSuccess`, so the interface reconciles with
   * the server even when the client believes the request failed. A delete that
   * committed server-side while the browser saw a transport error used to leave
   * the row on screen indefinitely.
   *
   * It invalidates the day and the heatmap as well as the blocks, because the
   * server recomputes the open day's capacity on every block create and delete
   * (`_apply_to_open_day`). Invalidating only the blocks left Today showing
   * committed-against-fits figures for a day shape that no longer existed.
   */
  function refreshAfterBlockChange() {
    queryClient.invalidateQueries({ queryKey: keys.blocks });
    queryClient.invalidateQueries({ queryKey: ["day"] });
    queryClient.invalidateQueries({ queryKey: ["heatmap"] });
  }

  const add = useMutation({
    mutationFn: () => {
      if (!("start" in range)) throw new Error("invalid range");
      return api<PreferenceBlock>("/settings/blocks", {
        method: "POST",
        body: JSON.stringify({
          kind,
          start_offset_minutes: range.start,
          end_offset_minutes: range.end,
        }),
      });
    },
    onSuccess: () => {
      // Hand the form back to the suggestion logic, so it moves to the next free
      // stretch instead of sitting on the range it just created and reporting an
      // overlap against the user's own new block. Only on success: there is no
      // new block to move past if the add was refused.
      edited.current = false;
    },
    onSettled: refreshAfterBlockChange,
  });

  const remove = useMutation({
    mutationFn: (id: string) => {
      // Claim the form before the request goes out. Without this the suggestion
      // effect fires on the refetched list, `firstFreeGap` returns the slot the
      // delete just freed, and the dashed window reappears exactly where the
      // block was, still carrying its kind. A successful delete then looks
      // identical to a failed one. The effect was written for the add case,
      // where moving to the next free stretch is the point.
      edited.current = true;
      return api<void>(`/settings/blocks/${id}`, { method: "DELETE" });
    },
    onSettled: refreshAfterBlockChange,
  });

  const focusMinutes = blocks
    .filter((b) => b.is_focus)
    .reduce((sum, b) => sum + (b.end_offset_minutes - b.start_offset_minutes), 0);
  const thresholdMinutes = Math.round(focusMinutes * user.capacity_ratio);

  return (
    <section className="mt-section">
      <h2 className="text-note uppercase tracking-wide text-muted">
        How your day is split
      </h2>
      <p className="mt-2 max-w-prose text-note leading-relaxed text-muted">
        Mark out when you work, when you are on personal projects, and when you are
        off. Only <span className="text-ink">work</span> and{" "}
        <span className="text-ink">personal project</span> time counts
        toward what Doer thinks you can take on.
      </p>

      {isPending && <Waiting>Loading how your day is split.</Waiting>}
      {error && (
        <Problem title="Your blocks could not be loaded.">
          The timeline below shows an empty day, which is not necessarily what you
          have configured.
        </Problem>
      )}

      <DayTimeline
        blocks={blocks}
        dayStart={dayStart}
        dayDurationMinutes={user.day_duration_minutes}
        preview={
          "start" in range
            ? { start: range.start, end: range.end, isFocus: FOCUS_KINDS.includes(kind), invalid: collision !== null }
            : null
        }
        // Claim the form before the first move, so a refetch landing mid-gesture
        // cannot hand the window back to the suggestion logic.
        onGestureStart={() => {
          edited.current = true;
        }}
        onPreviewChange={(start, end) => {
          // Also claimed here, not only in onGestureStart, so the invariant is
          // local to the write rather than spread across two callbacks that a
          // future caller could pair incorrectly.
          edited.current = true;
          setFrom(offsetToClock(start, dayStart));
          setTo(offsetToClock(end, dayStart));
        }}
      />

      <ul className="mt-5 space-y-1 text-body">
        {blocks.map((block) => (
          <li key={block.id} className="flex items-start gap-3 py-1">
            <span
              className={
                "h-2.5 w-2.5 shrink-0 rounded-mark " +
                (block.is_focus
                  ? "bg-focus-block"
                  : "bg-rest-block")
              }
            />
            {/* Wraps instead of holding a fixed 9rem label column. At 375px the
                old row came to roughly 350px of content in 327px of space. */}
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
              <span className="sm:w-36">{PREFERENCE_LABELS[block.kind]}</span>
              <span className="tabular-nums text-muted">
                {offsetToClock(block.start_offset_minutes, dayStart)} to{" "}
                {offsetToClock(block.end_offset_minutes, dayStart)}
              </span>
              <span className="text-note text-muted">
                {formatDuration(block.end_offset_minutes - block.start_offset_minutes)}
              </span>
            </span>
            {/* Always present. Revealing it on hover made it unreachable by
                touch, which M12 makes a defect rather than a trade-off. */}
            <button
              onClick={() => remove.mutate(block.id)}
              className="shrink-0 text-note text-muted transition-colors hover:text-failure"
            >
              Remove
            </button>
          </li>
        ))}
        {blocks.length === 0 && (
          <li className="text-body text-muted">
            Nothing marked out yet. Add a work block below and Doer can start telling
            you what fits.
          </li>
        )}
      </ul>

      {remove.error instanceof ApiError && (
        <p className="mt-2 text-note text-risk">
          That block could not be removed. {remove.error.message}
        </p>
      )}

      <div className="mt-6 rounded-control border border-line p-4">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3 text-body">
          <label className="flex flex-col gap-1">
            <span className="text-note text-muted">What kind of time</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as PreferenceKind)}
              className="border-b border-line bg-transparent pb-1 outline-none"
            >
              {Object.entries(PREFERENCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                  {FOCUS_KINDS.includes(value as PreferenceKind) ? " (counts)" : ""}
                </option>
              ))}
            </select>
          </label>

          {/* From and Until are one wrap unit. A start time on one row and its
              end on the next reads as two unrelated fields rather than a range,
              and the pair is narrow enough to sit together even at 375px. */}
          <div className="flex items-end gap-x-5">
          <label className="flex flex-col gap-1">
            <span className="text-note text-muted">From</span>
            <ClockInput
              label="Block start"
              value={from}
              minuteStep={30}
              onChange={(next) => {
                edited.current = true;
                setFrom(next);
                // Carry the end along rather than leaving a dead end the app
                // already knows how to resolve.
                const adjusted = endForStart(next, to, dayStart, user.day_duration_minutes);
                if (adjusted) setTo(adjusted);
              }}
              className="border-b border-line pb-1"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-note text-muted">
              Until{" "}
              <span className="opacity-70">
                (to {dayEndClock(dayStart, user.day_duration_minutes)} at the latest)
              </span>
            </span>
            <ClockInput
              label="Block end"
              value={to}
              minuteStep={30}
              onChange={(next) => {
                edited.current = true;
                setTo(next);
              }}
              onCommit={(settled) => {
                // Cap at the end of the day once the edit is finished rather than
                // mid-keystroke: typing 1 on the way to 14 momentarily reads
                // 01:00, which the cap would otherwise rewrite to the day's end.
                // Clamped against the settled value rather than `to`, which a
                // digit resolving in this same event has not yet updated.
                const capped = clampEndToDay(from, settled, dayStart, user.day_duration_minutes);
                if (capped) setTo(capped);
              }}
              className="border-b border-line pb-1"
            />
          </label>
          </div>

          <button
            onClick={() => add.mutate()}
            disabled={!valid}
            className="rounded-control border border-line px-3 py-1.5 text-note
                       transition-colors hover:bg-wash disabled:opacity-40"
          >
            Add block
          </button>
        </div>

        <p className="mt-3 text-note text-muted">
          {valid && "start" in range ? (
            <>
              {formatDuration(range.end - range.start)} of{" "}
              {PREFERENCE_LABELS[kind].toLowerCase()}, shown dashed above.
              {range.end === user.day_duration_minutes && " Runs to the very end of your day."}
            </>
          ) : collision ? (
            <span className="text-risk">
              That overlaps your{" "}
              {PREFERENCE_LABELS[collision.kind as PreferenceKind].toLowerCase()} block
              at {offsetToClock(collision.start_offset_minutes, dayStart)} to{" "}
              {offsetToClock(collision.end_offset_minutes, dayStart)}. Blocks cannot
              share time.
            </span>
          ) : "error" in range && range.error.kind === "start_outside_day" ? (
            <span className="text-risk">
              That starts outside your day, which runs {range.error.dayStartsAt} to{" "}
              {range.error.dayEndsAt}.
            </span>
          ) : "error" in range && range.error.kind === "past_day_end" ? (
            <span className="text-risk">
              That ends at {range.error.endsAt}, past the {range.error.dayEndsAt} end
              of your day. Anything up to {range.error.dayEndsAt} works, including
              after midnight.
            </span>
          ) : "error" in range && range.error.kind === "unreadable" ? (
            <span className="text-risk">
              Finish typing both times before adding the block.
            </span>
          ) : (
            <span className="text-risk">Pick an end time after the start.</span>
          )}
        </p>

        {add.error instanceof ApiError && (
          <p className="mt-2 text-note text-risk">{add.error.message}</p>
        )}
      </div>

      {/* Three numbers, where four lines of prose said the same thing. The one
          element the user marked unnecessary on 2026-10-23; the figures it
          carried are kept, the sentences around them are not. */}
      {focusMinutes > 0 && (
        <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-2 border-t border-line pt-4">
          <Derived label="Focus time a day" value={formatDuration(focusMinutes)} />
          {/* Comfortable load is not repeated here. It is a field a few
              centimetres above, and a figure that only echoes an input is
              noise wearing the costume of a summary. */}
          <Derived
            label="Flagged above"
            value={formatDuration(thresholdMinutes)}
            note={`at ${Math.round(user.capacity_ratio * 100)}%, before meetings`}
          />
        </dl>
      )}
    </section>
  );
}

/** A number the app worked out, rather than one you typed. */
function Derived({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-note uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-body tabular-nums">
        {value}
        {note && <span className="ml-1 text-note text-muted">{note}</span>}
      </dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-note text-muted">{label}</span>
      <span className="border-b border-line pb-1">{children}</span>
    </label>
  );
}

function computeEnd(startTime: string, hours: number): string {
  if (!isClock(startTime)) return "an unreadable time";
  const [h, m] = startTime.split(":").map(Number);
  const total = h * 60 + m + Math.round(hours * 60);
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const nextDay = total >= 24 * 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}${nextDay ? " the next day" : ""}`;
}
