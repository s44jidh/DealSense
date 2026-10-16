declare const chrome: any;

export interface ExtractedProduct {
  url: string;
  asin?: string | null;
  product_name: string;
  current_site_price: number;
  mrp: number | null;
  seller: string | null;
  image?: string | null;
  variant?: string | null;
}

/**
 * Extracts product details from the active browser tab if it is an
 * Amazon India (amazon.in) product page.
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

    // Verify the URL is on amazon.in
    try {
      const parsedUrl = new URL(activeTab.url);
      if (!parsedUrl.hostname.includes("amazon.in")) {
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
          if (chrome.runtime.lastError || !response || !response.success || !response.data) {
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
      const results = await new Promise<any[]>((resolve) => {
        chrome.scripting.executeScript(
          {
            target: { tabId: activeTab.id },
            func: extractAmazonFromDOM,
          },
          (res: any[]) => {
            if (chrome.runtime.lastError || !res) {
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
 * Pure DOM extraction function executed in the tab context.
 * Uses strict scoping to #productTitle, core price containers, and ASIN verification.
 */
export function extractAmazonFromDOM(): ExtractedProduct | null {
  const hostname = window.location.hostname;
  if (!hostname.includes("amazon.in")) {
    return null;
  }

  // 1. Title strictly from #productTitle
  const titleEl = document.querySelector("#productTitle");
  if (!titleEl) {
    return null;
  }
  const rawTitle = titleEl.textContent || "";
  const productName = rawTitle.trim().replace(/\s+/g, " ");
  if (!productName || productName.length === 0) {
    return null;
  }

  // 2. ASIN and Canonical URL
  let asin: string | null = null;
  try {
    const urlMatch = window.location.pathname.match(/\/(?:dp|gp\/product|product|ASIN)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    if (urlMatch && urlMatch[1]) {
      asin = urlMatch[1].toUpperCase();
    }
  } catch (e) {}

  if (!asin) {
    const asinInput = document.querySelector("#ASIN, input[name=\"ASIN\"], #dp[data-asin]");
    if (asinInput) {
      const val = (asinInput.getAttribute("value") || asinInput.getAttribute("data-asin") || "").trim();
      if (/^[A-Z0-9]{10}$/i.test(val)) {
        asin = val.toUpperCase();
      }
    }
  }

  if (!asin) {
    const cerberus = document.querySelector("#cerberus-data-metrics[data-asin]");
    if (cerberus) {
      const val = (cerberus.getAttribute("data-asin") || "").trim();
      if (/^[A-Z0-9]{10}$/i.test(val)) {
        asin = val.toUpperCase();
      }
    }
  }

  if (!asin) {
    return null;
  }

  const url = `https://www.amazon.in/dp/${asin}`;

  // 3. Selling Price - Scoped strictly to main product core price containers
  let price: number | null = null;
  const mainPriceContainers = [
    document.querySelector("#corePriceDisplay_desktop_feature_div"),
    document.querySelector("#corePrice_desktop"),
    document.querySelector("#corePrice_feature_div"),
    document.querySelector("#apex_desktop"),
    document.querySelector("#desktop_unifiedPrice"),
    document.querySelector("#price"),
    document.querySelector("#centerCol .priceToPay"),
    document.querySelector("#centerCol .apexPriceToPay"),
    document.querySelector("#ppd .priceToPay"),
    document.querySelector("#desktop_buybox .priceToPay"),
  ].filter(Boolean);

  const priceSelectors = [
    ".apexPriceToPay .a-offscreen",
    ".priceToPay .a-offscreen",
    ".a-price.aok-align-center .a-offscreen",
    ".a-price .a-offscreen",
    "#priceblock_ourprice",
    "#priceblock_dealprice",
    "#priceblock_saleprice",
    "#tp_price_block_total_price_ww .a-offscreen",
  ];

  for (const container of mainPriceContainers) {
    for (const selector of priceSelectors) {
      const el = container!.querySelector(selector);
      if (el && el.textContent) {
        const parsed = parsePrice(el.textContent);
        if (parsed !== null) {
          price = parsed;
          break;
        }
      }
    }
    if (price !== null) break;
  }

  if (price === null) {
    for (const container of mainPriceContainers) {
      const wholeEl =
        container!.querySelector(".priceToPay .a-price-whole") ||
        container!.querySelector(".a-price-whole");
      if (wholeEl && wholeEl.textContent) {
        const whole = wholeEl.textContent.replace(/,/g, "").replace(/[^\d]/g, "");
        const fractionEl = wholeEl.parentElement
          ? wholeEl.parentElement.querySelector(".a-price-fraction")
          : null;
        const fraction = fractionEl && fractionEl.textContent ? fractionEl.textContent.trim() : "00";
        const combined = parseFloat(`${whole}.${fraction}`);
        if (!isNaN(combined) && combined > 0) {
          price = combined;
          break;
        }
      }
    }
  }

  if (price === null) {
    return null;
  }

  // 4. MRP
  const mrp = extractAmazonMrp(document, price);

  // 5. Seller
  let seller: string | null = null;
  const sellerLink = document.querySelector(
    "#desktop_buybox #sellerProfileTriggerId, #rightCol #sellerProfileTriggerId, #sellerProfileTriggerId"
  );
  if (sellerLink && sellerLink.textContent) {
    seller = sellerLink.textContent.trim();
  }

  if (!seller) {
    const tabularSeller = document.querySelector(
      "#tabular-buybox [tabular-attribute-name=\"Sold by\"] a, #tabular-buybox [tabular-attribute-name=\"Sold by\"] span"
    );
    if (tabularSeller && tabularSeller.textContent) {
      seller = tabularSeller.textContent.trim();
    }
  }

  if (!seller) {
    const merchantEl = document.querySelector(
      "#rightCol #merchant-info, #desktop_buybox #merchant-info, #merchant-info"
    );
    if (merchantEl && merchantEl.textContent) {
      const text = merchantEl.textContent.trim();
      const match = text.match(
        /(?:sold by|dispatched from and sold by)\s+([^.\r\n]+?)(?:\s+and\s+(?:fulfilled|delivered|shipped)|$|\.)/i
      );
      if (match && match[1]) {
        seller = match[1].trim();
      } else {
        const link = merchantEl.querySelector("a");
        if (link && link.textContent) {
          seller = link.textContent.trim();
        }
      }
    }
  }

  // 6. Image
  const image = extractAmazonImage(document);

  // 7. Variant
  const variant = extractAmazonVariant(document);

  return {
    url,
    asin,
    product_name: productName,
    current_site_price: price,
    mrp: mrp || null,
    seller: seller || null,
    image: image || null,
    variant: variant || null,
  };

  function extractAmazonVariant(doc: Document): string | null {
    const parts: string[] = [];
    const twisterDimensionIds = [
      "color_name",
      "size_name",
      "style_name",
      "configuration",
      "pattern_name",
      "item_package_quantity",
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

    for (const dim of twisterDimensionIds) {
      const selectEl = doc.querySelector(`select[name="dropdown_selected_${dim}"]`) as HTMLSelectElement | null;
      if (selectEl && selectEl.selectedIndex >= 0) {
        const opt = selectEl.options[selectEl.selectedIndex];
        if (opt && opt.text) {
          const val = opt.text.trim();
          if (val && !/^(select|choose|\-)/i.test(val) && !parts.includes(val)) {
            parts.push(val);
          }
        }
      }
    }

    if (parts.length === 0) {
      const swatches = doc.querySelectorAll(".swatches .swatchSelect, ul.a-unordered-list li.swatchSelect");
      for (const el of Array.from(swatches)) {
        const textEl = el.querySelector(".a-button-text, .swatch-title-text-color_name");
        const val = textEl?.textContent?.trim();
        if (val && !parts.includes(val)) {
          parts.push(val);
        }
      }
    }

    if (parts.length > 0) {
      return parts.join(" · ");
    }

    return null;
  }

  function extractAmazonImage(doc: Document): string | null {
    const mainImageContainers = [
      doc.querySelector("#main-image-container"),
      doc.querySelector("#imgTagWrapperId"),
      doc.querySelector("#imageBlock"),
      doc.querySelector("#leftCol"),
      doc.querySelector("#ppd"),
    ].filter(Boolean);

    const candidateSelectors = [
      "#landingImage",
      "#imgBlkFront",
      "#ebooks-img-blk-front",
      "#main-image",
    ];

    for (const container of mainImageContainers) {
      for (const selector of candidateSelectors) {
        const imgEl = container!.querySelector(selector);
        if (imgEl) {
          const hires = imgEl.getAttribute("data-old-hires");
          if (hires && isValidUrl(hires)) {
            return hires.trim();
          }

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
                if (isValidUrl(urls[0])) {
                  return urls[0].trim();
                }
              }
            } catch {}
          }

          const src = imgEl.getAttribute("src");
          if (src && isValidUrl(src)) {
            return src.trim();
          }
        }
      }
    }

    const directLanding = doc.querySelector("#landingImage, #imgBlkFront");
    if (directLanding) {
      const hires = directLanding.getAttribute("data-old-hires");
      if (hires && isValidUrl(hires)) return hires.trim();
      const src = directLanding.getAttribute("src");
      if (src && isValidUrl(src)) return src.trim();
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

    for (const container of candidateContainers) {
      const rows = container!.querySelectorAll("tr");
      for (const row of Array.from(rows)) {
        const firstCol = row.querySelector("td, th");
        const firstText = firstCol ? firstCol.textContent || "" : "";
        if (/m\.?r\.?p|list\s*price/i.test(firstText)) {
          const valCol = row.querySelector("td:last-child") || row;
          const priceEl = valCol.querySelector(".a-offscreen") || valCol.querySelector(".a-text-strike") || valCol;
          const val = parsePrice(priceEl.textContent);
          if (val !== null && (!sellingPrice || val >= sellingPrice)) {
            return val;
          }
        }
      }
    }

    const legacyEl = doc.querySelector("#priceblock_listprice, span#priceblock_listprice, #listPrice");
    if (legacyEl && legacyEl.textContent) {
      const val = parsePrice(legacyEl.textContent);
      if (val !== null && (!sellingPrice || val >= sellingPrice)) {
        return val;
      }
    }

    const primaryDisplay = doc.querySelector("#corePriceDisplay_desktop_feature_div");
    if (primaryDisplay) {
      const strikeSpan = primaryDisplay.querySelector("span.a-text-price[data-a-strike=\"true\"] .a-offscreen");
      if (strikeSpan && strikeSpan.textContent) {
        const val = parsePrice(strikeSpan.textContent);
        if (val !== null && (!sellingPrice || val >= sellingPrice)) {
          return val;
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
