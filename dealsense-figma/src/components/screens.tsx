import { useEffect, useState } from "react";
import {
  INR,
  analyzingSteps,
  type Risk,
  type Scenario,
  type Store,
} from "../lib/data";
import {
  ArrowLeft,
  ChevronDown,
  Lock,
  Search,
  Shield,
} from "./icons";

export type View = "ready" | "analyzing" | "result" | "settings" | "manual";

interface Props {
  scenario: Scenario;
  view: View;
  go: (v: View) => void;
  prevView: View;
}

/* ---------- primitives ---------- */

function Btn({
  children,
  onClick,
  variant = "primary",
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "outline" | "ghost";
  className?: string;
}) {
  const s = {
    primary: "bg-foreground text-background hover:opacity-80",
    outline: "border border-border-strong text-foreground hover:bg-muted",
    ghost: "text-muted-foreground hover:text-foreground hover:bg-muted",
  }[variant];
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium transition ${s} ${className}`}
    >
      {children}
    </button>
  );
}

function BackRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      <button
        onClick={onClick}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Back"
      >
        <ArrowLeft width={16} height={16} />
      </button>
      <span className="text-[13px] font-semibold">{label}</span>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-border" />;
}

/* ---------- screens ---------- */

function Ready({ s, go }: { s: Scenario; go: (v: View) => void }) {
  return (
    <div className="sg-fade flex flex-col px-5 py-6 gap-5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Product
      </div>

      <div className="flex items-stretch gap-4">
        <div className="h-[92px] w-[92px] shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
          <img src={s.image} alt={s.product} className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 pt-0.5 flex-1 flex flex-col">
          <div className="text-[17px] font-semibold leading-snug">{s.product}</div>
          <div className="mt-1 text-[13px] text-muted-foreground">{s.variant}</div>
          <div className="mt-3 text-[13px] font-medium text-foreground/80">{s.seller.name}</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">{s.store}</div>
          <div className="mt-auto pt-5 text-[22px] font-bold">{INR(s.price.listed)}</div>
        </div>
      </div>

      <div className="mt-2" />

      <Btn onClick={() => go("analyzing")} className="w-full py-3 text-[13.5px]">
        <Shield width={15} height={15} />
        Analyze Product
      </Btn>

      <p className="text-center text-[12px] text-muted-foreground leading-relaxed">
        Check the price, seller and reviews before buying.
      </p>

      <button
        onClick={() => go("manual")}
        className="text-center text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        Check another product
      </button>
    </div>
  );
}

function Analyzing({ go }: { go: (v: View) => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (step >= analyzingSteps.length) {
      const t = setTimeout(() => go("result"), 400);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStep((x) => x + 1), 500);
    return () => clearTimeout(t);
  }, [step, go]);

  const pct = Math.min(100, Math.round((step / analyzingSteps.length) * 100));

  return (
    <div className="sg-fade flex flex-col px-5 py-6 gap-6">
      <div>
        <div className="text-[15px] font-semibold">Analyzing product</div>
        <div className="mt-3 h-[2px] w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground/25 transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {analyzingSteps.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <li key={label} className="flex items-center gap-3">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                  done ? "bg-safe" : active ? "bg-foreground animate-pulse" : "bg-border-strong"
                }`}
              />
              <span
                className={`text-[13px] ${
                  done || active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------- result helpers ---------- */

const RISK_COLOR: Record<Risk, string> = {
  safe: "text-safe",
  caution: "text-caution",
  danger: "text-danger",
};
const RISK_BG: Record<Risk, string> = {
  safe: "bg-safe-soft",
  caution: "bg-caution-soft",
  danger: "bg-danger-soft",
};
const RISK_BORDER: Record<Risk, string> = {
  safe: "border-safe-border",
  caution: "border-caution-border",
  danger: "border-danger-border",
};

function verdictLabel(s: Scenario): string {
  if (s.verdict === "safe") return "SAFE TO PROCEED";
  if (s.verdict === "danger") return "DO NOT PROCEED";
  if (s.id === "overpriced") return "BETTER DEAL FOUND";
  return "PROCEED WITH CAUTION";
}

function verdictSub(s: Scenario): string {
  if (s.verdict === "safe") return "Low risk";
  if (s.verdict === "danger") return "High risk";
  if (s.id === "overpriced") return "Overpriced";
  return "Medium risk";
}

function priceLabel(s: Scenario): string {
  if (s.price.priceStatus === "safe") return "Good";
  if (s.id === "overpriced") return "Above market";
  if (s.price.priceStatus === "caution") return "Unusually low";
  return "Highly unusual";
}
function sellerLabel(risk: Risk): string {
  return { safe: "Low risk", caution: "Some concerns", danger: "High risk" }[risk];
}
function reviewsLabel(risk: Risk): string {
  return { safe: "Healthy", caution: "Some concerns", danger: "Suspicious patterns" }[risk];
}

function QuickRow({ label, value, risk }: { label: string; value: string; risk: Risk }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <span className={`text-right text-[12px] font-medium ${RISK_COLOR[risk]}`}>{value}</span>
    </div>
  );
}

function StoreRow({
  store,
  isDanger,
}: {
  store: Store;
  isDanger?: boolean;
}) {
  const cheaper = store.delta < 0;
  const savings = Math.abs(store.delta);
  return (
    <div className={`flex items-center justify-between py-1.5 ${store.recommended ? "opacity-100" : "opacity-70"}`}>
      <span className={`text-[12px] ${store.recommended ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {store.name}
      </span>
      <div className="text-right">
        <div className={`text-[12px] ${store.recommended ? "font-semibold" : ""}`}>{INR(store.price)}</div>
        {!isDanger && (
          <div className={`text-[10px] ${cheaper ? RISK_COLOR.safe : "text-muted-foreground"}`}>
            {store.delta === 0
              ? "Similar"
              : cheaper
                ? `${INR(savings)} less`
                : `${INR(savings)} more`}
          </div>
        )}
      </div>
    </div>
  );
}

