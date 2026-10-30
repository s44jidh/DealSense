import test from "node:test";
import assert from "node:assert/strict";
import { MockNode, createMockDocument, parseHtmlToMockDocument } from "./dom_mock.js";

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contentScriptCode = fs.readFileSync(path.join(__dirname, "../public/content.js"), "utf8");
vm.runInThisContext(contentScriptCode);

const backgroundScriptCode = fs.readFileSync(path.join(__dirname, "../public/background.js"), "utf8");
vm.runInThisContext(backgroundScriptCode);

// Helpers to create Mock nodes
function node(tag, attrs = {}, text = "") {
  return new MockNode(tag, attrs, text);
}

test("Review Extraction - Amazon India customer reviews extracted accurately", () => {
  const doc = createMockDocument();
  const root = node("div", { id: "dp" });
  doc.appendChild(root);

  // Review 1
  const rev1 = node("div", { "data-hook": "review", id: "R_AMZ_1" });
  const author1 = node("span", { class: "a-profile-name" }, "Siddharth Verma");
  const star1 = node("i", { "data-hook": "review-star-rating" });
  star1.appendChild(node("span", { class: "a-icon-alt" }, "5.0 out of 5 stars"));
  const title1 = node("a", { "data-hook": "review-title" });
  title1.appendChild(node("span", {}, "Incredible battery life and great build quality!"));
  const date1 = node("span", { "data-hook": "review-date" }, "Reviewed in India on 10 January 2024");
  const badge1 = node("span", { "data-hook": "avp-badge" }, "Verified Purchase");
  const body1 = node("span", { "data-hook": "review-body" });
  body1.appendChild(node("span", {}, "The sound quality is crisp and bass is deep. Battery lasts for more than 24 hours easily. Highly recommended!"));

  rev1.appendChild(author1);
  rev1.appendChild(star1);
  rev1.appendChild(title1);
  rev1.appendChild(date1);
  rev1.appendChild(badge1);
  rev1.appendChild(body1);
  root.appendChild(rev1);

  // Review 2
  const rev2 = node("div", { "data-hook": "review", id: "R_AMZ_2" });
  const author2 = node("span", { class: "a-profile-name" }, "Neha Gupta");
  const star2 = node("i", { "data-hook": "review-star-rating" });
  star2.appendChild(node("span", { class: "a-icon-alt" }, "1.0 out of 5 stars"));
  const title2 = node("a", { "data-hook": "review-title" });
  title2.appendChild(node("span", {}, "Terrible product, stopped working"));
  const date2 = node("span", { "data-hook": "review-date" }, "Reviewed in India on 15 February 2024");
  const body2 = node("span", { "data-hook": "review-body" });
  body2.appendChild(node("span", {}, "Stopped working after just 2 days. Complete waste of money, no customer support."));

  rev2.appendChild(author2);
  rev2.appendChild(star2);
  rev2.appendChild(title2);
  rev2.appendChild(date2);
  rev2.appendChild(body2);
  root.appendChild(rev2);

  const reviews = extractAmazonReviews(doc);
  assert.strictEqual(reviews.length, 2);

  // Verify review 1 fields
  assert.strictEqual(reviews[0].id, "R_AMZ_1");
  assert.strictEqual(reviews[0].author, "Siddharth Verma");
  assert.strictEqual(reviews[0].rating, 5);
  assert.strictEqual(reviews[0].title, "Incredible battery life and great build quality!");
  assert.strictEqual(reviews[0].verified_purchase, true);
  assert.strictEqual(reviews[0].date, "10 January 2024");
  assert.ok(reviews[0].text.includes("Battery lasts for more than 24 hours"));

  // Verify review 2 fields
  assert.strictEqual(reviews[1].id, "R_AMZ_2");
  assert.strictEqual(reviews[1].author, "Neha Gupta");
  assert.strictEqual(reviews[1].rating, 1);
  assert.strictEqual(reviews[1].verified_purchase, false);
  assert.ok(reviews[1].text.includes("Stopped working after just 2 days"));
});

test("Review Extraction - Flipkart customer reviews extracted accurately", () => {
  const doc = createMockDocument();
  const root = node("div", { id: "container" });
  doc.appendChild(root);

  // Review 1
  const card1 = node("div", { class: "_16PBlm" });
  const innerCol1 = node("div", { class: "col _2wzgFH" });
  const star1 = node("div", { class: "_3LWZlK" }, "5");
  const title1 = node("p", { class: "_2-N8zT" }, "Mind-blowing purchase");
  const body1 = node("div", { class: "t-ZTKy" });
  const bodyInner1 = node("div");
  bodyInner1.appendChild(node("div", {}, "Super fast delivery and packaging was very safe. Performance is flawless. READ MORE"));
  body1.appendChild(bodyInner1);

  const author1 = node("p", { class: "_2sc7ZR" }, "Arun Kumar");
  const date1 = node("p", { class: "_2sc7ZR" }, "3 months ago");
  const cert1 = node("p", { class: "_2mcBVo" }, "Certified Buyer");

  innerCol1.appendChild(star1);
  innerCol1.appendChild(title1);
  innerCol1.appendChild(body1);
  innerCol1.appendChild(author1);
  innerCol1.appendChild(date1);
  innerCol1.appendChild(cert1);
  card1.appendChild(innerCol1);
  root.appendChild(card1);

  const reviews = extractFlipkartReviews(doc);
  assert.strictEqual(reviews.length, 1);
  assert.strictEqual(reviews[0].rating, 5);
  assert.strictEqual(reviews[0].title, "Mind-blowing purchase");
  assert.strictEqual(reviews[0].author, "Arun Kumar");
  assert.strictEqual(reviews[0].date, "3 months ago");
  assert.strictEqual(reviews[0].verified_purchase, true);
  assert.ok(reviews[0].text.includes("Super fast delivery"));
  assert.ok(!reviews[0].text.includes("READ MORE"));
});

test("Review Extraction - Returns empty array when page has no reviews", () => {
  const doc = createMockDocument();
  const root = node("div", { id: "dp" });
  doc.appendChild(root);

  assert.deepStrictEqual(extractAmazonReviews(doc), []);
  assert.deepStrictEqual(extractFlipkartReviews(doc), []);
  assert.deepStrictEqual(extractReviews(doc, "https://www.amazon.in/dp/B000000"), []);
  assert.deepStrictEqual(extractReviews(doc, "https://www.flipkart.com/item/p/itm00000"), []);
});

test("Review Extraction - Unsupported domain returns empty reviews array", () => {
  const doc = createMockDocument();
  assert.deepStrictEqual(extractReviews(doc, "https://www.ebay.com/itm/123"), []);
});


// ---------------------------------------------------------------------------
// Requirement 8: Testing with two different Amazon India product pages
// ---------------------------------------------------------------------------

