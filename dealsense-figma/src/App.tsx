declare const chrome: any;

import { useEffect, useRef, useState, useCallback } from "react";
import { ScreenRouter, type View } from "./components/screens";
import { Sun, Moon, Settings, Logo } from "./components/icons";
import {
  extractActiveTabProduct,
  collectTabReviews,
  type ExtractedProduct,
} from "./lib/extractor";
import type {
  BatchReviewAnalysisResponse,
  ExtractedReview,
  ComparePricesResponse,
} from "./lib/reviewTypes";
import {
  SAMPLE_REVIEWS_BATCH,
  DEMO_PRODUCT_NAME,
  DEMO_PRICE,
  DEMO_MRP,
} from "./lib/sampleReviews";

const API_BASE = "http://127.0.0.1:8000";

export default function App() {
  const [dark, setDark] = useState(() => {
    const saved =
      typeof localStorage !== "undefined" ? localStorage.getItem("sg-theme") : null;
    if (saved) return saved === "dark";
    return (
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-color-scheme: dark)").matches
    );
  });

  const [view, setView] = useState<View>("ready");
  const [prevView, setPrevView] = useState<View>("ready");
  const [extractedProduct, setExtractedProduct] =
    useState<ExtractedProduct | null>(null);
  const [extractionStatus, setExtractionStatus] = useState<
    "loading" | "success" | "unsupported" | "error"
  >("loading");

  // Review analysis state
  const [reviewAnalysis, setReviewAnalysis] =
    useState<BatchReviewAnalysisResponse | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Price comparison state
  const [comparison, setComparison] = useState<ComparePricesResponse | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  // Analysis source tracking: "live_dom" | "demo" | "manual" (Requirement 6 & 7)
  const [analysisSource, setAnalysisSource] = useState<
    "live_dom" | "demo" | "manual"
  >("live_dom");
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [targetReviewCount, setTargetReviewCount] = useState<number>(100);

  const currentRequestIdRef = useRef<number>(0);
  const activeProductKeyRef = useRef<string>("");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("sg-theme", dark ? "dark" : "light");
  }, [dark]);

  const go = (v: View) => {
    setPrevView(view);
    setView(v);
  };

  /**
   * Run review batch analysis against the FastAPI backend
   */
  const runReviewAnalysis = useCallback(
    async (
      product: ExtractedProduct,
      customReviews?: ExtractedReview[],
      source: "live_dom" | "demo" | "manual" = "live_dom",
      directToResult: boolean = true
    ) => {
      const reqId = ++currentRequestIdRef.current;
      const targetKey = `${product.url}::${product.product_name}`;
      activeProductKeyRef.current = targetKey;

      setReviewError(null);
      setReviewLoading(true);
      if (directToResult) {
        setView("analyzing");
      }

      const reviewsToSend = customReviews || product.reviews || [];

      // Debug logging (Requirement 7)
      console.log("[DealSense Debug Backend Request]", {
        title: product.product_name,
        asin: product.asin || product.retailer_product_id || "N/A",
        url: product.url,
        reviewCount: reviewsToSend.length,
        source,
      });

      const payload = {
        product_name: product.product_name,
        url: product.url,
        source_retailer: product.source_retailer || "Amazon.in",
        target_count: targetReviewCount,
        reviews: reviewsToSend.map((r, i) => ({
          id: r.id || `rev_${i + 1}`,
          text: r.text,
          rating: r.rating ?? null,
          title: r.title ?? null,
          author: r.author || "Customer",
          date: r.date ?? null,
          verified_purchase: r.verified_purchase ?? null,
        })),
      };

      try {
        const res = await fetch(`${API_BASE}/api/reviews/analyze-batch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (reqId !== currentRequestIdRef.current) return;

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(
            errData.detail || `Server returned HTTP ${res.status}`
          );
        }

        const data: BatchReviewAnalysisResponse = await res.json();

        // Debug logging (Requirement 7)
        console.log("[DealSense Debug Backend Response]", {
          title: data.product_name,
          asin: product.asin || product.retailer_product_id || "N/A",
          totalAnalyzed: data.total_reviews_analyzed,
          overallSentiment: data.overall_sentiment_label,
          trustScore: data.trust_score,
          suspiciousCount: data.suspicious_analysis.suspicious_count,
          source,
        });

        setReviewAnalysis(data);
        setReviewLoading(false);
        if (directToResult) {
          setView("result");
        }
      } catch (err: any) {
        if (reqId !== currentRequestIdRef.current) return;
        setReviewLoading(false);
        const msg =
          err.message && err.message.includes("Failed to fetch")
            ? "Cannot connect to DealSense FastAPI backend at http://127.0.0.1:8000. Please ensure the local backend server is running."
            : err.message || "Review analysis failed.";
        setReviewError(msg);
        if (directToResult) {
          setView("result");
        }
      }
    },
    []
  );

  /**
   * Run cross-store price comparison against the FastAPI backend
   */
  const handleComparePrices = useCallback(async (product: ExtractedProduct, customQuery?: string) => {
    if (!product || !product.product_name) return;
    setComparisonLoading(true);
    setComparisonError(null);
    try {
      const payload = {
        product_name: product.product_name,
        product_title: product.product_title || product.product_name,
        url: product.url,
        product_url: product.product_url || product.url,
        current_site_price: product.current_site_price,
        current_price: product.current_price || product.current_site_price,
        mrp: product.mrp,
        seller: product.seller,
        variant: product.variant || null,
        source_retailer: product.source_retailer,
        retailer_product_id: product.retailer_product_id || product.asin || null,
        brand: product.brand || null,
        model: product.model || null,
        category: product.category || null,
        specifications: product.specifications || null,
        custom_query: customQuery || null,
      };
      const res = await fetch(`${API_BASE}/api/compare-prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned HTTP ${res.status}`);
      }
      const data: ComparePricesResponse = await res.json();
      setComparison(data);
      setComparisonLoading(false);
    } catch (err: any) {
      setComparisonLoading(false);
      setComparisonError(err.message || "Comparison request failed.");
    }
  }, []);

  /**
   * Scan the active browser tab on load (Requirement 1, 2, 7)
   */
  const scanActiveTab = useCallback(async () => {
    setExtractionStatus("loading");
    setReviewError(null);
    setReviewAnalysis(null);
    setComparison(null);
    setComparisonError(null);
    setIsDemoMode(false);
    setAnalysisSource("live_dom");

    try {
      const prod = await extractActiveTabProduct();
      if (!prod) {
        setExtractedProduct(null);
        setExtractionStatus("unsupported");
        console.warn("[DealSense Debug] Active tab is not a supported Amazon or Flipkart product page");
        return;
      }

      setExtractedProduct(prod);
      setExtractionStatus("success");

      // Auto-trigger price comparison
      handleComparePrices(prod);

      // Debug logging (Requirement 7)
      console.log("[DealSense Debug Scan Success]", {
        title: prod.product_name,
        asin: prod.asin || prod.retailer_product_id || "N/A",
        url: prod.url,
        price: prod.current_site_price,
        reviewCount: prod.reviews ? prod.reviews.length : 0,
        source: "live_dom",
      });
    } catch (e) {
      console.warn("[DealSense Debug] Extraction error:", e);
      setExtractionStatus("error");
    }
  }, [handleComparePrices]);

  useEffect(() => {
    scanActiveTab();

    if (typeof chrome !== "undefined" && chrome.tabs) {
      const handleActivated = () => {
        scanActiveTab();
      };
      const handleUpdated = (_tabId: number, changeInfo: any) => {
        if (changeInfo.status === "complete") {
          scanActiveTab();
        }
      };
      if (chrome.tabs.onActivated) {
        chrome.tabs.onActivated.addListener(handleActivated);
      }
      if (chrome.tabs.onUpdated) {
        chrome.tabs.onUpdated.addListener(handleUpdated);
      }
    }

    if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      chrome.runtime.onMessage
    ) {
      const listener = (msg: any) => {
        if (msg && msg.action === "productUpdated" && msg.data) {
          setExtractedProduct(msg.data);
          setExtractionStatus("success");
          setReviewAnalysis(null);
          setIsDemoMode(false);
          setAnalysisSource("live_dom");
          console.log("[DealSense Debug Dynamic Update]", {
            title: msg.data.product_name,
            asin: msg.data.asin || "N/A",
            reviewCount: msg.data.reviews?.length ?? 0,
            source: "live_dom",
          });
        } else if (msg && msg.action === "productUnavailable") {
          setExtractedProduct(null);
          setExtractionStatus("unsupported");
          setReviewAnalysis(null);
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => {
        chrome.runtime.onMessage.removeListener(listener);
      };
    }
  }, [scanActiveTab]);

  /**
   * Primary action on Ready screen: analyze reviews (Requirement 3, 4, 5, 6)
   * Strictly uses only reviews belonging to the detected product.
   * Multi-page collection expands review depth to targetCount (100 or 300).
   * If reviews cannot be retrieved, displays honest error state.
   */
  const handleAnalyze = useCallback(async () => {
    if (!extractedProduct) return;
    const currentReviews = extractedProduct.reviews || [];

    console.log("[DealSense Debug Analyze Triggered]", {
      title: extractedProduct.product_name,
      asin: extractedProduct.asin || extractedProduct.retailer_product_id || "N/A",
      url: extractedProduct.url,
      currentReviewCount: currentReviews.length,
      targetReviewCount,
      source: isDemoMode ? "demo" : "live_dom",
    });

    if (isDemoMode || analysisSource === "manual") {
      if (currentReviews.length === 0) {
        setReviewError(
          "Could not retrieve customer reviews. Please click 'Try Demo Mode' or paste review text manually."
        );
        setReviewAnalysis(null);
        setView("result");
        return;
      }
      runReviewAnalysis(extractedProduct, currentReviews, isDemoMode ? "demo" : "manual", true);
      return;
    }

    // If active product already has enough reviews for the chosen target, analyze directly
    if (currentReviews.length >= targetReviewCount) {
      runReviewAnalysis(extractedProduct, currentReviews, "live_dom", true);
      return;
    }

    // Trigger multi-page review collection in active tab
    setView("analyzing");
    setReviewLoading(true);
    setReviewError(null);

    try {
      const collectRes = await collectTabReviews({
        targetCount: targetReviewCount,
        maxCount: targetReviewCount === 300 ? 300 : 100,
        diversify: true,
      });

      let reviewsToAnalyze = currentReviews;
      let pagesScanned = extractedProduct.scan_metadata?.pages_scanned || 1;
      let hasMore = extractedProduct.scan_metadata?.has_more ?? false;
      let limitationNote = extractedProduct.scan_metadata?.limitation_note ?? null;
      let ratingDist = extractedProduct.scan_metadata?.rating_distribution;

      if (collectRes && collectRes.reviews && collectRes.reviews.length > 0) {
        reviewsToAnalyze = collectRes.reviews;
        pagesScanned = collectRes.pages_scanned;
        hasMore = collectRes.has_more;
        limitationNote = collectRes.limitation_note || null;
        ratingDist = collectRes.rating_distribution;

        const updatedProd: ExtractedProduct = {
          ...extractedProduct,
          reviews: collectRes.reviews,
          scan_metadata: {
            pages_scanned: pagesScanned,
            total_reviews_found: collectRes.total_collected,
            has_more: hasMore,
            limitation_note: limitationNote,
            target_count: targetReviewCount,
            rating_distribution: ratingDist,
          },
        };
        setExtractedProduct(updatedProd);
      }

      if (reviewsToAnalyze.length === 0) {
        setReviewLoading(false);
        setReviewError(
          "Could not retrieve customer reviews from this page. Please ensure customer reviews are visible (scroll down on Amazon if needed), then click Retry."
        );
        setReviewAnalysis(null);
        setView("result");
        return;
      }

      runReviewAnalysis(
        {
          ...extractedProduct,
          reviews: reviewsToAnalyze,
          scan_metadata: {
            pages_scanned: pagesScanned,
            total_reviews_found: reviewsToAnalyze.length,
            has_more: hasMore,
            limitation_note: limitationNote,
            target_count: targetReviewCount,
            rating_distribution: ratingDist,
          },
        },
        reviewsToAnalyze,
        "live_dom",
        true
      );
    } catch (err: any) {
      setReviewLoading(false);
      setReviewError(err.message || "Failed to collect multi-page customer reviews.");
      setView("result");
    }
  }, [extractedProduct, isDemoMode, analysisSource, targetReviewCount, runReviewAnalysis]);

  /**
   * Dedicated Demo Mode loader - explicitly isolated (Requirement 6)
   */
  const handleLoadDemoReviews = useCallback(() => {
    setIsDemoMode(true);
    setAnalysisSource("demo");

    const demoProd: ExtractedProduct = {
      source_retailer: "Amazon.in",
      product_name: `[DEMO DATASET] ${DEMO_PRODUCT_NAME}`,
      url: "https://www.amazon.in/dp/B09XS7JWHH",
      current_site_price: DEMO_PRICE,
      mrp: DEMO_MRP,
      seller: "Appario Retail Pvt Ltd",
      asin: "B09XS7JWHH",
      retailer_product_id: "B09XS7JWHH",
      image:
        "https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=200&h=200&fit=crop&auto=format",
      reviews: SAMPLE_REVIEWS_BATCH,
    };

    setExtractedProduct(demoProd);
    setExtractionStatus("success");

    console.log("[DealSense Debug Demo Loaded]", {
      title: demoProd.product_name,
      asin: demoProd.asin,
      reviewCount: SAMPLE_REVIEWS_BATCH.length,
      source: "demo",
    });

    runReviewAnalysis(demoProd, SAMPLE_REVIEWS_BATCH, "demo", true);
  }, [runReviewAnalysis]);

  /**
   * Handle manual review paste fallback (Requirement 5)
   */
  const handleAnalyzeCustomReviews = useCallback(
    (reviews: ExtractedReview[]) => {
      setIsDemoMode(false);
      setAnalysisSource("manual");

      const baseProduct: ExtractedProduct = extractedProduct || {
        source_retailer: "Amazon.in",
        product_name: "Custom Customer Review Batch",
        url: "https://www.amazon.in",
        current_site_price: 0,
        mrp: null,
        seller: "Manual Input",
      };

      console.log("[DealSense Debug Manual Input]", {
        title: baseProduct.product_name,
        reviewCount: reviews.length,
        source: "manual",
      });

      runReviewAnalysis(baseProduct, reviews, "manual", true);
    },
    [extractedProduct, runReviewAnalysis]
  );

  return (
    <div className="w-[410px] min-h-[480px] bg-background text-foreground flex flex-col font-sans select-none">
      {/* popup header */}
      <header className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <Logo size={26} />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-[13.5px] font-bold tracking-tight text-foreground">
                DealSense
              </span>
              <span className="rounded bg-primary/10 border border-primary/20 px-1 py-0.2 text-[8px] font-extrabold uppercase tracking-wider text-primary">
                Review AI
              </span>
            </div>
            <div className="text-[9.5px] text-muted-foreground font-medium">
              Fake & Suspicious Review Detection
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setDark(!dark)}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition"
            title="Toggle Theme"
          >
            {dark ? <Sun width={15} height={15} /> : <Moon width={15} height={15} />}
          </button>
          <button
            onClick={() => go(view === "settings" ? prevView : "settings")}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition"
            title="Settings"
          >
            <Settings width={15} height={15} />
          </button>
        </div>
      </header>

      {/* screen router */}
      <main className="flex-1 overflow-y-auto">
        <ScreenRouter
          product={extractedProduct}
          status={extractionStatus}
          view={view}
          go={go}
          prevView={prevView}
          onAnalyze={handleAnalyze}
          onRetry={scanActiveTab}
          reviewAnalysis={reviewAnalysis}
          reviewLoading={reviewLoading}
          reviewError={reviewError}
          onAnalyzeReviews={handleAnalyzeCustomReviews}
          onLoadSampleReviews={handleLoadDemoReviews}
          analysisSource={analysisSource}
          isDemoMode={isDemoMode}
          comparison={comparison}
          comparisonLoading={comparisonLoading}
          comparisonError={comparisonError}
          onComparePrices={(customQuery?: string) => extractedProduct && handleComparePrices(extractedProduct, customQuery)}
          targetReviewCount={targetReviewCount}
          onSetTargetReviewCount={setTargetReviewCount}
        />
      </main>
    </div>
  );
}
