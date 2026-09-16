/**
 * DealSense — popup.js
 * Stage 1: UI wiring only. No backend connections.
 */

"use strict";

/* ============================================================
   CONSTANTS & STATE
   ============================================================ */

const SUPPORTED_PATTERNS = [
  { pattern: /amazon\.(com|in|co\.uk|de|fr|ca|es|it|jp)/i, label: "Amazon" },
  { pattern: /flipkart\.com/i,                               label: "Flipkart" },
  { pattern: /ebay\.(com|co\.uk|de|in)/i,                   label: "eBay" },
];

// Internal state
let state = {
  phase: "idle",       // idle | analyzing | result
  site: null,          // matched site label or null
  isSupported: false,
};

/* ============================================================
   DOM REFERENCES
   ============================================================ */

const $ = id => document.getElementById(id);

const dom = {
  statusDot:        $("ds-status-dot"),
  statusText:       $("ds-status-text"),
  siteBanner:       $("ds-site-banner"),
  siteLabel:        $("ds-site-label"),
  siteTag:          $("ds-site-tag"),
  mainSupported:    $("ds-main-supported"),
  mainUnsupported:  $("ds-main-unsupported"),
  productTitle:     $("ds-product-title"),
  productSub:       $("ds-product-sub"),
  productPrice:     $("ds-product-price"),
  metricRating:     $("ds-metric-rating"),
  metricReviews:    $("ds-metric-reviews"),
  metricSeller:     $("ds-metric-seller"),
  placeholder:      $("ds-placeholder"),
  loading:          $("ds-loading"),
  loadingStep:      $("ds-loading-step"),
  result:           $("ds-result"),
  verdictScore:     $("ds-verdict-score"),
  verdPrice:        $("ds-verd-price"),
  verdTrust:        $("ds-verd-trust"),
  verdSeller:       $("ds-verd-seller"),
  verdVerdict:      $("ds-verd-verdict"),
  signalsList:      $("ds-signals-list"),
  analyzeBtn:       $("ds-analyze-btn"),
};

/* ============================================================
   UTILITY
   ============================================================ */

function detectSite(url) {
  for (const entry of SUPPORTED_PATTERNS) {
    if (entry.pattern.test(url)) return entry.label;
  }
  return null;
}

function setStatus(text, active = false) {
  dom.statusText.textContent = text;
  dom.statusDot.classList.toggle("active", active);
}

/* ============================================================
   PHASE TRANSITIONS
   ============================================================ */

function showPlaceholder() {
  dom.placeholder.style.display  = "";
  dom.loading.classList.remove("visible");
  dom.result.classList.remove("visible");
  dom.analyzeBtn.disabled  = false;
  dom.analyzeBtn.classList.remove("analyzing");
  dom.analyzeBtn.textContent = "Analyze Product";
}

function showLoading() {
  dom.placeholder.style.display  = "none";
  dom.loading.classList.add("visible");
  dom.result.classList.remove("visible");
  dom.analyzeBtn.disabled  = true;
  dom.analyzeBtn.classList.add("analyzing");
  dom.analyzeBtn.textContent = "Analyzing...";
  setStatus("Analyzing", true);
}

function showResult(data) {
  dom.placeholder.style.display  = "none";
  dom.loading.classList.remove("visible");
  dom.result.classList.add("visible");
  dom.analyzeBtn.disabled  = false;
  dom.analyzeBtn.classList.remove("analyzing");
  dom.analyzeBtn.textContent = "Re-analyze";
  setStatus("Done", true);

  // Populate verdict
  dom.verdictScore.textContent = data.score;
  dom.verdPrice.textContent    = data.priceFair;
  dom.verdPrice.className      = "ds-verdict-item-value " + data.priceFairClass;
  dom.verdTrust.textContent    = data.reviewTrust;
  dom.verdTrust.className      = "ds-verdict-item-value " + data.reviewTrustClass;
  dom.verdSeller.textContent   = data.sellerRating;
  dom.verdSeller.className     = "ds-verdict-item-value " + data.sellerRatingClass;
  dom.verdVerdict.textContent  = data.verdict;
  dom.verdVerdict.className    = "ds-verdict-item-value " + data.verdictClass;

  // Populate signals
  dom.signalsList.innerHTML = "";
  for (const signal of data.signals) {
    const item = document.createElement("div");
    item.className = "ds-signal-item";
    item.innerHTML = `
      <span class="ds-signal-dot ${signal.type}"></span>
      <span class="ds-signal-text">${signal.text}</span>
    `;
    dom.signalsList.appendChild(item);
  }
}

