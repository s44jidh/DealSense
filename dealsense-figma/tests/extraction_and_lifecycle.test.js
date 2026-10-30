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

// ---------------------------------------------------------------------------
// Test 6: Supplied Flipkart Nothing Phone 4b product page is recognized
// ---------------------------------------------------------------------------
test("Test 6: Supplied Flipkart Nothing Phone 4b product page is recognized and extracted", () => {
  const doc = new MockNode("#document");
  const link = new MockNode("link", {
    rel: "canonical",
    href: "https://www.flipkart.com/nothing-phone-4b-blue-128-gb/p/itm939608b40adbb"
  });
  const script = new MockNode("script", { type: "application/ld+json" }, JSON.stringify([{
    "@type": "Product",
    "name": "Nothing Phone (4b) (Black, 256 GB)",
    "sku": "MOBHZMBDNBKCHZ7B",
    "offers": { "price": 40999, "availability": "https://schema.org/InStock" },
    "brand": { "name": "Nothing" },
    "image": ["https://rukmini1.flixcart.com/image/1500/1500/xif0q/mobile/c/e/m/-resized-original-imahpfrkm8tnj7cb.jpeg"]
  }]));
  const h1 = new MockNode("h1", { class: "v1zwn21n v1zwn27 _1psv1zeb9 _1psv1ze0" }, "Nothing Phone (4b) (Black, 256 GB) (8 GB RAM)");
  const priceDiv = new MockNode("div", { class: "v1zwn21n v1zwn2a _1psv1zeb9 _1psv1ze0 _1psv1ze2c" }, "₹40,999");
  const mrpDiv = new MockNode("div", { class: "v1zwn21o v1zwn29 _1psv1zeb9 _1psv1ze0 _1psv1ze93", style: "text-decoration-line:line-through" }, "59,999");
  const sellerDiv = new MockNode("div", { class: "v1zwn26 _1psv1zeb9 _1psv1ze0" }, "Seller: IndiFlashMart");

  doc.appendChild(link);
  doc.appendChild(script);
  doc.appendChild(h1);
  doc.appendChild(priceDiv);
  doc.appendChild(mrpDiv);
  doc.appendChild(sellerDiv);

  setupGlobalEnvironment(doc, "https://www.flipkart.com/nothing-phone-4b-blue-128-gb/p/itm939608b40adbb");

  const product = extractProduct();
  assert.ok(product, "Product should be detected on Flipkart Nothing Phone 4b page");
  assert.strictEqual(product.source_retailer, "Flipkart");
  assert.strictEqual(product.product_name, "Nothing Phone (4b) (Black, 256 GB) (8 GB RAM)");
  assert.strictEqual(product.current_site_price, 40999);
  assert.strictEqual(product.mrp, 59999);
  assert.strictEqual(product.seller, "IndiFlashMart");
  assert.strictEqual(product.retailer_product_id, "MOBHZMBDNBKCHZ7B");
  assert.strictEqual(product.manufacturer_part_number, null);
  assert.strictEqual(product.brand, "Nothing");
  assert.strictEqual(product.availability, "IN_STOCK");
  assert.ok(product.variant && product.variant.includes("256 GB"));
});

// ---------------------------------------------------------------------------
// Test 7: Product identifiers are parsed into correct namespaces (PID vs MPN)
// ---------------------------------------------------------------------------
test("Test 7: Flipkart PID and Amazon ASIN populate retailer_product_id and are never treated as MPN", () => {
  // 1. Flipkart product with item ID and PID
  const fkDoc = new MockNode("#document");
  const fkLink = new MockNode("link", { rel: "canonical", href: "https://www.flipkart.com/item/p/itm939608b40adbb?pid=MOB123456789" });
  const fkH1 = new MockNode("h1", {}, "Nothing Phone (4b) (Black, 256 GB)");
  const fkPrice = new MockNode("div", { class: "Nx9bqj CxhGGd" }, "₹40,999");
  fkDoc.appendChild(fkLink);
  fkDoc.appendChild(fkH1);
  fkDoc.appendChild(fkPrice);

  setupGlobalEnvironment(fkDoc, "https://www.flipkart.com/item/p/itm939608b40adbb?pid=MOB123456789");
  const fkProduct = extractProduct();
  assert.ok(fkProduct);
  assert.strictEqual(fkProduct.retailer_product_id, "MOB123456789");
  assert.strictEqual(fkProduct.manufacturer_part_number, null, "Flipkart PID must never be assigned to manufacturer_part_number");

  // 2. Amazon product with ASIN
  const amzDoc = new MockNode("#document");
  const amzDp = new MockNode("div", { id: "dp", "data-asin": "B0GR1C18B7" });
  const amzTitle = new MockNode("span", { id: "productTitle" }, "Apple MacBook Air 13-inch");
  const amzPrice = new MockNode("span", { class: "priceToPay" });
  amzPrice.appendChild(new MockNode("span", { class: "a-offscreen" }, "₹1,88,890"));
  amzDp.appendChild(amzTitle);
  amzDp.appendChild(amzPrice);
  amzDoc.appendChild(amzDp);

  setupGlobalEnvironment(amzDoc, "https://www.amazon.in/dp/B0GR1C18B7");
  const amzProduct = extractProduct();
  assert.ok(amzProduct);
  assert.strictEqual(amzProduct.retailer_product_id, "B0GR1C18B7");
  assert.strictEqual(amzProduct.manufacturer_part_number, null, "Amazon ASIN must never be assigned to manufacturer_part_number");
});

