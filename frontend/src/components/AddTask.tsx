import { useState } from "react";
import { ApiError } from "../lib/api";
import { useCreateTask } from "../lib/hooks";
import { PREFERENCE_LABELS, type PreferenceKind, type RuleError } from "../lib/types";

export function AddTask({ primariesUsed }: { primariesUsed: number }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [isPrimary, setIsPrimary] = useState(true);
  const [kind, setKind] = useState<PreferenceKind>("deep_work");
  const create = useCreateTask();

  const rule = asRuleError(create.error);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    create.mutate(
      { title: title.trim(), is_primary: isPrimary, preference_kind: kind },
      {
        onSuccess: () => {
          setTitle("");
          setOpen(false);
        },
      },
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
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
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
              disabled={primariesUsed >= 4}
            />
            <span className={primariesUsed >= 4 ? "text-[var(--color-muted)]" : undefined}>
              One of today&rsquo;s four {primariesUsed >= 4 && "(all four taken)"}
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
            <button type="submit" className="font-medium">
              Add
            </button>
          </div>
        </div>

        {rule && (
          <p className="text-xs text-[var(--color-risk)]">
            {rule.message}
            {rule.remedy && <span className="text-[var(--color-muted)]">. {rule.remedy}</span>}
          </p>
        )}
      </form>
    </div>
  );
}

/** The API attaches a remedy to contract refusals so the interface can offer a way forward. */
export function asRuleError(error: unknown): RuleError | null {
  if (!(error instanceof ApiError)) return null;
  const { detail } = error;
  if (typeof detail === "object" && detail !== null && "code" in detail) {
    return detail as RuleError;
  }
  return { message: error.message, code: "unknown", remedy: null };
}
