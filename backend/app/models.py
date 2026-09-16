"""
DealSense API — models.py
Pydantic request and response models for all endpoints.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, HttpUrl, field_validator


class AnalyzeRequest(BaseModel):
    """
    Payload sent by the client (browser extension or test tool) to
    POST /api/analyze.

    Fields
    ------
    url : str
        Full URL of the product page being analysed.
    product_name : str
        Human-readable product title as it appears on the listing.
    current_site_price : float
        The price currently displayed on the retailer's product page,
        before any calculated discount/offer adjustments.
    seller : str | None
        Seller name as shown on the listing, or null if unavailable.
    """

    url: str
    product_name: str
    current_site_price: float
    seller: Optional[str] = None

    @field_validator("current_site_price")
    @classmethod
    def price_must_be_positive(cls, v: float) -> float:
        if v < 0:
            raise ValueError("current_site_price must be a non-negative number")
        return v


class AnalyzeResponse(BaseModel):
    """
    Response returned by POST /api/analyze.
    """

    status: str
    product_name: str
    current_site_price: float
    seller: Optional[str]
    url: str
    message: str


class HealthResponse(BaseModel):
    """
    Response returned by GET /api/health.
    """

    status: str
    service: str
