import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { keys, useBlocks } from "../lib/hooks";
import { PREFERENCE_LABELS, type PreferenceBlock, type PreferenceKind, type User } from "../lib/types";

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
  const [ratio, setRatio] = useState(user.capacity_ratio);

  const save = useMutation({
    mutationFn: () =>
      api<unknown>("/settings/day-shape", {
        method: "PATCH",
        body: JSON.stringify({
          day_start_time: `${startTime}:00`,
          day_duration_minutes: Math.round(hours * 60),
          capacity_ratio: ratio,
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
            min={0.1}
            max={1}
            step={0.05}
            value={ratio}
            onChange={(e) => setRatio(Number(e.target.value))}
            className="w-16 bg-transparent tabular-nums outline-none"
          />
          <span className="ml-1 text-[var(--color-muted)]">of focus time</span>
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
  const [kind, setKind] = useState<PreferenceKind>("deep_work");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(4);

  const add = useMutation({
    mutationFn: () =>
      api<PreferenceBlock>("/settings/blocks", {
        method: "POST",
        body: JSON.stringify({
          kind,
          start_offset_minutes: Math.round(from * 60),
          end_offset_minutes: Math.round(to * 60),
        }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.blocks }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/settings/blocks/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.blocks }),
  });

  const focusHours =
    blocks.filter((b) => b.is_focus).reduce((sum, b) => sum + (b.end_offset_minutes - b.start_offset_minutes), 0) / 60;

  return (
    <section className="mt-14">
      <h2 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
        How your day is split
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted)]">
        Times are hours into your day, not clock times, so a block can cross midnight
        without any fuss. Only work and personal project blocks count as capacity.
      </p>

      <ul className="mt-4 space-y-1 text-sm">
        {blocks.map((block) => (
          <li key={block.id} className="group flex items-center gap-3 py-1">
            <span className="w-36 shrink-0">{PREFERENCE_LABELS[block.kind]}</span>
            <span className="tabular-nums text-[var(--color-muted)]">
              {clockFor(user, block.start_offset_minutes)} to{" "}
              {clockFor(user, block.end_offset_minutes)}
            </span>
            {block.is_focus && (
              <span className="text-xs text-[var(--color-success)]">counts</span>
            )}
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
            No blocks yet, so Doer cannot tell you what fits.
          </li>
        )}
      </ul>

      <div className="mt-5 flex flex-wrap items-end gap-4 text-sm">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as PreferenceKind)}
          className="border-b border-[var(--color-line)] bg-transparent pb-1 outline-none"
        >
          {Object.entries(PREFERENCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <Field label="From hour">
          <input
            type="number"
            min={0}
            step={0.5}
            value={from}
            onChange={(e) => setFrom(Number(e.target.value))}
            className="w-14 bg-transparent tabular-nums outline-none"
          />
        </Field>
        <Field label="To hour">
          <input
            type="number"
            min={0.5}
            step={0.5}
            value={to}
            onChange={(e) => setTo(Number(e.target.value))}
            className="w-14 bg-transparent tabular-nums outline-none"
          />
        </Field>
        <button
          onClick={() => add.mutate()}
          className="rounded-md border border-[var(--color-line)] px-3 py-1.5 text-xs
                     hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
        >
          Add block
        </button>
      </div>

      {add.error instanceof ApiError && (
        <p className="mt-2 text-xs text-[var(--color-risk)]">{String(add.error.message)}</p>
      )}

      {focusHours > 0 && (
        <p className="mt-4 text-xs text-[var(--color-muted)]">
          {focusHours} focus hours a day, so Doer will flag a day past{" "}
          {(focusHours * user.capacity_ratio).toFixed(1)} hours of work, before
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

function clockFor(user: User, offsetMinutes: number): string {
  const [h, m] = user.day_start_time.split(":").map(Number);
  const total = h * 60 + m + offsetMinutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function computeEnd(startTime: string, hours: number): string {
  const [h, m] = startTime.split(":").map(Number);
  const total = h * 60 + m + Math.round(hours * 60);
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  const nextDay = total >= 24 * 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}${nextDay ? " the next day" : ""}`;
}
