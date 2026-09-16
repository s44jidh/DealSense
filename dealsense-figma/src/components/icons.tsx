import type { SVGProps } from "react";

type I = SVGProps<SVGSVGElement>;
const base = (p: I) => ({
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

/* Brand mark: shield enclosing a shopping bag */
export function Logo({ size = 28, ...p }: { size?: number } & I) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" {...p}>
      <path
        d="M16 2.5l10 3.4v8.2c0 6.6-4.2 11.7-10 13.4-5.8-1.7-10-6.8-10-13.4V5.9L16 2.5z"
        fill="var(--primary)"
        opacity="0.12"
      />
      <path
        d="M16 2.5l10 3.4v8.2c0 6.6-4.2 11.7-10 13.4-5.8-1.7-10-6.8-10-13.4V5.9L16 2.5z"
        stroke="var(--primary)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12.4 12.3h7.2l-.7 6.1a1.6 1.6 0 0 1-1.6 1.4h-2.6a1.6 1.6 0 0 1-1.6-1.4l-.7-6.1z"
        stroke="var(--primary)"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M13.7 12.3v-.8a2.3 2.3 0 0 1 4.6 0v.8"
        stroke="var(--primary)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const Sun = (p: I) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const Moon = (p: I) => (
  <svg {...base(p)}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);
export const Settings = (p: I) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 14.1a1.6 1.6 0 0 0-1.5-1H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 3 7.9a1.6 1.6 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 5.4 3.2l.1.1A1.6 1.6 0 0 0 7.3 3.6H7.4A1.6 1.6 0 0 0 9 2.1V2a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1H23a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
  </svg>
);
export const Lock = (p: I) => (
  <svg {...base(p)}>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </svg>
);
export const Shield = (p: I) => (
  <svg {...base(p)}>
    <path d="M12 3l7 2.4v5.4c0 4.6-3 8.2-7 9.4-4-1.2-7-4.8-7-9.4V5.4L12 3z" />
  </svg>
);
export const Check = (p: I) => (
  <svg {...base(p)}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
);
export const Warn = (p: I) => (
  <svg {...base(p)}>
    <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);
export const ChevronRight = (p: I) => (
  <svg {...base(p)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const ChevronDown = (p: I) => (
  <svg {...base(p)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const ArrowLeft = (p: I) => (
  <svg {...base(p)}>
    <path d="M19 12H5M12 19l-7-7 7-7" />
  </svg>
);
export const ArrowDown = (p: I) => (
  <svg {...base(p)}>
    <path d="M12 5v14M19 12l-7 7-7-7" />
  </svg>
);
export const External = (p: I) => (
  <svg {...base(p)}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6M10 14L21 3" />
  </svg>
);
export const Star = ({ filled, ...p }: { filled?: boolean } & I) => (
  <svg {...base({ ...p, fill: filled ? "currentColor" : "none" })}>
    <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.3l6.5-.9L12 2.5z" />
  </svg>
);
export const Sparkle = (p: I) => (
  <svg {...base(p)}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
  </svg>
);
export const Search = (p: I) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);
export const Tag = (p: I) => (
  <svg {...base(p)}>
    <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1-.6-1.4V5a2 2 0 0 1 2-2h7.2a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8z" />
    <path d="M7.5 7.5h.01" />
  </svg>
);
export const Info = (p: I) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);
export const Refresh = (p: I) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
  </svg>
);