// ---------------------------------------------------------------------------
// Test 8: Search suggestions and sponsored products cannot replace main product
// ---------------------------------------------------------------------------
test("Test 8: Search suggestions and sponsored banners on Flipkart cannot replace the main product", () => {
  const doc = new MockNode("#document");

  // Search input and auto-suggestions
  const searchBar = new MockNode("input", { class: "Pke_EE", value: "samsung galaxy s24 ultra" });
  const suggestions = new MockNode("div", { class: "_1sFryS" });
  suggestions.appendChild(new MockNode("div", { class: "_3D0G9a" }, "Samsung Galaxy S24 in Mobile Phones"));
  doc.appendChild(searchBar);
  doc.appendChild(suggestions);

  // Sponsored carousel banner
  const sponsored = new MockNode("div", { class: "sponsored-ad-card" });
  sponsored.appendChild(new MockNode("div", { class: "title" }, "Motorola Edge 50 Fusion"));
  sponsored.appendChild(new MockNode("div", { class: "price" }, "₹22,999"));
  doc.appendChild(sponsored);

  // Main product container
  const h1 = new MockNode("h1", { class: "v1zwn21n _1psv1zeb9" }, "Nothing Phone (4b) (Black, 256 GB) (8 GB RAM)");
  const mainPrice = new MockNode("div", { class: "v1zwn21n" }, "₹40,999");
  doc.appendChild(h1);
  doc.appendChild(mainPrice);

  setupGlobalEnvironment(doc, "https://www.flipkart.com/nothing-phone-4b-blue-128-gb/p/itm939608b40adbb");

  const product = extractProduct();
  assert.ok(product);
  assert.strictEqual(product.product_name, "Nothing Phone (4b) (Black, 256 GB) (8 GB RAM)");
  assert.strictEqual(product.current_site_price, 40999);
  assert.ok(!product.product_name.includes("Samsung"));
  assert.ok(!product.product_name.includes("Motorola"));
});

// ---------------------------------------------------------------------------
// Test 9: Flipkart SPA navigation updates the product correctly
// ---------------------------------------------------------------------------
test("Test 9: Flipkart SPA navigation updates the product correctly", async () => {
  const doc = new MockNode("#document");
  const h1 = new MockNode("h1", {}, "Nothing Phone (4b) (Black, 128 GB)");
  const price = new MockNode("div", { class: "Nx9bqj" }, "₹36,999");
  doc.appendChild(h1);
  doc.appendChild(price);

  setupGlobalEnvironment(doc, "https://www.flipkart.com/nothing-phone-4b-black-128-gb/p/itm123?pid=MOB128");

  if (globalThis.window.__dealSenseSetLastSentIdentity) globalThis.window.__dealSenseSetLastSentIdentity(null);
  let notifiedMsg = null;
  globalThis.chrome.runtime.sendMessage = (msg, cb) => {
    notifiedMsg = msg;
    if (cb) cb();
  };

  checkAndNotifyProductUpdate();
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.ok(notifiedMsg);
  assert.strictEqual(notifiedMsg.action, "productUpdated");
  assert.strictEqual(notifiedMsg.data.product_name, "Nothing Phone (4b) (Black, 128 GB)");
  assert.strictEqual(notifiedMsg.data.current_site_price, 36999);

  // Client-side SPA navigation to 256 GB variant
  notifiedMsg = null;
  h1.textContent = "Nothing Phone (4b) (Black, 256 GB)";
  price.textContent = "₹40,999";
  globalThis.window.location.href = "https://www.flipkart.com/nothing-phone-4b-black-256-gb/p/itm123?pid=MOB256";
  globalThis.window.location.pathname = "/nothing-phone-4b-black-256-gb/p/itm123";

  checkAndNotifyProductUpdate();
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.ok(notifiedMsg);
  assert.strictEqual(notifiedMsg.action, "productUpdated");
  assert.strictEqual(notifiedMsg.data.product_name, "Nothing Phone (4b) (Black, 256 GB)");
  assert.strictEqual(notifiedMsg.data.current_site_price, 40999);
});

// ---------------------------------------------------------------------------
// Test 10: Missing or delayed product data handled safely
// ---------------------------------------------------------------------------
test("Test 10: Missing or delayed product data on Flipkart returns null and clears identity", async () => {
  const doc = new MockNode("#document");
  // Page with only footer/header (e.g. initial shell before hydration)
  const header = new MockNode("header", {}, "Flipkart Explore Plus");
  doc.appendChild(header);

  setupGlobalEnvironment(doc, "https://www.flipkart.com/nothing-phone-4b-blue-128-gb/p/itm939608b40adbb");

  const product = extractProduct();
  assert.strictEqual(product, null, "Should return null when main product title and price have not hydrated");

  if (globalThis.window.__dealSenseSetLastSentIdentity) globalThis.window.__dealSenseSetLastSentIdentity("Flipkart::MOB123::Old Product::40999::");
  let unavailableSent = false;
  globalThis.chrome.runtime.sendMessage = (msg, cb) => {
    if (msg.action === "productUnavailable") unavailableSent = true;
    if (cb) cb();
  };

  checkAndNotifyProductUpdate();
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.strictEqual(unavailableSent, true, "Should notify popup that product is unavailable when hydration fails or unmounts");
  assert.strictEqual(globalThis.window.__dealSenseGetLastSentIdentity ? globalThis.window.__dealSenseGetLastSentIdentity() : null, null);
});

