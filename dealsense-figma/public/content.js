/**
 * DealSense — Content Script
 * Extracts main product details from Amazon India (amazon.in) product pages.
 * Enforces strict canonical main product scoping, ASIN verification, and
 * prevents sponsored banners or unrelated elements from contaminating extraction.
 */

function extractAmazonProduct() {
  const hostname = window.location.hostname;
  if (!hostname.includes("amazon.in")) {
    return null;
  }

  // 1. Main Product Title strictly from #productTitle
  const titleEl = document.querySelector("#productTitle");
  if (!titleEl) {
    return null;
  }
  const rawTitle = titleEl.textContent || "";
  const productName = rawTitle.trim().replace(/\s+/g, " ");
  if (!productName || productName.length === 0) {
    return null;
  }

  // 2. Product ASIN and Canonical URL
  const asin = extractAmazonAsin(document, window.location.href);
  if (!asin) {
    // If no ASIN can be verified from URL or page product container, this is not a verified product page
    return null;
  }
  const url = `https://www.amazon.in/dp/${asin}`;

  // 3. Selling Price - Scoped strictly to main product core price containers
  let price = null;
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
      const el = container.querySelector(selector);
      if (el && el.textContent) {
        const parsed = parsePriceText(el.textContent);
        if (parsed !== null) {
          price = parsed;
          break;
        }
      }
    }
    if (price !== null) break;
  }

  // Fallback: whole + fraction elements within main price containers
  if (price === null) {
    for (const container of mainPriceContainers) {
      const wholeEl =
        container.querySelector(".priceToPay .a-price-whole") ||
        container.querySelector(".a-price-whole");
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

  // 4. MRP (Maximum Retail Price / List Price)
  const mrp = extractAmazonMrp(document, price);

  // 5. Seller Name - scoped strictly to buybox and merchant info
  let seller = null;
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

  // 6. Product Image - scoped strictly to main image block
  const image = extractAmazonImage(document);

  // 7. Product Variant
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
}

function extractAmazonAsin(doc, currentUrl) {
  // 1. Try URL pathname
  try {
    const parsed = new URL(currentUrl || window.location.href);
    const m = parsed.pathname.match(/\/(?:dp|gp\/product|product|ASIN)\/([A-Z0-9]{10})(?:[/?]|$)/i);
    if (m && m[1]) {
      return m[1].toUpperCase();
    }
  } catch (e) {}

  // 2. Try main product container or inputs
  const asinEl =
    doc.querySelector("#ASIN, input[name=\"ASIN\"], #dp[data-asin]") ||
    doc.querySelector("#cerberus-data-metrics[data-asin]");
  if (asinEl) {
    const val = (asinEl.getAttribute("value") || asinEl.getAttribute("data-asin") || "").trim();
    if (/^[A-Z0-9]{10}$/i.test(val)) {
      return val.toUpperCase();
    }
  }

  return null;
}

function extractAmazonVariant(doc) {
  const parts = [];
  const twisterDimensionIds = [
    "color_name",
    "size_name",
    "style_name",
    "configuration",
    "pattern_name",
    "item_package_quantity",
  ];

  // Strategy 1: Modern inline-twister expanded dimension values
  for (const dim of twisterDimensionIds) {
    const el = doc.querySelector(`#inline-twister-expanded-dimension-text-${dim}`);
    if (el && el.textContent) {
      const val = el.textContent.trim();
      if (val && !parts.includes(val)) {
        parts.push(val);
      }
    }
  }

  // Strategy 2: Classic variation labels with .selection or dropdown prompt
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

  // Strategy 3: Dropdown selection options if any
  for (const dim of twisterDimensionIds) {
    const selectEl = doc.querySelector(`select[name="dropdown_selected_${dim}"]`);
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

  // Strategy 4: Active swatch text
  if (parts.length === 0) {
    const swatches = doc.querySelectorAll(".swatches .swatchSelect, ul.a-unordered-list li.swatchSelect");
    for (const el of swatches) {
      const textEl = el.querySelector(".a-button-text, .swatch-title-text-color_name");
      const val = textEl && textEl.textContent ? textEl.textContent.trim() : null;
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

function extractAmazonImage(doc) {
  // Scoped strictly to the main product image container
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
      const imgEl = container.querySelector(selector);
      if (imgEl) {
        // 1. High-resolution image via data-old-hires
        const hires = imgEl.getAttribute("data-old-hires");
        if (hires && isValidImageUrl(hires)) {
          return hires.trim();
        }

        // 2. High-resolution image via data-a-dynamic-image
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
              if (isValidImageUrl(urls[0])) {
                return urls[0].trim();
              }
            }
          } catch {
            // ignore JSON parse error
          }
        }

        // 3. Fallback to src attribute
        const src = imgEl.getAttribute("src");
        if (src && isValidImageUrl(src)) {
          return src.trim();
        }
      }
    }
  }

  // Fallback to top-level #landingImage if containers were non-standard
  const directLanding = doc.querySelector("#landingImage, #imgBlkFront");
  if (directLanding) {
    const hires = directLanding.getAttribute("data-old-hires");
    if (hires && isValidImageUrl(hires)) return hires.trim();
    const src = directLanding.getAttribute("src");
    if (src && isValidImageUrl(src)) return src.trim();
  }

  return null;
}

