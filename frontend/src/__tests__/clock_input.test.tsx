import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClockInput } from "../components/ClockInput";

/**
 * Structure only, as `day_timeline.test.tsx` is.
 *
 * Keystroke handling is verified by hand against Flow 17 of the user testing
 * documentation; the arithmetic underneath it is covered as pure functions in
 * `daytime.test.ts`. What is worth asserting here is that the field renders a
 * 24-hour clock with no day period anywhere, which is the whole point of it.
 */

function render(value: string, props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <ClockInput label="Day start" value={value} onChange={() => {}} {...props} />,
  );
}

describe("the clock field", () => {
  it("shows both segments zero-padded", () => {
    const html = render("09:05");
    expect(html).toContain(">09<");
    expect(html).toContain(">05<");
  });

  it("shows the twenty-fourth hour as 23, not 11 PM", () => {
    expect(render("23:30")).toContain(">23<");
  });

  it("shows midnight as 00, not 12", () => {
    const html = render("00:00");
    expect(html).toContain(">00<");
    expect(html).not.toContain(">12<");
  });

  it("never renders a day period", () => {
    for (const value of ["00:00", "09:15", "12:00", "13:00", "23:59"]) {
      expect(render(value)).not.toMatch(/\b[AP]\.?M\.?\b/i);
    }
  });

  it("is a single tab stop, as the control it replaces was", () => {
    expect(render("09:00").match(/tabindex="0"/g)).toHaveLength(1);
  });

  it("tells assistive technology which clock it is", () => {
    expect(render("09:00")).toContain('aria-label="Day start, 24 hour clock"');
  });

  it("falls back to midnight rather than rendering a half-typed value", () => {
    // The field holds partial input internally, so `value` should never be
    // unreadable. If it ever is, showing 00:00 beats showing NaN.
    expect(render("")).toContain(">00<");
  });
});

describe("the clock field for assistive technology", () => {
  it("exposes each segment as a spinbutton with its own value", () => {
    const html = render("09:05");
    expect(html.match(/role="spinbutton"/g)).toHaveLength(2);
    expect(html).toContain('aria-valuetext="09"');
    expect(html).toContain('aria-valuetext="05"');
  });

  it("bounds the hour at 23 and the minute at 59", () => {
    const html = render("09:05");
    expect(html).toContain('aria-valuemax="23"');
    expect(html).toContain('aria-valuemax="59"');
  });

  it("names each segment after the field it belongs to", () => {
    const html = render("09:05");
    expect(html).toContain('aria-label="Day start hour"');
    expect(html).toContain('aria-label="Day start minute"');
  });

  it("keeps the inactive segment out of the tab order", () => {
    // Roving focus: one tab stop for the field, arrows to move inside it.
    expect(render("09:05")).toContain('tabindex="-1"');
  });
});
