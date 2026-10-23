import { describe, expect, it } from "vitest";
import RAW from "../index.css?raw";

/**
 * The token layer, asserted against the stylesheet itself.
 *
 * These are static and arithmetic assertions, not computed-style ones. jsdom
 * does not evaluate a media query against layout, so `getComputedStyle` in a
 * test environment would report the light value under both schemes and prove
 * nothing. Parsing the declarations is less elegant and actually tests the
 * thing. ADR 0003 records the reasoning.
 */

/** Comments stripped. The file explains why it does not use `@theme inline`,
    and a naive search for that string finds the explanation. */
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, "");

/** The seven roles the palette carries. Adding an eighth means deciding its
    contrast obligation, which is why this list is written out rather than
    discovered from the file. */
const ROLES = [
  "ink",
  "paper",
  "muted",
  "line",
  "success",
  "failure",
  "risk",
  "risk-mark",
] as const;

/** Declarations inside `@theme { ... }`, which is the light scheme. */
function lightBlock(): string {
  const start = CSS.indexOf("@theme {");
  expect(start).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf("\n}", start));
}

/** Declarations inside the `prefers-color-scheme: dark` rule. */
function darkBlock(): string {
  const start = CSS.indexOf("@media (prefers-color-scheme: dark)");
  expect(start).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf("\n}\n", start));
}

function tokenValue(block: string, name: string): string | null {
  const match = block.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

// ── WCAG relative luminance and contrast, per the 2.x definition ────────────

function channels(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const parts = clean.match(/../g);
  if (!parts || parts.length !== 3) throw new Error(`not a 6-digit hex: ${hex}`);
  return parts.map((pair) => parseInt(pair, 16) / 255) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text roles carry AA at 4.5:1. Mark roles are graphics and carry 3:1. `line`
    is a decorative hairline: a border meeting 4.5:1 would be a rule. */
const OBLIGATIONS: Array<[string, number]> = [
  ["ink", 4.5],
  ["muted", 4.5],
  ["failure", 4.5],
  ["risk", 4.5],
  ["success", 3],
  ["risk-mark", 3],
  // The focus ring is a UI component under WCAG and has to be visible against
  // the surface it is drawn on. It currently resolves to `ink`, so it clears
  // this easily; the obligation is stated so a later edit cannot quietly make
  // the ring invisible while AC-IO-27 still claims it is there.
  ["focus", 3],
];

describe("every colour role is defined in both schemes (T-IO-01, T-IO-02)", () => {
  const light = lightBlock();
  const dark = darkBlock();

  it.each(ROLES)("%s has a light value", (role) => {
    expect(tokenValue(light, role)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  // The original defect: ink, paper, muted and line were redefined for dark and
  // success, failure and risk were not, so three colours chosen against #fbfaf8
  // were rendered against #15161a.
  it.each(ROLES)("%s has a dark value", (role) => {
    expect(tokenValue(dark, role)).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("every literal colour in the theme has a dark counterpart", () => {
    // Derived tokens are exempt and must be: they are a color-mix over other
    // tokens, so they already follow the scheme. Redefining them would create
    // a second place to keep in step. Everything stated as a literal has to be
    // restated, which is the rule the original four-of-seven split broke.
    const declarations = (block: string) =>
      [...block.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].map(
        (m) => [m[1], m[2].trim()] as const,
      );

    const literal = declarations(light)
      .filter(([, value]) => !value.startsWith("color-mix("))
      .map(([name]) => name);
    const darkNames = declarations(dark).map(([name]) => name);

    expect(literal).toEqual(expect.arrayContaining([...ROLES]));
    for (const name of literal) expect(darkNames).toContain(name);
  });
});

describe("contrast meets its obligation in both schemes (T-IO-03, T-IO-04)", () => {
  const light = lightBlock();
  const dark = darkBlock();

  it.each(OBLIGATIONS)("%s clears %s:1 on light paper", (role, need) => {
    const fg = tokenValue(light, role)!;
    const bg = tokenValue(light, "paper")!;
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(need);
  });

  it.each(OBLIGATIONS)("%s clears %s:1 on dark paper", (role, need) => {
    const fg = tokenValue(dark, role)!;
    const bg = tokenValue(dark, "paper")!;
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(need);
  });

  it("the raised surface is no harder to read on than the page", () => {
    for (const [block, scheme] of [
      [light, "light"],
      [dark, "dark"],
    ] as const) {
      const raised = tokenValue(block, "raised")!;
      for (const [role, need] of OBLIGATIONS) {
        const ratio = contrastRatio(tokenValue(block, role)!, raised);
        expect(ratio, `${role} on ${scheme} raised`).toBeGreaterThanOrEqual(need);
      }
    }
  });
});

describe("the scale tokens exist (T-IO-06)", () => {
  const light = lightBlock();

  it.each(["caption", "note", "body", "heading", "display"])(
    "type step %s is defined",
    (step) => {
      expect(light).toContain(`--text-${step}:`);
    },
  );

  it.each(["gutter", "section", "field"])("spacing step %s is defined", (step) => {
    expect(light).toContain(`--spacing-${step}:`);
  });

  it.each(["mark", "control", "panel"])("radius %s is defined", (step) => {
    expect(light).toContain(`--radius-${step}:`);
  });

  it("elevation is named rather than written at the call site", () => {
    expect(light).toContain("--shadow-raised:");
    expect(light).toContain("--shadow-float:");
  });
});

describe("the theme is plain, not inline (ADR 0003)", () => {
  // `@theme inline` resolves the value into the utility at build time, which
  // breaks the runtime override the dark block depends on. Verified against
  // Tailwind 4.3.3; this guards the property rather than restating it.
  it("does not use @theme inline", () => {
    expect(CSS).not.toContain("@theme inline");
  });
});

describe("the token layer is adopted, not merely declared (T-IO-05)", () => {
  // Vite reads the tree, so the test needs no filesystem API and the project
  // needs no @types/node. Tests are excluded: they quote the forbidden
  // patterns in order to forbid them.
  const SOURCES = Object.entries(
    import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }),
  ).filter(([path]) => !path.includes("__tests__")) as Array<[string, string]>;

  const FORBIDDEN: Array<[string, RegExp]> = [
    // 57 of these were `text-[var(--color-muted)]`, the most frequent class in
    // the application. A semantic utility says what the colour is for.
    ["an arbitrary colour variable", /\[var\(--color-/],
    // Eight sites wrote their own hover tint at four different opacities.
    ["a raw black alpha", /black\/\[0\./],
    ["a raw white alpha", /white\/\[0\./],
    // The same color-mix recipe was written out in two files.
    ["an inline color-mix class", /bg-\[color-mix\(/],
  ];

  it.each(FORBIDDEN)("no component uses %s", (_label, pattern) => {
    const offenders = SOURCES.filter(([, body]) => pattern.test(body)).map(([p]) => p);
    expect(offenders).toEqual([]);
  });

  it("finds the source tree it is checking", () => {
    // Without this, a glob that silently matched nothing would make every
    // assertion above pass by vacuity. That is not hypothetical: the shell
    // grep run while writing these replacements reported a clean tree because
    // its own glob had errored, and a real offender survived into this suite.
    expect(SOURCES.length).toBeGreaterThan(8);
  });
});
