import { useState } from "react";
import { asRuleError } from "../lib/api";
import { useCreateTask } from "../lib/hooks";
import { MAX_PRIMARIES, PREFERENCE_LABELS, type PreferenceKind } from "../lib/types";

export function AddTask({ primariesUsed }: { primariesUsed: number }) {
  const slotsFull = primariesUsed >= MAX_PRIMARIES;

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  // Decided when the form opens rather than at mount: at mount the task list has
  // usually not loaded yet, so primariesUsed is still zero and the default would
  // land on a choice the day cannot accept.
  const [isPrimary, setIsPrimary] = useState(true);
  const [kind, setKind] = useState<PreferenceKind>("deep_work");
  const create = useCreateTask();

  const rule = asRuleError(create.error);
  const blocked = slotsFull && isPrimary;

  function add(asPrimary: boolean) {
    const trimmed = title.trim();
    if (!trimmed) return;
    create.mutate(
      { title: trimmed, is_primary: asPrimary, preference_kind: kind },
      {
        onSuccess: () => {
          setTitle("");
          setIsPrimary(!slotsFull);
          setOpen(false);
        },
      },
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (blocked) return;
    add(isPrimary);
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setIsPrimary(!slotsFull);
          setOpen(true);
        }}
        aria-label="Add a task"
        className="fixed bottom-8 right-8 h-11 w-11 rounded-full border border-[var(--color-line)]
                   bg-[var(--color-paper)] text-lg leading-none shadow-sm
                   transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
      >
        +
      </button>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 border-t border-[var(--color-line)] bg-[var(--color-paper)] p-6">
      <form onSubmit={submit} className="mx-auto max-w-2xl space-y-3">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          className="w-full border-b border-[var(--color-line)] bg-transparent pb-2 text-sm
                     outline-none placeholder:text-[var(--color-muted)]"
        />

        <div className="flex flex-wrap items-center gap-4 text-xs">
          <label className="flex items-center gap-2">
            {/* Never disabled. Disabling it while checked made the remedy the
                error message suggests physically unreachable. */}
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
            />
            <span>
              One of today&rsquo;s four{" "}
              <span className="text-[var(--color-muted)]">
                ({slotsFull ? "all four taken" : `${primariesUsed} of ${MAX_PRIMARIES} used`})
              </span>
            </span>
          </label>

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

          <span className="text-[var(--color-muted)]">
            Doer works out how long it takes.
          </span>

          <div className="ml-auto flex gap-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[var(--color-muted)]"
            >
              Cancel
            </button>
            <button type="submit" disabled={blocked} className="font-medium disabled:opacity-40">
              Add
            </button>
          </div>
        </div>

        {blocked ? (
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--color-muted)]">
            <span>
              Today&rsquo;s four are taken. Free a slot by demoting one, or keep this
              as an extra.
            </span>
            <button
              type="button"
              onClick={() => add(false)}
              className="font-medium text-[var(--color-ink)] underline underline-offset-2"
            >
              Add as an extra
            </button>
          </p>
        ) : (
          rule && (
            <p className="text-xs text-[var(--color-risk)]">
              {rule.message}
              {rule.remedy && <span className="text-[var(--color-muted)]">. {rule.remedy}</span>}
            </p>
          )
        )}
      </form>
    </div>
  );
}
