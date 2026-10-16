import { useEffect, useRef, useState } from "react";
import {
  INR,
  analyzingSteps,
  type Risk,
} from "../lib/data";
import type { ExtractedProduct } from "../lib/extractor";
import type { AnalyzeResponse, ComparePricesResponse } from "../App";
import {
  ArrowLeft,
  ChevronDown,
  Lock,
  Refresh,
  Search,
  Shield,
  Tag,
  Warn,
} from "./icons";

export type View = "ready" | "analyzing" | "result" | "settings" | "manual";

interface Props {
  product?: ExtractedProduct | null;
  status?: "loading" | "success" | "unsupported" | "error";
  view: View;
  go: (v: View) => void;
  prevView: View;
  onAnalyze?: () => void;
  onRetry?: () => void;
  apiPromise?: Promise<void> | null;
  analysis?: AnalyzeResponse | null;
  error?: string | null;
  scenario?: any;
  comparison?: ComparePricesResponse | null;
  comparisonLoading?: boolean;
  comparisonError?: string | null;
  onComparePrices?: () => void;
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

function Ready({
  product,
  status,
  go,
  onAnalyze,
  onRetry,
}: {
  product: ExtractedProduct | null;
  status: "loading" | "success" | "unsupported" | "error";
  go: (v: View) => void;
  onAnalyze: () => void;
  onRetry: () => void;
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(product?.image || null);

  useEffect(() => {
    setImgSrc(product?.image || null);
  }, [product?.image]);

  if (status === "loading") {
    return (
      <div className="sg-fade flex flex-col items-center justify-center px-6 py-14 text-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/60">
          <Refresh width={20} height={20} className="animate-spin text-muted-foreground" />
        </div>
        <div>
          <div className="text-[14px] font-semibold text-foreground">Scanning product page</div>
          <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed max-w-[260px]">
            Detecting product details, price, and seller on the active tab...
          </p>
        </div>
      </div>
    );
  }

  if (status === "unsupported" || !product) {
    return (
      <div className="sg-fade flex flex-col items-center justify-center px-6 py-10 text-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/60">
          <Tag width={22} height={22} className="text-muted-foreground" />
        </div>
        <div>
          <div className="text-[14px] font-semibold text-foreground">No supported product detected</div>
          <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed max-w-[280px]">
            Open a supported Amazon India or Flipkart product page to analyze pricing and compare offers.
          </p>
        </div>
        <div className="mt-1 flex flex-col gap-2 w-full max-w-[240px]">
          <Btn onClick={onRetry} variant="outline" className="w-full py-2 text-[12.5px]">
            <Refresh width={13} height={13} />
            Re-scan active tab
          </Btn>
          <button
            onClick={() => go("manual")}
            className="text-center text-[12px] text-muted-foreground underline underline-offset-4 hover:text-foreground transition pt-1"
          >
            Or check product by URL
          </button>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="sg-fade flex flex-col items-center justify-center px-6 py-10 text-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/60">
          <Warn width={22} height={22} className="text-caution" />
        </div>
        <div>
          <div className="text-[14px] font-semibold text-foreground">Could not read product details</div>
          <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed max-w-[280px]">
            Unable to extract listing data from this page. Please ensure the product page is fully loaded.
          </p>
        </div>
        <div className="mt-1 flex flex-col gap-2 w-full max-w-[240px]">
          <Btn onClick={onRetry} variant="outline" className="w-full py-2 text-[12.5px]">
            <Refresh width={13} height={13} />
            Retry extraction
          </Btn>
        </div>
      </div>
    );
  }

  const productName = product.product_name;
  const sellerName = product.seller || "Seller not specified";
  const storeName = product.source_retailer || (product.url?.includes("flipkart.com") ? "Flipkart" : "Amazon.in");
  const listedPrice = product.current_site_price;
  const realMrp = product.mrp;
  const variantText = product.variant || null;

  return (
    <div className="sg-fade flex flex-col px-5 py-6 gap-5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Product
        </div>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground border border-border">
          LIVE LISTING
        </span>
      </div>

      <div className="flex items-stretch gap-4">
        <div className="h-[92px] w-[92px] shrink-0 overflow-hidden rounded-xl border border-border bg-muted flex items-center justify-center">
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={productName}
              onError={() => setImgSrc(null)}
              className="h-full w-full object-cover"
            />
          ) : (
            <Tag width={28} height={28} className="text-muted-foreground/50" />
          )}
        </div>
        <div className="min-w-0 pt-0.5 flex-1 flex flex-col">
          <div className="text-[17px] font-semibold leading-snug line-clamp-2">{productName}</div>
          {variantText ? (
            <div className="mt-1 text-[13px] text-muted-foreground line-clamp-2">{variantText}</div>
          ) : null}
          <div className="mt-3 text-[13px] font-medium text-foreground/80">{sellerName}</div>
          <div className="mt-0.5 text-[12px] text-muted-foreground">{storeName}</div>
          <div className="mt-auto pt-4 flex flex-wrap items-baseline gap-2">
            <span className="text-[22px] font-bold">{INR(listedPrice)}</span>
            {realMrp && realMrp > listedPrice ? (
              <span className="text-[12px] text-muted-foreground line-through">
                MRP {INR(realMrp)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-2" />

      <Btn onClick={onAnalyze} className="w-full py-3 text-[13.5px]">
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

function Analyzing({ go, apiPromise }: { go: (v: View) => void; apiPromise: Promise<void> | null }) {
  const [step, setStep] = useState(0);
  const animDoneRef = useRef(false);
  const apiDoneRef = useRef(false);

  // Navigate to result only once BOTH the animation AND the API call are done
  const tryAdvance = useRef(() => {
    if (animDoneRef.current && apiDoneRef.current) {
      go("result");
    }
  });

  useEffect(() => {
    if (step >= analyzingSteps.length) {
      animDoneRef.current = true;
      tryAdvance.current();
      return;
    }
    const t = setTimeout(() => setStep((x) => x + 1), 500);
    return () => clearTimeout(t);
  }, [step]);

  useEffect(() => {
    if (!apiPromise) {
      apiDoneRef.current = true;
      return;
    }
    let cancelled = false;
    apiPromise.finally(() => {
      if (!cancelled) {
        apiDoneRef.current = true;
        tryAdvance.current();
      }
    });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

function QuickRow({
  label,
  value,
  risk,
  neutral = false,
}: {
  label: string;
  value: string;
  risk?: Risk;
  neutral?: boolean;
}) {
  const colorClass = neutral || !risk ? "text-muted-foreground" : RISK_COLOR[risk];
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <span className={`text-right text-[12px] font-medium ${colorClass}`}>{value}</span>
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
  onCompare?: () => void;
}) {
  const isFlipkartSource = Boolean(
    product.source_retailer === "Flipkart" ||
    (product.url && product.url.includes("flipkart.com"))
  );
  const crossPlatformRetailer = isFlipkartSource ? "Amazon India" : "Flipkart";
  const samePlatformRetailer = isFlipkartSource ? "Flipkart" : "Amazon India";

  const verifiedCrossOffers =
    comparison?.cross_platform_offers?.filter(
      (o) => o.match_status === "EXACT_MATCH" && o.availability !== "OUT_OF_STOCK"
    ) ??
    comparison?.verified_offers ??
    [];

  const possibleCrossOffers =
    comparison?.cross_platform_offers?.filter(
      (o) => o.match_status === "POSSIBLE_MATCH" || o.match_status === "UNVERIFIED_VARIANT"
    ) ??
    comparison?.possible_offers ??
    [];

  const samePlatformOffers = comparison?.same_platform_seller_offers ?? [];
  const samePlatformStatus = comparison?.same_platform_status || (comparison ? "no_other_sellers_found" : "not_queried");

  return (
    <div className="flex flex-col gap-3">
      {/* ======================================================== */}
      {/* SECTION A: OTHER PLATFORM (Cross-Platform Comparison)   */}
      {/* ======================================================== */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Other Platform ({crossPlatformRetailer})
          </div>
          <div className="flex items-center gap-2">
            <div className="text-[10px] text-muted-foreground">
              {loading
                ? "Checking stores..."
                : comparison?.status === "success" && verifiedCrossOffers.length > 0
                ? `${verifiedCrossOffers.length} verified offer${verifiedCrossOffers.length > 1 ? "s" : ""}`
                : (comparison?.cross_platform_status || comparison?.status) === "retailer_unavailable"
                ? "Retailer unavailable"
                : (comparison?.cross_platform_status || comparison?.status) === "no_search_results"
                ? "0 listings found"
                : (comparison?.cross_platform_status || comparison?.status) === "all_candidates_rejected"
                ? "No exact match"
                : (comparison?.cross_platform_status || comparison?.status) === "insufficient_data"
                ? "Unverified listings"
                : comparison?.status === "no_offers_found" || verifiedCrossOffers.length === 0
                ? "No verified offers"
                : "Not queried"}
            </div>
            {onCompare && !loading && comparison ? (
              <button
                onClick={onCompare}
                title="Re-check stores with fresh queries"
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
              >
                <Refresh width={10} height={10} />
                Re-check
              </button>
            ) : null}
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-border bg-muted/40 p-4 text-center flex flex-col items-center gap-2.5">
            <Refresh width={18} height={18} className="animate-spin text-foreground/70" />
            <div>
              <div className="text-[12.5px] font-semibold text-foreground">
                Searching {crossPlatformRetailer}...
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Querying live listings on {crossPlatformRetailer} and verifying exact configuration...
              </p>
            </div>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3.5">
            <div className="flex items-start gap-2">
              <Warn width={15} height={15} className="mt-0.5 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <div className="text-[11.5px] font-bold uppercase tracking-wider text-destructive">
                  Comparison Request Failed
                </div>
                <p className="mt-0.5 text-[11px] text-foreground/80 leading-relaxed">
                  {error}
                </p>
                {onCompare ? (
                  <Btn
                    onClick={onCompare}
                    variant="outline"
                    className="mt-2.5 py-1 px-3 text-[11.5px]"
                  >
                    Retry comparison
                  </Btn>
                ) : null}
              </div>
            </div>
          </div>
        ) : !comparison ? (
          <div className="rounded-xl border border-dashed border-border p-3.5 text-center bg-muted/20">
            <div className="text-[12px] font-semibold text-foreground">
              Compare real prices on {crossPlatformRetailer}
            </div>
            <p className="mt-1 text-[11.5px] text-muted-foreground leading-relaxed">
              Retrieve genuine live offers from {crossPlatformRetailer} for this exact product configuration.
            </p>
            {onCompare ? (
              <Btn
                onClick={onCompare}
                variant="outline"
                className="mt-3 w-full py-2 text-[12.5px] font-medium"
              >
                <Search width={13} height={13} />
                Compare prices across stores
              </Btn>
            ) : null}
          </div>
        ) : comparison.status === "no_offers_found" || verifiedCrossOffers.length === 0 ? (
          <div className={`rounded-xl border p-3.5 flex flex-col gap-2.5 ${
            (comparison.cross_platform_status || comparison.status) === "retailer_unavailable"
              ? "border-amber-500/30 bg-amber-500/10"
              : "border-dashed border-border bg-muted/20"
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-foreground">
                {(comparison.cross_platform_status || comparison.status) === "retailer_unavailable"
                  ? `Search temporarily unavailable on ${crossPlatformRetailer}`
                  : (comparison.cross_platform_status || comparison.status) === "no_search_results"
                  ? `No search results on ${crossPlatformRetailer}`
                  : (comparison.cross_platform_status || comparison.status) === "all_candidates_rejected"
                  ? `No exact model match found on ${crossPlatformRetailer}`
                  : (comparison.cross_platform_status || comparison.status) === "insufficient_data"
                  ? `Listings found but specifications unverified on ${crossPlatformRetailer}`
                  : `No verified comparable offers found on ${crossPlatformRetailer}`}
              </span>
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider border ${
                (comparison.cross_platform_status || comparison.status) === "retailer_unavailable"
                  ? "bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30"
                  : (comparison.cross_platform_status || comparison.status) === "no_search_results"
                  ? "bg-background text-muted-foreground border-border"
                  : (comparison.cross_platform_status || comparison.status) === "all_candidates_rejected"
                  ? "bg-background text-muted-foreground border-border"
                  : (comparison.cross_platform_status || comparison.status) === "insufficient_data"
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/25"
                  : "bg-background text-muted-foreground border-border"
              }`}>
                {(comparison.cross_platform_status || comparison.status) === "retailer_unavailable"
                  ? "RETAILER BLOCKED"
                  : (comparison.cross_platform_status || comparison.status) === "no_search_results"
                  ? "0 RESULTS"
                  : (comparison.cross_platform_status || comparison.status) === "all_candidates_rejected"
                  ? "NO EXACT MATCH"
                  : (comparison.cross_platform_status || comparison.status) === "insufficient_data"
                  ? "UNVERIFIED"
                  : "NO MATCH"}
              </span>
            </div>
            <p className="text-[11.5px] text-muted-foreground leading-relaxed">
              {comparison.cross_platform_summary || comparison.summary}
            </p>

            {possibleCrossOffers.length > 0 ? (
              <div className="flex flex-col gap-2 my-1">
                <div className="text-[11px] font-semibold text-foreground/90 uppercase tracking-wide">
                  Potential Matches (Unverified Attributes)
                </div>
                {possibleCrossOffers.map((offer, idx) => (
                  <div key={idx} className="rounded-lg border border-border/80 bg-card p-2.5 text-[11.5px] flex flex-col gap-1 shadow-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">{offer.retailer_name}</span>
                      <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 border border-amber-500/20">
                        POSSIBLE MATCH
                      </span>
                    </div>
                    <div className="text-foreground/90 font-medium line-clamp-2 leading-snug">{offer.product_title}</div>
                    <div className="text-[10.5px] text-muted-foreground mt-0.5 leading-tight">
                      {offer.match_details || "Core configuration compatible; variant details unverified."}
                    </div>
                    <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-border/40">
                      <span className="font-bold text-[14px]">{INR(offer.current_price)}</span>
                      <a href={offer.product_url} target="_blank" rel="noopener noreferrer" className="font-semibold underline text-[11px] text-foreground">
                        View on {offer.retailer_name} ↗
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Comparison summary verdict */}
            <div
              className={`rounded-xl border px-3.5 py-2.5 ${
                comparison.price_difference != null && comparison.price_difference > 0
                  ? "border-safe-border bg-safe-soft"
                  : "border-border bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-[11.5px] font-bold tracking-wide uppercase ${
                    comparison.price_difference != null && comparison.price_difference > 0
                      ? "text-safe"
                      : "text-foreground"
                  }`}
                >
                  {comparison.verdict_label}
                </span>
                <span className="text-[10px] text-muted-foreground font-medium">
                  Verified Match
                </span>
              </div>
              <p className="mt-1 text-[11.5px] text-foreground/85 leading-relaxed">
                {comparison.cross_platform_summary || comparison.summary}
              </p>
            </div>

            {/* List of verified offers */}
            <div className="flex flex-col gap-2">
              {verifiedCrossOffers.map((offer, idx) => {
                const delta = product.current_site_price - offer.current_price;
                const isCheaper = delta > 0;
                return (
                  <div
                    key={`${offer.product_url}-${idx}`}
                    className="rounded-xl border border-border bg-card p-3 shadow-xs flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-bold text-foreground">
                        {offer.retailer_name}
                      </span>
                      <span className="rounded bg-safe-soft px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-safe border border-safe-border">
                        EXACT MATCH
                      </span>
                    </div>

                    <div className="text-[12px] font-medium text-foreground/90 line-clamp-2 leading-snug">
                      {offer.product_title}
                    </div>

                    {offer.seller_name ? (
                      <div className="text-[11px] text-muted-foreground">
                        Sold by <span className="font-semibold text-foreground/85">{offer.seller_name}</span>
                      </div>
                    ) : null}

                    <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-[17px] font-bold text-foreground">
                          {INR(offer.current_price)}
                        </span>
                        {offer.mrp && offer.mrp > offer.current_price ? (
                          <span className="text-[11px] text-muted-foreground line-through">
                            MRP {INR(offer.mrp)}
                          </span>
                        ) : null}
                      </div>

                      {delta !== 0 ? (
                        <span
                          className={`text-[11px] font-semibold ${
                            isCheaper ? "text-safe" : "text-muted-foreground"
                          }`}
                        >
                          {isCheaper
                            ? `Save ${INR(delta)} vs ${samePlatformRetailer}`
                            : `+${INR(Math.abs(delta))} vs ${samePlatformRetailer}`}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          Matches {samePlatformRetailer} price
                        </span>
                      )}
                    </div>

                    <div className="mt-1 pt-2 border-t border-border/50 flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">
                        {offer.delivery_estimate || (offer.availability === "OUT_OF_STOCK" ? "Out of stock" : "Verified live offer")}
                      </span>
                      <a
                        href={offer.product_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-foreground underline underline-offset-3 hover:opacity-80 transition-opacity"
                      >
                        View on {offer.retailer_name} ↗
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* SECTION B: OTHER SELLERS ON THIS PLATFORM                */}
      {/* ======================================================== */}
      <div className="mt-2 pt-3 border-t border-border/60">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Other Sellers on this Platform ({samePlatformRetailer})
          </div>
          <div className="text-[10px] text-muted-foreground">
            {loading
              ? "Checking..."
              : samePlatformStatus === "success" && samePlatformOffers.length > 0
              ? `${samePlatformOffers.length} verified seller${samePlatformOffers.length > 1 ? "s" : ""}`
              : samePlatformStatus === "seller_data_unavailable"
              ? "Seller data unavailable"
              : samePlatformStatus === "no_other_sellers_found"
              ? "Single seller listing"
              : "Not queried"}
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-border bg-muted/30 p-3 text-center flex items-center justify-center gap-2 text-[11.5px] text-muted-foreground">
            <Refresh width={14} height={14} className="animate-spin text-foreground/70" />
            <span>Checking other sellers on {samePlatformRetailer}...</span>
          </div>
        ) : !comparison ? (
          <div className="rounded-xl border border-dashed border-border p-3 text-center bg-muted/20 text-[11.5px] text-muted-foreground">
            Seller comparisons will appear after price analysis.
          </div>
        ) : samePlatformStatus === "seller_data_unavailable" ? (
          <div className="rounded-xl border border-dashed border-border p-3 bg-muted/20 text-[11.5px] flex flex-col gap-1">
            <div className="flex items-center justify-between font-semibold text-foreground">
              <span>Alternative sellers could not be verified</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground border border-border">
                UNAVAILABLE
              </span>
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              Alternative sellers could not be verified from the available retailer data. Public search results do not expose distinct seller identities for this listing.
            </p>
          </div>
        ) : samePlatformStatus === "no_other_sellers_found" || samePlatformOffers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-3 bg-muted/20 text-[11.5px] flex flex-col gap-1">
            <div className="flex items-center justify-between font-semibold text-foreground">
              <span>No additional verified sellers found</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground border border-border">
                SINGLE SELLER
              </span>
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              {product.seller ? `Current listing is sold by ${product.seller}. ` : ""}No distinct verified alternative sellers were found for this exact model and variant on {samePlatformRetailer}.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {comparison.same_platform_summary ? (
              <div className="rounded-lg border border-border/80 bg-muted/30 p-2.5 text-[11px] text-foreground/85">
                {comparison.same_platform_summary}
              </div>
            ) : null}

            {samePlatformOffers.map((offer, idx) => {
              const delta = product.current_site_price - offer.current_price;
              const isCheaper = delta > 0;
              return (
                <div
                  key={`seller-${offer.seller_name}-${idx}`}
                  className="rounded-xl border border-border bg-card p-3 shadow-xs flex flex-col gap-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold text-foreground">
                      {offer.seller_name || "Verified Seller"}
                    </span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground border border-border">
                      {offer.condition || "NEW"}
                    </span>
                  </div>

                  <div className="text-[11.5px] text-muted-foreground truncate">
                    {offer.product_title}
                  </div>

                  <div className="mt-1 flex items-baseline justify-between">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[15px] font-bold text-foreground">
                        {INR(offer.current_price)}
                      </span>
                      {offer.mrp && offer.mrp > offer.current_price ? (
                        <span className="text-[10.5px] text-muted-foreground line-through">
                          MRP {INR(offer.mrp)}
                        </span>
                      ) : null}
                    </div>

                    {delta !== 0 ? (
                      <span
                        className={`text-[11px] font-semibold ${
                          isCheaper ? "text-safe" : "text-muted-foreground"
                        }`}
                      >
                        {isCheaper
                          ? `Save ${INR(delta)} vs current seller`
                          : `+${INR(Math.abs(delta))} vs current seller`}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        Matches current seller price
                      </span>
                    )}
                  </div>

                  <div className="mt-1 pt-1.5 border-t border-border/40 flex items-center justify-between text-[10.5px]">
                    <span className="text-muted-foreground">
                      {offer.delivery_estimate || "In stock"}
                    </span>
                    <a
                      href={offer.product_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-foreground underline underline-offset-2 hover:opacity-80 transition-opacity"
                    >
                      View offer ↗
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ======================================================== */}
      {/* DIAGNOSTICS & SUPPORTED STORES ACCORDION                */}
      {/* ======================================================== */}
      {comparison && (
        <div className="mt-1 flex flex-col gap-2">
          {/* Retailer Search & Verification Diagnostics */}
          <div className="rounded-lg border border-border/70 bg-card/60 p-2.5 text-[11px] flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-muted-foreground text-[10px] uppercase font-semibold tracking-wider">
              <span>Retailer Diagnostics</span>
              {comparison.diagnostics?.query_used ? (
                <span className="font-mono lowercase truncate max-w-[190px]" title={comparison.diagnostics.query_used}>
                  q: {comparison.diagnostics.query_used}
                </span>
              ) : null}
            </div>

            {comparison.retailer_diagnostics && comparison.retailer_diagnostics.length > 0 ? (
              <div className="flex flex-col gap-1 mt-0.5">
                {comparison.retailer_diagnostics.map((rd) => (
                  <div key={rd.retailer_name} className="flex flex-col py-1 border-t border-border/40 first:border-t-0">
                    <div className="flex items-center justify-between font-medium">
                      <span className="text-foreground">{rd.retailer_name}</span>
                      <span className={rd.exact_matches_count > 0 ? "text-safe" : "text-muted-foreground"}>
                        {rd.http_status === 200
                          ? `${rd.parsed_listings_count} listings (${rd.exact_matches_count} exact)`
                          : rd.http_status
                          ? `HTTP ${rd.http_status}`
                          : "Disabled"}
                      </span>
                    </div>
                    {rd.http_status === 200 && rd.parsed_listings_count > 0 && rd.exact_matches_count === 0 ? (
                      <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                        {rd.config_mismatch_count > 0 ? `${rd.config_mismatch_count} config mismatch` : null}
                        {rd.config_mismatch_count > 0 && rd.model_mismatch_count > 0 ? " · " : null}
                        {rd.model_mismatch_count > 0 ? `${rd.model_mismatch_count} model mismatch` : null}
                        {(rd.config_mismatch_count > 0 || rd.model_mismatch_count > 0) && rd.unverified_variant_count > 0 ? " · " : null}
                        {rd.unverified_variant_count > 0 ? `${rd.unverified_variant_count} unverified variant` : null}
                      </div>
                    ) : (
                      <div className="text-[10px] text-muted-foreground/80 mt-0.5 truncate">
                        {rd.status_reason}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <Accordion label="Supported stores status">
            <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              <div className="flex justify-between py-0.5">
                <span className="font-medium text-foreground">Amazon India</span>
                <span className="text-safe">Active · Real-time search & seller retrieval</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="font-medium text-foreground">Flipkart</span>
                <span className="text-safe">Active · Real-time search & seller retrieval</span>
              </div>
            </div>
          </Accordion>

          <div className="flex items-center justify-between pt-1 border-t border-border/50 text-[10.5px] text-muted-foreground">
            <span>
              {comparison.retrieval_timestamp
                ? `Evaluated: ${new Date(comparison.retrieval_timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                : "Live evaluation"}
            </span>
            {onCompare ? (
              <button
                onClick={onCompare}
                disabled={loading}
                className="text-foreground hover:underline font-medium flex items-center gap-1 disabled:opacity-50"
              >
                <Refresh width={11} height={11} className={loading ? "animate-spin" : ""} />
                Re-check stores
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
function Result({
  product,
  analysis,
  error,
  go,
  onRetryAnalysis,
  comparison = null,
  comparisonLoading = false,
  comparisonError = null,
  onComparePrices = () => {},
}: {
  product: ExtractedProduct | null;
  analysis: AnalyzeResponse | null;
  error: string | null;
  go: (v: View) => void;
  onRetryAnalysis: () => void;
  comparison?: ComparePricesResponse | null;
  comparisonLoading?: boolean;
  comparisonError?: string | null;
  onComparePrices?: () => void;
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(product?.image || null);

  useEffect(() => {
    setImgSrc(product?.image || null);
  }, [product?.image]);

  if (!product) {
    return (
      <div className="sg-fade flex flex-col items-center justify-center px-6 py-12 text-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-muted/60">
          <Tag width={22} height={22} className="text-muted-foreground" />
        </div>
        <div>
          <div className="text-[14px] font-semibold text-foreground">No product data</div>
          <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
            Please open a supported Amazon India or Flipkart product page to view analysis.
          </p>
        </div>
        <Btn onClick={() => go("ready")} variant="outline" className="py-2 text-[12.5px]">
          Back to Ready
        </Btn>
      </div>
    );
  }

  const productName = product.product_name;
  const displayPrice = product.current_site_price;
  const sellerName = product.seller || "Seller not specified";
  const variantText = product.variant || null;

  // Strict consistency guards: ensure analysis and comparison refer strictly to the currently rendered product
  const isAnalysisConsistent = Boolean(
    analysis && (!analysis.product_name || analysis.product_name === productName)
  );
  const isComparisonConsistent = Boolean(
    comparison && (!comparison.source_product?.product_name || comparison.source_product.product_name === productName)
  );

  const activeAnalysis = isAnalysisConsistent ? analysis : null;
  const activeComparison = isComparisonConsistent ? comparison : null;
  const pa = activeAnalysis?.price_analysis;

  // Determine verdict visual styling
  let verdictBorderClass = "border-border bg-muted/40";
  let verdictTitleClass = "text-foreground";
  let verdictBadgeLabel = "LISTING CHECK";

  if (pa) {
    if (pa.status === "DISCOUNT_VERIFIED") {
      verdictBorderClass = "border-safe-border bg-safe-soft";
      verdictTitleClass = "text-safe";
      verdictBadgeLabel = "DISCOUNT VERIFIED";
    } else if (pa.status === "PRICE_EXCEEDS_MRP") {
      verdictBorderClass = "border-caution-border bg-caution-soft";
      verdictTitleClass = "text-caution";
      verdictBadgeLabel = "PRICE INCONSISTENCY";
    } else if (pa.status === "LISTED_AT_MRP") {
      verdictBorderClass = "border-border bg-muted/50";
      verdictTitleClass = "text-foreground";
      verdictBadgeLabel = "LISTED AT MRP";
    } else {
      verdictBorderClass = "border-border bg-muted/40";
      verdictTitleClass = "text-foreground";
      verdictBadgeLabel = "MRP UNAVAILABLE";
    }
  }

  return (
    <div className="sg-fade flex flex-col px-5 py-5 gap-5">
      {/* 1. Explicit Error State if API call failed */}
      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3.5">
          <div className="flex items-start gap-2.5">
            <Warn width={16} height={16} className="mt-0.5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-bold tracking-wide uppercase text-destructive">
                Analysis Request Failed
              </div>
              <div className="mt-1 text-[12px] text-foreground/80 leading-relaxed">
                {error}
              </div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Btn onClick={onRetryAnalysis} variant="primary" className="py-1.5 px-3 text-[12px]">
              Retry Analysis
            </Btn>
            <Btn onClick={() => go("ready")} variant="outline" className="py-1.5 px-3 text-[12px]">
              Back to Product
            </Btn>
          </div>
        </div>
      ) : pa ? (
        /* 2. Genuine Deterministic Price Analysis Verdict */
        <div className={`rounded-xl border px-4 py-3 ${verdictBorderClass}`}>
          <div className="flex items-center justify-between">
            <div className={`text-[12px] font-bold tracking-[0.06em] ${verdictTitleClass}`}>
              {pa.verdict_label}
            </div>
            <span className="rounded bg-background/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground border border-border/50">
              {verdictBadgeLabel}
            </span>
          </div>
          <div className="mt-1 text-[11.5px] leading-relaxed text-foreground/85">
            {pa.summary}
          </div>
        </div>
      ) : (
        /* 3. Fallback when accessed without running analysis */
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-bold tracking-[0.06em] text-foreground">
              ANALYSIS NOT YET AVAILABLE
            </div>
            <span className="rounded bg-background px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground border border-border">
              LIVE LISTING
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            Click &apos;Analyze Product&apos; on the product screen to calculate listing price verification.
          </div>
        </div>
      )}

      {/* Product Card with Thumbnail */}
      <div className="flex items-center gap-3">
        <div className="h-[52px] w-[52px] shrink-0 overflow-hidden rounded-lg border border-border bg-muted flex items-center justify-center">
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={productName}
              onError={() => setImgSrc(null)}
              className="h-full w-full object-cover"
            />
          ) : (
            <Tag width={20} height={20} className="text-muted-foreground/50" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-0.5">
            Product
          </div>
          <div className="text-[13px] font-semibold leading-snug line-clamp-2">
            {productName}
          </div>
          {variantText ? (
            <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
              {variantText}
            </div>
          ) : null}
        </div>
      </div>

      {/* Price Section */}
      <div>
        <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-1.5">
          Listing price
        </div>
        <div className="text-[34px] font-bold leading-none tracking-tight">
          {INR(pa ? pa.selling_price : displayPrice)}
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-2.5 text-[11px] text-muted-foreground">
          {pa ? (
            <>
              {pa.mrp ? <span>MRP {INR(pa.mrp)}</span> : <span>MRP unavailable</span>}
              {pa.discount_amount != null && pa.discount_percent != null && pa.discount_amount > 0 ? (
                <span className="text-safe font-medium">
                  Save {INR(pa.discount_amount)} ({pa.discount_percent}%)
                </span>
              ) : null}
              {pa.status === "LISTED_AT_MRP" ? (
                <span>Listed at MRP (no discount)</span>
              ) : null}
              {pa.status === "PRICE_EXCEEDS_MRP" ? (
                <span className="text-caution font-medium">Listed higher than marked MRP</span>
              ) : null}
            </>
          ) : (
            <>
              {product.mrp ? <span>MRP {INR(product.mrp)}</span> : <span>MRP unavailable</span>}
              {product.mrp && displayPrice < product.mrp ? (
                <span>Save {INR(product.mrp - displayPrice)}</span>
              ) : null}
            </>
          )}
        </div>
        {pa && pa.discount_amount != null && pa.discount_amount > 0 && (
          <div className="mt-1 text-[11px] text-muted-foreground italic">
            * Discount is calculated against listing MRP — not verified against competitor stores.
          </div>
        )}
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          Market price range: Not verified
        </div>
      </div>

      <Divider />

      {/* Quick check */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2.5">
          Quick check
        </div>
        <div className="flex flex-col gap-1">
          <QuickRow
            label="Price"
            value={
              pa
                ? pa.status === "DISCOUNT_VERIFIED"
                  ? `${pa.discount_percent}% off MRP`
                  : pa.status === "PRICE_EXCEEDS_MRP"
                  ? "Above marked MRP"
                  : pa.status === "LISTED_AT_MRP"
                  ? "At MRP (no discount)"
                  : `${INR(pa.selling_price)} · Extracted`
                : `${INR(displayPrice)} · Extracted`
            }
            risk={
              pa?.status === "DISCOUNT_VERIFIED"
                ? "safe"
                : pa?.status === "PRICE_EXCEEDS_MRP"
                ? "caution"
                : undefined
            }
            neutral={!pa || (pa.status !== "DISCOUNT_VERIFIED" && pa.status !== "PRICE_EXCEEDS_MRP")}
          />
          <QuickRow
            label={`Seller — ${activeAnalysis?.seller_analysis?.seller || sellerName}`}
            value="Reputation unverified"
            neutral
          />
          <QuickRow
            label="Reviews"
            value="Analysis not yet available"
            neutral
          />
        </div>
      </div>

      <Divider />

      {/* Comparable stores */}
      <ComparablePricesSection
        product={product}
        comparison={activeComparison}
        loading={comparisonLoading}
        error={comparisonError}
        onCompare={onComparePrices}
      />

      <Divider />

      {/* Listing details — expandable */}
      <Accordion label="Listing details & analysis breakdown">
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2.5">
            <span className="mt-[4px] h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />
            <span className="text-[12px] text-muted-foreground leading-snug">
              {pa ? pa.summary : `Extracted live from ${product.source_retailer || (product.url?.includes("flipkart.com") ? "Flipkart" : "Amazon.in")} listing.`}
            </span>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="mt-[4px] h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" />
            <span className="text-[12px] text-muted-foreground leading-snug">
              Seller reputation and reviews analysis remain unverified until supported by reliable evidence.
            </span>
          </div>

          {/* Review details */}
          <div className="mt-2 border-t border-border pt-3">
            <Accordion label="Review details">
              <div className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
                <div className="flex justify-between">
                  <span>Review analysis</span>
                  <span className="text-foreground">Unverified</span>
                </div>
                <p className="mt-1 text-[11px] italic leading-relaxed">
                  {activeAnalysis?.reviews_analysis?.summary ||
                    "Sentiment and authenticity analysis will be available in an upcoming update."}
                </p>
              </div>
            </Accordion>
          </div>

          {/* Seller details */}
          <div className="border-t border-border pt-3">
            <Accordion label="Seller details">
              <div className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
                <div className="flex justify-between">
                  <span>Seller</span>
                  <span className="text-foreground font-medium">
                    {activeAnalysis?.seller_analysis?.seller || sellerName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Reputation</span>
                  <span className="text-foreground">Unverified</span>
                </div>
                <div className="flex justify-between">
                  <span>Source</span>
                  <span className="text-foreground">Amazon India</span>
                </div>
                <p className="mt-1 text-[11px] italic leading-relaxed">
                  {activeAnalysis?.seller_analysis?.summary ||
                    "Seller history and credibility are unverified."}
                </p>
              </div>
            </Accordion>
          </div>
        </div>
      </Accordion>

      <div className="pt-1">
        <Btn onClick={() => go("ready")} variant="outline" className="w-full py-2.5 text-[13px]">
          <ArrowLeft width={14} height={14} />
          Back to Product
        </Btn>
      </div>
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

export function ScreenRouter({
  product = null,
  status = "loading",
  view,
  go,
  prevView,
  onAnalyze = () => {},
  onRetry = () => {},
  apiPromise = null,
  analysis = null,
  error = null,
  comparison = null,
  comparisonLoading = false,
  comparisonError = null,
  onComparePrices = () => {},
}: Props) {
  switch (view) {
    case "ready":
      return (
        <Ready
          product={product}
          status={status}
          go={go}
          onAnalyze={onAnalyze}
          onRetry={onRetry}
        />
      );
    case "analyzing":
      return <Analyzing go={go} apiPromise={apiPromise} />;
    case "result":
      return (
        <Result
          product={product}
          analysis={analysis}
          error={error}
          go={go}
          onRetryAnalysis={onAnalyze}
          comparison={comparison}
          comparisonLoading={comparisonLoading}
          comparisonError={comparisonError}
          onComparePrices={onComparePrices}
        />
      );
    case "settings":
      return <SettingsScreen go={go} prevView={prevView} />;
    case "manual":
      return <Manual go={go} />;
  }
}
