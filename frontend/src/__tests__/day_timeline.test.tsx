import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DayTimeline } from "../components/DayTimeline";
import type { PreferenceBlock } from "../lib/types";

/**
 * Structure only, not behaviour.
 *
 * ADR 0002 declined a DOM test harness, so pointer gestures are verified by hand
 * against Flow 16 of the user testing documentation. Static rendering needs no
 * DOM and no new dependency, though, and it covers the half of the wiring that is
 * a fact about the markup rather than about events: that the control appears at
 * all, that it is reachable, and that it stays absent when the bar is read-only.
 */

const DAY_START = "14:00";
const DURATION = 15 * 60;

const BLOCKS: PreferenceBlock[] = [
  {
    id: "b1",
    kind: "deep_work",
    start_offset_minutes: 60,
    end_offset_minutes: 240,
    is_focus: true,
  },
];

const PREVIEW = { start: 300, end: 360, isFocus: true };

function render(props: Partial<Parameters<typeof DayTimeline>[0]> = {}) {
  return renderToStaticMarkup(
    <DayTimeline
      blocks={BLOCKS}
      dayStart={DAY_START}
      dayDurationMinutes={DURATION}
      preview={PREVIEW}
      {...props}
    />,
  );
}

describe("the day timeline as a read-only bar", () => {
  it("renders no handles when no change handler is passed", () => {
    const html = render();
    expect(html).not.toContain('role="slider"');
    expect(html).not.toContain("tabindex");
  });

  it("still draws the preview window", () => {
    expect(render()).toContain("border-dashed");
  });

  it("keeps the block tooltip", () => {
    expect(render()).toContain('title="deep work: 15:00 to 18:00"');
  });
});

describe("the day timeline as a control", () => {
  const html = render({ onPreviewChange: () => {} });

  it("exposes both edges as sliders", () => {
    expect(html.match(/role="slider"/g)).toHaveLength(2);
  });

  it("labels each handle with its own clock time", () => {
    // The preview runs 19:00 to 20:00 on a day starting at 14:00.
    expect(html).toContain('aria-valuetext="19:00"');
    expect(html).toContain('aria-valuetext="20:00"');
  });

  it("bounds the sliders by the day, not by the clock", () => {
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain(`aria-valuemax="${DURATION}"`);
  });

  it("makes the window and both handles reachable by keyboard", () => {
    expect(html.match(/tabindex="0"/g)).toHaveLength(3);
  });

  it("describes the whole range on the window itself", () => {
    expect(html).toContain("New block, 19:00 to 20:00");
  });

  it("lets pointer events through the overlay except where the window is", () => {
    // Otherwise the overlay would swallow the hover that shows a block's tooltip.
    expect(html).toContain("pointer-events-none absolute inset-0");
    expect(html).toContain("pointer-events-auto");
  });

  it("draws nothing to grab when there is no preview to drag", () => {
    const empty = render({ onPreviewChange: () => {}, preview: null });
    expect(empty).not.toContain('role="slider"');
  });
});
