import type { ReactNode } from "react";
import type { Risk } from "../lib/data";
import { riskMeta } from "../lib/data";
import { Check, Warn } from "./icons";

export function Card({
  children,
  className = "",
  as = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "button";
} & React.HTMLAttributes<HTMLDivElement>) {
  const Tag = as as any;
  return (
    <Tag
      className={`rounded-2xl border border-border bg-card text-card-foreground ${className}`}
      style={{ boxShadow: "var(--shadow-card)" }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

const riskClasses: Record<Risk, string> = {
  safe: "bg-safe-soft text-safe border-safe-border",
  caution: "bg-caution-soft text-caution border-caution-border",
  danger: "bg-danger-soft text-danger border-danger-border",
};

export function RiskPill({
  risk,
  children,
  className = "",
}: {
  risk: Risk;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide ${riskClasses[risk]} ${className}`}
    >
      <Dot risk={risk} />
      {children}
    </span>
  );
}

export function Dot({ risk }: { risk: Risk }) {
  const c = { safe: "bg-safe", caution: "bg-caution", danger: "bg-danger" }[risk];
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${c}`} />;
}

export function Meter({
  value,
  risk,
  delay = 0,
}: {
  value: number;
  risk: Risk;
  delay?: number;
}) {
  const bar = { safe: "bg-safe", caution: "bg-caution", danger: "bg-danger" }[risk];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={`sg-bar h-full rounded-full ${bar}`}
        style={{ width: `${value}%`, animationDelay: `${delay}ms` }}
      />
    </div>
  );
}

export function ScoreRing({
  score,
  risk,
  size = 108,
}: {
  score: number;
  risk: Risk;
  size?: number;
}) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (score / 100) * c;
  const color = `var(--${risk === "danger" ? "danger" : risk === "caution" ? "caution" : "safe"})`;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--muted)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-2xl font-bold leading-none" style={{ color }}>
          {score}
        </span>
        <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

export function ReasonRow({ tone, text }: { tone: "good" | "warn"; text: string }) {
  return (
    <li className="flex items-start gap-2.5 text-[13px] leading-snug">
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
          tone === "good" ? "bg-safe-soft text-safe" : "bg-caution-soft text-caution"
        }`}
      >
        {tone === "good" ? <Check width={11} height={11} strokeWidth={2.6} /> : <Warn width={11} height={11} strokeWidth={2.4} />}
      </span>
      <span className="text-card-foreground/90">{text}</span>
    </li>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  desc,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  desc?: string;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
      role="switch"
      aria-checked={on}
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-card-foreground">{label}</span>
        {desc && <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{desc}</span>}
      </span>
      <span
        className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${
          on ? "bg-primary" : "bg-border-strong"
        }`}
      >
        <span
          className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-all ${
            on ? "left-[19px]" : "left-[3px]"
          }`}
        />
      </span>
    </button>
  );
}

export function StatBlock({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-[15px] font-semibold text-card-foreground">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </div>
  );
}

export { riskMeta };