function isValidImageUrl(url) {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return false;
  if (trimmed.includes("transparent-pixel") || trimmed.includes("grey-pixel")) return false;
  return true;
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

  // Strategy 1: Check .basisPrice containers (modern Amazon desktop MRP)
  for (const container of candidateContainers) {
    const basisEls = container.querySelectorAll(".basisPrice, [data-csa-c-element-id*=\"basisPrice\"]");
    for (const basisEl of basisEls) {
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

  // Strategy 2: Strike-through price elements labelled with M.R.P. or List Price
  for (const container of candidateContainers) {
    const strikeEls = container.querySelectorAll(
      "span.a-text-price[data-a-strike=\"true\"], span.a-price.a-text-price, span.a-text-strike"
    );
    for (const strikeEl of strikeEls) {
      const parent = strikeEl.closest("tr, div, span.a-size-small, li");
      const context = (parent ? parent.textContent : strikeEl.parentElement?.textContent) || "";
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

  // Strategy 3: Price table rows labelled with M.R.P.
  for (const container of candidateContainers) {
    const rows = container.querySelectorAll("tr");
    for (const row of rows) {
      const firstCol = row.querySelector("td, th");
      const firstText = firstCol ? firstCol.textContent || "" : "";
      if (/m\.?r\.?p|list\s*price/i.test(firstText)) {
        const valCol = row.querySelector("td:last-child") || row;
        const priceEl = valCol.querySelector(".a-offscreen") || valCol.querySelector(".a-text-strike") || valCol;
        const val = parsePriceText(priceEl.textContent);
        if (val !== null && (!sellingPrice || val >= sellingPrice)) {
          return val;
        }
      }
    }
  }

  // Strategy 4: Legacy priceblock_listprice
  const legacyEl = doc.querySelector("#priceblock_listprice, span#priceblock_listprice, #listPrice");
  if (legacyEl && legacyEl.textContent) {
    const val = parsePriceText(legacyEl.textContent);
    if (val !== null && (!sellingPrice || val >= sellingPrice)) {
      return val;
    }
  }

  // Strategy 5: Core price container strike price fallback
  const primaryDisplay = doc.querySelector("#corePriceDisplay_desktop_feature_div");
  if (primaryDisplay) {
    const strikeSpan = primaryDisplay.querySelector("span.a-text-price[data-a-strike=\"true\"] .a-offscreen");
    if (strikeSpan && strikeSpan.textContent) {
      const val = parsePriceText(strikeSpan.textContent);
      if (val !== null && (!sellingPrice || val >= sellingPrice)) {
        return val;
      }
    }
  }

  return null;
}

function parsePriceText(text) {
  if (!text) return null;
  const cleaned = text.replace(/,/g, "").replace(/[^\d.]/g, " ").trim();
  const match = cleaned.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const num = parseFloat(match[0]);
  return isNaN(num) || num <= 0 ? null : num;
}

// Listen for extraction requests from popup
if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === "extractProduct") {
      try {
        const product = extractAmazonProduct();
        sendResponse({ success: true, data: product });
      } catch (err) {
        sendResponse({ success: false, error: String(err) });
      }
    }
    return true;
  });
}

// Targeted DOM observation and SPA navigation listener for automatic variant detection
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
      const prod = extractAmazonProduct();
      if (!prod) {
        // If we previously had a product but now extraction is invalid/uncertain (e.g. navigated to search),
        // immediately notify popup to clear old product state
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
      const ident = `${prod.asin || window.location.pathname}::${prod.product_name}::${prod.current_site_price}::${prod.variant || ""}`;
      if (ident !== lastSentIdentity) {
        lastSentIdentity = ident;
        if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: "productUpdated", data: prod }, () => {
            if (chrome.runtime?.lastError) {
              // Popup may not be open, harmless
            }
          });
        }
      }
    } catch (e) {
      // ignore
    }
  }, 400);
}

// Observe variant and main product containers if present
if (typeof MutationObserver !== "undefined") {
  const targetContainers = [
    document.querySelector("#dp"),
    document.querySelector("#centerCol"),
    document.querySelector("#twister"),
    document.querySelector("#twisterContainer"),
    document.querySelector("#corePriceDisplay_desktop_feature_div"),
    document.querySelector("#corePrice_desktop"),
    document.querySelector("#title_feature_div"),
  ].filter(Boolean);

  if (targetContainers.length > 0) {
    const observer = new MutationObserver(() => {
      checkAndNotifyProductUpdate();
    });
    for (const c of targetContainers) {
      observer.observe(c, { childList: true, subtree: true, characterData: true });
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", checkAndNotifyProductUpdate);
  window.addEventListener("hashchange", checkAndNotifyProductUpdate);
}

// Hook pushState and replaceState to immediately capture Amazon client-side SPA navigation
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
    parsePriceText,
    checkAndNotifyProductUpdate,
    _getLastSentIdentity: () => lastSentIdentity,
    _setLastSentIdentity: (v) => { lastSentIdentity = v; },
  };
}
