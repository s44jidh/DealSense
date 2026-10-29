import { useEffect, useRef, useState } from "react";
import { INR } from "../lib/data";
import type { ExtractedProduct } from "../lib/extractor";
import type {
  BatchReviewAnalysisResponse,
  ExtractedReview,
  ComparePricesResponse,
  ComparableOffer,
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
  onAnalyzeReviews?: (reviews: ExtractedReview[]) => void;
  onLoadSampleReviews?: () => void;
  analysisSource?: "live_dom" | "demo" | "manual";
  isDemoMode?: boolean;
  comparison?: ComparePricesResponse | null;
  comparisonLoading?: boolean;
  comparisonError?: string | null;
  onComparePrices?: (customQuery?: string) => void;
  targetReviewCount?: number;
  onSetTargetReviewCount?: (target: number) => void;
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

function Ready({
  product,
  status,
  go,
  onAnalyze,
  onRetry,
  onLoadSampleReviews,
  isDemoMode,
  comparison,
  comparisonLoading,
  comparisonError,
  onComparePrices,
  targetReviewCount = 100,
  onSetTargetReviewCount,
}: {
  product: ExtractedProduct | null;
  status: "loading" | "success" | "unsupported" | "error";
  go: (v: View) => void;
  onAnalyze: () => void;
  onRetry: () => void;
  onLoadSampleReviews?: () => void;
  isDemoMode?: boolean;
  comparison?: ComparePricesResponse | null;
  comparisonLoading?: boolean;
  comparisonError?: string | null;
  onComparePrices?: (customQuery?: string) => void;
  targetReviewCount?: number;
  onSetTargetReviewCount?: (target: number) => void;
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
            Detecting product title, ASIN, and customer reviews on the active Amazon India tab...
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
            Open an Amazon India (amazon.in) or Flipkart product page to analyze customer reviews and detect suspicious patterns.
          </p>
        </div>
        <div className="mt-1 flex flex-col gap-2 w-full max-w-[260px]">
          <Btn onClick={onRetry} variant="outline" className="w-full py-2 text-[12.5px]">
            <Refresh width={13} height={13} />
            Re-scan active tab
          </Btn>
          {onLoadSampleReviews ? (
            <Btn onClick={onLoadSampleReviews} variant="secondary" className="w-full py-2 text-[12.5px]">
              <Shield width={13} height={13} />
              Try Demo Mode (Sample Dataset)
            </Btn>
          ) : null}
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
  const detectedReviewsCount = product.reviews ? product.reviews.length : 0;
  const asinText = product.asin || product.retailer_product_id;
  const pagesScanned = product.scan_metadata?.pages_scanned || 1;

  return (
    <div className="sg-fade flex flex-col px-5 py-5 gap-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Active Product
        </div>
        <div className="flex items-center gap-1.5">
          {asinText ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-mono font-bold text-foreground border border-border">
              ASIN: {asinText}
            </span>
          ) : null}
          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground border border-border">
            {storeName}
          </span>
        </div>
      </div>

      {/* Product Card with Thumbnail and extracted title */}
      <div className="flex items-stretch gap-3.5">
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
            <div className="text-[13.5px] font-semibold leading-snug line-clamp-2 text-foreground" title={productName}>
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
        <div className="rounded-lg border border-border bg-muted/40 p-1.5 text-center">
          <div className="text-[9px] uppercase font-bold text-muted-foreground">Seller</div>
          <div className="font-semibold text-foreground truncate" title={product.seller || "Unavailable"}>
            {product.seller || "Unavailable"}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted/40 p-1.5 text-center">
          <div className="text-[9px] uppercase font-bold text-muted-foreground">Brand</div>
          <div className="font-semibold text-foreground truncate" title={product.brand || "Unavailable"}>
            {product.brand || "Unavailable"}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted/40 p-1.5 text-center">
          <div className="text-[9px] uppercase font-bold text-muted-foreground">Model</div>
          <div className="font-semibold text-foreground truncate" title={product.model || "Unavailable"}>
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

      {/* Review Target Depth Selector (100 reviews default vs 300 deep) */}
      <div className="rounded-xl border border-border bg-card p-2.5 flex items-center justify-between">
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="text-[11.5px] font-bold text-foreground">Review Depth Target</span>
            <span className="rounded bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 text-[8.5px] font-mono font-bold">
              {targetReviewCount === 300 ? "300 Deep" : "100 Standard"}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground mt-0.5">
            Multi-page collection depth for sentiment & fake review models
          </span>
        </div>
        <div className="flex items-center gap-1 bg-muted/70 p-0.5 rounded-lg border border-border">
          <button
            type="button"
            onClick={() => onSetTargetReviewCount && onSetTargetReviewCount(100)}
            className={`px-2.5 py-1 text-[10.5px] font-bold rounded-md transition select-none ${
              targetReviewCount === 100
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            100
          </button>
          <button
            type="button"
            onClick={() => onSetTargetReviewCount && onSetTargetReviewCount(300)}
            className={`px-2.5 py-1 text-[10.5px] font-bold rounded-md transition select-none ${
              targetReviewCount === 300
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            300 Max
          </button>
        </div>
      </div>

      {/* Review Detection Status Badge (Requirement 4 & 5) */}
      <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star width={14} height={14} className="text-amber-500 fill-amber-500 shrink-0" />
          <span className="text-[12px] font-medium text-foreground">
            {detectedReviewsCount > 0
              ? `${detectedReviewsCount} reviews in DOM • Target: ${targetReviewCount}`
              : "0 reviews found in active page DOM"}
          </span>
        </div>
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border shrink-0 ${
          detectedReviewsCount > 0
            ? "bg-safe-soft text-safe border-safe-border"
            : "bg-caution-soft text-caution border-caution-border"
        }`}>
          {detectedReviewsCount > 0 ? "READY" : "SCROLL TO LOAD"}
        </span>
      </div>

      {detectedReviewsCount === 0 ? (
        <div className="rounded-lg bg-muted/60 border border-border/60 p-2.5 text-[11px] text-muted-foreground leading-relaxed flex items-start gap-2">
          <Info width={13} height={13} className="shrink-0 mt-0.5 text-muted-foreground" />
          <span>
            Amazon renders reviews dynamically. Please scroll down to the &quot;Customer Reviews&quot; section on the Amazon page, then click &quot;Re-scan active tab&quot; below.
          </span>
        </div>
      ) : null}

      {/* Price Comparison section */}
      {product ? (
        <ComparablePricesSection
          product={product}
          comparison={comparison}
          loading={comparisonLoading}
          error={comparisonError}
          onCompare={onComparePrices}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        {detectedReviewsCount > 0 ? (
          <Btn onClick={onAnalyze} className="w-full py-2.5 text-[13px]">
            <Shield width={15} height={15} />
            Collect & Analyze Reviews (Target: {targetReviewCount})
          </Btn>
        ) : (
          <Btn onClick={onRetry} variant="outline" className="w-full py-2.5 text-[12.5px]">
            <Refresh width={14} height={14} />
            Re-scan active tab for reviews
          </Btn>
        )}
      </div>

      <div className="text-center pt-1">
        <button
          onClick={() => go("manual")}
          className="text-[11.5px] text-muted-foreground underline underline-offset-4 hover:text-foreground transition"
        >
          Paste reviews manually
        </button>
      </div>
    </div>
  );
}

/* ---------- 2. ANALYZING SCREEN ---------- */

function Analyzing({
  go,
  targetReviewCount = 100,
}: {
  go: (v: View) => void;
  targetReviewCount?: number;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const steps = [
    `Collecting customer reviews across pages (Target: ${targetReviewCount})...`,
    "Deduplicating reviews and checking rating diversity (1★ to 5★)...",
    "Running Model A (TF-IDF + Logistic Regression Sentiment)...",
    "Running Model B (Kaggle Dataset CG vs OR Classification)...",
    "Extracting functional product & logistics aspects...",
    "Synthesizing Local Review Summary & recurring complaints...",
    "Compiling Trust Report and authenticity score...",
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setStepIndex((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, 450);
    return () => clearInterval(timer);
  }, [steps.length]);

  return (
    <div className="sg-fade flex flex-col items-center justify-center px-6 py-14 text-center gap-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
        <Refresh width={22} height={22} className="animate-spin text-primary" />
      </div>
      <div>
        <div className="text-[14px] font-semibold text-foreground">
          Analyzing Reviews & Authenticity
        </div>
        <p className="mt-1.5 text-[12px] text-muted-foreground leading-relaxed max-w-[280px]">
          {steps[stepIndex]}
        </p>
      </div>
      <div className="w-48 bg-muted rounded-full h-1.5 overflow-hidden mt-1">
        <div
          className="bg-primary h-full transition-all duration-300"
          style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
        />
      </div>
    </div>
  );
}

/* ---------- 3. RESULT SCREEN ---------- */

function Result({
  product,
  reviewAnalysis,
  reviewLoading,
  reviewError,
  go,
  onRetryAnalysis,
  analysisSource = "live_dom",
  isDemoMode = false,
  comparison,
  comparisonLoading,
  comparisonError,
  onComparePrices,
  targetReviewCount = 100,
  onSetTargetReviewCount,
}: {
  product: ExtractedProduct | null;
  reviewAnalysis?: BatchReviewAnalysisResponse | null;
  reviewLoading?: boolean;
  reviewError?: string | null;
  go: (v: View) => void;
  onRetryAnalysis: () => void;
  analysisSource?: "live_dom" | "demo" | "manual";
  isDemoMode?: boolean;
  comparison?: ComparePricesResponse | null;
  comparisonLoading?: boolean;
  comparisonError?: string | null;
  onComparePrices?: (customQuery?: string) => void;
  targetReviewCount?: number;
  onSetTargetReviewCount?: (target: number) => void;
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(product?.image || null);
  const [visibleReviewsCount, setVisibleReviewsCount] = useState<number>(10);

  useEffect(() => {
    setImgSrc(product?.image || null);
  }, [product?.image]);

  const productName = product?.product_name || reviewAnalysis?.product_name || "Product Customer Reviews";
  const storeName = reviewAnalysis?.source_retailer || product?.source_retailer || "Amazon.in";
  const asinText = product?.asin || product?.retailer_product_id;
  const ra = reviewAnalysis;

  // Sentiment calculations (Model A)
  const posPct = ra?.sentiment_percentages?.positive ?? 0;
  const neuPct = ra?.sentiment_percentages?.neutral ?? 0;
  const negPct = ra?.sentiment_percentages?.negative ?? 0;

  // Trust score and credibility
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

  const pagesScanned = product?.scan_metadata?.pages_scanned || 1;
  const targetCount = product?.scan_metadata?.target_count || targetReviewCount || 100;
  const totalAnalyzed = ra?.total_reviews_analyzed ?? 0;

  // Rating counts (1★ through 5★)
  const ratingCounts: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  if (ra?.rating_distribution && Object.keys(ra.rating_distribution).length > 0) {
    Object.assign(ratingCounts, ra.rating_distribution);
  } else if (product?.scan_metadata?.rating_distribution) {
    Object.assign(ratingCounts, product.scan_metadata.rating_distribution);
  } else if (ra?.analyzed_reviews) {
    for (const r of ra.analyzed_reviews) {
      if (r.rating) {
        const k = String(Math.round(r.rating));
        if (ratingCounts[k] !== undefined) ratingCounts[k]++;
      }
    }
  }

  // Filter and sort product aspects by mention count descending
  const sortedAspects = ra?.aspect_analysis?.aspects
    ? [...ra.aspect_analysis.aspects]
        .filter((a) => a.category === "product" && a.mention_count > 0)
        .sort((a, b) => b.mention_count - a.mention_count)
    : [];
  const primaryAspects = sortedAspects.slice(0, 3);
  const remainingAspects = sortedAspects.slice(3);
  const deliverySummary = ra?.aspect_analysis?.delivery_summary;

  // Themes
  const positiveThemes = ra?.llm_summary?.common_positive_themes || [];
  const topPositiveThemes = positiveThemes.slice(0, 3);
  const morePositiveThemes = positiveThemes.slice(3);

  const complaints = ra?.llm_summary?.recurring_complaints || [];
  const topComplaints = complaints.slice(0, 3);
  const moreComplaints = complaints.slice(3);

  const hasAdditionalInsights =
    morePositiveThemes.length > 0 ||
    moreComplaints.length > 0 ||
    (ra?.llm_summary?.pros && ra.llm_summary.pros.length > 0) ||
    (ra?.llm_summary?.cons && ra.llm_summary.cons.length > 0) ||
    (ra?.llm_summary?.investigation_patterns && ra.llm_summary.investigation_patterns.length > 0);

  return (
    <div className="sg-fade flex flex-col px-4 py-3.5 gap-3 max-w-full overflow-hidden text-foreground">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => go("ready")}
          className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft width={13} height={13} />
          Back to Product
        </button>
        <div className="flex items-center gap-1.5">
          {isDemoMode ? (
            <span className="rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border border-amber-500/30">
              DEMO PRESET
            </span>
          ) : (
            <span className="rounded bg-safe-soft text-safe px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border border-safe-border">
              LIVE DOM
            </span>
          )}
          <span className="rounded bg-muted px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground border border-border">
            {storeName}
          </span>
        </div>
      </div>

      {/* 1. Compact Product Header */}
      <div className="rounded-xl border border-border bg-card p-2.5 flex items-start gap-2.5">
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-border bg-muted flex items-center justify-center">
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={productName}
              onError={() => setImgSrc(null)}
              className="h-full w-full object-cover"
            />
          ) : (
            <Tag width={16} height={16} className="text-muted-foreground/50" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold leading-tight line-clamp-2 text-foreground" title={productName}>
            {productName}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-muted-foreground">
            {product?.current_site_price ? (
              <span className="font-bold text-foreground">
                {INR(product.current_site_price)}
              </span>
            ) : null}
            {product?.brand && product.brand !== "Unavailable" ? (
              <>
                <span>•</span>
                <span className="truncate max-w-[100px]" title={product.brand}>{product.brand}</span>
              </>
            ) : null}
            {product?.model && product.model !== "Unavailable" ? (
              <>
                <span>•</span>
                <span className="truncate max-w-[90px]" title={product.model}>{product.model}</span>
              </>
            ) : null}
            {product?.seller && product.seller !== "Unavailable" ? (
              <>
                <span>•</span>
                <span className="truncate max-w-[90px]" title={product.seller}>By {product.seller}</span>
              </>
            ) : null}
            {asinText ? (
              <span className="rounded bg-muted/80 px-1 py-0.2 font-mono text-[9px] font-medium text-muted-foreground border border-border/60">
                {asinText}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Error state */}
      {reviewError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <Warn width={15} height={15} className="mt-0.5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-bold text-destructive">Could Not Retrieve Reviews</div>
              <div className="text-[11px] text-foreground/85 mt-0.5 leading-relaxed">{reviewError}</div>
            </div>
          </div>
          <div className="flex gap-2 mt-1">
            <Btn onClick={onRetryAnalysis} variant="outline" className="py-1 px-2.5 text-[11.5px]">
              <Refresh width={12} height={12} />
              Retry Extraction
            </Btn>
            <Btn onClick={() => go("ready")} variant="secondary" className="py-1 px-2.5 text-[11.5px]">
              Back to Product
            </Btn>
          </div>
        </div>
      ) : null}

      {/* 2. Review Overview */}
      {ra ? (
        <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tag width={13} height={13} className="text-primary" />
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">
                Review Overview
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">
                {totalAnalyzed} analyzed <span className="text-[9px] opacity-70">(Target: {targetCount})</span>
              </span>
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${
                posPct >= 65
                  ? "bg-safe-soft text-safe border-safe-border"
                  : negPct >= 40
                  ? "bg-destructive/10 text-destructive border-destructive/30"
                  : "bg-caution-soft text-caution border-caution-border"
              }`}>
                {ra.overall_sentiment_label}
              </span>
            </div>
          </div>

          {/* 3-color Segmented Progress Bar */}
          <div className="w-full h-2 rounded-full overflow-hidden flex bg-muted">
            <div style={{ width: `${posPct}%` }} className="bg-emerald-500 transition-all duration-300" title={`Positive: ${posPct}%`} />
            <div style={{ width: `${neuPct}%` }} className="bg-slate-400 dark:bg-slate-600 transition-all duration-300" title={`Neutral: ${neuPct}%`} />
            <div style={{ width: `${negPct}%` }} className="bg-rose-500 transition-all duration-300" title={`Negative: ${negPct}%`} />
          </div>

          {/* Sentiment Stat Triplets */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 py-1.5 px-2 text-center">
              <div className="text-[9px] font-bold uppercase text-emerald-600 dark:text-emerald-400">Positive</div>
              <div className="text-[13px] font-extrabold text-foreground leading-tight mt-0.5">{posPct}%</div>
              <div className="text-[8.5px] text-muted-foreground">{ra.sentiment_distribution.positive} reviews</div>
            </div>
            <div className="rounded-lg bg-muted border border-border py-1.5 px-2 text-center">
              <div className="text-[9px] font-bold uppercase text-muted-foreground">Neutral</div>
              <div className="text-[13px] font-extrabold text-foreground leading-tight mt-0.5">{neuPct}%</div>
              <div className="text-[8.5px] text-muted-foreground">{ra.sentiment_distribution.neutral} reviews</div>
            </div>
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 py-1.5 px-2 text-center">
              <div className="text-[9px] font-bold uppercase text-rose-600 dark:text-rose-400">Negative</div>
              <div className="text-[13px] font-extrabold text-foreground leading-tight mt-0.5">{negPct}%</div>
              <div className="text-[8.5px] text-muted-foreground">{ra.sentiment_distribution.negative} reviews</div>
            </div>
          </div>

          {/* Rating Distribution (1★ to 5★) */}
          <div className="pt-1 border-t border-border/60">
            <div className="flex items-center justify-between text-[9.5px] text-muted-foreground mb-1.5">
              <span className="font-semibold text-foreground flex items-center gap-1">
                <Star width={11} height={11} className="text-amber-500 fill-amber-500" />
                Rating Distribution
              </span>
              <span>{pagesScanned} page{pagesScanned > 1 ? "s" : ""} scanned</span>
            </div>
            <div className="grid grid-cols-5 gap-1">
              {[5, 4, 3, 2, 1].map((star) => {
                const count = ratingCounts[String(star)] || 0;
                const pct = totalAnalyzed > 0 ? Math.round((count / totalAnalyzed) * 100) : 0;
                return (
                  <div key={star} className="rounded bg-muted/40 border border-border/50 py-1 px-0.5 text-center flex flex-col items-center">
                    <span className="text-[9px] font-bold text-amber-500">★{star}</span>
                    <span className="text-[11.5px] font-extrabold text-foreground my-0.5">{count}</span>
                    <span className="text-[8px] text-muted-foreground">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Small Sample Warning (< 15 reviews) */}
          {totalAnalyzed > 0 && totalAnalyzed < 15 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 flex items-start gap-2">
              <Warn width={14} height={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div className="text-[10.5px] text-foreground leading-relaxed">
                <span className="font-bold text-amber-700 dark:text-amber-400">Small Sample Notice ({totalAnalyzed} reviews): </span>
                Conclusions are based on available reviews on this listing and carry reduced statistical confidence.
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 3. Synthesized Review Summary & Purchase Verdict */}
      {ra && ra.llm_summary ? (
        <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2.5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkle width={13} height={13} className="text-amber-500" />
              <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">
                Synthesized Review Summary
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9.5px] text-muted-foreground font-mono">
                {totalAnalyzed} of {targetCount} analyzed
              </span>
              <span className="rounded px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider border bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                {ra.llm_summary.provider?.toLowerCase() === "local" ? "LOCAL NLP" : `${ra.llm_summary.provider?.toUpperCase()} AI`}
              </span>
            </div>
          </div>

          {/* Primary Synthesized Paragraph (60-100 words) */}
          <div className="text-[11px] text-foreground/90 leading-relaxed bg-muted/40 rounded-lg p-2.5 border border-border/40 font-normal">
            {ra.llm_summary.summary || "No review summary available."}
          </div>

          {/* Visually Distinct Purchase Verdict Card (Actionable Decision) */}
          {ra.llm_summary.verdict ? (
            <div className={`rounded-xl border p-2.5 flex flex-col gap-1.5 ${
              ra.llm_summary.verdict_sentiment === "PROCEED" || ra.llm_summary.verdict_sentiment === "RECOMMENDED"
                ? "border-emerald-500/35 bg-emerald-500/5"
                : ra.llm_summary.verdict_sentiment === "PROCEED_WITH_CAUTION" || ra.llm_summary.verdict_sentiment === "RECOMMENDED_WITH_RESERVATIONS" || ra.llm_summary.verdict_sentiment === "MIXED_TRADE_OFFS"
                ? "border-amber-500/35 bg-amber-500/5"
                : ra.llm_summary.verdict_sentiment === "AVOID" || ra.llm_summary.verdict_sentiment === "NOT_RECOMMENDED"
                ? "border-rose-500/35 bg-rose-500/5"
                : "border-border bg-muted/30"
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
                  Purchase Verdict
                </span>
                <span className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${
                  ra.llm_summary.verdict_sentiment === "PROCEED" || ra.llm_summary.verdict_sentiment === "RECOMMENDED"
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                    : ra.llm_summary.verdict_sentiment === "PROCEED_WITH_CAUTION" || ra.llm_summary.verdict_sentiment === "RECOMMENDED_WITH_RESERVATIONS" || ra.llm_summary.verdict_sentiment === "MIXED_TRADE_OFFS"
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
                    : ra.llm_summary.verdict_sentiment === "AVOID" || ra.llm_summary.verdict_sentiment === "NOT_RECOMMENDED"
                    ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30"
                    : "bg-muted text-muted-foreground border-border"
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

              {/* 1 Short Plain-English Reason immediately below the prominent verdict label */}
              <div className="text-[11.5px] font-medium text-foreground leading-snug">
                {ra.llm_summary.verdict}
              </div>

              {/* Optional brief supporting detail */}
              {ra.llm_summary.verdict_detail ? (
                <div className="text-[10px] text-muted-foreground leading-tight">
                  {ra.llm_summary.verdict_detail}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Evidence Confidence Indicator */}
          <div className="rounded-lg bg-muted/40 border border-border/50 p-2 flex flex-col gap-1">
            <div className="flex items-center justify-between text-[9.5px]">
              <span className="font-bold uppercase tracking-wider text-muted-foreground">
                Evidence Confidence
              </span>
              <span className={`font-mono font-bold px-1.5 py-0.2 rounded text-[8.5px] border ${
                (ra.llm_summary.confidence_score ?? 50) >= 75
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25"
                  : (ra.llm_summary.confidence_score ?? 50) >= 50
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25"
                  : "bg-muted text-muted-foreground border-border"
              }`}>
                {ra.llm_summary.confidence_level || "MODERATE"} ({ra.llm_summary.confidence_score ?? 50}/100)
              </span>
            </div>

            {/* Confidence Bar */}
            <div className="w-full h-1.5 rounded-full overflow-hidden bg-muted">
              <div
                style={{ width: `${ra.llm_summary.confidence_score ?? 50}%` }}
                className={`h-full transition-all duration-300 ${
                  (ra.llm_summary.confidence_score ?? 50) >= 75
                    ? "bg-emerald-500"
                    : (ra.llm_summary.confidence_score ?? 50) >= 50
                    ? "bg-amber-500"
                    : "bg-muted-foreground"
                }`}
              />
            </div>

            <div className="text-[9px] text-muted-foreground leading-relaxed flex items-start gap-1 pt-0.5">
              <Info width={11} height={11} className="shrink-0 mt-0.5 text-muted-foreground" />
              <span>
                {ra.llm_summary.confidence_explanation || `Confidence reflects the statistical reliability of ${totalAnalyzed} analyzed reviews, not an absolute guarantee of product quality.`}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* 4. Review Authenticity & Credibility (Combined Model B + Heuristics) */}
      {ra ? (
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

          {/* Plain language overview */}
          <div className="text-[11px] text-muted-foreground leading-relaxed bg-muted/40 rounded-lg p-2.5 border border-border/40">
            Credibility evaluates review authenticity independent of customer sentiment. High ratings can still display synthetic or repetitive patterns.
          </div>

          {/* Combined Credibility Stats */}
          <div className="grid grid-cols-2 gap-2">
            {/* Model B: CG vs OR */}
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

            {/* Heuristic Suspicion */}
            <div className="rounded-lg bg-violet-500/10 border border-violet-500/20 p-2 text-center">
              <div className="text-[9px] font-bold uppercase text-violet-600 dark:text-violet-400">
                Pattern Analysis
              </div>
              <div className="text-[13px] font-extrabold text-foreground mt-0.5">
                {ra.suspicious_analysis.suspicious_count} <span className="text-[10px] font-semibold text-muted-foreground">Flagged</span>
              </div>
              <div className="text-[8.5px] text-muted-foreground mt-0.5">
                {ra.suspicious_analysis.suspicion_rate}% of {ra.suspicious_analysis.total_analyzed} reviews
              </div>
            </div>
          </div>

          {/* Expandable Technical Signals and Flagged Reviews */}
          <Accordion
            label="Technical Signals & Flagged Reviews"
            badge={ra.suspicious_analysis.suspicious_count > 0 ? `${ra.suspicious_analysis.suspicious_count} SIGNALS` : "CLEAN"}
          >
            <div className="flex flex-col gap-2 pt-1">
              <div className="text-[10px] text-muted-foreground leading-relaxed">
                Statistical anomalies flagged by rule heuristics (repetition, extreme sentiment-rating divergence, boilerplate):
              </div>
              <div className="grid grid-cols-2 gap-1 text-[10.5px]">
                <div className="rounded border border-border bg-background p-1.5 flex justify-between items-center">
                  <span className="text-muted-foreground truncate">Exact duplicates:</span>
                  <span className="font-bold text-foreground ml-1">
                    {ra.suspicious_analysis.flags_breakdown.exact_duplicate || 0}
                  </span>
                </div>
                <div className="rounded border border-border bg-background p-1.5 flex justify-between items-center">
                  <span className="text-muted-foreground truncate">Rating mismatch:</span>
                  <span className="font-bold text-foreground ml-1">
                    {ra.suspicious_analysis.flags_breakdown.rating_sentiment_mismatch || 0}
                  </span>
                </div>
                <div className="rounded border border-border bg-background p-1.5 flex justify-between items-center">
                  <span className="text-muted-foreground truncate">Promotional text:</span>
                  <span className="font-bold text-foreground ml-1">
                    {ra.suspicious_analysis.flags_breakdown.promotional_keywords || 0}
                  </span>
                </div>
                <div className="rounded border border-border bg-background p-1.5 flex justify-between items-center">
                  <span className="text-muted-foreground truncate">Generic boilerplate:</span>
                  <span className="font-bold text-foreground ml-1">
                    {ra.suspicious_analysis.flags_breakdown.short_generic_boilerplate || 0}
                  </span>
                </div>
              </div>

              {ra.suspicious_analysis.flagged_reviews.length > 0 ? (
                <div className="mt-1 flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                  <span className="text-[10px] font-bold text-foreground">Flagged Reviews:</span>
                  {ra.suspicious_analysis.flagged_reviews.map((f, idx) => (
                    <div key={idx} className="rounded border border-border bg-muted/40 p-2 text-[10.5px] flex flex-col gap-1">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="font-semibold text-foreground">{f.author || "Reviewer"}</span>
                        {f.rating ? <span>★ {f.rating}/5</span> : null}
                      </div>
                      <div className="text-foreground/90 italic leading-snug line-clamp-2">
                        &quot;{f.review_text}&quot;
                      </div>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {f.reasons.map((r, rIdx) => (
                          <span key={rIdx} className="rounded bg-rose-500/10 border border-rose-500/25 text-rose-700 dark:text-rose-400 px-1 py-0.2 text-[8.5px] font-semibold">
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="rounded bg-muted/40 p-1.5 text-[9.5px] text-muted-foreground leading-relaxed flex items-start gap-1.5 border border-border/40 mt-0.5">
                <Info width={11} height={11} className="shrink-0 mt-0.5 text-muted-foreground" />
                <span>Credibility signals highlight risk indicators and pattern divergence, not absolute proof of fraud.</span>
              </div>
            </div>
          </Accordion>
        </div>
      ) : null}

      {/* 5. Product Aspect Analysis */}
      {primaryAspects.length > 0 ? (
        <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">
              Key Product Aspects
            </span>
            <span className="text-[9.5px] text-muted-foreground font-mono">
              Sorted by Mentions
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {primaryAspects.map((asp) => (
              <div key={asp.aspect_id} className="rounded-lg border border-border/70 bg-muted/30 p-2.5 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="font-semibold text-foreground">{asp.display_name}</span>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{asp.positive_percentage}% pos</span>
                    <span>•</span>
                    <span>{asp.mention_count} mention{asp.mention_count > 1 ? "s" : ""}</span>
                  </div>
                </div>

                {/* Aspect Sentiment Bar */}
                <div className="w-full h-1.5 rounded-full overflow-hidden flex bg-muted">
                  <div style={{ width: `${asp.positive_percentage}%` }} className="bg-emerald-500" />
                  <div style={{ width: `${asp.negative_percentage}%` }} className="bg-rose-500" />
                </div>

                {/* Sample Excerpt */}
                {asp.positive_excerpts.length > 0 ? (
                  <div className="text-[10px] text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 rounded px-1.5 py-0.5 leading-snug line-clamp-1 italic">
                    &quot;{asp.positive_excerpts[0]}&quot;
                  </div>
                ) : asp.negative_excerpts.length > 0 ? (
                  <div className="text-[10px] text-rose-700 dark:text-rose-400 bg-rose-500/10 rounded px-1.5 py-0.5 leading-snug line-clamp-1 italic">
                    &quot;{asp.negative_excerpts[0]}&quot;
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {/* Expandable Remaining Aspects and Delivery */}
          {(remainingAspects.length > 0 || (deliverySummary && deliverySummary.mentions > 0)) ? (
            <Accordion label={`More Aspects & Delivery (${remainingAspects.length + (deliverySummary && deliverySummary.mentions > 0 ? 1 : 0)})`}>
              <div className="flex flex-col gap-2 pt-1">
                {remainingAspects.map((asp) => (
                  <div key={asp.aspect_id} className="rounded border border-border bg-background p-2 flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-foreground">{asp.display_name}</span>
                      <span className="text-[9.5px] text-muted-foreground">{asp.mention_count} mentions ({asp.positive_percentage}% pos)</span>
                    </div>
                    {asp.positive_excerpts.length > 0 ? (
                      <div className="text-[9.5px] italic text-muted-foreground line-clamp-1">
                        &quot;{asp.positive_excerpts[0]}&quot;
                      </div>
                    ) : null}
                  </div>
                ))}

                {deliverySummary && deliverySummary.mentions > 0 ? (
                  <div className="rounded border border-border bg-muted/40 p-2 flex flex-col gap-1 mt-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-foreground">Delivery & Packaging Experience</span>
                      <span className="text-[9.5px] text-muted-foreground">{deliverySummary.mentions} mentions</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Positive delivery sentiment: <strong className="text-foreground">{deliverySummary.positive_percentage}%</strong>
                    </div>
                    {deliverySummary.sample_quote ? (
                      <div className="text-[9.5px] italic text-muted-foreground bg-background rounded p-1 border border-border/50 line-clamp-2">
                        &quot;{deliverySummary.sample_quote}&quot;
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Accordion>
          ) : null}
        </div>
      ) : null}

      {/* 6. Individual Customer Reviews (Collapsible & Paginated) */}
      {ra && ra.analyzed_reviews.length > 0 ? (
        <Accordion label={`All Customer Reviews (${ra.analyzed_reviews.length})`} badge="RAW">
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
              {ra.analyzed_reviews.slice(0, visibleReviewsCount).map((r, i) => (
                <div key={r.id || i} className="rounded-lg border border-border bg-muted/30 p-2 text-[10.5px] flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground truncate pr-1">
                      {r.author || "Amazon Customer"}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {r.rating ? <span className="text-amber-500 font-bold">★{r.rating}</span> : null}
                      <span className={`rounded px-1 py-0.2 text-[8px] font-bold uppercase ${
                        r.sentiment === "positive"
                          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : r.sentiment === "negative"
                          ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {r.sentiment}
                      </span>
                      {r.cg_label ? (
                        <span className={`rounded px-1 py-0.2 text-[8px] font-mono font-bold uppercase ${
                          r.cg_label === "CG"
                            ? "bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30"
                            : "bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30"
                        }`}>
                          {r.cg_label}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-foreground/90 leading-snug line-clamp-3">
                    {r.text}
                  </div>
                  {r.date ? (
                    <div className="text-[9px] text-muted-foreground">{r.date}</div>
                  ) : null}
                </div>
              ))}
            </div>

            {/* Pagination Controls */}
            {visibleReviewsCount < ra.analyzed_reviews.length ? (
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setVisibleReviewsCount((prev) => Math.min(prev + 15, ra.analyzed_reviews.length))}
                  className="flex-1 rounded-lg border border-border bg-card py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted transition"
                >
                  Load 15 more ({visibleReviewsCount} of {ra.analyzed_reviews.length})
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleReviewsCount(ra.analyzed_reviews.length)}
                  className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition"
                >
                  Show all
                </button>
              </div>
            ) : null}
          </div>
        </Accordion>
      ) : null}

      {/* 7. Footer Status */}
      <div className="rounded-lg border border-border/60 bg-muted/20 px-2.5 py-1.5 text-[9.5px] text-muted-foreground font-mono flex items-center justify-between">
        <span>SOURCE: {analysisSource.toUpperCase()}</span>
        <span>MODELS: TF-IDF + LR & KAGGLE CG/OR</span>
      </div>

      <div className="pt-0.5">
        <Btn onClick={() => go("ready")} variant="outline" className="w-full py-2 text-[12px]">
          <ArrowLeft width={13} height={13} />
          Back to Product
        </Btn>
      </div>
    </div>
  );
}

/* ---------- 4. MANUAL SCREEN ---------- */

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

        {onLoadSampleReviews ? (
          <Btn onClick={onLoadSampleReviews} variant="secondary" className="w-full py-2 text-[12px]">
            Try Demo Mode (Sample Dataset)
          </Btn>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- 5. SETTINGS SCREEN ---------- */

function SettingsScreen({
  go,
  prevView,
  onLoadSampleReviews,
}: {
  go: (v: View) => void;
  prevView: View;
  onLoadSampleReviews?: () => void;
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
            Offline Demo Testing
          </div>
          <div className="rounded-xl border border-border bg-card p-3 flex flex-col gap-2">
            <p className="text-[11.5px] text-muted-foreground leading-relaxed">
              Run review intelligence against pre-packaged demo dataset without requiring an active shopping tab.
            </p>
            {onLoadSampleReviews ? (
              <Btn onClick={onLoadSampleReviews} variant="outline" className="w-full py-2 text-[12px]">
                <Shield width={13} height={13} />
                Load Demo Dataset (11 Reviews)
              </Btn>
            ) : null}
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

/* ---------- 6. SCREEN ROUTER ---------- */

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
  onAnalyzeReviews = () => {},
  onLoadSampleReviews,
  analysisSource = "live_dom",
  isDemoMode = false,
  comparison = null,
  comparisonLoading = false,
  comparisonError = null,
  onComparePrices = () => {},
  targetReviewCount = 100,
  onSetTargetReviewCount = () => {},
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
          onLoadSampleReviews={onLoadSampleReviews}
          isDemoMode={isDemoMode}
          comparison={comparison}
          comparisonLoading={comparisonLoading}
          comparisonError={comparisonError}
          onComparePrices={onComparePrices}
          targetReviewCount={targetReviewCount}
          onSetTargetReviewCount={onSetTargetReviewCount}
        />
      );
    case "analyzing":
      return <Analyzing go={go} targetReviewCount={targetReviewCount} />;
    case "result":
      return (
        <Result
          product={product}
          reviewAnalysis={reviewAnalysis}
          reviewLoading={reviewLoading}
          reviewError={reviewError}
          go={go}
          onRetryAnalysis={onAnalyze}
          analysisSource={analysisSource}
          isDemoMode={isDemoMode}
          targetReviewCount={targetReviewCount}
        />
      );
    case "settings":
      return <SettingsScreen go={go} prevView={prevView} onLoadSampleReviews={onLoadSampleReviews} />;
    case "manual":
      return (
        <Manual
          go={go}
          onAnalyzeCustomReviews={onAnalyzeReviews}
          onLoadSampleReviews={onLoadSampleReviews}
        />
      );
    default:
      return (
        <Ready
          product={product}
          status={status}
          go={go}
          onAnalyze={onAnalyze}
          onRetry={onRetry}
          onLoadSampleReviews={onLoadSampleReviews}
          isDemoMode={isDemoMode}
          comparison={comparison}
          comparisonLoading={comparisonLoading}
          comparisonError={comparisonError}
          onComparePrices={onComparePrices}
          targetReviewCount={targetReviewCount}
          onSetTargetReviewCount={onSetTargetReviewCount}
        />
      );
  }
}
