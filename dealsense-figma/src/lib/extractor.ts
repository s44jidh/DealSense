declare const chrome: any;

export interface ExtractedProduct {
  source_retailer: "Amazon.in" | "Flipkart";
  product_name: string;
  product_title?: string;
  url: string;
  product_url?: string;
  current_site_price: number;
  current_price?: number;
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
  specifications?: Record<string, any> | null;
  availability?: string | null;
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

export function isValidExtractedProduct(p: any): p is ExtractedProduct {
  return (
    typeof p === "object" &&
    p !== null &&
    typeof p.product_name === "string" &&
    p.product_name.trim().length > 0 &&
    typeof p.current_site_price === "number" &&
    p.current_site_price > 0 &&
    typeof p.url === "string" &&
    p.url.trim().length > 0
  );
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

  const titleEl = doc.querySelector("#productTitle");
  if (!titleEl) return null;
  const productName = (titleEl.textContent || "").trim().replace(/\s+/g, " ");
  if (!productName) return null;

  const asin = extractAmazonAsin(doc, window.location.href);
  if (!asin) return null;
  const url = `https://www.amazon.in/dp/${asin}`;

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
    const directPriceToPay = doc.querySelector(".priceToPay .a-offscreen, .apexPriceToPay .a-offscreen");
    if (directPriceToPay && directPriceToPay.textContent) {
      price = parsePrice(directPriceToPay.textContent);
    }
  }

  if (price === null || price <= 0) return null;

  const mrp = extractAmazonMrp(doc, price);
  const seller = extractAmazonSeller(doc);
  const image = extractAmazonImage(doc);
  const variant = extractAmazonVariant(doc);

  return {
    source_retailer: "Amazon.in",
    product_name: productName,
    product_title: productName,
    url,
    product_url: url,
    current_site_price: price,
    current_price: price,
    mrp,
    seller,
    image,
    image_url: image,
    variant,
    asin,
    retailer_product_id: asin,
    manufacturer_part_number: null,
    brand: null,
    model: null,
    category: null,
    specifications: null,
    availability: "IN_STOCK",
  };

  function extractAmazonAsin(doc: Document, uStr: string): string | null {
    try {
      const u = new URL(uStr);
      const m = u.pathname.match(/\/(?:dp|product|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
      if (m) return m[1].toUpperCase();
    } catch {}

    const asinInputs = [
      doc.querySelector('input#ASIN[name="ASIN"]'),
      doc.querySelector("input#ASIN"),
      doc.querySelector('input[name="ASIN"]'),
      doc.querySelector('input[name="asin"]'),
    ].filter(Boolean);

    for (const input of asinInputs) {
      const val = (input as HTMLInputElement).value || input!.getAttribute("value");
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

    for (const selector of candidateSelectors) {
      const imgEl = doc.querySelector(selector);
      if (imgEl) {
        const hires = imgEl.getAttribute("data-old-hires");
        if (hires && isValidUrl(hires)) return hires.trim();

        const dynamic = imgEl.getAttribute("data-a-dynamic-image");
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
              if (isValidUrl(urls[0])) return urls[0].trim();
            }
          } catch {}
        }

        const src = imgEl.getAttribute("src");
        if (src && isValidUrl(src)) return src.trim();
      }
    }
    return null;
  }

  function isValidUrl(u: string | null): boolean {
    if (!u || typeof u !== "string") return false;
    const trimmed = u.trim();
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return false;
    if (trimmed.includes("transparent-pixel") || trimmed.includes("grey-pixel")) return false;
    return true;
  }

  function extractAmazonMrp(doc: Document, sellingPrice: number | null): number | null {
    const candidateContainers = [
      doc.querySelector("#corePriceDisplay_desktop_feature_div"),
      doc.querySelector("#corePrice_desktop"),
      doc.querySelector("#corePrice_feature_div"),
      doc.querySelector("#apex_desktop"),
      doc.querySelector("#desktop_unifiedPrice"),
      doc.querySelector("#price"),
    ].filter(Boolean);

    for (const container of candidateContainers) {
      const basisEls = container!.querySelectorAll(".basisPrice, [data-csa-c-element-id*=\"basisPrice\"]");
      for (const basisEl of Array.from(basisEls)) {
        const text = basisEl.textContent || "";
        if (!/save|coupon|emi|cashback/i.test(text)) {
          const offscreen = basisEl.querySelector(".a-offscreen") || basisEl.querySelector(".a-text-price");
          const val = parsePrice(offscreen ? offscreen.textContent : text);
          if (val !== null && (!sellingPrice || val >= sellingPrice)) {
            return val;
          }
        }
      }
    }

    for (const container of candidateContainers) {
      const strikeEls = container!.querySelectorAll(
        "span.a-text-price[data-a-strike=\"true\"], span.a-price.a-text-price, span.a-text-strike"
      );
      for (const strikeEl of Array.from(strikeEls)) {
        const parent = strikeEl.closest("tr, div, span.a-size-small, li");
        const context = (parent ? parent.textContent : strikeEl.parentElement?.textContent) || "";
        const isMrp = /m\.?r\.?p|list\s*price|maximum\s*retail/i.test(context);
        const isExcluded = /save|savings|coupon|emi|cashback|discount/i.test(context);

        if (isMrp && !isExcluded) {
          const offscreen = strikeEl.querySelector(".a-offscreen") || strikeEl;
          const val = parsePrice(offscreen.textContent);
          if (val !== null && (!sellingPrice || val >= sellingPrice)) {
            return val;
          }
        }
      }
    }

    return null;
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

/**
 * Pure DOM extraction function executed in the Flipkart tab context.
 */
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
    } catch {}
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
  } catch {}
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
    brand: jsonLd?.brand?.name || null,
    model: null,
    category: null,
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