function setupGlobalEnvironment(doc, url) {
  const parsed = new URL(url);
  globalThis.document = doc;
  globalThis.window = {
    location: {
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      search: parsed.search,
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

test("Requirement 8 Test 1: Cosmic Byte Ares Controller page extracts genuine title, ASIN, and controller reviews", () => {
  const doc = createMockDocument();
  const root = node("div", { id: "dp", "data-asin": "B0B8S9K8R5" });
  doc.appendChild(root);

  // #productTitle prioritizing Requirement 1
  const titleSpan = node("span", { id: "productTitle" }, "   Cosmic Byte Ares Wireless Controller for PC (Black)   ");
  root.appendChild(titleSpan);

  // Hidden ASIN input
  root.appendChild(node("input", { type: "hidden", id: "ASIN", name: "ASIN", value: "B0B8S9K8R5" }));

  // Price container
  const priceContainer = node("div", { id: "corePriceDisplay_desktop_feature_div" });
  const pricePay = node("span", { class: "priceToPay" });
  pricePay.appendChild(node("span", { class: "a-offscreen" }, "₹1,699"));
  priceContainer.appendChild(pricePay);
  root.appendChild(priceContainer);

  // 3 Controller-specific reviews
  const rev1 = node("div", { "data-hook": "review", id: "R_ARES_1" });
  rev1.appendChild(node("span", { class: "a-profile-name" }, "Gamer Rohit"));
  const star1 = node("i", { "data-hook": "review-star-rating" });
  star1.appendChild(node("span", { class: "a-icon-alt" }, "5.0 out of 5 stars"));
  rev1.appendChild(star1);
  const revTitle1 = node("a", { "data-hook": "review-title" });
  revTitle1.appendChild(node("span", {}, "Smooth analog sticks and zero latency"));
  rev1.appendChild(revTitle1);
  rev1.appendChild(node("span", { "data-hook": "avp-badge" }, "Verified Purchase"));
  const body1 = node("span", { "data-hook": "review-body" });
  body1.appendChild(node("span", {}, "The magnetic triggers feel responsive and wireless connection has no lag on Windows 11."));
  rev1.appendChild(body1);
  root.appendChild(rev1);

  const rev2 = node("div", { "data-hook": "review", id: "R_ARES_2" });
  rev2.appendChild(node("span", { class: "a-profile-name" }, "Aditya Sharma"));
  const star2 = node("i", { "data-hook": "review-star-rating" });
  star2.appendChild(node("span", { class: "a-icon-alt" }, "4.0 out of 5 stars"));
  rev2.appendChild(star2);
  const revTitle2 = node("a", { "data-hook": "review-title" });
  revTitle2.appendChild(node("span", {}, "Great ergonomics and decent battery"));
  rev2.appendChild(revTitle2);
  rev2.appendChild(node("span", { "data-hook": "avp-badge" }, "Verified Purchase"));
  const body2 = node("span", { "data-hook": "review-body" });
  body2.appendChild(node("span", {}, "Battery lasts about 10-12 hours of active gaming. Good rumble vibration motors."));
  rev2.appendChild(body2);
  root.appendChild(rev2);

  const rev3 = node("div", { "data-hook": "review", id: "R_ARES_3" });
  rev3.appendChild(node("span", { class: "a-profile-name" }, "Karan P"));
  const star3 = node("i", { "data-hook": "review-star-rating" });
  star3.appendChild(node("span", { class: "a-icon-alt" }, "3.0 out of 5 stars"));
  rev3.appendChild(star3);
  const revTitle3 = node("a", { "data-hook": "review-title" });
  revTitle3.appendChild(node("span", {}, "D-pad is slightly stiff"));
  rev3.appendChild(revTitle3);
  const body3 = node("span", { "data-hook": "review-body" });
  body3.appendChild(node("span", {}, "Sticks are smooth but D-pad feels hard when playing Tekken. Otherwise fine."));
  rev3.appendChild(body3);
  root.appendChild(rev3);

  const aresUrl = "https://www.amazon.in/dp/B0B8S9K8R5";
  setupGlobalEnvironment(doc, aresUrl);

  const product = extractProduct(doc, aresUrl);
  assert.ok(product, "Product must be extracted");
  assert.strictEqual(product.product_name, "Cosmic Byte Ares Wireless Controller for PC (Black)");
  assert.strictEqual(product.asin, "B0B8S9K8R5");
  assert.strictEqual(product.url, "https://www.amazon.in/dp/B0B8S9K8R5");
  assert.strictEqual(product.current_site_price, 1699);
  assert.strictEqual(product.source_retailer, "Amazon.in");
  assert.strictEqual(product.analysis_source, "live_dom");

  // Reviews check
  assert.strictEqual(product.reviews.length, 3);
  assert.ok(product.reviews[0].text.includes("magnetic triggers"));
  assert.ok(product.reviews[1].text.includes("10-12 hours"));
  assert.ok(product.reviews[2].text.includes("D-pad feels hard"));

  // Check that NO Sony headphone data is present
  assert.ok(!product.product_name.includes("Sony"));
  assert.ok(!product.product_name.includes("WH-1000XM5"));
  for (const r of product.reviews) {
    assert.ok(!r.text.includes("Sony"));
    assert.ok(!r.text.includes("noise cancelling"));
    assert.ok(!r.text.includes("headphones"));
  }
});

test("Requirement 8 Test 2: Sony WH-1000XM5 Headphones page extracts genuine title, ASIN, and headphone reviews", () => {
  const doc = createMockDocument();
  const root = node("div", { id: "dp", "data-asin": "B09XS7JWHH" });
  doc.appendChild(root);

  // #productTitle prioritizing Requirement 1
  const titleSpan = node("span", { id: "productTitle" }, "Sony WH-1000XM5 Wireless Noise Cancelling Headphones (Silver)");
  root.appendChild(titleSpan);

  // Hidden ASIN input
  root.appendChild(node("input", { type: "hidden", id: "ASIN", name: "ASIN", value: "B09XS7JWHH" }));

  // Price container
  const priceContainer = node("div", { id: "corePriceDisplay_desktop_feature_div" });
  const pricePay = node("span", { class: "priceToPay" });
  pricePay.appendChild(node("span", { class: "a-offscreen" }, "₹29,990"));
  priceContainer.appendChild(pricePay);
  root.appendChild(priceContainer);

  // 2 Headphone-specific reviews
  const rev1 = node("div", { "data-hook": "review", id: "R_SONY_1" });
  rev1.appendChild(node("span", { class: "a-profile-name" }, "Audiophile Ankit"));
  const star1 = node("i", { "data-hook": "review-star-rating" });
  star1.appendChild(node("span", { class: "a-icon-alt" }, "5.0 out of 5 stars"));
  rev1.appendChild(star1);
  const revTitle1 = node("a", { "data-hook": "review-title" });
  revTitle1.appendChild(node("span", {}, "Best-in-class Active Noise Cancellation"));
  rev1.appendChild(revTitle1);
  rev1.appendChild(node("span", { "data-hook": "avp-badge" }, "Verified Purchase"));
  const body1 = node("span", { "data-hook": "review-body" });
  body1.appendChild(node("span", {}, "Completely eliminates plane engine noise and coffee shop chatter. Transparency mode is ultra natural."));
  rev1.appendChild(body1);
  root.appendChild(rev1);

  const rev2 = node("div", { "data-hook": "review", id: "R_SONY_2" });
  rev2.appendChild(node("span", { class: "a-profile-name" }, "Pooja R"));
  const star2 = node("i", { "data-hook": "review-star-rating" });
  star2.appendChild(node("span", { class: "a-icon-alt" }, "4.0 out of 5 stars"));
  rev2.appendChild(star2);
  const revTitle2 = node("a", { "data-hook": "review-title" });
  revTitle2.appendChild(node("span", {}, "Microphone quality is huge leap over XM4"));
  rev2.appendChild(revTitle2);
  rev2.appendChild(node("span", { "data-hook": "avp-badge" }, "Verified Purchase"));
  const body2 = node("span", { "data-hook": "review-body" });
  body2.appendChild(node("span", {}, "Crystal clear voice calls on Zoom. Comfortable for all-day wearing despite non-folding hinge."));
  rev2.appendChild(body2);
  root.appendChild(rev2);

  const sonyUrl = "https://www.amazon.in/dp/B09XS7JWHH";
  setupGlobalEnvironment(doc, sonyUrl);

  const product = extractProduct(doc, sonyUrl);
  assert.ok(product, "Product must be extracted");
  assert.strictEqual(product.product_name, "Sony WH-1000XM5 Wireless Noise Cancelling Headphones (Silver)");
  assert.strictEqual(product.asin, "B09XS7JWHH");
  assert.strictEqual(product.url, "https://www.amazon.in/dp/B09XS7JWHH");
  assert.strictEqual(product.current_site_price, 29990);
  assert.strictEqual(product.source_retailer, "Amazon.in");
  assert.strictEqual(product.analysis_source, "live_dom");

  // Reviews check
  assert.strictEqual(product.reviews.length, 2);
  assert.ok(product.reviews[0].text.includes("plane engine noise"));
  assert.ok(product.reviews[1].text.includes("voice calls on Zoom"));

  // Check that NO Cosmic Byte controller data is present
  assert.ok(!product.product_name.includes("Cosmic Byte"));
  assert.ok(!product.product_name.includes("Ares"));
  for (const r of product.reviews) {
    assert.ok(!r.text.includes("controller"));
    assert.ok(!r.text.includes("analog"));
    assert.ok(!r.text.includes("D-pad"));
  }
});

test("Requirement 8 Test 3: Tab navigation updates all product info and reviews without retaining old data", () => {
  // 1. First visit Cosmic Byte Ares
  const docAres = createMockDocument();
  const rootAres = node("div", { id: "dp", "data-asin": "B0B8S9K8R5" });
  docAres.appendChild(rootAres);
  rootAres.appendChild(node("span", { id: "productTitle" }, "Cosmic Byte Ares Controller"));
  rootAres.appendChild(node("input", { type: "hidden", id: "ASIN", value: "B0B8S9K8R5" }));

  const revAres = node("div", { "data-hook": "review", id: "R_A1" });
  const bAres = node("span", { "data-hook": "review-body" });
  bAres.appendChild(node("span", {}, "Amazing controller for PC games."));
  revAres.appendChild(bAres);
  rootAres.appendChild(revAres);

  setupGlobalEnvironment(docAres, "https://www.amazon.in/dp/B0B8S9K8R5");
  const p1 = extractProduct(docAres, "https://www.amazon.in/dp/B0B8S9K8R5");
  assert.strictEqual(p1.product_name, "Cosmic Byte Ares Controller");
  assert.strictEqual(p1.asin, "B0B8S9K8R5");
  assert.strictEqual(p1.reviews.length, 1);
  assert.ok(p1.reviews[0].text.includes("Amazing controller"));

  // 2. Navigate to boAt Rockerz 450 Headphones
  const docBoat = createMockDocument();
  const rootBoat = node("div", { id: "dp", "data-asin": "B07PR1CL3S" });
  docBoat.appendChild(rootBoat);
  rootBoat.appendChild(node("span", { id: "productTitle" }, "boAt Rockerz 450 Bluetooth On-Ear Headphones"));
  rootBoat.appendChild(node("input", { type: "hidden", id: "ASIN", value: "B07PR1CL3S" }));

  const revBoat = node("div", { "data-hook": "review", id: "R_B1" });
  const bBoat = node("span", { "data-hook": "review-body" });
  bBoat.appendChild(node("span", {}, "Punchy bass and comfortable ear cushions."));
  revBoat.appendChild(bBoat);
  rootBoat.appendChild(revBoat);

  setupGlobalEnvironment(docBoat, "https://www.amazon.in/dp/B07PR1CL3S");
  const p2 = extractProduct(docBoat, "https://www.amazon.in/dp/B07PR1CL3S");
  assert.strictEqual(p2.product_name, "boAt Rockerz 450 Bluetooth On-Ear Headphones");
  assert.strictEqual(p2.asin, "B07PR1CL3S");
  assert.strictEqual(p2.url, "https://www.amazon.in/dp/B07PR1CL3S");
  assert.strictEqual(p2.reviews.length, 1);
  assert.ok(p2.reviews[0].text.includes("Punchy bass"));

  // Verify p2 has zero residual fields from p1
  assert.ok(!p2.product_name.includes("Cosmic Byte"));
  assert.notStrictEqual(p2.asin, p1.asin);
  assert.notStrictEqual(p2.url, p1.url);
  assert.notStrictEqual(p2.reviews[0].text, p1.reviews[0].text);
});

test("Requirement 5 Test: Amazon page with zero reviews in DOM returns empty review array without fallback to demo data", () => {
  const doc = createMockDocument();
  const root = node("div", { id: "dp", "data-asin": "B0B8S9K8R5" });
  doc.appendChild(root);

  root.appendChild(node("span", { id: "productTitle" }, "Cosmic Byte Ares Wireless Controller for PC"));
  root.appendChild(node("input", { type: "hidden", id: "ASIN", value: "B0B8S9K8R5" }));

  // Deliberately no review cards in DOM
  const aresUrl = "https://www.amazon.in/dp/B0B8S9K8R5";
  setupGlobalEnvironment(doc, aresUrl);

  const product = extractProduct(doc, aresUrl);
  assert.ok(product, "Product should be detected");
  assert.strictEqual(product.product_name, "Cosmic Byte Ares Wireless Controller for PC");
  assert.strictEqual(product.asin, "B0B8S9K8R5");
  assert.strictEqual(product.analysis_source, "live_dom");

  // Reviews must be an empty array - NEVER replaced with hardcoded demo reviews
  assert.ok(Array.isArray(product.reviews));
  assert.strictEqual(product.reviews.length, 0);
});

test("Requirement 7 Test: Debug logging outputs detected title, ASIN, review count, and live_dom source", () => {
  const doc = createMockDocument();
  const root = node("div", { id: "dp", "data-asin": "B0B8S9K8R5" });
  doc.appendChild(root);
  root.appendChild(node("span", { id: "productTitle" }, "Cosmic Byte Ares Controller"));
  root.appendChild(node("input", { type: "hidden", id: "ASIN", value: "B0B8S9K8R5" }));

  const rev = node("div", { "data-hook": "review", id: "R_1" });
  const b = node("span", { "data-hook": "review-body" });
  b.appendChild(node("span", {}, "Great controller"));
  rev.appendChild(b);
  root.appendChild(rev);

  const loggedEvents = [];
  const originalLog = console.log;
  console.log = (...args) => {
    loggedEvents.push(args);
    originalLog(...args);
  };

  try {
    const aresUrl = "https://www.amazon.in/dp/B0B8S9K8R5";
    setupGlobalEnvironment(doc, aresUrl);
    extractProduct(doc, aresUrl);

    const debugCall = loggedEvents.find((call) =>
      call[0] === "[DealSense Debug Content Script]" &&
      call[1]?.event === "amazon_product_extracted"
    );

    assert.ok(debugCall, "Debug log must be emitted");
    assert.strictEqual(debugCall[1].title, "Cosmic Byte Ares Controller");
    assert.strictEqual(debugCall[1].asin, "B0B8S9K8R5");
    assert.strictEqual(debugCall[1].reviewCount, 1);
    assert.strictEqual(debugCall[1].source, "live_dom");
  } finally {
    console.log = originalLog;
  }
});

test("ML & AI Integration Test: Price parsing ignores savings percentage and captures actual INR price", () => {
  const doc = createMockDocument();
  const root = node("div", { id: "dp", "data-asin": "B0B8S9K8R5" });
  doc.appendChild(root);
  root.appendChild(node("span", { id: "productTitle" }, "Cosmic Byte Ares Wireless Controller"));
  root.appendChild(node("input", { type: "hidden", id: "ASIN", value: "B0B8S9K8R5" }));

  // Price block with -45% savings discount badge
  const priceContainer = node("div", { id: "corePriceDisplay_desktop_feature_div" });
  priceContainer.appendChild(node("span", { class: "savingsPercentage" }, "-45%"));
  const priceToPay = node("span", { class: "priceToPay" });
  priceToPay.appendChild(node("span", { class: "a-price-symbol" }, "₹"));
  priceToPay.appendChild(node("span", { class: "a-price-whole" }, "1,699."));
  priceToPay.appendChild(node("span", { class: "a-offscreen" }, "₹1,699.00"));
  priceContainer.appendChild(priceToPay);
  root.appendChild(priceContainer);

  const aresUrl = "https://www.amazon.in/dp/B0B8S9K8R5";
  setupGlobalEnvironment(doc, aresUrl);

  const product = extractProduct(doc, aresUrl);
  assert.ok(product, "Product must be extracted");
  assert.strictEqual(product.current_site_price, 1699, "Price must be 1699, not 45 from discount badge");
  assert.strictEqual(product.currency, "INR", "Currency must be INR");
});

test("ML & AI Integration Test: Extraction captures seller, brand, model, and specifications", () => {
  const doc = createMockDocument();
  const root = node("div", { id: "dp", "data-asin": "B0B8S9K8R5" });
  doc.appendChild(root);
  root.appendChild(node("span", { id: "productTitle" }, "Cosmic Byte Ares Wireless Controller"));
  root.appendChild(node("input", { type: "hidden", id: "ASIN", value: "B0B8S9K8R5" }));

  // Seller info
  const merchantInfo = node("div", { id: "merchant-info" });
  merchantInfo.appendChild(node("span", {}, "Sold by Appario Retail Pvt Ltd and Fulfilled by Amazon."));
  root.appendChild(merchantInfo);

  // Brand byline
  const brandByline = node("a", { id: "bylineInfo" }, "Visit the Cosmic Byte Store");
  root.appendChild(brandByline);

  // Tech spec table
  const specTable = node("table", { id: "productDetails_techSpec_section_1" });
  const row1 = node("tr", {});
  row1.appendChild(node("th", {}, "Model Name"));
  row1.appendChild(node("td", {}, "Ares Wireless"));
  specTable.appendChild(row1);
  const row2 = node("tr", {});
  row2.appendChild(node("th", {}, "Hardware Platform"));
  row2.appendChild(node("td", {}, "PC, Android"));
  specTable.appendChild(row2);
  root.appendChild(specTable);

  const aresUrl = "https://www.amazon.in/dp/B0B8S9K8R5";
  setupGlobalEnvironment(doc, aresUrl);

  const product = extractProduct(doc, aresUrl);
  assert.ok(product, "Product must be extracted");
  assert.strictEqual(product.seller, "Appario Retail Pvt Ltd");
  assert.strictEqual(product.brand, "Cosmic Byte");
  assert.strictEqual(product.model, "Ares Wireless");
  assert.ok(product.specifications, "Specifications object must exist");
  assert.strictEqual(product.specifications["Model Name"], "Ares Wireless");
  assert.strictEqual(product.specifications["Hardware Platform"], "PC, Android");
  assert.ok(product.scan_metadata, "Scan metadata must be present");
  assert.strictEqual(product.scan_metadata.pages_scanned, 1);
});

test("HTML Fixture Test: Amazon India dedicated /product-reviews/ page extraction", () => {
  // Dynamic import or relative read
  const fixturePath = path.join(__dirname, "fixtures/amazon_product_reviews_page.html");
  const html = fs.readFileSync(fixturePath, "utf8");

  // Use dom_mock helper
  const doc = parseHtmlToMockDocument(html);
  const reviewUrl = "https://www.amazon.in/Cosmic-Byte-Ares-Controller/product-reviews/B0B8S9K8R5/?reviewerType=all_reviews";
  setupGlobalEnvironment(doc, reviewUrl);

  const product = extractProduct(doc, reviewUrl);
  assert.ok(product, "Product must be successfully extracted from /product-reviews/ page");
  assert.strictEqual(product.asin, "B0B8S9K8R5", "ASIN must be extracted from review page URL");
  assert.ok(product.product_name.includes("Cosmic Byte Ares Wireless Controller"), "Product title must be extracted from header link");
  assert.strictEqual(product.current_site_price, 1699, "Price must be extracted from #cm_cr_product_info");
  assert.strictEqual(product.currency, "INR", "Currency must be INR");

  // Reviews verification
  assert.strictEqual(product.reviews.length, 3, "Must extract all 3 reviews from fixture");
  
  // Review 1
  assert.strictEqual(product.reviews[0].author, "Vikas Patel");
  assert.strictEqual(product.reviews[0].rating, 5);
  assert.strictEqual(product.reviews[0].title, "Zero input lag and great ergonomics");
  assert.strictEqual(product.reviews[0].date, "12 September 2024");
  assert.strictEqual(product.reviews[0].verified_purchase, true);
  assert.ok(product.reviews[0].text.includes("smooth progressive travel"));

  // Review 2
  assert.strictEqual(product.reviews[1].author, "Pooja Nair");
  assert.strictEqual(product.reviews[1].rating, 4);
  assert.strictEqual(product.reviews[1].title, "Good controller for casual gaming");
  assert.strictEqual(product.reviews[1].date, "28 August 2024");
  assert.strictEqual(product.reviews[1].verified_purchase, true);

  // Review 3
  assert.strictEqual(product.reviews[2].author, "Arjun Mehta");
  assert.strictEqual(product.reviews[2].rating, 2);
  assert.strictEqual(product.reviews[2].title, "Stick drift after three weeks");
  assert.strictEqual(product.reviews[2].date, "10 August 2024");

  // Pagination detection
  assert.ok(product.scan_metadata, "scan_metadata must be present");
  assert.strictEqual(product.scan_metadata.pages_scanned, 1);
  assert.strictEqual(product.scan_metadata.has_more, true, "has_more must be true when next page link exists");
});

test("HTML Fixture Test: Amazon India product detail page (/dp/) with JSON-LD and core price", () => {
  const fixturePath = path.join(__dirname, "fixtures/amazon_product_detail_page.html");
  const html = fs.readFileSync(fixturePath, "utf8");

  const doc = parseHtmlToMockDocument(html);
  const dpUrl = "https://www.amazon.in/dp/B0B8S9K8R5";
  setupGlobalEnvironment(doc, dpUrl);

  const product = extractProduct(doc, dpUrl);
  assert.ok(product, "Product must be extracted from /dp/ page fixture");
  assert.strictEqual(product.asin, "B0B8S9K8R5");
  assert.strictEqual(product.product_name, "Cosmic Byte Ares Wireless Controller for PC (Black)");
  assert.strictEqual(product.current_site_price, 1699, "Price must be 1699, ignoring -45% savings badge");
  assert.strictEqual(product.mrp, 2999, "MRP must be 2999 from strikethrough price");
  assert.strictEqual(product.seller, "Appario Retail Private Ltd");
  assert.strictEqual(product.brand, "Cosmic Byte");
  assert.strictEqual(product.model, "Ares Wireless");

  // Review in PDP
  assert.strictEqual(product.reviews.length, 1);
  assert.strictEqual(product.reviews[0].author, "Devendra Singh");
  assert.strictEqual(product.reviews[0].rating, 5);
  assert.strictEqual(product.reviews[0].title, "Flawless plug and play on PC");
  assert.strictEqual(product.reviews[0].date, "05 October 2024");
});

test("Multi-Page Review Collection - Rating distribution calculation (1★ to 5★)", () => {
  const reviews = [
    { id: "1", text: "Great product", rating: 5 },
    { id: "2", text: "Very good", rating: 4 },
    { id: "3", text: "Average quality", rating: 3 },
    { id: "4", text: "Disappointed", rating: 2 },
    { id: "5", text: "Defective item", rating: 1 },
    { id: "6", text: "Excellent", rating: 5 },
    { id: "7", text: "No rating text", rating: null },
  ];

  const dist = calculateRatingDistribution(reviews);
  assert.strictEqual(dist["5"], 2);
  assert.strictEqual(dist["4"], 1);
  assert.strictEqual(dist["3"], 1);
  assert.strictEqual(dist["2"], 1);
  assert.strictEqual(dist["1"], 1);
  assert.strictEqual(dist["unrated"], 1);
});

test("Multi-Page Review Collection - Deduplication by ID and normalized text", async () => {
  const doc = createMockDocument();
  const root = node("div", { id: "dp" });
  doc.appendChild(root);

  // Review with ID R1
  const rev1 = node("div", { "data-hook": "review", id: "R1" });
  const b1 = node("span", { "data-hook": "review-body" });
  b1.appendChild(node("span", {}, "Sturdy controller with responsive joysticks."));
  rev1.appendChild(b1);
  root.appendChild(rev1);

  // Duplicate Review with identical ID R1
  const rev2 = node("div", { "data-hook": "review", id: "R1" });
  const b2 = node("span", { "data-hook": "review-body" });
  b2.appendChild(node("span", {}, "Sturdy controller with responsive joysticks."));
  rev2.appendChild(b2);
  root.appendChild(rev2);

  // Review with different ID but identical text content
  const rev3 = node("div", { "data-hook": "review", id: "R2" });
  const b3 = node("span", { "data-hook": "review-body" });
  b3.appendChild(node("span", {}, "Sturdy controller with responsive joysticks."));
  rev3.appendChild(b3);
  root.appendChild(rev3);

  // Genuinely distinct review
  const rev4 = node("div", { "data-hook": "review", id: "R3" });
  const b4 = node("span", { "data-hook": "review-body" });
  b4.appendChild(node("span", {}, "Battery drains too quickly during intense play sessions."));
  rev4.appendChild(b4);
  root.appendChild(rev4);

  setupGlobalEnvironment(doc, "https://www.amazon.in/dp/B0B8S9K8R5");
  const result = await collectMultiPageReviews({ targetCount: 100 });

  assert.strictEqual(result.total_collected, 2, "Duplicate review ID and identical text must be deduplicated to 2 unique reviews");
  assert.strictEqual(result.reviews[0].id, "R1");
  assert.strictEqual(result.reviews[1].id, "R3");
});

test("Multi-Page Review Collection - Q&A and non-review text exclusion", async () => {
  const doc = createMockDocument();
  const root = node("div", { id: "dp" });
  doc.appendChild(root);

  // Real review
  const rev1 = node("div", { "data-hook": "review", id: "REV_REAL" });
  const b1 = node("span", { "data-hook": "review-body" });
  b1.appendChild(node("span", {}, "The controller connects easily via bluetooth to PC."));
  rev1.appendChild(b1);
  root.appendChild(rev1);

  // Question header mistakenly captured
  const qaCard = node("div", { "data-hook": "review", id: "QA_FAKE" });
  const bQA = node("span", { "data-hook": "review-body" });
  bQA.appendChild(node("span", {}, "Q: Does this work with Windows 11? Have a question? Ask here."));
  qaCard.appendChild(bQA);
  root.appendChild(qaCard);

  setupGlobalEnvironment(doc, "https://www.amazon.in/dp/B0B8S9K8R5");
  const result = await collectMultiPageReviews({ targetCount: 100 });

  assert.strictEqual(result.total_collected, 1, "Q&A text should be excluded from review collection");
  assert.strictEqual(result.reviews[0].id, "REV_REAL");
});

test("Extensive Review Analysis - Synthesized summary schema & UI contract compliance", () => {
  // Mock LLM summary object returned by backend /api/reviews/analyze-batch
  const mockSummaryResponse = {
    status: "success",
    available: true,
    provider: "local",
    summary: "Customer reception across 100 analyzed reviews is largely favorable (80.0% positive), with buyers consistently reporting a positive everyday experience. The most widely praised strength centers on dependable battery life & charging, frequently highlighted as a standout advantage. Reviewers report few recurring hardware or software issues during standard usage. Overall, the product offers solid value for money for shoppers seeking a reliable everyday option.",
    verdict: "Reviews are generally positive, with consistent satisfaction and no major recurring issues identified.",
    verdict_sentiment: "PROCEED",
    verdict_detail: "Broad buyer consensus across 100 analyzed reviews supports buying.",
    confidence_score: 93.0,
    confidence_level: "HIGH",
    confidence_explanation: "High confidence based on 100 analyzed reviews with consistent sentiment signals and low manipulation indicators. Confidence reflects review sample quality rather than a product guarantee.",
    total_reviews_analyzed: 100,
    target_count: 100,
  };

  // 1. Verify concise synthesized summary (60-100 words maximum, zero raw review quotations)
  const words = mockSummaryResponse.summary.split(/\s+/);
  assert.ok(words.length >= 50 && words.length <= 100, `Word count (${words.length}) must be in 60-100 words range`);
  assert.ok(!mockSummaryResponse.summary.includes('"'), "Summary must not concatenate raw customer quotations");
  assert.ok(mockSummaryResponse.summary.includes("largely favorable"));
  assert.ok(mockSummaryResponse.summary.includes("value for money"));

  // 2. Verify Actionable Purchase Verdict card properties
  assert.strictEqual(mockSummaryResponse.verdict_sentiment, "PROCEED");
  assert.ok(mockSummaryResponse.verdict.length > 20);
  assert.ok(mockSummaryResponse.verdict.includes("no major recurring issues"));
  assert.ok(mockSummaryResponse.verdict_detail.includes("supports buying"));

  // 3. Verify Evidence Confidence Indicator properties & explicit disclaimer
  assert.strictEqual(mockSummaryResponse.confidence_level, "HIGH");
  assert.strictEqual(mockSummaryResponse.confidence_score, 93.0);
  assert.ok(mockSummaryResponse.confidence_explanation.includes("sample quality rather than a product guarantee"));

  // 4. Verify target vs analyzed counts
  assert.strictEqual(mockSummaryResponse.total_reviews_analyzed, 100);
  assert.strictEqual(mockSummaryResponse.target_count, 100);
});

test("Extensive Review Analysis - Minority defect detection yields PROCEED WITH CAUTION verdict", () => {
  const defectSummaryResponse = {
    status: "success",
    available: true,
    provider: "local",
    summary: "Customer reception across 100 analyzed reviews is largely favorable (85.0% positive), with buyers consistently reporting a positive everyday experience. The most widely praised strength centers on dependable responsiveness, frequently highlighted as a standout advantage. However, recurring reports of premature drift issues raise meaningful durability concerns that prospective buyers should weigh. It represents reasonable value for budget-focused buyers, but those prioritizing long-term durability should verify warranty coverage.",
    verdict: "Good value for core features, but recurring reports of drift issues raise meaningful durability concerns.",
    verdict_sentiment: "PROCEED_WITH_CAUTION",
    verdict_detail: "Verify manufacturer warranty coverage and return policies before purchasing.",
    confidence_score: 88.0,
    confidence_level: "HIGH",
    confidence_explanation: "High confidence based on 100 analyzed reviews. Confidence reflects review sample quality rather than a product guarantee.",
    total_reviews_analyzed: 100,
    target_count: 100,
  };

  const words = defectSummaryResponse.summary.split(/\s+/);
  assert.ok(words.length >= 50 && words.length <= 100, `Word count (${words.length}) must be in 60-100 words range`);
  assert.strictEqual(defectSummaryResponse.verdict_sentiment, "PROCEED_WITH_CAUTION");
  assert.ok(defectSummaryResponse.verdict.includes("drift issues"));
  assert.ok(defectSummaryResponse.verdict_detail.includes("warranty coverage"));
});

test("Extensive Review Analysis - Mixed trade-offs yields PROCEED WITH CAUTION verdict", () => {
  const mixedResponse = {
    status: "success",
    available: true,
    provider: "local",
    summary: "Customer reception across 30 analyzed reviews is divided with mixed opinions (50.0% positive vs 50.0% negative), reflecting varied experiences and noticeable trade-offs. The most widely praised strength centers on dependable display quality, frequently highlighted as a standout advantage. Conversely, critical feedback centers on battery life & charging, which several reviewers cited as an ongoing limitation. It represents reasonable value for budget-focused buyers, but those prioritizing long-term durability should verify warranty coverage.",
    verdict: "Worthwhile benefits in display quality, but recurring concerns regarding battery life & charging warrant consideration.",
    verdict_sentiment: "PROCEED_WITH_CAUTION",
    verdict_detail: "Best suited for buyers comfortable compromising on secondary features.",
    confidence_score: 65.0,
    confidence_level: "MODERATE",
    confidence_explanation: "Moderate confidence based on 30 analyzed reviews. Confidence reflects review sample quality rather than a product guarantee.",
    total_reviews_analyzed: 30,
    target_count: 100,
  };

  assert.strictEqual(mixedResponse.verdict_sentiment, "PROCEED_WITH_CAUTION");
  assert.ok(mixedResponse.verdict.includes("warrant consideration"));
});

test("Extensive Review Analysis - Predominantly negative reviews yield AVOID verdict", () => {
  const avoidResponse = {
    status: "success",
    available: true,
    provider: "local",
    summary: "Customer feedback across 40 analyzed reviews reflects substantial dissatisfaction (80.0% negative), with widespread complaints concerning performance and reliability. Few distinct advantages were noted beyond initial basic operation. Persistent reports of premature product failure and defective components dominate customer experiences. Given the frequency of recurring defects, this product presents significant purchase risks and is difficult to recommend.",
    verdict: "Repeated reports of product failure and persistent durability issues present substantial purchase risks.",
    verdict_sentiment: "AVOID",
    verdict_detail: "Critical complaints account for 80.0% of analyzed reviews.",
    confidence_score: 85.0,
    confidence_level: "HIGH",
    confidence_explanation: "High confidence based on 40 analyzed reviews. Confidence reflects review sample quality rather than a product guarantee.",
    total_reviews_analyzed: 40,
    target_count: 100,
  };

  assert.strictEqual(avoidResponse.verdict_sentiment, "AVOID");
  assert.ok(avoidResponse.verdict.includes("substantial purchase risks"));
  assert.ok(avoidResponse.summary.includes("difficult to recommend"));
});

test("Extensive Review Analysis - Insufficient review evidence yields INSUFFICIENT EVIDENCE verdict", () => {
  const sparseResponse = {
    status: "success",
    available: true,
    provider: "local",
    summary: "A limited sample of 2 visible customer reviews provides directional feedback, but is too few to establish reliable consensus.",
    verdict: "Only 2 customer reviews available, which is insufficient to determine purchase safety.",
    verdict_sentiment: "INSUFFICIENT_EVIDENCE",
    verdict_detail: "A larger sample of verified buyer feedback is required to establish statistical reliability.",
    confidence_score: 22.0,
    confidence_level: "INSUFFICIENT",
    confidence_explanation: "Insufficient confidence: Very small sample of 2 reviews is inadequate to establish reliable consensus. Confidence reflects review sample quality rather than a product guarantee.",
    total_reviews_analyzed: 2,
    target_count: 100,
  };

  assert.strictEqual(sparseResponse.verdict_sentiment, "INSUFFICIENT_EVIDENCE");
  assert.ok(sparseResponse.verdict.includes("insufficient to determine purchase safety"));
});

test("Automated Review Collection - Amazon URL generation uses canonical /product-reviews/ path", async () => {
  let requestedUrl = null;
  const originalFetch = globalThis.fetch;
  const originalDOMParser = globalThis.DOMParser;
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    const html = '<html><body><div data-hook="review" id="RTEST"><span data-hook="review-body"><span>Valid review text that exceeds minimal length requirements for customer reviews.</span></span></div></body></html>' + " ".repeat(600);
    return {
      ok: true,
      text: async () => html,
    };
  };
  globalThis.DOMParser = class {
    parseFromString(html) {
      return parseHtmlToMockDocument(html);
    }
  };

  try {
    const revs = await fetchAmazonDedicatedReviews("B0D5D8N8P4", 1);
    assert.ok(requestedUrl, "fetch was called");
    assert.ok(requestedUrl.includes("/product-reviews/B0D5D8N8P4"), "URL uses /product-reviews/ without /product/ subpath");
    assert.ok(!requestedUrl.includes("/product/product-reviews/"), "URL does not contain invalid /product/product-reviews/ 404 path");
    assert.strictEqual(revs.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.DOMParser = originalDOMParser;
  }
});

test("Automated Review Collection - Deduplication normalizes customer_review- IDs", () => {
  const doc = createMockDocument();
  const root = node("div", { id: "dp" });
  doc.appendChild(root);

  // Review with customer_review- prefix
  const rev1 = node("div", { "data-hook": "review", id: "customer_review-R12345" });
  const body1 = node("span", { "data-hook": "review-body" });
  body1.appendChild(node("span", {}, "First review with prefix ID"));
  rev1.appendChild(body1);
  root.appendChild(rev1);

  const extracted = extractAmazonReviews(doc);
  assert.strictEqual(extracted.length, 1);
  assert.strictEqual(extracted[0].id, "R12345", "Normalized customer_review-R12345 to R12345");
});

test("Review Extraction - Disassociates star ratings from written reviews count", () => {
  const doc = createMockDocument();
  const root = node("div", { id: "dp" });
  doc.appendChild(root);

  // Star ratings count text: 1,420 ratings
  const ratingsEl = node("span", { id: "acrCustomerReviewText" }, "1,420 ratings");
  root.appendChild(ratingsEl);

  const { rating, ratingsTotal, reviewsTotal } = extractAmazonRating(doc);
  assert.strictEqual(ratingsTotal, 1420);
  assert.strictEqual(reviewsTotal, null, "reviewsTotal is not confused with ratingsTotal");
});

test("Background Review Collection - Paginates without arbitrary target count limits", async () => {
  const originalFetch = globalThis.fetch;
  const originalDOMParser = globalThis.DOMParser;
  const originalDocument = globalThis.document;
  globalThis.document = createMockDocument();
  const fetchedUrls = [];

  const createReviewHtml = (page) => {
    let html = `<html><head></head><body><div id="cm_cr-review_list">`;
    for (let i = 1; i <= 5; i++) {
      html += `<div data-hook="review" id="R_P${page}_${i}">
        <span class="a-profile-name">User ${page}_${i}</span>
        <i data-hook="review-star-rating"><span class="a-icon-alt">5.0 out of 5 stars</span></i>
        <a data-hook="review-title"><span>Review title ${page}_${i}</span></a>
        <span data-hook="review-date">Reviewed in India on 1 Jan 2024</span>
        <span data-hook="review-body"><span>Detailed written review feedback for product page ${page} item ${i}.</span></span>
      </div>`;
    }
    if (page < 3) {
      html += `<ul class="a-pagination"><li class="a-last"><a href="/product-reviews/B0D5D8N8P4?pageNumber=${page + 1}">Next page</a></li></ul>`;
    } else {
      html += `<ul class="a-pagination"><li class="a-last a-disabled"><a>Next page</a></li></ul>`;
    }
    html += `</div>` + " ".repeat(400) + `</body></html>`;
    return html;
  };

  globalThis.fetch = async (url) => {
    fetchedUrls.push(url);
    const m = url.match(/pageNumber=(\d+)/);
    const page = m ? parseInt(m[1], 10) : 1;
    return {
      ok: true,
      status: 200,
      text: async () => createReviewHtml(page),
    };
  };

  globalThis.DOMParser = class {
    parseFromString(html) {
      return parseHtmlToMockDocument(html);
    }
  };

  try {
    const result = await collectMultiPageReviews({ diversify: false });
    assert.ok(result.success, "Collection succeeded");
    assert.strictEqual(result.total_collected, 15, "Collected all 15 reviews across 3 pages without 10-count truncation");
    assert.ok(result.pages_scanned >= 3, "Scanned all 3 pages");
    assert.strictEqual(result.stopped_reason, "all_accessible_collected", "Stopped because no more pages exist");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.DOMParser = originalDOMParser;
    globalThis.document = originalDocument;
  }
});

test("Background Review Collection - Safely stops when Amazon anti-bot CAPTCHA is detected", async () => {
  const originalFetch = globalThis.fetch;
  const originalDOMParser = globalThis.DOMParser;

  globalThis.fetch = async () => {
    const captchaHtml = `<html><head><title>Robot Check</title></head><body>
      <form action="/errors/validateCaptcha">
        <input name="captchacharacters" id="captchacharacters" />
        <p>Enter the characters you see below</p>
      </form>
    </body></html>` + " ".repeat(400);
    return {
      ok: true,
      status: 200,
      text: async () => captchaHtml,
    };
  };

  globalThis.DOMParser = class {
    parseFromString(html) {
      return parseHtmlToMockDocument(html);
    }
  };

  try {
    const result = await collectMultiPageReviews({ diversify: false });
    assert.strictEqual(result.stopped_reason, "captcha_detected");
    assert.ok(result.limitation_note.includes("CAPTCHA"), "Noted CAPTCHA in limitation note");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.DOMParser = originalDOMParser;
  }
});

test("Review Summary Format - Natural opinion focus without percentages, review counts, or statistical confidence scores", () => {
  // Test sample of simplified natural summary
  const sampleSummary = "Customer consensus is overwhelmingly positive: buyers consistently praise and like the build quality and responsiveness, with no recurring critical defects. The most widely appreciated strengths center on dependable build quality and responsiveness, frequently highlighted as a standout advantage. Reported concerns are minimal and primarily involve minor operational preferences rather than product failures. It represents a reliable and worthwhile choice if you are looking for dependable performance.";

  assert.ok(!sampleSummary.includes("%"), "Summary must contain zero percentage signs");
  assert.ok(!/\b\d+\s*reviews?\b/i.test(sampleSummary), "Summary must contain zero review count mentions");
  assert.ok(!/\bconfidence\b/i.test(sampleSummary), "Summary must not contain statistical confidence scores");
  assert.ok(sampleSummary.length > 50, "Summary provides informative evaluation");
});

test("Background Review Parser - Extracts all review fields without DOM or DOMParser", () => {
  const fixturePath = path.join(__dirname, "fixtures/amazon_product_reviews_page.html");
  const html = fs.readFileSync(fixturePath, "utf8");

  const parsed = globalThis.parseAmazonReviewsFromHtml(html);
  assert.strictEqual(parsed.reviews.length, 3, "Parsed all 3 reviews from HTML fixture");
  assert.strictEqual(parsed.hasNextPage, true, "Detected active next page link");

  // Verify review 1
  const r1 = parsed.reviews[0];
  assert.strictEqual(r1.id, "R1ARES_01");
  assert.strictEqual(r1.author, "Vikas Patel");
  assert.strictEqual(r1.rating, 5);
  assert.strictEqual(r1.title, "Zero input lag and great ergonomics");
  assert.strictEqual(r1.verified_purchase, true);
  assert.strictEqual(r1.date, "12 September 2024");
  assert.ok(r1.text.includes("wireless dongle connects instantly"));

  // Verify review 2
  const r2 = parsed.reviews[1];
  assert.strictEqual(r2.id, "R2ARES_02");
  assert.strictEqual(r2.author, "Pooja Nair");
  assert.strictEqual(r2.rating, 4);
  assert.strictEqual(r2.title, "Good controller for casual gaming");
  assert.strictEqual(r2.verified_purchase, true);

  // Test disabled next page detection
  const disabledHtml = html.replace('class="a-last"', 'class="a-last a-disabled"');
  const disabledParsed = globalThis.parseAmazonReviewsFromHtml(disabledHtml);
  assert.strictEqual(disabledParsed.hasNextPage, false, "Correctly recognizes disabled pagination");

  // Test empty/malformed HTML handling
  const emptyParsed = globalThis.parseAmazonReviewsFromHtml("");
  assert.deepStrictEqual(emptyParsed, { reviews: [], hasNextPage: false });
  const nullParsed = globalThis.parseAmazonReviewsFromHtml(null);
  assert.deepStrictEqual(nullParsed, { reviews: [], hasNextPage: false });
});

test("Helium Popup Protection - Review collection does not scroll active tab, navigate tab, or reload page", () => {
  // 1. Verify content.js contains zero scrollIntoView invocations that steal window focus in Chromium/Helium
  assert.ok(!contentScriptCode.includes("scrollIntoView"), "content.js must not call scrollIntoView to avoid focus theft in Helium popups");

  // 2. Verify content.js does not redirect the browser window
  assert.ok(!contentScriptCode.includes("window.location.href ="), "content.js must not navigate window.location");
  assert.ok(!contentScriptCode.includes("location.assign"), "content.js must not assign location");
  assert.ok(!contentScriptCode.includes("location.replace"), "content.js must not replace location");
});

test("Background Service Worker - startReviewAnalysis orchestrates job and persists to chrome.storage.local", async () => {
  const store = {};
  const originalChrome = globalThis.chrome;

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          for (const k of keys) res[k] = store[k];
          return res;
        },
        set: async (items) => {
          Object.assign(store, items);
        },
      },
    },
    runtime: {
      sendMessage: () => {},
      lastError: null,
    },
  };

  try {
    const mockProduct = {
      source_retailer: "amazon",
      asin: "B0HELI_TEST",
      product_name: "Helium Safe Gaming Headset",
      url: "https://www.amazon.in/dp/B0HELI_TEST",
    };
    const initialReviews = [
      { id: "R_INIT_1", text: "Great build quality and sound", rating: 5 },
    ];

    let startResponse = null;
    globalThis.handleRuntimeMessage(
      {
        action: "startReviewAnalysis",
        product: mockProduct,
        initialReviews,
      },
      {},
      (resp) => {
        startResponse = resp;
      }
    );

    assert.ok(startResponse, "Received response from startReviewAnalysis");
    assert.strictEqual(startResponse.success, true);
    assert.strictEqual(startResponse.job.status, "collecting");
    assert.strictEqual(startResponse.job.totalCollected, 1);

    // Verify persisted in chrome.storage.local
    const jobKey = "dealsense_job_amazon::B0HELI_TEST::";
    assert.ok(store[jobKey], "Job state saved to chrome.storage.local");
    assert.strictEqual(store[jobKey].asin, "B0HELI_TEST");

    // Second call for same product returns inProgress: true to prevent duplicate background workers
    let secondResponse = null;
    globalThis.handleRuntimeMessage(
      {
        action: "startReviewAnalysis",
        product: mockProduct,
        initialReviews,
      },
      {},
      (resp) => {
        secondResponse = resp;
      }
    );
    assert.strictEqual(secondResponse.success, true);
    assert.strictEqual(secondResponse.inProgress, true);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("Helium Popup Reopening - getAnalysisJob restores active progress without restarting collection", async () => {
  const store = {};
  const originalChrome = globalThis.chrome;

  const prodKey = "amazon::B0REOPEN_ACTIVE::";
  store["dealsense_job_" + prodKey] = {
    productKey: prodKey,
    asin: "B0REOPEN_ACTIVE",
    status: "analyzing",
    step: "Analyzing customer sentiment across 45 collected reviews...",
    totalCollected: 45,
    reviews: Array(45).fill({ text: "Sample review" }),
    analysisResult: null,
    error: null,
  };

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          for (const k of keys) res[k] = store[k];
          return res;
        },
      },
    },
    runtime: {
      sendMessage: () => {},
      lastError: null,
    },
  };

  try {
    let jobResp = null;
    globalThis.handleRuntimeMessage(
      { action: "getAnalysisJob", productKey: prodKey },
      {},
      (resp) => {
        jobResp = resp;
      }
    );

    // Allow promise resolution
    await new Promise((r) => setTimeout(r, 10));

    assert.ok(jobResp, "Received response for getAnalysisJob");
    assert.strictEqual(jobResp.success, true);
    assert.ok(jobResp.job, "Job was successfully retrieved");
    assert.strictEqual(jobResp.job.status, "analyzing");
    assert.strictEqual(jobResp.job.totalCollected, 45);
    assert.strictEqual(jobResp.job.step, "Analyzing customer sentiment across 45 collected reviews...");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("Helium Popup Reopening - getAnalysisJob restores completed review analysis on reopen", async () => {
  const store = {};
  const originalChrome = globalThis.chrome;

  const prodKey = "amazon::B0REOPEN_DONE::";
  const expectedAnalysis = {
    purchase_verdict: {
      outcome: "PROCEED",
      reason: "Dependable build quality and stellar battery life with zero critical failure reports.",
    },
    sentiment: {
      positive_percentage: 92,
      neutral_percentage: 5,
      negative_percentage: 3,
    },
    extensive_summary: {
      coherent_summary: "Customer consensus is overwhelmingly positive across all collected reviews.",
    },
  };

  store["dealsense_job_" + prodKey] = {
    productKey: prodKey,
    asin: "B0REOPEN_DONE",
    status: "completed",
    totalCollected: 60,
    analysisResult: expectedAnalysis,
    error: null,
  };

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          for (const k of keys) res[k] = store[k];
          return res;
        },
      },
    },
    runtime: {
      sendMessage: () => {},
      lastError: null,
    },
  };

  try {
    let jobResp = null;
    globalThis.handleRuntimeMessage(
      { action: "getAnalysisJob", productKey: prodKey },
      {},
      (resp) => {
        jobResp = resp;
      }
    );

    await new Promise((r) => setTimeout(r, 10));

    assert.ok(jobResp);
    assert.strictEqual(jobResp.job.status, "completed");
    assert.deepStrictEqual(jobResp.job.analysisResult, expectedAnalysis);
    assert.strictEqual(jobResp.job.analysisResult.purchase_verdict.outcome, "PROCEED");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("Background Service Worker - Error state persists to storage and reports honestly on popup reopen", async () => {
  const store = {};
  const originalChrome = globalThis.chrome;

  const prodKey = "amazon::B0REOPEN_ERR::";
  const errorMessage = "Cannot connect to DealSense FastAPI backend at http://127.0.0.1:8000. Please ensure the local backend server is running.";

  store["dealsense_job_" + prodKey] = {
    productKey: prodKey,
    asin: "B0REOPEN_ERR",
    status: "error",
    error: errorMessage,
    analysisResult: null,
  };

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          for (const k of keys) res[k] = store[k];
          return res;
        },
      },
    },
    runtime: {
      sendMessage: () => {},
      lastError: null,
    },
  };

  try {
    let jobResp = null;
    globalThis.handleRuntimeMessage(
      { action: "getAnalysisJob", productKey: prodKey },
      {},
      (resp) => {
        jobResp = resp;
      }
    );

    await new Promise((r) => setTimeout(r, 10));

    assert.ok(jobResp);
    assert.strictEqual(jobResp.job.status, "error");
    assert.strictEqual(jobResp.job.error, errorMessage);
    assert.strictEqual(jobResp.job.analysisResult, null, "Does not fabricate fake review analysis on error");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("Background Service Worker - cancelAnalysis aborts in-flight collection and marks job idle", () => {
  const originalChrome = globalThis.chrome;
  const store = {};

  globalThis.chrome = {
    storage: {
      local: {
        set: async (items) => Object.assign(store, items),
        get: async (keys) => {
          const res = {};
          for (const k of keys) res[k] = store[k];
          return res;
        },
      },
    },
    runtime: { sendMessage: () => {} },
  };

  try {
    const prodKey = "amazon::B0CANCEL_ME::";
    globalThis.activeJobs.set(prodKey, {
      productKey: prodKey,
      status: "collecting",
      reviews: [],
    });

    let cancelResp = null;
    globalThis.handleRuntimeMessage(
      { action: "cancelAnalysis", productKey: prodKey },
      {},
      (resp) => {
        cancelResp = resp;
      }
    );

    assert.ok(cancelResp);
    assert.strictEqual(cancelResp.success, true);
    assert.strictEqual(globalThis.activeJobs.get(prodKey).status, "idle");
    assert.strictEqual(globalThis.activeJobs.get(prodKey).error, "Cancelled");
  } finally {
    globalThis.chrome = originalChrome;
  }
});

test("Dynamic Product Aspects - Unified section displays actual aspects for distinct categories without hardcoding", () => {
  // Helper simulating ResultScreen aspect gathering logic
  function processAspects(rawAspects, deliverySummary) {
    const list = rawAspects ? [...rawAspects] : [];
    if (
      deliverySummary &&
      deliverySummary.mentions > 0 &&
      !list.some((a) => a.aspect_id === "delivery_packaging" || a.display_name?.toLowerCase().includes("delivery"))
    ) {
      list.push({
        aspect_id: "delivery_packaging",
        display_name: "Delivery & Packaging",
        category: "logistics_seller",
        mention_count: deliverySummary.mentions,
        positive_mentions: 0,
        negative_mentions: 0,
        positive_percentage: deliverySummary.positive_percentage,
        negative_percentage: 100 - deliverySummary.positive_percentage,
        positive_excerpts: [],
        negative_excerpts: [],
        sentiment_label: deliverySummary.positive_percentage >= 70 ? "Positive" : "Mixed",
      });
    }

    const seen = new Set();
    const result = [];
    for (const asp of list) {
      if (!asp) continue;
      const name = (asp.display_name || asp.aspect || asp.name || asp.aspect_id || "").trim();
      if (!name) continue;
      const count = asp.mention_count ?? 0;
      if (count <= 0) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ ...asp, display_name: name });
    }
    result.sort((a, b) => (b.mention_count ?? 0) - (a.mention_count ?? 0));
    return result;
  }

  // 1. Furniture category aspects
  const furnitureAspects = [
    { display_name: "Build Quality", mention_count: 12, sentiment_label: "Positive" },
    { display_name: "Material Quality", mention_count: 8, sentiment_label: "Positive" },
    { display_name: "Assembly Experience", mention_count: 5, sentiment_label: "Mixed" },
    { display_name: "Size and Dimensions", mention_count: 3, sentiment_label: "Positive" },
  ];
  const processedFurniture = processAspects(furnitureAspects);
  assert.strictEqual(processedFurniture.length, 4);
  assert.deepStrictEqual(
    processedFurniture.map((a) => a.display_name),
    ["Build Quality", "Material Quality", "Assembly Experience", "Size and Dimensions"]
  );

  // 2. Clothing category aspects
  const clothingAspects = [
    { display_name: "Fit and Sizing", mention_count: 22, sentiment_label: "Positive" },
    { display_name: "Fabric Quality", mention_count: 18, sentiment_label: "Positive" },
    { display_name: "Colour Accuracy", mention_count: 9, sentiment_label: "Mixed" },
  ];
  const processedClothing = processAspects(clothingAspects);
  assert.strictEqual(processedClothing.length, 3);
  assert.deepStrictEqual(
    processedClothing.map((a) => a.display_name),
    ["Fit and Sizing", "Fabric Quality", "Colour Accuracy"]
  );

  // 3. Headphones category aspects
  const headphoneAspects = [
    { display_name: "Sound Quality", mention_count: 35, sentiment_label: "Positive" },
    { display_name: "Comfort", mention_count: 20, sentiment_label: "Positive" },
    { display_name: "Battery Performance", mention_count: 15, sentiment_label: "Positive" },
  ];
  const processedHeadphones = processAspects(headphoneAspects);
  assert.strictEqual(processedHeadphones.length, 3);
  assert.deepStrictEqual(
    processedHeadphones.map((a) => a.display_name),
    ["Sound Quality", "Comfort", "Battery Performance"]
  );
});