/* ============================================================
   PLACEHOLDER RESULT DATA (Stage 1 only)
   ============================================================ */

const PLACEHOLDER_RESULT = {
  score:           "72 / 100",
  priceFair:       "Fair",
  priceFairClass:  "good",
  reviewTrust:     "Moderate",
  reviewTrustClass:"warn",
  sellerRating:    "Verified",
  sellerRatingClass:"good",
  verdict:         "Good Deal",
  verdictClass:    "good",
  signals: [
    { type: "good",    text: "Price is within the typical market range for this category." },
    { type: "warn",    text: "Review sentiment shows some inconsistencies — verify before purchasing." },
    { type: "good",    text: "Seller has a verified track record with low return rates." },
    { type: "neutral", text: "No significant price anomaly detected in the last 90 days." },
    { type: "bad",     text: "A few reviews mention delayed shipping. Factor this in." },
  ]
};

/* ============================================================
   SIMULATE ANALYSIS (Stage 1: no backend)
   ============================================================ */

const LOADING_STEPS = [
  "Collecting product data",
  "Analyzing price history",
  "Evaluating seller credibility",
  "Processing review signals",
  "Calculating deal score",
];

function runAnalysis() {
  if (state.phase === "analyzing") return;
  state.phase = "analyzing";

  console.log("[DealSense] Analyze Product clicked — Stage 1 simulation.");
  showLoading();

  let stepIndex = 0;
  const stepInterval = setInterval(() => {
    if (stepIndex < LOADING_STEPS.length) {
      dom.loadingStep.textContent = LOADING_STEPS[stepIndex];
      stepIndex++;
    }
  }, 420);

  // Simulate 2.4 seconds of "analysis"
  setTimeout(() => {
    clearInterval(stepInterval);
    state.phase = "result";
    showResult(PLACEHOLDER_RESULT);
    console.log("[DealSense] Placeholder result displayed.");
  }, 2400);
}

/* ============================================================
   PAGE DETECTION
   ============================================================ */

function handleSupportedPage(siteLabel, tabUrl) {
  state.site = siteLabel;
  state.isSupported = true;

  // Update site banner
  dom.siteLabel.innerHTML = `On <strong>${siteLabel}</strong>`;
  dom.siteTag.textContent = "Supported";
  dom.siteTag.className   = "ds-supported-tag";
  dom.siteTag.style.display = "";

  // Show supported main content
  dom.mainSupported.style.display   = "";
  dom.mainUnsupported.style.display = "none";

  setStatus("Ready", true);
  showPlaceholder();
}

function handleUnsupportedPage(tabUrl) {
  state.site = null;
  state.isSupported = false;

  const hostname = (() => {
    try { return new URL(tabUrl).hostname; } catch { return "this page"; }
  })();

  dom.siteLabel.innerHTML = `<strong>${hostname}</strong>`;
  dom.siteTag.textContent = "Not supported";
  dom.siteTag.className   = "ds-unsupported-tag";
  dom.siteTag.style.display = "";

  dom.mainSupported.style.display   = "none";
  dom.mainUnsupported.style.display = "";

  setStatus("Not supported");
}

function initPageDetection() {
  if (!chrome?.tabs?.query) {
    // Fallback for local HTML preview
    handleSupportedPage("Amazon (preview)", "https://www.amazon.com/preview");
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    if (!tab?.url) {
      handleUnsupportedPage("about:blank");
      return;
    }

    const siteLabel = detectSite(tab.url);
    if (siteLabel) {
      handleSupportedPage(siteLabel, tab.url);
    } else {
      handleUnsupportedPage(tab.url);
    }
  });
}

/* ============================================================
   ENTRY POINT
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  // Wire button
  dom.analyzeBtn.addEventListener("click", () => {
    if (state.isSupported) {
      runAnalysis();
    }
  });

  // Detect current page
  initPageDetection();
});
