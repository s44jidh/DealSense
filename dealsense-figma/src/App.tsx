declare const chrome: any;

import { useEffect, useRef, useState, useCallback } from "react";
import { ScreenRouter, type View } from "./components/screens";
import { Sun, Moon, Settings, Logo } from "./components/icons";
import { extractActiveTabProduct, type ExtractedProduct } from "./lib/extractor";

const API_BASE = "http://127.0.0.1:8000";

export interface PriceAnalysis {
  status: string;
  selling_price: number;
  mrp: number | null;
  discount_amount: number | null;
  discount_percent: number | null;
  verdict_label: string;
  summary: string;
}

export interface SellerAnalysis {
  status: string;
  seller: string | null;
  summary: string;
}

export interface ReviewsAnalysis {
  status: string;
  summary: string;
}

export interface MarketComparison {
  status: string;
  summary: string;
}

export interface AnalyzeResponse {
  status: string;
  product_name: string;
  current_site_price: number;
  mrp: number | null;
  seller: string | null;
  url: string;
  price_analysis: PriceAnalysis;
  seller_analysis: SellerAnalysis;
  reviews_analysis: ReviewsAnalysis;
  market_comparison: MarketComparison;
  message: string;
}

export interface ComparableOffer {
  retailer_name: string;
  product_title: string;
  product_url: string;
  current_price: number;
  mrp: number | null;
  currency: string;
  match_status: string;
  match_details?: string | null;
  rejection_category?: string | null;
  retrieval_timestamp: string;
  availability?: string | null;
  shipping_cost?: number | null;
  model_identifier?: string | null;
  configuration?: string | null;
  extracted_variants?: Record<string, any>;
}

export interface RetailerDiagnostic {
  retailer_name: string;
  search_query: string;
  http_status: number | null;
  status_reason: string;
  raw_listings_count: number;
  parsed_listings_count: number;
  valid_price_count: number;
  price_failed_count: number;
  model_mismatch_count: number;
  config_mismatch_count: number;
  unverified_variant_count: number;
  condition_mismatch_count: number;
  exact_matches_count: number;
  rejection_breakdown: Record<string, number>;
}

export interface ComparePricesResponse {
  status: string;
  source_product: {
    product_name: string;
    current_site_price: number;
    mrp: number | null;
    url: string;
    variant?: string | null;
  };
  offers: ComparableOffer[];
  verified_offers: ComparableOffer[];
  lowest_price: number | null;
  lowest_price_retailer: string | null;
  lowest_price_url: string | null;
  price_difference: number | null;
  verdict_label: string;
  summary: string;
  retrieval_timestamp: string;
  retailers_queried: string[];
  retailer_statuses: Record<string, string>;
  retailer_diagnostics?: RetailerDiagnostic[];
  diagnostics?: Record<string, any>;
  message: string;
}

