import { useEffect, useRef, useState } from "react";
import { INR } from "../lib/data";
import type { ExtractedProduct } from "../lib/extractor";
import type {
  BatchReviewAnalysisResponse,
  ExtractedReview,
  ComparePricesResponse,
  ComparableOffer,
  AspectItem,
  AnalyzedReviewItem,
} from "../lib/reviewTypes";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Info,
  Refresh,
  Search,
  Shield,
  Sparkle,
  Star,
  Tag,
  Warn,
} from "./icons";

export type View = "ready" | "analyzing" | "result" | "settings" | "manual";

export interface Props {
  product?: ExtractedProduct | null;
  status?: "loading" | "success" | "unsupported" | "error";
  view: View;
  go: (v: View) => void;
  prevView: View;
  onAnalyze?: () => void;
  onRetry?: () => void;
  reviewAnalysis?: BatchReviewAnalysisResponse | null;
  reviewLoading?: boolean;
  reviewError?: string | null;
  analysisStep?: string | null;
  onAnalyzeReviews?: (reviews: ExtractedReview[]) => void;
  onLoadSampleReviews?: () => void;
  analysisSource?: "live_dom" | "demo" | "manual";
  comparison?: ComparePricesResponse | null;
  comparisonLoading?: boolean;
  comparisonError?: string | null;
  onComparePrices?: (customQuery?: string) => void;
}

/* ---------- primitives ---------- */

