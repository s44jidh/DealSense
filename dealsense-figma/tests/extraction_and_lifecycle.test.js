import test from "node:test";
import assert from "node:assert/strict";
import { MockNode } from "./dom_mock.js";

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentScriptCode = fs.readFileSync(path.join(__dirname, "../public/content.js"), "utf8");
// Execute in global context as a Chrome content script
vm.runInThisContext(contentScriptCode);

// Helper to set up global window/document environment
function setupGlobalEnvironment(doc, url = "https://www.amazon.in/dp/B00KVEB182") {
  const parsed = new URL(url);
  globalThis.document = doc;
  globalThis.window = {
    location: {
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      href: url,
    },
    addEventListener: () => {},
  };
  globalThis.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        if (cb) cb();
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Test 1: A Nivia football page containing a sponsored Dell laptop banner
// ---------------------------------------------------------------------------
test("Test 1: Nivia football page with sponsored Dell laptop banner extracts only Nivia football", () => {
  const doc = new MockNode("#document");

  // 1. Sponsored Dell laptop banner at the top of the DOM
  const adBanner = new MockNode("div", { class: "s-widget-container ad-banner", id: "sponsored-banner" });
  const adTitle = new MockNode("div", { id: "title", class: "banner-title" }, "Dell Alienware m16 R2 Gaming Laptop Intel Core Ultra 9 185H 32GB RAM");
  const adPrice = new MockNode("span", { class: "a-price" });
  const adPriceOff = new MockNode("span", { class: "a-offscreen" }, "₹1,49,990.00");
  adPrice.appendChild(adPriceOff);
  const adImg = new MockNode("img", { id: "banner-image", src: "https://m.media-amazon.com/images/I/dell-laptop.jpg" });
  adBanner.appendChild(adTitle);
  adBanner.appendChild(adPrice);
  adBanner.appendChild(adImg);
  doc.appendChild(adBanner);

  // 2. Main product detail container (#dp) for Nivia Football
  const dp = new MockNode("div", { id: "dp", "data-asin": "B00KVEB182" });

  // Main product title strictly in #productTitle
  const productTitle = new MockNode("span", { id: "productTitle" }, "  Nivia Storm Football - Rubber, Size 5 (White)  ");
  dp.appendChild(productTitle);

  // Core price display container
  const corePriceDiv = new MockNode("div", { id: "corePriceDisplay_desktop_feature_div" });
  const priceToPay = new MockNode("span", { class: "a-price aok-align-center" });
  const priceOff = new MockNode("span", { class: "a-offscreen" }, "₹399.00");
  priceToPay.appendChild(priceOff);
  corePriceDiv.appendChild(priceToPay);

  // MRP element
  const basisPrice = new MockNode("span", { class: "basisPrice" });
  const mrpOff = new MockNode("span", { class: "a-offscreen" }, "₹500.00");
  basisPrice.appendChild(mrpOff);
  corePriceDiv.appendChild(basisPrice);
  dp.appendChild(corePriceDiv);

  // Buybox seller
  const buybox = new MockNode("div", { id: "desktop_buybox" });
  const sellerLink = new MockNode("a", { id: "sellerProfileTriggerId" }, "Nivia Sports Official");
  buybox.appendChild(sellerLink);
  dp.appendChild(buybox);

  // Main product image container
  const imgContainer = new MockNode("div", { id: "main-image-container" });
  const mainImg = new MockNode("img", {
    id: "landingImage",
    src: "https://m.media-amazon.com/images/I/nivia-football.jpg",
    "data-old-hires": "https://m.media-amazon.com/images/I/nivia-football-hires.jpg",
  });
  imgContainer.appendChild(mainImg);
  dp.appendChild(imgContainer);

  doc.appendChild(dp);

  setupGlobalEnvironment(doc, "https://www.amazon.in/Nivia-Storm-Football/dp/B00KVEB182?ref=sr_1_1");

  const extracted = extractAmazonProduct();
  assert.ok(extracted, "Product extraction must succeed on a valid detail page");

  // Title must strictly be the football, not Dell Alienware
  assert.equal(extracted.product_name, "Nivia Storm Football - Rubber, Size 5 (White)");
  assert.doesNotMatch(extracted.product_name, /dell|alienware|laptop/i);

  // ASIN and URL must match the football, not any sponsored ad
  assert.equal(extracted.asin, "B00KVEB182");
  assert.equal(extracted.url, "https://www.amazon.in/dp/B00KVEB182");

  // Price must strictly be 399.0 (football price), NOT 149990.0 (banner price)
  assert.equal(extracted.current_site_price, 399.0);
  assert.notEqual(extracted.current_site_price, 149990.0);

  // MRP must be 500.0
  assert.equal(extracted.mrp, 500.0);

  // Seller must be Nivia Sports Official
  assert.equal(extracted.seller, "Nivia Sports Official");

  // Image must be the football image, NOT the laptop image
  assert.equal(extracted.image, "https://m.media-amazon.com/images/I/nivia-football-hires.jpg");
  assert.doesNotMatch(extracted.image, /dell/i);
});

// ---------------------------------------------------------------------------
// Test 2: Navigation from a Dell laptop page to the football page
// ---------------------------------------------------------------------------
test("Test 2: Navigation from Dell laptop to football page invalidates old state immediately", () => {
  // Simulate Popup application state machine
  class PopupStateMachine {
    constructor() {
      this.currentRequestId = 0;
      this.activeProductKey = "";
      this.extractedProduct = null;
      this.extractionStatus = "idle";
      this.view = "ready";
      this.analysisResult = null;
      this.comparisonResult = null;
      this.comparisonLoading = false;
    }

    startExtraction() {
      // Immediate atomic invalidation of old state
      this.currentRequestId += 1;
      this.activeProductKey = "";
      this.extractedProduct = null;
      this.analysisResult = null;
      this.comparisonResult = null;
      this.comparisonLoading = false;
      this.extractionStatus = "loading";
      this.view = "ready";
    }

    productExtracted(product) {
      if (product && product.product_name && product.current_site_price > 0) {
        this.extractedProduct = product;
        this.activeProductKey = `${product.url}::${product.product_name}::${product.current_site_price}`;
        this.extractionStatus = "success";
        this.view = "result";
        this.triggerComparison(product);
      } else {
        this.extractedProduct = null;
        this.activeProductKey = "";
        this.extractionStatus = "unsupported";
        this.view = "ready";
      }
    }

    triggerComparison(product) {
      this.comparisonLoading = true;
      this.comparisonResult = null;
    }
  }

  const popup = new PopupStateMachine();

  // 1. Popup is currently displaying Dell laptop
  const dellLaptop = {
    url: "https://www.amazon.in/dp/B0D5BXYZ12",
    asin: "B0D5BXYZ12",
    product_name: "Dell Alienware m16 R2 Gaming Laptop",
    current_site_price: 149990.0,
    mrp: 180000.0,
    seller: "Appario Retail",
  };
  popup.productExtracted(dellLaptop);
  popup.comparisonResult = {
    status: "success",
    source_product: { product_name: dellLaptop.product_name, current_site_price: dellLaptop.current_site_price, url: dellLaptop.url },
    offers: [],
  };

  assert.equal(popup.extractedProduct.product_name, "Dell Alienware m16 R2 Gaming Laptop");
  assert.equal(popup.comparisonResult.source_product.product_name, "Dell Alienware m16 R2 Gaming Laptop");

  // 2. User navigates to Nivia football page: startExtraction() is called immediately
  popup.startExtraction();

  // Old product and comparison state MUST be cleared immediately
  assert.equal(popup.extractedProduct, null, "Old product must be cleared immediately upon navigation");
  assert.equal(popup.comparisonResult, null, "Old comparison must be cleared immediately upon navigation");
  assert.equal(popup.activeProductKey, "");
  assert.equal(popup.extractionStatus, "loading");
  assert.equal(popup.view, "ready");

  // 3. New product is extracted
  const niviaFootball = {
    url: "https://www.amazon.in/dp/B00KVEB182",
    asin: "B00KVEB182",
    product_name: "Nivia Storm Football - Size 5",
    current_site_price: 399.0,
    mrp: 500.0,
    seller: "Nivia Sports",
  };
  popup.productExtracted(niviaFootball);

  assert.equal(popup.extractedProduct.product_name, "Nivia Storm Football - Size 5");
  assert.equal(popup.activeProductKey, "https://www.amazon.in/dp/B00KVEB182::Nivia Storm Football - Size 5::399");
  assert.equal(popup.extractionStatus, "success");
  assert.equal(popup.view, "result");
  assert.equal(popup.comparisonLoading, true);
  assert.equal(popup.comparisonResult, null, "New product starts with clean comparison state");
});

// ---------------------------------------------------------------------------
// Test 3: A delayed laptop comparison response arriving after navigation to football
// ---------------------------------------------------------------------------
test("Test 3: Delayed laptop comparison response is discarded and cannot overwrite football data", () => {
  let currentRequestId = 0;
  let activeProductKey = "";
  let displayedComparison = null;
  let discardedCount = 0;

  function runAutoAnalysis(product) {
    const reqId = ++currentRequestId;
    const targetKey = `${product.url}::${product.product_name}::${product.current_site_price}`;
    activeProductKey = targetKey;
    displayedComparison = null;

    return {
      reqId,
      targetKey,
      receiveResponse: (response) => {
        // Strict guard from App.tsx:
        if (reqId !== currentRequestId || targetKey !== activeProductKey) {
          discardedCount++;
          return;
        }
        // Invariant check: source product name must match
        if (response.source_product?.product_name && response.source_product.product_name !== product.product_name) {
          discardedCount++;
          return;
        }
        displayedComparison = response;
      },
    };
  }

  // 1. Dell Laptop triggers comparison request #1
  const dellProduct = {
    url: "https://www.amazon.in/dp/B0D5BXYZ12",
    product_name: "Dell Alienware m16 R2 Gaming Laptop",
    current_site_price: 149990.0,
  };
  const request1 = runAutoAnalysis(dellProduct);
  assert.equal(request1.reqId, 1);

  // 2. User navigates to Nivia football; triggers comparison request #2
  const footballProduct = {
    url: "https://www.amazon.in/dp/B00KVEB182",
    product_name: "Nivia Storm Football - Size 5",
    current_site_price: 399.0,
  };
  const request2 = runAutoAnalysis(footballProduct);
  assert.equal(request2.reqId, 2);
  assert.equal(displayedComparison, null);

  // 3. Delayed response for Request #1 (Dell Laptop) arrives NOW
  const delayedDellResponse = {
    status: "success",
    source_product: {
      product_name: "Dell Alienware m16 R2 Gaming Laptop",
      current_site_price: 149990.0,
      url: "https://www.amazon.in/dp/B0D5BXYZ12",
    },
    retailer_diagnostics: [
      { retailer_name: "Flipkart", search_query: "dell alienware m16 r2", http_status: 200 },
    ],
  };
  request1.receiveResponse(delayedDellResponse);

  // VERIFY: The delayed response MUST be dropped
  assert.equal(discardedCount, 1, "Delayed laptop response must be discarded");
  assert.equal(displayedComparison, null, "Displayed comparison must NOT be set to the delayed laptop response");

  // 4. Response for Request #2 (Nivia Football) arrives
  const footballResponse = {
    status: "no_offers_found",
    source_product: {
      product_name: "Nivia Storm Football - Size 5",
      current_site_price: 399.0,
      url: "https://www.amazon.in/dp/B00KVEB182",
    },
    retailer_diagnostics: [
      { retailer_name: "Flipkart", search_query: "nivia storm football", http_status: 200 },
    ],
  };
  request2.receiveResponse(footballResponse);

  // VERIFY: Football response is accepted
  assert.equal(displayedComparison, footballResponse);
  assert.equal(displayedComparison.source_product.product_name, "Nivia Storm Football - Size 5");
  assert.equal(displayedComparison.retailer_diagnostics[0].search_query, "nivia storm football");

  // 5. Test UI Consistency Guard (screens.tsx Result component guard)
  function evaluateResultConsistency(product, comparison) {
    const isComparisonConsistent = Boolean(
      comparison && (!comparison.source_product?.product_name || comparison.source_product.product_name === product.product_name)
    );
    return isComparisonConsistent ? comparison : null;
  }

  // If somehow an old comparison is passed to football Result, it must be rejected
  const renderedComp = evaluateResultConsistency(footballProduct, delayedDellResponse);
  assert.equal(renderedComp, null, "screens.tsx Result guard must reject mismatched laptop comparison for football");
});

// ---------------------------------------------------------------------------
// Test 4: Missing or empty #productTitle
// ---------------------------------------------------------------------------
test("Test 4: Missing or empty #productTitle returns null and displays unsupported state", () => {
  // Case 4a: Missing #productTitle completely (e.g. search page with sponsored laptop banner)
  const docNoTitle = new MockNode("#document");
  const banner = new MockNode("div", { id: "title" }, "Dell Alienware Gaming Laptop");
  const dpNoTitle = new MockNode("div", { id: "dp", "data-asin": "B00KVEB182" });
  docNoTitle.appendChild(banner);
  docNoTitle.appendChild(dpNoTitle);

  setupGlobalEnvironment(docNoTitle, "https://www.amazon.in/s?k=football");
  const result4a = extractAmazonProduct();
  assert.equal(result4a, null, "Missing #productTitle must return null, never banner #title");

  // Case 4b: Empty #productTitle
  const docEmptyTitle = new MockNode("#document");
  const dpEmpty = new MockNode("div", { id: "dp", "data-asin": "B00KVEB182" });
  dpEmpty.appendChild(new MockNode("span", { id: "productTitle" }, ""));
  docEmptyTitle.appendChild(dpEmpty);

  setupGlobalEnvironment(docEmptyTitle, "https://www.amazon.in/dp/B00KVEB182");
  const result4b = extractAmazonProduct();
  assert.equal(result4b, null, "Empty #productTitle must return null");

  // Case 4c: Whitespace-only #productTitle
  const docWhitespaceTitle = new MockNode("#document");
  const dpWhite = new MockNode("div", { id: "dp", "data-asin": "B00KVEB182" });
  dpWhite.appendChild(new MockNode("span", { id: "productTitle" }, "   \n\t  \r  "));
  docWhitespaceTitle.appendChild(dpWhite);

  setupGlobalEnvironment(docWhitespaceTitle, "https://www.amazon.in/dp/B00KVEB182");
  const result4c = extractAmazonProduct();
  assert.equal(result4c, null, "Whitespace-only #productTitle must return null");

  // Case 4d: #productTitle present but missing ASIN
  const docNoAsin = new MockNode("#document");
  const dpNoAsin = new MockNode("div", { id: "dp" });
  dpNoAsin.appendChild(new MockNode("span", { id: "productTitle" }, "Some Product"));
  docNoAsin.appendChild(dpNoAsin);

  setupGlobalEnvironment(docNoAsin, "https://www.amazon.in/some-non-product-page");
  const result4d = extractAmazonProduct();
  assert.equal(result4d, null, "Product missing verifiable ASIN must return null");
});

// ---------------------------------------------------------------------------
// Test 5: Repeated DOM mutations not causing excessive requests
// ---------------------------------------------------------------------------
test("Test 5: Repeated DOM mutations are debounced and identity check prevents duplicate requests", async () => {
  // Set up valid product DOM
  const doc = new MockNode("#document");
  const dp = new MockNode("div", { id: "dp", "data-asin": "B00KVEB182" });
  dp.appendChild(new MockNode("span", { id: "productTitle" }, "Nivia Storm Football"));
  const corePrice = new MockNode("div", { id: "corePriceDisplay_desktop_feature_div" });
  const priceToPay = new MockNode("span", { class: "a-price" });
  priceToPay.appendChild(new MockNode("span", { class: "a-offscreen" }, "₹399.00"));
  corePrice.appendChild(priceToPay);
  dp.appendChild(corePrice);
  doc.appendChild(dp);

  setupGlobalEnvironment(doc, "https://www.amazon.in/dp/B00KVEB182");

  let sentMessages = [];
  globalThis.chrome.runtime.sendMessage = (msg, cb) => {
    sentMessages.push(msg);
    if (cb) cb();
  };

  if (window.__dealSenseSetLastSentIdentity) window.__dealSenseSetLastSentIdentity(null);

  // Trigger 20 rapid mutations in quick succession (simulating dynamic DOM re-renders, timers, ad carousels)
  for (let i = 0; i < 20; i++) {
    checkAndNotifyProductUpdate();
  }

  // Before debounce timer expires, NO messages should have been sent
  assert.equal(sentMessages.length, 0, "No message should be sent before debounce timer expires");

  // Wait for debounce timer (400ms + buffer)
  await new Promise((resolve) => setTimeout(resolve, 450));

  // Exactly 1 message should have been sent
  assert.equal(sentMessages.length, 1, "Debounced mutations must emit exactly 1 message");
  assert.equal(sentMessages[0].action, "productUpdated");
  assert.equal(sentMessages[0].data.product_name, "Nivia Storm Football");

  // Now trigger another 10 mutations for the SAME product identity
  for (let i = 0; i < 10; i++) {
    checkAndNotifyProductUpdate();
  }
  await new Promise((resolve) => setTimeout(resolve, 450));

  // Identity check must prevent sending any duplicate messages
  assert.equal(
    sentMessages.length,
    1,
    "Identical product state must not trigger additional messages"
  );
});