export default function App() {
  const [dark, setDark] = useState(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem("sg-theme") : null;
    if (saved) return saved === "dark";
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [view, setView] = useState<View>("ready");
  const [prevView, setPrevView] = useState<View>("ready");
  const [extractedProduct, setExtractedProduct] = useState<ExtractedProduct | null>(null);
  const [extractionStatus, setExtractionStatus] = useState<
    "loading" | "success" | "unsupported" | "error"
  >("loading");

  // Persistent backend listing analysis state
  const [analysisResult, setAnalysisResult] = useState<AnalyzeResponse | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Persistent cross-store price comparison state
  const [comparisonResult, setComparisonResult] = useState<ComparePricesResponse | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);

  // Guard against out-of-order or late responses from previous products
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
   * Automatically executes listing price analysis and cross-store comparison.
   * Cancels in-flight requests if product changes. Discards stale responses.
   */
  const runAutoAnalysis = useCallback(async (product: ExtractedProduct, isManualRecheck = false) => {
    const reqId = ++currentRequestIdRef.current;
    const targetKey = `${product.url}::${product.product_name}::${product.current_site_price}::${product.variant || ""}`;
    activeProductKeyRef.current = targetKey;

    setAnalysisError(null);
    setComparisonError(null);
    setComparisonLoading(true);
    if (isManualRecheck) {
      setComparisonResult(null);
    }

    const payload = {
      url: product.url,
      product_name: product.product_name,
      current_site_price: product.current_site_price,
      mrp: product.mrp,
      seller: product.seller,
      variant: product.variant || null,
    };

    // 1. Automatic Listing Analysis (/api/analyze)
    fetch(`${API_BASE}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        if (reqId !== currentRequestIdRef.current || targetKey !== activeProductKeyRef.current) return;
        if (!res.ok) {
          let errText = `Server returned HTTP ${res.status}`;
          try {
            const errJson = await res.json();
            if (errJson?.detail) {
              errText = Array.isArray(errJson.detail)
                ? errJson.detail.map((d: any) => d.msg || JSON.stringify(d)).join("; ")
                : String(errJson.detail);
            }
          } catch {}
          setAnalysisError(errText);
          return;
        }
        const data = (await res.json()) as AnalyzeResponse;
        if (reqId !== currentRequestIdRef.current || targetKey !== activeProductKeyRef.current) return;
        setAnalysisResult(data);
        setAnalysisError(null);
      })
      .catch((err) => {
        if (reqId !== currentRequestIdRef.current || targetKey !== activeProductKeyRef.current) return;
        console.warn("[DealSense] Automatic analysis connection failed:", err);
        setAnalysisError("Could not connect to DealSense backend at http://127.0.0.1:8000. Ensure the server is running.");
      });

    // 2. Automatic Cross-Store Comparison (/api/compare-prices)
    try {
      const res = await fetch(`${API_BASE}/api/compare-prices?_t=${Date.now()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
        },
        cache: "no-store",
        body: JSON.stringify(payload),
      });

      if (reqId !== currentRequestIdRef.current || targetKey !== activeProductKeyRef.current) return;

      if (!res.ok) {
        let errText = `Server returned HTTP ${res.status}`;
        try {
          const errJson = await res.json();
          if (errJson?.detail) {
            errText = Array.isArray(errJson.detail)
              ? errJson.detail.map((d: any) => d.msg || JSON.stringify(d)).join("; ")
              : String(errJson.detail);
          }
        } catch {}
        setComparisonResult(null);
        setComparisonError(errText);
        return;
      }

      const data = (await res.json()) as ComparePricesResponse;
      if (reqId !== currentRequestIdRef.current || targetKey !== activeProductKeyRef.current) return;
      setComparisonResult(data);
      setComparisonError(null);
    } catch (err) {
      if (reqId !== currentRequestIdRef.current || targetKey !== activeProductKeyRef.current) return;
      console.warn("[DealSense] Automatic comparison connection failed:", err);
      setComparisonResult(null);
      setComparisonError("Could not connect to DealSense comparison backend at http://127.0.0.1:8000. Ensure the server is running.");
    } finally {
      if (reqId === currentRequestIdRef.current && targetKey === activeProductKeyRef.current) {
        setComparisonLoading(false);
      }
    }
  }, []);

  // Extract live Amazon India product from the active browser tab
  const runExtraction = useCallback(async () => {
    setExtractionStatus("loading");
    // Invalidate any in-flight comparison or analysis requests
    currentRequestIdRef.current += 1;
    // Clear stale analysis and comparison whenever a new product extraction begins
    setAnalysisResult(null);
    setAnalysisError(null);
    setComparisonResult(null);
    setComparisonLoading(false);
    setComparisonError(null);

    try {
      const product = await extractActiveTabProduct();
      if (product && product.product_name && product.current_site_price > 0) {
        const prodKey = `${product.url}::${product.product_name}::${product.current_site_price}::${product.variant || ""}`;
        activeProductKeyRef.current = prodKey;
        setExtractedProduct(product);
        setExtractionStatus("success");
        // Automatically display analysis & comparison results
        setView("result");
        runAutoAnalysis(product);
      } else {
        activeProductKeyRef.current = "";
        setExtractedProduct(null);
        setExtractionStatus("unsupported");
        setView("ready");
      }
    } catch (err) {
      activeProductKeyRef.current = "";
      console.warn("[DealSense] Product extraction failed:", err);
      setExtractedProduct(null);
      setExtractionStatus("error");
      setView("ready");
    }
  }, [runAutoAnalysis]);

  // Monitor tab changes, URL updates, and content script variant change events
  useEffect(() => {
    runExtraction();

    if (typeof chrome !== "undefined") {
      const handleTabActivated = () => {
        runExtraction();
      };

      const handleTabUpdated = (_tabId: number, changeInfo: any) => {
        if (changeInfo.status === "complete" || changeInfo.url) {
          runExtraction();
        }
      };

      const handleRuntimeMessage = (msg: any) => {
        if (msg && msg.action === "productUpdated" && msg.data) {
          const product = msg.data as ExtractedProduct;
          if (product && product.product_name && product.current_site_price > 0) {
            const prodKey = `${product.url}::${product.product_name}::${product.current_site_price}::${product.variant || ""}`;
            if (prodKey !== activeProductKeyRef.current) {
              setExtractedProduct(product);
              setExtractionStatus("success");
              setView("result");
              runAutoAnalysis(product);
            }
          }
        }
      };

      chrome.tabs?.onActivated?.addListener(handleTabActivated);
      chrome.tabs?.onUpdated?.addListener(handleTabUpdated);
      chrome.runtime?.onMessage?.addListener(handleRuntimeMessage);

      return () => {
        chrome.tabs?.onActivated?.removeListener(handleTabActivated);
        chrome.tabs?.onUpdated?.removeListener(handleTabUpdated);
        chrome.runtime?.onMessage?.removeListener(handleRuntimeMessage);
      };
    }
  }, [runExtraction, runAutoAnalysis]);

  const handleManualRefresh = () => {
    if (extractedProduct) {
      runAutoAnalysis(extractedProduct, true);
    } else {
      runExtraction();
    }
  };

  return (
    <div className="w-[410px] min-h-[480px] bg-background text-foreground flex flex-col font-sans select-none">
      {/* popup header */}
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <button
          onClick={handleManualRefresh}
          className="flex items-center gap-2 hover:opacity-85 transition-opacity"
          aria-label="DealSense Home"
        >
          <Logo size={22} />
          <span className="text-[17px] font-bold tracking-tight">DealSense</span>
        </button>
        <div className="flex items-center gap-2">
          {/* sliding capsule theme toggle */}
          <div className="relative flex items-center rounded-full border border-border bg-muted p-[3px] gap-0.5">
            <div
              className={`pointer-events-none absolute top-[3px] bottom-[3px] rounded-full bg-card shadow-sm transition-all duration-300 ${
                dark ? "left-[calc(50%-1px)] right-[3px]" : "left-[3px] right-[calc(50%-1px)]"
              }`}
            />
            <button
              onClick={() => setDark(false)}
              aria-label="Light mode"
              className={`relative z-10 flex h-[22px] w-[22px] items-center justify-center rounded-full transition-colors ${
                !dark ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <Sun width={12} height={12} />
            </button>
            <button
              onClick={() => setDark(true)}
              aria-label="Dark mode"
              className={`relative z-10 flex h-[22px] w-[22px] items-center justify-center rounded-full transition-colors ${
                dark ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              <Moon width={12} height={12} />
            </button>
          </div>
          <IconBtn
            label="Settings"
            active={view === "settings"}
            onClick={() => go("settings")}
          >
            <Settings width={15} height={15} />
          </IconBtn>
        </div>
      </header>

      {/* body */}
      <main className="pop-scroll max-h-[500px] min-h-[380px] overflow-y-auto flex-1">
        <ScreenRouter
          product={extractedProduct}
          status={extractionStatus}
          view={view}
          go={go}
          prevView={prevView}
          onAnalyze={handleManualRefresh}
          onRetry={runExtraction}
          apiPromise={null}
          analysis={analysisResult}
          error={analysisError}
          comparison={comparisonResult}
          comparisonLoading={comparisonLoading}
          comparisonError={comparisonError}
          onComparePrices={handleManualRefresh}
        />
      </main>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`flex h-7 w-7 items-center justify-center rounded-lg transition ${
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
