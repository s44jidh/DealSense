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

function extractAmazonProduct(customDoc, customUrl) {
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
  const seller = extractAmazonSeller(doc);

  // 6. Brand and Model
  const brand = extractAmazonBrand(doc, productName, jsonLd);
  const model = extractAmazonModel(doc, productName, brand, jsonLd);
  const category = extractAmazonCategory(doc, productName, jsonLd);

  // 7. Specifications
  const specs = extractAmazonSpecifications(doc, jsonLd);

  // 7b. Rating & Total Ratings
  const { rating, ratingsTotal } = extractAmazonRating(doc, jsonLd);

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
  const reviews = extractAmazonReviews(doc);

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
    source: "live_dom"
  });

  return {
    source_retailer: "Amazon.in",
    product_name: productName,
    product_title: productName,
    url: url,
    product_url: url,
    current_site_price: sellingPrice,
    current_price: sellingPrice,
    currency: "INR",
    mrp: mrp,
    seller: seller || "Unavailable",
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
    reviews_total: ratingsTotal,
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

  return { rating, ratingsTotal };
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

function extractAmazonSeller(doc) {
  const sellerEl =
    doc.querySelector("#sellerProfileTriggerId") ||
    doc.querySelector("#merchant-info a") ||
    doc.querySelector("#tabular-buybox .tabular-buybox-container tr:last-child td:last-child span") ||
    doc.querySelector("#merchant-info");

  if (!sellerEl) return null;
  let text = sellerEl.textContent ? sellerEl.textContent.trim() : "";
  text = text.replace(/^Sold by:?\s*/i, "").replace(/\s+and\s+Fulfilled by.*$/i, "").trim();
  if (text.includes("Amazon.in") || text.includes("Appario") || text.includes("Retail")) {
    return text.split(/\r?\n/)[0].trim();
  }
  return text || null;
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

function extractFlipkartProduct(customDoc, customUrl) {
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
  const reviews = extractFlipkartReviews(doc);

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
    seller: seller || "Unavailable",
    brand: resolvedBrand,
    model: resolvedModel,
    specifications: specifications,
    image: image,
    image_url: image,
    variant: variant,
    retailer_product_id: retailerProductId,
    manufacturer_part_number: null,
    category: (jsonLd && jsonLd.category) || null,
    availability: availability,
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

      reviews.push({
        id: (card.getAttribute ? card.getAttribute("id") : card.id) || ("amz_rev_" + (i + 1)),
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

function extractFlipkartReviews(customDoc) {
  const doc = customDoc || (typeof document !== "undefined" ? document : null);
  if (!doc) return [];

  const reviews = [];
  const rawCards = doc.querySelectorAll('div._16PBlm, div.col._2wzgFH, div._27M-vq, div.EPCmJX, div[class*="cPHDOP"] div[class*="_16PBlm"]');
  // Deduplicate nested card elements (e.g. col _2wzgFH inside _16PBlm)
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
      const bodyEl = card.querySelector('div.t-ZTKy div div, div.t-ZTKy, div.ZmyHeo div div, div.ZmyHeo, div[class*="t-ZTKy"]');
      let text = "";
      if (bodyEl) {
        text = bodyEl.textContent.replace(/READ MORE/gi, "").trim().replace(/\s+/g, " ");
      }
      if (!text || text.length < 3) continue;

      let rating = null;
      const starEl = card.querySelector('div._3LWZlK, div.XQDdHH, div[class*="_3LWZlK"], div[class*="XQDdHH"]');
      if (starEl && starEl.textContent) {
        const m = starEl.textContent.match(/(\d(?:\.\d)?)/);
        if (m) {
          rating = Math.round(parseFloat(m[1]));
        }
      }

      let title = null;
      const titleEl = card.querySelector('p._2-N8zT, p.z9E0IG, p[class*="_2-N8zT"], p[class*="z9E0IG"]');
      if (titleEl && titleEl.textContent) {
        title = titleEl.textContent.trim().replace(/\s+/g, " ");
      }

      let author = "Flipkart Customer";
      let date = null;
      const authorEls = card.querySelectorAll('p._2sc7ZR, p._2NsDsF, p[class*="_2sc7ZR"], p[class*="_2NsDsF"]');
      if (authorEls.length > 0 && authorEls[0].textContent) {
        author = authorEls[0].textContent.trim();
      }
      if (authorEls.length > 1 && authorEls[1].textContent) {
        date = authorEls[1].textContent.trim();
      }

      let verifiedPurchase = false;
      const buyerEl = card.querySelector('p._2mcBVo, p[class*="_2mcBVo"]');
      if (buyerEl || /certified buyer/i.test(card.textContent || "")) {
        verifiedPurchase = true;
      }

      reviews.push({
        id: "fk_rev_" + (i + 1),
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

function extractProduct(customDoc, customUrl) {
  const href = customUrl || (typeof window !== "undefined" ? window.location.href : "");
  let hostname = "";
  try {
    hostname = new URL(href).hostname;
  } catch (e) {
    if (typeof window !== "undefined") hostname = window.location.hostname || "";
  }

  let prod = null;
  if (hostname.includes("amazon.in")) {
    prod = extractAmazonProduct(customDoc, customUrl);
  } else if (hostname.includes("flipkart.com")) {
    prod = extractFlipkartProduct(customDoc, customUrl);
  }
  if (prod) {
    prod.reviews = extractReviews(customDoc, customUrl);
  }
  return prod;
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

async function fetchAmazonDedicatedReviews(asin) {
  if (!asin || typeof fetch === "undefined") return [];
  try {
    const url = `https://www.amazon.in/product-reviews/${encodeURIComponent(asin)}/?reviewerType=all_reviews&pageNumber=1`;
    const resp = await fetch(url, {
      credentials: "include",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    if (!html || html.length < 500) return [];
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
                };
              }
              sendResponse({ success: true, data: product });
            }).catch(() => {
              sendResponse({ success: true, data: product });
            });
            return true;
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
let debounceTimer = null;

if (typeof window !== "undefined") {
  window.__dealSenseGetLastSentIdentity = () => lastSentIdentity;
  window.__dealSenseSetLastSentIdentity = (v) => { lastSentIdentity = v; };
}

function checkAndNotifyProductUpdate() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    try {
      const prod = extractProduct();
      if (!prod) {
        if (lastSentIdentity !== null) {
          lastSentIdentity = null;
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
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: "productUpdated", data: prod }, () => {
            if (chrome.runtime?.lastError) {}
          });
        }
      }
    } catch (e) {}
  }, 400);
}

// Observe target containers on both Amazon and Flipkart
if (typeof MutationObserver !== "undefined") {
  const targetContainers = [
    // Amazon containers
    document.querySelector("#dp"),
    document.querySelector("#centerCol"),
    document.querySelector("#twister"),
    document.querySelector("#twisterContainer"),
    document.querySelector("#corePriceDisplay_desktop_feature_div"),
    document.querySelector("#corePrice_desktop"),
    document.querySelector("#title_feature_div"),
    // Flipkart containers
    document.querySelector("#container"),
    document.querySelector("div[class*='v1zwn']"),
    document.body,
  ].filter(Boolean);

  if (targetContainers.length > 0) {
    const observer = new MutationObserver(() => {
      checkAndNotifyProductUpdate();
    });
    // Limit to the most specific top-level container found
    const primary = targetContainers[0];
    observer.observe(primary, { childList: true, subtree: true, characterData: true });
  }
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
        checkAndNotifyProductUpdate();
        return res;
      };
    }
    const origReplace = history.replaceState;
    if (typeof origReplace === "function") {
      history.replaceState = function () {
        const res = origReplace.apply(this, arguments);
        checkAndNotifyProductUpdate();
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
    extractReviews,
    _getLastSentIdentity: () => lastSentIdentity,
    _setLastSentIdentity: (v) => { lastSentIdentity = v; },
  };
}