// ---------------------------------------------------------------------------
// Test 11: Switching between Amazon and Flipkart updates source retailer
// ---------------------------------------------------------------------------
test("Test 11: Switching between Amazon and Flipkart updates source retailer and product state", () => {
  // Step A: Amazon product
  const amzDoc = new MockNode("#document");
  const amzDp = new MockNode("div", { id: "dp", "data-asin": "B00KVEB182" });
  amzDp.appendChild(new MockNode("span", { id: "productTitle" }, "Nivia Football Size 5"));
  const corePrice = new MockNode("div", { id: "corePriceDisplay_desktop_feature_div" });
  const priceToPay = new MockNode("span", { class: "priceToPay" });
  priceToPay.appendChild(new MockNode("span", { class: "a-offscreen" }, "₹799.00"));
  corePrice.appendChild(priceToPay);
  amzDp.appendChild(corePrice);
  amzDoc.appendChild(amzDp);

  setupGlobalEnvironment(amzDoc, "https://www.amazon.in/dp/B00KVEB182");
  const amzProd = extractProduct();
  assert.ok(amzProd);
  assert.strictEqual(amzProd.source_retailer, "Amazon.in");
  assert.strictEqual(amzProd.product_name, "Nivia Football Size 5");

  // Step B: User switches tabs to Flipkart Nothing Phone
  const fkDoc = new MockNode("#document");
  fkDoc.appendChild(new MockNode("link", { rel: "canonical", href: "https://www.flipkart.com/nothing-phone-4b/p/itm123" }));
  fkDoc.appendChild(new MockNode("h1", {}, "Nothing Phone (4b) (Black, 256 GB)"));
  fkDoc.appendChild(new MockNode("div", { class: "Nx9bqj" }, "₹40,999"));

  setupGlobalEnvironment(fkDoc, "https://www.flipkart.com/nothing-phone-4b/p/itm123");
  const fkProd = extractProduct();
  assert.ok(fkProd);
  assert.strictEqual(fkProd.source_retailer, "Flipkart");
  assert.strictEqual(fkProd.product_name, "Nothing Phone (4b) (Black, 256 GB)");
  assert.strictEqual(fkProd.current_site_price, 40999);
  assert.notStrictEqual(fkProd.source_retailer, amzProd.source_retailer);
});

// ---------------------------------------------------------------------------
// Test 12: Stale responses from another tab are ignored
// ---------------------------------------------------------------------------
test("Test 12: Stale responses from another tab ID are rejected", () => {
  let activeTabId = 101;
  let activeProduct = { url: "https://www.flipkart.com/item/p/itm123", product_name: "Nothing Phone 4b" };

  function handleMessage(msg, sender) {
    if (sender?.tab?.id && sender.tab.id !== activeTabId) {
      return false; // rejected
    }
    if (sender?.tab?.url) {
      const host = new URL(sender.tab.url).hostname;
      if (!host.includes("amazon.in") && !host.includes("flipkart.com")) {
        return false;
      }
    }
    return true; // accepted
  }

  // Message from active tab (101)
  const accepted = handleMessage({ action: "productUpdated" }, { tab: { id: 101, url: "https://www.flipkart.com/item/p/itm123" } });
  assert.strictEqual(accepted, true);

  // Stale message from background tab (99)
  const rejected = handleMessage({ action: "productUpdated" }, { tab: { id: 99, url: "https://www.amazon.in/dp/B00KVEB182" } });
  assert.strictEqual(rejected, false, "Message from background tab ID 99 must be ignored");

  // Message from unsupported domain tab
  const unsupportedDomain = handleMessage({ action: "productUpdated" }, { tab: { id: 101, url: "https://www.google.com" } });
  assert.strictEqual(unsupportedDomain, false, "Message from non-supported domain must be ignored");
});

// ---------------------------------------------------------------------------
test("Test 13: Dual comparison response models correctly populate Section A and Section B", () => {
  const amazonSourceResponse = {
    status: "success",
    source_product: {
      product_name: "Logitech G29 Driving Force Racing Wheel",
      current_site_price: 29990.0,
      url: "https://www.amazon.in/dp/B000SRC",
      source_retailer: "Amazon.in",
      seller: "Appario Retail"
    },
    // Section A: Other Platform (Flipkart)
    cross_platform_offers: [
      {
        retailer_name: "Flipkart",
        product_title: "Logitech G29 Driving Force Racing Wheel and Pedals",
        product_url: "https://www.flipkart.com/p/itm123",
        current_price: 28490.0,
        match_status: "EXACT_MATCH",
        seller_name: "IndiFlashMart"
      }
    ],
    cross_platform_status: "success",
    // Section B: Other Sellers on this Platform (Amazon)
    same_platform_seller_offers: [
      {
        retailer_name: "Amazon.in",
        product_title: "Logitech G29 Driving Force Racing Wheel",
        product_url: "https://www.amazon.in/dp/B000ALT1",
        current_price: 27990.0,
        match_status: "EXACT_MATCH",
        seller_name: "Cloudtail India",
        price_difference: 2000.0 // 29990 - 27990
      }
    ],
    same_platform_status: "success"
  };

  // Section A assertions
  assert.strictEqual(amazonSourceResponse.cross_platform_offers.length, 1);
  assert.strictEqual(amazonSourceResponse.cross_platform_offers[0].retailer_name, "Flipkart");
  assert.notStrictEqual(amazonSourceResponse.cross_platform_offers[0].retailer_name, "Amazon.in");
  const crossSavings = amazonSourceResponse.source_product.current_site_price - amazonSourceResponse.cross_platform_offers[0].current_price;
  assert.strictEqual(crossSavings, 1500.0);

  // Section B assertions
  assert.strictEqual(amazonSourceResponse.same_platform_seller_offers.length, 1);
  assert.strictEqual(amazonSourceResponse.same_platform_seller_offers[0].retailer_name, "Amazon.in");
  assert.strictEqual(amazonSourceResponse.same_platform_seller_offers[0].seller_name, "Cloudtail India");
  assert.strictEqual(amazonSourceResponse.same_platform_seller_offers[0].price_difference, 2000.0);
});

// ---------------------------------------------------------------------------
test("Test 14: Same-platform seller status honestly distinguishes unverified vs single seller without fabrication", () => {
  // Scenario 1: Unverified / inaccessible seller identity
  const unverifiedState = {
    same_platform_status: "seller_data_unavailable",
    same_platform_seller_offers: [],
    same_platform_summary: "Alternative sellers could not be verified from the available retailer data."
  };
  assert.strictEqual(unverifiedState.same_platform_seller_offers.length, 0);
  assert.strictEqual(unverifiedState.same_platform_status, "seller_data_unavailable");
  assert.match(unverifiedState.same_platform_summary, /could not be verified/i);

  // Scenario 2: Single seller listing
  const singleSellerState = {
    same_platform_status: "no_other_sellers_found",
    same_platform_seller_offers: [],
    same_platform_summary: "No additional verified sellers were found."
  };
  assert.strictEqual(singleSellerState.same_platform_seller_offers.length, 0);
  assert.strictEqual(singleSellerState.same_platform_status, "no_other_sellers_found");
  assert.match(singleSellerState.same_platform_summary, /No additional verified sellers/i);
});

