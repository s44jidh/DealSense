// DealSense Background Service Worker (Manifest V3)
// Provides background review collection, persistent job orchestration,
// and cross-origin network fetching with extension host_permissions.
// Runs independently of the extension popup lifecycle.

const STORAGE_PREFIX = "dealsense_job_";
const API_BASE = "http://127.0.0.1:8000";

// In-memory active jobs registry (active while service worker is awake)
const activeJobs = new Map();
// In-flight abort controllers for cancelling active collections
const activeControllers = new Map();

/**
 * Persists job state to memory and chrome.storage.local
 */
async function saveJobState(job) {
  if (!job || !job.productKey) return;
  job.updatedAt = Date.now();
  activeJobs.set(job.productKey, job);

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      await chrome.storage.local.set({
        [STORAGE_PREFIX + job.productKey]: job,
        "dealsense_last_active_key": job.productKey,
      });
    } catch (e) {
      console.warn("[DealSense Background] Storage save error:", e);
    }
  }
}

/**
 * Retrieves job state from memory or chrome.storage.local
 */
async function getJobState(productKey) {
  if (!productKey) return null;
  if (activeJobs.has(productKey)) {
    return activeJobs.get(productKey);
  }

  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    try {
      const data = await chrome.storage.local.get([STORAGE_PREFIX + productKey]);
      const stored = data[STORAGE_PREFIX + productKey];
      if (stored) {
        activeJobs.set(productKey, stored);
        return stored;
      }
    } catch (e) {
      console.warn("[DealSense Background] Storage get error:", e);
    }
  }
  return null;
}

/**
 * Broadcasts job status update to any listening extension views (e.g. popup)
 */
function broadcastJobUpdate(action, job) {
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    try {
      chrome.runtime.sendMessage({ action, job }, () => {
        // Suppress lastError if popup is closed / no active receivers
        if (chrome.runtime?.lastError) {}
      });
    } catch (e) {}
  }
}

/**
 * Robust HTML review parser that operates without DOMParser in ServiceWorker contexts.
 */
function parseAmazonReviewsFromHtml(html) {
  const reviews = [];
  if (!html || typeof html !== "string") {
    return { reviews, hasNextPage: false };
  }

  // Check next page availability
  const hasNextPage = !html.includes("a-last a-disabled") &&
    (/<li[^>]*class="[^"]*a-last[^"]*"[^>]*>[\s\S]*?<a\s+href=/i.test(html) ||
     /class="[^"]*a-last[^"]*"[\s\S]*?<a/i.test(html));

  // Find all review cards (starts with data-hook="review" or customer_review- id)
  const cardRegex = /<div\s+[^>]*(?:data-hook="review"|id="customer_review-[^"]+")[^>]*>([\s\S]*?)(?=(?:<div\s+[^>]*(?:data-hook="review"|id="customer_review-[^"]+")[^>]*>|<div\s+id="cm_cr-pagination_bar"|<\/body|$))/gi;
  let match;
  let idx = 0;

  while ((match = cardRegex.exec(html)) !== null) {
    idx++;
    const cardHtml = match[0];

    // 1. Review text
    const bodyMatch = cardHtml.match(/data-hook="review-body"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i) ||
                      cardHtml.match(/class="[^"]*review-text[^"]*"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i) ||
                      cardHtml.match(/data-hook="review-body"[^>]*>([\s\S]*?)<\/span>/i);
    let text = bodyMatch
      ? bodyMatch[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/\s+/g, " ")
          .trim()
      : "";
    text = text.replace(/Read more\s*$/i, "").trim();
    if (!text || text.length < 3) continue;

    // 2. Stable Review ID
    let reviewId = null;
    const idMatch = cardHtml.match(/id=["']customer_review-([^"']+)["']/i) ||
                    cardHtml.match(/data-review-id=["']([^"']+)["']/i);
    if (idMatch) {
      reviewId = idMatch[1].trim();
    } else {
      const linkMatch = cardHtml.match(/href=["'][^"']*\/customer-reviews\/([A-Z0-9]+)/i);
      if (linkMatch) reviewId = linkMatch[1];
    }
    if (!reviewId) reviewId = "amz_bg_" + idx;

    // 3. Star rating
    let rating = null;
    const starMatch = cardHtml.match(/(\d(?:\.\d)?)\s*out of 5 stars/i) || cardHtml.match(/a-star-(\d)/i);
    if (starMatch) {
      rating = Math.round(parseFloat(starMatch[1]));
    }

    // 4. Review title
    let title = null;
    const titleMatch = cardHtml.match(/data-hook="review-title"[^>]*>([\s\S]*?)<\/a>/i) ||
                       cardHtml.match(/class="[^"]*review-title[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span)>/i);
    if (titleMatch) {
      let rawTitle = titleMatch[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/\d(?:\.\d)?\s*out of 5 stars/i, "")
        .replace(/\s+/g, " ")
        .trim();
      if (rawTitle.length > 0) title = rawTitle;
    }

    // 5. Author
    let author = "Amazon Customer";
    const authorMatch = cardHtml.match(/class="[^"]*a-profile-name[^"]*"[^>]*>([^<]+)<\/span>/i);
    if (authorMatch && authorMatch[1].trim()) {
      author = authorMatch[1].trim();
    }

    // 6. Review Date
    let date = null;
    const dateMatch = cardHtml.match(/data-hook="review-date"[^>]*>([^<]+)<\/span>/i);
    if (dateMatch && dateMatch[1].trim()) {
      const rawDate = dateMatch[1].trim();
      date = rawDate.includes(" on ") ? rawDate.split(" on ").pop().trim() : rawDate;
    }

    // 7. Verified Purchase
    const verifiedPurchase = /data-hook="avp-badge"|verified\s*purchase/i.test(cardHtml);

    reviews.push({
      id: reviewId,
      text,
      rating,
      title,
      author,
      date,
      verified_purchase: verifiedPurchase,
    });
  }

  return { reviews, hasNextPage };
}

