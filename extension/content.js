/**
 * DealSense — Content Script
 * Supports product detection and extraction on both Amazon India (amazon.in) and Flipkart (flipkart.com).
 * Enforces strict canonical main product scoping, retailer-specific ID isolation,
 * and prevents sponsored banners, recommendations, or search suggestions from contaminating extraction.
 */

// ---------------------------------------------------------------------------
// 1. Shared Utilities
// ---------------------------------------------------------------------------

function parsePriceText(text) {
  if (!text) return null;
  // If currency symbol present, extract price following it
  const currMatch = text.match(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)/i);
  if (currMatch && currMatch[1]) {
    const num = parseFloat(currMatch[1].replace(/,/g, ""));
    if (!isNaN(num) && num > 0) return num;
  }
  // Otherwise filter out discount percentages like '-45%' or '45% off'
  const noDiscount = text
    .replace(/-\s*\d+%\s*/g, " ")
    .replace(/\d+%\s*off/gi, " ")
    .replace(/\(\s*\d+%\s*\)/g, " ");
  const cleaned = noDiscount.replace(/,/g, "").replace(/[^\d.]/g, " ").trim();
  const match = cleaned.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const num = parseFloat(match[0]);
  return isNaN(num) || num <= 0 ? null : num;
}

function isValidHttpUrl(u) {
  if (!u || typeof u !== "string") return false;
  const trimmed = u.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return false;
  if (trimmed.includes("transparent-pixel") || trimmed.includes("grey-pixel") || trimmed.includes("data:image")) return false;
  return true;
}

function getJsonLdProduct(doc) {
  if (!doc) return null;
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const s of Array.from(scripts)) {
    try {
      const parsed = JSON.parse(s.textContent || "");
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && (item["@type"] === "Product" || item["@type"] === "IndividualProduct")) {
          return item;
        }
      }
    } catch (e) {}
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2. Amazon India Extractor
// ---------------------------------------------------------------------------

function extractAmazonProduct(customDoc, customUrl, options = {}) {
  const doc = customDoc || (typeof document !== "undefined" ? document : null);
  const href = customUrl || (typeof window !== "undefined" ? window.location.href : "");
  if (!doc) return null;

  let hostname = "";
  try {
    hostname = new URL(href).hostname;
  } catch (e) {
    if (typeof window !== "undefined") hostname = window.location.hostname || "";
  }
  if (!hostname.includes("amazon.in")) {
    return null;
  }

  // 1. Main Product Title prioritizing #productTitle (Requirement 1)
  let productName = "";
  const productTitleEl = doc.querySelector("#productTitle");
  if (productTitleEl && productTitleEl.textContent) {
    productName = productTitleEl.textContent.trim().replace(/\s+/g, " ");
  }

  // Fallbacks if #productTitle is absent or empty
  if (!productName || productName.length === 0) {
    const fallbackTitleSelectors = [
      "a[data-hook='product-link']",
      "#cm_cr_product_info h1 a",
      "#cm_cr_product_info a.a-link-normal",
      "[data-hook='cr-product-title']",
      "#cr-product-details a",
      "#titleSection #title",
      "h1#title",
      "#title span",
      "h1.a-size-large",
      "#title_feature_div #title",
    ];
    for (const sel of fallbackTitleSelectors) {
      const el = doc.querySelector(sel);
      if (el && el.textContent) {
        const clean = el.textContent.trim().replace(/\s+/g, " ");
        if (clean.length > 0) {
          productName = clean;
          break;
        }
      }
    }
  }

  // Fallback to meta title or document.title if still empty
  if (!productName || productName.length === 0) {
    const metaTitle = doc.querySelector("meta[name='title']");
    if (metaTitle && metaTitle.getAttribute("content")) {
      productName = metaTitle.getAttribute("content").trim().replace(/\s+/g, " ");
    }
  }
  if (!productName && doc.title && typeof doc.title === "string") {
    const cleanDocTitle = doc.title
      .replace(/^Amazon\.in\s*:\s*/i, "")
      .replace(/\s*:\s*Amazon\.in.*/i, "")
      .replace(/\s*Buy.*Online at Low Prices.*/i, "")
      .trim();
    if (cleanDocTitle.length > 0) {
      productName = cleanDocTitle;
    }
  }

  if (!productName || productName.length === 0) {
    return null;
  }

  // 2. Product ASIN and Canonical URL (Requirement 2)
  const asin = extractAmazonAsin(doc, href);
  if (!asin) {
    return null;
  }
  const url = `https://www.amazon.in/dp/${asin}`;

  // 3. Selling Price - Scoped strictly to core price containers
  let price = null;
  const mainPriceContainers = [
    doc.querySelector("#corePriceDisplay_desktop_feature_div"),
    doc.querySelector("#corePrice_desktop"),
    doc.querySelector("#corePrice_feature_div"),
    doc.querySelector("#apex_desktop"),
    doc.querySelector("#desktop_unifiedPrice"),
    doc.querySelector("#price"),
    doc.querySelector("#centerCol .priceToPay"),
    doc.querySelector("#centerCol .apexPriceToPay"),
    doc.querySelector("#ppd .priceToPay"),
    doc.querySelector("#desktop_buybox .priceToPay"),
    doc.querySelector("#price_inside_buybox"),
    doc.querySelector("#newBuyBoxPrice"),
    doc.querySelector("#buybox"),
    doc.querySelector("#buybox_feature_div"),
    doc.querySelector("#buyNew_section"),
    doc.querySelector("#corePrice_mobile_feature_div"),
    doc.querySelector("#corePrice_mobile"),
    doc.querySelector(".reinventPricePriceToPayMargin"),
    doc.querySelector("#cm_cr_product_info"),
    doc.querySelector("#cr-product-details"),
    doc.querySelector(".product-info"),
    doc.querySelector(".product-info-price"),
    doc.querySelector("#newAccordionRow_1"),
    doc.querySelector("#tp_price_block_total_price_ww"),
  ].filter(Boolean);

  const priceSelectors = [
    ".apexPriceToPay .a-offscreen",
    ".priceToPay .a-offscreen",
    "span.a-price.priceToPay span.a-offscreen",
    "span.a-price.apexPriceToPay span.a-offscreen",
    "#priceblock_dealprice",
    "#priceblock_ourprice",
    "#priceblock_saleprice",
    "span#tp_price_block_total_price_ww span.a-offscreen",
    "span.a-color-price",
    "span.a-price span.a-offscreen",
    ".priceToPay .a-price-whole",
    ".apexPriceToPay .a-price-whole",
    "span.a-price-whole",
    "#price_inside_buybox",
    "#newBuyBoxPrice",
  ];

  for (const container of mainPriceContainers) {
    for (const selector of priceSelectors) {
      const el = container.querySelector(selector);
      if (el && el.textContent) {
        const parsed = parsePriceText(el.textContent);
        if (parsed !== null && parsed > 0) {
          price = parsed;
          break;
        }
      }
    }
    if (price !== null) break;
  }

  if (price === null) {
    const directSelectors = [
      ".priceToPay .a-offscreen",
      ".apexPriceToPay .a-offscreen",
      "#cm_cr_product_info .a-color-price",
      "#price_inside_buybox",
      "#newBuyBoxPrice",
      ".priceToPay .a-price-whole",
      ".apexPriceToPay .a-price-whole",
      "#corePriceDisplay_desktop_feature_div .a-price-whole",
      "#corePrice_desktop .a-price-whole",
      ".reinventPricePriceToPayMargin .a-price-whole",
      "span.a-price.priceToPay",
      "span.a-price-whole",
    ];
    for (const sel of directSelectors) {
      const el = doc.querySelector(sel);
      if (el && el.textContent) {
        const parsed = parsePriceText(el.textContent);
        if (parsed !== null && parsed > 0) {
          price = parsed;
          break;
        }
      }
    }
  }

  // 3. Structured JSON-LD Data
  let jsonLd = null;
  if (doc.querySelectorAll) {
    try {
      const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        if (s && s.textContent) {
          try {
            const parsed = JSON.parse(s.textContent);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
              if (item && (item["@type"] === "Product" || item["@type"] === "IndividualProduct")) {
                jsonLd = item;
                break;
              }
            }
          } catch (e) {}
        }
        if (jsonLd) break;
      }
    } catch (e) {}
  }

  if (price === null && jsonLd && jsonLd.offers) {
    const offers = jsonLd.offers;
    const offerPrice = Array.isArray(offers) ? (offers[0]?.price || offers[0]?.lowPrice) : (offers.price || offers.lowPrice);
    if (offerPrice) {
      const parsedLd = parseFloat(String(offerPrice).replace(/,/g, ""));
      if (!isNaN(parsedLd) && parsedLd > 0) {
        price = parsedLd;
      }
    }
  }

  // Price is optional for review analysis (do not reject if 0/null)
  const sellingPrice = (price !== null && price > 0) ? price : 0;

  // 4. MRP
  const mrp = sellingPrice > 0 ? extractAmazonMrp(doc, sellingPrice) : null;

  // 5. Seller
  const seller = extractAmazonSeller(doc, jsonLd);

  // 6. Brand and Model
  const brand = extractAmazonBrand(doc, productName, jsonLd);
  const model = extractAmazonModel(doc, productName, brand, jsonLd);
  const category = extractAmazonCategory(doc, productName, jsonLd);

  // 7. Specifications
  const specs = extractAmazonSpecifications(doc, jsonLd);

  // 7b. Rating & Total Ratings
  const { rating, ratingsTotal, reviewsTotal } = extractAmazonRating(doc, jsonLd);

  // 8. Image
  let image = extractAmazonImage(doc);
  if (!image && jsonLd && jsonLd.image) {
    image = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
  }
  if (!image) {
    const revImg = doc.querySelector("[data-hook='cr-product-image'] img, #cm_cr_product_info img");
    if (revImg) {
      image = revImg.getAttribute ? (revImg.getAttribute("src") || revImg.src) : revImg.src;
    }
  }

  // 9. Variant Details
  const variant = extractAmazonVariant(doc);

  // 10. Reviews strictly for this product from the DOM
  const reviews = (options && options.skipReviews) ? [] : extractAmazonReviews(doc);

  // 11. All Reviews page URL directly from product page DOM
  let allReviewsUrl = null;
  const allReviewsLinkEl = doc.querySelector
    ? doc.querySelector("a[data-hook='see-all-reviews-link-foot'], a[data-hook='see-all-reviews-link'], #reviews-medley-footer a, #cr-pagination-footer-0 a")
    : null;
  if (allReviewsLinkEl) {
    const rawHref = (allReviewsLinkEl.getAttribute && allReviewsLinkEl.getAttribute("href")) || allReviewsLinkEl.href;
    if (rawHref) {
      if (rawHref.startsWith("http")) {
        allReviewsUrl = rawHref;
      } else {
        allReviewsUrl = `https://www.amazon.in${rawHref.startsWith("/") ? "" : "/"}${rawHref}`;
      }
    }
  }

  // Requirement 7: Debug logging
  console.log("[DealSense Debug Content Script]", {
    event: "amazon_product_extracted",
    title: productName,
    asin: asin || "N/A",
    url: url,
    price: sellingPrice,
    seller: seller,
    brand: brand,
    model: model,
    category: category,
    rating: rating,
    ratingsTotal: ratingsTotal,
    reviewCount: reviews.length,
    allReviewsUrl: allReviewsUrl,
    source: "live_dom"
  });

  return {
    source_retailer: "Amazon.in",
    product_name: productName,
    product_title: productName,
    url: url,
    product_url: url,
    all_reviews_url: allReviewsUrl,
    current_site_price: sellingPrice,
    current_price: sellingPrice,
    currency: "INR",
    mrp: mrp,
    seller: seller || "Seller unavailable",
    brand: brand || "Unavailable",
    model: model || "Unavailable",
    specifications: specs,
    image: image,
    image_url: image,
    variant: variant,
    asin: asin,
    retailer_product_id: asin,
    manufacturer_part_number: null,
    category: category || null,
    rating: rating,
    ratings_total: ratingsTotal,
    reviews_total: reviewsTotal,
    availability: sellingPrice > 0 ? "IN_STOCK" : "UNAVAILABLE",
    reviews: reviews,
    scan_metadata: {
      pages_scanned: 1,
      total_reviews_found: reviews.length,
      has_more: Boolean(doc.querySelector && doc.querySelector("li.a-last a, #cm_cr-pagination_bar .a-last a, ul.a-pagination li.a-last a")),
      limitation_note: null,
    },
    analysis_source: "live_dom",
  };
}