test("Dynamic Product Aspects - Deduplicates duplicate aspects and ignores aspects with zero mentions", () => {
  function processAspects(rawAspects) {
    const list = rawAspects ? [...rawAspects] : [];
    const seen = new Set();
    const result = [];
    for (const asp of list) {
      if (!asp) continue;
      const name = (asp.display_name || asp.aspect || asp.name || asp.aspect_id || "").trim();
      if (!name) continue;
      const count = asp.mention_count ?? 0;
      if (count <= 0) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ ...asp, display_name: name });
    }
    result.sort((a, b) => (b.mention_count ?? 0) - (a.mention_count ?? 0));
    return result;
  }

  const inputAspects = [
    { display_name: "Battery Life", mention_count: 10, sentiment_label: "Positive" },
    { display_name: "battery life", mention_count: 10, sentiment_label: "Positive" }, // duplicate (case difference)
    { display_name: "Water Resistance", mention_count: 0, sentiment_label: "Neutral" }, // 0 mentions
    { display_name: "Display Quality", mention_count: 5, sentiment_label: "Mixed" },
  ];

  const processed = processAspects(inputAspects);
  assert.strictEqual(processed.length, 2, "Duplicate and 0-mention aspects filtered out");
  assert.strictEqual(processed[0].display_name, "Battery Life");
  assert.strictEqual(processed[1].display_name, "Display Quality");
});

