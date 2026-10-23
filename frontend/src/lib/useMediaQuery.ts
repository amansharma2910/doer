import { useEffect, useState } from "react";

/**
 * Subscribe to a media query.
 *
 * The navigation could have been switched with `hidden sm:flex`, which needs no
 * JavaScript. It is done here instead because AC-IO-04 requires that exactly one
 * of the two navigations is *rendered*, and a CSS-hidden element is rendered: it
 * sits in the accessibility tree's reach, it is reachable by Tab in some
 * configurations, and a test cannot tell the two states apart, because jsdom
 * does not evaluate media queries against layout.
 *
 * Returns false when `matchMedia` is absent rather than throwing, so a test
 * environment that has not stubbed it gets the desktop layout instead of a
 * crash.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => evaluate(query));

  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    // Read once on subscribe as well as on change: between the initial render
    // and this effect the viewport may already have moved, and the listener
    // only fires on transitions after it is attached.
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

function evaluate(query: string): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(query).matches;
}

/** The one breakpoint in the application. Below it, navigation moves to the
    bottom of the screen where a thumb can reach it. */
export const COMPACT_QUERY = "(max-width: 639px)";
