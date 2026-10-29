declare const chrome: any;

export interface ExtractedReview {
  id?: string;
  text: string;
  rating?: number | null;
  title?: string | null;
  author?: string;
  date?: string | null;
  verified_purchase?: boolean;
}

export interface ExtractedProduct {
  source_retailer: "Amazon.in" | "Flipkart";
  product_name: string;
  product_title?: string;
  url: string;
  product_url?: string;
  current_site_price: number;
  current_price?: number;
  currency?: string;
  mrp: number | null;
  seller: string | null;
  image?: string | null;
  image_url?: string | null;
  variant?: string | null;
  asin?: string | null;
  retailer_product_id?: string | null;
  manufacturer_part_number?: string | null;
  brand?: string | null;
  model?: string | null;
  category?: string | null;
  rating?: number | null;
  ratings_total?: number | null;
  reviews_total?: number | null;
  specifications?: Record<string, any> | null;
  availability?: string | null;
  reviews?: ExtractedReview[];
  scan_metadata?: {
    pages_scanned: number;
    total_reviews_found: number;
    has_more: boolean;
    limitation_note?: string | null;
    target_count?: number;
    rating_distribution?: Record<string, number>;
  };
  analysis_source?: "live_dom" | "demo" | "manual";
}

/**
 * Extracts product details from the active browser tab if it is an
 * Amazon India (amazon.in) or Flipkart (flipkart.com) product page.
 *
 * Returns ExtractedProduct on success, or null if the page is unsupported,
 * extraction fails, or running outside the Chrome extension environment.
 */
export async function extractActiveTabProduct(): Promise<ExtractedProduct | null> {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) {
    return null;
  }

  try {
    const tabs = await new Promise<any[]>((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (result: any[]) => {
        resolve(result || []);
      });
    });

    const activeTab = tabs[0];
    if (!activeTab || !activeTab.id || !activeTab.url) {
      return null;
    }

    // Verify the URL is on amazon.in or flipkart.com
    let isAmazon = false;
    let isFlipkart = false;
    try {
      const parsedUrl = new URL(activeTab.url);
      isAmazon = parsedUrl.hostname.includes("amazon.in");
      isFlipkart = parsedUrl.hostname.includes("flipkart.com");
      if (!isAmazon && !isFlipkart) {
        return null;
      }
    } catch {
      return null;
    }

    // Method 1: Ask the injected content script via message passing
    const messageResult = await new Promise<ExtractedProduct | null>((resolve) => {
      chrome.tabs.sendMessage(
        activeTab.id,
        { action: "extractProduct" },
        (response: any) => {
          if (chrome.runtime?.lastError || !response || !response.success || !response.data) {
            resolve(null);
          } else {
            resolve(response.data);
          }
        }
      );
    });

    if (messageResult && isValidExtractedProduct(messageResult)) {
      return messageResult;
    }

    // Method 2: Fallback via chrome.scripting.executeScript if content.js was not yet active
    if (chrome.scripting?.executeScript) {
      const targetFunc = isAmazon ? extractAmazonFromDOM : extractFlipkartFromDOM;
      const results = await new Promise<any[]>((resolve) => {
        chrome.scripting.executeScript(
          {
            target: { tabId: activeTab.id },
            func: targetFunc,
          },
          (res: any[]) => {
            if (chrome.runtime?.lastError || !res) {
              resolve([]);
            } else {
              resolve(res);
            }
          }
        );
      });

      const extracted = results?.[0]?.result;
      if (extracted && isValidExtractedProduct(extracted)) {
        return extracted;
      }
    }

    return null;
  } catch (err) {
    console.warn("[DealSense] extractActiveTabProduct failed:", err);
    return null;
  }
}

/**
 * Triggers multi-page review collection in the active tab (Amazon.in or Flipkart)
 * up to targetCount (e.g. 100 or 300) with rating diversity and polite delays.
 */
export async function collectTabReviews(options?: {
  targetCount?: number;
  maxCount?: number;
  diversify?: boolean;
}): Promise<{
  reviews: ExtractedReview[];
  total_collected: number;
  pages_scanned: number;
  target_count: number;
  has_more: boolean;
  rating_distribution?: Record<string, number>;
  limitation_note?: string | null;
  stopped_reason?: string;
} | null> {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) {
    return null;
  }

  try {
    const tabs = await new Promise<any[]>((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (res: any[]) => resolve(res || []));
    });
    const activeTab = tabs[0];
    if (!activeTab || !activeTab.id) return null;

    const res = await new Promise<any>((resolve) => {
      chrome.tabs.sendMessage(
        activeTab.id,
        {
          action: "collectMultiPageReviews",
          targetCount: options?.targetCount ?? 100,
          maxCount: options?.maxCount ?? 300,
          diversify: options?.diversify ?? true,
        },
        (resp: any) => {
          if (chrome.runtime?.lastError || !resp || !resp.success) {
            resolve(null);
          } else {
            resolve(resp);
          }
        }
      );
    });
    return res;
  } catch (err) {
    console.warn("[DealSense] collectTabReviews error:", err);
    return null;
  }
}

