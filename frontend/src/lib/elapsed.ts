import { useEffect, useState } from "react";

/**
 * Whole minutes between an ISO timestamp and now.
 *
 * Plan §10 question 5 asked whether elapsed time should tick. It does, once a
 * minute, which is not the same answer as a running stopwatch. A seconds
 * counter is motion in a product whose whole claim is that it does not demand
 * attention; a number frozen at the moment the page loaded just looks broken.
 * Minute granularity is the smallest step that is honest without being a
 * timer.
 */
export function useElapsedMinutes(startedAt: string | null): number | null {
  const [minutes, setMinutes] = useState(() => minutesSince(startedAt));

  useEffect(() => {
    if (!startedAt) return;
    setMinutes(minutesSince(startedAt));
    const id = setInterval(() => setMinutes(minutesSince(startedAt)), 60_000);
    return () => clearInterval(id);
  }, [startedAt]);

  return startedAt ? minutes : null;
}

export function minutesSince(startedAt: string | null): number | null {
  if (!startedAt) return null;
  // The API serialises naive UTC timestamps without a zone suffix. Reading one
  // as local time would put a task started minutes ago an hour into the future
  // wherever the offset is not zero.
  const stamp = /(Z|[+-]\d{2}:?\d{2})$/.test(startedAt) ? startedAt : `${startedAt}Z`;
  const started = Date.parse(stamp);
  if (Number.isNaN(started)) return null;
  return Math.max(0, Math.floor((Date.now() - started) / 60_000));
}
