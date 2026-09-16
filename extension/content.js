/**
 * DealSense — content.js
 * Stage 1: Placeholder only. No scraping implemented yet.
 *
 * This script is injected into supported shopping pages.
 * In Stage 2+, it will extract product data (title, price,
 * rating, reviews, seller info) and pass it to the extension
 * via chrome.runtime messaging, ONLY when the user clicks
 * "Analyze Product". It will NOT run continuous monitoring.
 */

"use strict";

// Stage 1: Log presence and stand by.
console.log("[DealSense] content.js loaded on:", window.location.hostname);

/**
 * Future: listen for messages from popup.js via chrome.runtime.
 * The popup will send { action: "scrapeProduct" } and this script
 * will respond with extracted product data.
 *
 * chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
 *   if (msg.action === "scrapeProduct") {
 *     const data = scrapeCurrentPage();
 *     sendResponse({ success: true, data });
 *   }
 * });
 */