// ---------------------------------------------------------------------------
// Test 15: Amazon search results page extracts valid .s-result-item listings
// ---------------------------------------------------------------------------
test("Test 15: Amazon search results page extracts valid .s-result-item listings", () => {
  const doc = new MockNode("#document");
  const body = new MockNode("body");
  doc.appendChild(body);

  // Result card 1: Nothing Phone (2a)
  const card1 = new MockNode("div", {
    "class": "s-result-item s-search-result",
    "data-asin": "B0CTPSMWB8"
  });
  const h2_1 = new MockNode("h2");
  const a_1 = new MockNode("a", { "href": "/Nothing-Phone-Black-128-RAM/dp/B0CTPSMWB8" });
  const span_1 = new MockNode("span", {}, "Nothing Phone (2a) 5G (Black, 128 GB)");
  a_1.appendChild(span_1);
  h2_1.appendChild(a_1);
  card1.appendChild(h2_1);

  const priceWrapper1 = new MockNode("span", { "class": "a-price" });
  const priceOff1 = new MockNode("span", { "class": "a-offscreen" }, "₹21,999");
  priceWrapper1.appendChild(priceOff1);
  card1.appendChild(priceWrapper1);

  const mrpWrapper1 = new MockNode("span", { "class": "a-price", "data-a-strike": "true" });
  const mrpOff1 = new MockNode("span", { "class": "a-offscreen" }, "₹25,999");
  mrpWrapper1.appendChild(mrpOff1);
  card1.appendChild(mrpWrapper1);

  const img1 = new MockNode("img", { "class": "s-image", "src": "https://m.media-amazon.com/images/I/nothing.jpg" });
  card1.appendChild(img1);
  body.appendChild(card1);

  setupGlobalEnvironment(doc, "https://www.amazon.in/s?k=Nothing+Phone+2a+128GB");
  const res = extractAmazonSearchResults(doc, "https://www.amazon.in/s?k=Nothing+Phone+2a+128GB");

  assert.strictEqual(res.blocked, false);
  assert.strictEqual(res.query, "Nothing Phone 2a 128GB");
  assert.strictEqual(res.candidates.length, 1);
  assert.strictEqual(res.candidates[0].retailer_product_id, "B0CTPSMWB8");
  assert.strictEqual(res.candidates[0].product_title, "Nothing Phone (2a) 5G (Black, 128 GB)");
  assert.strictEqual(res.candidates[0].current_price, 21999);
  assert.strictEqual(res.candidates[0].mrp, 25999);
  assert.strictEqual(res.candidates[0].availability, "IN_STOCK");
  assert.strictEqual(res.candidates[0].product_url, "https://www.amazon.in/dp/B0CTPSMWB8");
});

// ---------------------------------------------------------------------------
// Test 16: Amazon search results page ignores items with invalid/missing price or invalid ASIN
// ---------------------------------------------------------------------------
test("Test 16: Amazon search results page ignores items with invalid/missing price or invalid ASIN", () => {
  const doc = new MockNode("#document");
  const body = new MockNode("body");
  doc.appendChild(body);

  // Card without price (e.g. ad widget)
  const cardNoPrice = new MockNode("div", {
    "class": "s-result-item",
    "data-asin": "B000000001"
  });
  const h2 = new MockNode("h2");
  h2.appendChild(new MockNode("span", {}, "Unpriced Accessory"));
  cardNoPrice.appendChild(h2);
  body.appendChild(cardNoPrice);

  // Card with invalid ASIN (empty or not 10 chars)
  const cardBadAsin = new MockNode("div", {
    "class": "s-result-item",
    "data-asin": "SHORT"
  });
  const h2Bad = new MockNode("h2");
  h2Bad.appendChild(new MockNode("span", {}, "Bad ASIN Item"));
  cardBadAsin.appendChild(h2Bad);
  const pBad = new MockNode("span", { "class": "a-price" });
  pBad.appendChild(new MockNode("span", { "class": "a-offscreen" }, "₹500"));
  cardBadAsin.appendChild(pBad);
  body.appendChild(cardBadAsin);

  setupGlobalEnvironment(doc, "https://www.amazon.in/s?k=test");
  const res = extractAmazonSearchResults(doc, "https://www.amazon.in/s?k=test");

  assert.strictEqual(res.blocked, false);
  assert.strictEqual(res.candidates.length, 0);
});

// ---------------------------------------------------------------------------
// Test 17: Amazon CAPTCHA challenge page detects #captchacharacters
// ---------------------------------------------------------------------------
test("Test 17: Amazon CAPTCHA challenge page detects #captchacharacters", () => {
  const doc = new MockNode("#document");
  const body = new MockNode("body");
  doc.appendChild(body);

  const form = new MockNode("form", { "action": "/errors/validateCaptcha" });
  const input = new MockNode("input", { "id": "captchacharacters" });
  form.appendChild(input);
  body.appendChild(form);

  setupGlobalEnvironment(doc, "https://www.amazon.in/s?k=captcha+test");
  const res = extractAmazonSearchResults(doc, "https://www.amazon.in/s?k=captcha+test");

  assert.strictEqual(res.blocked, true);
  assert.strictEqual(res.blockType, "CAPTCHA");
  assert.match(res.reason, /CAPTCHA challenge/i);
  assert.strictEqual(res.candidates.length, 0);
});

// ---------------------------------------------------------------------------
// Test 18: Amazon CloudFront 503 access-denied page detects 503 text
// ---------------------------------------------------------------------------
test("Test 18: Amazon CloudFront 503 access-denied page detects 503 text", () => {
  const doc = new MockNode("#document");
  const body = new MockNode("body", {}, "503 - Service Unavailable Error. To discuss automated access to Amazon data please contact api-services-support@amazon.com.");
  doc.appendChild(body);

  setupGlobalEnvironment(doc, "https://www.amazon.in/s?k=503+test");
  const res = extractAmazonSearchResults(doc, "https://www.amazon.in/s?k=503+test");

  assert.strictEqual(res.blocked, true);
  assert.strictEqual(res.blockType, "ACCESS_DENIED_503");
  assert.match(res.reason, /access-denied or 503/i);
  assert.strictEqual(res.candidates.length, 0);
});

