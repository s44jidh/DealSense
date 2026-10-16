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
  const cleaned = text.replace(/,/g, "").replace(/[^\d.]/g, " ").trim();
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

  // 1. Main Product Title strictly from #productTitle
  const titleEl = doc.querySelector("#productTitle");
  if (!titleEl) {
    return null;
  }
  const rawTitle = titleEl.textContent || "";
  const productName = rawTitle.trim().replace(/\s+/g, " ");
  if (!productName || productName.length === 0) {
    return null;
  }

  // 2. Product ASIN and Canonical URL
  const asin = extractAmazonAsin(doc, href);
  if (!asin) {
    return null;
  }
  const url = `https://www.amazon.in/dp/${asin}`;

  // 3. Selling Price - Scoped strictly to main product core price containers
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
  ].filter(Boolean);

  const priceSelectors = [
    ".apexPriceToPay .a-offscreen",
    ".priceToPay .a-offscreen",
    "span.a-price.priceToPay span.a-offscreen",
    "span.a-price.apexPriceToPay span.a-offscreen",
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    "#priceblock_saleprice",
    "span#tp_price_block_total_price_ww span.a-offscreen",
    "span.a-price span.a-offscreen",
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
    const directPriceToPay = doc.querySelector(".priceToPay .a-offscreen, .apexPriceToPay .a-offscreen");
    if (directPriceToPay && directPriceToPay.textContent) {
      price = parsePriceText(directPriceToPay.textContent);
    }
  }

  if (price === null || price <= 0) {
    return null;
  }

  // 4. MRP
  const mrp = extractAmazonMrp(doc, price);

  // 5. Seller
  const seller = extractAmazonSeller(doc);

  // 6. Image
  const image = extractAmazonImage(doc);

  // 7. Variant Details
  const variant = extractAmazonVariant(doc);

  return {
    source_retailer: "Amazon.in",
    product_name: productName,
    product_title: productName,
    url: url,
    product_url: url,
    current_site_price: price,
    current_price: price,
    mrp: mrp,
    seller: seller,
    image: image,
    image_url: image,
    variant: variant,
    asin: asin,
    retailer_product_id: asin,
    manufacturer_part_number: null,
    brand: null,
    model: null,
    category: null,
    specifications: null,
    availability: "IN_STOCK",
  };
}

function extractAmazonAsin(doc, url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/(?:dp|product|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    if (m) return m[1].toUpperCase();
  } catch (e) {}

  const asinInputs = [
    doc.querySelector('input#ASIN[name="ASIN"]'),
    doc.querySelector('input#ASIN'),
    doc.querySelector('input[name="ASIN"]'),
    doc.querySelector('input[name="asin"]'),
  ].filter(Boolean);

  for (const input of asinInputs) {
    const val = input.getAttribute("value");
    if (val && /^[A-Z0-9]{10}$/i.test(val.trim())) {
      return val.trim().toUpperCase();
    }
  }

  const container = doc.querySelector("#detailBullets_feature_div, #prodDetails");
  if (container) {
    const text = container.textContent || "";
    const m = text.match(/ASIN\s*[:\u200e\s]+([A-Z0-9]{10})/i);
    if (m) return m[1].toUpperCase();
  }

  return null;
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

  return {
    source_retailer: "Flipkart",
    product_name: productName,
    product_title: productName,
    url: canonicalUrl,
    product_url: canonicalUrl,
    current_site_price: price,
    current_price: price,
    mrp: mrp,
    seller: seller,
    image: image,
    image_url: image,
    variant: variant,
    retailer_product_id: retailerProductId,
    manufacturer_part_number: null, // Retailer-specific identifier must never be treated as MPN
    brand: brand,
    model: null,
    category: null,
    specifications: specifications,
    availability: availability,
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

function extractProduct(customDoc, customUrl) {
  const href = customUrl || (typeof window !== "undefined" ? window.location.href : "");
  let hostname = "";
  try {
    hostname = new URL(href).hostname;
  } catch (e) {
    if (typeof window !== "undefined") hostname = window.location.hostname || "";
  }

  if (hostname.includes("amazon.in")) {
    return extractAmazonProduct(customDoc, customUrl);
  }
  if (hostname.includes("flipkart.com")) {
    return extractFlipkartProduct(customDoc, customUrl);
  }
  return null;
}

// Listen for extraction requests from popup
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === "extractProduct") {
      try {
        const product = extractProduct();
        if (product) {
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
          } else if (hostname.includes("amazon.in") && !href.includes("/dp/") && !href.includes("/gp/product")) {
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
    _getLastSentIdentity: () => lastSentIdentity,
    _setLastSentIdentity: (v) => { lastSentIdentity = v; },
  };
}
