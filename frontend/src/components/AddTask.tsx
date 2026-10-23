import { useState } from "react";
import { asRuleError } from "../lib/api";
import { useCreateTask } from "../lib/hooks";
import { MAX_PRIMARIES, PREFERENCE_LABELS, type PreferenceKind } from "../lib/types";

/**
 * The direct path: what you type is what gets added.
 *
 * P2 took the floating plus button off this component. It renders only the form
 * now, inside the shared entry dock, beside the assistant. The two were
 * previously a round button in one corner and a text link in the body of the
 * page, with nothing to say that they did the same job by different means.
 */
export function AddTaskForm({
  primariesUsed,
  onDone,
}: {
  primariesUsed: number;
  onDone: () => void;
}) {
  const slotsFull = primariesUsed >= MAX_PRIMARIES;

  const [title, setTitle] = useState("");
  // Seeded when the form mounts rather than at app start. The dock mounts this
  // on open, by which point the task list has loaded; at app start
  // primariesUsed is still zero and the default would land on a choice the day
  // cannot accept.
  const [isPrimary, setIsPrimary] = useState(!slotsFull);
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
          onDone();
        },
      },
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (blocked) return;
    add(isPrimary);
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone()}
        placeholder="What needs doing?"
        aria-label="Task title"
        className="w-full border-b border-line bg-transparent pb-2 text-body
                   outline-none placeholder:text-muted"
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-note">
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
            <span className="text-muted">
              ({slotsFull ? "all four taken" : `${primariesUsed} of ${MAX_PRIMARIES} used`})
            </span>
          </span>
        </label>

        <select
          aria-label="Kind of time"
          value={kind}
          onChange={(e) => setKind(e.target.value as PreferenceKind)}
          className="border-b border-line bg-transparent pb-1 outline-none"
        >
          {Object.entries(PREFERENCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <span className="text-muted">Doer works out how long it takes.</span>

        <div className="ml-auto flex items-center gap-3">
          <button type="button" onClick={onDone} className="text-muted hover:text-ink">
            Cancel
          </button>
          <button
            type="submit"
            disabled={blocked}
            className="rounded-control border border-line px-3 py-1.5 font-medium
                       transition-colors hover:bg-wash disabled:opacity-40"
          >
            {create.isPending ? "Adding" : "Add"}
          </button>
        </div>
      </div>

      {blocked ? (
        <p className="flex flex-wrap items-center gap-x-2 text-note text-muted">
          <span>
            Today&rsquo;s four are taken. Free a slot by demoting one, or keep this as
            an extra.
          </span>
          <button
            type="button"
            onClick={() => add(false)}
            className="font-medium text-ink underline underline-offset-2"
          >
            Add as an extra
          </button>
        </p>
      ) : (
        rule && (
          <p className="text-note text-risk">
            {rule.message}
            {rule.remedy && <span className="text-muted">. {rule.remedy}</span>}
          </p>
        )
      )}
    </form>
  );
}