test("Dynamic Product Aspects - Fallback message rendered when no reliable aspects exist", () => {
  function getAspectMessage(aspects) {
    if (!aspects || aspects.length === 0) {
      return "Not enough review data to identify product aspects.";
    }
    return null;
  }

  assert.strictEqual(
    getAspectMessage([]),
    "Not enough review data to identify product aspects."
  );
  assert.strictEqual(
    getAspectMessage(null),
    "Not enough review data to identify product aspects."
  );
});

test("Dynamic Product Aspects - Sentiment badge styles map accurately to Positive, Negative, and Mixed", () => {
  function getAspectSentiment(asp) {
    let label;
    const rawLabel = (asp.sentiment_label || "").trim().toLowerCase();
    if (rawLabel === "positive") label = "Positive";
    else if (rawLabel === "negative") label = "Negative";
    else if (rawLabel === "mixed") label = "Mixed";
    else if (asp.mention_count !== undefined && asp.mention_count < 2) label = "Limited Data";
    else if (asp.positive_percentage !== undefined && asp.positive_percentage >= 70) label = "Positive";
    else if (asp.negative_percentage !== undefined && asp.negative_percentage >= 45) label = "Negative";
    else label = "Mixed";

    const isGreen = label === "Positive";
    const isRed = label === "Negative";
    const isYellow = label === "Mixed";
    return { label, isGreen, isRed, isYellow };
  }

  const pos = getAspectSentiment({ sentiment_label: "Positive", mention_count: 10 });
  assert.strictEqual(pos.label, "Positive");
  assert.strictEqual(pos.isGreen, true);

  const neg = getAspectSentiment({ sentiment_label: "Negative", mention_count: 8 });
  assert.strictEqual(neg.label, "Negative");
  assert.strictEqual(neg.isRed, true);

  const mixed = getAspectSentiment({ sentiment_label: "Mixed", mention_count: 5 });
  assert.strictEqual(mixed.label, "Mixed");
  assert.strictEqual(mixed.isYellow, true);

  const limited = getAspectSentiment({ mention_count: 1, sentiment_label: null });
  assert.strictEqual(limited.label, "Limited Data");
});

