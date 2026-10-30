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
  const [analysisStep, setAnalysisStep] = useState<string | null>(null);

  // Price comparison state
  const [comparison, setComparison] = useState<ComparePricesResponse | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  // Analysis source tracking: "live_dom" | "demo" | "manual"
  const [analysisSource, setAnalysisSource] = useState<
    "live_dom" | "demo" | "manual"
  >("live_dom");

  const currentRequestIdRef = useRef<number>(0);
  const currentComparisonIdRef = useRef<number>(0);
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
        if (reqId !== currentRequestIdRef.current) return;

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

        if (reqId !== currentRequestIdRef.current) return;
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
  const handleComparePrices = useCallback(async (product: ExtractedProduct, customQuery?: string, explicitCompId?: number) => {
    if (!product || !product.product_name) return;
    const compId = explicitCompId !== undefined ? explicitCompId : ++currentComparisonIdRef.current;
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
      if (compId !== currentComparisonIdRef.current) return;
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server returned HTTP ${res.status}`);
      }
      const data: ComparePricesResponse = await res.json();
      if (compId !== currentComparisonIdRef.current) return;
      setComparison(data);
      setComparisonLoading(false);
    } catch (err: any) {
      if (compId !== currentComparisonIdRef.current) return;
      setComparisonLoading(false);
      setComparisonError(err.message || "Comparison request failed.");
    }
  }, []);

  /**
   * Scan the active browser tab on load (Requirement 1, 2, 7)
   */
  const scanActiveTab = useCallback(async () => {
    const scanReqId = ++currentRequestIdRef.current;
    const scanCompId = ++currentComparisonIdRef.current;
    setExtractionStatus("loading");
    setReviewError(null);
    setReviewAnalysis(null);
    setComparison(null);
    setComparisonError(null);
    setAnalysisSource("live_dom");

    try {
      const prod = await extractActiveTabProduct();
      if (scanReqId !== currentRequestIdRef.current) return;
      if (!prod) {
        activeProductKeyRef.current = "";
        setExtractedProduct(null);
        setExtractionStatus("unsupported");
        console.warn("[DealSense Debug] Active tab is not a supported Amazon or Flipkart product page");
        return;
      }

      const prodKey = `${prod.source_retailer}::${prod.retailer_product_id || prod.asin || prod.url}::${prod.variant || ""}`;
      activeProductKeyRef.current = prodKey;
      setExtractedProduct(prod);
      setExtractionStatus("success");

      // Auto-trigger price comparison
      handleComparePrices(prod, undefined, scanCompId);

      // Restore background analysis job state if active or completed for this product
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(
          { action: "getAnalysisJob", productKey: prodKey },
          (resp: any) => {
            if (chrome.runtime?.lastError || !resp || !resp.job) return;
            const job = resp.job;
            if (job.status === "completed" && job.analysisResult) {
              setReviewAnalysis(job.analysisResult);
              setReviewLoading(false);
              setReviewError(null);
              setView("result");
            } else if (job.status === "collecting" || job.status === "analyzing") {
              setReviewLoading(true);
              setAnalysisStep(job.step || "Analyzing reviews in background...");
              setView("analyzing");
            } else if (job.status === "error" && job.error) {
              setReviewError(job.error);
              setReviewLoading(false);
              setView("result");
            }
          }
        );
      }

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
      if (scanReqId !== currentRequestIdRef.current) return;
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
        if (msg && msg.action === "analysisProgress" && msg.job) {
          if (msg.job.productKey === activeProductKeyRef.current) {
            setReviewLoading(true);
            setAnalysisStep(msg.job.step);
            setView("analyzing");
          }
        } else if (msg && msg.action === "analysisCompleted" && msg.job) {
          if (msg.job.productKey === activeProductKeyRef.current) {
            setReviewAnalysis(msg.job.analysisResult);
            setReviewLoading(false);
            setReviewError(null);
            setView("result");
          }
        } else if (msg && msg.action === "analysisError" && msg.job) {
          if (msg.job.productKey === activeProductKeyRef.current) {
            setReviewLoading(false);
            setReviewError(msg.job.error);
            setView("result");
          }
        } else if (msg && msg.action === "productUpdated" && msg.data) {
          const newProd = msg.data;
          const newProdKey = `${newProd.source_retailer}::${newProd.retailer_product_id || newProd.asin || newProd.url}::${newProd.variant || ""}`;

          // Only reset when switching to a completely different product
          if (newProdKey !== activeProductKeyRef.current) {
            currentRequestIdRef.current++;
            const newCompId = ++currentComparisonIdRef.current;
            activeProductKeyRef.current = newProdKey;

            setExtractedProduct(newProd);
            setExtractionStatus("success");
            setReviewAnalysis(null);
            setReviewError(null);
            setComparison(null);
            setComparisonError(null);
            setAnalysisSource("live_dom");
            setView("ready");

            console.log("[DealSense Debug Dynamic Update]", {
              title: newProd.product_name,
              asin: newProd.asin || "N/A",
              reviewCount: newProd.reviews?.length ?? 0,
              source: "live_dom",
            });

            // Auto-trigger comparison for the new product
            handleComparePrices(newProd, undefined, newCompId);
          }
        } else if (msg && msg.action === "productUnavailable") {
          currentRequestIdRef.current++;
          currentComparisonIdRef.current++;
          activeProductKeyRef.current = "";
          setExtractedProduct(null);
          setExtractionStatus("unsupported");
          setReviewAnalysis(null);
          setComparison(null);
          setView("ready");
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      return () => {
        chrome.runtime.onMessage.removeListener(listener);
      };
    }
  }, [scanActiveTab, handleComparePrices]);

  /**
   * Primary action on Ready screen: analyze reviews (Requirement 3, 4, 5, 6)
   * Strictly uses only reviews belonging to the detected product.
   * Multi-page collection expands review depth to targetCount (100 or 300).
   * If reviews cannot be retrieved, displays honest error state.
   */
  const handleAnalyze = useCallback(async () => {
    if (!extractedProduct) return;
    const analyzeReqId = ++currentRequestIdRef.current;
    const prodKey = `${extractedProduct.source_retailer}::${extractedProduct.retailer_product_id || extractedProduct.asin || extractedProduct.url}::${extractedProduct.variant || ""}`;
    activeProductKeyRef.current = prodKey;
    const currentReviews = extractedProduct.reviews || [];

    console.log("[DealSense Debug Analyze Triggered]", {
      title: extractedProduct.product_name,
      asin: extractedProduct.asin || extractedProduct.retailer_product_id || "N/A",
      url: extractedProduct.url,
      currentReviewCount: currentReviews.length,
      source: analysisSource === "manual" ? "manual" : "live_dom",
    });

    setView("analyzing");
    setReviewLoading(true);
    setReviewError(null);
    setAnalysisStep("Initializing background review collection...");

    // Dispatch background analysis job to Manifest V3 Service Worker.
    // This allows review collection & backend ML analysis to run independently
    // of the popup lifecycle, ensuring it continues even if Chromium/Helium closes the popup.
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(
        {
          action: "startReviewAnalysis",
          product: extractedProduct,
          initialReviews: currentReviews,
        },
        (resp: any) => {
          if (chrome.runtime?.lastError) {
            console.warn("[DealSense] startReviewAnalysis response warning:", chrome.runtime.lastError);
          }
          if (resp && resp.job) {
            setAnalysisStep(resp.job.step);
          }
        }
      );
    } else {
      // Fallback for non-extension test environments
      runReviewAnalysis(extractedProduct, currentReviews, analysisSource === "manual" ? "manual" : "live_dom", true);
    }
  }, [extractedProduct, analysisSource, runReviewAnalysis]);

  /**
   * Handle manual review paste fallback
   */
  const handleAnalyzeCustomReviews = useCallback(
    (reviews: ExtractedReview[]) => {
      setAnalysisSource("manual");

      const baseProduct: ExtractedProduct = extractedProduct || {
        source_retailer: "Amazon.in",
        product_name: "Custom Customer Review Batch",
        url: "https://www.amazon.in",
        current_site_price: 0,
        mrp: null,
        seller: "Manual Input",
      };

      const prodKey = `Manual::${baseProduct.url}::${Date.now()}`;
      activeProductKeyRef.current = prodKey;

      setView("analyzing");
      setReviewLoading(true);
      setReviewError(null);
      setAnalysisStep("Analyzing custom pasted reviews...");

      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage(
          {
            action: "startReviewAnalysis",
            product: baseProduct,
            initialReviews: reviews,
          },
          (resp: any) => {
            if (resp && resp.job) {
              setAnalysisStep(resp.job.step);
            }
          }
        );
      } else {
        runReviewAnalysis(baseProduct, reviews, "manual", true);
      }
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
          analysisStep={analysisStep}
          onAnalyzeReviews={handleAnalyzeCustomReviews}
          analysisSource={analysisSource}
          comparison={comparison}
          comparisonLoading={comparisonLoading}
          comparisonError={comparisonError}
          onComparePrices={(customQuery?: string) => extractedProduct && handleComparePrices(extractedProduct, customQuery)}
        />
      </main>
    </div>
  );
}