function extractAmazonAsin(doc, url) {
  if (url) {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/(?:dp|product|gp\/product|product-reviews)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
      if (m) return m[1].toUpperCase();

      const qAsin = u.searchParams.get("asin") || u.searchParams.get("ASIN");
      if (qAsin && /^[A-Z0-9]{10}$/i.test(qAsin.trim())) {
        return qAsin.trim().toUpperCase();
      }
    } catch (e) {}
  }

  // Check product link on review page
  if (doc && doc.querySelector) {
    const prodLink = doc.querySelector("a[data-hook='product-link'], #cm_cr_product_info a");
    if (prodLink) {
      const href = prodLink.getAttribute ? prodLink.getAttribute("href") : prodLink.href;
      if (href) {
        const m = href.match(/\/(?:dp|product|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
        if (m) return m[1].toUpperCase();
      }
    }
  }

  const asinInputs = [
    doc.querySelector('input#ASIN[name="ASIN"]'),
    doc.querySelector("input#ASIN"),
    doc.querySelector('input[name="ASIN"]'),
    doc.querySelector('input[name="asin"]'),
    doc.querySelector("input#asin"),
  ].filter(Boolean);

  for (const input of asinInputs) {
    const val = input.value || (input.getAttribute ? input.getAttribute("value") : null);
    if (val && /^[A-Z0-9]{10}$/i.test(val.trim())) {
      return val.trim().toUpperCase();
    }
  }

  const dataAsinEls = [
    doc.querySelector("#cerberus-data-metrics[data-asin]"),
    doc.querySelector("#dp[data-asin]"),
    doc.querySelector("[data-asin]"),
  ].filter(Boolean);

  for (const el of dataAsinEls) {
    const val = el.getAttribute ? el.getAttribute("data-asin") : null;
    if (val && /^[A-Z0-9]{10}$/i.test(val.trim())) {
      return val.trim().toUpperCase();
    }
  }

  const container = doc.querySelector("#detailBullets_feature_div, #prodDetails, #productDetails_feature_div, #technicalSpecifications_section_1");
  if (container) {
    const text = container.textContent || "";
    const m = text.match(/ASIN\s*[:\u200e\s]+([A-Z0-9]{10})/i);
    if (m) return m[1].toUpperCase();
  }

  return null;
}


function extractAmazonBrand(doc, title, jsonLd) {
  // 1. JSON-LD structured brand
  if (jsonLd && jsonLd.brand) {
    const bName = typeof jsonLd.brand === "string" ? jsonLd.brand : jsonLd.brand.name;
    if (bName && typeof bName === "string" && bName.trim().length > 0 && !/^(generic|unknown|unavailable)$/i.test(bName.trim())) {
      return bName.trim();
    }
  }

  // 2. Byline info (#bylineInfo)
  const byline = doc.querySelector("#bylineInfo, a#bylineInfo, .author a, #bylineInfo .author a");
  if (byline && byline.textContent) {
    let raw = byline.textContent.trim();
    raw = raw.replace(/^Visit the\s+/i, "")
      .replace(/\s+Store$/i, "")
      .replace(/^Brand:\s*/i, "")
      .replace(/^by\s+/i, "")
      .replace(/\s*\((?:Author|Contributor|Editor)\).*$/i, "")
      .trim();
    if (raw.length > 0 && !/^(visit|store)$/i.test(raw)) {
      return raw;
    }
  }

  // 3. Overview table brand
  const overviewBrand = doc.querySelector(
    "#productOverview_feature_div tr.po-brand .po-break-word, #productOverview_feature_div tr.po-brand td:nth-child(2) span, tr.po-brand .a-span9 span"
  );
  if (overviewBrand && overviewBrand.textContent) {
    const raw = overviewBrand.textContent.trim();
    if (raw) return raw;
  }

  // 4. Detail bullets
  const container = doc.querySelector("#detailBullets_feature_div, #prodDetails, #productDetails_feature_div");
  if (container && container.textContent) {
    const m = container.textContent.match(/(?:Manufacturer|Brand)\s*[:\u200e\s]+([^\n\r<]+)/i);
    if (m && m[1]) {
      const b = m[1].replace(/[\u200e\u200f]/g, "").trim();
      if (b.length > 0 && !/generic/i.test(b)) return b;
    }
  }

  // 5. Tech spec tables
  const rows = doc.querySelectorAll("#productDetails_techSpec_section_1 tr, #prodDetails table tr, #technicalSpecifications_section_1 tr");
  for (const r of rows) {
    const th = r.querySelector("th") || (r.children && r.children.length > 0 ? r.children[0] : null);
    const td = r.querySelector ? (r.querySelector("td.a-size-base") || (r.children && r.children.length > 1 ? r.children[1] : null)) : null;
    if (th && td && th.textContent && td.textContent && /brand|manufacturer/i.test(th.textContent)) {
      const val = td.textContent.trim();
      if (val.length > 0 && !/generic/i.test(val)) return val;
    }
  }

  // 6. Generic Title brand extraction (first token if capitalized)
  if (title) {
    const titleTrim = title.trim();
    const multiWord = [
      "ant esports", "cosmic byte", "red gear", "redgear", "evo fox", "evofox",
      "royal kludge", "turtle beach", "western digital", "blue star", "us polo assn",
      "u.s. polo assn.", "american tourister", "tommy hilfiger", "calvin klein",
      "marks & spencer", "morphy richards", "eureka forbes", "hot wheels", "fire-boltt"
    ];
    const tLower = titleTrim.toLowerCase();
    for (const mw of multiWord) {
      if (tLower.startsWith(mw)) {
        return mw.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      }
    }
    const firstWordMatch = titleTrim.match(/^([A-Za-z0-9&'.]+)(?:\s+|$)/);
    if (firstWordMatch) {
      const candidate = firstWordMatch[1].replace(/['’]s$/i, "");
      const nonBrandKeywords = /^(new|best|hot|top|pack|set|the|a|an|all|men|women|unisex|kids|boys|girls|combo|super|original|genuine)$/i;
      if (candidate.length >= 2 && !nonBrandKeywords.test(candidate)) {
        return candidate.charAt(0).toUpperCase() + candidate.slice(1);
      }
    }
  }

  console.log("[DealSense Debug Extractor]", {
    field: "brand",
    status: "Unavailable",
    reason: "No brand byline or overview row found in Amazon DOM",
  });
  return "Unavailable";
}

function extractAmazonModel(doc, title, brand, jsonLd) {
  // 1. JSON-LD model or mpn
  if (jsonLd && jsonLd.model && typeof jsonLd.model === "string" && jsonLd.model.trim().length > 0) {
    return jsonLd.model.trim();
  }
  if (jsonLd && jsonLd.mpn && typeof jsonLd.mpn === "string" && jsonLd.mpn.trim().length > 0 && !/^[A-Z0-9]{10}$/.test(jsonLd.mpn)) {
    return jsonLd.mpn.trim();
  }

  // 2. Overview table model rows
  const modelSelectors = [
    "#productOverview_feature_div tr.po-model_name .po-break-word",
    "#productOverview_feature_div tr.po-model_name td:nth-child(2) span",
    "tr.po-model_name .a-span9 span",
    "#productOverview_feature_div tr.po-model_number .po-break-word",
    "tr.po-model_number .a-span9 span",
  ];
  for (const sel of modelSelectors) {
    const el = doc.querySelector(sel);
    if (el && el.textContent) {
      const raw = el.textContent.trim();
      if (raw.length > 0) return raw;
    }
  }

  // 3. Tech spec tables
  const rows = doc.querySelectorAll(
    "#productDetails_techSpec_section_1 tr, #technicalSpecifications_section_1 tr, #prodDetails table tr"
  );
  for (const r of rows) {
    const th = r.querySelector("th") || (r.children && r.children.length > 0 ? r.children[0] : null);
    const tds = r.querySelectorAll ? r.querySelectorAll("td") : [];
    const td = r.querySelector ? (r.querySelector("td.a-size-base") || (tds.length > 0 ? tds[tds.length - 1] : null)) : null;
    if (th && td && th.textContent && td.textContent && th !== td) {
      if (/model(?:\s+name|\s+number)?/i.test(th.textContent)) {
        const raw = td.textContent.trim();
        if (raw.length > 0) return raw;
      }
    }
  }

  // 4. Detail bullets
  const bullets = doc.querySelectorAll("#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li");
  for (const li of bullets) {
    const text = li.textContent || "";
    if (/item\s*model\s*number|model\s*name|model\s*number/i.test(text)) {
      const spans = li.querySelectorAll ? li.querySelectorAll("span") : [];
      let val = spans.length >= 2 ? (spans[spans.length - 1].textContent || "").trim() : "";
      if (!val || /item\s*model/i.test(val)) {
        val = text.replace(/^.*?(?:number|name)\s*[:\u200e\s]*/i, "").trim();
      }
      val = val.replace(/[\u200e\u200f]/g, "").trim();
      if (val.length > 0 && !/unavailable/i.test(val)) return val;
    }
  }

  const container = doc.querySelector("#detailBullets_feature_div");
  if (container && container.textContent) {
    const m = container.textContent.match(/Item model number\s*[:\u200e\s]+([^\n\r<]+)/i);
    if (m && m[1]) {
      const mod = m[1].replace(/[\u200e\u200f]/g, "").trim();
      if (mod.length > 0) return mod;
    }
  }

  // 4b. Book ISBN extraction
  const bulletsContainer = doc.querySelector("#detailBullets_feature_div, #detailBulletsWrapper_feature_div, #prodDetails");
  if (bulletsContainer && bulletsContainer.textContent) {
    const mIsbn = bulletsContainer.textContent.match(/ISBN-(?:13|10)\s*[:\u200e\s]+([0-9Xx\-]+)/i);
    if (mIsbn && mIsbn[1]) {
      const isbnClean = mIsbn[1].replace(/[\u200e\u200f\s]/g, "").trim();
      if (isbnClean.length >= 9) return isbnClean;
    }
  }

  // 5. Fallback to title-based model inference when DOM rows are missing
  const inferred = inferModelFromTitle(title, brand);
  if (inferred) return inferred;

  console.log("[DealSense Debug Extractor]", {
    field: "model",
    status: "Unavailable",
    reason: "No model name or number row found in Amazon DOM",
  });
  return "Unavailable";
}

function inferModelFromTitle(title, brand) {
  if (!title || typeof title !== "string") return null;
  const t = title.trim();

  // 1. Controller models
  const mCtrl = t.match(/\b(superpower|supernova(?:\s*lite)?|combatant|cosmos|ares(?:\s*pro)?|stellaris|quantum|elite\s*x|surge\s*xb|surge|pro\s*wireless|gp\s*300|gp\s*310|gp\s*325|gp\s*365|gp\s*400|f310|f710|claw\s*shoot|interceptor|speedlink)\b/i);
  if (mCtrl) return mCtrl[1].trim();

  // 2. Mouse models
  const mMouse = t.match(/\b(gm\s*\d{3,4}|g\s*502(?:\s*hero|\s*x|\s*lightspeed)?|g\s*402|g\s*304|g\s*102|g\s*pro|deathadder(?:\s*essential|\s*v2|\s*v3)?|viper(?:\s*mini|\s*v2|\s*v3)?|basilisk(?:\s*v2|\s*v3)?|cobra|m\s*711|m\s*601|centrophorus|kylon|invader|stormrage)\b/i);
  if (mMouse) return mMouse[1].trim();

  // 3. Keyboard models
  const mKb = t.match(/\b(mk\s*\d{3,4}(?:\s*mini|\s*pro)?|k\s*552(?:\s*kumara)?|k\s*530(?:\s*draconic)?|k\s*617(?:\s*fizz)?|kumara|dragonborn|fizz|g\s*213|g\s*413|g\s*512|blackwidow|huntsman|ornata|deathstalker|cb-gk-\d+|firefly|quantum|pandora|deimos)\b/i);
  if (mKb) return mKb[1].trim();

  // 4. Smartphone / Laptop / Audio models
  const mDevice = t.match(/\b(iphone\s*\d+(?:\s*pro\s*max|\s*pro|\s*plus)?|macbook\s*(?:air|pro)|galaxy\s*[sz]\d+(?:\s*ultra|\s*plus|\s*fe)?|pixel\s*\d+[a-z]?|wh\s*[-]?\s*1000xm\d|wf\s*[-]?\s*1000xm\d|wh\s*[-]?\s*ch\d{3}|rockerz\s*\d+)\b/i);
  if (mDevice) return mDevice[1].trim();

  // 5. Model codes with slash or hyphen (e.g. HD9200/90, QT4011/15, GA-2100, PKOSS 1.5, K552-RGB)
  const mSlashCode = t.match(/\b([A-Z0-9]{2,6}[-/][A-Z0-9]{1,6})\b/i);
  if (mSlashCode) {
    const cand = mSlashCode[1].trim();
    if (!/^\d+(?:gb|tb|mb|ghz|mhz|hz|w|v|mah|k|p|dpi|g|kg|cm|mm)$/i.test(cand)) {
      return cand;
    }
  }

  // 6. Generic Appliance & Kitchen Codes (e.g. PKOSS 1.5, PKOSS, HD9200, QT4011, GC1905)
  const mAppliance = t.match(/\b([A-Z]{2,6}(?:\s*\d+(?:\.\d+)?)?)\b/);
  if (mAppliance) {
    const cand = mAppliance[1].trim();
    const commonIgnored = /^(RGB|LED|USB|OLED|QLED|FHD|UHD|RAM|SSD|HDD|BT|AC|DC|MRP|INR|PC|PS4|PS5|XBOX|TKL|WIFI|TWS|DPI|TRUE|FAST|PRO|PLUS|MINI|MAX|AIR|NEW|FREE)$/i;
    if (cand.length >= 3 && !commonIgnored.test(cand) && /\d/.test(cand)) {
      return cand;
    }
  }

  // 7. Alphanumeric model numbers (e.g. GP300, MK1200, K552, GM320, 10698, 511)
  const mAlphaNum = t.match(/\b([A-Z]{1,4}[- ]?\d{2,5}[A-Z0-9-]*|\b\d{3,5}\b)\b/);
  if (mAlphaNum) {
    const cand = mAlphaNum[1].trim();
    if (!/^\d+(?:gb|tb|mb|ghz|mhz|hz|w|v|mah|k|p|dpi|g|kg|cm|mm|ml|l|ltr|litre|litres)$/i.test(cand)) {
      if (cand.length >= 3) return cand;
    }
  }

  // 8. Distinctive style / series word immediately following known brand
  if (brand && brand !== "Unavailable") {
    const brandRegex = new RegExp("^.*?" + brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+", "i");
    const afterBrand = t.replace(brandRegex, "").trim();
    const firstWord = afterBrand.split(/[\s,()/-]+/)[0];
    const genericNoise = /^(rgb|wireless|wired|gaming|optical|mechanical|bluetooth|controller|mouse|keyboard|headphone|earphone|headset|usb|black|white|blue|red|green|yellow|mini|pro|plus|ultra|max|edition|series|men|women|unisex|kids|boys|girls|cotton|plastic|stainless|steel|electric|automatic|manual|regular|slim|fit|casual|formal|pack|set|classic|premium|pure|original|genuine|combo)$/i;
    if (firstWord && firstWord.length >= 3 && !genericNoise.test(firstWord)) {
      return firstWord;
    }
  }

  return null;
}

function extractAmazonRating(doc, jsonLd) {
  let rating = null;
  let ratingsTotal = null;

  if (jsonLd && jsonLd.aggregateRating && jsonLd.aggregateRating.ratingValue) {
    const r = parseFloat(String(jsonLd.aggregateRating.ratingValue));
    if (!isNaN(r) && r > 0) rating = Math.round(r * 10) / 10;
  }
  if (jsonLd && jsonLd.aggregateRating && (jsonLd.aggregateRating.reviewCount || jsonLd.aggregateRating.ratingCount)) {
    const cnt = parseInt(String(jsonLd.aggregateRating.reviewCount || jsonLd.aggregateRating.ratingCount).replace(/,/g, ""), 10);
    if (!isNaN(cnt) && cnt > 0) ratingsTotal = cnt;
  }

  if (rating === null) {
    const ratingEl = doc.querySelector("#acrPopover .a-size-base.a-color-base, #averageCustomerReviews .a-size-base, span[data-hook='rating-out-of-text']");
    if (ratingEl && ratingEl.textContent) {
      const m = ratingEl.textContent.match(/([\d.]+)\s*(?:out of|\/)/i) || ratingEl.textContent.match(/^([\d.]+)$/);
      if (m && m[1]) {
        const r = parseFloat(m[1]);
        if (!isNaN(r) && r > 0 && r <= 5) rating = Math.round(r * 10) / 10;
      }
    }
  }

  if (rating === null) {
    const starEl = doc.querySelector("#acrPopover[title], i.a-icon-star span.a-icon-alt, #averageCustomerReviews i.a-icon-star");
    if (starEl) {
      const text = starEl.getAttribute("title") || starEl.textContent || "";
      const m = text.match(/([\d.]+)\s*out of 5/i);
      if (m && m[1]) {
        const r = parseFloat(m[1]);
        if (!isNaN(r) && r > 0 && r <= 5) rating = Math.round(r * 10) / 10;
      }
    }
  }

  if (ratingsTotal === null) {
    const cntEl = doc.querySelector("#acrCustomerReviewText, #acrCustomerReviewLink span");
    if (cntEl && cntEl.textContent) {
      const cleaned = cntEl.textContent.replace(/,/g, "").replace(/[^\d]/g, " ").trim();
      const m = cleaned.match(/\d+/);
      if (m) {
        const c = parseInt(m[0], 10);
        if (!isNaN(c) && c > 0) ratingsTotal = c;
      }
    }
  }

  let reviewsTotal = null;
  if (jsonLd && jsonLd.aggregateRating && jsonLd.aggregateRating.reviewCount) {
    const c = parseInt(String(jsonLd.aggregateRating.reviewCount).replace(/,/g, ""), 10);
    if (!isNaN(c) && c > 0) reviewsTotal = c;
  }

  const revCountEl = doc.querySelector ? doc.querySelector("[data-hook='total-review-count'], #filter-info-section, #cr-filter-info-section") : null;
  if (revCountEl && revCountEl.textContent) {
    const m = revCountEl.textContent.match(/of\s+([\d,]+)\s+reviews?/i) || revCountEl.textContent.match(/([\d,]+)\s+with\s+reviews?/i);
    if (m && m[1]) {
      const c = parseInt(m[1].replace(/,/g, ""), 10);
      if (!isNaN(c) && c > 0) reviewsTotal = c;
    }
  }

  if (reviewsTotal === null) {
    const seeAllEl = doc.querySelector ? doc.querySelector("[data-hook='see-all-reviews-link-foot'], a[href*='product-reviews']") : null;
    if (seeAllEl && seeAllEl.textContent) {
      const m = seeAllEl.textContent.match(/See\s+all\s+([\d,]+)\s+(?:customer\s+)?reviews?/i) ||
                seeAllEl.textContent.match(/([\d,]+)\s+(?:customer\s+)?reviews?/i);
      if (m && m[1]) {
        const c = parseInt(m[1].replace(/,/g, ""), 10);
        if (!isNaN(c) && c > 0) reviewsTotal = c;
      }
    }
  }

  return { rating, ratingsTotal, reviewsTotal };
}

function extractAmazonCategory(doc, title, jsonLd) {
  // 1. Breadcrumbs
  const breadcrumbEls = doc.querySelectorAll(
    "#wayfinding-breadcrumbs_container ul li a, #wayfinding-breadcrumbs_feature_div ul li a, .a-breadcrumb a"
  );
  const crumbs = [];
  for (const el of breadcrumbEls) {
    const text = (el.textContent || "").trim();
    if (text && !crumbs.includes(text)) {
      crumbs.push(text);
    }
  }
  if (crumbs.length > 0) {
    return crumbs.join(" > ");
  }

  // 2. JSON-LD category
  if (jsonLd && jsonLd.category) {
    const cat = String(jsonLd.category).trim();
    if (cat.length > 0) return cat;
  }

  // 3. Generic title-based category inference across all retail sectors
  if (title) {
    const t = title.toLowerCase();

    // Electronics & Computing
    if (/\b(?:gamepad|gaming\s*controller|joystick|racing\s*wheel)\b/i.test(t)) return "Gaming Controller";
    if (/\b(?:gaming\s*mouse|wireless\s*mouse|wired\s*mouse|optical\s*mouse|\bmice\b|\bmouse\b)\b/i.test(t) && !/\b(?:mouse\s*pad|mousepad)\b/i.test(t)) return "Mouse";
    if (/\b(?:mechanical\s*keyboard|gaming\s*keyboard|wireless\s*keyboard|wired\s*keyboard|\bkeyboards?\b)\b/i.test(t)) return "Keyboard";
    if (/\b(?:headphones|headset|earphones|earbuds|airpods|neckband|tws)\b/i.test(t)) return "Audio";
    if (/\b(?:laptop|notebook|macbook|chromebook|thinkpad)\b/i.test(t)) return "Laptop";
    if (/\b(?:smartphone|mobile\s*phone|iphone|galaxy\s*[sz]\d+|redmi\s*note)\b/i.test(t)) return "Smartphone";
    if (/\b(?:internal\s*ssd|external\s*ssd|nvme|m\.2\s*ssd|hard\s*drive|solid\s*state\s*drive)\b/i.test(t)) return "Storage";
    if (/\b(?:gaming\s*monitor|led\s*monitor|pc\s*monitor|\bmonitor\b)\b/i.test(t)) return "Monitor";
    if (/\b(?:smart\s*tv|led\s*tv|oled\s*tv|qled\s*tv|television)\b/i.test(t)) return "Television";

    // Appliances & Kitchen
    if (/\b(?:refrigerator|fridge|double\s*door|single\s*door)\b/i.test(t)) return "Refrigerator";
    if (/\b(?:washing\s*machine|front\s*load|top\s*load)\b/i.test(t)) return "Washing Machine";
    if (/\b(?:air\s*conditioner|inverter\s*ac|\bac\b)\b/i.test(t)) return "Air Conditioner";
    if (/\b(?:electric\s*kettle|\bkettle\b)\b/i.test(t)) return "Electric Kettle";
    if (/\b(?:air\s*fryer|deep\s*fryer)\b/i.test(t)) return "Air Fryer";
    if (/\b(?:mixer\s*grinder|grinder|blender|juicer)\b/i.test(t)) return "Mixer Grinder";
    if (/\b(?:pressure\s*cooker|cookware|induction\s*cooktop|toaster|sandwich\s*maker|steam\s*iron|\biron\b)\b/i.test(t)) return "Kitchen & Home Appliance";

    // Footwear
    if (/\b(?:sneakers|running\s*shoes|walking\s*shoes|casual\s*shoes|sports\s*shoes|formal\s*shoes|sandals|slippers|flip\s*flops|clogs|boots|loafers)\b/i.test(t)) return "Footwear";

    // Clothing & Apparel
    if (/\b(?:jeans|t-shirt|tshirt|shirt|trousers|chinos|shorts|track\s*pants|joggers|jacket|hoodie|sweater|kurta|kurti|saree|dress)\b/i.test(t)) return "Clothing";

    // Personal Care & Grooming
    if (/\b(?:trimmer|shaver|hair\s*dryer|hair\s*straightener|electric\s*toothbrush|epilator)\b/i.test(t)) return "Personal Care";

    // Toys & Games
    if (/\b(?:lego|building\s*blocks|board\s*game|action\s*figure|toy\s*car|nerf|diecast|doll|puzzle)\b/i.test(t)) return "Toys & Games";

    // Watches
    if (/\b(?:smartwatch|smart\s*watch|analog\s*watch|chronograph|\bwatch\b)\b/i.test(t) && !/\b(?:strap|case|glass|protector)\b/i.test(t)) return "Watch";

    // Bags & Luggage
    if (/\b(?:backpack|trolley|suitcase|duffel\s*bag|luggage|laptop\s*bag)\b/i.test(t)) return "Bags & Luggage";

    // Sports & Fitness
    if (/\b(?:football|soccer\s*ball|basketball|volleyball|badminton\s*racquet|tennis\s*racquet|water\s*bottle|flask|shaker)\b/i.test(t)) return "Sports & Fitness";

    // Books
    if (/\b(?:paperback|hardcover|kindle|novel|novels|textbook|illustrated\s*edition)\b/i.test(t) || (/\bbook\b/i.test(t) && !/\b(?:macbook|chromebook|notebook|zenbook|surface)\b/i.test(t))) return "Books";

    // Beauty & Personal Care
    if (/\b(?:sunscreen|face\s*wash|serum|shampoo|conditioner|moisturizer|face\s*cream|body\s*lotion|body\s*wash|cleanser|spf\s*\d+|lip\s*balm|mascara|lipstick|beard\s*oil)\b/i.test(t)) return "Beauty & Personal Care";

    // Household Products
    if (/\b(?:detergent|dishwash|floor\s*cleaner|toilet\s*cleaner|disinfectant|surface\s*cleaner|garbage\s*bags?|trash\s*bags?|fabric\s*conditioner|liquid\s*detergent|mosquito\s*refill)\b/i.test(t)) return "Household";

    // Computer Components
    if (/\b(?:internal\s*ram|ddr[345]|graphics\s*card|gpu\b|motherboard|cpu\s*cooler|power\s*supply|psu\b)\b/i.test(t) && !/\b(?:laptop|smartphone)\b/i.test(t)) return "Computer Components";
  }

  return null;
}

function extractAmazonSpecifications(doc, jsonLd) {
  const specs = {};

  // Table rows
  const overviewRows = doc.querySelectorAll("#productOverview_feature_div table tr");
  for (const r of overviewRows) {
    const keyEl = r.querySelector("td.a-span3 span, td:first-child span, th");
    const valEl = r.querySelector("td.a-span9 span, td:last-child span, td.po-break-word");
    if (keyEl && valEl && keyEl.textContent && valEl.textContent) {
      const k = keyEl.textContent.trim();
      const v = valEl.textContent.trim();
      if (k.length > 0 && v.length > 0) {
        specs[k] = v;
      }
    }
  }

  const techRows = doc.querySelectorAll(
    "#productDetails_techSpec_section_1 tr, #technicalSpecifications_section_1 tr, #prodDetails table tr"
  );
  for (const r of techRows) {
    const th = r.querySelector("th") || (r.children && r.children.length > 0 ? r.children[0] : null);
    const tds = r.querySelectorAll ? r.querySelectorAll("td") : [];
    const td = r.querySelector ? (r.querySelector("td.a-size-base") || (tds.length > 0 ? tds[tds.length - 1] : null)) : null;
    if (th && td && th.textContent && td.textContent && th !== td) {
      const k = th.textContent.trim();
      const v = td.textContent.trim();
      if (k.length > 0 && v.length > 0 && !specs[k]) {
        specs[k] = v;
      }
    }
  }

  const bullets = doc.querySelectorAll("#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li");
  for (const li of bullets) {
    const text = (li.textContent || "").trim();
    if (text.includes(":") || text.includes("\u200e")) {
      const parts = text.split(/[:\u200e]+/);
      if (parts.length >= 2) {
        const k = parts[0].trim().replace(/^[\s\u200e\u200f\u202a-\u202e]+/, "");
        const v = parts.slice(1).join(":").trim().replace(/[\u200e\u200f]/g, "");
        if (k && v && k.length > 0 && v.length > 0 && !specs[k]) {
          specs[k] = v;
        }
      }
    }
  }

  // Variation selections (Apparel, Footwear, Variants)
  const sizeEl = doc.querySelector("#variation_size_name .selection, #native_dropdown_selected_size_name option[selected], .swatch-title-size-name span");
  if (sizeEl && sizeEl.textContent) {
    const s = sizeEl.textContent.trim();
    if (s && !specs["Size"]) specs["Size"] = s;
  }
  const colorEl = doc.querySelector("#variation_color_name .selection, .swatch-title-color-name span");
  if (colorEl && colorEl.textContent) {
    const c = colorEl.textContent.trim();
    if (c && !specs["Color"]) specs["Color"] = c;
  }
  const styleEl = doc.querySelector("#variation_style_name .selection");
  if (styleEl && styleEl.textContent) {
    const st = styleEl.textContent.trim();
    if (st && !specs["Style"]) specs["Style"] = st;
  }

  return Object.keys(specs).length > 0 ? specs : null;
}

function cleanSellerName(raw) {
  if (!raw || typeof raw !== "string") return null;
  let text = raw.replace(/[\r\n\t]+/g, " ").trim();
  // Strip common prefixes: "Sold by: ", "Sold by ", "Merchant: ", "Seller: ", "Dispatched from and sold by "
  text = text.replace(/^(?:Sold\s+by|Dispatched\s+from\s+and\s+sold\s+by|Sold\s+and\s+dispatched\s+by|Seller|Merchant)\s*[:]?\s*/i, "").trim();
  // Strip common trailing fulfillment clauses
  text = text.replace(/\s+(?:and\s+)?Fulfilled\s+by.*$/i, "").trim();
  text = text.replace(/\s+(?:and\s+)?Dispatched\s+by.*$/i, "").trim();
  // Strip trailing promotional/navigational links if glued
  text = text.replace(/[\.\s]+Learn\s+more.*$/i, "").trim();
  text = text.replace(/[\.\s]+Details.*$/i, "").trim();
  text = text.replace(/\s{2,}/g, " ").trim();
  text = text.replace(/\.+$/, "").trim();
  return text || null;
}

function isValidSellerName(name) {
  if (!name || typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length < 2 || trimmed.length > 120) return false;

  const lower = trimmed.toLowerCase();

  // Reject generic, promotional, button, or navigational text
  const invalidPhrases = [
    "learn more",
    "learn more about this item",
    "learn more about",
    "see details",
    "details",
    "see more",
    "have one to sell",
    "sell on amazon",
    "terms and conditions",
    "terms of use",
    "privacy notice",
    "privacy policy",
    "return policy",
    "replacement",
    "secure transaction",
    "secure payment",
    "electronic payment",
    "fulfilled by amazon",
    "amazon fulfilled",
    "add to cart",
    "buy now",
    "customer reviews",
    "item details",
    "about this item",
    "click here",
    "read more",
    "view details",
    "unavailable",
    "seller unavailable",
    "not available",
    "unknown",
    "select",
    "choose",
    "null",
    "undefined",
    "ships from",
    "sold by"
  ];

  for (const phrase of invalidPhrases) {
    if (lower === phrase || lower.startsWith(phrase + " ") || lower.startsWith(phrase + ".") || lower.startsWith(phrase + ":")) {
      return false;
    }
  }

  // Reject URLs
  if (/^https?:\/\//i.test(trimmed)) return false;

  // Reject multi-sentence paragraphs
  if ((trimmed.match(/\.\s+[A-Z]/g) || []).length >= 2) return false;

  return true;
}

function extractAmazonSeller(doc, jsonLd) {
  // 1. Validated structured metadata (JSON-LD offers.seller)
  if (jsonLd) {
    const offers = jsonLd.offers || (jsonLd.mainEntity && jsonLd.mainEntity.offers);
    if (offers) {
      const offerList = Array.isArray(offers) ? offers : [offers];
      for (let i = 0; i < offerList.length; i++) {
        const off = offerList[i];
        if (off && off.seller) {
          const sellerObj = off.seller;
          const sName = typeof sellerObj === "string" ? sellerObj : (sellerObj.name || sellerObj.legalName);
          const cleaned = cleanSellerName(sName);
          if (cleaned && isValidSellerName(cleaned)) {
            return cleaned;
          }
        }
      }
    }
  }

  // 2. Tabular Buy Box: explicitly check rows with tabular-attribute-name="Sold by"
  // Note: Handle Amazon's "Sold by" and "Ships from" correctly; do NOT confuse shipping provider with seller.
  const soldByAttrRows = doc.querySelectorAll(
    '#tabular-buybox [tabular-attribute-name="Sold by"], ' +
    '.tabular-buybox-container [tabular-attribute-name="Sold by"], ' +
    '[tabular-attribute-name="Sold by"]'
  );
  for (let i = 0; i < soldByAttrRows.length; i++) {
    const row = soldByAttrRows[i];
    // Check for a link first (e.g. #sellerProfileTriggerId or /seller/ link)
    const link = row.querySelector("a#sellerProfileTriggerId, a[href*='seller='], a[href*='/seller/'], .tabular-buybox-text a, a");
    if (link && link.textContent) {
      const cleaned = cleanSellerName(link.textContent);
      if (cleaned && isValidSellerName(cleaned)) return cleaned;
    }
    // Check text container (excluding label)
    const textEl = row.querySelector(".tabular-buybox-text span, .tabular-buybox-text, td:last-child span, td:last-child");
    if (textEl && textEl.textContent) {
      const cleaned = cleanSellerName(textEl.textContent);
      if (cleaned && isValidSellerName(cleaned)) return cleaned;
    }
  }

  // 3. Tabular Buy Box table rows where header / label specifically contains "Sold by"
  const allTabularRows = doc.querySelectorAll('#tabular-buybox tr, .tabular-buybox-container tr, .tabular-buybox-row');
  for (let i = 0; i < allTabularRows.length; i++) {
    const row = allTabularRows[i];
    const rowText = row.textContent || "";
    // Only process if this row has "Sold by", and NEVER if it's purely "Ships from" or "Details"
    const isSoldByRow = /\bSold\s+by\b/i.test(rowText) && !/^\s*Ships\s+from\b/i.test(rowText);
    if (isSoldByRow) {
      const link = row.querySelector("a#sellerProfileTriggerId, a[href*='seller='], a[href*='/seller/'], a");
      if (link && link.textContent) {
        const cleaned = cleanSellerName(link.textContent);
        if (cleaned && isValidSellerName(cleaned)) return cleaned;
      }
      const valEl = row.querySelector("td:last-child, .tabular-buybox-text, span:last-child");
      if (valEl && valEl.textContent) {
        const cleaned = cleanSellerName(valEl.textContent);
        if (cleaned && isValidSellerName(cleaned)) return cleaned;
      }
    }
  }

  // 4. Dedicated seller profile trigger link in buybox (#sellerProfileTriggerId)
  const triggerEl = doc.querySelector("#sellerProfileTriggerId");
  if (triggerEl && triggerEl.textContent) {
    const cleaned = cleanSellerName(triggerEl.textContent);
    if (cleaned && isValidSellerName(cleaned)) {
      return cleaned;
    }
  }

  // 5. Desktop Buy Box specific slot / feature container
  const slotEl = doc.querySelector("div[data-csa-c-slot-id='desktop-buybox-sold-by']");
  if (slotEl) {
    const link = slotEl.querySelector("a");
    if (link && link.textContent) {
      const cleaned = cleanSellerName(link.textContent);
      if (cleaned && isValidSellerName(cleaned)) return cleaned;
    }
    const cleaned = cleanSellerName(slotEl.textContent);
    if (cleaned && isValidSellerName(cleaned)) return cleaned;
  }

  // 6. #merchant-info Parsing (Classic & Modern Amazon pages)
  const merchantInfo = doc.querySelector("#merchant-info, #merchantInfoFeature_feature_div, #exports_desktop_qualifiedBuybox_merchant_info");
  if (merchantInfo && merchantInfo.textContent) {
    // A. Check specific seller profile links inside merchant-info
    const sellerLinks = merchantInfo.querySelectorAll("a[href*='seller='], a[href*='/seller/'], a#sellerProfileTriggerId");
    for (let i = 0; i < sellerLinks.length; i++) {
      const link = sellerLinks[i];
      if (link && link.textContent) {
        const cleaned = cleanSellerName(link.textContent);
        if (cleaned && isValidSellerName(cleaned)) {
          return cleaned;
        }
      }
    }

    // B. Check any links inside merchant-info that are NOT generic/promotional/fulfillment
    const allLinks = merchantInfo.querySelectorAll("a");
    for (let i = 0; i < allLinks.length; i++) {
      const link = allLinks[i];
      if (link && link.textContent) {
        const cleaned = cleanSellerName(link.textContent);
        if (cleaned && isValidSellerName(cleaned) && !/fulfilled|details|learn\s+more/i.test(cleaned)) {
          return cleaned;
        }
      }
    }

    // C. Regex text extraction from merchant-info
    const rawText = merchantInfo.textContent.trim();

    // Pattern 1: "Sold by X and Fulfilled by Y" or "Sold by X."
    const soldByMatch = rawText.match(/\b(?:Sold\s+by|Sold\s+and\s+dispatched\s+by|Dispatched\s+from\s+and\s+sold\s+by)\s*[:]?\s*([^.,\n\r]+?)(?:\s+(?:and\s+)?Fulfilled\s+by|\s+and\s+Dispatched\s+by|\s*[\.]|\s+Learn\s+more|$)/i);
    if (soldByMatch && soldByMatch[1]) {
      const candidate = cleanSellerName(soldByMatch[1]);
      if (candidate && isValidSellerName(candidate)) {
        return candidate;
      }
    }

    // Pattern 2: "Ships from and sold by X."
    const shipsAndSoldMatch = rawText.match(/\b(?:Ships\s+from\s+and\s+sold\s+by)\s*[:]?\s*([^.,\n\r]+?)(?:\s*[\.]|\s+Learn\s+more|$)/i);
    if (shipsAndSoldMatch && shipsAndSoldMatch[1]) {
      const candidate = cleanSellerName(shipsAndSoldMatch[1]);
      if (candidate && isValidSellerName(candidate)) {
        return candidate;
      }
    }
  }

  // 7. If seller cannot be identified reliably, return null (caller defaults to "Seller unavailable")
  return null;
}

function extractAmazonVariant(doc) {
  const parts = [];
  const twisterDimensionIds = [
    "color_name",
    "size_name",
    "style_name",
    "pattern_name",
    "configuration",
    "customer_package_type",
  ];

  for (const dim of twisterDimensionIds) {
    const el = doc.querySelector(`#inline-twister-expanded-dimension-text-${dim}`);
    if (el && el.textContent) {
      const val = el.textContent.trim();
      if (val && !parts.includes(val)) {
        parts.push(val);
      }
    }
  }

  if (parts.length === 0) {
    for (const dim of twisterDimensionIds) {
      const el =
        doc.querySelector(`#variation_${dim} span.selection`) ||
        doc.querySelector(`#variation_${dim} .selection`) ||
        doc.querySelector(`#variation_${dim} .a-dropdown-prompt`);
      if (el && el.textContent) {
        const val = el.textContent.trim();
        if (val && !/^(select|choose|\-)/i.test(val) && !parts.includes(val)) {
          parts.push(val);
        }
      }
    }
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function extractAmazonImage(doc) {
  const candidateSelectors = [
    "#landingImage",
    "#imgBlkFront",
    "#ebooks-img-blk-front",
    "#main-image",
  ];

  for (const sel of candidateSelectors) {
    const el = doc.querySelector(sel);
    if (el) {
      const hires = el.getAttribute("data-old-hires");
      if (hires && isValidHttpUrl(hires)) return hires.trim();
      const dynamic = el.getAttribute("data-a-dynamic-image");
      if (dynamic) {
        try {
          const parsed = JSON.parse(dynamic);
          const urls = Object.keys(parsed);
          if (urls.length > 0) {
            urls.sort((a, b) => {
              const dimA = Array.isArray(parsed[a]) ? parsed[a][0] * parsed[a][1] : 0;
              const dimB = Array.isArray(parsed[b]) ? parsed[b][0] * parsed[b][1] : 0;
              return dimB - dimA;
            });
            if (isValidHttpUrl(urls[0])) return urls[0].trim();
          }
        } catch (e) {}
      }
      const src = el.getAttribute("src");
      if (src && isValidHttpUrl(src)) return src.trim();
    }
  }
  return null;
}

function extractAmazonMrp(doc, sellingPrice) {
  const candidateContainers = [
    doc.querySelector("#corePriceDisplay_desktop_feature_div"),
    doc.querySelector("#corePrice_desktop"),
    doc.querySelector("#corePrice_feature_div"),
    doc.querySelector("#apex_desktop"),
    doc.querySelector("#desktop_unifiedPrice"),
    doc.querySelector("#price"),
  ].filter(Boolean);

  for (const container of candidateContainers) {
    const basisEls = container.querySelectorAll(".basisPrice, [data-csa-c-element-id*=\"basisPrice\"]");
    for (const basisEl of Array.from(basisEls)) {
      const text = basisEl.textContent || "";
      if (!/save|coupon|emi|cashback/i.test(text)) {
        const offscreen = basisEl.querySelector(".a-offscreen") || basisEl.querySelector(".a-text-price");
        const val = parsePriceText(offscreen ? offscreen.textContent : text);
        if (val !== null && (!sellingPrice || val >= sellingPrice)) {
          return val;
        }
      }
    }
  }

  for (const container of candidateContainers) {
    const strikeEls = container.querySelectorAll(
      "span.a-text-price[data-a-strike=\"true\"], span.a-price.a-text-price, span.a-text-strike"
    );
    for (const strikeEl of Array.from(strikeEls)) {
      const parent = strikeEl.closest("tr, div, span.a-size-small, li");
      const context = (parent ? parent.textContent : strikeEl.parentElement ? strikeEl.parentElement.textContent : "") || "";
      const isMrp = /m\.?r\.?p|list\s*price|maximum\s*retail/i.test(context);
      const isExcluded = /save|savings|coupon|emi|cashback|discount/i.test(context);

      if (isMrp && !isExcluded) {
        const offscreen = strikeEl.querySelector(".a-offscreen") || strikeEl;
        const val = parsePriceText(offscreen.textContent);
        if (val !== null && (!sellingPrice || val >= sellingPrice)) {
          return val;
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 3. Flipkart Extractor
// ---------------------------------------------------------------------------

function extractFlipkartProduct(customDoc, customUrl, options = {}) {
  const doc = customDoc || (typeof document !== "undefined" ? document : null);
  const href = customUrl || (typeof window !== "undefined" ? window.location.href : "");
  if (!doc) return null;

  let hostname = "";
  let pathname = "";
  try {
    const parsed = new URL(href);
    hostname = parsed.hostname;
    pathname = parsed.pathname;
  } catch (e) {
    if (typeof window !== "undefined") {
      hostname = window.location.hostname || "";
      pathname = window.location.pathname || "";
    }
  }

  if (!hostname.includes("flipkart.com")) {
    return null;
  }

  // Verify that this is genuinely a product detail page
  // Flipkart product pages contain `/p/itm...` or have a query param `pid=...`
  const isPdpPath = pathname.includes("/p/itm") || pathname.includes("/p/");
  const hasPidParam = href.includes("pid=") || href.includes("PID=");
  const jsonLd = getJsonLdProduct(doc);

  if (!isPdpPath && !hasPidParam && !jsonLd) {
    // Non-product page: search results, homepage, cart, etc.
    return null;
  }

  // 1. Scoped Product Title
  let productName = null;
  // Modern Flipkart puts the main product title inside an H1
  const h1El = doc.querySelector("h1");
  if (h1El) {
    const raw = h1El.textContent ? h1El.textContent.trim().replace(/\s+/g, " ") : "";
    // Avoid search headings or empty text
    if (raw && !/^(search for|flipkart|results for)/i.test(raw)) {
      productName = raw;
    }
  }

  // Fallback to JSON-LD name
  if (!productName && jsonLd && jsonLd.name) {
    productName = String(jsonLd.name).trim().replace(/\s+/g, " ");
  }

  // Fallback to classic Flipkart title selectors
  if (!productName) {
    const titleSelectors = [
      "span.B_NuCI",
      "h1.B_NuCI",
      "h1._35KyD6",
      "h1.VU-ZEz",
      "span._35KyD6",
    ];
    for (const sel of titleSelectors) {
      const el = doc.querySelector(sel);
      if (el && el.textContent) {
        const raw = el.textContent.trim().replace(/\s+/g, " ");
        if (raw) {
          productName = raw;
          break;
        }
      }
    }
  }

  if (!productName || productName.length === 0) {
    return null;
  }

  // 2. Retailer Product ID (Flipkart PID and item ID)
  // Scrupulously separated from MPN: retailer_product_id gets PID, manufacturer_part_number is null
  const { pid, itemId } = extractFlipkartIds(doc, href, jsonLd);
  const retailerProductId = pid || itemId || null;

  // 3. Canonical Product URL
  let canonicalUrl = null;
  const canonicalLink = doc.querySelector('link[rel="canonical"]');
  if (canonicalLink) {
    const cHref = canonicalLink.getAttribute("href");
    if (cHref && isValidHttpUrl(cHref)) {
      canonicalUrl = cHref.trim();
    }
  }
  if (!canonicalUrl) {
    const cleanPath = pathname.split("?")[0];
    canonicalUrl = `https://www.flipkart.com${cleanPath}${pid ? `?pid=${pid}` : ""}`;
  }

  // 4. Current Selling Price
  let price = extractFlipkartSellingPrice(doc, jsonLd);
  if (price === null || price <= 0) {
    return null;
  }

  // 5. MRP
  const mrp = extractFlipkartMrp(doc, price);

  // 6. Brand and Model
  let brand = null;
  if (jsonLd && jsonLd.brand) {
    brand = typeof jsonLd.brand === "string" ? jsonLd.brand : jsonLd.brand.name || null;
  }
  if (!brand) {
    // Extract first word of title if known brand
    const firstWord = productName.split(" ")[0].trim();
    if (["Nothing", "Apple", "Samsung", "Google", "OnePlus", "Xiaomi", "Realme", "Motorola", "Sony", "Dell", "HP", "Lenovo", "Acer", "Asus"].some(b => b.toLowerCase() === firstWord.toLowerCase())) {
      brand = firstWord;
    }
  }

  // 7. Specifications & Variant
  const { variant, specifications } = extractFlipkartVariantAndSpecs(doc, productName);

  // 8. Seller
  const seller = extractFlipkartSeller(doc);

  // 9. Availability
  let availability = "IN_STOCK";
  const pageText = doc.textContent || "";
  if (/currently unavailable|out of stock|sold out/i.test(pageText) || (jsonLd && String(jsonLd.offers?.availability).includes("OutOfStock"))) {
    availability = "OUT_OF_STOCK";
  }

  // 10. Image URL
  const image = extractFlipkartImage(doc, jsonLd);

  const resolvedBrand = brand || (jsonLd && jsonLd.brand ? (jsonLd.brand.name || jsonLd.brand) : null) || "Unavailable";
  const resolvedModel = (jsonLd && jsonLd.model) || (specifications && (specifications["Model Name"] || specifications["Model Number"])) || "Unavailable";
  const reviews = (options && options.skipReviews) ? [] : extractFlipkartReviews(doc);
  const ratingTotals = extractFlipkartRatingTotals(doc);
  const finalRating = ratingTotals.rating || (jsonLd?.aggregateRating?.ratingValue ? parseFloat(jsonLd.aggregateRating.ratingValue) : null);
  const finalRatingsTotal = ratingTotals.ratingsTotal || (jsonLd?.aggregateRating?.ratingCount ? parseInt(jsonLd.aggregateRating.ratingCount, 10) : null);
  const finalReviewsTotal = ratingTotals.reviewsTotal || (jsonLd?.aggregateRating?.reviewCount ? parseInt(jsonLd.aggregateRating.reviewCount, 10) : null);

  return {
    source_retailer: "Flipkart",
    product_name: productName,
    product_title: productName,
    url: canonicalUrl,
    product_url: canonicalUrl,
    current_site_price: price,
    current_price: price,
    currency: "INR",
    mrp: mrp,
    seller: seller || "Seller unavailable",
    brand: resolvedBrand,
    model: resolvedModel,
    specifications: specifications,
    image: image,
    image_url: image,
    variant: variant,
    retailer_product_id: retailerProductId,
    manufacturer_part_number: null,
    category: (jsonLd && jsonLd.category) || null,
    rating: finalRating,
    ratings_total: finalRatingsTotal,
    reviews_total: finalReviewsTotal,
    availability: availability,
    reviews: reviews,
    scan_metadata: {
      pages_scanned: 1,
      total_reviews_found: reviews.length,
      has_more: Boolean(doc.querySelector && doc.querySelector('a[href*="/product-reviews/"], nav.yFHi8N a, nav.Wjh8A1 a, a[class*="_1LKTO3"], a[class*="cnfd9Q"]')),
      limitation_note: null,
      target_count: 100,
      rating_distribution: calculateRatingDistribution(reviews),
    },
    analysis_source: "live_dom",
  };
}

function extractFlipkartIds(doc, url, jsonLd) {
  let pid = null;
  let itemId = null;

  try {
    const u = new URL(url);
    pid = u.searchParams.get("pid") || u.searchParams.get("PID");
    const m = u.pathname.match(/\/p\/(itm[a-zA-Z0-9]+)/i);
    if (m) {
      itemId = m[1];
    }
  } catch (e) {}

  if (!pid && jsonLd && jsonLd.sku) {
    pid = String(jsonLd.sku).trim();
  }

  return { pid, itemId };
}

function extractFlipkartSellingPrice(doc, jsonLd) {
  // Strategy 1: JSON-LD price
  if (jsonLd && jsonLd.offers) {
    const p = Array.isArray(jsonLd.offers) ? jsonLd.offers[0]?.price : jsonLd.offers?.price;
    const num = parseFloat(p);
    if (!isNaN(num) && num > 0) {
      return num;
    }
  }

  // Strategy 2: Modern Flipkart price selectors
  // Scoped to classes like v1zwn21n, Nx9bqj CxhGGd, _30jeq3 _16Jk6d
  const modernPriceEls = doc.querySelectorAll('div[class*="v1zwn21n"], div[class*="v1zwn2"]');
  for (const el of Array.from(modernPriceEls)) {
    const txt = el.textContent || "";
    if (txt.includes("₹")) {
      const parsed = parsePriceText(txt);
      if (parsed !== null && parsed > 0) {
        return parsed;
      }
    }
  }

  // Strategy 3: Classic Flipkart selectors
  const classicSelectors = [
    "div.Nx9bqj.CxhGGd",
    "div.Nx9bqj",
    "div._30jeq3._16Jk6d",
    "div._30jeq3",
    "div._1vC4OE._3qQ9m1",
    "div._1vC4OE",
  ];
  for (const sel of classicSelectors) {
    const el = doc.querySelector(sel);
    if (el && el.textContent) {
      const parsed = parsePriceText(el.textContent);
      if (parsed !== null && parsed > 0) {
        return parsed;
      }
    }
  }

  return null;
}

function extractFlipkartMrp(doc, sellingPrice) {
  // Modern Flipkart strikethrough containers
  const strikethroughEls = doc.querySelectorAll('div[style*="line-through"], div[class*="v1zwn21o"], div[class*="_1psv1ze93"]');
  for (const el of Array.from(strikethroughEls)) {
    const parsed = parsePriceText(el.textContent);
    if (parsed !== null && parsed > 0 && (!sellingPrice || parsed >= sellingPrice)) {
      return parsed;
    }
  }

  // Classic Flipkart strike price
  const classicMrpEls = doc.querySelectorAll("div.yRaY8j, div._3I9_wc._2p6cR8, div._3I9_wc, div._2yAnYN");
  for (const el of Array.from(classicMrpEls)) {
    const parsed = parsePriceText(el.textContent);
    if (parsed !== null && parsed > 0 && (!sellingPrice || parsed >= sellingPrice)) {
      return parsed;
    }
  }

  return null;
}

function extractFlipkartSeller(doc) {
  // Modern Flipkart: text containing "Seller: ..."
  const modernSellerEls = doc.querySelectorAll('div[class*="v1zwn26"], div[class*="v1zwn"]');
  for (const el of Array.from(modernSellerEls)) {
    const txt = el.textContent ? el.textContent.trim() : "";
    if (/^Seller:\s*/i.test(txt)) {
      const clean = txt.replace(/^Seller:\s*/i, "").trim();
      if (clean) return clean;
    }
  }

  // Classic Flipkart: #sellerName
  const sellerEl = doc.querySelector("#sellerName, div._1RLviY, div._2Yx7No");
  if (sellerEl && sellerEl.textContent) {
    let clean = sellerEl.textContent.trim().replace(/^Seller:\s*/i, "").trim();
    // Strip seller rating stars if appended
    clean = clean.split(/\s+\d(?:\.\d)?\s*★/)[0].trim();
    if (clean) return clean;
  }

  return null;
}

function extractFlipkartImage(doc, jsonLd) {
  // JSON-LD primary image
  if (jsonLd && jsonLd.image) {
    const img = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
    if (isValidHttpUrl(img)) return img.trim();
  }

  // Modern and Classic Flipkart main image selectors
  const imgSelectors = [
    'img[src*="flixcart.com/image"]',
    'img[class*="_0DkuPH"]',
    'img[class*="DByuf4"]',
    'img._396cs4._3exPp9',
    'img._2r_T1I',
    'img._396cs4',
  ];
  for (const sel of imgSelectors) {
    const el = doc.querySelector(sel);
    if (el) {
      const src = el.getAttribute("src");
      if (src && isValidHttpUrl(src)) return src.trim();
    }
  }

  return null;
}

function extractFlipkartVariantAndSpecs(doc, title) {
  const specs = {};
  const variantParts = [];

  // Match title variant parentheses: e.g. Nothing Phone (4b) (Black, 256 GB) (8 GB RAM)
  const parenMatches = title.match(/\(([^)]+)\)/g);
  if (parenMatches) {
    for (const p of parenMatches) {
      const inner = p.slice(1, -1).trim();
      // Skip model numbers like (4b)
      if (/^\d+[a-z]?$/i.test(inner)) continue;

      const subParts = inner.split(",").map(s => s.trim());
      for (const sp of subParts) {
        if (/^\d+\s*(?:gb|tb)\s*ram$/i.test(sp)) {
          specs.ram = sp;
          if (!variantParts.includes(sp)) variantParts.push(sp);
        } else if (/^\d+\s*(?:gb|tb)(?:\s*ssd|\s*storage)?$/i.test(sp)) {
          specs.storage = sp;
          if (!variantParts.includes(sp)) variantParts.push(sp);
        } else if (["black", "blue", "white", "grey", "gray", "silver", "gold", "starlight", "midnight", "purple", "green", "red", "orange"].some(c => sp.toLowerCase().includes(c))) {
          specs.color = sp;
          if (!variantParts.includes(sp)) variantParts.push(sp);
        } else if (sp && !variantParts.includes(sp)) {
          variantParts.push(sp);
        }
      }
    }
  }

  const variantStr = variantParts.length > 0 ? variantParts.join(" · ") : null;
  return { variant: variantStr, specifications: Object.keys(specs).length > 0 ? specs : null };
}

// ---------------------------------------------------------------------------
// 4. Unified Extractor Dispatcher
// ---------------------------------------------------------------------------


function extractAmazonSearchResults(customDoc, customUrl) {
  const doc = customDoc || (typeof document !== "undefined" ? document : null);
  if (!doc) return { blocked: false, blockType: null, query: "", candidates: [] };

  const href = customUrl || (typeof window !== "undefined" ? window.location.href : "");
  let query = "";
  try {
    const u = new URL(href);
    query = u.searchParams.get("k") || "";
  } catch (e) {}

  if (!query) {
    const searchInput = doc.querySelector("#twotabsearchtextbox");
    if (searchInput && searchInput.value) {
      query = searchInput.value.trim();
    }
  }

  // 1. Check for CAPTCHA challenge
  const captchaInput = doc.querySelector("#captchacharacters");
  const captchaForm = doc.querySelector('form[action*="/errors/validateCaptcha"]');
  const bodyText = doc.body ? (doc.body.textContent || "") : (doc.textContent || "");
  if (captchaInput || captchaForm || /Type the characters you see/i.test(bodyText) || /validateCaptcha/i.test(bodyText)) {
    return {
      blocked: true,
      blockType: "CAPTCHA",
      reason: "Amazon India displayed a CAPTCHA challenge in the browser tab.",
      query: query,
      candidates: []
    };
  }

  // 2. Check for CloudFront 503 / access denied
  if (/503 - Service Unavailable Error/i.test(bodyText) || /automated access to Amazon data/i.test(bodyText)) {
    return {
      blocked: true,
      blockType: "ACCESS_DENIED_503",
      reason: "Amazon India returned an access-denied or 503 challenge page.",
      query: query,
      candidates: []
    };
  }

  // 3. Extract items
  const resultCards = doc.querySelectorAll('div[data-asin], div.s-result-item');
  const candidates = [];
  const seenAsins = new Set();

  for (const card of Array.from(resultCards)) {
    const asin = (card.getAttribute("data-asin") || "").trim();
    if (!asin || asin.length !== 10 || !/^[A-Z0-9]{10}$/.test(asin)) {
      continue;
    }
    if (seenAsins.has(asin)) {
      continue;
    }

    // Title
    let title = "";
    const titleEl = card.querySelector("h2 a span, h2 span, h2 a, span.a-size-medium, span.a-size-base-plus");
    if (titleEl && titleEl.textContent) {
      title = titleEl.textContent.trim().replace(/\s+/g, " ");
    }
    if (!title || title.length < 3) {
      continue;
    }

    // Price
    let price = null;
    const priceEl = card.querySelector('span.a-price:not([data-a-strike="true"]) span.a-offscreen, span.a-price span.a-offscreen, span.a-color-price');
    if (priceEl && priceEl.textContent) {
      price = parsePriceText(priceEl.textContent);
    }
    if (price === null || price <= 0) {
      continue;
    }

    // MRP
    let mrp = null;
    const mrpEl = card.querySelector('span.a-price[data-a-strike="true"] span.a-offscreen, span.a-text-price span.a-offscreen');
    if (mrpEl && mrpEl.textContent) {
      const parsedMrp = parsePriceText(mrpEl.textContent);
      if (parsedMrp !== null && parsedMrp >= price) {
        mrp = parsedMrp;
      }
    }

    // Image
    let imgUrl = null;
    const imgEl = card.querySelector("img.s-image");
    if (imgEl) {
      const src = imgEl.getAttribute("src");
      if (isValidHttpUrl(src)) {
        imgUrl = src.trim();
      }
    }

    // Availability
    const cardText = card.textContent || "";
    const isOutOfStock = /currently unavailable|out of stock|temporarily out of stock/i.test(cardText);

    seenAsins.add(asin);
    candidates.push({
      retailer_name: "Amazon.in",
      product_title: title,
      product_url: "https://www.amazon.in/dp/" + asin,
      retailer_product_id: asin,
      current_price: price,
      mrp: mrp,
      currency: "INR",
      availability: isOutOfStock ? "OUT_OF_STOCK" : "IN_STOCK",
      seller_name: null,
      image_url: imgUrl,
      condition: "New",
      data_source: "Amazon Browser Tab Search"
    });
  }

  return {
    blocked: false,
    blockType: null,
    query: query,
    candidates: candidates
  };
}


function extractAmazonReviews(customDoc) {
  const doc = customDoc || (typeof document !== "undefined" ? document : null);
  if (!doc) return [];

  const reviews = [];
  const rawCards = doc.querySelectorAll(
    'div[data-hook="review"], div.review, div.a-section.review, div[id^="customer_review-"], li[data-hook="review"], div[data-hook="cr-widget-desktop-review-body"]'
  );

  // Deduplicate nested card elements if any
  const reviewCards = [];
  for (let i = 0; i < rawCards.length; i++) {
    const c = rawCards[i];
    let isNested = false;
    let p = c.parentElement;
    while (p) {
      for (let j = 0; j < rawCards.length; j++) {
        if (rawCards[j] === p) { isNested = true; break; }
      }
      if (isNested) break;
      p = p.parentElement;
    }
    if (!isNested) reviewCards.push(c);
  }

  for (let i = 0; i < reviewCards.length; i++) {
    const card = reviewCards[i];
    try {
      const bodyEl = card.querySelector(
        'span[data-hook="review-body"] span, span[data-hook="review-body"], div[data-hook="review-body"], div[data-hook="review-collapsed"] span, div[data-hook="review-collapsed"], div.reviewText span, div.reviewText, .a-expander-content span, div[data-hook="review-description"]'
      );
      let text = bodyEl ? bodyEl.textContent.trim().replace(/\s+/g, " ") : "";
      text = text.replace(/Read more\s*$/i, "").trim();
      if (!text || text.length < 3) continue;

      let rating = null;
      // Target [data-hook="review-star-rating"] directly with ' out' split like reference repo
      const starEl = card.querySelector(
        '[data-hook="review-star-rating"], [data-hook="cmps-review-star-rating"], .review-rating, i.a-icon-star'
      );
      if (starEl) {
        const rawStar = (starEl.textContent || starEl.getAttribute("aria-label") || starEl.getAttribute("title") || "").trim();
        if (rawStar.includes(" out")) {
          const part = rawStar.split(" out")[0];
          const num = parseFloat(part.replace(/[^\d.]/g, ""));
          if (!isNaN(num) && num > 0) rating = Math.round(num);
        } else {
          const m = rawStar.match(/(\d(?:\.\d)?)/);
          if (m) rating = Math.round(parseFloat(m[1]));
        }
      }
      if (rating === null) {
        const altEl = card.querySelector(".a-icon-alt, span.a-icon-alt");
        if (altEl && altEl.textContent) {
          const m = altEl.textContent.match(/(\d(?:\.\d)?)/);
          if (m) rating = Math.round(parseFloat(m[1]));
        }
      }
      if (rating === null) {
        const iconEl = card.querySelector('i[class*="a-star-"], span[class*="a-star-"]');
        if (iconEl) {
          const cls = iconEl.getAttribute("class") || "";
          const cm = cls.match(/a-star-(\d)/);
          if (cm) rating = parseInt(cm[1], 10);
        }
      }

      let title = null;
      const titleEl = card.querySelector(
        '[data-hook="review-title"], a.review-title, span.review-title'
      );
      if (titleEl && titleEl.textContent) {
        let rawTitle = titleEl.textContent.trim().replace(/\s+/g, " ");
        // Strip out any rating prefix like "5.0 out of 5 stars"
        rawTitle = rawTitle.replace(/^\d(?:\.\d)?\s*out of 5 stars\s*/i, "").trim();
        if (rawTitle.length > 0) {
          title = rawTitle;
        }
      }

      let author = "Amazon Customer";
      const authorEl = card.querySelector(
        '[class="a-profile-name"], span.a-profile-name, div.a-profile-content span.a-profile-name, a.a-profile span.a-profile-name, span.author'
      );
      if (authorEl && authorEl.textContent) {
        author = authorEl.textContent.trim();
      }

      let date = null;
      const dateEl = card.querySelector('[data-hook="review-date"], span.review-date');
      if (dateEl && dateEl.textContent) {
        const rawDate = dateEl.textContent.trim();
        // Split on ' on ' to isolate date like reference repo
        if (rawDate.includes(" on ")) {
          date = rawDate.split(" on ").pop().trim();
        } else {
          date = rawDate;
        }
      }

      let verifiedPurchase = false;
      const avpEl = card.querySelector('span[data-hook="avp-badge"], span[data-hook="avp-badge-linkless"]');
      if (avpEl || /verified purchase/i.test(card.textContent || "")) {
        verifiedPurchase = true;
      }

      let reviewId = (card.getAttribute ? card.getAttribute("id") : card.id) || null;
      if (!reviewId && card.getAttribute) {
        reviewId = card.getAttribute("data-review-id");
      }
      if (!reviewId) {
        const titleLink = card.querySelector ? card.querySelector('a[data-hook="review-title"], a.review-title') : null;
        if (titleLink && titleLink.getAttribute) {
          const hrefAttr = titleLink.getAttribute("href") || "";
          const m = hrefAttr.match(/\/customer-reviews\/([A-Z0-9]+)/i);
          if (m) reviewId = m[1];
        }
      }
      if (reviewId && typeof reviewId === "string") {
        reviewId = reviewId.replace(/^customer_review-/, "").trim();
      } else {
        reviewId = "amz_rev_" + (i + 1);
      }

      reviews.push({
        id: reviewId,
        text: text,
        rating: rating,
        title: title,
        author: author,
        date: date,
        verified_purchase: verifiedPurchase,
      });
    } catch (e) {}
  }
  return reviews;
}

function extractFlipkartRatingTotals(doc) {
  if (!doc) return { rating: null, ratingsTotal: null, reviewsTotal: null };
  let rating = null;
  let ratingsTotal = null;
  let reviewsTotal = null;

  const starEl = doc.querySelector("div._3LWZlK, div.XQDdHH, div[class*='_3LWZlK'], div[class*='XQDdHH'], span[class*='XQDdHH']");
  if (starEl && starEl.textContent) {
    const m = starEl.textContent.match(/(\d(?:\.\d)?)/);
    if (m) rating = parseFloat(m[1]);
  }

  const countEls = doc.querySelectorAll("span._2_R_DZ, span.WJhScb, div.row._2af8Fields, span[class*='_2_R_DZ'], span[class*='WJhScb']");
  for (let i = 0; i < countEls.length; i++) {
    const txt = countEls[i].textContent || "";
    const m = txt.match(/([\d,]+)\s*Ratings?\s*(?:&|and)\s*([\d,]+)\s*Reviews?/i);
    if (m) {
      ratingsTotal = parseInt(m[1].replace(/,/g, ""), 10);
      reviewsTotal = parseInt(m[2].replace(/,/g, ""), 10);
      break;
    }
  }

  if (!ratingsTotal || !reviewsTotal) {
    const bodyTxt = doc.body ? doc.body.textContent : doc.textContent || "";
    const allMatches = (bodyTxt || "").match(/([\d,]+)\s*Ratings?\s*(?:&|and)\s*([\d,]+)\s*Reviews?/i);
    if (allMatches) {
      if (!ratingsTotal) ratingsTotal = parseInt(allMatches[1].replace(/,/g, ""), 10);
      if (!reviewsTotal) reviewsTotal = parseInt(allMatches[2].replace(/,/g, ""), 10);
    }
  }

  // Schema.org JSON-LD fallback for rating totals
  if (!ratingsTotal || !reviewsTotal || !rating) {
    try {
      const jsonLdEls = doc.querySelectorAll ? doc.querySelectorAll('script#jsonLD, script[type="application/ld+json"]') : [];
      for (let i = 0; i < jsonLdEls.length; i++) {
        const raw = jsonLdEls[i].textContent || "";
        if (!raw.includes("aggregateRating")) continue;
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item && item.aggregateRating) {
            if (!rating && item.aggregateRating.ratingValue) {
              rating = parseFloat(item.aggregateRating.ratingValue);
            }
            if (!ratingsTotal && item.aggregateRating.ratingCount) {
              ratingsTotal = parseInt(String(item.aggregateRating.ratingCount).replace(/,/g, ""), 10);
            }
            if (!reviewsTotal && item.aggregateRating.reviewCount) {
              reviewsTotal = parseInt(String(item.aggregateRating.reviewCount).replace(/,/g, ""), 10);
            }
          }
        }
      }
    } catch (e) {}
  }

  return { rating, ratingsTotal, reviewsTotal };
}

/**
 * Robust HTML review parser for Flipkart that operates without DOMParser in ServiceWorker/isolated contexts.
 */
function parseFlipkartReviewsFromHtml(html) {
  const reviews = [];
  if (!html || typeof html !== "string") {
    return { reviews, hasNextPage: false };
  }

  let hasNextPage = false;
  const seenIds = new Set();
  const seenTexts = new Set();

  function addCleanReview(r) {
    if (!r || !r.text || typeof r.text !== "string") return;
    let cleanText = r.text
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/READ MORE\s*$/i, "")
      .replace(/Read More\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleanText || cleanText.length < 3) return;
    const textKey = cleanText.slice(0, 80).toLowerCase();
    if (seenTexts.has(textKey)) return;
    seenTexts.add(textKey);

    let cleanRating = null;
    if (typeof r.rating === "number" && !isNaN(r.rating)) {
      cleanRating = Math.round(r.rating);
    } else if (typeof r.rating === "string") {
      const parsedNum = parseFloat(r.rating);
      if (!isNaN(parsedNum)) cleanRating = Math.round(parsedNum);
    }

    let cleanTitle = null;
    if (r.title && typeof r.title === "string") {
      cleanTitle = r.title.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || null;
    }

    let cleanAuthor = "Flipkart Customer";
    if (r.author && typeof r.author === "string" && r.author.trim()) {
      cleanAuthor = r.author.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (/certified buyer/i.test(cleanAuthor)) cleanAuthor = "Flipkart Customer";
    }

    let cleanDate = null;
    if (r.date && typeof r.date === "string" && r.date.trim()) {
      cleanDate = r.date.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (/certified buyer/i.test(cleanDate)) cleanDate = null;
    }

    const norm = `${cleanAuthor}_${cleanDate || ""}_${cleanText.slice(0, 30)}`
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    const stableId = r.id && String(r.id).trim().length > 3
      ? String(r.id).trim()
      : (norm.length >= 6 ? `fk_${norm}` : `fk_rev_${reviews.length + 1}`);

    if (seenIds.has(stableId)) return;
    seenIds.add(stableId);

    reviews.push({
      id: stableId,
      text: cleanText,
      rating: cleanRating,
      title: cleanTitle,
      author: cleanAuthor,
      date: cleanDate,
      verified_purchase: Boolean(r.verified_purchase),
    });
  }

  // ---------------------------------------------------------------------------
  // Strategy 1: Parse window.__INITIAL_STATE__
  // ---------------------------------------------------------------------------
  try {
    const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
    if (stateMatch && stateMatch[1]) {
      const state = JSON.parse(stateMatch[1]);

      function walk(obj) {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          for (let i = 0; i < obj.length; i++) walk(obj[i]);
          return;
        }

        // Check for review count
        if (typeof obj.reviewCount === "number" && !totalReviewsReported) {
          totalReviewsReported = obj.reviewCount;
        } else if (typeof obj.reviewsCount === "number" && !totalReviewsReported) {
          totalReviewsReported = obj.reviewsCount;
        }

        // Case A: ProductReviewValue
        if (obj.type === "ProductReviewValue") {
          const verified = obj.certifiedBuyer === true ||
            (obj.reviewPropertyMap && obj.reviewPropertyMap.VERIFIED_PURCHASE === true);
          addCleanReview({
            id: obj.id,
            text: obj.text,
            rating: obj.rating,
            title: obj.title,
            author: obj.author,
            date: obj.created,
            verified_purchase: verified,
          });
          return;
        }

        // Case B: Schema.org Review
        if (obj["@type"] === "Review") {
          let rating = null;
          if (obj.reviewRating && typeof obj.reviewRating === "object") {
            rating = obj.reviewRating.ratingValue;
          }
          let author = "Flipkart Customer";
          if (obj.author) {
            author = typeof obj.author === "string" ? obj.author : (obj.author.name || "Flipkart Customer");
          }
          addCleanReview({
            id: obj.id,
            text: obj.reviewBody || obj.text,
            rating,
            title: obj.name || obj.headline || null,
            author,
            date: obj.datePublished,
            verified_purchase: true,
          });
          return;
        }

        for (const k of Object.keys(obj)) {
          walk(obj[k]);
        }
      }

      walk(state);

      if (totalReviewsReported && typeof totalReviewsReported === "number") {
        if (totalReviewsReported > reviews.length && reviews.length > 0) {
          hasNextPage = true;
        }
      }
    }
  } catch (e) {}

  // Regex fallback for total reviews count if not extracted from __INITIAL_STATE__
  if (!totalReviewsReported) {
    const totalMatch = html.match(/(\d[\d,]*)\s+(?:Customer\s+)?Reviews/i) ||
      html.match(/(\d[\d,]*)\s+Ratings\s*&amp;\s*(\d[\d,]*)\s+Reviews/i) ||
      html.match(/"reviewCount"\s*:\s*"?(\d+)"?/i);
    if (totalMatch) {
      const numStr = (totalMatch[2] || totalMatch[1]).replace(/,/g, "");
      const num = parseInt(numStr, 10);
      if (!isNaN(num) && num > 0) {
        totalReviewsReported = num;
        if (totalReviewsReported > reviews.length && reviews.length > 0) {
          hasNextPage = true;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Strategy 2: Check JSON-LD scripts (<script type="application/ld+json">)
  // ---------------------------------------------------------------------------
  if (reviews.length === 0) {
    const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = jsonLdRegex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item && Array.isArray(item.review)) {
            for (const r of item.review) {
              let rating = null;
              if (r.reviewRating && typeof r.reviewRating === "object") {
                rating = r.reviewRating.ratingValue;
              }
              let author = "Flipkart Customer";
              if (r.author) {
                author = typeof r.author === "string" ? r.author : (r.author.name || "Flipkart Customer");
              }
              addCleanReview({
                text: r.reviewBody || r.text,
                rating,
                title: r.name || r.headline || null,
                author,
                date: r.datePublished,
                verified_purchase: true,
              });
            }
          }
        }
      } catch (e) {}
    }
  }

  // ---------------------------------------------------------------------------
  // Strategy 3: Legacy CSS classes fallback (_16PBlm, ZmyHeo, t-ZTKy, etc.)
  // ---------------------------------------------------------------------------
  if (reviews.length === 0) {
    const chunks = html.split(/<div[^>]*class="[^"]*(?:cPHDOP|_16PBlm|_27M-vq|EPCmJX|RcXBOT|EKF0m-)[^"]*"[^>]*>/i);
    for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
      const chunk = chunks[cIdx];
      const bodyMatch =
        chunk.match(/class="[^"]*(?:ZmyHeo|t-ZTKy)[^"]*"[^>]*>[\s\S]*?<div>\s*<div[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
        chunk.match(/class="[^"]*(?:ZmyHeo|t-ZTKy)[^"]*"[^>]*>[\s\S]*?<div>([\s\S]*?)<\/div>/i) ||
        chunk.match(/class="[^"]*(?:ZmyHeo|t-ZTKy)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

      if (!bodyMatch) continue;

      let rating = null;
      const starMatch = chunk.match(/class="[^"]*(?:XQDdHH|_3LWZlK|hGSR34)[^"]*"[^>]*>[\s\S]*?(\d(?:\.\d)?)/i);
      if (starMatch) {
        rating = Math.round(parseFloat(starMatch[1]));
      }

      let title = null;
      const titleMatch = chunk.match(/class="[^"]*(?:z9E0IG|_2-N8zT)[^"]*"[^>]*>([^<]+)<\/(?:p|div)>/i);
      if (titleMatch && titleMatch[1].trim()) {
        title = titleMatch[1];
      }

      let author = "Flipkart Customer";
      let date = null;
      const authorMatches = [...chunk.matchAll(/class="[^"]*(?:_2NsDsF|_2sc7ZR)[^"]*"[^>]*>([^<]+)<\/(?:p|span)>/gi)];
      if (authorMatches.length > 0 && authorMatches[0][1].trim()) {
        const a = authorMatches[0][1].trim();
        if (!/certified buyer/i.test(a)) author = a;
      }
      if (authorMatches.length > 1 && authorMatches[1][1].trim()) {
        const d = authorMatches[1][1].trim();
        if (!/certified buyer/i.test(d)) date = d;
      }

      const verifiedPurchase = /class="[^"]*_2mcBVo[^"]*"|certified\s+buyer/i.test(chunk);

      addCleanReview({
        text: bodyMatch[1],
        rating,
        title,
        author,
        date,
        verified_purchase: verifiedPurchase,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Strategy 4: Fallback regex for ProductReviewValue
  // ---------------------------------------------------------------------------
  if (reviews.length === 0 && html.includes("ProductReviewValue")) {
    const matches = [...html.matchAll(/"type"\s*:\s*"ProductReviewValue"/g)];
    for (const m of matches) {
      try {
        const idx = m.index;
        const sub = html.slice(Math.max(0, idx - 50), idx + 2000);
        const textM = sub.match(/"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
        const ratingM = sub.match(/"rating"\s*:\s*(\d+(?:\.\d+)?)/);
        const titleM = sub.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/);
        const authorM = sub.match(/"author"\s*:\s*"((?:\\.|[^"\\])*)"/);
        const createdM = sub.match(/"created"\s*:\s*"((?:\\.|[^"\\])*)"/);
        const idM = sub.match(/"id"\s*:\s*"((?:\\.|[^"\\])*)"/);
        const certM = /"certifiedBuyer"\s*:\s*true|"VERIFIED_PURCHASE"\s*:\s*true/.test(sub);

        if (textM && textM[1]) {
          const unescapedText = textM[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
          addCleanReview({
            id: idM ? idM[1] : null,
            text: unescapedText,
            rating: ratingM ? parseFloat(ratingM[1]) : null,
            title: titleM ? titleM[1].replace(/\\"/g, '"') : null,
            author: authorM ? authorM[1].replace(/\\"/g, '"') : "Flipkart Customer",
            date: createdM ? createdM[1] : null,
            verified_purchase: certM,
          });
        }
      } catch (e) {}
    }
  }

  // ---------------------------------------------------------------------------
  // Check hasNextPage
  // ---------------------------------------------------------------------------
  if (!hasNextPage) {
    hasNextPage =
      /<a[^>]*class="[^"]*(?:_1LKTO3|cnfd9Q)[^"]*"[^>]*>[\s\S]*?<span>Next<\/span>/i.test(html) ||
      /<a[^>]*href="[^"]*[?&]page=\d+[^"]*"[^>]*>[\s\S]*?<span>Next<\/span>/i.test(html) ||
      /<span>Next<\/span>/i.test(html) ||
      (reviews.length >= 10);
  }

  return { reviews, hasNextPage };
}

function extractFlipkartReviews(customDoc) {
  const doc = customDoc || (typeof document !== "undefined" ? document : null);
  if (!doc) return [];

  // Check embedded scripts (window.__INITIAL_STATE__ and JSON-LD)
  try {
    const scripts = doc.querySelectorAll ? doc.querySelectorAll("script") : [];
    for (let i = 0; i < scripts.length; i++) {
      const txt = scripts[i].textContent || "";
      if (
        txt.includes("__INITIAL_STATE__") ||
        (scripts[i].id === "jsonLD" && txt.includes('"review"')) ||
        (scripts[i].getAttribute && scripts[i].getAttribute("type") === "application/ld+json" && txt.includes('"review"'))
      ) {
        const parsed = parseFlipkartReviewsFromHtml(txt);
        if (parsed && parsed.reviews && parsed.reviews.length > 0) {
          return parsed.reviews;
        }
      }
    }
  } catch (e) {}

  // Check window.__INITIAL_STATE__ directly if available in execution context
  try {
    const win = (doc && doc.defaultView) || (typeof window !== "undefined" ? window : null);
    if (win && win.__INITIAL_STATE__) {
      const parsed = parseFlipkartReviewsFromHtml(`window.__INITIAL_STATE__ = ${JSON.stringify(win.__INITIAL_STATE__)};</script>`);
      if (parsed && parsed.reviews && parsed.reviews.length > 0) {
        return parsed.reviews;
      }
    }
  } catch (e) {}

  const reviews = [];
  const rawCards = doc.querySelectorAll
    ? doc.querySelectorAll(
        'div._16PBlm, div._2wzgFH, div.col._2wzgFH, div._27M-vq, div.EPCmJX, div.RcXBOT, div[class*="EKF0m-"], div[class*="cPHDOP"] div[class*="_16PBlm"], div[class*="_16PBlm"], div[class*="_2wzgFH"], div[class*="_27M-vq"], div[class*="EPCmJX"]'
      )
    : [];

  let reviewCards = [];
  if (rawCards.length > 0) {
    for (let i = 0; i < rawCards.length; i++) {
      const c = rawCards[i];
      let isNested = false;
      let p = c.parentElement;
      while (p) {
        for (let j = 0; j < rawCards.length; j++) {
          if (rawCards[j] === p) { isNested = true; break; }
        }
        if (isNested) break;
        p = p.parentElement;
      }
      if (!isNested) reviewCards.push(c);
    }
  } else if (doc.querySelectorAll) {
    // Structural fallback: locate blocks by review text container
    const textEls = doc.querySelectorAll('div.ZmyHeo, div.t-ZTKy, div[class*="ZmyHeo"], div[class*="t-ZTKy"]');
    for (let i = 0; i < textEls.length; i++) {
      const tEl = textEls[i];
      const card = (tEl.closest ? tEl.closest('div.row, div[class*="col"], div[class*="row"], div') : null) || tEl.parentElement;
      if (card && !reviewCards.includes(card)) {
        reviewCards.push(card);
      }
    }
  }

  const seenTexts = new Set();

  for (let i = 0; i < reviewCards.length; i++) {
    const card = reviewCards[i];
    try {
      const bodyEl = card.querySelector(
        'div.ZmyHeo div div, div.ZmyHeo div, div.ZmyHeo, div.t-ZTKy div div, div.t-ZTKy div, div.t-ZTKy, div[class*="ZmyHeo"], div[class*="t-ZTKy"]'
      );
      let text = "";
      if (bodyEl && bodyEl.textContent) {
        text = bodyEl.textContent.replace(/READ MORE/gi, "").replace(/Read More/gi, "").trim().replace(/\s+/g, " ");
      }
      if (!text || text.length < 3) continue;

      const normKey = text.slice(0, 80).toLowerCase();
      if (seenTexts.has(normKey)) continue;
      seenTexts.add(normKey);

      let rating = null;
      const starEl = card.querySelector('div.XQDdHH, div._3LWZlK, div.hGSR34, div[class*="XQDdHH"], div[class*="_3LWZlK"], span[class*="XQDdHH"]');
      if (starEl && starEl.textContent) {
        const m = starEl.textContent.match(/(\d(?:\.\d)?)/);
        if (m) {
          rating = Math.round(parseFloat(m[1]));
        }
      }

      let title = null;
      const titleEl = card.querySelector('p.z9E0IG, p._2-N8zT, div.z9E0IG, div._2-N8zT, p[class*="z9E0IG"], p[class*="_2-N8zT"]');
      if (titleEl && titleEl.textContent) {
        title = titleEl.textContent.trim().replace(/\s+/g, " ");
      }

      let author = "Flipkart Customer";
      let date = null;
      const authorEls = card.querySelectorAll('p._2NsDsF, p._2sc7ZR, span._2NsDsF, span._2sc7ZR, p[class*="_2NsDsF"], p[class*="_2sc7ZR"]');
      if (authorEls.length > 0 && authorEls[0].textContent) {
        const aTxt = authorEls[0].textContent.trim();
        if (aTxt && !/certified buyer/i.test(aTxt)) author = aTxt;
      }
      if (authorEls.length > 1 && authorEls[1].textContent) {
        const dTxt = authorEls[1].textContent.trim();
        if (dTxt && !/certified buyer/i.test(dTxt)) date = dTxt;
      }

      let verifiedPurchase = false;
      const buyerEl = card.querySelector('p._2mcBVo, span._2mcBVo, p[class*="_2mcBVo"], span[class*="_2mcBVo"]');
      if (buyerEl || /certified buyer/i.test(card.textContent || "")) {
        verifiedPurchase = true;
      }

      const stableId = (card.getAttribute && card.getAttribute("data-review-id")) ||
                       (card.id ? card.id : null) ||
                       `fk_${(author + "_" + (date || "") + "_" + text.slice(0, 30)).toLowerCase().replace(/[^a-z0-9]/g, "")}` ||
                       `fk_rev_${i + 1}`;

      reviews.push({
        id: stableId,
        text: text,
        rating: rating,
        title: title,
        author: author,
        date: date,
        verified_purchase: verifiedPurchase,
      });
    } catch (e) {}
  }
  return reviews;
}

async function fetchFlipkartDedicatedReviews(productUrl, pid) {
  let reviewsUrl = null;
  if (typeof document !== "undefined") {
    const allLink = document.querySelector('a[href*="/product-reviews/"]');
    if (allLink && allLink.getAttribute("href")) {
      try {
        reviewsUrl = new URL(allLink.getAttribute("href"), window.location.origin).href;
      } catch (e) {}
    }
  }

  if (!reviewsUrl && productUrl) {
    try {
      const u = new URL(productUrl);
      if (u.pathname.includes("/product-reviews/")) {
        reviewsUrl = u.origin + u.pathname;
      } else if (u.pathname.includes("/p/")) {
        reviewsUrl = u.origin + u.pathname.replace("/p/", "/product-reviews/");
      }
      if (reviewsUrl) {
        const bu = new URL(reviewsUrl);
        if (pid) bu.searchParams.set("pid", pid);
        for (const [k, v] of u.searchParams.entries()) {
          if (k !== "page" && !bu.searchParams.has(k)) {
            bu.searchParams.set(k, v);
          }
        }
        reviewsUrl = bu.href;
      }
    } catch (e) {}
  }

  if (!reviewsUrl && pid) {
    reviewsUrl = `https://www.flipkart.com/product-reviews/p?pid=${encodeURIComponent(pid)}`;
  }

  if (!reviewsUrl) return [];

  try {
    const resp = await fetch(reviewsUrl, {
      credentials: "include",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    if (!html || html.length < 100) return [];

    const parsed = parseFlipkartReviewsFromHtml(html);
    if (parsed && parsed.reviews && parsed.reviews.length > 0) {
      return parsed.reviews;
    }

    if (typeof DOMParser !== "undefined") {
      const parser = new DOMParser();
      const pageDoc = parser.parseFromString(html, "text/html");
      const revs = extractFlipkartReviews(pageDoc);
      if (revs && revs.length > 0) return revs;
    }
    return [];
  } catch (e) {
    return [];
  }
}

function extractReviews(customDoc, customUrl) {
  const href = customUrl || (typeof window !== "undefined" ? window.location.href : "");
  let hostname = "";
  try {
    hostname = new URL(href).hostname;
  } catch (e) {
    if (typeof window !== "undefined") hostname = window.location.hostname || "";
  }

  if (hostname.includes("amazon.in")) {
    return extractAmazonReviews(customDoc);
  }
  if (hostname.includes("flipkart.com")) {
    return extractFlipkartReviews(customDoc);
  }
  return [];
}

function extractProduct(customDoc, customUrl, options = {}) {
  const href = customUrl || (typeof window !== "undefined" ? window.location.href : "");
  let hostname = "";
  try {
    hostname = new URL(href).hostname;
  } catch (e) {
    if (typeof window !== "undefined") hostname = window.location.hostname || "";
  }

  let prod = null;
  if (hostname.includes("amazon.in")) {
    prod = extractAmazonProduct(customDoc, customUrl, options);
  } else if (hostname.includes("flipkart.com")) {
    prod = extractFlipkartProduct(customDoc, customUrl, options);
  }
  return prod;
}

function calculateRatingDistribution(reviews) {
  const dist = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0, "unrated": 0 };
  if (!Array.isArray(reviews)) return dist;
  for (let i = 0; i < reviews.length; i++) {
    const r = reviews[i];
    const star = r && r.rating;
    if (typeof star === "number" && !isNaN(star) && star >= 1 && star <= 5) {
      const rounded = String(Math.round(star));
      if (dist[rounded] !== undefined) {
        dist[rounded]++;
      } else {
        dist["unrated"]++;
      }
    } else {
      dist["unrated"]++;
    }
  }
  return dist;
}

let cancelReviewCollectionRequested = false;

async function fetchAmazonDedicatedReviews(asin, pageNumber = 1, options = {}) {
  if (!asin || typeof fetch === "undefined") return [];
  try {
    const sortParam = options.sortByRecent ? "&sortBy=recent" : "";
    const filterByStar = options.filterByStar ? `&filterByStar=${encodeURIComponent(options.filterByStar)}` : "";
    const base = options.baseUrl || `https://www.amazon.in/product-reviews/${encodeURIComponent(asin)}`;
    const url = `${base}?reviewerType=all_reviews&pageNumber=${pageNumber}${sortParam}${filterByStar}`;
    const resp = await fetch(url, {
      credentials: "include",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    if (!html || html.length < 100) return [];
    if (html.includes("captchacharacters") || html.includes("Robot Check")) return [];
    if (typeof DOMParser !== "undefined") {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      return extractAmazonReviews(doc);
    }
  } catch (err) {
    console.warn("[DealSense] fetchAmazonDedicatedReviews error:", err);
  }
  return [];
}

async function collectMultiPageReviews(options = {}) {
  const targetCount = options.targetCount || 100;
  const maxCount = options.maxCount || 300;
  const diversify = options.diversify !== false;

  const href = typeof window !== "undefined" ? window.location.href : "";
  let hostname = "";
  try {
    hostname = new URL(href).hostname;
  } catch (e) {
    if (typeof window !== "undefined") hostname = window.location.hostname || "";
  }

  const seenIds = new Set();
  const seenTexts = new Set();
  const collected = [];

  function addReview(r) {
    if (!r || !r.text || typeof r.text !== "string") return false;
    const cleanText = r.text.trim().replace(/\s+/g, " ");
    if (cleanText.length < 5) return false;

    // Filter out Q&A headers and FAQ prompts
    const lower = cleanText.toLowerCase();
    if (/^(q:|question:|have a question\?|frequently asked questions|showing \d+ of)/i.test(lower)) {
      return false;
    }

    let cleanId = r.id;
    if (cleanId && typeof cleanId === "string") {
      cleanId = cleanId.replace(/^customer_review-/, "").trim();
    }
    if (cleanId && seenIds.has(cleanId)) return false;

    const textKey = lower.slice(0, 100);
    if (seenTexts.has(textKey)) return false;

    if (cleanId) seenIds.add(cleanId);
    seenTexts.add(textKey);

    collected.push({
      ...r,
      id: cleanId || r.id,
      text: cleanText,
    });
    return true;
  }

  // 1. Initial reviews from current DOM
  try {
    const initial = extractReviews();
    if (Array.isArray(initial)) {
      for (let i = 0; i < initial.length; i++) {
        addReview(initial[i]);
      }
    }
  } catch (e) {}

  let pagesScanned = 1;
  let hasMore = true;
  let limitationNote = null;
  let stoppedReason = "target_reached";

  if (typeof fetch === "undefined" || typeof DOMParser === "undefined") {
    return {
      success: true,
      reviews: collected,
      total_collected: collected.length,
      pages_scanned: pagesScanned,
      target_count: targetCount,
      has_more: false,
      rating_distribution: calculateRatingDistribution(collected),
      limitation_note: null,
      stopped_reason: collected.length >= targetCount ? "target_reached" : "no_fetch_env",
    };
  }

  // Amazon India Multi-Page Collection
  if (hostname.includes("amazon.in")) {
    let asin = null;
    try {
      const prod = extractProduct();
      if (prod && prod.asin) asin = prod.asin;
    } catch (e) {}
    if (!asin && typeof extractAmazonAsin === "function" && typeof document !== "undefined") {
      asin = extractAmazonAsin(document, href);
    }
    if (!asin) {
      try {
        const u = new URL(href);
        const m = u.pathname.match(/\/(?:dp|product|gp\/product|product-reviews)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
        if (m) asin = m[1].toUpperCase();
      } catch (e) {}
    }

    if (!asin) {
      return {
        success: true,
        reviews: collected,
        total_collected: collected.length,
        pages_scanned: pagesScanned,
        target_count: targetCount,
        has_more: false,
        rating_distribution: calculateRatingDistribution(collected),
        limitation_note: "Unable to detect ASIN for review pagination.",
        stopped_reason: "missing_asin",
      };
    }

    let baseReviewsUrl = null;
    let nextPageUrl = null;
    if (typeof document !== "undefined") {
      const seeAllLink = document.querySelector(
        'a[data-hook="see-all-reviews-link-foot"], a[data-hook="see-all-reviews-link"], #reviews-medley-footer a'
      );
      if (seeAllLink && seeAllLink.getAttribute("href")) {
        try {
          const parsed = new URL(seeAllLink.getAttribute("href"), window.location.origin);
          baseReviewsUrl = `${parsed.origin}${parsed.pathname}`;
          nextPageUrl = parsed.href;
        } catch (e) {}
      }
    }
    if (!baseReviewsUrl) {
      baseReviewsUrl = `https://www.amazon.in/product-reviews/${encodeURIComponent(asin)}`;
    }

    const maxPages = 50;
    let currentPage = href.includes("/product-reviews/") ? 2 : 1;

    // Stream 1: Primary helpful / all reviews (do not force sortBy=recent)
    while (currentPage <= maxPages) {
      if (cancelReviewCollectionRequested) {
        hasMore = false;
        stoppedReason = "cancelled";
        limitationNote = "Review collection was cancelled.";
        break;
      }

      try {
        await new Promise((res) => setTimeout(res, 220 + Math.random() * 80));

        let pageUrl = nextPageUrl;
        if (!pageUrl) {
          pageUrl = `${baseReviewsUrl}?reviewerType=all_reviews&pageNumber=${currentPage}`;
        }

        const resp = await fetch(pageUrl, {
          credentials: "include",
          headers: {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });

        if (!resp.ok) {
          if (resp.status === 403 || resp.status === 503) {
            limitationNote = `Review collection safely stopped: Amazon returned HTTP ${resp.status} (rate limit or bot control).`;
            hasMore = false;
            stoppedReason = "access_restricted";
            break;
          }
          hasMore = false;
          stoppedReason = `http_${resp.status}`;
          break;
        }

        const html = await resp.text();
        if (!html || html.length < 500) {
          hasMore = false;
          stoppedReason = "empty_response";
          break;
        }

        if (
          html.includes("captchacharacters") ||
          html.includes("Enter the characters you see below") ||
          html.includes("Robot Check")
        ) {
          limitationNote = "Review collection safely stopped: Amazon anti-bot CAPTCHA challenge encountered.";
          hasMore = false;
          stoppedReason = "captcha_detected";
          break;
        }

        const parser = new DOMParser();
        const pageDoc = parser.parseFromString(html, "text/html");
        const pageRevs = extractAmazonReviews(pageDoc);

        if (pageRevs.length === 0) {
          hasMore = false;
          stoppedReason = "no_more_pages";
          break;
        }

        let addedThisPage = 0;
        for (let i = 0; i < pageRevs.length; i++) {
          if (addReview(pageRevs[i])) {
            addedThisPage++;
          }
        }

        pagesScanned++;
        currentPage++;

        const nextDisabled = pageDoc.querySelector(
          "li.a-last.a-disabled, #cm_cr-pagination_bar .a-last.a-disabled, ul.a-pagination li.a-last.a-disabled"
        );
        const nextLink = pageDoc.querySelector(
          "li.a-last a, #cm_cr-pagination_bar .a-last a, ul.a-pagination li.a-last a"
        );

        if (nextDisabled || (addedThisPage === 0 && currentPage > 2) || !nextLink || !nextLink.getAttribute("href")) {
          hasMore = false;
          stoppedReason = "all_accessible_collected";
          break;
        }

        try {
          nextPageUrl = new URL(nextLink.getAttribute("href"), "https://www.amazon.in").href;
        } catch (e) {
          nextPageUrl = null;
        }
      } catch (err) {
        console.warn("[DealSense] Amazon review pagination error:", err);
        limitationNote = "Review pagination interrupted by network error.";
        stoppedReason = "network_error";
        break;
      }
    }

    // Stream 2: Recent reviews sweep if primary stream ended
    if (!cancelReviewCollectionRequested && stoppedReason !== "captcha_detected" && stoppedReason !== "access_restricted") {
      for (let recentPage = 1; recentPage <= 10; recentPage++) {
        try {
          await new Promise((res) => setTimeout(res, 220 + Math.random() * 80));
          const recentUrl = `${baseReviewsUrl}?reviewerType=all_reviews&pageNumber=${recentPage}&sortBy=recent`;
          const resp = await fetch(recentUrl, {
            credentials: "include",
            headers: {
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });
          if (!resp.ok) break;
          const html = await resp.text();
          if (html.includes("captchacharacters") || html.includes("Robot Check")) break;
          const parser = new DOMParser();
          const recentDoc = parser.parseFromString(html, "text/html");
          const recentRevs = extractAmazonReviews(recentDoc);
          if (recentRevs.length === 0) break;
          let added = 0;
          for (let i = 0; i < recentRevs.length; i++) {
            if (addReview(recentRevs[i])) added++;
          }
          pagesScanned++;
          if (recentDoc.querySelector("li.a-last.a-disabled") || (added === 0 && recentPage > 1)) break;
        } catch (e) {
          break;
        }
      }
    }

    // Stream 3: Rating diversity sweep (fetch critical reviews if negative reviews are underrepresented)
    if (diversify && !cancelReviewCollectionRequested && stoppedReason !== "captcha_detected" && stoppedReason !== "access_restricted") {
      const dist = calculateRatingDistribution(collected);
      const criticalCount = (dist["1"] || 0) + (dist["2"] || 0) + (dist["3"] || 0);
      if (criticalCount < 3 && collected.length >= 10) {
        for (let critPage = 1; critPage <= 5; critPage++) {
          try {
            await new Promise((res) => setTimeout(res, 220 + Math.random() * 80));
            const critUrl = `${baseReviewsUrl}?reviewerType=all_reviews&pageNumber=${critPage}&filterByStar=critical`;
            const resp = await fetch(critUrl, {
              credentials: "include",
              headers: {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              },
            });
            if (!resp.ok) break;
            const html = await resp.text();
            if (html.includes("captchacharacters") || html.includes("Robot Check")) break;
            const parser = new DOMParser();
            const critDoc = parser.parseFromString(html, "text/html");
            const critRevs = extractAmazonReviews(critDoc);
            if (critRevs.length === 0) break;
            for (let i = 0; i < critRevs.length; i++) {
              addReview(critRevs[i]);
            }
            pagesScanned++;
            if (critDoc.querySelector("li.a-last.a-disabled")) break;
          } catch (e) {
            break;
          }
        }
      }
    }
  } else if (hostname.includes("flipkart.com")) {
    // Flipkart Multi-Page Reviews
    let baseReviewsUrl = null;
    if (typeof document !== "undefined") {
      const allLink = document.querySelector('a[href*="/product-reviews/"]');
      if (allLink && allLink.getAttribute("href")) {
        try {
          baseReviewsUrl = new URL(allLink.getAttribute("href"), window.location.origin).href;
        } catch (e) {}
      }
    }
    if (!baseReviewsUrl && href.includes("/p/")) {
      baseReviewsUrl = href.replace("/p/", "/product-reviews/");
    }

    if (baseReviewsUrl) {
      const maxPages = 50;
      let currentPage = 1;
      while (currentPage <= maxPages) {
        try {
          await new Promise((res) => setTimeout(res, 120 + Math.random() * 60));
          const u = new URL(baseReviewsUrl);
          u.searchParams.set("page", String(currentPage));
          const resp = await fetch(u.href, { credentials: "include" });
          if (!resp.ok) break;
          const html = await resp.text();
          if (!html || html.length < 500) break;
          let pageRevs = [];
          if (typeof DOMParser !== "undefined") {
            const parser = new DOMParser();
            const pageDoc = parser.parseFromString(html, "text/html");
            pageRevs = extractFlipkartReviews(pageDoc);
          }
          if (pageRevs.length === 0) {
            const parsed = parseFlipkartReviewsFromHtml(html);
            if (parsed && Array.isArray(parsed.reviews) && parsed.reviews.length > 0) {
              pageRevs = parsed.reviews;
            }
          }
          if (pageRevs.length === 0) {
            hasMore = false;
            stoppedReason = "no_more_pages";
            break;
          }
          let added = 0;
          for (let i = 0; i < pageRevs.length; i++) {
            if (addReview(pageRevs[i])) {
              added++;
            }
          }
          pagesScanned++;
          currentPage++;
          if (added === 0 && currentPage > 2) break;
        } catch (e) {
          break;
        }
      }
    }
  }

  if (stoppedReason === "target_reached") {
    stoppedReason = "all_accessible_collected";
  }

  return {
    success: true,
    reviews: collected,
    total_collected: collected.length,
    pages_scanned: pagesScanned,
    target_count: collected.length,
    has_more: hasMore,
    rating_distribution: calculateRatingDistribution(collected),
    limitation_note: limitationNote,
    stopped_reason: stoppedReason,
  };
}

if (typeof window !== "undefined") {
  window.calculateRatingDistribution = calculateRatingDistribution;
  window.collectMultiPageReviews = collectMultiPageReviews;
  window.fetchAmazonDedicatedReviews = fetchAmazonDedicatedReviews;
}
if (typeof globalThis !== "undefined") {
  globalThis.calculateRatingDistribution = calculateRatingDistribution;
  globalThis.collectMultiPageReviews = collectMultiPageReviews;
  globalThis.fetchAmazonDedicatedReviews = fetchAmazonDedicatedReviews;
}

// Listen for extraction requests from popup
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === "extractAmazonSearchResults") {
      try {
        const searchData = extractAmazonSearchResults();
        sendResponse({ success: true, data: searchData });
      } catch (err) {
        sendResponse({ success: false, error: String(err) });
      }
      return true;
    }

    if (request && (request.action === "extractProductReviews" || request.action === "extractReviews")) {
      try {
        const revs = extractReviews();
        sendResponse({ success: true, reviews: revs, total_found: revs.length });
      } catch (err) {
        sendResponse({ success: false, error: String(err) });
      }
      return true;
    }

    if (request && request.action === "cancelReviewCollection") {
      cancelReviewCollectionRequested = true;
      sendResponse({ success: true, cancelled: true });
      return true;
    }

    if (request && request.action === "collectMultiPageReviews") {
      cancelReviewCollectionRequested = false;
      collectMultiPageReviews(request).then((result) => {
        sendResponse(result);
      }).catch((err) => {
        sendResponse({ success: false, error: String(err) });
      });
      return true;
    }

    if (request && request.action === "extractProduct") {
      try {
        const product = extractProduct();
        if (product) {
          if (product.source_retailer === "Amazon.in" && product.asin && (!product.reviews || product.reviews.length === 0)) {
            fetchAmazonDedicatedReviews(product.asin).then((fetchedRevs) => {
              if (fetchedRevs && fetchedRevs.length > 0) {
                product.reviews = fetchedRevs;
                product.scan_metadata = {
                  pages_scanned: 1,
                  total_reviews_found: fetchedRevs.length,
                  has_more: true,
                  limitation_note: null,
                  target_count: 100,
                  rating_distribution: calculateRatingDistribution(fetchedRevs),
                };
              }
              sendResponse({ success: true, data: product });
            }).catch(() => {
              sendResponse({ success: true, data: product });
            });
            return true;
          }
          if (product.source_retailer === "Flipkart" && (!product.reviews || product.reviews.length === 0)) {
            fetchFlipkartDedicatedReviews(product.url, product.retailer_product_id).then((fetchedRevs) => {
              if (fetchedRevs && fetchedRevs.length > 0) {
                product.reviews = fetchedRevs;
                product.scan_metadata = {
                  pages_scanned: 1,
                  total_reviews_found: fetchedRevs.length,
                  has_more: true,
                  limitation_note: null,
                  target_count: 100,
                  rating_distribution: calculateRatingDistribution(fetchedRevs),
                };
              }
              sendResponse({ success: true, data: product });
            }).catch(() => {
              sendResponse({ success: true, data: product });
            });
            return true;
          }
          if (product.reviews && product.reviews.length > 0 && product.scan_metadata) {
            product.scan_metadata.rating_distribution = calculateRatingDistribution(product.reviews);
            product.scan_metadata.target_count = 100;
          }
          sendResponse({ success: true, data: product });
        } else {
          const href = typeof window !== "undefined" ? window.location.href : "";
          let reason = "UNSUPPORTED_PAGE";
          let hostname = "";
          try {
            hostname = new URL(href).hostname;
          } catch (e) {}

          if (!hostname.includes("amazon.in") && !hostname.includes("flipkart.com")) {
            reason = "UNSUPPORTED_DOMAIN";
          } else if (hostname.includes("flipkart.com") && !href.includes("/p/")) {
            reason = "FLIPKART_NON_PRODUCT_PAGE";
          } else if (hostname.includes("amazon.in") && !href.includes("/dp/") && !href.includes("/gp/product") && !href.includes("/product-reviews")) {
            reason = "AMAZON_NON_PRODUCT_PAGE";
          }
          sendResponse({ success: false, reason: reason });
        }
      } catch (err) {
        sendResponse({ success: false, error: String(err) });
      }
    }
    return true;
  });
}

// Targeted DOM observation and SPA navigation listener for automatic variant & navigation detection
let lastSentIdentity = null;
let lastSentFingerprint = null;
let debounceTimer = null;
let isUserScrolling = false;
let scrollEndTimer = null;

if (typeof window !== "undefined") {
  window.__dealSenseGetLastSentIdentity = () => lastSentIdentity;
  window.__dealSenseSetLastSentIdentity = (v) => {
    lastSentIdentity = v;
    lastSentFingerprint = null;
  };

  if (typeof window.addEventListener === "function") {
    try {
      window.addEventListener(
        "scroll",
        () => {
          isUserScrolling = true;
          if (scrollEndTimer) clearTimeout(scrollEndTimer);
          scrollEndTimer = setTimeout(() => {
            isUserScrolling = false;
          }, 250);
        },
        { passive: true }
      );
    } catch (e) {}
  }
}

function getQuickProductFingerprint() {
  try {
    const doc = typeof document !== "undefined" ? document : null;
    const href = typeof window !== "undefined" && window.location ? window.location.href : "";
    if (!doc) return null;
    if (href.includes("amazon.in")) {
      const asinMatch = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      const asin = asinMatch ? asinMatch[1].toUpperCase() : (doc.querySelector && doc.querySelector('input#ASIN, input[name="ASIN"]')?.value ? doc.querySelector('input#ASIN, input[name="ASIN"]').value : "");
      const priceEl = doc.querySelector ? doc.querySelector("#corePriceDisplay_desktop_feature_div, #corePrice_desktop, .a-price .a-offscreen") : null;
      const priceText = priceEl ? (priceEl.textContent || "").trim() : "";
      const varEl = doc.querySelector ? doc.querySelector("#variation_color_name .selection, #variation_size_name .selection, #inline-twister-expanded-dimension-text-color_name") : null;
      const varText = varEl ? (varEl.textContent || "").trim() : "";
      return `amz::${asin}::${priceText.slice(0, 30)}::${varText.slice(0, 30)}`;
    } else if (href.includes("flipkart.com")) {
      let pid = "";
      try {
        const u = new URL(href);
        pid = u.searchParams.get("pid") || "";
      } catch (e) {}
      const priceEl = doc.querySelector ? doc.querySelector('div[class*="Nx9bqj"], div[class*="_30jeq3"], div[class*="v1zwn21n"]') : null;
      const priceText = priceEl ? (priceEl.textContent || "").trim() : "";
      return `fk::${pid}::${priceText.slice(0, 30)}`;
    }
  } catch (e) {}
  return null;
}

function isIgnoredMutationTarget(node) {
  if (!node) return false;
  try {
    const el = node.nodeType === 1 ? node : (node.parentElement || null);
    if (!el || !el.closest) return false;
    return Boolean(
      el.closest(
        '#reviewsMedley, #customerReviews, #cm-cr-dp-review-list, [data-hook="review"], ' +
        '.a-carousel, [data-a-carousel], #desktop-dp-sims_purchase-similarities-feature, #similarities_feature_div, #rhf, ' +
        '#nav-belt, #navbar, #navFooter, footer, header, #skiplink, ' +
        '#hover-zoom, #main-image-container, .imgTagWrapper, ' +
        '#ape_Detail_hero-quick-promo_Desktop_placement, [id*="ad-"], [id*="ad_"], iframe, ' +
        '.a-popover, .a-modal, [role="dialog"], [role="tooltip"], div[class*="carousel"]'
      )
    );
  } catch (e) {
    return false;
  }
}

function checkAndNotifyProductUpdate() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  // While scrolling, postpone extraction until scrolling finishes
  if (isUserScrolling) {
    debounceTimer = setTimeout(checkAndNotifyProductUpdate, 350);
    return;
  }
  debounceTimer = setTimeout(() => {
    try {
      if (isUserScrolling) {
        debounceTimer = setTimeout(checkAndNotifyProductUpdate, 350);
        return;
      }

      const quickFp = getQuickProductFingerprint();
      if (quickFp && quickFp === lastSentFingerprint && lastSentIdentity !== null) {
        return;
      }

      // Fast check without expensive DOM review queries
      const prod = extractProduct(null, null, { skipReviews: true });
      if (!prod) {
        if (lastSentIdentity !== null) {
          lastSentIdentity = null;
          lastSentFingerprint = null;
          if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ action: "productUnavailable" }, () => {
              if (chrome.runtime?.lastError) {}
            });
          }
        }
        return;
      }
      const ident = `${prod.source_retailer}::${prod.retailer_product_id || prod.url}::${prod.product_name}::${prod.current_site_price}::${prod.variant || ""}`;
      if (ident !== lastSentIdentity) {
        lastSentIdentity = ident;
        lastSentFingerprint = quickFp;
        try {
          prod.reviews = extractReviews();
          if (prod.scan_metadata) {
            prod.scan_metadata.total_reviews_found = prod.reviews.length;
          }
        } catch (e) {}
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: "productUpdated", data: prod }, () => {
            if (chrome.runtime?.lastError) {}
          });
        }
      }
    } catch (e) {}
  }, 400);
}

// Observe target containers on both Amazon and Flipkart with targeted scoping
if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
  try {
    const targetContainers = [
      // Amazon containers: prefer #centerCol or #twister before #dp to avoid observing whole page
      document.querySelector("#centerCol"),
      document.querySelector("#twister"),
      document.querySelector("#twisterContainer"),
      document.querySelector("#corePriceDisplay_desktop_feature_div"),
      document.querySelector("#corePrice_desktop"),
      document.querySelector("#title_feature_div"),
      document.querySelector("#dp"),
      // Flipkart containers
      document.querySelector("div[class*='v1zwn']"),
      document.querySelector("#container"),
      document.body,
    ].filter(Boolean);

    if (targetContainers.length > 0) {
      const observer = new MutationObserver((mutations) => {
        if (isUserScrolling) return;
        if (mutations && mutations.length > 0) {
          let hasRelevant = false;
          for (let i = 0; i < mutations.length; i++) {
            if (!isIgnoredMutationTarget(mutations[i].target)) {
              hasRelevant = true;
              break;
            }
          }
          if (!hasRelevant) return;
        }
        checkAndNotifyProductUpdate();
      });
      const primary = targetContainers[0];
      observer.observe(primary, { childList: true, subtree: true });
    }
  } catch (e) {}
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", checkAndNotifyProductUpdate);
  window.addEventListener("hashchange", checkAndNotifyProductUpdate);
}

// Hook pushState and replaceState to immediately capture client-side SPA navigation
try {
  if (typeof history !== "undefined") {
    const origPush = history.pushState;
    if (typeof origPush === "function") {
      history.pushState = function () {
        const res = origPush.apply(this, arguments);
        if (!isUserScrolling) {
          checkAndNotifyProductUpdate();
        }
        return res;
      };
    }
    const origReplace = history.replaceState;
    if (typeof origReplace === "function") {
      history.replaceState = function () {
        const res = origReplace.apply(this, arguments);
        if (!isUserScrolling) {
          checkAndNotifyProductUpdate();
        }
        return res;
      };
    }
  }
} catch (e) {}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    extractAmazonProduct,
    extractAmazonSearchResults,
    extractAmazonAsin,
    extractAmazonImage,
    extractAmazonMrp,
    extractAmazonVariant,
    extractFlipkartProduct,
    extractFlipkartIds,
    extractFlipkartSellingPrice,
    extractFlipkartMrp,
    extractFlipkartSeller,
    extractFlipkartImage,
    extractFlipkartVariantAndSpecs,
    extractProduct,
    parsePriceText,
    checkAndNotifyProductUpdate,
    extractAmazonReviews,
    extractFlipkartReviews,
    extractFlipkartRatingTotals,
    extractReviews,
    _getLastSentIdentity: () => lastSentIdentity,
    _setLastSentIdentity: (v) => { lastSentIdentity = v; },
  };
}