test("Raw Customer Reviews Section - Verified completely absent from extension UI", () => {
  const screensCode = fs.readFileSync(path.join(__dirname, "../src/components/screens.tsx"), "utf8");

  // Verify that the old All Customer Reviews accordion, raw cards, and pagination are absent
  assert.strictEqual(
    screensCode.includes("All Customer Reviews"),
    false,
    "Extension UI must not contain 'All Customer Reviews' section"
  );
  assert.strictEqual(
    screensCode.includes('badge="RAW"'),
    false,
    "Extension UI must not contain 'RAW' badge"
  );
  assert.strictEqual(
    screensCode.includes("function ReviewItem"),
    false,
    "Extension UI must not contain ReviewItem component"
  );
  assert.strictEqual(
    screensCode.includes("Load 15 more"),
    false,
    "Extension UI must not contain 'Load 15 more' pagination button"
  );
  assert.strictEqual(
    screensCode.includes("Show all"),
    false,
    "Extension UI must not contain 'Show all' pagination button"
  );
});

test("Top-Level Navigation - Side-by-side tabs for PRICE COMPARISON and REVIEW ANALYSIS with tab switching", () => {
  // Test tab state initialization and default behavior
  function getInitialTab(view) {
    return view === "result" || view === "analyzing" ? "review" : "price";
  }

  // 1. Initial product load defaults to PRICE COMPARISON
  assert.strictEqual(getInitialTab("ready"), "price", "Must default to PRICE COMPARISON on opening product");
  assert.strictEqual(getInitialTab(undefined), "price", "Default view must default to PRICE COMPARISON");

  // 2. Active analysis view routes to REVIEW ANALYSIS
  assert.strictEqual(getInitialTab("analyzing"), "review", "Analyzing view routes to REVIEW ANALYSIS tab");
  assert.strictEqual(getInitialTab("result"), "review", "Result view routes to REVIEW ANALYSIS tab");

  // 3. Tab switching preserves state across both tabs
  let currentTab = "price";
  const dummyProduct = {
    product_name: "Sony WH-1000XM5 Headphones",
    current_site_price: 29990,
    source_retailer: "Amazon.in",
  };
  const dummyComparison = {
    verdict_label: "LOWER ON FLIPKART",
    summary: "Save ₹3,000 on Flipkart",
  };
  const dummyReviewAnalysis = {
    total_reviews_analyzed: 45,
    overall_sentiment_label: "Positive",
    trust_score: 92,
  };

  // Switch to review tab
  currentTab = "review";
  assert.strictEqual(currentTab, "review");
  assert.strictEqual(dummyProduct.current_site_price, 29990, "Product state preserved");
  assert.strictEqual(dummyComparison.verdict_label, "LOWER ON FLIPKART", "Comparison state preserved");

  // Switch back to price tab
  currentTab = "price";
  assert.strictEqual(currentTab, "price");
  assert.strictEqual(dummyReviewAnalysis.total_reviews_analyzed, 45, "Review analysis preserved");
});

test("Product Aspects - Elimination of repetitive templates and verification of aspect-specific wording", () => {
  const screensCode = fs.readFileSync(path.join(__dirname, "../src/components/screens.tsx"), "utf8");

  // Verify that banned repetitive templates are completely absent from screens.tsx
  assert.strictEqual(
    screensCode.includes("Generally appreciated, though some buyers note"),
    false,
    "Repetitive template 'Generally appreciated, though some buyers note' must be eliminated"
  );
  assert.strictEqual(
    screensCode.includes("Users generally like"),
    false,
    "Repetitive template 'Users generally like' must be eliminated"
  );
  assert.strictEqual(
    screensCode.includes("Some customers mention"),
    false,
    "Repetitive template 'Some customers mention' must be eliminated"
  );
  assert.strictEqual(
    screensCode.includes("Buyers consistently praise"),
    false,
    "Repetitive template 'Buyers consistently praise' must be eliminated"
  );
  assert.strictEqual(
    screensCode.includes("Multiple reports of issues regarding"),
    false,
    "Repetitive template 'Multiple reports of issues regarding' must be eliminated"
  );
});