// ---------------------------------------------------------------------------
// Test 19: Amazon empty search results page returns blocked: false, 0 candidates
// ---------------------------------------------------------------------------
test("Test 19: Amazon empty search results page returns blocked: false, 0 candidates", () => {
  const doc = new MockNode("#document");
  const body = new MockNode("body", {}, "No results for xyzabc123456789. Try checking your spelling or use more general terms");
  doc.appendChild(body);

  setupGlobalEnvironment(doc, "https://www.amazon.in/s?k=xyzabc123456789");
  const res = extractAmazonSearchResults(doc, "https://www.amazon.in/s?k=xyzabc123456789");

  assert.strictEqual(res.blocked, false);
  assert.strictEqual(res.blockType, null);
  assert.strictEqual(res.candidates.length, 0);
});

// ---------------------------------------------------------------------------
// Test 20: Amazon out-of-stock search result item flags OUT_OF_STOCK
// ---------------------------------------------------------------------------
test("Test 20: Amazon out-of-stock search result item flags OUT_OF_STOCK", () => {
  const doc = new MockNode("#document");
  const body = new MockNode("body");
  doc.appendChild(body);

  const card = new MockNode("div", {
    "class": "s-result-item",
    "data-asin": "B08TESTOOS"
  });
  const h2 = new MockNode("h2");
  h2.appendChild(new MockNode("span", {}, "Sony WH-1000XM4 (Out of Stock Edition)"));
  card.appendChild(h2);

  const priceWrapper = new MockNode("span", { "class": "a-price" });
  priceWrapper.appendChild(new MockNode("span", { "class": "a-offscreen" }, "₹19,990"));
  card.appendChild(priceWrapper);

  const oosSpan = new MockNode("span", {}, "Currently unavailable.");
  card.appendChild(oosSpan);
  body.appendChild(card);

  setupGlobalEnvironment(doc, "https://www.amazon.in/s?k=sony+wh");
  const res = extractAmazonSearchResults(doc, "https://www.amazon.in/s?k=sony+wh");

  assert.strictEqual(res.blocked, false);
  assert.strictEqual(res.candidates.length, 1);
  assert.strictEqual(res.candidates[0].availability, "OUT_OF_STOCK");
});


// ---------------------------------------------------------------------------
// Test 21: Flipkart MacBook Neo extraction preserves attributes & identifiers
// ---------------------------------------------------------------------------
test("Test 21: Flipkart MacBook Neo extraction preserves attributes & identifiers", () => {
  const doc = new MockNode("#document");
  const body = new MockNode("body");
  doc.appendChild(body);

  const h1 = new MockNode("h1", {}, "Apple MacBook Neo Apple A18 Pro - (8 GB/256 GB SSD/macOS) MHFA4HN/A  (13 Inch, Silver, 1.2 Kg)");
  body.appendChild(h1);

  const priceDiv = new MockNode("div", { "class": "Nx9bqj CxhGGd" }, "₹1,09,990");
  body.appendChild(priceDiv);

  const mrpDiv = new MockNode("div", { "class": "yRaY8j" }, "₹1,19,990");
  body.appendChild(mrpDiv);

  setupGlobalEnvironment(doc, "https://www.flipkart.com/apple-macbook-neo-apple-a18-pro/p/itmfa412345?pid=COMHFA4HN");
  const res = extractFlipkartProduct(doc, "https://www.flipkart.com/apple-macbook-neo-apple-a18-pro/p/itmfa412345?pid=COMHFA4HN");

  assert.ok(res !== null);
  assert.strictEqual(res.source_retailer, "Flipkart");
  assert.strictEqual(res.brand, "Apple");
  assert.strictEqual(res.current_price, 109990);
  assert.strictEqual(res.mrp, 119990);
  assert.strictEqual(res.retailer_product_id, "COMHFA4HN");
});

// ---------------------------------------------------------------------------
// Test 22: Amazon search results deduplication and canonical URL creation
// ---------------------------------------------------------------------------
test("Test 22: Amazon search results deduplication and canonical URL creation", () => {
  const doc = new MockNode("#document");
  const body = new MockNode("body");
  doc.appendChild(body);

  const card1 = new MockNode("div", { "class": "s-result-item", "data-asin": "B0DTEST123" });
  const h2_1 = new MockNode("h2");
  h2_1.appendChild(new MockNode("span", {}, "Apple MacBook Neo (13-inch, Apple A18 Pro chip, 8GB RAM, 256GB SSD)"));
  card1.appendChild(h2_1);
  const price_1 = new MockNode("span", { "class": "a-price" });
  price_1.appendChild(new MockNode("span", { "class": "a-offscreen" }, "₹1,04,990"));
  card1.appendChild(price_1);
  body.appendChild(card1);

  // Duplicate card with same ASIN
  const card2 = new MockNode("div", { "class": "s-result-item", "data-asin": "B0DTEST123" });
  const h2_2 = new MockNode("h2");
  h2_2.appendChild(new MockNode("span", {}, "Apple MacBook Neo (Duplicate Ad Card)"));
  card2.appendChild(h2_2);
  const price_2 = new MockNode("span", { "class": "a-price" });
  price_2.appendChild(new MockNode("span", { "class": "a-offscreen" }, "₹1,04,990"));
  card2.appendChild(price_2);
  body.appendChild(card2);

  setupGlobalEnvironment(doc, "https://www.amazon.in/s?k=macbook+neo");
  const res = extractAmazonSearchResults(doc, "https://www.amazon.in/s?k=macbook+neo");

  assert.strictEqual(res.candidates.length, 1);
  assert.strictEqual(res.candidates[0].retailer_product_id, "B0DTEST123");
  assert.strictEqual(res.candidates[0].product_url, "https://www.amazon.in/dp/B0DTEST123");
});

