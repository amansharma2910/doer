import { useRef } from "react";
import {
  formatDuration,
  offsetToClock,
  resizeWindow,
  slideWindow,
  stepEdge,
  stepWindow,
} from "../lib/daytime";
import type { PreferenceBlock } from "../lib/types";

type Grip = "body" | "start" | "end";

type Gesture = {
  grip: Grip;
  originX: number;
  start: number;
  end: number;
  pixelsPerMinute: number;
};

/**
 * The day as a single bar, start to end, with blocks in position.
 *
 * Worth the pixels because the thing a person actually needs to know here is not
 * a list of ranges, it is the shape: how much is spoken for, how much counts as
 * capacity, and where the gaps are.
 *
 * The preview window is also the control. Pass `onPreviewChange` and it can be
 * dragged and resized directly; leave it off and the bar is read-only, as it was.
 * All placement logic lives in `daytime.ts`, so what remains here is the part a
 * pure function cannot do: turn pixels into minutes.
 */
export function DayTimeline({
  blocks,
  dayStart,
  dayDurationMinutes,
  preview,
  onPreviewChange,
  onGestureStart,
}: {
  blocks: PreferenceBlock[];
  dayStart: string;
  dayDurationMinutes: number;
  preview?: { start: number; end: number; isFocus: boolean; invalid?: boolean } | null;
  onPreviewChange?: (start: number, end: number) => void;
  onGestureStart?: () => void;
}) {
  const percent = (minutes: number) => (minutes / dayDurationMinutes) * 100;
  const barRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const draggable = Boolean(onPreviewChange) && preview != null;

  function beginGesture(event: React.PointerEvent<HTMLElement>, grip: Grip) {
    if (!draggable || !preview) return;
    const width = barRef.current?.getBoundingClientRect().width ?? 0;
    // Before layout settles the bar has no width, and dividing by it would turn
    // every drag into Infinity minutes.
    if (width === 0) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    // preventDefault above suppresses the focus this press would otherwise give,
    // so grant it explicitly: grabbing a handle should leave the arrows working.
    event.currentTarget.focus();
    gesture.current = {
      grip,
      originX: event.clientX,
      start: preview.start,
      end: preview.end,
      pixelsPerMinute: width / dayDurationMinutes,
    };
    // Set before the first move, not after. A blocks refetch arriving mid-press
    // would otherwise re-seed the form out from under the gesture.
    onGestureStart?.();
  }

  function moveGesture(event: React.PointerEvent<HTMLElement>) {
    const active = gesture.current;
    if (!active || !onPreviewChange) return;
    // Handles sit inside the window, so without this a captured move runs the
    // placement twice: once on the handle, once again as it bubbles.
    event.stopPropagation();

    const delta = (event.clientX - active.originX) / active.pixelsPerMinute;
    const next =
      active.grip === "body"
        ? slideWindow(active.start, active.end - active.start, delta, dayStart, dayDurationMinutes, blocks)
        : resizeWindow(active.grip, active.start, active.end, delta, dayStart, dayDurationMinutes, blocks);
    onPreviewChange(next.start, next.end);
  }

  function endGesture(event: React.PointerEvent<HTMLElement>) {
    gesture.current = null;
    // pointerup releases capture implicitly, pointercancel does not reliably.
    // An element left capturing would retarget the next press anywhere on the page.
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onArrowKey(event: React.KeyboardEvent<HTMLElement>, grip: Grip) {
    if (!preview || !onPreviewChange) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    event.preventDefault();
    event.stopPropagation();
    const forward = event.key === "ArrowRight";
    const next =
      grip === "body"
        ? stepWindow(preview.start, preview.end - preview.start, forward, dayStart, dayDurationMinutes, blocks)
        : stepEdge(grip, preview.start, preview.end, forward, dayStart, dayDurationMinutes, blocks);
    onGestureStart?.();
    onPreviewChange(next.start, next.end);
  }

  const gestureHandlers = draggable
    ? {
        onPointerMove: moveGesture,
        onPointerUp: endGesture,
        onPointerCancel: endGesture,
        onLostPointerCapture: endGesture,
      }
    : {};

  return (
    <div className="mt-4">
      <div className="relative">
        <div
          ref={barRef}
          className="relative h-9 w-full overflow-hidden rounded-control border border-line bg-wash"
        >
          {blocks.map((block) => (
            <div
              key={block.id}
              title={`${block.kind.replace("_", " ")}: ${offsetToClock(block.start_offset_minutes, dayStart)} to ${offsetToClock(block.end_offset_minutes, dayStart)}`}
              style={{
                left: `${percent(block.start_offset_minutes)}%`,
                width: `${percent(block.end_offset_minutes - block.start_offset_minutes)}%`,
              }}
              className={
                "absolute inset-y-0 border-r border-paper " +
                (block.is_focus
                  ? "bg-focus-block"
                  : "bg-rest-block")
              }
            />
          ))}
        </div>

        {/* The window rides above the bar rather than inside it, so its handles can
            overhang its edges. A 30 minute window is barely 13 pixels wide on a
            24 hour day, and the bar's own clipping would otherwise shave a handle
            off entirely at either end of the day. Transparent to the pointer
            except where the window actually is, so block tooltips still work. */}
        <div className="pointer-events-none absolute inset-0">
          {preview && (
            <div
              style={{
                left: `${percent(preview.start)}%`,
                width: `${percent(preview.end - preview.start)}%`,
              }}
              className={
                "absolute inset-y-0 border-2 border-dashed " +
                (preview.invalid
                  ? "border-failure bg-failure/15"
                  : "border-ink bg-ink/10") +
                (draggable
                  ? " pointer-events-auto cursor-grab touch-none select-none active:cursor-grabbing" +
                    " focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" +
                    " focus-visible:outline-focus"
                  : "")
              }
              tabIndex={draggable ? 0 : undefined}
              aria-label={
                draggable
                  ? `New block, ${offsetToClock(preview.start, dayStart)} to ${offsetToClock(preview.end, dayStart)}. Arrow keys move it.`
                  : undefined
              }
              onPointerDown={draggable ? (e) => beginGesture(e, "body") : undefined}
              onKeyDown={draggable ? (e) => onArrowKey(e, "body") : undefined}
              {...gestureHandlers}
            >
              {draggable && (
                <>
                  <Handle
                    edge="start"
                    offset={preview.start}
                    dayStart={dayStart}
                    dayDurationMinutes={dayDurationMinutes}
                    invalid={preview.invalid}
                    onPointerDown={(e) => beginGesture(e, "start")}
                    onKeyDown={(e) => onArrowKey(e, "start")}
                    {...gestureHandlers}
                  />
                  <Handle
                    edge="end"
                    offset={preview.end}
                    dayStart={dayStart}
                    dayDurationMinutes={dayDurationMinutes}
                    invalid={preview.invalid}
                    onPointerDown={(e) => beginGesture(e, "end")}
                    onKeyDown={(e) => onArrowKey(e, "end")}
                    {...gestureHandlers}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-1 flex justify-between text-caption tabular-nums text-muted">
        <span>{offsetToClock(0, dayStart)}</span>
        <span>{formatDuration(dayDurationMinutes)} long</span>
        <span>{offsetToClock(dayDurationMinutes, dayStart)}</span>
      </div>
    </div>
  );
}

/**
 * A grab zone on one edge of the window.
 *
 * Centred on the edge and wider than it, so it stays usable when the window
 * itself is only a few pixels across.
 */
function Handle({
  edge,
  offset,
  dayStart,
  dayDurationMinutes,
  invalid,
  ...handlers
}: {
  edge: "start" | "end";
  offset: number;
  dayStart: string;
  dayDurationMinutes: number;
  invalid?: boolean;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={edge === "start" ? "Block start" : "Block end"}
      aria-valuemin={0}
      aria-valuemax={dayDurationMinutes}
      aria-valuenow={offset}
      aria-valuetext={offsetToClock(offset, dayStart)}
      style={{ [edge === "start" ? "left" : "right"]: "-6px" }}
      className={
        "pointer-events-auto absolute inset-y-0 w-3 cursor-ew-resize touch-none select-none" +
        " before:absolute before:inset-y-1 before:left-1/2 before:w-0.5 before:-translate-x-1/2" +
        " before:rounded-full before:content-['']" +
        (invalid
          ? " before:bg-failure"
          : " before:bg-ink") +
        " focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1" +
        " focus-visible:outline-focus"
      }
      {...handlers}
    />
  );
}
