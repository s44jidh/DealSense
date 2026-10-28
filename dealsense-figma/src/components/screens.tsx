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

      {/* Review Detection Status Badge (Requirement 4 & 5) */}
      <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star width={14} height={14} className="text-amber-500 fill-amber-500 shrink-0" />
          <span className="text-[12px] font-medium text-foreground">
            {detectedReviewsCount > 0
              ? `${detectedReviewsCount} reviews collected across ${pagesScanned} page${pagesScanned > 1 ? "s" : ""}`
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
            Analyze Customer Reviews ({detectedReviewsCount})
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
}: {
  go: (v: View) => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const steps = [
    "Preprocessing and tokenizing extracted review text...",
    "Running Model A (TF-IDF + Logistic Regression Sentiment)...",
    "Running Model B (Kaggle Dataset CG vs OR Classification)...",
    "Extracting functional product & logistics aspects...",
    "Synthesizing Generative AI summary & recurring themes...",
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
}) {
  const [imgSrc, setImgSrc] = useState<string | null>(product?.image || null);

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

  // Trust score color
  const trustScore = ra?.trust_score ?? 100;
  let trustBadgeColor = "text-safe bg-safe-soft border-safe-border";
  let trustLabel = "HIGH TRUST";
  if (trustScore < 60) {
    trustBadgeColor = "text-destructive bg-destructive/10 border-destructive/30";
    trustLabel = "HIGH SUSPICION";
  } else if (trustScore < 80) {
    trustBadgeColor = "text-caution bg-caution-soft border-caution-border";
    trustLabel = "MODERATE SIGNALS";
  }

  const pagesScanned = product?.scan_metadata?.pages_scanned || 1;

  return (
    <div className="sg-fade flex flex-col px-5 py-4 gap-4">
      {/* Back button and source badge */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => go("ready")}
          className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition"
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

      {/* Product Summary Header */}
      <div className="flex items-center gap-3">
        <div className="h-[48px] w-[48px] shrink-0 overflow-hidden rounded-lg border border-border bg-muted flex items-center justify-center">
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={productName}
              onError={() => setImgSrc(null)}
              className="h-full w-full object-cover"
            />
          ) : (
            <Tag width={18} height={18} className="text-muted-foreground/50" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-snug line-clamp-2 text-foreground" title={productName}>
            {productName}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            {asinText ? (
              <span className="font-mono text-[10px] font-bold text-foreground">
                ASIN: {asinText}
              </span>
            ) : null}
            {ra?.average_rating ? (
              <>
                <span>•</span>
                <span className="font-semibold text-amber-500">
                  ★ {ra.average_rating} / 5
                </span>
              </>
            ) : null}
            {ra ? (
              <>
                <span>•</span>
                <span>{ra.total_reviews_analyzed} reviews analyzed</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Listing Details: Seller, Brand, Model */}
      <div className="grid grid-cols-3 gap-1.5 text-[10.5px]">
        <div className="rounded-lg border border-border bg-muted/40 p-1.5 text-center">
          <div className="text-[9px] uppercase font-bold text-muted-foreground">Seller</div>
          <div className="font-semibold text-foreground truncate" title={product?.seller || "Unavailable"}>
            {product?.seller || "Unavailable"}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted/40 p-1.5 text-center">
          <div className="text-[9px] uppercase font-bold text-muted-foreground">Brand</div>
          <div className="font-semibold text-foreground truncate" title={product?.brand || "Unavailable"}>
            {product?.brand || "Unavailable"}
          </div>
        </div>
        <div className="rounded-lg border border-border bg-muted/40 p-1.5 text-center">
          <div className="text-[9px] uppercase font-bold text-muted-foreground">Model</div>
          <div className="font-semibold text-foreground truncate" title={product?.model || "Unavailable"}>
            {product?.model || "Unavailable"}
          </div>
        </div>
      </div>

      {/* Review Scope Banner */}
      <div className="rounded-lg bg-muted/50 border border-border/60 px-3 py-1.5 text-[10.5px] text-muted-foreground flex items-center justify-between">
        <span>Sample Scope: {ra ? `${ra.total_reviews_analyzed} reviews analyzed` : "0 analyzed"}</span>
        <span className="text-[9.5px] font-medium">{pagesScanned} page(s) scanned</span>
      </div>

      {/* Review Extraction Error / Empty State */}
      {reviewError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 flex flex-col gap-2.5">
          <div className="flex items-start gap-2.5">
            <Warn width={16} height={16} className="mt-0.5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-bold text-destructive">
                Could Not Retrieve Reviews
              </div>
              <div className="text-[11.5px] text-foreground/85 mt-1 leading-relaxed">
                {reviewError}
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-1">
            <Btn onClick={onRetryAnalysis} variant="outline" className="py-1.5 px-3 text-[12px]">
              <Refresh width={13} height={13} />
              Retry Extraction
            </Btn>
            <Btn onClick={() => go("ready")} variant="secondary" className="py-1.5 px-3 text-[12px]">
              Back to Product
            </Btn>
          </div>
        </div>
      ) : null}

      {/* 1. MODEL A: Overall Sentiment Verdict & Breakdown */}
      {ra ? (
        <div className="rounded-xl border border-border bg-card p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Tag width={13} height={13} className="text-primary" />
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">
                1. ML Sentiment Analysis
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="rounded bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 text-[8.5px] font-mono font-bold uppercase tracking-wider">
                Model A (TF-IDF + LR)
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
          <div className="w-full h-2.5 rounded-full overflow-hidden flex bg-muted">
            <div
              style={{ width: `${posPct}%` }}
              className="bg-emerald-500 transition-all duration-300"
              title={`Positive: ${posPct}%`}
            />
            <div
              style={{ width: `${neuPct}%` }}
              className="bg-slate-400 dark:bg-slate-600 transition-all duration-300"
              title={`Neutral: ${neuPct}%`}
            />
            <div
              style={{ width: `${negPct}%` }}
              className="bg-rose-500 transition-all duration-300"
              title={`Negative: ${negPct}%`}
            />
          </div>

          {/* 3 Metrics Cards */}
          <div className="grid grid-cols-3 gap-2 pt-0.5">
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2 text-center">
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Positive
              </div>
              <div className="text-[14px] font-extrabold text-foreground mt-0.5">
                {posPct}%
              </div>
              <div className="text-[9.5px] text-muted-foreground">
                {ra.sentiment_distribution.positive} reviews
              </div>
            </div>

            <div className="rounded-lg bg-muted border border-border p-2 text-center">
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
                Neutral
              </div>
              <div className="text-[14px] font-extrabold text-foreground mt-0.5">
                {neuPct}%
              </div>
              <div className="text-[9.5px] text-muted-foreground">
                {ra.sentiment_distribution.neutral} reviews
              </div>
            </div>

            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-2 text-center">
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                Negative
              </div>
              <div className="text-[14px] font-extrabold text-foreground mt-0.5">
                {negPct}%
              </div>
              <div className="text-[9.5px] text-muted-foreground">
                {ra.sentiment_distribution.negative} reviews
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* 2. MODEL B: Dataset-Based Review Classification (CG vs OR) */}
      {ra && ra.fake_review_analysis ? (
        <div className="rounded-xl border border-border bg-card p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Shield width={13} height={13} className="text-violet-500" />
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">
                2. Dataset Review Classification
              </div>
            </div>
            <span className="rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20 px-1.5 py-0.5 text-[8.5px] font-mono font-bold uppercase tracking-wider">
              Model B (Kaggle CG/OR)
            </span>
          </div>

          {/* 2-color Segmented Progress Bar: Original (OR) vs Computer-Generated (CG) */}
          <div className="w-full h-2.5 rounded-full overflow-hidden flex bg-muted">
            <div
              style={{ width: `${ra.fake_review_analysis.or_percentage}%` }}
              className="bg-sky-500 transition-all duration-300"
              title={`Original (OR): ${ra.fake_review_analysis.or_percentage}%`}
            />
            <div
              style={{ width: `${ra.fake_review_analysis.cg_percentage}%` }}
              className="bg-violet-500 transition-all duration-300"
              title={`Computer-Generated (CG): ${ra.fake_review_analysis.cg_percentage}%`}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-0.5">
            <div className="rounded-lg bg-sky-500/10 border border-sky-500/20 p-2 text-center">
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                Original (OR)
              </div>
              <div className="text-[15px] font-extrabold text-foreground mt-0.5">
                {ra.fake_review_analysis.or_percentage}%
              </div>
              <div className="text-[9.5px] text-muted-foreground">
                {ra.fake_review_analysis.or_count} reviews
              </div>
            </div>

            <div className="rounded-lg bg-violet-500/10 border border-violet-500/20 p-2 text-center">
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                Computer-Generated (CG)
              </div>
              <div className="text-[15px] font-extrabold text-foreground mt-0.5">
                {ra.fake_review_analysis.cg_percentage}%
              </div>
              <div className="text-[9.5px] text-muted-foreground">
                {ra.fake_review_analysis.cg_count} reviews
              </div>
            </div>
          </div>

          <div className="rounded bg-muted/60 p-2 text-[10px] text-muted-foreground leading-relaxed flex items-start gap-1.5 border border-border/40">
            <Info width={12} height={12} className="shrink-0 mt-0.5 text-muted-foreground" />
            <span>{ra.fake_review_analysis.disclaimer}</span>
          </div>
        </div>
      ) : null}

      {/* 3. GENERATIVE AI REVIEW SYNTHESIS (Gemini / OpenAI) */}
      {ra && ra.llm_summary ? (
        <div className="rounded-xl border border-border bg-card p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkle width={14} height={14} className="text-amber-500" />
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">
                3. Executive Review Synthesis
              </div>
              <span className="text-[9.5px] text-muted-foreground font-normal">
                ({ra.total_reviews_analyzed} review{ra.total_reviews_analyzed === 1 ? "" : "s"} analyzed)
              </span>
            </div>
            <span className={`rounded px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-wider border ${
              ra.llm_summary.available
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                : "bg-muted text-muted-foreground border-border"
            }`}>
              {ra.llm_summary.available
                ? (ra.llm_summary.provider?.toLowerCase() === "local" ? "LOCAL NLP" : `${ra.llm_summary.provider?.toUpperCase()} AI`)
                : "NO REVIEWS"}
            </span>
          </div>

          {ra.llm_summary.available ? (
            <div className="flex flex-col gap-2.5">
              {/* Overall Summary */}
              <div className="text-[11.5px] text-foreground/90 leading-relaxed bg-muted/40 rounded-lg p-2.5 border border-border/40">
                {ra.llm_summary.summary}
              </div>

              {/* Positive Themes & Recurring Complaints */}
              <div className="grid grid-cols-2 gap-2">
                {/* Positive Themes */}
                <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2 flex flex-col gap-1">
                  <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400">
                    <Check width={11} height={11} />
                    Positive Themes
                  </div>
                  {ra.llm_summary.common_positive_themes && ra.llm_summary.common_positive_themes.length > 0 ? (
                    <ul className="text-[10px] text-foreground space-y-1 list-disc list-inside">
                      {ra.llm_summary.common_positive_themes.map((theme, i) => (
                        <li key={i} className="leading-snug">{theme}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-[9.5px] text-muted-foreground">No clear themes extracted.</span>
                  )}
                </div>

                {/* Recurring Complaints */}
                <div className="rounded-lg bg-rose-500/5 border border-rose-500/20 p-2 flex flex-col gap-1">
                  <div className="flex items-center gap-1 text-[10px] font-bold uppercase text-rose-600 dark:text-rose-400">
                    <Warn width={11} height={11} />
                    Recurring Complaints
                  </div>
                  {ra.llm_summary.recurring_complaints && ra.llm_summary.recurring_complaints.length > 0 ? (
                    <ul className="text-[10px] text-foreground space-y-1 list-disc list-inside">
                      {ra.llm_summary.recurring_complaints.map((comp, i) => (
                        <li key={i} className="leading-snug">{comp}</li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-[9.5px] text-muted-foreground">No recurring issues detected.</span>
                  )}
                </div>
              </div>

              {/* LLM Pros & Cons based on Review Evidence */}
              {((ra.llm_summary.pros && ra.llm_summary.pros.length > 0) || (ra.llm_summary.cons && ra.llm_summary.cons.length > 0)) ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-muted/40 border border-border p-2">
                    <div className="text-[9.5px] font-bold uppercase text-foreground mb-1">
                      Pros (Review Evidence)
                    </div>
                    <ul className="text-[10px] text-foreground space-y-0.5 list-disc list-inside">
                      {ra.llm_summary.pros.map((p, i) => (
                        <li key={i} className="leading-snug">{p}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-lg bg-muted/40 border border-border p-2">
                    <div className="text-[9.5px] font-bold uppercase text-foreground mb-1">
                      Cons (Review Evidence)
                    </div>
                    <ul className="text-[10px] text-foreground space-y-0.5 list-disc list-inside">
                      {ra.llm_summary.cons.map((c, i) => (
                        <li key={i} className="leading-snug">{c}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}

              {/* Patterns Warranting Investigation */}
              {ra.llm_summary.investigation_patterns && ra.llm_summary.investigation_patterns.length > 0 ? (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2 flex flex-col gap-1">
                  <div className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-400">
                    Patterns Warranting Investigation
                  </div>
                  <ul className="text-[10.5px] text-foreground space-y-1 list-disc list-inside">
                    {ra.llm_summary.investigation_patterns.map((pat, i) => (
                      <li key={i} className="leading-snug">{pat}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-lg bg-muted/60 border border-border/60 p-2.5 text-[11px] text-muted-foreground leading-relaxed flex items-start gap-2">
              <Info width={13} height={13} className="shrink-0 mt-0.5 text-muted-foreground" />
              <span>
                {ra.llm_summary.summary || "No customer reviews were extracted or available to summarize. Core ML predictions (Model A & Model B) and heuristic indicators remain operational."}
              </span>
            </div>
          )}
        </div>
      ) : null}

      {/* 4. HEURISTIC & RULE-BASED SUSPICIOUS SIGNALS */}
      {ra ? (
        <div className="rounded-xl border border-border bg-card p-3.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Shield width={13} height={13} className="text-primary" />
              <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-foreground">
                4. Heuristic & Rule-Based Signals
              </div>
            </div>
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border ${trustBadgeColor}`}>
              {trustLabel}
            </span>
          </div>

          <div className="flex items-baseline justify-between rounded-lg bg-muted/60 p-2.5 border border-border/60">
            <div>
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">Trust Score</div>
              <div className="text-[20px] font-extrabold text-foreground leading-tight">
                {trustScore}<span className="text-[12px] font-normal text-muted-foreground"> / 100</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">Suspicious Signal Rate</div>
              <div className="text-[13px] font-bold text-foreground">
                {ra.suspicious_analysis.suspicion_rate}%
                <span className="text-[10.5px] font-normal text-muted-foreground ml-1">
                  ({ra.suspicious_analysis.suspicious_count} of {ra.suspicious_analysis.total_analyzed})
                </span>
              </div>
            </div>
          </div>

          {/* Anomaly breakdown grid */}
          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
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

          {/* Flagged reviews detail */}
          {ra.suspicious_analysis.flagged_reviews.length > 0 ? (
            <Accordion
              label={`View Flagged Reviews (${ra.suspicious_analysis.flagged_reviews.length})`}
              badge="HEURISTIC"
            >
              <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
                {ra.suspicious_analysis.flagged_reviews.map((f, idx) => (
                  <div key={idx} className="rounded-lg border border-border bg-muted/40 p-2 text-[11px] flex flex-col gap-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="font-semibold text-foreground">{f.author || "Reviewer"}</span>
                      {f.rating ? <span>★ {f.rating} / 5</span> : null}
                    </div>
                    <div className="text-foreground/90 italic leading-snug line-clamp-2">
                      &quot;{f.review_text}&quot;
                    </div>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {f.reasons.map((r, rIdx) => (
                        <span
                          key={rIdx}
                          className="rounded bg-rose-500/10 border border-rose-500/25 text-rose-700 dark:text-rose-400 px-1 py-0.5 text-[9px] font-semibold"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Accordion>
          ) : null}

          {/* Disclaimer badge */}
          <div className="rounded bg-muted/60 p-2 text-[10px] text-muted-foreground leading-relaxed flex items-start gap-1.5 border border-border/40">
            <Info width={12} height={12} className="shrink-0 mt-0.5 text-muted-foreground" />
            <span>{ra.suspicious_analysis.disclaimer}</span>
          </div>
        </div>
      ) : null}

      {/* 5. Product Aspect Analysis */}
      {ra && ra.aspect_analysis.aspects.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
            Product Aspect Breakdown
          </div>

          <div className="flex flex-col gap-2">
            {ra.aspect_analysis.aspects
              .filter((a) => a.mention_count > 0 && a.category === "product")
              .map((asp) => (
                <div key={asp.aspect_id} className="rounded-xl border border-border bg-card p-3 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-semibold text-foreground">{asp.display_name}</span>
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {asp.mention_count} mention{asp.mention_count > 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Aspect Sentiment Bar */}
                  <div className="w-full h-1.5 rounded-full overflow-hidden flex bg-muted">
                    <div style={{ width: `${asp.positive_percentage}%` }} className="bg-emerald-500" />
                    <div style={{ width: `${asp.negative_percentage}%` }} className="bg-rose-500" />
                  </div>

                  {/* Supporting excerpts */}
                  {asp.positive_excerpts.length > 0 ? (
                    <div className="text-[10.5px] text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 rounded px-2 py-1 leading-snug line-clamp-2">
                      &quot;{asp.positive_excerpts[0]}&quot;
                    </div>
                  ) : null}
                  {asp.negative_excerpts.length > 0 ? (
                    <div className="text-[10.5px] text-rose-700 dark:text-rose-400 bg-rose-500/10 rounded px-2 py-1 leading-snug line-clamp-2">
                      &quot;{asp.negative_excerpts[0]}&quot;
                    </div>
                  ) : null}
                </div>
              ))}
          </div>

          {/* Delivery & Logistics Experience Card */}
          {ra.aspect_analysis.delivery_summary.mentions > 0 ? (
            <div className="rounded-xl border border-border bg-muted/30 p-3 mt-1 flex flex-col gap-1">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-semibold text-foreground">Delivery & Seller Packaging</span>
                <span className="text-[10px] text-muted-foreground">
                  {ra.aspect_analysis.delivery_summary.mentions} mentions
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Positive sentiment: {ra.aspect_analysis.delivery_summary.positive_percentage}%
              </div>
              {ra.aspect_analysis.delivery_summary.sample_quote ? (
                <div className="text-[10.5px] italic text-foreground/80 bg-background/80 rounded p-1.5 border border-border mt-0.5 line-clamp-2">
                  &quot;{ra.aspect_analysis.delivery_summary.sample_quote}&quot;
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 6. Analyzed Reviews Viewer */}
      {ra && ra.analyzed_reviews.length > 0 ? (
        <Accordion label={`All Analyzed Customer Reviews (${ra.analyzed_reviews.length})`}>
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
            {ra.analyzed_reviews.map((r, i) => (
              <div key={r.id || i} className="rounded-lg border border-border bg-muted/30 p-2 text-[11px] flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground truncate pr-2">
                    {r.author}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {r.rating ? <span className="text-amber-500 font-bold">★ {r.rating}</span> : null}
                    <span className={`rounded px-1.5 py-0.2 text-[8.5px] font-bold uppercase ${
                      r.sentiment === "positive"
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                        : r.sentiment === "negative"
                        ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {r.sentiment}
                    </span>
                    {r.cg_label ? (
                      <span className={`rounded px-1.5 py-0.2 text-[8.5px] font-mono font-bold uppercase ${
                        r.cg_label === "CG"
                          ? "bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/30"
                          : "bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30"
                      }`}>
                        {r.cg_label}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="text-foreground/90 leading-relaxed text-[10.5px]">
                  {r.text}
                </div>
                {r.date ? (
                  <div className="text-[9.5px] text-muted-foreground">{r.date}</div>
                ) : null}
              </div>
            ))}
          </div>
        </Accordion>
      ) : null}

      {/* Debug Metadata Bar */}
      <div className="rounded-lg border border-border/80 bg-muted/30 p-2 text-[10px] text-muted-foreground font-mono flex items-center justify-between">
        <span>Source: {analysisSource.toUpperCase()}</span>
        <span>ASIN: {asinText || "N/A"}</span>
        <span>Reviews: {ra ? ra.total_reviews_analyzed : 0}</span>
      </div>

      <div className="pt-1">
        <Btn onClick={() => go("ready")} variant="outline" className="w-full py-2.5 text-[12.5px]">
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
        />
      );
    case "analyzing":
      return <Analyzing go={go} />;
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
        />
      );
  }
}