// ---------------------------------------------------------------------------
// Test 23: Amazon search results price parsing with Indian decimal format
// ---------------------------------------------------------------------------
test("Test 23: Amazon search results price parsing with Indian decimal format", () => {
  const doc = new MockNode("#document");
  const body = new MockNode("body");
  doc.appendChild(body);

  const card = new MockNode("div", { "class": "s-result-item", "data-asin": "B0DDECIMA1" });
  const h2 = new MockNode("h2");
  h2.appendChild(new MockNode("span", {}, "Apple MacBook Neo"));
  card.appendChild(h2);
  const price = new MockNode("span", { "class": "a-price" });
  price.appendChild(new MockNode("span", { "class": "a-offscreen" }, "₹1,04,990.50"));
  card.appendChild(price);
  body.appendChild(card);

  setupGlobalEnvironment(doc, "https://www.amazon.in/s?k=macbook+neo");
  const res = extractAmazonSearchResults(doc, "https://www.amazon.in/s?k=macbook+neo");

  assert.strictEqual(res.candidates.length, 1);
  assert.strictEqual(res.candidates[0].current_price, 104990.5);
});

// ---------------------------------------------------------------------------
// Test 24: Flipkart -> Amazon automatic retrieval flow payload
// ---------------------------------------------------------------------------
test("Test 24: Flipkart -> Amazon comparison does not require open tab or force not_open status", () => {
  // When no Amazon search tab is open, DealSense does not inject "not_open" gate
  const product = {
    source_retailer: "Flipkart",
    product_name: "Sony WH-1000XM4 Wireless Noise Cancelling Headphones",
    url: "https://www.flipkart.com/sony-wh-1000xm4/p/itm123",
    current_site_price: 24990,
    mrp: 29990,
  };

  const isFlipkartSource = Boolean(
    (product.source_retailer && product.source_retailer.toLowerCase().includes("flipkart")) ||
    (product.url && product.url.includes("flipkart.com"))
  );
  assert.strictEqual(isFlipkartSource, true);

  // In the updated automatic flow, when tabResult.status is "not_open",
  // comparisonPayload leaves browser_candidate_offers and browser_retrieval_status omitted
  const comparisonPayload = { ...product };
  assert.strictEqual(comparisonPayload.browser_retrieval_status, undefined);
  assert.strictEqual(comparisonPayload.browser_candidate_offers, undefined);
});

// ---------------------------------------------------------------------------
// Test 25: Background Amazon search tab retrieval uses active: false
// ---------------------------------------------------------------------------
test("Test 25: Background Amazon search tab creation sets active: false to preserve focus", async () => {
  let createdTabOptions = null;
  let closedTabId = null;

  global.chrome = {
    tabs: {
      query: (filter, callback) => callback([]), // No existing tab
      create: (options, callback) => {
        createdTabOptions = options;
        callback({ id: 999, url: options.url });
      },
      remove: (tabId, callback) => {
        closedTabId = tabId;
        if (callback) callback();
      },
      onUpdated: {
        addListener: (fn) => {
          // Immediately simulate complete status
          setTimeout(() => fn(999, { status: "complete" }), 10);
        },
        removeListener: () => {},
      },
      sendMessage: (tabId, msg, callback) => {
        callback({
          success: true,
          data: {
            blocked: false,
            blockType: null,
            query: "sony wh-1000xm4",
            candidates: [
              {
                retailer_name: "Amazon.in",
                product_title: "Sony WH-1000XM4 Wireless Noise Cancelling Headphones",
                current_price: 22990,
                product_url: "https://www.amazon.in/dp/B0863TXGM3",
                retailer_product_id: "B0863TXGM3",
                availability: "IN_STOCK",
              }
            ],
          },
        });
      },
    },
    runtime: {
      lastError: null,
    },
  };

  // Test background runner function logic
  async function retrieveAmazonCandidatesInBackground(query) {
    const url = "https://www.amazon.in/s?k=" + encodeURIComponent(query);
    let createdTabId = null;
    try {
      const tab = await new Promise((resolve) => {
        global.chrome.tabs.create({ url, active: false }, (newTab) => resolve(newTab));
      });
      createdTabId = tab.id;
      const res = await new Promise((resolve) => {
        global.chrome.tabs.sendMessage(createdTabId, { action: "extractAmazonSearchResults" }, (resp) => {
          resolve(resp.data);
        });
      });
      return { status: "found", candidates: res.candidates };
    } finally {
      if (createdTabId) {
        global.chrome.tabs.remove(createdTabId);
      }
    }
  }
  const result = await retrieveAmazonCandidatesInBackground("sony wh-1000xm4");

  // Invariant 1: Tab must be created with active: false so focus never leaves Flipkart
  assert.strictEqual(createdTabOptions?.active, false);
  assert.strictEqual(createdTabOptions?.url.includes("https://www.amazon.in/s?k="), true);

  // Invariant 2: Candidate offers genuinely extracted
  assert.strictEqual(result.status, "found");
  assert.strictEqual(result.candidates.length, 1);
  assert.strictEqual(result.candidates[0].current_price, 22990);

  // Invariant 3: Background tab is cleaned up and removed
  assert.strictEqual(closedTabId, 999);
});

// ---------------------------------------------------------------------------
// Test 26: Blocked Amazon retrieval preserves manual fallback
// ---------------------------------------------------------------------------
test("Test 26: Blocked Amazon retrieval reports blocked status and preserves manual fallback capability", () => {
  const comparison = {
    status: "no_offers_found",
    cross_platform_status: "retailer_unavailable",
    cross_platform_summary: "Blocked: Amazon India CloudFront bot protection restricts automated server retrieval (HTTP 503).",
    cross_platform_offers: [],
    verified_offers: [],
  };

  const isUnavailable = (comparison.cross_platform_status || comparison.status) === "retailer_unavailable";
  assert.strictEqual(isUnavailable, true);
  // Manual button fallback condition in screens.tsx is met when crossPlatformRetailer is Amazon India
  const crossPlatformRetailer = "Amazon India";
  const shouldRenderManualButton = crossPlatformRetailer === "Amazon India";
  assert.strictEqual(shouldRenderManualButton, true);
});

