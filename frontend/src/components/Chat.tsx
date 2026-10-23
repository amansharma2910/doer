import { useState } from "react";
import { formatMinutes, useChat, useConfirmProposal } from "../lib/hooks";
import { PREFERENCE_LABELS, type ProposedTask } from "../lib/types";

/**
 * The assistant path: describe the day, get a proposal, confirm it.
 *
 * It never commits anything on its own. The proposal is editable and nothing
 * exists until confirmed, which is the contract that separates this from the
 * direct path sitting beside it in the dock.
 */
export function ChatPanel({ onDone }: { onDone: () => void }) {
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

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-note text-muted">
          Describe the day. Doer proposes tasks; nothing is added until you confirm.
        </p>
        <button onClick={onDone} className="text-note text-muted hover:text-ink">
          Cancel
        </button>
      </div>

      <form onSubmit={send} className="mt-3">
        <input
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What do you want to get done today?"
          aria-label="Message to Doer"
          onKeyDown={(e) => e.key === "Escape" && onDone()}
          className="w-full border-b border-line bg-transparent pb-2 text-body
                     outline-none placeholder:text-muted"
        />
      </form>

      {chat.isPending && (
        <p className="mt-3 text-note text-muted">Thinking</p>
      )}

      {chat.isError && (
        <p className="mt-3 text-note text-risk">
          Doer is unavailable right now. Adding a task directly still works.
        </p>
      )}

      {proposed && proposed.length === 0 && (
        <p className="mt-3 text-note text-muted">
          Nothing task-shaped in that, so nothing was added.
        </p>
      )}

      {proposed && proposed.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-note text-muted">
            Nothing has been added yet. Edit anything, then confirm.
          </p>
          {proposed.map((task, index) => (
            <div key={index} className="flex items-center gap-3">
              <input
                value={task.title}
                onChange={(e) => editTitle(index, e.target.value)}
                className="min-w-0 flex-1 border-b border-line bg-transparent
                           pb-1 text-body outline-none"
              />
              <span className="shrink-0 text-note text-muted">
                {PREFERENCE_LABELS[task.preference_kind]} · {formatMinutes(task.estimate_minutes)}
              </span>
            </div>
          ))}
          <div className="flex justify-end gap-3 pt-2 text-note">
            <button onClick={discard} className="text-muted">
              Discard
            </button>
            <button
              onClick={commit}
              className="rounded-control border border-line px-3 py-1.5 font-medium
                         transition-colors hover:bg-wash"
            >
              Add {proposed.length === 1 ? "it" : `all ${proposed.length}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
