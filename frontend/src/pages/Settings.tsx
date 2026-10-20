import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { DayTimeline } from "../components/DayTimeline";
import {
  endForStart,
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
  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-medium tracking-tight">Settings</h1>
        <Link to="/" className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]">
          Back
        </Link>
      </header>

      <DayShapeForm user={user} />
      <BlocksEditor user={user} />
    </div>
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
    <section className="mt-10">
      <h2 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Your day</h2>

      <div className="mt-4 flex flex-wrap items-end gap-6 text-sm">
        <Field label="Starts">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="bg-transparent outline-none"
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
          <span className="ml-1 text-[var(--color-muted)]">hours</span>
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
          <span className="ml-1 text-[var(--color-muted)]">% of focus time</span>
        </Field>
      </div>

      <p className="mt-3 text-xs text-[var(--color-muted)]">
        Your day ends at {endsAt}. Changes apply from your next day, never to one
        already underway.
      </p>

      <button
        onClick={() => save.mutate()}
        className="mt-4 rounded-md border border-[var(--color-line)] px-3 py-1.5 text-xs
                   hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
      >
        {save.isPending ? "Saving" : "Save"}
      </button>

      {save.error instanceof ApiError && (
        <p className="mt-2 text-xs text-[var(--color-risk)]">{String(save.error.message)}</p>
      )}
    </section>
  );
}

