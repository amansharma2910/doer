import { useRef, useState } from "react";
import {
  formatClock,
  isClock,
  parseClock,
  snapMinute,
  stepClock,
  stepToMultiple,
} from "../lib/daytime";

type Segment = "hour" | "minute";

/**
 * A 24-hour clock field.
 *
 * Replaces `<input type="time">`, which cannot be made to show a 24-hour clock:
 * the format comes from the browser's locale, and neither the `lang` attribute
 * nor any CSS reaches it. On a 12-hour locale the native control also splits into
 * three segments, so arrows on the hour cycle 1 to 12 without touching AM/PM,
 * which reads as the hour refusing to advance. Every other time surface in this
 * app is already 24-hour, so the native control was the only one disagreeing.
 *
 * The value contract is the native one, `HH:MM` in and `HH:MM` out, so nothing
 * downstream changes. All arithmetic lives in `daytime.ts`; this file is the
 * segment bookkeeping that a pure function cannot do.
 *
 * The component holds no copy of the value, so a caller must echo back what it
 * emits. Transforming the value inside `onChange` would leave the segment the
 * user is not editing reading from a stale prop. Callers that need to adjust a
 * finished edit, such as capping an end time, use `onCommit` instead, which is
 * handed the settled value precisely so it never has to read a stale one.
 */
export function ClockInput({
  value,
  onChange,
  onCommit,
  minuteStep = 1,
  label,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  /** Fired with the settled value when editing finishes, for callers that clamp. */
  onCommit?: (value: string) => void;
  /** 30 restricts entry to :00 and :30. Constrains entry only, never display. */
  minuteStep?: number;
  label: string;
  className?: string;
}) {
  const [segment, setSegment] = useState<Segment>("hour");
  // Digits typed but not yet resolved into a value. Held here rather than pushed
  // upward so a half-typed "1" on the way to "14" never reaches the form, where
  // it would read as a real and quite different time.
  const [typed, setTyped] = useState("");
  const host = useRef<HTMLDivElement>(null);

  const safe = isClock(value) ? value : "00:00";
  const hour = Math.floor(parseClock(safe) / 60);
  const minute = parseClock(safe) % 60;

  function show(which: Segment, actual: number): string {
    if (segment === which && typed) return typed.padStart(2, "0");
    return String(actual).padStart(2, "0");
  }

  function emit(nextHour: number, nextMinute: number): string {
    const next = formatClock(nextHour * 60 + nextMinute);
    onChange(next);
    return next;
  }

  /** Move the caret, carrying focus with it so the segment roles stay honest. */
  function moveTo(next: Segment) {
    setTyped("");
    setSegment(next);
    host.current?.querySelector<HTMLElement>(`[data-segment="${next}"]`)?.focus();
  }

  function acceptDigit(digit: string) {
    const combined = typed + digit;
    const asNumber = Number(combined);

    if (segment === "hour") {
      // One digit is enough whenever a second could not make a legal hour, so 9
      // resolves immediately while 1 waits to see if 4 follows.
      if (combined.length === 1 && asNumber <= 2) {
        setTyped(combined);
        return;
      }
      // A pair that overshoots is read as a fresh start, not clamped: someone who
      // typed 2 then 4 meant 04, and pinning them to 23 would make them retype.
      const resolved = combined.length === 2 && asNumber > 23 ? Number(digit) : asNumber;
      emit(resolved, minute);
      moveTo("minute");
      return;
    }

    if (combined.length === 1 && asNumber <= 5) {
      setTyped(combined);
      return;
    }
    emit(hour, snapMinute(Math.min(asNumber, 59), minuteStep));
    setTyped("");
  }

  /** Resolve any pending digit. Returns the value now in force. */
  function settle(): string {
    if (!typed) return safe;
    const asNumber = Number(typed);
    const next =
      segment === "hour"
        ? emit(Math.min(asNumber, 23), minute)
        : emit(hour, snapMinute(Math.min(asNumber, 59), minuteStep));
    setTyped("");
    return next;
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const { key } = event;

    if (key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault();
      const forward = key === "ArrowUp";
      setTyped("");
      onChange(
        segment === "hour"
          ? stepClock(safe, forward ? 60 : -60)
          : stepToMultiple(safe, minuteStep, forward),
      );
      return;
    }

    if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      settle();
      moveTo(key === "ArrowLeft" ? "hour" : "minute");
      return;
    }

    if (/^[0-9]$/.test(key)) {
      event.preventDefault();
      acceptDigit(key);
      return;
    }

    if (key === "Backspace" || key === "Delete") {
      event.preventDefault();
      setTyped("");
      return;
    }

    if (key === ":" || key === "Enter") {
      event.preventDefault();
      settle();
    }
  }

  return (
    <div
      ref={host}
      role="group"
      aria-label={`${label}, 24 hour clock`}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        // A press on a segment must focus that segment. Done here rather than on
        // the span so the pending digit settles against the segment it was typed
        // into, which is still the one in state at this moment.
        const picked = (event.target as HTMLElement)
          .closest("[data-segment]")
          ?.getAttribute("data-segment");
        event.preventDefault();
        settle();
        moveTo(picked === "minute" ? "minute" : "hour");
      }}
      onBlur={(event) => {
        // Focus moving between the two segments is not leaving the field.
        if (host.current?.contains(event.relatedTarget as Node | null)) return;
        onCommit?.(settle());
      }}
      className={"inline-flex items-baseline tabular-nums " + className}
    >
      <Part
        segment="hour"
        label={`${label} hour`}
        active={segment === "hour"}
        text={show("hour", hour)}
        now={hour}
        max={23}
        spoken={String(hour).padStart(2, "0")}
      />
      <span aria-hidden="true" className="px-px text-muted">
        :
      </span>
      <Part
        segment="minute"
        label={`${label} minute`}
        active={segment === "minute"}
        text={show("minute", minute)}
        now={minute}
        max={59}
        spoken={String(minute).padStart(2, "0")}
      />
    </div>
  );
}

/**
 * One segment, as a spinbutton.
 *
 * Focusable, but only one at a time: the inactive segment holds `tabIndex={-1}`,
 * so the field is a single tab stop as the native control was, while assistive
 * technology still gets a real value to announce on each arrow press. A plain
 * span would have left the selected segment legible only as a background colour.
 */
function Part({
  text,
  spoken,
  now,
  max,
  active,
  segment,
  label,
}: {
  /** What is drawn, which during entry is the digits typed so far. */
  text: string;
  /**
   * What is announced, which is always the committed value.
   *
   * Not `text`: a pending 1 on the way to 14 is a sighted hint that the field is
   * mid-edit, and the same string spoken aloud would assert that the time is now
   * one in the morning. `aria-valuenow` carries the committed number, so letting
   * `aria-valuetext` carry the pending one would have the two contradict, and
   * most assistive technology prefers the text.
   */
  spoken: string;
  now: number;
  max: number;
  active: boolean;
  segment: Segment;
  label: string;
}) {
  return (
    <span
      data-segment={segment}
      role="spinbutton"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={now}
      aria-valuetext={spoken}
      tabIndex={active ? 0 : -1}
      className={
        "cursor-default rounded-mark px-0.5 outline-none " +
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 " +
        "focus-visible:outline-focus " +
        (active ? "bg-ink text-paper" : "")
      }
    >
      {text}
    </span>
  );
}