export function isValidExtractedProduct(p: any): p is ExtractedProduct {
  return (
    typeof p === "object" &&
    p !== null &&
    typeof p.product_name === "string" &&
    p.product_name.trim().length > 0 &&
    typeof p.url === "string" &&
    p.url.trim().length > 0
  );
}

function parsePrice(text: string | null): number | null {
  if (!text) return null;
  const currMatch = text.match(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)/i);
  if (currMatch && currMatch[1]) {
    const num = parseFloat(currMatch[1].replace(/,/g, ""));
    if (!isNaN(num) && num > 0) return num;
  }
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

function extractAmazonAsin(doc: Document, url?: string): string | null {
  if (url) {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\/(?:dp|product|gp\/product|product-reviews)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
      if (m) return m[1].toUpperCase();

      const qAsin = u.searchParams.get("asin") || u.searchParams.get("ASIN");
      if (qAsin && /^[A-Z0-9]{10}$/i.test(qAsin.trim())) {
        return qAsin.trim().toUpperCase();
      }
    } catch (e) { }
  }

  const prodLink = doc.querySelector("a[data-hook='product-link'], #cm_cr_product_info a");
  if (prodLink) {
    const href = prodLink.getAttribute("href");
    if (href) {
      const m = href.match(/\/(?:dp|product|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
      if (m) return m[1].toUpperCase();
    }
  }

  const asinInputs = [
    doc.querySelector('input#ASIN[name="ASIN"]'),
    doc.querySelector("input#ASIN"),
    doc.querySelector('input[name="ASIN"]'),
    doc.querySelector("input#asin"),
  ].filter(Boolean);

  for (const input of asinInputs) {
    const val = (input as HTMLInputElement).value;
    if (val && /^[A-Z0-9]{10}$/i.test(val.trim())) {
      return val.trim().toUpperCase();
    }
  }

  const dataAsin = doc.querySelector("[data-asin]")?.getAttribute("data-asin");
  if (dataAsin && /^[A-Z0-9]{10}$/i.test(dataAsin.trim())) {
    return dataAsin.trim().toUpperCase();
  }

  return null;
}

/**
 * Pure DOM extraction function executed in the Amazon tab context.
 */
export function extractAmazonFromDOM(): ExtractedProduct | null {
  const hostname = window.location.hostname;
  if (!hostname.includes("amazon.in")) {
    return null;
  }

  const doc = document;

  // 1. Title prioritizing #productTitle
  let productName = "";
  const titleEl = doc.querySelector("#productTitle");
  if (titleEl && titleEl.textContent) {
    productName = titleEl.textContent.trim().replace(/\s+/g, " ");
  }

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

  if (!productName || productName.length === 0) {
    const metaTitle = doc.querySelector("meta[name='title']");
    if (metaTitle && metaTitle.getAttribute("content")) {
      productName = metaTitle.getAttribute("content")!.trim().replace(/\s+/g, " ");
    }
  }

  if (!productName && doc.title) {
    const cleanDocTitle = doc.title
      .replace(/^Amazon\.in\s*:\s*/i, "")
      .replace(/\s*:\s*Amazon\.in.*/i, "")
      .replace(/\s*Buy.*Online at Low Prices.*/i, "")
      .trim();
    if (cleanDocTitle.length > 0) {
      productName = cleanDocTitle;
    }
  }

  if (!productName) return null;

  // 2. ASIN & Canonical URL
  const asin = extractAmazonAsin(doc, window.location.href);
  if (!asin) return null;
  const url = `https://www.amazon.in/dp/${asin}`;

  // 3. Price
  let price: number | null = null;
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
      const el = container!.querySelector(selector);
      if (el && el.textContent) {
        const parsed = parsePrice(el.textContent);
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
        const parsed = parsePrice(el.textContent);
        if (parsed !== null && parsed > 0) {
          price = parsed;
          break;
        }
      }
    }
  }

  // Schema.org JSON-LD structured data extraction
  let jsonLd: any = null;
  try {
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const s of Array.from(scripts)) {
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
        } catch { }
      }
      if (jsonLd) break;
    }
  } catch (e) { }

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

  const sellingPrice = (price !== null && price > 0) ? price : 0;
  const mrp = sellingPrice > 0 ? extractAmazonMrp(doc, sellingPrice) : null;
  const seller = extractAmazonSeller(doc);
  const brand = extractAmazonBrand(doc, productName, jsonLd);
  const model = extractAmazonModel(doc, productName, brand || undefined, jsonLd);
  const category = extractAmazonCategory(doc, productName, jsonLd);
  const specifications = extractAmazonSpecifications(doc, jsonLd);
  const { rating, ratingsTotal } = extractAmazonRating(doc, jsonLd);
  const image = extractAmazonImage(doc);
  const variant = extractAmazonVariant(doc);

  // 4. Reviews from DOM
  const reviews = extractAmazonReviewsFromDOM(doc);

  console.log("[DealSense Debug Extractor DOM]", {
    event: "amazon_product_dom_extracted",
    title: productName,
    asin: asin || "N/A",
    url,
    price: sellingPrice,
    seller: seller,
    brand: brand,
    model: model,
    category: category,
    rating: rating,
    ratingsTotal: ratingsTotal,
    reviewCount: reviews.length,
    source: "live_dom",
  });

  return {
    source_retailer: "Amazon.in",
    product_name: productName,
    product_title: productName,
    url,
    product_url: url,
    current_site_price: sellingPrice,
    current_price: sellingPrice,
    currency: "INR",
    mrp,
    seller: seller || "Unavailable",
    brand: brand || "Unavailable",
    model: model || "Unavailable",
    category: category || null,
    rating: rating,
    ratings_total: ratingsTotal,
    reviews_total: ratingsTotal,
    specifications: specifications,
    image,
    image_url: image,
    variant,
    asin,
    retailer_product_id: asin,
    manufacturer_part_number: null,
    availability: sellingPrice > 0 ? "IN_STOCK" : "UNAVAILABLE",
    reviews,
    scan_metadata: {
      pages_scanned: 1,
      total_reviews_found: reviews.length,
      has_more: Boolean(doc.querySelector && doc.querySelector("li.a-last a, #cm_cr-pagination_bar .a-last a, ul.a-pagination li.a-last a")),
      limitation_note: null,
    },
    analysis_source: "live_dom",
  };
}


