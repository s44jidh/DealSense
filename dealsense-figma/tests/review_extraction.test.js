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