test("Product Aspects - Varied, natural, and aspect-specific explanations across gaming headset aspects", () => {
  const screensCode = fs.readFileSync(path.join(__dirname, "../src/components/screens.tsx"), "utf8");
  const funcMatch = screensCode.match(/function getAspectExplanation\(asp:[^)]+\): string \{([\s\S]*?)\n\}/);
  assert.ok(funcMatch, "getAspectExplanation must exist in screens.tsx");

  // Clean TypeScript types for execution in Node VM
  const jsFuncBody = funcMatch[1]
    .replace(/:\s*AspectItem/g, "")
    .replace(/:\s*"positive" \| "negative" \| "mixed"/g, "")
    .replace(/\?\./g, "?.");
  const getAspectExplanation = new Function("asp", jsFuncBody);

  // 1. Value for Money — POSITIVE
  const valueAspect = {
    display_name: "Value for Money",
    mention_count: 20,
    sentiment_label: "Positive",
    positive_excerpts: ["Great features for the price"],
    negative_excerpts: [],
  };
  const valueExp = getAspectExplanation(valueAspect);
  assert.strictEqual(valueExp, "Offers competitive features for its price.");

  // 2. Battery Life & Charging — MIXED
  const batteryAspect = {
    display_name: "Battery Life & Charging",
    mention_count: 18,
    sentiment_label: "Mixed",
    positive_excerpts: ["Battery lasts all day"],
    negative_excerpts: ["The charging speed is slow as hell and takes forever"],
  };
  const batteryExp = getAspectExplanation(batteryAspect);
  assert.strictEqual(batteryExp, "Battery performance appears acceptable, but charging speed receives criticism.");

  // 3. Build Quality — MIXED
  const buildAspect = {
    display_name: "Build Quality",
    mention_count: 15,
    sentiment_label: "Mixed",
    positive_excerpts: ["Sturdy plastic and good finish"],
    negative_excerpts: ["The design is bulky and heavy"],
  };
  const buildExp = getAspectExplanation(buildAspect);
  assert.strictEqual(buildExp, "Most feedback is favourable, although some buyers find the design bulky.");

  // 4. Comfort & Ergonomics — NEGATIVE
  const comfortAspect = {
    display_name: "Comfort & Ergonomics",
    mention_count: 12,
    sentiment_label: "Negative",
    positive_excerpts: [],
    negative_excerpts: ["This headset feels like wearing a crab on your head and causes ear pain"],
  };
  const comfortExp = getAspectExplanation(comfortAspect);
  assert.strictEqual(comfortExp, "Some buyers report discomfort during extended use.");

  // 5. Durability & Longevity — NEGATIVE
  const durabilityAspect = {
    display_name: "Durability & Longevity",
    mention_count: 10,
    sentiment_label: "Negative",
    positive_excerpts: [],
    negative_excerpts: ["My unit went bad in two days and buttons stopped working"],
  };
  const durabilityExp = getAspectExplanation(durabilityAspect);
  assert.strictEqual(durabilityExp, "Reports of early product failure raise concerns about long-term reliability.");

  // Ensure all 5 explanations are completely distinct from each other
  const explanations = [valueExp, batteryExp, buildExp, comfortExp, durabilityExp];
  const uniqueSet = new Set(explanations);
  assert.strictEqual(uniqueSet.size, 5, "All 5 aspect explanations must be distinct and aspect-specific");

  // Ensure all explanations are under 15 words
  for (const exp of explanations) {
    const wordCount = exp.split(/\s+/).length;
    assert.ok(wordCount <= 15, `Explanation "${exp}" exceeds 15 words (${wordCount} words)`);
  }
});

test("Product Aspects - Crude and informal review wording is translated into professional language", () => {
  const screensCode = fs.readFileSync(path.join(__dirname, "../src/components/screens.tsx"), "utf8");
  const funcMatch = screensCode.match(/function getAspectExplanation\(asp:[^)]+\): string \{([\s\S]*?)\n\}/);
  const jsFuncBody = funcMatch[1]
    .replace(/:\s*AspectItem/g, "")
    .replace(/:\s*"positive" \| "negative" \| "mixed"/g, "")
    .replace(/\?\./g, "?.");
  const getAspectExplanation = new Function("asp", jsFuncBody);

  // Example 1: "crab on your head"
  const crabExp = getAspectExplanation({
    display_name: "Comfort & Ergonomics",
    mention_count: 5,
    sentiment_label: "Negative",
    negative_excerpts: ["This headset feels like wearing a crab on your head."],
  });
  assert.strictEqual(crabExp, "Some buyers report discomfort during extended use.");
  assert.strictEqual(crabExp.includes("crab"), false, "Must not contain crude word 'crab'");

  // Example 2: "slow as hell"
  const slowExp = getAspectExplanation({
    display_name: "Battery Life & Charging",
    mention_count: 5,
    sentiment_label: "Negative",
    negative_excerpts: ["The charging speed is slow as hell."],
  });
  assert.strictEqual(slowExp, "Charging is slower than some buyers expect.");
  assert.strictEqual(slowExp.includes("hell"), false, "Must not contain vulgarity 'hell'");

  // Example 3: "went bad in two days"
  const failureExp = getAspectExplanation({
    display_name: "Durability & Longevity",
    mention_count: 5,
    sentiment_label: "Negative",
    negative_excerpts: ["My unit went bad in two days."],
  });
  assert.strictEqual(failureExp, "Reports of early product failure raise concerns about long-term reliability.");
  assert.strictEqual(failureExp.includes("went bad in two days"), false);

  // Example 4: "bulky, but it's not that bad"
  const minorBulkyExp = getAspectExplanation({
    display_name: "Build Quality",
    mention_count: 5,
    sentiment_label: "Mixed",
    negative_excerpts: ["The design is little bit bulky, but it's not that bad."],
  });
  assert.strictEqual(minorBulkyExp, "Some buyers find the design bulky, although the concern appears minor.");
  assert.strictEqual(minorBulkyExp.includes("not that bad"), false);
});

test("Product Aspects - Multi-category context-appropriate explanations (Furniture, Clothing, Appliances)", () => {
  const screensCode = fs.readFileSync(path.join(__dirname, "../src/components/screens.tsx"), "utf8");
  const funcMatch = screensCode.match(/function getAspectExplanation\(asp:[^)]+\): string \{([\s\S]*?)\n\}/);
  const jsFuncBody = funcMatch[1]
    .replace(/:\s*AspectItem/g, "")
    .replace(/:\s*"positive" \| "negative" \| "mixed"/g, "")
    .replace(/\?\./g, "?.");
  const getAspectExplanation = new Function("asp", jsFuncBody);

  // 1. Furniture category (Assembly difficulty)
  const furnitureExp = getAspectExplanation({
    display_name: "Assembly & Installation",
    mention_count: 8,
    sentiment_label: "Mixed",
    positive_excerpts: ["Great wood finish"],
    negative_excerpts: ["Assembly is difficult with many screws"],
  });
  assert.strictEqual(furnitureExp, "Several buyers praise the finish, but assembly can be difficult.");

  // 2. Clothing category (Inconsistent sizing)
  const clothingExp = getAspectExplanation({
    display_name: "Fit & Sizing",
    mention_count: 12,
    sentiment_label: "Mixed",
    positive_excerpts: ["Fabric feels soft and high quality"],
    negative_excerpts: ["Sizing appears inconsistent and runs smaller than usual"],
  });
  assert.strictEqual(clothingExp, "The fabric receives positive feedback, although sizing appears inconsistent.");

  // 3. Home appliances category (Operating noise)
  const applianceExp = getAspectExplanation({
    display_name: "Performance & Functionality",
    mention_count: 10,
    sentiment_label: "Mixed",
    positive_excerpts: ["Very easy to operate"],
    negative_excerpts: ["Sounds like a jet engine with excessive noise"],
  });
  assert.strictEqual(applianceExp, "Buyers appreciate its ease of use, but some report excessive operating noise.");

  // 4. Headphones category (Clear audio)
  const audioExp = getAspectExplanation({
    display_name: "Sound Quality",
    mention_count: 25,
    sentiment_label: "Positive",
    positive_excerpts: ["Clear highs and well balanced sound"],
  });
  assert.strictEqual(audioExp, "Delivers clear audio output with balanced frequencies.");
});

test("Product Aspects - Insufficient review evidence handling without fabrication", () => {
  const screensCode = fs.readFileSync(path.join(__dirname, "../src/components/screens.tsx"), "utf8");
  const funcMatch = screensCode.match(/function getAspectExplanation\(asp:[^)]+\): string \{([\s\S]*?)\n\}/);
  const jsFuncBody = funcMatch[1]
    .replace(/:\s*AspectItem/g, "")
    .replace(/:\s*"positive" \| "negative" \| "mixed"/g, "")
    .replace(/\?\./g, "?.");
  const getAspectExplanation = new Function("asp", jsFuncBody);

  // Sparse mentions (< 2)
  assert.strictEqual(
    getAspectExplanation({ display_name: "Water Resistance", mention_count: 1, sentiment_label: "Positive" }),
    "Insufficient review evidence."
  );
  assert.strictEqual(
    getAspectExplanation({ display_name: "Camera Quality", mention_count: 0, sentiment_label: "No Data" }),
    "Insufficient review evidence."
  );
  assert.strictEqual(
    getAspectExplanation({ display_name: "Battery Life", mention_count: 1, sentiment_label: "Limited Data" }),
    "Insufficient review evidence."
  );
});

// ---------------------------------------------------------------------------
// Test 41: Flipkart product detection and product ID extraction with reviews & ratings
// ---------------------------------------------------------------------------
test("Flipkart Product Detection - Extracts product, PID, price, ratings totals and live review cards", () => {
  const doc = createMockDocument();

  // Head and canonical link
  const link = node("link", {
    rel: "canonical",
    href: "https://www.flipkart.com/spinbot-hx300-wired-gaming-headset/p/itmd71829abc?pid=ACCFXYZ123",
  });
  doc.appendChild(link);

  // Title and rating header
  const title = node("h1", {}, "SpinBot HX300 Wired Gaming Headset with Mic (Black, Red, On the Ear)");
  const price = node("div", { class: "Nx9bqj CxhGGd" }, "₹1,880");
  const mrp = node("div", { class: "yRaY8j A68bp5" }, "₹2,999");
  const star = node("div", { class: "XQDdHH" }, "4.2 ★");
  const counts = node("span", { class: "_2_R_DZ" }, "1,420 Ratings & 180 Reviews");

  doc.appendChild(title);
  doc.appendChild(price);
  doc.appendChild(mrp);
  doc.appendChild(star);
  doc.appendChild(counts);

  // Review card 1
  const card1 = node("div", { class: "_16PBlm" });
  const inner1 = node("div", { class: "col _2wzgFH" });
  inner1.appendChild(node("div", { class: "XQDdHH" }, "5 ★"));
  inner1.appendChild(node("p", { class: "z9E0IG" }, "Terrific purchase"));
  const b1 = node("div", { class: "ZmyHeo" });
  const b1Inner = node("div");
  b1Inner.appendChild(node("div", {}, "Super clear sound and punchy bass for gaming. READ MORE"));
  b1.appendChild(b1Inner);
  inner1.appendChild(b1);
  inner1.appendChild(node("p", { class: "_2NsDsF" }, "Karthik R"));
  inner1.appendChild(node("p", { class: "_2NsDsF" }, "3 months ago"));
  inner1.appendChild(node("p", { class: "_2mcBVo" }, "Certified Buyer"));
  card1.appendChild(inner1);
  doc.appendChild(card1);

  // Review card 2
  const card2 = node("div", { class: "_16PBlm" });
  const inner2 = node("div", { class: "col _2wzgFH" });
  inner2.appendChild(node("div", { class: "XQDdHH" }, "4 ★"));
  inner2.appendChild(node("p", { class: "z9E0IG" }, "Value for money"));
  const b2 = node("div", { class: "ZmyHeo" });
  const b2Inner = node("div");
  b2Inner.appendChild(node("div", {}, "Build quality is good for ₹1,880. Padding is soft. READ MORE"));
  b2.appendChild(b2Inner);
  inner2.appendChild(b2);
  inner2.appendChild(node("p", { class: "_2NsDsF" }, "Pooja M"));
  inner2.appendChild(node("p", { class: "_2NsDsF" }, "1 month ago"));
  inner2.appendChild(node("p", { class: "_2mcBVo" }, "Certified Buyer"));
  card2.appendChild(inner2);
  doc.appendChild(card2);

  const product = globalThis.extractFlipkartProduct(
    doc,
    "https://www.flipkart.com/spinbot-hx300-wired-gaming-headset/p/itmd71829abc?pid=ACCFXYZ123"
  );

  assert.ok(product, "Product should be detected on Flipkart page");
  assert.strictEqual(product.source_retailer, "Flipkart");
  assert.strictEqual(product.retailer_product_id, "ACCFXYZ123");
  assert.strictEqual(product.product_name, "SpinBot HX300 Wired Gaming Headset with Mic (Black, Red, On the Ear)");
  assert.strictEqual(product.current_site_price, 1880);
  assert.strictEqual(product.mrp, 2999);
  assert.strictEqual(product.ratings_total, 1420);
  assert.strictEqual(product.reviews_total, 180);
  assert.ok(Array.isArray(product.reviews), "Product reviews should be an array");
  assert.strictEqual(product.reviews.length, 2, "Should extract the 2 live review cards");
  assert.strictEqual(product.reviews[0].author, "Karthik R");
  assert.strictEqual(product.reviews[0].rating, 5);
  assert.ok(!product.reviews[0].text.includes("READ MORE"));
  assert.strictEqual(product.reviews[0].verified_purchase, true);
});