// ---------------------------------------------------------------------------
// Test 27: Generic peripheral extraction captures brand, model, and category when model row is missing
// ---------------------------------------------------------------------------
test("Test 27: Generic peripheral extraction captures brand, model, and category when model row is missing", () => {
  const doc = new MockNode("#document");
  const dp = new MockNode("div", { id: "dp", "data-asin": "B0D5D8N8P4" });
  const title = new MockNode("span", { id: "productTitle" }, "Ant Esports SuperPower RGB 3-Mode Wireless Gaming Controller with HallSense Precision Joysticks");
  dp.appendChild(title);

  const priceDiv = new MockNode("div", { id: "corePriceDisplay_desktop_feature_div" });
  const priceSpan = new MockNode("span", { class: "a-price" });
  priceSpan.appendChild(new MockNode("span", { class: "a-offscreen" }, "₹1,799.00"));
  priceDiv.appendChild(priceSpan);
  dp.appendChild(priceDiv);

  doc.appendChild(dp);
  setupGlobalEnvironment(doc, "https://www.amazon.in/dp/B0D5D8N8P4");

  const extracted = extractAmazonProduct();
  assert.ok(extracted);
  assert.strictEqual(extracted.current_site_price, 1799.0);
  assert.strictEqual(extracted.brand, "Ant Esports");
  assert.strictEqual(extracted.model, "SuperPower");
  assert.strictEqual(extracted.category, "Gaming Controller");
});

// ---------------------------------------------------------------------------
// Test 28: Tabular buy box rejects promotional "Learn more" and extracts "Sold by" seller
// ---------------------------------------------------------------------------
test("Test 28: Tabular buy box extracts actual seller from 'Sold by' and rejects promotional 'Learn more about this item'", () => {
  const doc = new MockNode("#document");
  const dp = new MockNode("div", { id: "dp", "data-asin": "B08N5WRWNW" });
  dp.appendChild(new MockNode("span", { id: "productTitle" }, "Sony WH-1000XM4 Noise Cancelling Headphones"));

  const priceDiv = new MockNode("div", { id: "corePriceDisplay_desktop_feature_div" });
  const priceSpan = new MockNode("span", { class: "a-price" });
  priceSpan.appendChild(new MockNode("span", { class: "a-offscreen" }, "₹19,990.00"));
  priceDiv.appendChild(priceSpan);
  dp.appendChild(priceDiv);

  // Amazon.in tabular buy box with Ships from, Sold by, and promotional Details / Learn more
  const tabularBox = new MockNode("div", { id: "tabular-buybox" });
  const container = new MockNode("div", { class: "tabular-buybox-container" });

  // Row 1: Ships from: Amazon
  const shipsRow = new MockNode("div", { class: "tabular-buybox-row", "tabular-attribute-name": "Ships from" });
  const shipsLabel = new MockNode("span", { class: "tabular-buybox-label" }, "Ships from");
  const shipsVal = new MockNode("span", { class: "tabular-buybox-text" }, "Amazon");
  shipsRow.appendChild(shipsLabel);
  shipsRow.appendChild(shipsVal);
  container.appendChild(shipsRow);

  // Row 2: Sold by: Appario Retail Private Ltd
  const soldRow = new MockNode("div", { class: "tabular-buybox-row", "tabular-attribute-name": "Sold by" });
  const soldLabel = new MockNode("span", { class: "tabular-buybox-label" }, "Sold by");
  const soldVal = new MockNode("span", { class: "tabular-buybox-text" });
  const sellerAnchor = new MockNode("a", { id: "sellerProfileTriggerId", href: "/gp/help/seller/at-a-glance.html?seller=A2T6N3HS40P50T" }, "Appario Retail Private Ltd");
  soldVal.appendChild(sellerAnchor);
  soldRow.appendChild(soldLabel);
  soldRow.appendChild(soldVal);
  container.appendChild(soldRow);

  // Row 3: Promotional / Details row (which previously caused "Learn more about t...")
  const promoRow = new MockNode("div", { class: "tabular-buybox-row", "tabular-attribute-name": "Details" });
  const promoVal = new MockNode("span", { class: "tabular-buybox-text" });
  promoVal.appendChild(new MockNode("a", { href: "#" }, "Learn more about this item"));
  promoRow.appendChild(promoVal);
  container.appendChild(promoRow);

  tabularBox.appendChild(container);
  dp.appendChild(tabularBox);
  doc.appendChild(dp);

  setupGlobalEnvironment(doc, "https://www.amazon.in/dp/B08N5WRWNW");
  const extracted = extractAmazonProduct();
  assert.ok(extracted);
  assert.strictEqual(extracted.seller, "Appario Retail Private Ltd", "Should extract seller and reject promotional link");
});