function BlocksEditor({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const { data: blocks = [] } = useBlocks();

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.blocks }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/settings/blocks/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.blocks }),
  });

  const focusMinutes = blocks
    .filter((b) => b.is_focus)
    .reduce((sum, b) => sum + (b.end_offset_minutes - b.start_offset_minutes), 0);
  const thresholdMinutes = Math.round(focusMinutes * user.capacity_ratio);

  return (
    <section className="mt-14">
      <h2 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
        How your day is split
      </h2>
      <p className="mt-2 max-w-prose text-xs leading-relaxed text-[var(--color-muted)]">
        Mark out when you work, when you are on personal projects, and when you are
        off. Only <span className="text-[var(--color-ink)]">work</span> and{" "}
        <span className="text-[var(--color-ink)]">personal project</span> time counts
        toward what Doer thinks you can take on.
      </p>

      <DayTimeline
        blocks={blocks}
        dayStart={dayStart}
        dayDurationMinutes={user.day_duration_minutes}
        preview={
          "start" in range
            ? { start: range.start, end: range.end, isFocus: FOCUS_KINDS.includes(kind), invalid: collision !== null }
            : null
        }
      />

      <ul className="mt-5 space-y-1 text-sm">
        {blocks.map((block) => (
          <li key={block.id} className="group flex items-center gap-3 py-1">
            <span
              className={
                "h-2.5 w-2.5 shrink-0 rounded-sm " +
                (block.is_focus
                  ? "bg-[color-mix(in_srgb,var(--color-success)_55%,transparent)]"
                  : "bg-[color-mix(in_srgb,var(--color-muted)_28%,transparent)]")
              }
            />
            <span className="w-36 shrink-0">{PREFERENCE_LABELS[block.kind]}</span>
            <span className="tabular-nums text-[var(--color-muted)]">
              {offsetToClock(block.start_offset_minutes, dayStart)} to{" "}
              {offsetToClock(block.end_offset_minutes, dayStart)}
            </span>
            <span className="text-xs text-[var(--color-muted)]">
              {formatDuration(block.end_offset_minutes - block.start_offset_minutes)}
            </span>
            <button
              onClick={() => remove.mutate(block.id)}
              className="ml-auto text-xs text-[var(--color-muted)] opacity-0
                         transition-opacity hover:text-[var(--color-failure)] group-hover:opacity-100"
            >
              Remove
            </button>
          </li>
        ))}
        {blocks.length === 0 && (
          <li className="text-sm text-[var(--color-muted)]">
            Nothing marked out yet. Add a work block below and Doer can start telling
            you what fits.
          </li>
        )}
      </ul>

      <div className="mt-6 rounded-md border border-[var(--color-line)] p-4">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--color-muted)]">What kind of time</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as PreferenceKind)}
              className="border-b border-[var(--color-line)] bg-transparent pb-1 outline-none"
            >
              {Object.entries(PREFERENCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                  {FOCUS_KINDS.includes(value as PreferenceKind) ? " (counts)" : ""}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--color-muted)]">From</span>
            <input
              type="time"
              value={from}
              onChange={(e) => {
                edited.current = true;
                const next = e.target.value;
                setFrom(next);
                // Carry the end along rather than leaving a dead end the app
                // already knows how to resolve.
                const adjusted = endForStart(next, to, dayStart, user.day_duration_minutes);
                if (adjusted) setTo(adjusted);
              }}
              className="border-b border-[var(--color-line)] bg-transparent pb-1 tabular-nums outline-none"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--color-muted)]">Until</span>
            <input
              type="time"
              value={to}
              onChange={(e) => {
                edited.current = true;
                setTo(e.target.value);
              }}
              className="border-b border-[var(--color-line)] bg-transparent pb-1 tabular-nums outline-none"
            />
          </label>

          <button
            onClick={() => add.mutate()}
            disabled={!valid}
            className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-xs
                       transition-colors hover:bg-black/[0.03] disabled:opacity-40
                       dark:hover:bg-white/[0.05]"
          >
            Add block
          </button>
        </div>

        <p className="mt-3 text-xs text-[var(--color-muted)]">
          {valid && "start" in range ? (
            <>
              {formatDuration(range.end - range.start)} of{" "}
              {PREFERENCE_LABELS[kind].toLowerCase()}, shown dashed above.
              {range.end === user.day_duration_minutes && " Runs to the very end of your day."}
            </>
          ) : collision ? (
            <span className="text-[var(--color-risk)]">
              That overlaps your{" "}
              {PREFERENCE_LABELS[collision.kind as PreferenceKind].toLowerCase()} block
              at {offsetToClock(collision.start_offset_minutes, dayStart)} to{" "}
              {offsetToClock(collision.end_offset_minutes, dayStart)}. Blocks cannot
              share time.
            </span>
          ) : "error" in range && range.error.kind === "start_outside_day" ? (
            <span className="text-[var(--color-risk)]">
              That starts outside your day, which runs {range.error.dayStartsAt} to{" "}
              {range.error.dayEndsAt}.
            </span>
          ) : "error" in range && range.error.kind === "past_day_end" ? (
            <span className="text-[var(--color-risk)]">
              That ends at {range.error.endsAt}, after your day finishes at{" "}
              {range.error.dayEndsAt}.
            </span>
          ) : (
            <span className="text-[var(--color-risk)]">Pick an end time after the start.</span>
          )}
        </p>

        {add.error instanceof ApiError && (
          <p className="mt-2 text-xs text-[var(--color-risk)]">{add.error.message}</p>
        )}
      </div>

      {focusMinutes > 0 && (
        <p className="mt-5 max-w-prose text-xs leading-relaxed text-[var(--color-muted)]">
          That is {formatDuration(focusMinutes)} of focus time a day. At{" "}
          {Math.round(user.capacity_ratio * 100)}%, Doer will quietly flag any day you
          commit to more than {formatDuration(thresholdMinutes)} of work, before
          meetings are taken off.
        </p>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[var(--color-muted)]">{label}</span>
      <span className="border-b border-[var(--color-line)] pb-1">{children}</span>
    </label>
  );
}

function computeEnd(startTime: string, hours: number): string {
  const [h, m] = startTime.split(":").map(Number);
  const total = h * 60 + m + Math.round(hours * 60);
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const nextDay = total >= 24 * 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}${nextDay ? " the next day" : ""}`;
}