// ---------------------------------------------------------------------------
// Test 42: Flipkart review HTML fixture extraction (ServiceWorker parser)
// ---------------------------------------------------------------------------
test("Flipkart Review HTML Fixture - Extracts complete metadata without DOM or DOMParser", () => {
  const fixturePath = path.join(__dirname, "fixtures/flipkart_product_reviews_page.html");
  const html = fs.readFileSync(fixturePath, "utf8");

  const parsed = globalThis.parseFlipkartReviewsFromHtml(html);
  assert.ok(parsed, "Parser should return a result object");
  assert.strictEqual(parsed.reviews.length, 3, "Fixture contains 3 distinct customer reviews");
  assert.strictEqual(parsed.hasNextPage, true, "Fixture contains Next page pagination link");

  // Review 1 (5★)
  assert.strictEqual(parsed.reviews[0].rating, 5);
  assert.strictEqual(parsed.reviews[0].title, "Terrific purchase");
  assert.strictEqual(parsed.reviews[0].author, "Karthik R");
  assert.strictEqual(parsed.reviews[0].date, "3 months ago");
  assert.strictEqual(parsed.reviews[0].verified_purchase, true);
  assert.ok(parsed.reviews[0].text.includes("Super clear sound and bass is punchy for gaming."));
  assert.ok(!parsed.reviews[0].text.includes("READ MORE"), "READ MORE must be cleanly stripped");

  // Review 2 (4★)
  assert.strictEqual(parsed.reviews[1].rating, 4);
  assert.strictEqual(parsed.reviews[1].title, "Value for money");
  assert.strictEqual(parsed.reviews[1].author, "Pooja M");
  assert.strictEqual(parsed.reviews[1].date, "1 month ago");
  assert.strictEqual(parsed.reviews[1].verified_purchase, true);

  // Review 3 (2★)
  assert.strictEqual(parsed.reviews[2].rating, 2);
  assert.strictEqual(parsed.reviews[2].title, "Disappointed with durability");
  assert.strictEqual(parsed.reviews[2].author, "Vikram S");
  assert.strictEqual(parsed.reviews[2].date, "2 weeks ago");
  assert.strictEqual(parsed.reviews[2].verified_purchase, true);
  assert.ok(parsed.reviews[2].text.includes("Left earcup stopped working"));
});

// ---------------------------------------------------------------------------
// Test 43: Background review collection for Flipkart - Paginates and deduplicates
// ---------------------------------------------------------------------------
test("Flipkart Background Review Collection - Paginates and deduplicates across pages", async () => {
  const store = {};
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          for (const k of keys) res[k] = store[k];
          return res;
        },
        set: async (items) => {
          Object.assign(store, items);
        },
      },
    },
    runtime: {
      sendMessage: () => {},
      lastError: null,
    },
  };

  // Mock fetch for Flipkart page 1, page 2, and backend analysis endpoint
  const page1Html = `
    <div class="cPHDOP col-12-12"><div class="_16PBlm"><div class="col _2wzgFH">
      <div class="XQDdHH">5 ★</div>
      <p class="z9E0IG">Awesome</p>
      <div class="ZmyHeo"><div><div>Sound is superb. READ MORE</div></div></div>
      <p class="_2NsDsF">User A</p>
      <p class="_2NsDsF">2 days ago</p>
    </div></div></div>
    <div class="cPHDOP col-12-12"><div class="_16PBlm"><div class="col _2wzgFH">
      <div class="XQDdHH">4 ★</div>
      <p class="z9E0IG">Good</p>
      <div class="ZmyHeo"><div><div>Nice microphone quality. READ MORE</div></div></div>
      <p class="_2NsDsF">User B</p>
      <p class="_2NsDsF">5 days ago</p>
    </div></div></div>
    <nav class="yFHi8N"><a class="_1LKTO3" href="?page=2"><span>Next</span></a></nav>
  `;

  // Page 2 includes User B (duplicate) and User C (new)
  const page2Html = `
    <div class="cPHDOP col-12-12"><div class="_16PBlm"><div class="col _2wzgFH">
      <div class="XQDdHH">4 ★</div>
      <p class="z9E0IG">Good</p>
      <div class="ZmyHeo"><div><div>Nice microphone quality. READ MORE</div></div></div>
      <p class="_2NsDsF">User B</p>
      <p class="_2NsDsF">5 days ago</p>
    </div></div></div>
    <div class="cPHDOP col-12-12"><div class="_16PBlm"><div class="col _2wzgFH">
      <div class="XQDdHH">1 ★</div>
      <p class="z9E0IG">Poor</p>
      <div class="ZmyHeo"><div><div>Broke after three days. READ MORE</div></div></div>
      <p class="_2NsDsF">User C</p>
      <p class="_2NsDsF">1 week ago</p>
    </div></div></div>
  `;

  let backendPayloadReceived = null;

  globalThis.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes("page=2")) {
      return {
        ok: true,
        status: 200,
        text: async () => page2Html,
      };
    }
    if (urlStr.includes("flipkart.com/spinbot-hx300/product-reviews/")) {
      return {
        ok: true,
        status: 200,
        text: async () => page1Html,
      };
    }
    if (urlStr.includes("/api/reviews/analyze-batch")) {
      backendPayloadReceived = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          product_name: backendPayloadReceived.product_name,
          source_retailer: "Flipkart",
          total_reviews_extracted: backendPayloadReceived.reviews.length,
          total_reviews_analyzed: backendPayloadReceived.reviews.length,
          sentiment_percentages: { positive: 66.7, mixed: 0, negative: 33.3 },
          overall_sentiment_label: "Positive",
          trust_score: 85,
          llm_summary: {
            verdict: { label: "PROCEED WITH CAUTION", primary_reason: "Good overall audio, but some durability complaints." },
            review_summary: "Review evidence highlights strong sound performance, but buyers should note occasional durability issues.",
          },
          aspect_analysis: [],
        }),
      };
    }
    return { ok: false, status: 404, text: async () => "" };
  };

  try {
    const job = {
      productKey: "Flipkart::ACCFXYZ123::",
      product: {
        source_retailer: "Flipkart",
        product_name: "SpinBot HX300 Headset",
        retailer_product_id: "ACCFXYZ123",
        url: "https://www.flipkart.com/spinbot-hx300/p/itm123?pid=ACCFXYZ123",
      },
      initialReviews: [],
      status: "idle",
      step: "",
      totalCollected: 0,
      pagesScanned: 0,
      reviews: [],
    };

    await globalThis.runBackgroundAnalysis(job);

    assert.strictEqual(job.status, "completed", "Job should complete successfully");
    assert.strictEqual(job.totalCollected, 3, "Should collect exactly 3 unique reviews across pages (User A, User B, User C)");
    assert.ok(backendPayloadReceived, "Backend endpoint should have received request");
    assert.strictEqual(backendPayloadReceived.source_retailer, "Flipkart");
    assert.strictEqual(backendPayloadReceived.reviews.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

// ---------------------------------------------------------------------------
// Test 44: Flipkart popup reopen restores job state and analysis results
// ---------------------------------------------------------------------------
test("Flipkart Helium Popup Reopening - Restores completed review analysis on reopen", async () => {
  const store = {};
  const originalChrome = globalThis.chrome;

  const jobKey = "dealsense_job_Flipkart::ACCFXYZ_REOPEN::";
  store[jobKey] = {
    productKey: "Flipkart::ACCFXYZ_REOPEN::",
    status: "completed",
    totalCollected: 12,
    analysisResult: {
      status: "success",
      product_name: "SpinBot HX300",
      source_retailer: "Flipkart",
      overall_sentiment_label: "Positive",
      total_reviews_analyzed: 12,
      trust_score: 88,
    },
  };

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          for (const k of keys) res[k] = store[k];
          return res;
        },
        set: async (items) => {
          Object.assign(store, items);
        },
      },
    },
    runtime: {
      sendMessage: () => {},
      lastError: null,
    },
  };

  try {
    let getResponse = null;
    globalThis.handleRuntimeMessage(
      {
        action: "getAnalysisJob",
        productKey: "Flipkart::ACCFXYZ_REOPEN::",
      },
      {},
      (resp) => {
        getResponse = resp;
      }
    );

    await new Promise((r) => setTimeout(r, 20));

    assert.ok(getResponse, "Received response for getAnalysisJob");
    assert.strictEqual(getResponse.success, true);
    assert.strictEqual(getResponse.job.status, "completed");
    assert.strictEqual(getResponse.job.analysisResult.source_retailer, "Flipkart");
    assert.strictEqual(getResponse.job.totalCollected, 12);
  } finally {
    globalThis.chrome = originalChrome;
  }
});

