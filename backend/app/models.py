"""
DealSense API — models.py
Pydantic request and response models for all endpoints.
Includes deterministic listing price analysis and genuine cross-store price comparison.
"""

from __future__ import annotations

import urllib.parse
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# ---------------------------------------------------------------------------
# Phase 2 — Listing Price Analysis Models
# ---------------------------------------------------------------------------


class AnalyzeRequest(BaseModel):
    """
    Payload sent by the client (browser extension or test tool) to
    POST /api/analyze. Supports shared product interface fields and aliases.
    """

    url: str
    product_name: str
    current_site_price: float
    mrp: Optional[float] = None
    seller: Optional[str] = None
    variant: Optional[str] = None

    # Universal shared fields
    source_retailer: Optional[str] = None
    product_title: Optional[str] = None
    product_url: Optional[str] = None
    current_price: Optional[float] = None
    retailer_product_id: Optional[str] = None
    manufacturer_part_number: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    category: Optional[str] = None
    specifications: Optional[dict[str, Any]] = None
    availability: Optional[str] = None
    image: Optional[str] = None
    image_url: Optional[str] = None

    # Browser-retrieved candidate offers (e.g. from user-opened competitor search tab)
    browser_candidate_offers: Optional[list[dict[str, Any]]] = None
    browser_retrieval_status: Optional[str] = None
    browser_status_reason: Optional[str] = None


    @model_validator(mode="before")
    @classmethod
    def populate_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "url" not in data and "product_url" in data:
                data["url"] = data["product_url"]
            elif "product_url" not in data and "url" in data:
                data["product_url"] = data["url"]

            if "product_name" not in data and "product_title" in data:
                data["product_name"] = data["product_title"]
            elif "product_title" not in data and "product_name" in data:
                data["product_title"] = data["product_name"]

            if "current_site_price" not in data and "current_price" in data:
                data["current_site_price"] = data["current_price"]
            elif "current_price" not in data and "current_site_price" in data:
                data["current_price"] = data["current_site_price"]

            if "image" not in data and "image_url" in data:
                data["image"] = data["image_url"]
            elif "image_url" not in data and "image" in data:
                data["image_url"] = data["image"]
        return data

    @field_validator("current_site_price")
    @classmethod
    def price_must_be_strictly_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("current_site_price must be greater than zero")
        return v

    @field_validator("mrp")
    @classmethod
    def validate_mrp(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v <= 0:
            return None
        return v


class PriceAnalysis(BaseModel):
    """
    Deterministic evaluation of the listing's selling price against MRP.
    """

    status: str  # "DISCOUNT_VERIFIED" | "LISTED_AT_MRP" | "PRICE_EXCEEDS_MRP" | "MRP_UNAVAILABLE"
    selling_price: float
    mrp: Optional[float] = None
    discount_amount: Optional[float] = None
    discount_percent: Optional[float] = None
    verdict_label: str
    summary: str


class SellerAnalysis(BaseModel):
    """
    Evaluation of seller credentials. Explicitly marked unverified.
    """

    status: str = "UNVERIFIED"
    seller: Optional[str] = None
    summary: str = (
        "Seller identity extracted from page; reputation and credibility are unverified."
    )


class ReviewsAnalysis(BaseModel):
    """
    Evaluation of review sentiment/authenticity. Explicitly marked unverified.
    """

    status: str = "UNVERIFIED"
    summary: str = (
        "Review sentiment and authenticity analysis are not yet supported for live listings."
    )


class MarketComparison(BaseModel):
    """
    Multi-store comparison status summary inside AnalyzeResponse.
    """

    status: str = "ACTIVE"
    summary: str = (
        "Cross-store price comparison is active. Use POST /api/compare-prices for live competitor offer analysis."
    )


class AnalyzeResponse(BaseModel):
    """
    Response returned by POST /api/analyze containing deterministic price analysis.
    """

    status: str
    product_name: str
    current_site_price: float
    mrp: Optional[float] = None
    seller: Optional[str] = None
    url: str
    price_analysis: PriceAnalysis
    seller_analysis: SellerAnalysis
    reviews_analysis: ReviewsAnalysis
    market_comparison: MarketComparison
    message: str
    target_search_query: Optional[str] = None
    structured_source_diagnostic: Optional[SourceProductDiagnostic] = None



class HealthResponse(BaseModel):
    """
    Response returned by GET /api/health.
    """

    status: str
    service: str


# ---------------------------------------------------------------------------
# Phase 3 — Genuine Cross-Store Price Comparison Models
# ---------------------------------------------------------------------------


class MatchStatus(str, Enum):
    EXACT_MATCH = "EXACT_MATCH"
    POSSIBLE_MATCH = "POSSIBLE_MATCH"
    CONFIGURATION_MISMATCH = "CONFIGURATION_MISMATCH"
    MODEL_MISMATCH = "MODEL_MISMATCH"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
    # Backward compatibility
    UNVERIFIED_VARIANT = "UNVERIFIED_VARIANT"
    PROBABLE_MATCH = "PROBABLE_MATCH"
    UNCERTAIN_MATCH = "UNCERTAIN_MATCH"
    MISMATCH = "MISMATCH"


class ComparableOffer(BaseModel):
    """
    Structured offer retrieved from a supported e-commerce retailer.
    """

    retailer_name: str
    product_title: str
    product_url: str
    current_price: float
    mrp: Optional[float] = None
    currency: str = "INR"
    match_status: str  # EXACT_MATCH, UNVERIFIED_VARIANT, PROBABLE_MATCH, UNCERTAIN_MATCH, MISMATCH
    match_details: Optional[str] = None
    rejection_category: Optional[str] = None
    retrieval_timestamp: str
    availability: Optional[str] = "IN_STOCK"
    shipping_cost: Optional[float] = None
    model_identifier: Optional[str] = None
    configuration: Optional[str] = None
    extracted_variants: Optional[dict[str, Any]] = None
    seller_name: Optional[str] = None
    delivery_estimate: Optional[str] = None
    condition: Optional[str] = "New"
    price_difference: Optional[float] = None
    retailer_product_id: Optional[str] = None
    image_url: Optional[str] = None
    data_source: Optional[str] = None

    @field_validator("current_price")
    @classmethod
    def price_must_be_strictly_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("current_price must be greater than zero")
        return round(v, 2)

    @field_validator("mrp")
    @classmethod
    def validate_mrp(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v <= 0:
            return None
        return round(v, 2) if v is not None else None

    @field_validator("product_url")
    @classmethod
    def validate_allowed_url(cls, v: str) -> str:
        parsed = urllib.parse.urlparse(v)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("product_url must be a valid HTTP/HTTPS URL")

        allowed_domains = (
            "flipkart.com",
            "amazon.in",
            "google.co.in",
            "google.com",
        )
        host = parsed.netloc.lower()
        if ":" in host:
            host = host.split(":")[0]
        if not any(host == d or host.endswith("." + d) for d in allowed_domains):
            raise ValueError(
                f"product_url domain '{host}' is not in the supported retailer allowlist"
            )
        return v


class SourceProductSummary(BaseModel):
    """
    Details of the source product being compared. Supports shared product interface fields.
    """

    product_name: str
    current_site_price: float
    mrp: Optional[float] = None
    url: str
    variant: Optional[str] = None
    source_retailer: Optional[str] = None
    retailer_product_id: Optional[str] = None
    manufacturer_part_number: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    category: Optional[str] = None
    specifications: Optional[dict[str, Any]] = None
    availability: Optional[str] = None
    image_url: Optional[str] = None


class ComparePricesRequest(BaseModel):
    """
    Payload sent to POST /api/compare-prices. Supports shared product interface fields and aliases.
    """

    url: str
    product_name: str
    current_site_price: float
    mrp: Optional[float] = None
    seller: Optional[str] = None
    variant: Optional[str] = None

    # Universal shared fields
    source_retailer: Optional[str] = None
    product_title: Optional[str] = None
    product_url: Optional[str] = None
    current_price: Optional[float] = None
    retailer_product_id: Optional[str] = None
    manufacturer_part_number: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    category: Optional[str] = None
    specifications: Optional[dict[str, Any]] = None
    availability: Optional[str] = None
    image: Optional[str] = None
    image_url: Optional[str] = None

    # Browser-retrieved candidate offers
    browser_candidate_offers: Optional[list[dict[str, Any]]] = None
    browser_retrieval_status: Optional[str] = None
    browser_status_reason: Optional[str] = None

    # Custom re-search query
    custom_query: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def populate_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "url" not in data and "product_url" in data:
                data["url"] = data["product_url"]
            elif "product_url" not in data and "url" in data:
                data["product_url"] = data["url"]

            if "product_name" not in data and "product_title" in data:
                data["product_name"] = data["product_title"]
            elif "product_title" not in data and "product_name" in data:
                data["product_title"] = data["product_name"]

            if "current_site_price" not in data and "current_price" in data:
                data["current_site_price"] = data["current_price"]
            elif "current_price" not in data and "current_site_price" in data:
                data["current_price"] = data["current_site_price"]

            if "image" not in data and "image_url" in data:
                data["image"] = data["image_url"]
            elif "image_url" not in data and "image" in data:
                data["image_url"] = data["image"]
        return data

    @field_validator("current_site_price")
    @classmethod
    def price_must_be_strictly_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("current_site_price must be greater than zero")
        return round(v, 2)

    @field_validator("mrp")
    @classmethod
    def validate_mrp(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and v <= 0:
            return None
        return round(v, 2) if v is not None else None


class RetailerDiagnostic(BaseModel):
    """
    Structured diagnostic details for a single queried retailer search.
    """
    retailer_name: str
    search_query: str
    http_status: Optional[int] = None
    status_reason: str
    data_source: Optional[str] = None
    raw_listings_count: int = 0
    parsed_listings_count: int = 0
    valid_price_count: int = 0
    price_failed_count: int = 0
    model_mismatch_count: int = 0
    config_mismatch_count: int = 0
    unverified_variant_count: int = 0
    condition_mismatch_count: int = 0
    exact_matches_count: int = 0
    rejection_breakdown: dict[str, int] = Field(default_factory=dict)



# ---------------------------------------------------------------------------
# Structured Diagnostics Models (Phase 2)
# ---------------------------------------------------------------------------


class SourceProductDiagnostic(BaseModel):
    retailer: str
    product_url: str
    original_title: str
    normalized_title: str
    brand: Optional[str] = None
    model: Optional[str] = None
    product_family: Optional[str] = None
    category: Optional[str] = None
    relevant_attributes: dict[str, Any] = Field(default_factory=dict)
    unextracted_fields: list[str] = Field(default_factory=list)


class RetrievalDiagnosticSummary(BaseModel):
    target_retailer: str
    exact_search_query: str
    raw_result_card_count: int = 0
    candidates_accepted_count: int = 0
    candidates_discarded_count: int = 0
    discard_counts_by_reason: dict[str, int] = Field(default_factory=dict)
    normalized_candidate_count: int = 0
    is_live_data: bool = True
    data_source: str = "Amazon Browser Tab Search"
    retrieval_status: str = "success"


class CandidateMatchingDiagnostic(BaseModel):
    candidate_title: str
    product_url: str
    retailer_product_id: Optional[str] = None
    extracted_attributes: dict[str, Any] = Field(default_factory=dict)
    classification: str
    rejection_reason: Optional[str] = None
    rejection_category: Optional[str] = None
    missing_or_contradictory_attributes: list[str] = Field(default_factory=list)


class MatchingDiagnosticSummary(BaseModel):
    source_attributes_normalized: dict[str, Any] = Field(default_factory=dict)
    exact_match_count: int = 0
    possible_match_count: int = 0
    rejected_count: int = 0
    candidate_diagnostics: list[CandidateMatchingDiagnostic] = Field(default_factory=list)


class FailureClassification(BaseModel):
    retrieval_outcome: str
    matching_outcome: str
    overall_classification: str
    diagnostic_message: str


class StructuredComparisonDiagnostics(BaseModel):
    source_product: SourceProductDiagnostic
    retrieval: RetrievalDiagnosticSummary
    matching: MatchingDiagnosticSummary
    failure_classification: FailureClassification


class ComparePricesResponse(BaseModel):
    """
    Response returned by POST /api/compare-prices.
    """

    status: str  # "success" | "no_offers_found" | "error"
    source_product: SourceProductSummary
    offers: list[ComparableOffer]
    verified_offers: list[ComparableOffer]
    possible_offers: list[ComparableOffer] = Field(default_factory=list)
    lowest_price: Optional[float] = None
    lowest_price_retailer: Optional[str] = None
    lowest_price_url: Optional[str] = None
    price_difference: Optional[float] = None
    verdict_label: str
    summary: str
    retrieval_timestamp: str
    retailers_queried: list[str]
    retailer_statuses: dict[str, str]
    retailer_diagnostics: list[RetailerDiagnostic] = Field(default_factory=list)
    diagnostics: Optional[dict[str, Any]] = None
    message: str
    # SECTION A — Other Platform (Cross-Platform Comparison)
    cross_platform_offers: list[ComparableOffer] = Field(default_factory=list)
    cross_platform_status: str = "not_queried"
    cross_platform_diagnostics: list[RetailerDiagnostic] = Field(default_factory=list)
    lowest_verified_cross_platform_price: Optional[float] = None
    cross_platform_summary: Optional[str] = None

    # SECTION B — Other Sellers on this Platform (Same-Platform Seller Comparison)
    same_platform_seller_offers: list[ComparableOffer] = Field(default_factory=list)
    same_platform_status: str = "not_queried"
    same_platform_diagnostics: list[RetailerDiagnostic] = Field(default_factory=list)
    lowest_verified_same_platform_price: Optional[float] = None
    same_platform_summary: Optional[str] = None
    target_search_query: Optional[str] = None
    structured_diagnostics: Optional[StructuredComparisonDiagnostics] = None
