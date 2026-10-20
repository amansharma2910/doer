import { useState } from "react";
import { formatMinutes, useChat, useConfirmProposal } from "../lib/hooks";
import { PREFERENCE_LABELS, type ProposedTask } from "../lib/types";

/**
 * Collapsed by default, and it never commits anything on its own. The assistant
 * returns a proposal; tasks exist only once the user confirms.
 */
export function Chat() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [turnId, setTurnId] = useState<string | null>(null);
  const [proposed, setProposed] = useState<ProposedTask[] | null>(null);
  const [editedCount, setEditedCount] = useState(0);

  const chat = useChat();
  const confirm = useConfirmProposal();

  function send(event: React.FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    chat.mutate(message.trim(), {
      onSuccess: (data) => {
        setTurnId(data.turn_id);
        setProposed(data.tasks);
        setEditedCount(0);
        setMessage("");
      },
    });
  }

  function editTitle(index: number, title: string) {
    if (!proposed) return;
    const next = [...proposed];
    next[index] = { ...next[index], title };
    setProposed(next);
    setEditedCount((n) => n + 1);
  }

  function commit() {
    if (!turnId || !proposed) return;
    confirm.mutate(
      { turn_id: turnId, tasks: proposed, edited_count: editedCount, discarded_count: 0 },
      { onSuccess: () => { setProposed(null); setTurnId(null); } },
    );
  }

  function discard() {
    if (!turnId) return;
    confirm.mutate(
      { turn_id: turnId, tasks: [], edited_count: 0, discarded_count: proposed?.length ?? 0 },
      { onSettled: () => { setProposed(null); setTurnId(null); } },
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      >
        Talk to Doer
      </button>
    );
  }

  return (
    <div className="rounded-md border border-[var(--color-line)] p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Doer</h3>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        >
          Close
        </button>
      </div>

      <form onSubmit={send} className="mt-3">
        <input
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What do you want to get done today?"
          className="w-full border-b border-[var(--color-line)] bg-transparent pb-2 text-sm
                     outline-none placeholder:text-[var(--color-muted)]"
        />
      </form>

      {chat.isPending && (
        <p className="mt-3 text-xs text-[var(--color-muted)]">Thinking</p>
      )}

      {chat.isError && (
        <p className="mt-3 text-xs text-[var(--color-risk)]">
          Doer is unavailable right now. The plus button still works.
        </p>
      )}

      {proposed && proposed.length === 0 && (
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Nothing task-shaped in that, so nothing was added.
        </p>
      )}

      {proposed && proposed.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-[var(--color-muted)]">
            Nothing has been added yet. Edit anything, then confirm.
          </p>
          {proposed.map((task, index) => (
            <div key={index} className="flex items-center gap-3">
              <input
                value={task.title}
                onChange={(e) => editTitle(index, e.target.value)}
                className="min-w-0 flex-1 border-b border-[var(--color-line)] bg-transparent
                           pb-1 text-sm outline-none"
              />
              <span className="shrink-0 text-xs text-[var(--color-muted)]">
                {PREFERENCE_LABELS[task.preference_kind]} · {formatMinutes(task.estimate_minutes)}
              </span>
            </div>
          ))}
          <div className="flex justify-end gap-3 pt-2 text-xs">
            <button onClick={discard} className="text-[var(--color-muted)]">
              Discard
            </button>
            <button onClick={commit} className="font-medium">
              Add {proposed.length === 1 ? "it" : `all ${proposed.length}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