function extractAmazonBrand(doc: Document, title?: string, jsonLd?: any): string | null {
  // 1. JSON-LD structured brand
  if (jsonLd?.brand) {
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
    if (raw.length > 0 && !/^(visit|store)$/i.test(raw)) return raw;
  }

  // 3. Overview table brand
  const overview = doc.querySelector("#productOverview_feature_div tr.po-brand .po-break-word, tr.po-brand td:nth-child(2) span, tr.po-brand .a-span9 span");
  if (overview && overview.textContent) return overview.textContent.trim();

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
  for (const r of Array.from(rows)) {
    const th = r.querySelector("th, td:first-child");
    const td = r.querySelector("td:last-child");
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

  return null;
}

function extractAmazonModel(doc: Document, title?: string, brand?: string, jsonLd?: any): string | null {
  // 1. JSON-LD model or mpn
  if (jsonLd?.model && typeof jsonLd.model === "string" && jsonLd.model.trim().length > 0) {
    return jsonLd.model.trim();
  }
  if (jsonLd?.mpn && typeof jsonLd.mpn === "string" && jsonLd.mpn.trim().length > 0 && !/^[A-Z0-9]{10}$/.test(jsonLd.mpn)) {
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
  for (const r of Array.from(rows)) {
    const th = r.querySelector("th, td:first-child");
    const td = r.querySelector("td:last-child");
    if (th && td && th.textContent && td.textContent && th !== td) {
      if (/model(?:\s+name|\s+number)?/i.test(th.textContent)) {
        const raw = td.textContent.trim();
        if (raw.length > 0) return raw;
      }
    }
  }

  // 4. Detail bullets
  const bullets = doc.querySelectorAll("#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li");
  for (const li of Array.from(bullets)) {
    const text = li.textContent || "";
    if (/item\s*model\s*number|model\s*name|model\s*number/i.test(text)) {
      const spans = li.querySelectorAll("span");
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

  return null;
}

function inferModelFromTitle(title?: string | null, brand?: string | null): string | null {
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

function extractAmazonRating(doc: Document, jsonLd?: any): { rating: number | null; ratingsTotal: number | null } {
  let rating: number | null = null;
  let ratingsTotal: number | null = null;

  if (jsonLd?.aggregateRating?.ratingValue) {
    const r = parseFloat(String(jsonLd.aggregateRating.ratingValue));
    if (!isNaN(r) && r > 0) rating = Math.round(r * 10) / 10;
  }
  if (jsonLd?.aggregateRating?.reviewCount || jsonLd?.aggregateRating?.ratingCount) {
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

function extractAmazonCategory(doc: Document, title?: string, jsonLd?: any): string | null {
  // 1. Breadcrumbs
  const breadcrumbEls = doc.querySelectorAll(
    "#wayfinding-breadcrumbs_container ul li a, #wayfinding-breadcrumbs_feature_div ul li a, .a-breadcrumb a"
  );
  const crumbs: string[] = [];
  for (const el of Array.from(breadcrumbEls)) {
    const text = (el.textContent || "").trim();
    if (text && !crumbs.includes(text)) {
      crumbs.push(text);
    }
  }
  if (crumbs.length > 0) {
    return crumbs.join(" > ");
  }

  // 2. JSON-LD category
  if (jsonLd?.category) {
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

function extractAmazonSpecifications(doc: Document, jsonLd?: any): Record<string, any> | null {
  const specs: Record<string, any> = {};

  // Table rows
  const rows = doc.querySelectorAll(
    "#productOverview_feature_div table tr, #productDetails_techSpec_section_1 tr, #technicalSpecifications_section_1 tr, #prodDetails table tr"
  );
  for (const r of Array.from(rows)) {
    const k = r.querySelector("th, td:first-child")?.textContent?.trim();
    const v = r.querySelector("td:last-child")?.textContent?.trim();
    if (k && v && k.length > 0 && v.length > 0 && k !== v) {
      specs[k] = v;
    }
  }

  // Detail bullets
  const bullets = doc.querySelectorAll("#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li");
  for (const li of Array.from(bullets)) {
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

function parsePriceText(text: string | null): number | null {
  return parsePrice(text);
}

function isValidHttpUrl(u: any): boolean {
  if (!u || typeof u !== "string") return false;
  const trimmed = u.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return false;
  if (trimmed.includes("transparent-pixel") || trimmed.includes("grey-pixel") || trimmed.includes("data:image")) return false;
  return true;
}

function extractAmazonSeller(doc: Document): string | null {
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

function extractAmazonVariant(doc: Document): string | null {
  const parts: string[] = [];
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

function extractAmazonImage(doc: Document): string | null {
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
        } catch { }
      }
      const src = el.getAttribute("src");
      if (src && isValidHttpUrl(src)) return src.trim();
    }
  }
  return null;
}

function extractAmazonMrp(doc: Document, sellingPrice?: number | null): number | null {
  const candidateContainers = [
    doc.querySelector("#corePriceDisplay_desktop_feature_div"),
    doc.querySelector("#corePrice_desktop"),
    doc.querySelector("#corePrice_feature_div"),
    doc.querySelector("#apex_desktop"),
    doc.querySelector("#desktop_unifiedPrice"),
    doc.querySelector("#price"),
  ].filter(Boolean) as Element[];

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

function extractAmazonReviewsFromDOM(doc: Document): ExtractedReview[] {
  const reviews: ExtractedReview[] = [];
  const rawCards = doc.querySelectorAll(
    'div[data-hook="review"], div.review, div.a-section.review, div[id^="customer_review-"], li[data-hook="review"], div[data-hook="cr-widget-desktop-review-body"]'
  );

  const reviewCards: Element[] = [];
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
      let text = bodyEl ? bodyEl.textContent!.trim().replace(/\s+/g, " ") : "";
      text = text.replace(/Read more\s*$/i, "").trim();
      if (!text || text.length < 3) continue;

      let rating: number | null = null;
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

      let title: string | null = null;
      const titleEl = card.querySelector(
        '[data-hook="review-title"], a.review-title, span.review-title'
      );
      if (titleEl && titleEl.textContent) {
        let rawTitle = titleEl.textContent.trim().replace(/\s+/g, " ");
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

      let date: string | null = null;
      const dateEl = card.querySelector('[data-hook="review-date"], span.review-date');
      if (dateEl && dateEl.textContent) {
        const rawDate = dateEl.textContent.trim();
        if (rawDate.includes(" on ")) {
          date = rawDate.split(" on ").pop()!.trim();
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
        text,
        rating,
        title,
        author,
        date,
        verified_purchase: verifiedPurchase,
      });
    } catch { }
  }
  return reviews;
}


export function extractFlipkartFromDOM(): ExtractedProduct | null {
  const hostname = window.location.hostname;
  if (!hostname.includes("flipkart.com")) {
    return null;
  }

  const doc = document;
  const href = window.location.href;
  const pathname = window.location.pathname;

  const isPdpPath = pathname.includes("/p/itm") || pathname.includes("/p/");
  const hasPidParam = href.includes("pid=") || href.includes("PID=");

  let jsonLd: any = null;
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const s of Array.from(scripts)) {
    try {
      const parsed = JSON.parse(s.textContent || "");
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && (item["@type"] === "Product" || item["@type"] === "IndividualProduct")) {
          jsonLd = item;
          break;
        }
      }
    } catch { }
    if (jsonLd) break;
  }

  if (!isPdpPath && !hasPidParam && !jsonLd) {
    return null;
  }

  let productName: string | null = null;
  const h1El = doc.querySelector("h1");
  if (h1El) {
    const raw = (h1El.textContent || "").trim().replace(/\s+/g, " ");
    if (raw && !/^(search for|flipkart|results for)/i.test(raw)) {
      productName = raw;
    }
  }

  if (!productName && jsonLd && jsonLd.name) {
    productName = String(jsonLd.name).trim().replace(/\s+/g, " ");
  }

  if (!productName) {
    const titleSelectors = ["span.B_NuCI", "h1.B_NuCI", "h1._35KyD6", "h1.VU-ZEz"];
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

  if (!productName) return null;

  let pid: string | null = null;
  let itemId: string | null = null;
  try {
    const u = new URL(href);
    pid = u.searchParams.get("pid") || u.searchParams.get("PID");
    const m = u.pathname.match(/\/p\/(itm[a-zA-Z0-9]+)/i);
    if (m) itemId = m[1];
  } catch { }
  if (!pid && jsonLd && jsonLd.sku) {
    pid = String(jsonLd.sku).trim();
  }
  const retailerProductId = pid || itemId || null;

  let canonicalUrl = "";
  const canonicalLink = doc.querySelector('link[rel="canonical"]');
  if (canonicalLink) {
    const cHref = canonicalLink.getAttribute("href");
    if (cHref && isValidUrl(cHref)) canonicalUrl = cHref.trim();
  }
  if (!canonicalUrl) {
    const cleanPath = pathname.split("?")[0];
    canonicalUrl = `https://www.flipkart.com${cleanPath}${pid ? `?pid=${pid}` : ""}`;
  }

  let price: number | null = null;
  if (jsonLd && jsonLd.offers) {
    const p = Array.isArray(jsonLd.offers) ? jsonLd.offers[0]?.price : jsonLd.offers?.price;
    const num = parseFloat(p);
    if (!isNaN(num) && num > 0) price = num;
  }

  if (!price) {
    const modernPriceEls = doc.querySelectorAll('div[class*="v1zwn21n"], div[class*="v1zwn2"]');
    for (const el of Array.from(modernPriceEls)) {
      const txt = el.textContent || "";
      if (txt.includes("₹")) {
        const parsed = parsePrice(txt);
        if (parsed !== null && parsed > 0) {
          price = parsed;
          break;
        }
      }
    }
  }

  if (!price) {
    const classicSelectors = ["div.Nx9bqj.CxhGGd", "div.Nx9bqj", "div._30jeq3._16Jk6d", "div._30jeq3"];
    for (const sel of classicSelectors) {
      const el = doc.querySelector(sel);
      if (el && el.textContent) {
        const parsed = parsePrice(el.textContent);
        if (parsed !== null && parsed > 0) {
          price = parsed;
          break;
        }
      }
    }
  }

  if (!price || price <= 0) return null;

  // MRP
  let mrp: number | null = null;
  const strikethroughEls = doc.querySelectorAll('div[style*="line-through"], div[class*="v1zwn21o"], div[class*="_1psv1ze93"], div.yRaY8j, div._3I9_wc');
  for (const el of Array.from(strikethroughEls)) {
    const parsed = parsePrice(el.textContent);
    if (parsed !== null && parsed > 0 && parsed >= price) {
      mrp = parsed;
      break;
    }
  }

  // Seller
  let seller: string | null = null;
  const modernSellerEls = doc.querySelectorAll('div[class*="v1zwn26"], div[class*="v1zwn"]');
  for (const el of Array.from(modernSellerEls)) {
    const txt = (el.textContent || "").trim();
    if (/^Seller:\s*/i.test(txt)) {
      seller = txt.replace(/^Seller:\s*/i, "").trim();
      break;
    }
  }
  if (!seller) {
    const sEl = doc.querySelector("#sellerName, div._1RLviY, div._2Yx7No");
    if (sEl && sEl.textContent) {
      seller = sEl.textContent.trim().replace(/^Seller:\s*/i, "").split(/\s+\d(?:\.\d)?\s*★/)[0].trim();
    }
  }

  // Image
  let image: string | null = null;
  if (jsonLd && jsonLd.image) {
    const img = Array.isArray(jsonLd.image) ? jsonLd.image[0] : jsonLd.image;
    if (isValidUrl(img)) image = img.trim();
  }
  if (!image) {
    const imgEl = doc.querySelector('img[src*="flixcart.com/image"], img[class*="_0DkuPH"], img[class*="DByuf4"]');
    if (imgEl) {
      const src = imgEl.getAttribute("src");
      if (src && isValidUrl(src)) image = src.trim();
    }
  }

  // Variant & Specs
  const specs: Record<string, any> = {};
  const variantParts: string[] = [];
  const parenMatches = productName.match(/\(([^)]+)\)/g);
  if (parenMatches) {
    for (const p of parenMatches) {
      const inner = p.slice(1, -1).trim();
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

  return {
    source_retailer: "Flipkart",
    product_name: productName,
    product_title: productName,
    url: canonicalUrl,
    product_url: canonicalUrl,
    current_site_price: price,
    current_price: price,
    mrp,
    seller,
    image,
    image_url: image,
    variant: variantParts.length > 0 ? variantParts.join(" · ") : null,
    retailer_product_id: retailerProductId,
    manufacturer_part_number: null,
    brand: jsonLd?.brand?.name || (productName.split(" ")[0].trim().length > 2 ? productName.split(" ")[0].trim() : null),
    model: jsonLd?.model || specs["Model Name"] || specs["Model Number"] || null,
    category: jsonLd?.category || null,
    specifications: Object.keys(specs).length > 0 ? specs : null,
    availability: /currently unavailable|out of stock/i.test(doc.textContent || "") ? "OUT_OF_STOCK" : "IN_STOCK",
  };

  function isValidUrl(u: string | null): boolean {
    if (!u || typeof u !== "string") return false;
    const trimmed = u.trim();
    return trimmed.startsWith("http://") || trimmed.startsWith("https://");
  }

  function parsePrice(text: string | null): number | null {
    if (!text) return null;
    const cleaned = text.replace(/,/g, "").replace(/[^\d.]/g, " ").trim();
    const match = cleaned.match(/\d+(?:\.\d+)?/);
    if (!match) return null;
    const num = parseFloat(match[0]);
    return isNaN(num) || num <= 0 ? null : num;
  }
}


export interface BrowserCandidateOffer {
  retailer_name: string;
  product_title: string;
  product_url: string;
  retailer_product_id: string;
  current_price: number;
  mrp?: number | null;
  currency: string;
  availability: string;
  seller_name?: string | null;
  image_url?: string | null;
  condition?: string;
  data_source?: string;
}

export interface AmazonSearchExtractionResult {
  blocked: boolean;
  blockType: string | null;
  reason?: string;
  query: string;
  candidates: BrowserCandidateOffer[];
}

export interface AmazonTabSearchResult {
  status: "found" | "not_open" | "blocked" | "no_results" | "error";
  tabId?: number;
  tabUrl?: string;
  query?: string;
  reason?: string;
  candidates: BrowserCandidateOffer[];
}

/**
 * Pure DOM extraction fallback for Amazon search results.
 */
export function extractAmazonSearchResultsFromDOM(): {
  blocked: boolean;
  blockType: string | null;
  reason?: string;
  query: string;
  candidates: BrowserCandidateOffer[];
} {
  const doc = document;
  const href = window.location.href;
  let query = "";
  try {
    const u = new URL(href);
    query = u.searchParams.get("k") || "";
  } catch { }
  if (!query) {
    const searchInput = doc.querySelector<HTMLInputElement>("#twotabsearchtextbox");
    if (searchInput && searchInput.value) {
      query = searchInput.value.trim();
    }
  }

  // Check CAPTCHA
  const captchaInput = doc.querySelector("#captchacharacters");
  const captchaForm = doc.querySelector('form[action*="/errors/validateCaptcha"]');
  const bodyText = doc.body ? doc.body.textContent || "" : doc.textContent || "";
  if (captchaInput || captchaForm || /Type the characters you see/i.test(bodyText) || /validateCaptcha/i.test(bodyText)) {
    return {
      blocked: true,
      blockType: "CAPTCHA",
      reason: "Amazon India displayed a CAPTCHA challenge in the browser tab.",
      query,
      candidates: [],
    };
  }

  // Check 503
  if (/503 - Service Unavailable Error/i.test(bodyText) || /automated access to Amazon data/i.test(bodyText)) {
    return {
      blocked: true,
      blockType: "ACCESS_DENIED_503",
      reason: "Amazon India returned an access-denied or 503 challenge page.",
      query,
      candidates: [],
    };
  }

  const resultCards = doc.querySelectorAll("div[data-asin], div.s-result-item");
  const candidates: BrowserCandidateOffer[] = [];
  const seenAsins = new Set<string>();

  for (const card of Array.from(resultCards)) {
    const asin = (card.getAttribute("data-asin") || "").trim();
    if (!asin || asin.length !== 10 || !/^[A-Z0-9]{10}$/.test(asin)) continue;
    if (seenAsins.has(asin)) continue;

    let title = "";
    const titleEl = card.querySelector("h2 a span, h2 span, h2 a, span.a-size-medium, span.a-size-base-plus");
    if (titleEl && titleEl.textContent) {
      title = titleEl.textContent.trim().replace(/\s+/g, " ");
    }
    if (!title || title.length < 3) continue;

    let price: number | null = null;
    const priceEl = card.querySelector('span.a-price:not([data-a-strike="true"]) span.a-offscreen, span.a-price span.a-offscreen, span.a-color-price');
    if (priceEl && priceEl.textContent) {
      const cleaned = priceEl.textContent.replace(/,/g, "").replace(/[^\d.]/g, " ").trim();
      const match = cleaned.match(/\d+(?:\.\d+)?/);
      if (match) {
        const num = parseFloat(match[0]);
        if (!isNaN(num) && num > 0) price = num;
      }
    }
    if (price === null || price <= 0) continue;

    let mrp: number | null = null;
    const mrpEl = card.querySelector('span.a-price[data-a-strike="true"] span.a-offscreen, span.a-text-price span.a-offscreen');
    if (mrpEl && mrpEl.textContent) {
      const cleaned = mrpEl.textContent.replace(/,/g, "").replace(/[^\d.]/g, " ").trim();
      const match = cleaned.match(/\d+(?:\.\d+)?/);
      if (match) {
        const num = parseFloat(match[0]);
        if (!isNaN(num) && num >= price) mrp = num;
      }
    }

    let imgUrl: string | null = null;
    const imgEl = card.querySelector("img.s-image");
    if (imgEl) {
      const src = imgEl.getAttribute("src");
      if (src && (src.startsWith("http://") || src.startsWith("https://"))) {
        imgUrl = src.trim();
      }
    }

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
      data_source: "Amazon Browser Tab Search",
    });
  }

  return {
    blocked: false,
    blockType: null,
    query,
    candidates,
  };
}

export async function findAmazonSearchTab(): Promise<AmazonTabSearchResult> {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) {
    return { status: "not_open", candidates: [] };
  }

  try {
    const tabs = await new Promise<any[]>((resolve) => {
      chrome.tabs.query({ url: "*://*.amazon.in/*" }, (res: any[]) => {
        resolve(res || []);
      });
    });

    if (!tabs || tabs.length === 0) {
      return { status: "not_open", candidates: [] };
    }

    // Prioritize search tabs (/s? or ?k= or /s/)
    const searchTabs = tabs.filter((t: any) => t.url && (t.url.includes("/s?") || t.url.includes("/s/") || t.url.includes("k=")));
    const targetTab = searchTabs.length > 0 ? searchTabs[0] : tabs[0];

    if (!targetTab || !targetTab.id) {
      return { status: "not_open", candidates: [] };
    }

    // 1. Try sending message to content script
    const msgResult = await new Promise<any>((resolve) => {
      chrome.tabs.sendMessage(
        targetTab.id,
        { action: "extractAmazonSearchResults" },
        (response: any) => {
          if (chrome.runtime?.lastError || !response || !response.success) {
            resolve(null);
          } else {
            resolve(response.data);
          }
        }
      );
    });

    if (msgResult) {
      if (msgResult.blocked) {
        return {
          status: "blocked",
          tabId: targetTab.id,
          tabUrl: targetTab.url,
          query: msgResult.query,
          reason: msgResult.reason || "Amazon India displayed a CAPTCHA challenge in the browser tab.",
          candidates: [],
        };
      }
      if (msgResult.candidates && msgResult.candidates.length > 0) {
        return {
          status: "found",
          tabId: targetTab.id,
          tabUrl: targetTab.url,
          query: msgResult.query,
          candidates: msgResult.candidates,
        };
      }
      return {
        status: "no_results",
        tabId: targetTab.id,
        tabUrl: targetTab.url,
        query: msgResult.query,
        candidates: [],
      };
    }

    // 2. Fallback via chrome.scripting.executeScript
    if (chrome.scripting?.executeScript) {
      const execResults = await new Promise<any[]>((resolve) => {
        chrome.scripting.executeScript(
          {
            target: { tabId: targetTab.id },
            func: extractAmazonSearchResultsFromDOM,
          },
          (res: any[]) => {
            if (chrome.runtime?.lastError || !res) {
              resolve([]);
            } else {
              resolve(res);
            }
          }
        );
      });

      if (execResults && execResults[0]?.result) {
        const domResult = execResults[0].result;
        if (domResult.blocked) {
          return {
            status: "blocked",
            tabId: targetTab.id,
            tabUrl: targetTab.url,
            query: domResult.query,
            reason: domResult.reason || "Amazon India displayed a CAPTCHA challenge in the browser tab.",
            candidates: [],
          };
        }
        if (domResult.candidates && domResult.candidates.length > 0) {
          return {
            status: "found",
            tabId: targetTab.id,
            tabUrl: targetTab.url,
            query: domResult.query,
            candidates: domResult.candidates,
          };
        }
        return {
          status: "no_results",
          tabId: targetTab.id,
          tabUrl: targetTab.url,
          query: domResult.query,
          candidates: [],
        };
      }
    }

    return { status: "no_results", tabId: targetTab.id, tabUrl: targetTab.url, candidates: [] };
  } catch (err) {
    return { status: "error", reason: String(err), candidates: [] };
  }
}

export async function openAmazonSearchTab(query: string): Promise<number | null> {
  if (typeof chrome === "undefined" || !chrome.tabs?.create) {
    return null;
  }
  const url = "https://www.amazon.in/s?k=" + encodeURIComponent(query);
  return new Promise((resolve) => {
    chrome.tabs.create({ url, active: false }, (newTab: any) => {
      resolve(newTab?.id || null);
    });
  });
}

/**
 * Automatically retrieves Amazon candidate listings using a background tab
 * without switching the active shopping tab or stealing focus.
 * Creates an inactive tab (active: false), waits for DOM rendering,
 * extracts candidates via DOM extraction, and closes the tab.
 */
export async function retrieveAmazonCandidatesInBackground(
  query: string,
  timeoutMs: number = 8000
): Promise<AmazonTabSearchResult> {
  if (typeof chrome === "undefined" || !chrome.tabs?.create) {
    return { status: "not_open", candidates: [] };
  }

  // First, check if an existing search tab is already present
  const existing = await findAmazonSearchTab();
  if (existing.status === "found" && existing.candidates.length > 0) {
    return existing;
  }
  if (existing.status === "blocked") {
    return existing;
  }

  const url = "https://www.amazon.in/s?k=" + encodeURIComponent(query);
  let createdTabId: number | null = null;

  try {
    const tab = await new Promise<any>((resolve) => {
      // Critical safeguard: active: false ensures active shopping tab stays focused
      chrome.tabs.create({ url, active: false }, (newTab: any) => {
        resolve(newTab || null);
      });
    });

    if (!tab || !tab.id) {
      return { status: "not_open", candidates: [] };
    }
    createdTabId = tab.id;

    // Wait for the background tab to complete loading
    const loadResult = await new Promise<boolean>((resolve) => {
      let timer: any = null;
      const listener = (tabId: number, changeInfo: any) => {
        if (tabId === createdTabId && changeInfo.status === "complete") {
          chrome.tabs.onUpdated?.removeListener(listener);
          clearTimeout(timer);
          resolve(true);
        }
      };
      chrome.tabs.onUpdated?.addListener(listener);
      timer = setTimeout(() => {
        chrome.tabs.onUpdated?.removeListener(listener);
        resolve(false);
      }, timeoutMs);
    });

    if (!loadResult) {
      return { status: "no_results", reason: "Background tab load timed out", candidates: [] };
    }

    // Small delay for DOM idle
    await new Promise((r) => setTimeout(r, 400));

    // Extract using content script or scripting API
    let extractResult: AmazonSearchExtractionResult | null = null;
    const msgResult = await new Promise<any>((resolve) => {
      chrome.tabs.sendMessage(
        createdTabId!,
        { action: "extractAmazonSearchResults" },
        (res: any) => {
          if (chrome.runtime?.lastError || !res || !res.success) {
            resolve(null);
          } else {
            resolve(res.data);
          }
        }
      );
    });

    if (msgResult) {
      extractResult = msgResult;
    } else if (chrome.scripting?.executeScript) {
      const execResults = await new Promise<any[]>((resolve) => {
        chrome.scripting.executeScript(
          {
            target: { tabId: createdTabId! },
            func: extractAmazonSearchResultsFromDOM,
          },
          (res: any[]) => {
            if (chrome.runtime?.lastError || !res) resolve([]);
            else resolve(res);
          }
        );
      });
      if (execResults && execResults[0]?.result) {
        extractResult = execResults[0].result;
      }
    }

    if (extractResult) {
      if (extractResult.blocked) {
        return {
          status: "blocked",
          tabId: createdTabId ?? undefined,
          tabUrl: url,
          query: extractResult.query,
          reason: extractResult.reason || "Amazon India displayed a CAPTCHA challenge in the background tab.",
          candidates: [],
        };
      }
      return {
        status: extractResult.candidates.length > 0 ? "found" : "no_results",
        tabId: createdTabId ?? undefined,
        tabUrl: url,
        query: extractResult.query,
        candidates: extractResult.candidates,
      };
    }

    return { status: "no_results", tabId: createdTabId ?? undefined, tabUrl: url, candidates: [] };
  } catch (err) {
    return { status: "error", reason: String(err), candidates: [] };
  } finally {
    // Clean up: close the background tab so user tab bar is never cluttered
    if (createdTabId && typeof chrome !== "undefined" && chrome.tabs?.remove) {
      try {
        chrome.tabs.remove(createdTabId, () => {
          if (chrome.runtime?.lastError) {
            // tab may have already been closed
          }
        });
      } catch { }
    }
  }
}