function Accordion({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between py-0.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>{label}</span>
        <ChevronDown
          width={13}
          height={13}
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function Result({ s }: { s: Scenario }) {
  const v = s.verdict;
  const isOverpriced = s.id === "overpriced";
  const isDanger = v === "danger";
  const storesTitle = isDanger ? "Safer alternatives" : isOverpriced ? "Better prices" : "Comparable prices";
  const showMarket = v !== "safe";

  return (
    <div className="sg-fade flex flex-col px-5 py-5 gap-5">
      {/* Verdict */}
      <div
        className={`rounded-xl border px-4 py-3 ${RISK_BG[v]} ${RISK_BORDER[v]}`}
      >
        <div className={`text-[12px] font-bold tracking-[0.06em] ${RISK_COLOR[v]}`}>
          {verdictLabel(s)}
        </div>
        <div className={`mt-0.5 text-[11px] ${RISK_COLOR[v]} opacity-70`}>
          {verdictSub(s)}
        </div>
      </div>

      {/* Price */}
      <div>
        <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-1.5">
          {isDanger || isOverpriced ? "Current site price" : "Effective price"}
        </div>
        <div className="text-[34px] font-bold leading-none tracking-tight">
          {INR(isDanger || isOverpriced ? s.price.listed : s.price.effective)}
        </div>
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          <span>MRP {INR(s.price.mrp)}</span>
          {s.price.listed < s.price.mrp && (
            <span>Listed {INR(s.price.listed)}</span>
          )}
          {s.price.instant > 0 && <span>Offer −{INR(s.price.instant)}</span>}
        </div>
        {showMarket && (
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            Typical market:{" "}
            {s.price.marketLow === s.price.marketHigh
              ? INR(s.price.marketLow)
              : `${INR(s.price.marketLow)}–${INR(s.price.marketHigh)}`}
          </div>
        )}
      </div>

      {isOverpriced && (
        <p className="text-[12px] text-muted-foreground leading-relaxed -mt-1">
          This listing is more expensive than comparable offers.
        </p>
      )}

      <Divider />

      {/* Quick check */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2.5">
          Quick check
        </div>
        <div className="flex flex-col gap-1">
          <QuickRow label="Price" value={priceLabel(s)} risk={s.price.priceStatus} />
          <QuickRow
            label={`Seller — ${s.seller.name}`}
            value={`${s.seller.rating}/5 · ${sellerLabel(s.seller.risk)}`}
            risk={s.seller.risk}
          />
          <QuickRow label="Reviews" value={reviewsLabel(s.reviews.risk)} risk={s.reviews.risk} />
        </div>
      </div>

      {/* Danger: show brief reasons inline */}
      {isDanger && (
        <div className="flex flex-col gap-1.5 -mt-1">
          {s.reasons
            .filter((r) => r.tone === "warn")
            .slice(0, 3)
            .map((r) => (
              <div key={r.text} className="flex items-start gap-2">
                <span className="mt-[3px] h-1 w-1 shrink-0 rounded-full bg-danger" />
                <span className="text-[12px] text-muted-foreground leading-snug">{r.text}</span>
              </div>
            ))}
        </div>
      )}

      <Divider />

      {/* Comparable / better / safer stores */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {storesTitle}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Same model · {s.match}% match
          </div>
        </div>
        <div className="flex flex-col divide-y divide-border">
          {s.stores.map((st) => (
            <StoreRow key={st.name} store={st} isDanger={isDanger} />
          ))}
        </div>
      </div>

      <Divider />

      {/* Why this result — expandable */}
      <Accordion label="Why this result">
        <div className="flex flex-col gap-2">
          {s.reasons.map((r) => (
            <div key={r.text} className="flex items-start gap-2.5">
              <span
                className={`mt-[4px] h-1.5 w-1.5 shrink-0 rounded-full ${
                  r.tone === "good" ? "bg-safe" : "bg-caution"
                }`}
              />
              <span className="text-[12px] text-muted-foreground leading-snug">{r.text}</span>
            </div>
          ))}
          {/* Review details */}
          <div className="mt-2 border-t border-border pt-3">
            <Accordion label="Review details">
              <div className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
                <div className="flex justify-between">
                  <span>Reviews analyzed</span>
                  <span className="text-foreground">{s.reviews.analyzed.toLocaleString("en-IN")}</span>
                </div>
                <div className="flex justify-between">
                  <span>Potentially suspicious patterns</span>
                  <span className={`font-medium ${RISK_COLOR[s.reviews.risk]}`}>{s.reviews.suspicious}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Positive</span>
                  <span className="text-foreground">{s.reviews.positive}%</span>
                </div>
                <p className="mt-1 text-[11px] italic leading-relaxed">
                  Suspicious patterns are flagged — not confirmed fake reviews.
                </p>
              </div>
            </Accordion>
          </div>
          {/* Seller details */}
          <div className="border-t border-border pt-3">
            <Accordion label="Seller details">
              <div className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
                <div className="flex justify-between">
                  <span>Rating</span>
                  <span className="text-foreground">{s.seller.rating}/5</span>
                </div>
                <div className="flex justify-between">
                  <span>History</span>
                  <span className="text-foreground">{s.seller.status}</span>
                </div>
                <div className="flex justify-between">
                  <span>Returns</span>
                  <span className="text-foreground">{s.seller.returnPolicy}</span>
                </div>
                <div className="flex justify-between">
                  <span>Risk</span>
                  <span className={`font-medium ${RISK_COLOR[s.seller.risk]}`}>
                    {sellerLabel(s.seller.risk)}
                  </span>
                </div>
              </div>
            </Accordion>
          </div>
        </div>
      </Accordion>
    </div>
  );
}

function Manual({ go }: { go: (v: View) => void }) {
  return (
    <div className="sg-fade">
      <BackRow label="Check a product" onClick={() => go("ready")} />
      <div className="flex flex-col px-5 py-5 gap-4">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2.5">
          <Search width={14} height={14} className="shrink-0 text-muted-foreground" />
          <input
            placeholder="Paste product URL"
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
        <Btn onClick={() => go("analyzing")} className="w-full py-3">
          <Shield width={14} height={14} />
          Analyze
        </Btn>
        <p className="text-[12px] text-muted-foreground text-center leading-relaxed">
          Works with most major e-commerce product pages.
        </p>
      </div>
    </div>
  );
}

function SettingsScreen({ go, prevView }: { go: (v: View) => void; prevView: View }) {
  const [analyzeOnly, setAnalyzeOnly] = useState(true);
  const [showPrices, setShowPrices] = useState(true);
  const [showReviews, setShowReviews] = useState(true);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");

  function Row({
    label,
    on,
    toggle,
  }: {
    label: string;
    on: boolean;
    toggle: () => void;
  }) {
    return (
      <button
        onClick={toggle}
        className="flex w-full items-center justify-between py-3 text-left"
        role="switch"
        aria-checked={on}
      >
        <span className="text-[13px] text-foreground">{label}</span>
        <span
          className={`relative h-[20px] w-[34px] shrink-0 rounded-full transition-colors ${
            on ? "bg-safe" : "bg-border-strong"
          }`}
        >
          <span
            className={`absolute top-[3px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all ${
              on ? "left-[17px]" : "left-[3px]"
            }`}
          />
        </span>
      </button>
    );
  }

  return (
    <div className="sg-fade">
      <BackRow label="Settings" onClick={() => go(prevView)} />
      <div className="flex flex-col px-5 py-4 gap-5">
        {/* Appearance */}
        <div>
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Appearance
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {(["system", "light", "dark"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`rounded-lg border py-2 text-[12px] font-medium capitalize transition ${
                  theme === t
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:border-border-strong hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <Divider />

        {/* Analysis */}
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Analysis
          </div>
          <div className="divide-y divide-border">
            <Row label="Analyze only when requested" on={analyzeOnly} toggle={() => setAnalyzeOnly((v) => !v)} />
            <Row label="Show comparable prices" on={showPrices} toggle={() => setShowPrices((v) => !v)} />
            <Row label="Show review details" on={showReviews} toggle={() => setShowReviews((v) => !v)} />
          </div>
        </div>

        <Divider />

        {/* Privacy */}
        <div>
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Privacy
          </div>
          <div className="flex flex-col gap-2">
            {[
              "No browsing history collected",
              "No passwords collected",
              "No payment information collected",
              "Only required product information is processed",
            ].map((line) => (
              <div key={line} className="flex items-start gap-2.5">
                <Lock width={11} height={11} className="mt-[3px] shrink-0 text-muted-foreground" />
                <span className="text-[12px] text-muted-foreground leading-snug">{line}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ScreenRouter({ scenario, view, go, prevView }: Props) {
  switch (view) {
    case "ready":
      return <Ready s={scenario} go={go} />;
    case "analyzing":
      return <Analyzing go={go} />;
    case "result":
      return <Result s={scenario} />;
    case "settings":
      return <SettingsScreen go={go} prevView={prevView} />;
    case "manual":
      return <Manual go={go} />;
  }
}
