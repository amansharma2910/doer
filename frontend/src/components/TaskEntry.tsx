import { useState } from "react";
import { AddTaskForm } from "./AddTask";
import { ChatPanel } from "./Chat";
import { ChatIcon, PlusIcon } from "./icons";

type Mode = "closed" | "manual" | "assistant";

/**
 * The two ways into the day, presented as one thing.
 *
 * Before this they were a round plus button pinned to the bottom-right corner
 * and a text link reading "Talk to Doer" sitting in the body of the page.
 * Nothing connected them, and nothing said that one commits immediately while
 * the other proposes for confirmation. They are now two controls on one
 * surface, in the same band, in the same visual language, and the labels carry
 * the distinction: "Add a task" does it, "Ask Doer" suggests it.
 *
 * The user chose to keep both paths rather than merge them into a single
 * composer, so the difference is made legible instead of hidden.
 */
export function TaskEntry({ primariesUsed }: { primariesUsed: number }) {
  const [mode, setMode] = useState<Mode>("closed");
  const close = () => setMode("closed");

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-dock z-10 px-gutter sm:bottom-8">
      <div
        className="pointer-events-auto mx-auto max-w-2xl rounded-panel border border-line
                   bg-raised shadow-float"
      >
        {mode === "closed" ? (
          <div className="flex items-stretch">
            <DockButton
              label="Add a task"
              hint="Added straight away"
              icon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setMode("manual")}
            />
            <span aria-hidden="true" className="my-3 w-px bg-line" />
            <DockButton
              label="Ask Doer"
              hint="Proposes, you confirm"
              icon={<ChatIcon className="h-4 w-4" />}
              onClick={() => setMode("assistant")}
            />
          </div>
        ) : (
          <div className="p-5">
            {mode === "manual" ? (
              <AddTaskForm primariesUsed={primariesUsed} onDone={close} />
            ) : (
              <ChatPanel onDone={close} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DockButton({
  label,
  hint,
  icon,
  onClick,
}: {
  label: string;
  hint: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-2 rounded-panel px-4 py-3
                 text-body transition-colors hover:bg-wash
                 focus-visible:outline focus-visible:outline-2
                 focus-visible:-outline-offset-2 focus-visible:outline-focus"
    >
      <span className="text-muted">{icon}</span>
      <span className="font-medium">{label}</span>
      {/* The distinction between the two paths, stated rather than implied.
          Hidden on the narrowest screens, where the labels alone have to do. */}
      <span className="hidden text-note text-muted sm:inline">{hint}</span>
    </button>
  );
}
