import { formatDuration, offsetToClock } from "../lib/daytime";
import type { PreferenceBlock } from "../lib/types";

/**
 * The day as a single bar, start to end, with blocks in position.
 *
 * Worth the pixels because the thing a person actually needs to know here is not
 * a list of ranges, it is the shape: how much is spoken for, how much counts as
 * capacity, and where the gaps are.
 */
export function DayTimeline({
  blocks,
  dayStart,
  dayDurationMinutes,
  preview,
}: {
  blocks: PreferenceBlock[];
  dayStart: string;
  dayDurationMinutes: number;
  preview?: { start: number; end: number; isFocus: boolean; invalid?: boolean } | null;
}) {
  const percent = (minutes: number) => (minutes / dayDurationMinutes) * 100;

  return (
    <div className="mt-4">
      <div className="relative h-9 w-full overflow-hidden rounded-md border border-[var(--color-line)] bg-black/[0.03] dark:bg-white/[0.03]">
        {blocks.map((block) => (
          <div
            key={block.id}
            title={`${block.kind.replace("_", " ")}: ${offsetToClock(block.start_offset_minutes, dayStart)} to ${offsetToClock(block.end_offset_minutes, dayStart)}`}
            style={{
              left: `${percent(block.start_offset_minutes)}%`,
              width: `${percent(block.end_offset_minutes - block.start_offset_minutes)}%`,
            }}
            className={
              "absolute inset-y-0 border-r border-[var(--color-paper)] " +
              (block.is_focus
                ? "bg-[color-mix(in_srgb,var(--color-success)_55%,transparent)]"
                : "bg-[color-mix(in_srgb,var(--color-muted)_28%,transparent)]")
            }
          />
        ))}

        {preview && (
          <div
            style={{
              left: `${percent(preview.start)}%`,
              width: `${percent(preview.end - preview.start)}%`,
            }}
            className={
              "absolute inset-y-0 border-2 border-dashed " +
              (preview.invalid
                ? "border-[var(--color-failure)] bg-[var(--color-failure)]/15"
                : "border-[var(--color-ink)] bg-[var(--color-ink)]/10")
            }
          />
        )}
      </div>

      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-[var(--color-muted)]">
        <span>{offsetToClock(0, dayStart)}</span>
        <span>{formatDuration(dayDurationMinutes)} long</span>
        <span>{offsetToClock(dayDurationMinutes, dayStart)}</span>
      </div>
    </div>
  );
}