function Btn({
  children,
  onClick,
  variant = "primary",
  className = "",
  disabled = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  className?: string;
  disabled?: boolean;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl text-[13px] font-semibold transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed select-none";
  const variants = {
    primary:
      "bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.99] shadow-sm",
    secondary:
      "bg-muted text-foreground hover:bg-muted/80 active:scale-[0.99]",
    outline:
      "border border-border bg-background hover:bg-muted text-foreground active:scale-[0.99]",
    ghost: "text-muted-foreground hover:text-foreground hover:bg-muted/50",
    danger: "bg-destructive text-destructive-foreground hover:opacity-90",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

function BackRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
      <button
        onClick={onClick}
        className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground transition"
      >
        <ArrowLeft width={14} height={14} />
        {label}
      </button>
      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        Review Intelligence
      </span>
    </div>
  );
}

function Divider() {
  return <div className="h-px w-full bg-border" />;
}

function Accordion({
  label,
  children,
  defaultOpen = false,
  badge,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3.5 py-3 text-left hover:bg-muted/40 transition select-none"
      >
        <div className="flex items-center gap-2 min-w-0 pr-2">
          <span className="text-[12.5px] font-semibold text-foreground truncate">
            {label}
          </span>
          {badge ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[9.5px] font-semibold text-muted-foreground shrink-0 border border-border">
              {badge}
            </span>
          ) : null}
        </div>
        <ChevronDown
          width={15}
          height={15}
          className={`shrink-0 text-muted-foreground transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open ? <div className="border-t border-border px-3.5 py-3">{children}</div> : null}
    </div>
  );
}

/* ---------- 1. READY SCREEN ---------- */

function ComparablePricesSection({
  product,
  comparison,
  loading,
  error,
  onCompare,
}: {
  product: ExtractedProduct;
  comparison?: ComparePricesResponse | null;
  loading?: boolean;
  error?: string | null;
  onCompare?: (customQuery?: string) => void;
}) {
  const isFlipkartSource = Boolean(
    product.source_retailer === "Flipkart" ||
    (product.url && product.url.includes("flipkart.com"))
  );
  const crossPlatformRetailer = isFlipkartSource ? "Amazon.in" : "Flipkart";

  const brandModelChip =
    product.brand &&
    product.model &&
    product.brand !== "Unavailable" &&
    product.model !== "Unavailable"
      ? `${product.brand} ${product.model}`
      : null;

  const defaultQuery = brandModelChip || product.product_name;
  const [searchQuery, setSearchQuery] = useState(defaultQuery);
  const [showRefineForm, setShowRefineForm] = useState(false);

  useEffect(() => {
    const q = brandModelChip || product.product_name;
    setSearchQuery(q);
  }, [product.product_name, product.brand, product.model]);

  const verifiedCrossOffers =
    comparison?.cross_platform_offers?.filter(
      (o) => o.match_status === "EXACT_MATCH" && o.availability !== "OUT_OF_STOCK"
    ) ??
    comparison?.verified_offers ??
    [];

  const possibleCrossOffers =
    comparison?.cross_platform_offers?.filter(
      (o) =>
        (o.match_status === "POSSIBLE_MATCH" ||
          o.match_status === "UNVERIFIED_VARIANT") &&
        o.availability !== "OUT_OF_STOCK"
    ) ??
    comparison?.possible_offers ??
    [];

  const getOfferUrl = (offer: ComparableOffer) => {
    if (offer.product_url && (offer.product_url.includes("flipkart.com") || offer.product_url.includes("amazon.in"))) {
      return offer.product_url;
    }
    if (offer.retailer_name === "Flipkart") {
      return `https://www.flipkart.com/search?q=${encodeURIComponent(offer.product_title)}`;
    }
    if (offer.retailer_name === "Amazon.in") {
      return `https://www.amazon.in/s?k=${encodeURIComponent(offer.product_title)}`;
    }
    return offer.product_url;
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Store Price Comparison
        </div>
        <div className="flex items-center gap-2">
          <div className="text-[10px] text-muted-foreground">
            {loading
              ? `Checking ${crossPlatformRetailer}...`
              : comparison?.status === "success" && verifiedCrossOffers.length > 0
              ? `${verifiedCrossOffers.length} verified offer`
              : possibleCrossOffers.length > 0
              ? `${possibleCrossOffers.length} probable match`
              : (comparison?.cross_platform_status || comparison?.status) === "all_candidates_rejected"
              ? "No exact match"
              : (comparison?.cross_platform_status || comparison?.status) === "no_search_results"
              ? "0 results"
              : comparison
              ? "Checked"
              : "Not checked"}
          </div>
          {onCompare && !loading ? (
            <button
              onClick={() => onCompare(searchQuery)}
              title={`Check live prices on ${crossPlatformRetailer}`}
              className="text-[10px] text-primary hover:underline flex items-center gap-1 font-medium transition-colors"
            >
              <Refresh width={10} height={10} />
              {comparison ? "Re-check" : "Check now"}
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-border bg-card p-2.5 text-center flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
          <Refresh width={12} height={12} className="animate-spin text-foreground/70" />
          <span>Searching verified listings on {crossPlatformRetailer}...</span>
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive flex items-center justify-between">
          <span className="truncate">{error}</span>
          {onCompare ? (
            <button onClick={() => onCompare(searchQuery)} className="underline font-semibold ml-2 shrink-0">Retry</button>
          ) : null}
        </div>
      ) : !comparison ? (
        <div className="rounded-lg border border-dashed border-border p-2.5 text-center bg-card flex flex-col items-center gap-1.5">
          <div className="text-[11px] text-muted-foreground">
            Compare prices with verified matches on {crossPlatformRetailer}
          </div>
          {onCompare ? (
            <Btn onClick={() => onCompare(searchQuery)} variant="outline" className="w-full py-1 text-[11.5px]">
              <Search width={12} height={12} />
              Compare on {crossPlatformRetailer}
            </Btn>
          ) : null}
        </div>
      ) : comparison.status === "no_offers_found" || verifiedCrossOffers.length === 0 ? (
        <div className="flex flex-col gap-2">
          {/* Explanation banner */}
          <div className="rounded-lg border border-border bg-card p-2.5 flex flex-col gap-1 text-[11px]">
            <div className="flex items-center justify-between font-semibold">
              <span className="text-foreground">
                {possibleCrossOffers.length > 0
                  ? `Probable Match Found on ${crossPlatformRetailer}`
                  : (comparison.cross_platform_status || comparison.status) === "all_candidates_rejected"
                  ? `No exact model match on ${crossPlatformRetailer}`
                  : (comparison.cross_platform_status || comparison.status) === "no_search_results"
                  ? `No listings found on ${crossPlatformRetailer}`
                  : `No verified offers on ${crossPlatformRetailer}`}
              </span>
              <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider border ${
                possibleCrossOffers.length > 0
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 font-semibold"
                  : "bg-muted text-muted-foreground border-border font-medium"
              }`}>
                {possibleCrossOffers.length > 0
                  ? "UNVERIFIED VARIANT"
                  : (comparison.cross_platform_status || comparison.status) === "all_candidates_rejected"
                  ? "NO EXACT MATCH"
                  : "NO MATCH"}
              </span>
            </div>
            <p className="text-muted-foreground text-[10px] leading-tight">
              {comparison.cross_platform_summary || comparison.summary}
            </p>
          </div>

          {/* Probable / Unverified matches subsection */}
          {possibleCrossOffers.length > 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 flex flex-col gap-2 text-[11px]">
              <div className="flex items-center justify-between font-semibold">
                <span className="text-foreground flex items-center gap-1.5">
                  <Warn width={12} height={12} className="text-amber-600 dark:text-amber-400" />
                  Probable Match ({possibleCrossOffers.length})
                </span>
                <span className="text-[9px] font-normal text-muted-foreground">Excluded from verified savings</span>
              </div>
              <p className="text-[9.5px] text-muted-foreground leading-snug">
                Hardware model appears identical, but color or minor variant specifications cannot be verified from the listing title.
              </p>
              {possibleCrossOffers.slice(0, 3).map((offer, idx) => (
                <div key={idx} className="rounded border border-border bg-card p-2 flex flex-col gap-1">
                  <div className="text-[10.5px] font-medium text-foreground line-clamp-1">{offer.product_title}</div>
                  <div className="text-[9.5px] text-amber-700 dark:text-amber-300">
                    {offer.match_details || offer.rejection_reason || "Variant unverified"}
                  </div>
                  <div className="flex items-baseline justify-between mt-0.5">
                    <div className="flex items-baseline gap-1">
                      <span className="font-bold text-[12.5px]">{INR(offer.current_price)}</span>
                      <span className="text-[9px] text-muted-foreground">(Listing price)</span>
                    </div>
                    <a
                      href={getOfferUrl(offer)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-primary font-semibold underline"
                    >
                      Inspect on {offer.retailer_name} ↗
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {/* Search Again section */}
          <div className="rounded-lg border border-border bg-card p-2.5 flex flex-col gap-2 text-[11px]">
            <div className="flex items-center justify-between font-semibold">
              <span className="text-foreground">Search Again on {crossPlatformRetailer}</span>
              <span className="text-[9.5px] text-muted-foreground">Refine Query</span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (searchQuery.trim() && onCompare) {
                  onCompare(searchQuery.trim());
                }
              }}
              className="flex flex-col gap-1.5"
            >
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search ${crossPlatformRetailer}...`}
                  className="flex-1 text-[11px] rounded-md border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <Btn type="submit" variant="default" className="py-1 px-2.5 text-[11px] shrink-0">
                  <Search width={11} height={11} />
                  Search
                </Btn>
              </div>
              {brandModelChip && brandModelChip !== searchQuery ? (
                <div className="flex items-center gap-1 text-[9.5px] text-muted-foreground">
                  <span>Try:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery(brandModelChip);
                      if (onCompare) onCompare(brandModelChip);
                    }}
                    className="rounded bg-muted px-1.5 py-0.5 font-medium text-foreground hover:bg-muted/80 underline"
                  >
                    {brandModelChip}
                  </button>
                </div>
              ) : null}
            </form>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Verified exact match banner */}
          <div
            className={`rounded-lg border px-2.5 py-1.5 ${
              comparison.price_difference != null && comparison.price_difference > 0
                ? "border-safe-border bg-safe-soft text-safe"
                : "border-border bg-card text-foreground"
            }`}
          >
            <div className="flex items-center justify-between text-[11px] font-bold uppercase">
              <span>{comparison.verdict_label}</span>
              <span className="text-[9px] font-normal text-muted-foreground">Verified Match</span>
            </div>
            <p className="mt-0.5 text-[10.5px] text-foreground/80 leading-snug">
              {comparison.cross_platform_summary || comparison.summary}
            </p>
          </div>

          {/* Verified offers list */}
          {verifiedCrossOffers.map((offer, idx) => {
            const delta = product.current_site_price - offer.current_price;
            const isCheaper = delta > 0;
            return (
              <div key={idx} className="rounded-lg border border-border bg-card p-2.5 flex flex-col gap-1 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">{offer.retailer_name}</span>
                  <span className="rounded bg-safe-soft px-1.5 py-0.5 text-[8.5px] font-semibold text-safe border border-safe-border">
                    EXACT MATCH
                  </span>
                </div>
                <div className="text-foreground/90 font-medium line-clamp-1">{offer.product_title}</div>
                <div className="flex items-baseline justify-between mt-0.5">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-bold text-[13.5px]">{INR(offer.current_price)}</span>
                    {isCheaper ? (
                      <span className="text-[10px] font-semibold text-safe">
                        Save {INR(delta)}
                      </span>
                    ) : null}
                  </div>
                  <a
                    href={getOfferUrl(offer)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-primary font-semibold underline"
                  >
                    View on {offer.retailer_name} ↗
                  </a>
                </div>
              </div>
            );
          })}

          {/* Collapsible search / refine query */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => setShowRefineForm(!showRefineForm)}
              className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition"
            >
              <Search width={9} height={9} />
              {showRefineForm ? "Hide search" : "Refine search query"}
            </button>
          </div>

          {showRefineForm ? (
            <div className="rounded-lg border border-border bg-card p-2 flex flex-col gap-1.5 text-[11px]">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (searchQuery.trim() && onCompare) {
                    onCompare(searchQuery.trim());
                  }
                }}
                className="flex items-center gap-1.5"
              >
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Search ${crossPlatformRetailer}...`}
                  className="flex-1 text-[11px] rounded border border-border bg-background px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <Btn type="submit" variant="default" className="py-1 px-2 text-[10.5px] shrink-0">
                  Search
                </Btn>
              </form>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function getAspectSentiment(asp: AspectItem): { label: "Positive" | "Negative" | "Mixed" | "Limited Data"; className: string } {
  let label: "Positive" | "Negative" | "Mixed" | "Limited Data";
  const rawLabel = (asp.sentiment_label || "").trim().toLowerCase();

  if (rawLabel === "positive") {
    label = "Positive";
  } else if (rawLabel === "negative") {
    label = "Negative";
  } else if (rawLabel === "mixed") {
    label = "Mixed";
  } else if (asp.mention_count !== undefined && asp.mention_count < 2) {
    label = "Limited Data";
  } else if (asp.positive_percentage !== undefined && asp.positive_percentage >= 70) {
    label = "Positive";
  } else if (asp.negative_percentage !== undefined && asp.negative_percentage >= 45) {
    label = "Negative";
  } else {
    label = "Mixed";
  }

  const className =
    label === "Positive"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
      : label === "Negative"
      ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30"
      : label === "Mixed"
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
      : "bg-muted text-muted-foreground border-border";

  return { label, className };
}

function getAspectExplanation(asp: AspectItem): string {
  const mentions = asp.mention_count ?? 0;
  const rawLabel = (asp.sentiment_label || "").trim().toLowerCase();

  // 1. Insufficient review evidence for sparse mentions (< 2)
  if (mentions < 2 || rawLabel === "limited data" || rawLabel === "no data") {
    return "Insufficient review evidence.";
  }

  // Determine effective sentiment
  let sentiment: "positive" | "negative" | "mixed";
  if (rawLabel === "positive" || (asp.positive_percentage !== undefined && asp.positive_percentage >= 70 && (asp.negative_percentage ?? 0) <= 25)) {
    sentiment = "positive";
  } else if (rawLabel === "negative" || (asp.negative_percentage !== undefined && asp.negative_percentage >= 45)) {
    sentiment = "negative";
  } else {
    sentiment = "mixed";
  }

  // Normalize aspect domain from aspect_id and display_name
  const nameNorm = (asp.display_name || asp.aspect_id || "").toLowerCase();
  const idNorm = (asp.aspect_id || "").toLowerCase();
  const combinedKey = `${idNorm} ${nameNorm}`;

  // Analyze text signals across excerpts to detect specific nuances without reproducing crude wording
  const posText = (asp.positive_excerpts || []).join(" ").toLowerCase();
  const negText = (asp.negative_excerpts || []).join(" ").toLowerCase();
  const allText = `${posText} ${negText}`;

  // Specific evidence nuance flags
  const hasSlowCharging = /slow as hell|slow\s+charg|charging\s+is\s+slow|takes\s+forever|crap\s+charger|slow\s+speed/i.test(negText);
  const hasFastDrain = /drain|dies\s+fast|battery\s+dies|poor\s+backup|rapid\s+discharge/i.test(negText);
  const hasBulkyDesign = /bulky|chunky|heavy\s+design|thick|little\s+bit\s+bulky/i.test(negText);
  const hasMinorBulky = /little\s+bit\s+bulky|not\s+that\s+bad/i.test(negText);
  const hasEarlyFailure = /went\s+bad|two\s+days|stopped\s+working|broke\s+in|broke\s+within|died\s+after|defective|drift/i.test(negText);
  const hasDiscomfort = /crab|uncomfortable|pain|tight|hurts|clamp|fatigue|pressure/i.test(negText);
  const hasNoise = /noise|noisy|loud|jet\s+engine|airplane|humming/i.test(negText);
  const hasHeat = /heat|heats|oven|warm|thermal|overheating/i.test(negText);
  const hasInconsistentSizing = /sizing|inconsistent|too\s+small|too\s+large|tight\s+fit|loose\s+fit/i.test(allText);
  const hasAssemblyDifficulty = /assembl|difficult|hard\s+to\s+assemble|confusing|instructions/i.test(allText);
  const hasWeakBass = /bass|muddy|low\s+end|weak\s+bass/i.test(negText);
  const hasMicIssue = /mic|microphone|muffled\s+voice|call\s+quality/i.test(negText);

  // A. VALUE FOR MONEY & PRICING
  if (combinedKey.includes("value") || combinedKey.includes("price") || combinedKey.includes("pricing") || combinedKey.includes("cost") || combinedKey.includes("worth")) {
    if (sentiment === "positive") return "Offers competitive features for its price.";
    if (sentiment === "negative") return "Pricing is widely viewed as high for what is offered.";
    return "Feature set is solid, but pricing feels somewhat steep.";
  }

  // B. BATTERY LIFE & CHARGING
  if (combinedKey.includes("battery") || combinedKey.includes("charging") || combinedKey.includes("power backup")) {
    if (sentiment === "positive") {
      return /rapid|fast|quick/i.test(posText)
        ? "Long-lasting battery endurance with rapid charging capability."
        : "Delivers dependable battery endurance for daily usage.";
    }
    if (sentiment === "negative") {
      if (hasSlowCharging) return "Charging is slower than some buyers expect.";
      if (hasFastDrain) return "Battery drains faster than expected during regular use.";
      return "Battery endurance falls noticeably short of expectations.";
    }
    // Mixed
    if (hasSlowCharging) return "Battery performance appears acceptable, but charging speed receives criticism.";
    if (hasFastDrain) return "Battery endurance is adequate, though heavy usage requires frequent recharging.";
    return "Battery performance appears acceptable, but endurance varies with heavy usage.";
  }

  // C. BUILD QUALITY & MATERIALS
  if (combinedKey.includes("build") || combinedKey.includes("material") || combinedKey.includes("finish") || combinedKey.includes("construction") || combinedKey.includes("sturdy")) {
    if (sentiment === "positive") return "Solid construction with quality materials.";
    if (sentiment === "negative") {
      if (hasBulkyDesign && !hasMinorBulky) return "Bulky form factor makes handling cumbersome.";
      return "Construction materials feel less robust than expected.";
    }
    // Mixed
    if (hasMinorBulky) return "Some buyers find the design bulky, although the concern appears minor.";
    if (hasBulkyDesign) return "Most feedback is favourable, although some buyers find the design bulky.";
    return "Overall construction is satisfactory, though certain components feel less premium.";
  }

  // D. COMFORT & ERGONOMICS
  if (combinedKey.includes("comfort") || combinedKey.includes("ergonom") || combinedKey.includes("grip") || (combinedKey.includes("fit") && !combinedKey.includes("siz"))) {
    if (sentiment === "positive") return "Comfortable fit with lightweight ergonomics.";
    if (sentiment === "negative") {
      if (hasDiscomfort) return "Some buyers report discomfort during extended use.";
      return "Ergonomics and fit draw complaints during daily use.";
    }
    return "Generally comfortable for short periods, but extended wear causes fatigue.";
  }

  // E. DURABILITY & LONGEVITY
  if (combinedKey.includes("durab") || combinedKey.includes("longev") || combinedKey.includes("reliability") || combinedKey.includes("lifespan")) {
    if (sentiment === "positive") return "Demonstrates dependable long-term reliability and build integrity.";
    if (sentiment === "negative") {
      if (hasEarlyFailure) return "Reports of early product failure raise concerns about long-term reliability.";
      return "Frequent complaints regarding premature wear and component failure.";
    }
    if (hasEarlyFailure) return "A buyer reported an early product failure, though most units hold up.";
    return "Durability is acceptable for light use, with minor signs of wear reported.";
  }

  // F. SOUND & AUDIO QUALITY
  if (combinedKey.includes("sound") || combinedKey.includes("audio") || combinedKey.includes("speaker") || combinedKey.includes("acoustic") || combinedKey.includes("bass")) {
    if (sentiment === "positive") return "Delivers clear audio output with balanced frequencies.";
    if (sentiment === "negative") {
      if (hasMicIssue) return "Microphone pickup is muffled and lacks clarity during calls.";
      return "Audio output lacks clarity and exhibits noticeable distortion.";
    }
    if (hasWeakBass) return "Clear audio output, but bass quality receives mixed feedback.";
    if (hasMicIssue) return "Clear audio output, though microphone clarity receives mixed feedback.";
    return "Audio playback is clear, although tonal balance divides opinion.";
  }

  // G. PERFORMANCE & FUNCTIONALITY
  if (combinedKey.includes("perform") || combinedKey.includes("speed") || combinedKey.includes("response") || combinedKey.includes("functionality")) {
    if (sentiment === "positive") return "Smooth and responsive operational performance across tasks.";
    if (sentiment === "negative") {
      if (hasNoise) return "Excessive operational noise disrupts everyday use.";
      if (hasHeat) return "Excessive heat buildup causes thermal throttling.";
      return "Frequent performance lag and sluggish response times.";
    }
    if (hasNoise) return "Buyers appreciate its ease of use, but some report excessive operating noise.";
    if (hasHeat) return "Performance is generally well received, while battery endurance remains a concern.";
    return "Performance is generally well received, with occasional slowdowns noted under load.";
  }

  // H. FIT & SIZING
  if (combinedKey.includes("fit") || combinedKey.includes("siz")) {
    if (sentiment === "positive") return "Fits true to size with comfortable proportions.";
    if (sentiment === "negative") return "Sizing is inconsistent and deviates notably from standard measurements.";
    return "The fabric receives positive feedback, although sizing appears inconsistent.";
  }

  // I. FABRIC & MATERIAL QUALITY
  if (combinedKey.includes("fabric") || combinedKey.includes("cloth") || combinedKey.includes("cotton") || combinedKey.includes("leather") || combinedKey.includes("texture")) {
    if (sentiment === "positive") return "High-quality fabric with a pleasant tactile feel.";
    if (sentiment === "negative") return "Fabric feels thin and prone to premature wear.";
    return "Fabric receives positive feedback, although sizing appears inconsistent.";
  }

  // J. ASSEMBLY & INSTALLATION
  if (combinedKey.includes("assembl") || combinedKey.includes("install") || combinedKey.includes("putting together")) {
    if (sentiment === "positive") return "Straightforward assembly with clear and well-organized instructions.";
    if (sentiment === "negative") return "Assembly is challenging due to ambiguous instructions and misaligned parts.";
    return "Several buyers praise the finish, but assembly can be difficult.";
  }

  // K. DELIVERY & PACKAGING
  if (combinedKey.includes("deliver") || combinedKey.includes("packag") || combinedKey.includes("shipping")) {
    if (sentiment === "positive") return "Prompt delivery with secure protective packaging.";
    if (sentiment === "negative") return "Frequent delivery delays and damaged outer packaging.";
    return "Delivered on schedule, though outer packaging showed handling wear.";
  }

  // L. EASE OF USE & SETUP
  if (combinedKey.includes("ease") || combinedKey.includes("setup") || combinedKey.includes("simple")) {
    if (sentiment === "positive") return "Intuitive controls with an effortless initial setup.";
    if (sentiment === "negative") return "Complicated setup and unintuitive everyday controls.";
    return "Basic operation is simple, but advanced features require a learning curve.";
  }

  // M. TASTE & FLAVOR
  if (combinedKey.includes("taste") || combinedKey.includes("flavor") || combinedKey.includes("flavour") || combinedKey.includes("scent") || combinedKey.includes("fragrance")) {
    if (sentiment === "positive") return "Pleasant flavor profile with natural, fresh taste.";
    if (sentiment === "negative") return "Flavor is underwhelming and artificial in taste.";
    return "Flavor is pleasant, though sweetness levels divide consumer preferences.";
  }

  // N. DISPLAY & SCREEN
  if (combinedKey.includes("display") || combinedKey.includes("screen") || combinedKey.includes("panel")) {
    if (sentiment === "positive") return "Vibrant color reproduction and sharp viewing clarity.";
    if (sentiment === "negative") return "Display lacks brightness and exhibits muted color contrast.";
    return "Sharp display indoors, though outdoor brightness is somewhat limited.";
  }

  // O. CAMERA QUALITY
  if (combinedKey.includes("camera") || combinedKey.includes("photo") || combinedKey.includes("picture")) {
    if (sentiment === "positive") return "Captures sharp photos with accurate color reproduction.";
    if (sentiment === "negative") return "Camera performance is grainy with sluggish focusing speeds.";
    return "Good daylight photography, though low-light shots suffer from noise.";
  }

  // P. GENERIC / DYNAMIC CATEGORY FALLBACK
  const cleanName = (asp.display_name || "feature").trim().toLowerCase();
  if (sentiment === "positive") {
    return `Demonstrates dependable quality and solid ${cleanName}.`;
  }
  if (sentiment === "negative") {
    return `Performance regarding ${cleanName} falls short of expectations.`;
  }
  return `Feedback on ${cleanName} is mostly favourable, with minor reservations noted.`;
}

function ProductDashboard({
  product,
  status,
  view,
  go,
  onAnalyze,
  onRetry,
  reviewAnalysis,
  reviewLoading,
  reviewError,
  analysisStep,
  analysisSource = "live_dom",
  comparison,
  comparisonLoading,
  comparisonError,
  onComparePrices,
}: {
  product: ExtractedProduct | null;
  status: "loading" | "success" | "unsupported" | "error";
  view: View;
  go: (v: View) => void;
  onAnalyze: () => void;
  onRetry: () => void;
  reviewAnalysis?: BatchReviewAnalysisResponse | null;
  reviewLoading?: boolean;
  reviewError?: string | null;
  analysisStep?: string | null;
  analysisSource?: "live_dom" | "demo" | "manual";
  comparison?: ComparePricesResponse | null;
  comparisonLoading?: boolean;
  comparisonError?: string | null;
  onComparePrices?: (customQuery?: string) => void;
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(product?.image || null);
  const [showAllAspects, setShowAllAspects] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"price" | "review">(() => {
    return view === "result" || view === "analyzing" ? "review" : "price";
  });

  const prevProdKeyRef = useRef<string>("");
  const prodKey = product
    ? `${product.source_retailer}::${product.asin || product.retailer_product_id || product.url}`
    : "";

  useEffect(() => {
    setImgSrc(product?.image || null);
  }, [product?.image]);

  useEffect(() => {
    // When product changes, reset to default PRICE COMPARISON tab
    if (prodKey && prodKey !== prevProdKeyRef.current) {
      prevProdKeyRef.current = prodKey;
      setActiveTab("price");
      setShowAllAspects(false);
    }
  }, [prodKey]);

  useEffect(() => {
    // Automatically switch to review tab when analysis is running or completed
    if (view === "result" || view === "analyzing" || reviewLoading) {
      setActiveTab("review");
    }
  }, [view, reviewLoading]);

  // Loading state
  if (status === "loading") {
    return (
      <div className="sg-fade flex flex-col items-center justify-center px-6 py-14 text-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/60">
          <Refresh width={20} height={20} className="animate-spin text-muted-foreground" />
        </div>
        <div>
          <div className="text-[14px] font-semibold text-foreground">Scanning product page</div>
          <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed max-w-[260px]">
            Detecting product title, ASIN, and customer reviews on the active tab...
          </p>
        </div>
      </div>
    );
  }

  // Unsupported page state
  if (status === "unsupported" || !product) {
    return (
      <div className="sg-fade flex flex-col items-center justify-center px-6 py-10 text-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/60">
          <Tag width={22} height={22} className="text-muted-foreground" />
        </div>
        <div>
          <div className="text-[14px] font-semibold text-foreground">No supported product detected</div>
          <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed max-w-[280px]">
            Open an Amazon India (amazon.in) or Flipkart product page to compare prices and analyze customer reviews.
          </p>
        </div>
        <div className="mt-1 flex flex-col gap-2 w-full max-w-[260px]">
          <Btn onClick={onRetry} variant="outline" className="w-full py-2 text-[12.5px]">
            <Refresh width={13} height={13} />
            Re-scan active tab
          </Btn>
          <button
            onClick={() => go("manual")}
            className="text-center text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground transition pt-1"
          >
            Or paste review text manually
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (status === "error") {
    return (
      <div className="sg-fade flex flex-col items-center justify-center px-6 py-10 text-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/60">
          <Warn width={22} height={22} className="text-caution" />
        </div>
        <div>
          <div className="text-[14px] font-semibold text-foreground">Could not read product details</div>
          <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed max-w-[280px]">
            Unable to extract listing or review data. Ensure the product page is fully loaded.
          </p>
        </div>
        <div className="mt-1 flex flex-col gap-2 w-full max-w-[240px]">
          <Btn onClick={onRetry} variant="outline" className="w-full py-2 text-[12.5px]">
            <Refresh width={13} height={13} />
            Retry extraction
          </Btn>
          <button
            onClick={() => go("manual")}
            className="text-center text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground transition pt-1"
          >
            Paste reviews manually
          </button>
        </div>
      </div>
    );
  }

  const productName = product.product_name;
  const storeName = product.source_retailer || (product.url?.includes("flipkart.com") ? "Flipkart" : "Amazon.in");
  const listedPrice = product.current_site_price;
  const realMrp = product.mrp;
  const asinText = product.asin || product.retailer_product_id;
  const ra = reviewAnalysis;

  // Credibility and Trust score
  const trustScore = ra?.trust_score ?? 100;
  let trustBadgeColor = "text-safe bg-safe-soft border-safe-border";
  let trustLabel = "HIGH CREDIBILITY";
  if (trustScore < 60) {
    trustBadgeColor = "text-destructive bg-destructive/10 border-destructive/30";
    trustLabel = "HIGH SUSPICION";
  } else if (trustScore < 80) {
    trustBadgeColor = "text-caution bg-caution-soft border-caution-border";
    trustLabel = "MODERATE SIGNALS";
  }

  const totalAnalyzed = ra?.total_reviews_analyzed ?? 0;

  // Process dynamic aspects
  const rawAspects = ra?.aspect_analysis?.aspects ? [...ra.aspect_analysis.aspects] : [];
  if (
    ra?.aspect_analysis?.delivery_summary &&
    ra.aspect_analysis.delivery_summary.mentions > 0 &&
    !rawAspects.some(
      (a) => a.aspect_id === "delivery_packaging" || a.display_name?.toLowerCase().includes("delivery")
    )
  ) {
    const ds = ra.aspect_analysis.delivery_summary;
    rawAspects.push({
      aspect_id: "delivery_packaging",
      display_name: "Delivery & Packaging",
      category: "logistics_seller",
      mention_count: ds.mentions,
      positive_mentions: 0,
      negative_mentions: 0,
      positive_percentage: ds.positive_percentage,
      negative_percentage: 100 - ds.positive_percentage,
      positive_excerpts: [],
      negative_excerpts: [],
      sentiment_label: ds.positive_percentage >= 70 ? "Positive" : ds.positive_percentage < 40 ? "Negative" : "Mixed",
    });
  }

  const seenAspectNames = new Set<string>();
  const allAspects: AspectItem[] = [];
  for (const asp of rawAspects) {
    if (!asp) continue;
    const displayName = (asp.display_name || asp.aspect || (asp as any).name || asp.aspect_id || "").trim();
    if (!displayName) continue;
    const mentions = asp.mention_count ?? 0;
    if (mentions <= 0) continue;
    const normKey = displayName.toLowerCase();
    if (seenAspectNames.has(normKey)) continue;
    seenAspectNames.add(normKey);
    allAspects.push({ ...asp, display_name: displayName });
  }
  allAspects.sort((a, b) => (b.mention_count ?? 0) - (a.mention_count ?? 0));
  const displayedAspects = showAllAspects ? allAspects : allAspects.slice(0, 5);

  return (
    <div className="sg-fade flex flex-col px-4 py-3.5 gap-3 max-w-full overflow-hidden text-foreground">
      {/* 1. Header with Store & Identifier */}
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Active Product
        </div>
        <div className="flex items-center gap-1.5">
          {asinText ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-mono font-bold text-foreground border border-border">
              {asinText.startsWith("B0") ? "ASIN: " : "ID: "}{asinText}
            </span>
          ) : null}
          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground border border-border">
            {storeName}
          </span>
        </div>
      </div>

      {/* 2. Compact Product Information Card */}
      <div className="flex items-stretch gap-3.5 rounded-xl border border-border bg-card p-3">
        <div className="h-[76px] w-[76px] shrink-0 overflow-hidden rounded-xl border border-border bg-muted flex items-center justify-center">
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={productName}
              onError={() => setImgSrc(null)}
              className="h-full w-full object-cover"
            />
          ) : (
            <Tag width={24} height={24} className="text-muted-foreground/50" />
          )}
        </div>
        <div className="min-w-0 pt-0.5 flex-1 flex flex-col justify-between">
          <div>
            <div className="text-[13px] font-semibold leading-snug line-clamp-2 text-foreground" title={productName}>
              {productName}
            </div>
            {product.variant ? (
              <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                {product.variant}
              </div>
            ) : null}
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            {listedPrice > 0 ? (
              <span className="text-[17px] font-bold">{INR(listedPrice)}</span>
            ) : (
              <span className="text-[13px] font-semibold text-muted-foreground">Price unlisted</span>
            )}
            {realMrp && realMrp > listedPrice ? (
              <span className="text-[11px] text-muted-foreground line-through">
                MRP {INR(realMrp)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Listing Details: Seller, Brand, Model */}
      <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
        <div className="rounded-lg border border-border bg-muted/40 p-1.5 text-center flex flex-col justify-center min-w-0">
          <div className="text-[9px] uppercase font-bold text-muted-foreground">Seller</div>
          <div
            className={`font-semibold text-[10.5px] leading-tight break-words line-clamp-2 mt-0.5 ${
              !product.seller || product.seller === "Unavailable" || product.seller === "Seller unavailable"
                ? "text-muted-foreground italic font-normal"
                : "text-foreground"
            }`}
            title={product.seller && product.seller !== "Unavailable" ? product.seller : "Seller unavailable"}
          >
            {product.seller && product.seller !== "Unavailable" ? product.seller : "Seller unavailable"}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted/40 p-1.5 text-center flex flex-col justify-center min-w-0">
          <div className="text-[9px] uppercase font-bold text-muted-foreground">Brand</div>
          <div className="font-semibold text-foreground truncate mt-0.5" title={product.brand || "Unavailable"}>
            {product.brand || "Unavailable"}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted/40 p-1.5 text-center flex flex-col justify-center min-w-0">
          <div className="text-[9px] uppercase font-bold text-muted-foreground">Model</div>
          <div className="font-semibold text-foreground truncate mt-0.5" title={product.model || "Unavailable"}>
            {product.model || "Unavailable"}
          </div>
        </div>
      </div>

      {/* Specifications Accordion if present */}
      {product.specifications && Object.keys(product.specifications).length > 0 ? (
        <Accordion label={`Product Specifications (${Object.keys(product.specifications).length})`}>
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-1 text-[11px]">
            {Object.entries(product.specifications).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-border/40 py-1">
                <span className="text-muted-foreground truncate max-w-[140px]" title={k}>{k}</span>
                <span className="font-medium text-foreground text-right truncate max-w-[180px]" title={String(v)}>{String(v)}</span>
              </div>
            ))}
          </div>
        </Accordion>
      ) : null}

      {/* 3. Top-Level Navigation Tabs */}
      <div className="grid grid-cols-2 p-1 rounded-xl bg-muted/60 border border-border">
        <button
          type="button"
          onClick={() => setActiveTab("price")}
          className={`py-2 px-3 text-[11.5px] font-bold rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 select-none ${
            activeTab === "price"
              ? "bg-card text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Tag width={13} height={13} className={activeTab === "price" ? "text-primary" : "text-muted-foreground"} />
          <span>PRICE COMPARISON</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("review")}
          className={`py-2 px-3 text-[11.5px] font-bold rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 select-none ${
            activeTab === "review"
              ? "bg-card text-foreground shadow-sm border border-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Shield width={13} height={13} className={activeTab === "review" ? "text-primary" : "text-muted-foreground"} />
          <span>REVIEW ANALYSIS</span>
        </button>
      </div>

      {/* 4. Active Tab Content */}

      {/* TAB 1: PRICE COMPARISON */}
      {activeTab === "price" ? (
        <div className="flex flex-col gap-3">
          <ComparablePricesSection
            product={product}
            comparison={comparison}
            loading={comparisonLoading}
            error={comparisonError}
            onCompare={onComparePrices}
          />

          <div className="flex flex-col gap-2 pt-1">
            <Btn onClick={onRetry} variant="outline" className="w-full py-2 text-[12px]">
              <Refresh width={13} height={13} />
              Re-scan active tab
            </Btn>
          </div>
        </div>
      ) : null}

      {/* TAB 2: REVIEW ANALYSIS */}
      {activeTab === "review" ? (
        <div className="flex flex-col gap-3">
          {/* A. If Loading / In-Progress */}
          {reviewLoading ? (
            <div className="rounded-xl border border-border bg-card p-5 flex flex-col items-center justify-center text-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
                <Refresh width={20} height={20} className="animate-spin text-primary" />
              </div>
              <div>
                <div className="text-[13.5px] font-semibold text-foreground">Analyzing Reviews & Authenticity</div>
                <p className="mt-1 text-[11.5px] text-muted-foreground leading-relaxed max-w-[280px]">
                  {analysisStep || "Running multi-page collection & sentiment inference in background..."}
                </p>
              </div>
            </div>
          ) : reviewError ? (
            /* B. If Error */
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <Warn width={15} height={15} className="mt-0.5 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-bold text-destructive">Could Not Complete Analysis</div>
                  <div className="text-[11px] text-foreground/85 mt-0.5 leading-relaxed">{reviewError}</div>
                </div>
              </div>
              <Btn onClick={onAnalyze} variant="outline" className="py-1 px-3 text-[11.5px] self-start mt-1">
                <Refresh width={12} height={12} />
                Retry Analysis
              </Btn>
            </div>
          ) : !ra ? (
            /* C. If Not Yet Analyzed */
            <div className="rounded-xl border border-border bg-card p-3.5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Shield width={15} height={15} className="text-primary" />
                <span className="text-[12px] font-bold text-foreground">Product Review Intelligence</span>
              </div>
              <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                Evaluate customer sentiment, verified purchase experiences, fake-review patterns, and dynamic product aspects without external LLM APIs.
              </p>
              <Btn onClick={onAnalyze} className="w-full py-2.5 text-[13px]">
                <Shield width={15} height={15} />
                Analyze Customer Reviews
              </Btn>
              <div className="text-center pt-0.5">
                <button
                  onClick={() => go("manual")}
                  className="text-[11px] text-muted-foreground underline underline-offset-4 hover:text-foreground transition"
                >
                  Or paste review text manually
                </button>
              </div>
            </div>
          ) : (
            /* D. If Analysis Available */
            <div className="flex flex-col gap-3">
              {/* Coverage & Count Banner */}
              <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-muted/40 border border-border/60 text-[11px]">
                <span className="text-muted-foreground">
                  Analyzed <strong className="text-foreground">{totalAnalyzed}</strong> customer {totalAnalyzed === 1 ? "review" : "reviews"}
                  {product.reviews_total && product.reviews_total > totalAnalyzed ? (
                    <span className="text-muted-foreground/80"> (out of {product.reviews_total.toLocaleString()} total on listing)</span>
                  ) : null}
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  {product.source_retailer || "Verified"}
                </span>
              </div>

              {/* Purchase Verdict & Concise Review Summary */}
              {ra.llm_summary ? (
                <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Sparkle width={13} height={13} className="text-amber-500" />
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">
                        Synthesized Review Summary
                      </span>
                    </div>
                    <span className="rounded px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                      {ra.llm_summary.provider?.toLowerCase() === "local" ? "LOCAL NLP" : "DEALSENSE AI"}
                    </span>
                  </div>

                  {/* Concise Natural Language Summary */}
                  {ra.llm_summary.summary ? (
                    <div className="text-[11px] text-foreground/90 leading-relaxed bg-muted/30 rounded-lg p-2.5 border border-border/50">
                      {ra.llm_summary.summary}
                    </div>
                  ) : null}

                  {/* Purchase Verdict Card */}
                  <div className={`rounded-xl border p-2.5 flex flex-col gap-1 ${
                    ra.llm_summary.verdict_sentiment === "PROCEED" || ra.llm_summary.verdict_sentiment === "RECOMMENDED"
                      ? "border-emerald-500/30 bg-emerald-500/10"
                      : ra.llm_summary.verdict_sentiment === "AVOID" || ra.llm_summary.verdict_sentiment === "NOT_RECOMMENDED"
                      ? "border-rose-500/30 bg-rose-500/10"
                      : "border-amber-500/30 bg-amber-500/10"
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[9.5px] font-extrabold uppercase tracking-widest text-muted-foreground">
                        Purchase Verdict
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider border ${
                        ra.llm_summary.verdict_sentiment === "PROCEED" || ra.llm_summary.verdict_sentiment === "RECOMMENDED"
                          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/15"
                          : ra.llm_summary.verdict_sentiment === "AVOID" || ra.llm_summary.verdict_sentiment === "NOT_RECOMMENDED"
                          ? "border-rose-500/40 text-rose-600 dark:text-rose-400 bg-rose-500/15"
                          : "border-amber-500/40 text-amber-700 dark:text-amber-400 bg-amber-500/15"
                      }`}>
                        {ra.llm_summary.verdict_sentiment === "PROCEED" || ra.llm_summary.verdict_sentiment === "RECOMMENDED"
                          ? "PROCEED"
                          : ra.llm_summary.verdict_sentiment === "PROCEED_WITH_CAUTION" || ra.llm_summary.verdict_sentiment === "RECOMMENDED_WITH_RESERVATIONS" || ra.llm_summary.verdict_sentiment === "MIXED_TRADE_OFFS"
                          ? "PROCEED WITH CAUTION"
                          : ra.llm_summary.verdict_sentiment === "AVOID" || ra.llm_summary.verdict_sentiment === "NOT_RECOMMENDED"
                          ? "AVOID"
                          : "INSUFFICIENT EVIDENCE"}
                      </span>
                    </div>

                    <div className="text-[11.5px] font-medium text-foreground leading-snug">
                      {ra.llm_summary.verdict}
                    </div>

                    {ra.llm_summary.verdict_detail ? (
                      <div className="text-[10px] text-muted-foreground leading-tight">
                        {ra.llm_summary.verdict_detail}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* Review Authenticity & Credibility */}
              <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Shield width={13} height={13} className="text-violet-500" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">
                      Review Authenticity & Credibility
                    </span>
                  </div>
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${trustBadgeColor}`}>
                    {trustLabel} ({trustScore}/100)
                  </span>
                </div>

                <div className="text-[11px] text-muted-foreground leading-relaxed bg-muted/40 rounded-lg p-2.5 border border-border/40">
                  Credibility evaluates review authenticity independent of customer sentiment. High ratings can still display synthetic or repetitive patterns.
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {ra.fake_review_analysis ? (
                    <div className="rounded-lg bg-sky-500/10 border border-sky-500/20 p-2 text-center">
                      <div className="text-[9px] font-bold uppercase text-sky-600 dark:text-sky-400">
                        Model B Classifier
                      </div>
                      <div className="text-[13px] font-extrabold text-foreground mt-0.5">
                        {ra.fake_review_analysis.or_percentage}% <span className="text-[10px] font-semibold text-muted-foreground">Original</span>
                      </div>
                      <div className="text-[8.5px] text-muted-foreground mt-0.5">
                        {ra.fake_review_analysis.cg_count} computer-generated ({ra.fake_review_analysis.cg_percentage}%)
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-lg bg-violet-500/10 border border-violet-500/20 p-2 text-center">
                    <div className="text-[9px] font-bold uppercase text-violet-600 dark:text-violet-400">
                      Pattern Analysis
                    </div>
                    <div className="text-[13px] font-extrabold text-foreground mt-0.5">
                      {ra.suspicious_analysis.suspicious_count} <span className="text-[10px] font-semibold text-muted-foreground">Flagged</span>
                    </div>
                    <div className="text-[8.5px] text-muted-foreground mt-0.5">
                      {ra.suspicious_analysis.patterns_identified?.length || 0} anomaly pattern(s)
                    </div>
                  </div>
                </div>
              </div>

              {/* PRODUCT ASPECTS */}
              <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">
                    PRODUCT ASPECTS
                  </span>
                  {allAspects.length > 0 ? (
                    <span className="text-[9.5px] text-muted-foreground font-mono">
                      {allAspects.length} aspect{allAspects.length > 1 ? "s" : ""}
                    </span>
                  ) : null}
                </div>

                {allAspects.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {displayedAspects.map((asp) => {
                      const badge = getAspectSentiment(asp);
                      const explanation = getAspectExplanation(asp);
                      return (
                        <div
                          key={asp.aspect_id || asp.display_name}
                          className="flex items-baseline justify-between gap-2.5 py-1.5 px-2.5 rounded-lg border border-border/70 bg-muted/20"
                        >
                          <div className="text-[11px] text-foreground leading-snug min-w-0 flex-1">
                            <span className="font-bold text-foreground">{asp.display_name}</span>
                            <span className="text-muted-foreground mx-1.5">—</span>
                            <span className="text-foreground/85">{explanation}</span>
                          </div>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider border shrink-0 ${badge.className}`}
                          >
                            {badge.label}
                          </span>
                        </div>
                      );
                    })}

                    {allAspects.length > 5 ? (
                      <button
                        type="button"
                        onClick={() => setShowAllAspects((prev) => !prev)}
                        className="flex items-center justify-center gap-1.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                      >
                        <span>{showAllAspects ? "Show less" : `Show more (${allAspects.length - 5} more)`}</span>
                        <ChevronDown
                          width={12}
                          height={12}
                          className={`transition-transform duration-200 ${showAllAspects ? "rotate-180" : ""}`}
                        />
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground py-1 text-center italic">
                    Not enough review data to identify product aspects.
                  </div>
                )}
              </div>

              {/* Small Sample Warning (< 15 reviews) */}
              {totalAnalyzed > 0 && totalAnalyzed < 15 ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 flex items-start gap-2">
                  <Warn width={14} height={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="text-[10.5px] text-foreground leading-relaxed">
                    <span className="font-bold text-amber-700 dark:text-amber-400">Limited Sample ({totalAnalyzed} reviews): </span>
                    Conclusions are based on available reviews on this listing and carry reduced statistical confidence.
                  </div>
                </div>
              ) : null}

              {/* Data limitation note if collection stopped before listing total */}
              {ra?.data_limitations ? (
                <div className="rounded-lg border border-border/80 bg-muted/30 p-2.5 flex items-start gap-2">
                  <Info width={13} height={13} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="text-[10.5px] text-muted-foreground leading-relaxed">
                    {ra.data_limitations}
                  </div>
                </div>
              ) : null}

              {/* Action Buttons */}
              <div className="flex gap-2 pt-1">
                <Btn onClick={onAnalyze} variant="outline" className="flex-1 py-2 text-[11.5px]">
                  <Refresh width={12} height={12} />
                  Re-analyze Reviews
                </Btn>
                <Btn onClick={() => setActiveTab("price")} variant="secondary" className="flex-1 py-2 text-[11.5px]">
                  <Tag width={12} height={12} />
                  View Price Comparison
                </Btn>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- 2. MANUAL SCREEN ---------- */

function Manual({
  go,
  onAnalyzeCustomReviews,
  onLoadSampleReviews,
}: {
  go: (v: View) => void;
  onAnalyzeCustomReviews: (reviews: ExtractedReview[]) => void;
  onLoadSampleReviews?: () => void;
}) {
  const [inputText, setInputText] = useState("");
  const [selectedRating, setSelectedRating] = useState<number>(5);

  const handleManualAnalyze = () => {
    if (!inputText.trim()) return;
    const lines = inputText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 5);

    const reviews: ExtractedReview[] =
      lines.length > 1
        ? lines.map((line, i) => ({
            id: `manual_${i + 1}`,
            text: line,
            rating: selectedRating,
            author: `User ${i + 1}`,
          }))
        : [
            {
              id: "manual_1",
              text: inputText.trim(),
              rating: selectedRating,
              author: "Manual Reviewer",
            },
          ];

    onAnalyzeCustomReviews(reviews);
  };

  return (
    <div className="sg-fade">
      <BackRow label="Review Input Fallback" onClick={() => go("ready")} />
      <div className="flex flex-col px-5 py-4 gap-3.5">
        <div className="text-[12px] text-muted-foreground leading-relaxed">
          If automatic page extraction is blocked or unavailable, paste customer reviews below to run the complete sentiment and authenticity pipeline.
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Customer Review Text (one per line or single paragraph)
          </label>
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={5}
            placeholder="Paste customer reviews here... e.g. Sound quality is amazing and battery lasts for days!"
            className="w-full rounded-xl border border-border bg-muted/40 p-3 text-[12px] text-foreground outline-none focus:border-primary placeholder:text-muted-foreground resize-none"
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-muted-foreground">Star rating:</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setSelectedRating(star)}
                className={`h-7 w-7 rounded-lg text-[11px] font-bold transition ${
                  selectedRating === star
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                ★{star}
              </button>
            ))}
          </div>
        </div>

        <Btn onClick={handleManualAnalyze} disabled={!inputText.trim()} className="w-full py-2.5">
          <Shield width={14} height={14} />
          Analyze Pasted Reviews
        </Btn>
      </div>
    </div>
  );
}

/* ---------- 5. SETTINGS SCREEN ---------- */

function SettingsScreen({
  go,
  prevView,
}: {
  go: (v: View) => void;
  prevView: View;
}) {
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");

  return (
    <div className="sg-fade">
      <BackRow label="Settings" onClick={() => go(prevView)} />
      <div className="flex flex-col px-5 py-4 gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground mb-2">
            Appearance
          </div>
          <div className="flex gap-2">
            {(["system", "light", "dark"] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTheme(t);
                  const isDark =
                    t === "dark" ||
                    (t === "system" &&
                      typeof matchMedia !== "undefined" &&
                      matchMedia("(prefers-color-scheme: dark)").matches);
                  document.documentElement.classList.toggle("dark", isDark);
                  localStorage.setItem("sg-theme", isDark ? "dark" : "light");
                }}
                className={`flex-1 rounded-xl border py-2 text-[12px] font-semibold capitalize transition ${
                  theme === t
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-muted"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <Divider />

        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground mb-2">
            Supervised ML & AI System Architecture
          </div>
          <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2.5 text-[11.5px]">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Model A (Sentiment)</span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">TF-IDF + Logistic Regression</span>
            </div>
            <div className="flex justify-between items-center text-[10.5px]">
              <span className="text-muted-foreground">Model A Training Dataset</span>
              <span className="font-medium text-foreground">Dataset-SA.csv (86.56% Accuracy)</span>
            </div>
            <Divider />
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Model B (Classification)</span>
              <span className="font-semibold text-violet-600 dark:text-violet-400">TF-IDF + Logistic Regression</span>
            </div>
            <div className="flex justify-between items-center text-[10.5px]">
              <span className="text-muted-foreground">Model B Training Dataset</span>
              <span className="font-medium text-foreground">fake reviews dataset.csv (93.51% Acc)</span>
            </div>
            <Divider />
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Generative AI Provider</span>
              <span className="font-semibold text-amber-600 dark:text-amber-400">Gemini 1.5 Flash / OpenAI</span>
            </div>
            <div className="flex justify-between items-center text-[10.5px]">
              <span className="text-muted-foreground">Backend Endpoint</span>
              <span className="font-mono text-[10px] text-foreground">http://127.0.0.1:8000</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- 4. SCREEN ROUTER ---------- */

export function ScreenRouter({
  product = null,
  status = "loading",
  view,
  go,
  prevView,
  onAnalyze = () => {},
  onRetry = () => {},
  reviewAnalysis = null,
  reviewLoading = false,
  reviewError = null,
  analysisStep = null,
  onAnalyzeReviews = () => {},
  analysisSource = "live_dom",
  comparison = null,
  comparisonLoading = false,
  comparisonError = null,
  onComparePrices = () => {},
}: Props) {
  switch (view) {
    case "settings":
      return <SettingsScreen go={go} prevView={prevView} />;
    case "manual":
      return (
        <Manual
          go={go}
          onAnalyzeCustomReviews={onAnalyzeReviews}
        />
      );
    default:
      return (
        <ProductDashboard
          product={product}
          status={status}
          view={view}
          go={go}
          onAnalyze={onAnalyze}
          onRetry={onRetry}
          reviewAnalysis={reviewAnalysis}
          reviewLoading={reviewLoading || view === "analyzing"}
          reviewError={reviewError}
          analysisStep={analysisStep}
          analysisSource={analysisSource}
          comparison={comparison}
          comparisonLoading={comparisonLoading}
          comparisonError={comparisonError}
          onComparePrices={onComparePrices}
        />
      );
  }
}