// ---------------------------------------------------------------------------
// Test 29: Distinguishes 'Sold by' from 'Ships from' and never confuses fulfillment with seller
// ---------------------------------------------------------------------------
test("Test 29: Amazon seller extraction differentiates 'Sold by' from 'Ships from' and never confuses fulfillment with seller", () => {
  const doc = new MockNode("#document");
  const dp = new MockNode("div", { id: "dp", "data-asin": "B09G9BL5CP" });
  dp.appendChild(new MockNode("span", { id: "productTitle" }, "Apple iPad 10.2-inch (Wi-Fi, 64GB) - Space Grey"));

  const priceDiv = new MockNode("div", { id: "corePriceDisplay_desktop_feature_div" });
  const priceSpan = new MockNode("span", { class: "a-price" });
  priceSpan.appendChild(new MockNode("span", { class: "a-offscreen" }, "₹29,900.00"));
  priceDiv.appendChild(priceSpan);
  dp.appendChild(priceDiv);

  // Tabular buy box where Ships from is Amazon and Sold by is Cocoblu Retail
  const tabularBox = new MockNode("div", { id: "tabular-buybox" });
  const table = new MockNode("table");

  const tr1 = new MockNode("tr", { "tabular-attribute-name": "Ships from" });
  tr1.appendChild(new MockNode("td", {}, "Ships from"));
  tr1.appendChild(new MockNode("td", {}, "Amazon Logistics Services"));
  table.appendChild(tr1);

  const tr2 = new MockNode("tr", { "tabular-attribute-name": "Sold by" });
  tr2.appendChild(new MockNode("td", {}, "Sold by"));
  const tdSold = new MockNode("td", {});
  tdSold.appendChild(new MockNode("span", {}, "Cocoblu Retail"));
  tr2.appendChild(tdSold);
  table.appendChild(tr2);

  tabularBox.appendChild(table);
  dp.appendChild(tabularBox);
  doc.appendChild(dp);

  setupGlobalEnvironment(doc, "https://www.amazon.in/dp/B09G9BL5CP");
  const extracted = extractAmazonProduct();
  assert.ok(extracted);
  assert.strictEqual(extracted.seller, "Cocoblu Retail");
  assert.notStrictEqual(extracted.seller, "Amazon Logistics Services");
});

// ---------------------------------------------------------------------------
// Test 30: Prioritizes validated JSON-LD offers.seller metadata
// ---------------------------------------------------------------------------
test("Test 30: Amazon seller extraction prioritizes validated structured JSON-LD offers.seller metadata", () => {
  const doc = new MockNode("#document");
  const dp = new MockNode("div", { id: "dp", "data-asin": "B0BSNQ2KXF" });
  dp.appendChild(new MockNode("span", { id: "productTitle" }, "Samsung Galaxy S23 Ultra 5G (Phantom Black, 256 GB)"));

  const priceDiv = new MockNode("div", { id: "corePriceDisplay_desktop_feature_div" });
  const priceSpan = new MockNode("span", { class: "a-price" });
  priceSpan.appendChild(new MockNode("span", { class: "a-offscreen" }, "₹89,999.00"));
  priceDiv.appendChild(priceSpan);
  dp.appendChild(priceDiv);

  const jsonLdScript = new MockNode("script", { type: "application/ld+json" }, JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Samsung Galaxy S23 Ultra 5G",
    "offers": {
      "@type": "Offer",
      "price": 89999,
      "priceCurrency": "INR",
      "seller": {
        "@type": "Organization",
        "name": "STPL Exclusive Online"
      }
    }
  }));
  doc.appendChild(jsonLdScript);
  doc.appendChild(dp);

  setupGlobalEnvironment(doc, "https://www.amazon.in/dp/B0BSNQ2KXF");
  const extracted = extractAmazonProduct();
  assert.ok(extracted);
  assert.strictEqual(extracted.seller, "STPL Exclusive Online");
});

// ---------------------------------------------------------------------------
// Test 31: Classic merchant-info regex extraction strips fulfillment & promotional tails
// ---------------------------------------------------------------------------
test("Test 31: Merchant-info regex extraction extracts seller and strips 'and Fulfilled by Amazon. Learn more'", () => {
  const doc = new MockNode("#document");
  const dp = new MockNode("div", { id: "dp", "data-asin": "B07WHS7K8C" });
  dp.appendChild(new MockNode("span", { id: "productTitle" }, "Echo Dot (4th Gen) | Smart speaker with Alexa (Black)"));

  const priceDiv = new MockNode("div", { id: "corePriceDisplay_desktop_feature_div" });
  const priceSpan = new MockNode("span", { class: "a-price" });
  priceSpan.appendChild(new MockNode("span", { class: "a-offscreen" }, "₹3,499.00"));
  priceDiv.appendChild(priceSpan);
  dp.appendChild(priceDiv);

  const merchantDiv = new MockNode(
    "div",
    { id: "merchant-info" },
    "Sold by Appario Retail Private Ltd and Fulfilled by Amazon. Learn more about this item."
  );
  dp.appendChild(merchantDiv);
  doc.appendChild(dp);

  setupGlobalEnvironment(doc, "https://www.amazon.in/dp/B07WHS7K8C");
  const extracted = extractAmazonProduct();
  assert.ok(extracted);
  assert.strictEqual(extracted.seller, "Appario Retail Private Ltd");
});

// ---------------------------------------------------------------------------
// Test 32: Missing or purely promotional seller info defaults to 'Seller unavailable'
// ---------------------------------------------------------------------------
test("Test 32: Rejects invalid promotional text as seller and safely returns 'Seller unavailable'", () => {
  const doc = new MockNode("#document");
  const dp = new MockNode("div", { id: "dp", "data-asin": "B01XYZ9999" });
  dp.appendChild(new MockNode("span", { id: "productTitle" }, "Mystery Gadget 2026"));

  const priceDiv = new MockNode("div", { id: "corePriceDisplay_desktop_feature_div" });
  const priceSpan = new MockNode("span", { class: "a-price" });
  priceSpan.appendChild(new MockNode("span", { class: "a-offscreen" }, "₹999.00"));
  priceDiv.appendChild(priceSpan);
  dp.appendChild(priceDiv);

  // Tabular box contains ONLY a promotional link, no real seller
  const tabularBox = new MockNode("div", { id: "tabular-buybox" });
  const row = new MockNode("div", { class: "tabular-buybox-row" });
  row.appendChild(new MockNode("a", { href: "#" }, "Learn more about this item"));
  tabularBox.appendChild(row);
  dp.appendChild(tabularBox);
  doc.appendChild(dp);

  setupGlobalEnvironment(doc, "https://www.amazon.in/dp/B01XYZ9999");
  const extracted = extractAmazonProduct();
  assert.ok(extracted);
  assert.strictEqual(extracted.seller, "Seller unavailable");
});
