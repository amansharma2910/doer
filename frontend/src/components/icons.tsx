/**
 * The icon set, drawn rather than installed.
 *
 * ADR 0003 declined a runtime dependency, and an icon package would have been
 * the largest single reason to take one. Seven glyphs at 16px on a 1.5 stroke
 * is not a library's worth of work, and drawing them keeps the one existing
 * icon's convention: the plus in the add control was hand-drawn because a "+"
 * glyph sits on the font's math axis and lands a pixel or two below centre.
 *
 * Every glyph is `aria-hidden`. These sit inside buttons that carry their own
 * `aria-label`, so announcing the icon as well would read the control twice.
 */

type IconProps = { className?: string };

function Glyph({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-4 w-4"}
    >
      {children}
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 3.5v9M3.5 8h9" />
    </Glyph>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M11.2 2.8a1.4 1.4 0 0 1 2 2L6 12l-2.8.8.8-2.8 7.2-7.2Z" />
    </Glyph>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.8 4.3h10.4M6.3 4.3V3.1a.8.8 0 0 1 .8-.8h1.8a.8.8 0 0 1 .8.8v1.2M12 4.3l-.5 8.2a.9.9 0 0 1-.9.8H5.4a.9.9 0 0 1-.9-.8L4 4.3" />
    </Glyph>
  );
}

/** Promote: into the four. */
export function ArrowUpIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 12.8V3.6M4.2 7.4 8 3.6l3.8 3.8" />
    </Glyph>
  );
}

/** Demote: out of the four, still on the day. */
export function ArrowDownIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 3.2v9.2M11.8 8.6 8 12.4 4.2 8.6" />
    </Glyph>
  );
}

/** Start. A triangle rather than a clock: this begins work, it does not set a
    timer, and the distinction matters in a product that refuses to nag. */
export function PlayIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M5.6 3.4 12 8l-6.4 4.6V3.4Z" />
    </Glyph>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M3.3 8.4 6.4 11.5 12.7 5.2" />
    </Glyph>
  );
}

export function ChatIcon({ className }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M13.5 9.2a1.6 1.6 0 0 1-1.6 1.6H5.5L2.5 13.5V4.1a1.6 1.6 0 0 1 1.6-1.6h7.8a1.6 1.6 0 0 1 1.6 1.6v5.1Z" />
    </Glyph>
  );
}