/**
 * Robust HTML review parser for Flipkart that operates without DOMParser in ServiceWorker contexts.
 * Supports modern Flipkart (window.__INITIAL_STATE__, ProductReviewValue, JSON-LD Schema.org reviews)
 * and legacy class names (_16PBlm, ZmyHeo, t-ZTKy, etc.).
 */
function parseFlipkartReviewsFromHtml(html) {
  const reviews = [];
  if (!html || typeof html !== "string") {
    return { reviews, hasNextPage: false, totalReviewsReported: null };
  }

  let hasNextPage = false;
  let totalReviewsReported = null;
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
  } catch (e) {
    // If JSON parsing fails, continue to next strategies
  }

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
  // Strategy 4: Fallback regex for ProductReviewValue in case script JSON was slightly malformed
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

  return { reviews, hasNextPage, totalReviewsReported };
}

/**
 * Merges multiple review analysis batch responses from the backend into a cohesive analysis result.
 * Preserves all Model A (sentiment), Model B (authenticity), Aspect analysis, and LLM summary data.
 */
function mergeBatchAnalysisResults(batchResults, allCollected, productName, sourceRetailer, url) {
  if (!batchResults || batchResults.length === 0) return null;
  if (batchResults.length === 1) {
    const single = batchResults[0];
    single.total_reviews_extracted = allCollected.length;
    single.total_reviews_analyzed = allCollected.length;
    return single;
  }

  let totalAnalyzed = 0;
  const sentimentCounts = { positive: 0, neutral: 0, negative: 0 };
  const ratingDist = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  let ratingsSum = 0;
  let ratingsCount = 0;

  let totalCgCount = 0;
  let totalOrCount = 0;
  let cgProbSum = 0;

  let totalSuspiciousCount = 0;
  let totalCleanCount = 0;
  const flagsBreakdown = {};
  const flaggedReviews = [];
  const patternsIdentified = new Set();

  const aspectMap = new Map();
  const allPros = new Set();
  const allCons = new Set();
  let deliveryMentions = 0;
  let deliveryPosSum = 0;

  const analyzedReviews = [];

  for (const b of batchResults) {
    totalAnalyzed += b.total_reviews_analyzed || 0;

    // Sentiment distribution
    if (b.sentiment_distribution) {
      sentimentCounts.positive += b.sentiment_distribution.positive || 0;
      sentimentCounts.neutral += b.sentiment_distribution.neutral || 0;
      sentimentCounts.negative += b.sentiment_distribution.negative || 0;
    }

    // Rating distribution
    if (b.rating_distribution) {
      for (const [star, cnt] of Object.entries(b.rating_distribution)) {
        if (ratingDist[star] !== undefined) {
          ratingDist[star] += cnt || 0;
          ratingsSum += parseInt(star, 10) * (cnt || 0);
          ratingsCount += cnt || 0;
        }
      }
    }

    // Fake review analysis (Model B)
    if (b.fake_review_analysis) {
      totalCgCount += b.fake_review_analysis.cg_count || 0;
      totalOrCount += b.fake_review_analysis.or_count || 0;
      const bAnalyzed = b.fake_review_analysis.total_analyzed || 0;
      cgProbSum += (b.fake_review_analysis.mean_cg_probability || 0) * bAnalyzed;
    }

    // Suspicious analysis
    if (b.suspicious_analysis) {
      totalSuspiciousCount += b.suspicious_analysis.suspicious_count || 0;
      totalCleanCount += b.suspicious_analysis.clean_reviews_count || 0;
      if (b.suspicious_analysis.flags_breakdown) {
        for (const [flag, cnt] of Object.entries(b.suspicious_analysis.flags_breakdown)) {
          flagsBreakdown[flag] = (flagsBreakdown[flag] || 0) + cnt;
        }
      }
      if (Array.isArray(b.suspicious_analysis.flagged_reviews)) {
        flaggedReviews.push(...b.suspicious_analysis.flagged_reviews);
      }
      if (Array.isArray(b.suspicious_analysis.patterns_identified)) {
        for (const p of b.suspicious_analysis.patterns_identified) patternsIdentified.add(p);
      }
    }

    // Aspects
    if (b.aspect_analysis && Array.isArray(b.aspect_analysis.aspects)) {
      for (const a of b.aspect_analysis.aspects) {
        const key = (a.aspect_id || a.display_name || "").toLowerCase().trim();
        if (!key) continue;
        if (!aspectMap.has(key)) {
          aspectMap.set(key, {
            aspect_id: a.aspect_id,
            display_name: a.display_name,
            category: a.category,
            mention_count: 0,
            positive_mentions: 0,
            negative_mentions: 0,
            positive_excerpts: [],
            negative_excerpts: [],
          });
        }
        const existing = aspectMap.get(key);
        existing.mention_count += a.mention_count || 0;
        existing.positive_mentions += a.positive_mentions || 0;
        existing.negative_mentions += a.negative_mentions || 0;
        if (Array.isArray(a.positive_excerpts)) {
          existing.positive_excerpts.push(...a.positive_excerpts.slice(0, 2));
        }
        if (Array.isArray(a.negative_excerpts)) {
          existing.negative_excerpts.push(...a.negative_excerpts.slice(0, 2));
        }
      }
      if (Array.isArray(b.aspect_analysis.pros)) {
        for (const p of b.aspect_analysis.pros) allPros.add(p);
      }
      if (Array.isArray(b.aspect_analysis.cons)) {
        for (const c of b.aspect_analysis.cons) allCons.add(c);
      }
      if (b.aspect_analysis.delivery_summary) {
        const d = b.aspect_analysis.delivery_summary;
        deliveryMentions += d.mentions || 0;
        deliveryPosSum += (d.positive_percentage || 0) * (d.mentions || 0);
      }
    }

    if (Array.isArray(b.analyzed_reviews)) {
      analyzedReviews.push(...b.analyzed_reviews);
    }
  }

  // Final sentiment percentages
  const n = totalAnalyzed || 1;
  const sentimentPercentages = {
    positive: Math.round((sentimentCounts.positive / n) * 1000) / 10,
    neutral: Math.round((sentimentCounts.neutral / n) * 1000) / 10,
    negative: Math.round((sentimentCounts.negative / n) * 1000) / 10,
  };

  let overallSentimentLabel = "MODERATELY POSITIVE";
  const posPct = sentimentPercentages.positive;
  const negPct = sentimentPercentages.negative;
  if (posPct >= 70) {
    overallSentimentLabel = posPct >= 85 ? "OVERWHELMINGLY POSITIVE" : "MOSTLY POSITIVE";
  } else if (negPct >= 45) {
    overallSentimentLabel = "MOSTLY NEGATIVE";
  } else if (Math.abs(posPct - negPct) < 20) {
    overallSentimentLabel = "MIXED OPINIONS";
  }

  const avgRating = ratingsCount > 0 ? Math.round((ratingsSum / ratingsCount) * 10) / 10 : null;

  // Final aspects list
  const mergedAspects = [];
  for (const asp of aspectMap.values()) {
    const totalM = asp.mention_count || 1;
    const posP = Math.round((asp.positive_mentions / totalM) * 100);
    const negP = Math.round((asp.negative_mentions / totalM) * 100);
    mergedAspects.push({
      ...asp,
      positive_percentage: posP,
      negative_percentage: negP,
      sentiment_label: posP >= 65 ? "Positive" : negP >= 35 ? "Negative" : "Mixed",
      positive_excerpts: asp.positive_excerpts.slice(0, 3),
      negative_excerpts: asp.negative_excerpts.slice(0, 3),
    });
  }
  mergedAspects.sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0));

  // Final fake review summary
  const totalClassified = totalCgCount + totalOrCount || 1;
  const fakeSummary = {
    status: "success",
    total_analyzed: totalAnalyzed,
    cg_count: totalCgCount,
    or_count: totalOrCount,
    cg_percentage: Math.round((totalCgCount / totalClassified) * 1000) / 10,
    or_percentage: Math.round((totalOrCount / totalClassified) * 1000) / 10,
    mean_cg_probability: totalAnalyzed > 0 ? Math.round((cgProbSum / totalAnalyzed) * 1000) / 1000 : 0.0,
    disclaimer: "Classification performed with Model B across collected review batches.",
  };

  // Final suspicious analysis
  const suspicionRate = totalAnalyzed > 0 ? Math.round((totalSuspiciousCount / totalAnalyzed) * 1000) / 10 : 0.0;
  const suspiciousSummary = {
    status: "success",
    total_analyzed: totalAnalyzed,
    suspicious_count: totalSuspiciousCount,
    clean_reviews_count: totalCleanCount,
    suspicion_rate: suspicionRate,
    flags_breakdown: flagsBreakdown,
    flagged_reviews: flaggedReviews.slice(0, 50),
    patterns_identified: Array.from(patternsIdentified),
    disclaimer: "Heuristic pattern analysis aggregated across all review batches.",
  };

  // Trust score: 100 - (cg_percentage * 0.6 + suspicion_rate * 0.4)
  const penalty = fakeSummary.cg_percentage * 0.6 + suspicionRate * 0.4;
  const trustScore = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  // Use primary batch llm_summary and update counts
  const baseLlm = (batchResults[0] && batchResults[0].llm_summary) || {};
  const llmSummary = {
    ...baseLlm,
    total_reviews_analyzed: totalAnalyzed,
    target_count: totalAnalyzed,
  };

  return {
    status: "success",
    product_name: productName,
    source_retailer: sourceRetailer,
    url,
    total_reviews_extracted: allCollected.length,
    total_reviews_analyzed: totalAnalyzed,
    sentiment_distribution: sentimentCounts,
    sentiment_percentages: sentimentPercentages,
    overall_sentiment_label: overallSentimentLabel,
    average_rating: avgRating,
    rating_distribution: ratingDist,
    aspect_analysis: {
      status: "success",
      aspects: mergedAspects,
      pros: Array.from(allPros),
      cons: Array.from(allCons),
      delivery_summary: {
        mentions: deliveryMentions,
        positive_percentage: deliveryMentions > 0 ? Math.round(deliveryPosSum / deliveryMentions) : 0,
        sample_quote: null,
      },
    },
    suspicious_analysis: suspiciousSummary,
    fake_review_analysis: fakeSummary,
    llm_summary: llmSummary,
    trust_score: trustScore,
    pros: Array.from(allPros),
    cons: Array.from(allCons),
    analyzed_reviews: analyzedReviews,
    target_reviews_count: totalAnalyzed,
  };
}

