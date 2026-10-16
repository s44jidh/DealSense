"""
DealSense API — main.py
FastAPI backend service providing deterministic listing-price analysis (Phase 2)
and genuine cross-store price comparison (Phase 3 & Phase 3.2).
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    ComparableOffer,
    ComparePricesRequest,
    ComparePricesResponse,
    HealthResponse,
    MarketComparison,
    PriceAnalysis,
    ReviewsAnalysis,
    SellerAnalysis,
    SourceProductSummary,
)
from app.retrieval import OfferRetrievalService

app = FastAPI(
    title="DealSense API",
    version="3.2.0",
    description=(
        "Deterministic e-commerce price intelligence backend. "
        "Provides genuine listing analysis and verifiable cross-store price comparison "
        "between Amazon India and Flipkart."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

retrieval_service = OfferRetrievalService()


# ---------------------------------------------------------------------------
# Health Check Endpoint
# ---------------------------------------------------------------------------


@app.get("/api/health", response_model=HealthResponse, tags=["health"])
def health_check() -> HealthResponse:
    """Returns the operational status of the DealSense API."""
    return HealthResponse(status="ok", service="dealsense-backend")


# ---------------------------------------------------------------------------
# Phase 2 — Listing Price Analysis Endpoint
# ---------------------------------------------------------------------------


@app.post(
    "/api/analyze",
    response_model=AnalyzeResponse,
    summary="Analyze Amazon listing price against MRP",
    tags=["analysis"],
)
def analyze(payload: AnalyzeRequest) -> AnalyzeResponse:
    """
    Performs deterministic price analysis on an extracted Amazon product listing.
    """
    selling_price = round(payload.current_site_price, 2)
    mrp = round(payload.mrp, 2) if payload.mrp is not None else None

    if mrp is None:
        price_analysis = PriceAnalysis(
            status="MRP_UNAVAILABLE",
            selling_price=selling_price,
            mrp=None,
            discount_amount=None,
            discount_percent=None,
            verdict_label="MRP NOT VERIFIED",
            summary=(
                f"Listed at ₹{selling_price:,.2f}. No verified Maximum Retail Price (MRP) "
                f"was detected on the page; discount cannot be calculated."
            ),
        )
    elif selling_price < mrp:
        discount_amount = round(mrp - selling_price, 2)
        discount_percent = round((discount_amount / mrp) * 100, 1)

        summary_text = (
            f"Listed at ₹{selling_price:,.2f}, which is ₹{discount_amount:,.2f} below MRP "
            f"(₹{mrp:,.2f}) — a verified {discount_percent}% discount."
        )

        price_analysis = PriceAnalysis(
            status="DISCOUNT_VERIFIED",
            selling_price=selling_price,
            mrp=mrp,
            discount_amount=discount_amount,
            discount_percent=discount_percent,
            verdict_label=f"{discount_percent:.0f}% BELOW MRP",
            summary=summary_text,
        )
    elif selling_price == mrp:
        price_analysis = PriceAnalysis(
            status="LISTED_AT_MRP",
            selling_price=selling_price,
            mrp=mrp,
            discount_amount=0.0,
            discount_percent=0.0,
            verdict_label="LISTED AT MRP",
            summary=f"Selling at full MRP (₹{mrp:,.2f}). No discount is currently offered.",
        )
    else:
        overage = round(selling_price - mrp, 2)
        price_analysis = PriceAnalysis(
            status="PRICE_EXCEEDS_MRP",
            selling_price=selling_price,
            mrp=mrp,
            discount_amount=None,
            discount_percent=None,
            verdict_label="ABOVE MRP",
            summary=(
                f"Warning: Current price (₹{selling_price:,.2f}) exceeds the listed MRP "
                f"(₹{mrp:,.2f}) by ₹{overage:,.2f}."
            ),
        )

    seller_analysis = SellerAnalysis(
        status="UNVERIFIED",
        seller=payload.seller,
        summary=(
            f"Seller '{payload.seller}' extracted from page; reputation and credibility are unverified."
            if payload.seller
            else "No explicit seller information was extracted from this listing."
        ),
    )

    reviews_analysis = ReviewsAnalysis(
        status="UNVERIFIED",
        summary="Review sentiment and authenticity analysis are not yet supported for live listings.",
    )

    market_comparison = MarketComparison(
        status="ACTIVE",
        summary="Cross-store price comparison is active. Use POST /api/compare-prices for live competitor offer analysis.",
    )

    return AnalyzeResponse(
        status="success",
        product_name=payload.product_name,
        current_site_price=selling_price,
        mrp=mrp,
        seller=payload.seller,
        url=payload.url,
        price_analysis=price_analysis,
        seller_analysis=seller_analysis,
        reviews_analysis=reviews_analysis,
        market_comparison=market_comparison,
        message="Deterministic price analysis completed successfully.",
    )


# ---------------------------------------------------------------------------
# Phase 3 & 3.2 — Genuine Cross-Store Price Comparison Endpoint
# ---------------------------------------------------------------------------


@app.post(
    "/api/compare-prices",
    response_model=ComparePricesResponse,
    summary="Compare cross-store product prices with exact variant matching",
    tags=["comparison"],
)
def compare_prices(payload: ComparePricesRequest, response: Response = None) -> ComparePricesResponse:
    if response is not None:
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    """
    Retrieves genuine comparable offers from verified Indian e-commerce retailers,
    matches configuration details, and calculates the lowest verified price.

    Amazon selling price (not MRP) is compared against competitor selling prices.
    Only exact model and variant matches (EXACT_MATCH) are included in the lowest-price calculation.
    """
    selling_price = round(payload.current_site_price, 2)
    mrp = round(payload.mrp, 2) if payload.mrp is not None else None
    now_iso = datetime.now(timezone.utc).isoformat()

    is_flipkart_source = bool(
        (getattr(payload, "source_retailer", None) and "flipkart" in payload.source_retailer.lower()) or
        (payload.url and "flipkart.com" in payload.url.lower())
    )
    source_name = "Flipkart" if is_flipkart_source else "Amazon"

    # SECTION A: Cross-Platform Retrieval (competing retailer only)
    try:
        raw_offers, queried_retailers, retailer_statuses, query_used, candidate_evaluations, retailer_diagnostics = (
            retrieval_service.retrieve_and_match(
                payload.product_name,
                source_variant=payload.variant,
                source_url=payload.url,
                source_retailer=getattr(payload, "source_retailer", None),
            )
        )
    except Exception as err:
        raw_offers = []
        queried_retailers = ["Amazon.in" if is_flipkart_source else "Flipkart"]
        retailer_statuses = {"all": f"Retrieval error: {str(err)}"}
        retailer_diagnostics = []
        query_used = payload.product_name
        candidate_evaluations = []

    # SECTION B: Same-Platform Seller Discovery (current retailer only)
    try:
        same_platform_offers_raw, same_platform_status, same_platform_diags, lowest_same_platform_price, same_platform_summary = (
            retrieval_service.retrieve_same_platform_sellers(
                source_title=payload.product_name,
                source_retailer=getattr(payload, "source_retailer", None),
                source_url=payload.url,
                source_price=selling_price,
                source_seller=payload.seller,
                source_variant=payload.variant,
                source_product_id=getattr(payload, "retailer_product_id", None),
            )
        )
    except Exception as err:
        same_platform_offers_raw = []
        same_platform_status = "error"
        same_platform_diags = []
        lowest_same_platform_price = None
        same_platform_summary = f"Same-platform seller discovery failed: {str(err)}"

    rejection_breakdown: dict[str, int] = {}
    for o in raw_offers:
        cat = o.get("rejection_category")
        if cat and cat != "VALID_MATCH":
            rejection_breakdown[cat] = rejection_breakdown.get(cat, 0) + 1

    diagnostics = {
        "query_used": query_used,
        "total_candidates_retrieved": len(raw_offers),
        "rejection_breakdown": rejection_breakdown,
        "candidate_evaluations": candidate_evaluations,
    }

    validated_offers: list[ComparableOffer] = []
    seen_offer_urls: set[str] = set()

    for o in raw_offers:
        # Ignore failed prices from the offer list
        if o.get("current_price", -1.0) <= 0:
            continue

        url = o.get("product_url", "")
        if url in seen_offer_urls:
            continue
        seen_offer_urls.add(url)

        try:
            validated_offers.append(ComparableOffer(**o))
        except Exception:
            # Skip candidate offers with malformed URLs or invalid fields
            continue

    # Filter strictly to verified exact matching offers that are in stock
    # UNVERIFIED_VARIANT and PROBABLE_MATCH are excluded from lowest-price calculations
    verified_offers = [
        o for o in validated_offers
        if o.match_status == "EXACT_MATCH"
        and o.availability != "OUT_OF_STOCK"
    ]
    possible_offers = [
        o for o in validated_offers
        if o.match_status in ("POSSIBLE_MATCH", "UNVERIFIED_VARIANT")
        and o.availability != "OUT_OF_STOCK"
    ]

    is_flipkart_source = bool(
        (getattr(payload, "source_retailer", None) and "flipkart" in payload.source_retailer.lower()) or
        (payload.url and "flipkart.com" in payload.url.lower())
    )
    source_name = "Flipkart" if is_flipkart_source else "Amazon"

    source_product = SourceProductSummary(
        product_name=payload.product_name,
        current_site_price=selling_price,
        mrp=mrp,
        url=payload.url,
        variant=payload.variant,
        source_retailer=getattr(payload, "source_retailer", None) or ("Flipkart" if is_flipkart_source else "Amazon.in"),
        retailer_product_id=getattr(payload, "retailer_product_id", None),
        brand=getattr(payload, "brand", None),
        model=getattr(payload, "model", None),
        category=getattr(payload, "category", None),
    )

    if verified_offers:
        lowest_offer = min(verified_offers, key=lambda x: x.current_price)
        lowest_price = lowest_offer.current_price
        lowest_retailer = lowest_offer.retailer_name
        lowest_url = lowest_offer.product_url

        # Compare Amazon selling price with competitor selling price
        price_diff = round(selling_price - lowest_price, 2)

        if price_diff > 0:
            verdict_label = f"LOWER ON {lowest_retailer.upper()}"
            summary = (
                f"Identical verified listing found on {lowest_retailer} for ₹{lowest_price:,.2f}, "
                f"saving ₹{price_diff:,.2f} compared to the current {source_name} listing (₹{selling_price:,.2f})."
            )
        elif price_diff < 0:
            abs_diff = abs(price_diff)
            verdict_label = "LOWEST VERIFIED PRICE"
            summary = (
                f"Current {source_name} listing price (₹{selling_price:,.2f}) is ₹{abs_diff:,.2f} lower "
                f"than the best verified competitor offer on {lowest_retailer} (₹{lowest_price:,.2f})."
            )
        else:
            verdict_label = "MATCHING COMPETITOR PRICE"
            summary = (
                f"Current {source_name} listing price matches the verified offer on {lowest_retailer} "
                f"at ₹{lowest_price:,.2f}."
            )

        status = "success"
    else:
        lowest_price = None
        lowest_retailer = None
        lowest_url = None
        price_diff = None

        target_retailer_name = "Amazon.in" if is_flipkart_source else "Flipkart"
        target_diag = next(
            (d for d in retailer_diagnostics if d.retailer_name == target_retailer_name),
            retailer_diagnostics[0] if retailer_diagnostics else None
        )

        if target_diag and (target_diag.http_status != 200 or "blocked" in target_diag.status_reason.lower() or "503" in target_diag.status_reason):
            status = "no_offers_found"
            cross_platform_status_val = "retailer_unavailable"
            verdict_label = f"{target_retailer_name.upper()} UNAVAILABLE"
            summary = target_diag.status_reason
        elif target_diag and target_diag.parsed_listings_count == 0:
            status = "no_offers_found"
            cross_platform_status_val = "no_search_results"
            verdict_label = "NO RESULTS FOUND"
            summary = f"Search query '{query_used}' returned 0 listings on {target_retailer_name}."
        elif target_diag and (target_diag.model_mismatch_count > 0 or target_diag.config_mismatch_count > 0):
            status = "no_offers_found"
            cross_platform_status_val = "all_candidates_rejected"
            verdict_label = "NO EXACT MATCH"
            summary = (
                f"Queried {target_diag.parsed_listings_count} listings on {target_retailer_name}, but none matched this exact model. "
                f"Excluded {target_diag.model_mismatch_count} model mismatch(es) and {target_diag.config_mismatch_count} configuration mismatch(es)."
            )
        elif target_diag and target_diag.unverified_variant_count > 0:
            status = "no_offers_found"
            cross_platform_status_val = "insufficient_data"
            verdict_label = "UNVERIFIED CANDIDATES"
            summary = f"Found {target_diag.parsed_listings_count} candidate(s) on {target_retailer_name}, but listing specifications were insufficient to verify exact match."
        else:
            status = "no_offers_found"
            verdict_label = "NO VERIFIED OFFERS FOUND"
            if is_flipkart_source:
                summary = (
                    "No verified comparable offers matching the exact product model and variant "
                    "were found on Amazon India. "
                    "Variant divergences and unverified listings were excluded to maintain verification integrity."
                )
            else:
                summary = (
                    "No verified comparable offers matching the exact product model and variant "
                    "were found on Flipkart. "
                    "Variant divergences and unverified listings were excluded to maintain verification integrity."
                )

    diagnostics["retailer_diagnostics"] = [d.model_dump() for d in retailer_diagnostics]

    validated_same_platform_offers: list[ComparableOffer] = []
    for so in same_platform_offers_raw:
        try:
            validated_same_platform_offers.append(ComparableOffer(**so))
        except Exception:
            continue

    return ComparePricesResponse(
        status=status,
        source_product=source_product,
        offers=validated_offers,
        verified_offers=verified_offers,
        possible_offers=possible_offers,
        lowest_price=lowest_price,
        lowest_price_retailer=lowest_retailer,
        lowest_price_url=lowest_url,
        price_difference=price_diff,
        verdict_label=verdict_label,
        summary=summary,
        retrieval_timestamp=now_iso,
        retailers_queried=queried_retailers,
        retailer_statuses=retailer_statuses,
        retailer_diagnostics=retailer_diagnostics,
        diagnostics=diagnostics,
        message="Price comparison analysis complete.",

        # SECTION A: Other Platform (Cross-Platform Comparison)
        cross_platform_offers=validated_offers,
        cross_platform_status=cross_platform_status_val if "cross_platform_status_val" in locals() else status,
        cross_platform_diagnostics=retailer_diagnostics,
        lowest_verified_cross_platform_price=lowest_price,
        cross_platform_summary=summary,

        # SECTION B: Other Sellers on this Platform (Same-Platform Seller Comparison)
        same_platform_seller_offers=validated_same_platform_offers,
        same_platform_status=same_platform_status,
        same_platform_diagnostics=same_platform_diags,
        lowest_verified_same_platform_price=lowest_same_platform_price,
        same_platform_summary=same_platform_summary,
    )
