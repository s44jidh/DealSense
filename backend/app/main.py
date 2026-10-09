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
        "across supported Indian retailers (Flipkart live search; Croma and Reliance Digital marked unavailable)."
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

    try:
        raw_offers, queried_retailers, retailer_statuses, query_used, candidate_evaluations, retailer_diagnostics = (
            retrieval_service.retrieve_and_match(payload.product_name, source_variant=payload.variant)
        )
    except Exception as err:
        raw_offers = []
        queried_retailers = ["Flipkart", "Croma", "Reliance Digital", "Vijay Sales"]
        retailer_statuses = {"all": f"Retrieval error: {str(err)}"}
        retailer_diagnostics = []
        query_used = payload.product_name
        candidate_evaluations = []

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

    source_product = SourceProductSummary(
        product_name=payload.product_name,
        current_site_price=selling_price,
        mrp=mrp,
        url=payload.url,
        variant=payload.variant,
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
                f"saving ₹{price_diff:,.2f} compared to the current Amazon listing (₹{selling_price:,.2f})."
            )
        elif price_diff < 0:
            abs_diff = abs(price_diff)
            verdict_label = "LOWEST VERIFIED PRICE"
            summary = (
                f"Current Amazon listing price (₹{selling_price:,.2f}) is ₹{abs_diff:,.2f} lower "
                f"than the best verified competitor offer on {lowest_retailer} (₹{lowest_price:,.2f})."
            )
        else:
            verdict_label = "MATCHING COMPETITOR PRICE"
            summary = (
                f"Current Amazon listing price matches the verified offer on {lowest_retailer} "
                f"at ₹{lowest_price:,.2f}."
            )

        status = "success"
    else:
        lowest_price = None
        lowest_retailer = None
        lowest_url = None
        price_diff = None
        status = "no_offers_found"
        verdict_label = "NO VERIFIED OFFERS FOUND"
        summary = (
            "No verified comparable offers matching the exact product model and variant "
            "were found on supported retailers. Flipkart was queried live; Croma and "
            "Reliance Digital are disabled due to anti-bot restrictions. "
            "Variant divergences and unverified listings were excluded to maintain verification integrity."
        )

    diagnostics["retailer_diagnostics"] = [d.model_dump() for d in retailer_diagnostics]

    return ComparePricesResponse(
        status=status,
        source_product=source_product,
        offers=validated_offers,
        verified_offers=verified_offers,
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
    )