/**
 * Runs full review collection and batch analysis in the background
 */
async function runBackgroundAnalysis(job) {
  const abortController = new AbortController();
  activeControllers.set(job.productKey, abortController);

  try {
    const asin = job.asin || job.product?.asin || job.product?.retailer_product_id;
    const isAmazon = (job.product?.source_retailer === "Amazon.in") ||
                     (job.product?.url && job.product.url.includes("amazon.in"));
    const isFlipkart = (job.product?.source_retailer === "Flipkart") ||
                       (job.product?.url && job.product.url.includes("flipkart.com"));

    const collected = [];
    const seenIds = new Set();
    const seenTexts = new Set();

    function addReview(r) {
      if (!r || !r.text || r.text.trim().length < 3) return false;
      const stableId = (
        r.id && r.id.length > 3
          ? r.id
          : `${(r.author || "").toLowerCase()}::${r.text.slice(0, 80).toLowerCase()}::${r.rating ?? ""}`
      ).trim();
      const normText = r.text.slice(0, 80).toLowerCase().replace(/\s+/g, " ").trim();

      if (seenIds.has(stableId) || seenTexts.has(normText)) return false;
      seenIds.add(stableId);
      seenTexts.add(normText);
      collected.push({
        ...r,
        id: r.id || `${isFlipkart ? "fk" : "amz"}_bg_${collected.length + 1}`,
      });
      return true;
    }

    // Pre-seed any initial reviews already extracted
    if (Array.isArray(job.initialReviews)) {
      for (const r of job.initialReviews) {
        addReview(r);
      }
    }

    job.status = "collecting";
    job.totalCollected = collected.length;
    job.pagesScanned = 1;
    job.step = "Collecting customer reviews across pages in background...";
    await saveJobState(job);
    broadcastJobUpdate("analysisProgress", job);

    // If product has an Amazon ASIN, paginate background review pages
    if (isAmazon && asin && !abortController.signal.aborted) {
      const baseReviewsUrl = `https://www.amazon.in/product-reviews/${encodeURIComponent(asin)}`;
      let currentPage = 1;
      const maxPages = 50;

      while (currentPage <= maxPages && !abortController.signal.aborted) {
        const pageUrl = `${baseReviewsUrl}?reviewerType=all_reviews&pageNumber=${currentPage}&sortBy=recent`;

        try {
          const resp = await fetch(pageUrl, {
            signal: abortController.signal,
            credentials: "include",
            headers: {
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
          });

          if (!resp.ok) {
            if (resp.status === 403 || resp.status === 503) {
              job.limitationNote = `Review collection safely stopped: Amazon returned HTTP ${resp.status} (rate limit or bot control).`;
            }
            break;
          }

          const html = await resp.text();
          if (
            html.includes("captchacharacters") ||
            html.includes("Enter the characters you see below") ||
            html.includes("Robot Check")
          ) {
            job.limitationNote = "Review collection safely stopped: Amazon anti-bot CAPTCHA challenge encountered.";
            break;
          }

          if (html.length < 500) break;

          const parsed = parseAmazonReviewsFromHtml(html);
          if (parsed.reviews.length === 0) break;

          let addedThisPage = 0;
          for (const r of parsed.reviews) {
            if (addReview(r)) {
              addedThisPage++;
            }
          }

          job.pagesScanned = currentPage;
          job.totalCollected = collected.length;
          job.reviews = collected;
          job.step = `Collected ${collected.length} customer reviews (page ${currentPage})...`;
          await saveJobState(job);
          broadcastJobUpdate("analysisProgress", job);

          if (!parsed.hasNextPage || addedThisPage === 0) break;
          currentPage++;

          // Polite asynchronous delay
          await new Promise((res) => setTimeout(res, 250 + Math.random() * 100));
        } catch (fetchErr) {
          if (abortController.signal.aborted) break;
          console.warn("[DealSense Background] Page fetch error:", fetchErr);
          break;
        }
      }

      // Sweep 2: Critical review sweep if negative reviews are underrepresented
      if (!abortController.signal.aborted && collected.length >= 10) {
        const criticalCount = collected.filter((r) => (r.rating ?? 5) <= 3).length;
        if (criticalCount < 3) {
          for (let critPage = 1; critPage <= 2 && !abortController.signal.aborted; critPage++) {
            try {
              const critUrl = `${baseReviewsUrl}?reviewerType=all_reviews&pageNumber=${critPage}&filterByStar=critical`;
              const resp = await fetch(critUrl, {
                signal: abortController.signal,
                credentials: "include",
                headers: {
                  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
              });
              if (!resp.ok) break;
              const html = await resp.text();
              if (html.includes("captchacharacters") || html.includes("Robot Check")) break;
              const parsed = parseAmazonReviewsFromHtml(html);
              if (parsed.reviews.length === 0) break;
              for (const r of parsed.reviews) {
                addReview(r);
              }
              job.totalCollected = collected.length;
              job.reviews = collected;
              await saveJobState(job);
              broadcastJobUpdate("analysisProgress", job);
              if (!parsed.hasNextPage) break;
              await new Promise((res) => setTimeout(res, 250));
            } catch {
              break;
            }
          }
        }
      }
    }

    // If product is on Flipkart, paginate background review pages
    if (isFlipkart && !abortController.signal.aborted) {
      let baseReviewsUrl = null;
      const prodUrl = job.product?.url;
      const pid = job.product?.retailer_product_id;

      if (prodUrl) {
        try {
          const u = new URL(prodUrl);
          if (u.pathname.includes("/product-reviews/")) {
            baseReviewsUrl = u.origin + u.pathname;
          } else if (u.pathname.includes("/p/")) {
            baseReviewsUrl = u.origin + u.pathname.replace("/p/", "/product-reviews/");
          }
          if (baseReviewsUrl) {
            const bu = new URL(baseReviewsUrl);
            if (pid) bu.searchParams.set("pid", pid);
            for (const [k, v] of u.searchParams.entries()) {
              if (k !== "page" && !bu.searchParams.has(k)) {
                bu.searchParams.set(k, v);
              }
            }
            baseReviewsUrl = bu.href;
          }
        } catch (e) {}
      }

      if (!baseReviewsUrl && pid) {
        baseReviewsUrl = `https://www.flipkart.com/product-reviews/p?pid=${encodeURIComponent(pid)}`;
      }

      if (baseReviewsUrl) {
        let currentPage = 1;
        const maxPages = 50;
        let consecutiveDuplicatePages = 0;
        let totalReviewsReported = job.product?.reviews_total || null;

        while (currentPage <= maxPages && !abortController.signal.aborted) {
          try {
            const pageUrlObj = new URL(baseReviewsUrl);
            pageUrlObj.searchParams.set("page", String(currentPage));

            const resp = await fetch(pageUrlObj.href, {
              signal: abortController.signal,
              credentials: "include",
              headers: {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              },
            });

            if (!resp.ok) {
              if (resp.status === 403 || resp.status === 429 || resp.status === 503) {
                job.limitationNote = `Review collection safely stopped: Flipkart returned HTTP ${resp.status} (rate limit or bot control).`;
              }
              break;
            }

            const html = await resp.text();
            if (!html || html.length < 100) break;

            if (
              html.includes("captchacharacters") ||
              html.includes("Enter the characters you see below") ||
              html.includes("Robot Check") ||
              /verification\s+code/i.test(html)
            ) {
              job.limitationNote = "Review collection safely stopped: Flipkart anti-bot challenge encountered.";
              break;
            }

            const parsed = parseFlipkartReviewsFromHtml(html);
            if (parsed.totalReviewsReported && !totalReviewsReported) {
              totalReviewsReported = parsed.totalReviewsReported;
            }

            if (!parsed.reviews || parsed.reviews.length === 0) {
              // Reached end of accessible reviews
              break;
            }

            let addedThisPage = 0;
            for (const r of parsed.reviews) {
              if (addReview(r)) {
                addedThisPage++;
              }
            }

            job.pagesScanned = currentPage;
            job.totalCollected = collected.length;
            job.reviews = collected;
            job.step = totalReviewsReported
              ? `Collected ${collected.length} of ${totalReviewsReported} customer reviews (page ${currentPage})...`
              : `Collected ${collected.length} customer reviews (page ${currentPage})...`;
            await saveJobState(job);
            broadcastJobUpdate("analysisProgress", job);

            // Handle duplicate-only pages:
            if (addedThisPage === 0) {
              consecutiveDuplicatePages++;
              // If page 1 had 0 new reviews because of pre-seeding, continue to page 2!
              if (currentPage === 1 && parsed.reviews.length > 0) {
                // Pre-seeded page 1 duplicates - continue to page 2
              } else if (consecutiveDuplicatePages >= 2) {
                // Loop or repeated reviews, stop pagination
                break;
              }
            } else {
              consecutiveDuplicatePages = 0;
            }

            // Stop if all reported reviews are collected
            if (totalReviewsReported && collected.length >= totalReviewsReported) {
              break;
            }

            // If this page returned less than standard batch and reported no more next pages
            if (!parsed.hasNextPage && addedThisPage === 0) {
              break;
            }

            currentPage++;

            // Polite asynchronous delay
            await new Promise((res) => setTimeout(res, 200 + Math.random() * 80));
          } catch (fetchErr) {
            if (abortController.signal.aborted) break;
            console.warn("[DealSense Background] Flipkart fetch error:", fetchErr);
            break;
          }
        }

        // Set transparent limitation note if collection stopped before listing total
        if (!job.limitationNote && totalReviewsReported && collected.length < totalReviewsReported) {
          job.limitationNote = `Flipkart listing reports ${totalReviewsReported} reviews; collected all ${collected.length} accessible written reviews across ${currentPage} pages.`;
        }
      }
    }

    if (abortController.signal.aborted) {
      job.status = "idle";
      job.error = "Analysis cancelled.";
      await saveJobState(job);
      broadcastJobUpdate("analysisCancelled", job);
      return;
    }

    // Step 2: Ensure we have reviews to analyze
    if (collected.length === 0) {
      job.status = "error";
      job.error = job.limitationNote
        ? `Could not retrieve customer reviews. ${job.limitationNote}`
        : "Could not retrieve customer reviews for this product. Please ensure the listing has customer reviews and click Retry.";
      await saveJobState(job);
      broadcastJobUpdate("analysisError", job);
      return;
    }

    // Step 3: Run Model A, Model B, and Aspect Analysis via Backend in manageable batches
    job.status = "analyzing";
    job.totalCollected = collected.length;
    job.reviews = collected;

    const BATCH_SIZE = 50;
    const batchCount = Math.ceil(collected.length / BATCH_SIZE);
    const batchResults = [];

    for (let bIdx = 0; bIdx < batchCount; bIdx++) {
      if (abortController.signal.aborted) break;

      const batchReviews = collected.slice(bIdx * BATCH_SIZE, (bIdx + 1) * BATCH_SIZE);
      const batchPayload = {
        product_name: job.product?.product_name || "Unknown Product",
        url: job.product?.url || (isFlipkart ? "https://www.flipkart.com" : "https://www.amazon.in"),
        source_retailer: isFlipkart ? "Flipkart" : (job.product?.source_retailer || "Amazon.in"),
        reviews: batchReviews.map((r, i) => ({
          id: r.id || `${isFlipkart ? "fk" : "amz"}_${bIdx * BATCH_SIZE + i + 1}`,
          text: r.text,
          rating: r.rating ?? null,
          title: r.title ?? null,
          author: r.author || (isFlipkart ? "Flipkart Customer" : "Amazon Customer"),
          date: r.date ?? null,
          verified_purchase: r.verified_purchase ?? null,
        })),
        target_count: collected.length,
      };

      const currentDone = Math.min((bIdx + 1) * BATCH_SIZE, collected.length);
      job.step = batchCount > 1
        ? `Analyzing review batch ${bIdx + 1} of ${batchCount} (${currentDone} of ${collected.length} reviews)...`
        : `Analyzing ${collected.length} customer reviews across Model A & Model B...`;
      await saveJobState(job);
      broadcastJobUpdate("analysisProgress", job);

      const res = await fetch(`${API_BASE}/api/reviews/analyze-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batchPayload),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Server returned HTTP ${res.status}`);
      }

      const batchData = await res.json();
      batchResults.push(batchData);
    }

    if (abortController.signal.aborted) {
      job.status = "idle";
      job.error = "Analysis cancelled.";
      await saveJobState(job);
      broadcastJobUpdate("analysisCancelled", job);
      return;
    }

    const analysisData = mergeBatchAnalysisResults(
      batchResults,
      collected,
      job.product?.product_name || "Unknown Product",
      isFlipkart ? "Flipkart" : (job.product?.source_retailer || "Amazon.in"),
      job.product?.url || (isFlipkart ? "https://www.flipkart.com" : "https://www.amazon.in")
    );

    if (job.limitationNote && analysisData) {
      analysisData.data_limitations = job.limitationNote;
    }

    // Step 4: Mark completed and persist
    job.status = "completed";
    job.step = `Analysis complete: ${collected.length} reviews evaluated.`;
    job.analysisResult = analysisData;
    job.error = null;
    await saveJobState(job);
    broadcastJobUpdate("analysisCompleted", job);
  } catch (err) {
    if (abortController.signal.aborted) {
      job.status = "idle";
      job.error = null;
    } else {
      job.status = "error";
      job.error = err.message && err.message.includes("Failed to fetch")
        ? "Cannot connect to DealSense FastAPI backend at http://127.0.0.1:8000. Please ensure the local backend server is running."
        : err.message || "Review analysis failed.";
    }
    await saveJobState(job);
    broadcastJobUpdate("analysisError", job);
  } finally {
    activeControllers.delete(job.productKey);
  }
}

// ---------------------------------------------------------------------------
// Message listener for popup & content scripts
// ---------------------------------------------------------------------------
function handleRuntimeMessage(request, sender, sendResponse) {
  if (!request || !request.action) return false;

  // 1. Start background analysis
  if (request.action === "startReviewAnalysis") {
    const product = request.product;
    const initialReviews = request.initialReviews || [];
    const productKey = `${product?.source_retailer || "Store"}::${product?.retailer_product_id || product?.asin || product?.url || "prod"}::${product?.variant || ""}`;

    // If an existing job is currently collecting or analyzing, return it
    const existing = activeJobs.get(productKey);
    if (existing && (existing.status === "collecting" || existing.status === "analyzing")) {
      sendResponse({ success: true, job: existing, inProgress: true });
      return true;
    }

    const newJob = {
      productKey,
      asin: product?.asin || product?.retailer_product_id || null,
      product,
      initialReviews,
      status: "collecting",
      step: "Initializing background review collection...",
      stepIndex: 0,
      totalCollected: initialReviews.length,
      pagesScanned: 1,
      reviews: initialReviews,
      analysisResult: null,
      error: null,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };

    saveJobState(newJob);
    runBackgroundAnalysis(newJob);
    sendResponse({ success: true, job: newJob });
    return true;
  }

  // 2. Query job status (for popup reopening)
  if (request.action === "getAnalysisJob") {
    const productKey = request.productKey;
    getJobState(productKey).then((job) => {
      sendResponse({ success: true, job: job || null });
    });
    return true; // async
  }

  // 3. Cancel active analysis
  if (request.action === "cancelAnalysis") {
    const productKey = request.productKey;
    const controller = activeControllers.get(productKey);
    if (controller) {
      controller.abort();
    }
    const job = activeJobs.get(productKey);
    if (job) {
      job.status = "idle";
      job.error = "Cancelled";
      saveJobState(job);
    }
    sendResponse({ success: true });
    return true;
  }

  // 4. Fetch raw Amazon review page (backwards compatibility)
  if (request.action === "fetchAmazonReviewPage") {
    const url = request.url;
    fetch(url, {
      credentials: "include",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    })
      .then(async (resp) => {
        const text = await resp.text();
        sendResponse({
          ok: resp.ok,
          status: resp.status,
          html: text,
        });
      })
      .catch((err) => {
        sendResponse({
          ok: false,
          status: 0,
          error: String(err),
        });
      });
    return true;
  }

  return false;
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(handleRuntimeMessage);
}

// Export helper for unit testing
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseAmazonReviewsFromHtml,
    parseFlipkartReviewsFromHtml,
    mergeBatchAnalysisResults,
    saveJobState,
    getJobState,
    runBackgroundAnalysis,
    handleRuntimeMessage,
    activeJobs,
  };
}

if (typeof globalThis !== "undefined") {
  globalThis.parseAmazonReviewsFromHtml = parseAmazonReviewsFromHtml;
  globalThis.parseFlipkartReviewsFromHtml = parseFlipkartReviewsFromHtml;
  globalThis.mergeBatchAnalysisResults = mergeBatchAnalysisResults;
  globalThis.saveJobState = saveJobState;
  globalThis.getJobState = getJobState;
  globalThis.runBackgroundAnalysis = runBackgroundAnalysis;
  globalThis.handleRuntimeMessage = handleRuntimeMessage;
  globalThis.activeJobs = activeJobs;
}
