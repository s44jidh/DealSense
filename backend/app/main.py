"""
DealSense API — main.py
FastAPI application setup, CORS configuration, and endpoint definitions.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.models import AnalyzeRequest, AnalyzeResponse, HealthResponse

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="DealSense API",
    description=(
        "Backend API for the DealSense browser extension. "
        "Receives product data from the extension and returns deal analysis."
    ),
    version="0.1.0",
)

# ---------------------------------------------------------------------------
# CORS — allow all localhost origins during local development so the React
# dev server and the unpacked Chrome extension can both reach this API.
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost",
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8443",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get(
    "/api/health",
    response_model=HealthResponse,
    summary="Health check",
    tags=["meta"],
)
def health() -> HealthResponse:
    """
    Confirms that the DealSense API is running and reachable.
    """
    return HealthResponse(status="ok", service="DealSense API")


@app.post(
    "/api/analyze",
    response_model=AnalyzeResponse,
    summary="Analyze a product listing",
    tags=["analysis"],
)
def analyze(payload: AnalyzeRequest) -> AnalyzeResponse:
    """
    Accepts product data extracted from a retailer page and returns an
    analysis response.

    At this stage the endpoint validates and echoes the received data,
    confirming the connection between the extension and the backend.
    Scoring and deal logic will be added in subsequent stages.
    """
    return AnalyzeResponse(
        status="success",
        product_name=payload.product_name,
        current_site_price=payload.current_site_price,
        seller=payload.seller,
        url=payload.url,
        message="DealSense analysis endpoint connected",
    )
