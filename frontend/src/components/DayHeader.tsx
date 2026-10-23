import { Link } from "react-router-dom";
import { formatAnchorDate, localAnchorToday } from "../lib/daytime";
import { formatMinutes, useRefreshCalendar } from "../lib/hooks";
import { MAX_PRIMARIES, type LogicalDay } from "../lib/types";

/**
 * The day, led by the commitment contract rather than by the arithmetic.
 *
 * Four slots are the product. The time figures are how Doer checks the four
 * against reality, which makes them the supporting statement, not the headline.
 * Before this they were the headline and the contract was not shown at all.
 *
 * The first two slots are marked while fewer than two primaries exist, because
 * the verdict rule leaves such a day neutral and unscoreable. Without the mark
 * a one-task day looks merely quiet rather than unscoreable, which is the
 * difference between a light day and a day that cannot count. The mark is gone
 * at two, so the normal case carries no extra signal.
 */
export function DayHeader({
  day,
  primariesUsed,
}: {
  day: LogicalDay;
  primariesUsed: number;
}) {
  const refresh = useRefreshCalendar();
  const scoreable = primariesUsed >= SCORING_FLOOR;

  return (
    <section className="border-b border-line pb-5">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-heading font-medium tracking-tight">
          {formatAnchorDate(day.anchor_date, localAnchorToday())}
        </h1>
        {day.is_at_risk && <RiskDot />}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Slots used={primariesUsed} showFloor={!scoreable} />
        <p className="text-note text-muted">
          {primariesUsed === MAX_PRIMARIES ? (
            <span className="text-ink">all four taken</span>
          ) : (
            <>
              {primariesUsed} of {MAX_PRIMARIES} taken
            </>
          )}
          {!scoreable && (
            <>
              {" · "}
              <span className="text-ink">needs {SCORING_FLOOR} to score</span>
            </>
          )}
        </p>
      </div>

      <p className="mt-3 text-note text-muted">
        {day.is_indeterminate ? (
          <IndeterminateNote reason={day.indeterminate_reason} />
        ) : (
          <>
            <span className="tabular-nums text-ink">
              {formatMinutes(day.committed_minutes)}
            </span>{" "}
            of the{" "}
            <span className="tabular-nums">{formatMinutes(day.threshold_minutes)}</span>{" "}
            that fits
          </>
        )}
      </p>

      {(day.calendar_state === "revoked" || day.calendar_state === "stale") && (
        <p className="mt-2 text-note text-muted">
          {day.calendar_state === "revoked"
            ? "Calendar disconnected, so this ignores meetings."
            : "Calendar data is out of date."}{" "}
          <button
            onClick={() => refresh.mutate()}
            className="underline underline-offset-2 transition-colors hover:text-ink"
          >
            {day.calendar_state === "revoked" ? "Reconnect" : "Refresh"}
          </button>
        </p>
      )}
    </section>
  );
}

/** Below this, the day scores neutral rather than pass or fail. Mirrors the
    two-primary floor the server applies when it closes the day. */
export const SCORING_FLOOR = 2;

function Slots({ used, showFloor }: { used: number; showFloor: boolean }) {
  return (
    <ul
      aria-label={`${used} of ${MAX_PRIMARIES} commitments taken`}
      className="flex items-center gap-1.5"
    >
      {Array.from({ length: MAX_PRIMARIES }, (_, index) => {
        const filled = index < used;
        // Only the empty half of the floor is marked. A filled slot already
        // says what it needs to; ringing it as well would read as a warning
        // about work that is actually done.
        const isFloor = showFloor && !filled && index < SCORING_FLOOR;
        return (
          <li
            key={index}
            data-slot={filled ? "filled" : isFloor ? "needed" : "empty"}
            title={
              filled
                ? "Committed"
                : isFloor
                  ? "Needed before the day can be scored"
                  : "Free"
            }
            className={[
              "h-2.5 w-2.5 rotate-45",
              filled
                ? "bg-ink"
                : isFloor
                  ? "border border-dashed border-muted"
                  : "border border-line",
            ].join(" ")}
          />
        );
      })}
    </ul>
  );
}

function IndeterminateNote({ reason }: { reason: string | null }) {
  if (reason === "no_focus_blocks") {
    return (
      <>
        Set up at least one work block in{" "}
        <Link to="/settings" className="underline underline-offset-2">
          settings
        </Link>{" "}
        and Doer can tell you what fits.
      </>
    );
  }
  return <>Still working out how long everything takes.</>;
}

/** The entire over-commitment signal. No modal, no alert, no nagging. */
function RiskDot() {
  return (
    <span
      data-testid="risk-dot"
      title="More committed than this day realistically holds"
      className="inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-risk-mark"
    />
  );
}