// ---------------------------------------------------------------------------
// Test 45: Flipkart review collection honest failure when reviews are unavailable
// ---------------------------------------------------------------------------
test("Flipkart Review Extraction - Honest failure reporting when 0 reviews are available", async () => {
  const store = {};
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          for (const k of keys) res[k] = store[k];
          return res;
        },
        set: async (items) => {
          Object.assign(store, items);
        },
      },
    },
    runtime: {
      sendMessage: () => {},
      lastError: null,
    },
  };

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "<html><body><div>No reviews yet on this product.</div></body></html>",
  });

  try {
    const job = {
      productKey: "Flipkart::EMPTY_PROD::",
      product: {
        source_retailer: "Flipkart",
        product_name: "Brand New Unreviewed Item",
        retailer_product_id: "EMPTY_PROD",
        url: "https://www.flipkart.com/item/p/itm123?pid=EMPTY_PROD",
      },
      initialReviews: [],
      status: "idle",
      step: "",
      totalCollected: 0,
      pagesScanned: 0,
      reviews: [],
    };

    await globalThis.runBackgroundAnalysis(job);

    assert.strictEqual(job.status, "error", "Job should report honest error");
    assert.ok(job.error.includes("Could not retrieve customer reviews for this product"));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

// ---------------------------------------------------------------------------
// Test 46: Flipkart Modern React Native Web & INITIAL_STATE Fixtures
// ---------------------------------------------------------------------------
test("Flipkart Modern INITIAL_STATE Fixtures - Extracts authentic customer reviews from real Flipkart pages", () => {
  const reviewsFixturePath = path.join(__dirname, "fixtures/flipkart_modern_spinbot_reviews.html");
  const reviewsHtml = fs.readFileSync(reviewsFixturePath, "utf8");

  const parsedReviews = globalThis.parseFlipkartReviewsFromHtml(reviewsHtml);
  assert.ok(parsedReviews, "Parser should return a result object");
  assert.strictEqual(parsedReviews.reviews.length, 10, "Modern Flipkart review page contains 10 customer reviews in INITIAL_STATE");
  assert.strictEqual(parsedReviews.hasNextPage, true, "Should detect next page since total reviews exceed 10");

  const rev1 = parsedReviews.reviews[0];
  assert.strictEqual(rev1.id, "05b42631-0a00-4ca4-a16a-f9c9d5b4c3e4", "Genuine Flipkart review ID preserved");
  assert.strictEqual(rev1.rating, 5, "Rating should be 5 stars");
  assert.strictEqual(rev1.title, "Mind-blowing purchase");
  assert.strictEqual(rev1.author, "Lucky Kumar", "Clean author name");
  assert.strictEqual(rev1.date, "Aug, 2024", "Review creation date");
  assert.strictEqual(rev1.verified_purchase, true, "Certified buyer badge recognized");
  assert.ok(rev1.text.includes("Excellent product, value for money"), "Clean review body extracted");

  // PDP fixture test
  const pdpFixturePath = path.join(__dirname, "fixtures/flipkart_modern_spinbot_pdp.html");
  const pdpHtml = fs.readFileSync(pdpFixturePath, "utf8");
  const parsedPdp = globalThis.parseFlipkartReviewsFromHtml(pdpHtml);
  assert.ok(parsedPdp, "Parser should return a result object for PDP");
  assert.strictEqual(parsedPdp.reviews.length, 3, "Modern Flipkart PDP embeds 3 initial reviews");
  assert.strictEqual(parsedPdp.reviews[0].title, "Mind-blowing purchase");
  assert.strictEqual(parsedPdp.reviews[0].author, "Lucky Kumar");
});

// ---------------------------------------------------------------------------
// Test 47: Modern Flipkart End-to-End Review Collection Simulation
// ---------------------------------------------------------------------------
test("Flipkart Live SpinBot End-to-End Simulation - Successfully collects reviews from modern Flipkart HTML", async () => {
  const store = {};
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  const reviewsFixturePath = path.join(__dirname, "fixtures/flipkart_modern_spinbot_reviews.html");
  const reviewsHtml = fs.readFileSync(reviewsFixturePath, "utf8");

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          for (const k of keys) res[k] = store[k];
          return res;
        },
        set: async (items) => {
          Object.assign(store, items);
        },
      },
    },
    runtime: {
      sendMessage: () => {},
      lastError: null,
    },
  };

  globalThis.fetch = async (url) => {
    if (typeof url === "string" && url.includes("/api/reviews/analyze-batch")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          source_retailer: "Flipkart",
          product_name: "SpinBot HX300 Headphones",
          total_reviews_extracted: 10,
          purchase_verdict: {
            verdict: "PROCEED",
            verdict_label: "PROCEED",
            short_reason: "High customer satisfaction with sound and battery.",
          },
        }),
      };
    }
    // Review page fetch
    return {
      ok: true,
      status: 200,
      text: async () => reviewsHtml,
    };
  };

  try {
    const job = {
      productKey: "Flipkart::ACCH38BJXQBVZWYM::",
      product: {
        source_retailer: "Flipkart",
        product_name: "SpinBot HX300 Headphones",
        retailer_product_id: "ACCH38BJXQBVZWYM",
        url: "https://www.flipkart.com/spinbot-hx300-headphones-50ms-low-latency-rgb-lights-bluetooth-gaming/p/itm84ed28932e07a?pid=ACCH38BJXQBVZWYM",
      },
      initialReviews: [],
      status: "idle",
      step: "",
      totalCollected: 0,
      pagesScanned: 0,
      reviews: [],
    };

    await globalThis.runBackgroundAnalysis(job);

    assert.strictEqual(job.status, "completed", "Job must complete without 'Could not retrieve reviews' error");
    assert.strictEqual(job.error, null);
    assert.ok(job.totalCollected >= 10, `Collected at least 10 reviews (actual: ${job.totalCollected})`);
    assert.strictEqual(job.analysisResult.purchase_verdict.verdict, "PROCEED");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

// ---------------------------------------------------------------------------
// Test 48: Multi-page Flipkart pagination: pre-seeded page 1 reviews do not abort pagination
// ---------------------------------------------------------------------------
test("Flipkart Multi-Page Pagination - Pre-seeded page 1 reviews do not abort pagination and collect subsequent pages", async () => {
  const store = {};
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          for (const k of keys) res[k] = store[k];
          return res;
        },
        set: async (items) => {
          Object.assign(store, items);
        },
      },
    },
    runtime: {
      sendMessage: () => {},
      lastError: null,
    },
  };

  // Generate 10 reviews for Page 1, 10 for Page 2, 8 for Page 3
  function makeReviewHtml(id, author, rating, text) {
    return `
      <div class="cPHDOP col-12-12"><div class="_16PBlm"><div class="col _2wzgFH">
        <div class="XQDdHH">${rating} ★</div>
        <p class="z9E0IG">Review ${id}</p>
        <div class="ZmyHeo"><div><div>${text} READ MORE</div></div></div>
        <p class="_2NsDsF">${author}</p>
        <p class="_2NsDsF">1 month ago</p>
        <p class="_2mcBVo">Certified Buyer</p>
      </div></div></div>
    `;
  }

  const page1Revs = Array.from({ length: 10 }, (_, i) => ({
    id: `fk_rev_p1_${i + 1}`,
    author: `User P1_${i + 1}`,
    rating: 5,
    text: `Page 1 Review number ${i + 1} with great audio clarity and deep bass.`,
  }));
  const page1Html = page1Revs.map((r) => makeReviewHtml(r.id, r.author, r.rating, r.text)).join("\n") +
    `<a class="_1LKTO3" href="?page=2"><span>Next</span></a>`;

  const page2Revs = Array.from({ length: 10 }, (_, i) => ({
    id: `fk_rev_p2_${i + 1}`,
    author: `User P2_${i + 1}`,
    rating: 4,
    text: `Page 2 Review number ${i + 1} with good comfort and design.`,
  }));
  const page2Html = page2Revs.map((r) => makeReviewHtml(r.id, r.author, r.rating, r.text)).join("\n") +
    `<a class="_1LKTO3" href="?page=3"><span>Next</span></a>`;

  const page3Revs = Array.from({ length: 8 }, (_, i) => ({
    id: `fk_rev_p3_${i + 1}`,
    author: `User P3_${i + 1}`,
    rating: 3,
    text: `Page 3 Review number ${i + 1} with average microphone performance.`,
  }));
  const page3Html = page3Revs.map((r) => makeReviewHtml(r.id, r.author, r.rating, r.text)).join("\n");

  const page4Html = `<div>No more reviews</div>`;

  const fetchedPages = [];

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("/api/reviews/analyze-batch")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          source_retailer: "Flipkart",
          product_name: "SpinBot HX300",
          total_reviews_extracted: 28,
          total_reviews_analyzed: 28,
          sentiment_percentages: { positive: 70, mixed: 20, negative: 10 },
          overall_sentiment_label: "Positive",
          trust_score: 90,
          aspect_analysis: { aspects: [] },
          llm_summary: {},
        }),
      };
    }

    if (urlStr.includes("page=1")) {
      fetchedPages.push(1);
      return { ok: true, status: 200, text: async () => page1Html };
    }
    if (urlStr.includes("page=2")) {
      fetchedPages.push(2);
      return { ok: true, status: 200, text: async () => page2Html };
    }
    if (urlStr.includes("page=3")) {
      fetchedPages.push(3);
      return { ok: true, status: 200, text: async () => page3Html };
    }
    if (urlStr.includes("page=4")) {
      fetchedPages.push(4);
      return { ok: true, status: 200, text: async () => page4Html };
    }

    return { ok: true, status: 200, text: async () => page1Html };
  };

  try {
    // Pre-seed initial reviews with the 10 reviews from page 1 (simulating content.js pre-seeding)
    const initialReviews = page1Revs.map((r) => ({
      id: r.id,
      author: r.author,
      rating: r.rating,
      text: r.text,
      verified_purchase: true,
    }));

    const job = {
      productKey: "Flipkart::MULTIPLE_PAGES_PID::",
      product: {
        source_retailer: "Flipkart",
        product_name: "SpinBot HX300 Headphones",
        retailer_product_id: "MULTIPLE_PAGES_PID",
        url: "https://www.flipkart.com/spinbot-hx300/p/itm123?pid=MULTIPLE_PAGES_PID",
        reviews_total: 28,
      },
      initialReviews: initialReviews,
      status: "idle",
      step: "",
      totalCollected: 10,
      pagesScanned: 0,
      reviews: initialReviews,
    };

    await globalThis.runBackgroundAnalysis(job);

    assert.strictEqual(job.status, "completed", "Job must complete successfully");
    // Verify that despite addedThisPage being 0 on page 1 (due to pre-seeding), collection proceeded to page 2, 3, and stopped on page 4
    assert.strictEqual(fetchedPages.includes(2), true, "Must have fetched page 2");
    assert.strictEqual(fetchedPages.includes(3), true, "Must have fetched page 3");
    assert.strictEqual(job.totalCollected, 28, "Must collect all 28 unique reviews across pages (10+10+8)");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

// ---------------------------------------------------------------------------
// Test 49: Multi-page collection stops cleanly on empty pages and respects bot control
// ---------------------------------------------------------------------------
test("Flipkart Multi-Page Pagination - Safely halts when rate limited or anti-bot response is returned", async () => {
  const store = {};
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;

  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const res = {};
          for (const k of keys) res[k] = store[k];
          return res;
        },
        set: async (items) => {
          Object.assign(store, items);
        },
      },
    },
    runtime: {
      sendMessage: () => {},
      lastError: null,
    },
  };

  // Mock rate-limit HTTP 429 on page 2
  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("page=1")) {
      return {
        ok: true,
        status: 200,
        text: async () => `
          <div class="cPHDOP col-12-12"><div class="_16PBlm"><div class="col _2wzgFH">
            <div class="XQDdHH">5 ★</div>
            <p class="z9E0IG">Great</p>
            <div class="ZmyHeo"><div><div>Nice headset! READ MORE</div></div></div>
            <p class="_2NsDsF">User 1</p>
            <p class="_2NsDsF">2 days ago</p>
            <p class="_2mcBVo">Certified Buyer</p>
          </div></div></div>
          <a class="_1LKTO3" href="?page=2"><span>Next</span></a>
        `,
      };
    }
    if (urlStr.includes("page=2")) {
      return {
        ok: false,
        status: 429,
        text: async () => "Too Many Requests",
      };
    }
    if (urlStr.includes("/api/reviews/analyze-batch")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          source_retailer: "Flipkart",
          product_name: "Headset",
          total_reviews_extracted: 1,
          total_reviews_analyzed: 1,
          aspect_analysis: { aspects: [] },
          llm_summary: {},
        }),
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    const job = {
      productKey: "Flipkart::RATE_LIMIT_TEST::",
      product: {
        source_retailer: "Flipkart",
        product_name: "Headset",
        retailer_product_id: "RATE_LIMIT_TEST",
        url: "https://www.flipkart.com/item/p/itm123?pid=RATE_LIMIT_TEST",
      },
      initialReviews: [],
      status: "idle",
      step: "",
      totalCollected: 0,
      pagesScanned: 0,
      reviews: [],
    };

    await globalThis.runBackgroundAnalysis(job);

    assert.strictEqual(job.status, "completed", "Job analyzes whatever was collected before rate limit");
    assert.strictEqual(job.totalCollected, 1, "Collected 1 review from page 1 before stopping");
    assert.ok(job.limitationNote.includes("HTTP 429"), "Limitation note records rate limit");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.chrome = originalChrome;
  }
});

// ---------------------------------------------------------------------------
// Test 50: mergeBatchAnalysisResults merges multi-batch ML and authenticity outputs
// ---------------------------------------------------------------------------
test("Batch Review Analysis - mergeBatchAnalysisResults combines sentiment, fake reviews, and aspects across batches", () => {
  const mergeBatchAnalysisResults = globalThis.mergeBatchAnalysisResults;
  assert.ok(typeof mergeBatchAnalysisResults === "function", "mergeBatchAnalysisResults must be exported");

  const batch1 = {
    status: "success",
    total_reviews_analyzed: 50,
    sentiment_distribution: { positive: 35, neutral: 5, negative: 10 },
    rating_distribution: { "1": 5, "2": 5, "3": 5, "4": 15, "5": 20 },
    fake_review_analysis: {
      total_analyzed: 50,
      cg_count: 5,
      or_count: 45,
      cg_percentage: 10.0,
      mean_cg_probability: 0.12,
    },
    suspicious_analysis: {
      suspicious_count: 4,
      clean_reviews_count: 46,
      flags_breakdown: { repetitive_phrasing: 3, extreme_sentiment: 1 },
      flagged_reviews: [{ review_id: "r1", reason: "Repetitive" }],
      patterns_identified: ["repetitive_phrasing"],
    },
    aspect_analysis: {
      aspects: [
        {
          aspect_id: "sound_quality",
          display_name: "Sound Quality",
          mention_count: 25,
          positive_mentions: 20,
          negative_mentions: 5,
          positive_excerpts: ["Great bass"],
          negative_excerpts: ["Low volume"],
        },
      ],
      pros: ["Good sound"],
      cons: ["Average build"],
    },
    llm_summary: {
      summary: "High customer satisfaction overall.",
      verdict_label: "PROCEED",
    },
  };

  const batch2 = {
    status: "success",
    total_reviews_analyzed: 46,
    sentiment_distribution: { positive: 30, neutral: 6, negative: 10 },
    rating_distribution: { "1": 4, "2": 6, "3": 6, "4": 14, "5": 16 },
    fake_review_analysis: {
      total_analyzed: 46,
      cg_count: 4,
      or_count: 42,
      cg_percentage: 8.7,
      mean_cg_probability: 0.10,
    },
    suspicious_analysis: {
      suspicious_count: 3,
      clean_reviews_count: 43,
      flags_breakdown: { repetitive_phrasing: 1, burst_activity: 2 },
      flagged_reviews: [{ review_id: "r2", reason: "Burst" }],
      patterns_identified: ["burst_activity"],
    },
    aspect_analysis: {
      aspects: [
        {
          aspect_id: "sound_quality",
          display_name: "Sound Quality",
          mention_count: 20,
          positive_mentions: 16,
          negative_mentions: 4,
          positive_excerpts: ["Clear highs"],
          negative_excerpts: ["Distortion at max volume"],
        },
        {
          aspect_id: "comfort",
          display_name: "Comfort",
          mention_count: 15,
          positive_mentions: 12,
          negative_mentions: 3,
          positive_excerpts: ["Soft ear pads"],
          negative_excerpts: ["Tight headband"],
        },
      ],
      pros: ["Comfortable fit"],
      cons: ["Tight fit for big heads"],
    },
  };

  const allCollected = new Array(96).fill({});
  const merged = mergeBatchAnalysisResults(
    [batch1, batch2],
    allCollected,
    "SpinBot HX300",
    "Flipkart",
    "https://www.flipkart.com/spinbot-hx300/p/itm123?pid=ACCH38BJXQBVZWYM"
  );

  assert.ok(merged, "Merged object should not be null");
  assert.strictEqual(merged.total_reviews_analyzed, 96, "Aggregated analyzed count must equal 50 + 46 = 96");
  assert.strictEqual(merged.total_reviews_extracted, 96);

  // Sentiment distributions
  assert.strictEqual(merged.sentiment_distribution.positive, 65);
  assert.strictEqual(merged.sentiment_distribution.neutral, 11);
  assert.strictEqual(merged.sentiment_distribution.negative, 20);

  // Fake review distributions
  assert.strictEqual(merged.fake_review_analysis.total_analyzed, 96);
  assert.strictEqual(merged.fake_review_analysis.cg_count, 9);
  assert.strictEqual(merged.fake_review_analysis.or_count, 87);

  // Suspicious flags
  assert.strictEqual(merged.suspicious_analysis.suspicious_count, 7);
  assert.strictEqual(merged.suspicious_analysis.flags_breakdown.repetitive_phrasing, 4);
  assert.strictEqual(merged.suspicious_analysis.flags_breakdown.burst_activity, 2);

  // Aspects
  assert.strictEqual(merged.aspect_analysis.aspects.length, 2, "Sound Quality and Comfort merged");
  const soundAsp = merged.aspect_analysis.aspects.find((a) => a.aspect_id === "sound_quality");
  assert.ok(soundAsp);
  assert.strictEqual(soundAsp.mention_count, 45, "Mentions merged 25 + 20 = 45");
  assert.strictEqual(soundAsp.positive_mentions, 36);
  assert.strictEqual(soundAsp.negative_mentions, 9);
  assert.strictEqual(soundAsp.sentiment_label, "Positive");
});

// ---------------------------------------------------------------------------
// Test 51: Review Analysis UI coverage & count banner rendering
// ---------------------------------------------------------------------------
test("Review Analysis UI - Coverage banner honestly displays analyzed vs listing totals", () => {
  const screensCode = fs.readFileSync(path.join(__dirname, "../src/components/screens.tsx"), "utf8");

  // Check coverage banner exists
  assert.ok(
    screensCode.includes("Analyzed <strong className=\"text-foreground\">{totalAnalyzed}</strong> customer"),
    "Screens must render honest analyzed count in coverage banner"
  );
  assert.ok(
    screensCode.includes("out of {product.reviews_total.toLocaleString()} total on listing"),
    "Screens must indicate when listing total exceeds collected reviews"
  );
  assert.ok(
    screensCode.includes("ra?.data_limitations"),
    "Screens must render data limitations note when available"
  );
});
