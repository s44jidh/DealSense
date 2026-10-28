"""
DealSense API — main.py
FastAPI backend service for E-Commerce Product Customer Review Analysis & Suspicious Review Detection.
Supports Amazon India (amazon.in) and Flipkart (flipkart.com) reviews.
Provides:
  - Supervised Sentiment Analysis (positive, neutral, negative)
  - Interpretable Aspect-Based Sentiment Analysis (product vs. delivery experience)
  - Pros and Cons extraction backed by genuine review excerpts
  - Explainable Suspicious-Pattern Detection (duplicates, promotional text, rating mismatches)
  - Comprehensive Product Trust & Authenticity Reports
"""

from __future__ import annotations

import os
import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.review_models import (
    AnalyzeSentimentRequest,
    AnalyzeSentimentResponse,
    AspectAnalysisResponse,
    BatchReviewAnalysisRequest,
    BatchReviewAnalysisResponse,
    ClassifyFakeReviewRequest,
    ClassifyFakeReviewResponse,
    FakeReviewBatchResponse,
    FakeReviewPrediction,
    LLMReviewSummaryResponse,
    ModelStatusResponse,
    ReviewItem,
    SentimentPrediction,
    SuspiciousAnalysisResponse,
)
from app.ml.sentiment_pipeline import SentimentPredictor, MODEL_DIR
from app.ml.fake_review_pipeline import FakeReviewClassifier
from app.ml.aspect_analyzer import AspectAnalyzer
from app.ml.suspicious_analyzer import SuspiciousPatternAnalyzer
from app.ml.llm_analyzer import ReviewLLMAnalyzer

# Startup lifecycle to load models once into memory
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-load Model A (Sentiment Predictor)
    predictor = SentimentPredictor.get_instance()
    if predictor.is_ready:
        print("[DealSense] Model A (Sentiment analysis) loaded successfully.")
    else:
        print("[DealSense Warning] Sentiment model not found in backend/models. Train with 'python backend/app/ml/train.py'.")

    # Pre-load Model B (Fake Review Classifier)
    fake_clf = FakeReviewClassifier.get_instance()
    if fake_clf.is_ready:
        print("[DealSense] Model B (Fake review classifier) loaded successfully.")
    else:
        print("[DealSense Warning] Fake review model not found in backend/models.")

    # Check LLM status
    llm_stat = ReviewLLMAnalyzer.get_api_status()
    print(f"[DealSense] LLM Integration status: {llm_stat['message']} (provider={llm_stat['provider']})")
    yield

app = FastAPI(
    title="DealSense — Review Intelligence & Suspicious Pattern Detection API",
    description="Product customer review analysis and explainable suspicious review detection for Indian e-commerce.",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS configuration for browser extension and dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "chrome-extension://*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



from fastapi import Response
from app.models import (
    AnalyzeRequest,
    AnalyzeResponse,
    CandidateMatchingDiagnostic,
    ComparableOffer,
    ComparePricesRequest,
    ComparePricesResponse,
    FailureClassification,
    HealthResponse,
    MarketComparison,
    MatchingDiagnosticSummary,
    PriceAnalysis,
    RetrievalDiagnosticSummary,
    ReviewsAnalysis,
    SellerAnalysis,
    SourceProductDiagnostic,
    SourceProductSummary,
    StructuredComparisonDiagnostics,
)
from app.retrieval import OfferRetrievalService
retrieval_service = OfferRetrievalService()


@app.get("/api/health")
@app.get("/health")
def health_check() -> dict[str, Any]:
    predictor = SentimentPredictor.get_instance()
    return {
        "status": "healthy",
        "service": "DealSense Product Review Intelligence API",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model_ready": predictor.is_ready,
        "supported_platforms": ["Amazon India (amazon.in)", "Flipkart (flipkart.com)"],
    }


@app.get("/api/models/status", response_model=ModelStatusResponse)
@app.get("/api/reviews/model-status", response_model=ModelStatusResponse)
def model_status() -> ModelStatusResponse:
    predictor = SentimentPredictor.get_instance()
    fake_clf = FakeReviewClassifier.get_instance()
    llm_stat = ReviewLLMAnalyzer.get_api_status()

    stats_path = os.path.join(os.path.dirname(__file__), "..", "data", "processed", "dataset_stats.json")
    dataset_stats = None
    if os.path.isfile(stats_path):
        try:
            with open(stats_path, "r", encoding="utf-8") as f:
                dataset_stats = json.load(f)
        except Exception:
            dataset_stats = None

    meta = predictor.metadata if predictor.is_ready else {}
    fake_meta = fake_clf.metadata if fake_clf.is_ready else {}

    return ModelStatusResponse(
        model_loaded=bool(predictor.is_ready and fake_clf.is_ready),
        sentiment_model=meta,
        fake_review_model=fake_meta,
        llm_status=llm_stat,
        model_name=meta.get("model_name"),
        vocabulary_size=meta.get("vocabulary_size"),
        test_metrics=meta.get("test_metrics"),
        dataset_stats=dataset_stats,
    )


@app.post("/api/reviews/classify-fake-dataset", response_model=ClassifyFakeReviewResponse)
def classify_fake_reviews_dataset(payload: ClassifyFakeReviewRequest) -> ClassifyFakeReviewResponse:
    fake_clf = FakeReviewClassifier.get_instance()
    texts: list[str] = []
    if payload.text and payload.text.strip():
        texts.append(payload.text.strip())
    if payload.reviews:
        texts.extend([r.strip() for r in payload.reviews if r and r.strip()])

    if not texts:
        raise HTTPException(status_code=400, detail="No review text provided for fake review classification.")

    results = fake_clf.predict_batch(texts)
    predictions = [FakeReviewPrediction(**r) for r in results]
    return ClassifyFakeReviewResponse(status="success", predictions=predictions)


@app.post("/api/reviews/analyze-sentiment", response_model=AnalyzeSentimentResponse)
def analyze_sentiment(payload: AnalyzeSentimentRequest) -> AnalyzeSentimentResponse:
    predictor = SentimentPredictor.get_instance()
    texts: list[str] = []
    if payload.text and payload.text.strip():
        texts.append(payload.text.strip())
    if payload.reviews:
        texts.extend([r.strip() for r in payload.reviews if r and r.strip()])

    if not texts:
        raise HTTPException(status_code=400, detail="No review text provided for sentiment analysis.")

    results = predictor.predict_batch(texts)
    predictions = [SentimentPrediction(**r) for r in results]
    return AnalyzeSentimentResponse(status="success", predictions=predictions)


@app.post("/api/reviews/analyze-aspects", response_model=AspectAnalysisResponse)
def analyze_aspects(reviews: list[ReviewItem]) -> AspectAnalysisResponse:
    if not reviews:
        raise HTTPException(status_code=400, detail="Review list cannot be empty.")

    raw_items = [r.model_dump() for r in reviews]
    aspect_results = AspectAnalyzer.analyze_aspects(raw_items)
    return AspectAnalysisResponse(
        status="success",
        aspects=aspect_results["aspects"],
        pros=aspect_results["pros"],
        cons=aspect_results["cons"],
        delivery_summary=aspect_results["delivery_summary"],
    )


@app.post("/api/reviews/analyze-suspicious", response_model=SuspiciousAnalysisResponse)
def analyze_suspicious(reviews: list[ReviewItem]) -> SuspiciousAnalysisResponse:
    if not reviews:
        raise HTTPException(status_code=400, detail="Review list cannot be empty.")

    predictor = SentimentPredictor.get_instance()
    raw_items = [r.model_dump() for r in reviews]
    texts = [r.get("text", "") for r in raw_items]
    sentiment_preds = predictor.predict_batch(texts)

    suspicious_report = SuspiciousPatternAnalyzer.analyze_reviews(raw_items, sentiment_preds)
    return SuspiciousAnalysisResponse(
        status="success",
        total_analyzed=suspicious_report["total_analyzed"],
        suspicious_count=suspicious_report["suspicious_count"],
        clean_reviews_count=suspicious_report["clean_reviews_count"],
        suspicion_rate=suspicious_report["suspicion_rate"],
        flags_breakdown=suspicious_report["flags_breakdown"],
        flagged_reviews=suspicious_report["flagged_reviews"],
        disclaimer=suspicious_report["disclaimer"],
    )


@app.post("/api/reviews/analyze-batch", response_model=BatchReviewAnalysisResponse)
def analyze_batch_reviews(payload: BatchReviewAnalysisRequest) -> BatchReviewAnalysisResponse:
    if not payload.product_name or not payload.product_name.strip():
        raise HTTPException(status_code=400, detail="Product name is required.")

    reviews = payload.reviews
    if not reviews:
        # Return graceful empty review analysis state
        return BatchReviewAnalysisResponse(
            status="no_reviews",
            product_name=payload.product_name,
            source_retailer=payload.source_retailer or "Unknown Retailer",
            total_reviews_extracted=0,
            total_reviews_analyzed=0,
            sentiment_distribution={"positive": 0, "neutral": 0, "negative": 0},
            sentiment_percentages={"positive": 0.0, "neutral": 0.0, "negative": 0.0},
            overall_sentiment_label="No Reviews Available",
            average_rating=None,
            aspect_analysis=AspectAnalysisResponse(
                status="no_data",
                aspects=[],
                pros=[],
                cons=[],
                delivery_summary={"mentions": 0, "positive_percentage": 0.0, "sample_quote": None},
            ),
            suspicious_analysis=SuspiciousAnalysisResponse(
                status="no_data",
                total_analyzed=0,
                suspicious_count=0,
                clean_reviews_count=0,
                suspicion_rate=0.0,
                flags_breakdown={},
                flagged_reviews=[],
                disclaimer="No reviews extracted for pattern analysis.",
            ),
            fake_review_analysis=FakeReviewBatchResponse(
                status="no_data",
                total_analyzed=0,
                cg_count=0,
                or_count=0,
                cg_percentage=0.0,
                or_percentage=0.0,
                mean_cg_probability=0.0,
                disclaimer="No customer reviews extracted for classification.",
            ),
            llm_summary=LLMReviewSummaryResponse(
                status="no_data",
                available=False,
                provider="local",
                summary="No customer reviews found on the active product page or provided via manual input.",
                recurring_complaints=[],
                common_positive_themes=[],
                pros=[],
                cons=[],
                investigation_patterns=[],
                error="NO_REVIEWS",
            ),
            pros=[],
            cons=[],
            trust_score=100.0,
            data_limitations="No customer reviews found on the active product page or provided via manual input.",
            analyzed_reviews=[],
        )

    predictor = SentimentPredictor.get_instance()
    fake_clf = FakeReviewClassifier.get_instance()
    raw_reviews = [r.model_dump() for r in reviews]
    texts = [r.get("text", "") for r in raw_reviews]

    # 1. Model A: Sentiment Classification (Dataset-SA trained)
    sentiment_preds = predictor.predict_batch(texts)

    # 2. Model B: Dataset-based Review Classification (CG vs OR)
    fake_summary = fake_clf.analyze_batch_summary(texts)
    fake_preds = fake_clf.predict_batch(texts)
    fake_batch_resp = FakeReviewBatchResponse(
        status="success" if fake_clf.is_ready else "model_not_loaded",
        total_analyzed=fake_summary["total_analyzed"],
        cg_count=fake_summary["cg_count"],
        or_count=fake_summary["or_count"],
        cg_percentage=fake_summary["cg_percentage"],
        or_percentage=fake_summary["or_percentage"],
        mean_cg_probability=fake_summary["mean_cg_probability"],
        disclaimer=fake_summary["disclaimer"],
    )

    # 3. Aspect Analysis
    aspect_results = AspectAnalyzer.analyze_aspects(raw_reviews)
    aspect_resp = AspectAnalysisResponse(
        status="success",
        aspects=aspect_results["aspects"],
        pros=aspect_results["pros"],
        cons=aspect_results["cons"],
        delivery_summary=aspect_results["delivery_summary"],
    )

    # 4. Customer Review Synthesis (Gemini / OpenAI / Local Extractive NLP)
    llm_data = ReviewLLMAnalyzer.analyze_reviews(
        product_name=payload.product_name,
        reviews=raw_reviews,
        sentiment_preds=sentiment_preds,
        aspects_data=aspect_results,
    )
    llm_resp = LLMReviewSummaryResponse(
        status=llm_data["status"],
        available=llm_data["available"],
        provider=llm_data.get("provider"),
        summary=llm_data.get("summary", ""),
        recurring_complaints=llm_data.get("recurring_complaints", []),
        common_positive_themes=llm_data.get("common_positive_themes", []),
        pros=llm_data.get("pros", []),
        cons=llm_data.get("cons", []),
        investigation_patterns=llm_data.get("investigation_patterns", []),
        error=llm_data.get("error"),
    )

    # Calculate sentiment distribution
    sentiment_counts = {"positive": 0, "neutral": 0, "negative": 0}
    ratings_sum = 0
    ratings_count = 0

    for i, r in enumerate(raw_reviews):
        s = sentiment_preds[i].get("sentiment", "neutral")
        sentiment_counts[s] = sentiment_counts.get(s, 0) + 1
        if r.get("rating") is not None:
            ratings_sum += r["rating"]
            ratings_count += 1

    total_n = len(raw_reviews)
    sentiment_pcts = {
        k: round(100.0 * cnt / total_n, 1) for k, cnt in sentiment_counts.items()
    }

    avg_rating = round(ratings_sum / ratings_count, 1) if ratings_count > 0 else None

    # Determine overall sentiment label
    pos_pct = sentiment_pcts["positive"]
    neg_pct = sentiment_pcts["negative"]
    if pos_pct >= 70:
        overall_label = "OVERWHELMINGLY POSITIVE" if pos_pct >= 85 else "MOSTLY POSITIVE"
    elif neg_pct >= 45:
        overall_label = "MOSTLY NEGATIVE"
    elif abs(pos_pct - neg_pct) < 20:
        overall_label = "MIXED OPINIONS"
    else:
        overall_label = "MODERATELY POSITIVE"


    # 5. Rule-based Suspicious Pattern Analysis (Heuristic indicators)
    suspicious_results = SuspiciousPatternAnalyzer.analyze_reviews(raw_reviews, sentiment_preds)
    suspicious_resp = SuspiciousAnalysisResponse(
        status="success",
        total_analyzed=suspicious_results["total_analyzed"],
        suspicious_count=suspicious_results["suspicious_count"],
        clean_reviews_count=suspicious_results["clean_reviews_count"],
        suspicion_rate=suspicious_results["suspicion_rate"],
        flags_breakdown=suspicious_results["flags_breakdown"],
        flagged_reviews=suspicious_results["flagged_reviews"],
        disclaimer=suspicious_results["disclaimer"],
    )

    # 6. Compute Trust Score (0 to 100)
    suspicion_rate = suspicious_results["suspicion_rate"]
    dup_cnt = suspicious_results["flags_breakdown"].get("exact_duplicate", 0)
    mismatch_cnt = suspicious_results["flags_breakdown"].get("rating_sentiment_mismatch", 0)
    cg_penalty = (fake_summary["cg_percentage"] * 0.25) if fake_summary["cg_percentage"] > 40 else 0.0

    penalty = (suspicion_rate * 0.7) + (dup_cnt * 1.5) + (mismatch_cnt * 1.2) + cg_penalty
    trust_score = round(max(15.0, min(100.0, 100.0 - penalty)), 1)

    # Data limitations
    limitations = (
        f"Analysis based on {total_n} visible/extracted customer reviews. "
        "Sentiment predictions generated by Model A (TF-IDF + Logistic Regression). "
        "Dataset similarity evaluated by Model B (CG/OR classifier). "
        "Suspicious signals indicate heuristic pattern anomalies, not definitive proof of review fraud."
    )

    # Enriched individual reviews for UI display
    enriched_reviews = []
    for i, r in enumerate(raw_reviews):
        enriched_reviews.append({
            "id": r.get("id") or f"rev_{i}",
            "text": r.get("text"),
            "rating": r.get("rating"),
            "title": r.get("title"),
            "author": r.get("author") or "Customer",
            "date": r.get("date"),
            "verified_purchase": r.get("verified_purchase"),
            "sentiment": sentiment_preds[i].get("sentiment"),
            "confidence": sentiment_preds[i].get("confidence"),
            "cg_label": fake_preds[i].get("label") if i < len(fake_preds) else "OR",
            "cg_probability": fake_preds[i].get("cg_probability") if i < len(fake_preds) else 0.0,
        })

    return BatchReviewAnalysisResponse(
        status="success",
        product_name=payload.product_name,
        source_retailer=payload.source_retailer or "Amazon.in",
        total_reviews_extracted=total_n,
        total_reviews_analyzed=total_n,
        sentiment_distribution=sentiment_counts,
        sentiment_percentages=sentiment_pcts,
        overall_sentiment_label=overall_label,
        average_rating=avg_rating,
        aspect_analysis=aspect_resp,
        suspicious_analysis=suspicious_resp,
        fake_review_analysis=fake_batch_resp,
        llm_summary=llm_resp,
        pros=aspect_results["pros"],
        cons=aspect_results["cons"],
        trust_score=trust_score,
        data_limitations=limitations,
        analyzed_reviews=enriched_reviews,
    )


@app.post("/api/reviews/trust-report")
def generate_trust_report(payload: BatchReviewAnalysisRequest) -> dict[str, Any]:
    batch_resp = analyze_batch_reviews(payload)
    return {
        "status": batch_resp.status,
        "product_name": batch_resp.product_name,
        "source_retailer": batch_resp.source_retailer,
        "total_reviews_analyzed": batch_resp.total_reviews_analyzed,
        "trust_score": batch_resp.trust_score,
        "overall_sentiment": batch_resp.overall_sentiment_label,
        "sentiment_breakdown": batch_resp.sentiment_percentages,
        "suspicious_summary": {
            "suspicious_count": batch_resp.suspicious_analysis.suspicious_count,
            "suspicion_rate": batch_resp.suspicious_analysis.suspicion_rate,
            "flags": batch_resp.suspicious_analysis.flags_breakdown,
        },
        "key_product_strengths": [p["summary"] for p in batch_resp.pros],
        "key_product_complaints": [c["summary"] for c in batch_resp.cons],
        "delivery_experience": batch_resp.aspect_analysis.delivery_summary,
        "data_limitations": batch_resp.data_limitations,
    }


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
    target_retailer_name = "Amazon.in" if is_flipkart_source else "Flipkart"
    target_retailer_tag = "AMAZON" if is_flipkart_source else "FLIPKART"
    structured_diags: Optional[StructuredComparisonDiagnostics] = None
    verdict_label = "NO VERIFIED OFFERS FOUND"
    cross_platform_status_val = "not_queried"
    summary = "Price comparison initialized."

    browser_mode = bool(
        payload.browser_candidate_offers is not None or
        payload.browser_retrieval_status is not None
    )

    if browser_mode:
        raw_offers = []
        queried_retailers = [target_retailer_name]
        retailer_statuses = {target_retailer_name: payload.browser_status_reason or "Browser tab retrieval"}
        query_used = payload.product_name
        retailer_diagnostics = []
        candidate_evaluations = []
        same_platform_offers_raw = []
        same_platform_status = "not_queried"
        same_platform_diags = []
        lowest_same_platform_price = None
        same_platform_summary = "Same-platform seller comparison skipped in browser mode."

        b_status = payload.browser_retrieval_status
        cand_list = payload.browser_candidate_offers or []

        from app.matcher import normalize_title

        source_diag = SourceProductDiagnostic(
            retailer=getattr(payload, "source_retailer", None) or source_name,
            product_url=payload.url or "",
            original_title=payload.product_name,
            normalized_title=normalize_title(payload.product_name),
            brand=getattr(payload, "brand", None),
            model=getattr(payload, "model", None),
        )

        if b_status == "not_open":
            cross_platform_status_val = "tab_not_open"
            status = "no_offers_found"
            verdict_label = f"{target_retailer_name.upper()} TAB NOT OPEN"
            summary = payload.browser_status_reason or f"{target_retailer_name} tab not open in browser."
            structured_diags = StructuredComparisonDiagnostics(
                source_product=source_diag,
                retrieval=RetrievalDiagnosticSummary(
                    target_retailer=target_retailer_name,
                    exact_search_query=query_used,
                    retrieval_status="tab_not_open",
                ),
                matching=MatchingDiagnosticSummary(),
                failure_classification=FailureClassification(
                    retrieval_outcome=f"{target_retailer_tag}_TAB_NOT_OPEN",
                    matching_outcome="NOT_EVALUATED",
                    overall_classification="Retrieval incomplete",
                    diagnostic_message=summary,
                ),
            )
        elif b_status == "blocked":
            cross_platform_status_val = "retailer_unavailable"
            status = "no_offers_found"
            verdict_label = f"{target_retailer_name.upper()} UNAVAILABLE"
            summary = payload.browser_status_reason or f"{target_retailer_name} displayed a CAPTCHA or access block challenge."
            structured_diags = StructuredComparisonDiagnostics(
                source_product=source_diag,
                retrieval=RetrievalDiagnosticSummary(
                    target_retailer=target_retailer_name,
                    exact_search_query=query_used,
                    retrieval_status="blocked",
                ),
                matching=MatchingDiagnosticSummary(),
                failure_classification=FailureClassification(
                    retrieval_outcome=f"{target_retailer_tag}_ACCESS_BLOCKED",
                    matching_outcome="NOT_EVALUATED",
                    overall_classification="Retailer blocked access",
                    diagnostic_message=summary,
                ),
            )
        elif b_status == "no_results" or (b_status == "found" and len(cand_list) == 0):
            cross_platform_status_val = "no_search_results"
            status = "no_offers_found"
            verdict_label = "NO RESULTS FOUND"
            summary = f"Search returned 0 listings on {target_retailer_name}."
            structured_diags = StructuredComparisonDiagnostics(
                source_product=source_diag,
                retrieval=RetrievalDiagnosticSummary(
                    target_retailer=target_retailer_name,
                    exact_search_query=query_used,
                    raw_result_card_count=0,
                    retrieval_status="empty",
                ),
                matching=MatchingDiagnosticSummary(),
                failure_classification=FailureClassification(
                    retrieval_outcome="SEARCH_PAGE_EMPTY",
                    matching_outcome="NOT_EVALUATED",
                    overall_classification="Retrieval succeeded, no relevant matches",
                    diagnostic_message=summary,
                ),
            )
        else:
            from app.matcher import ProductMatcher, MatchStatus

            seen_cand_urls = set()
            unique_cands = []
            for c in cand_list:
                u = c.get("product_url", "")
                if u and u in seen_cand_urls:
                    continue
                if u:
                    seen_cand_urls.add(u)
                unique_cands.append(c)

            cand_diags = []
            exact_count = 0
            rejected_count = 0

            for c in unique_cands:
                c_title = c.get("product_title", "")
                c_url = c.get("product_url", "")
                c_price = c.get("current_price", -1.0)

                if c_price is None or c_price <= 0:
                    rejected_count += 1
                    cand_diags.append(CandidateMatchingDiagnostic(
                        candidate_title=c_title,
                        product_url=c_url,
                        classification="PRICE_FAILED",
                        rejection_reason="Price extraction failed or unlisted.",
                    ))
                    continue

                m_status, reason, cat, cand_vars = ProductMatcher.evaluate_match(
                    payload.product_name,
                    c_title,
                    candidate_url=c_url,
                    source_variant=payload.variant,
                    source_category=getattr(payload, "category", None),
                    source_brand=getattr(payload, "brand", None),
                    source_model=getattr(payload, "model", None),
                    source_specs=getattr(payload, "specifications", None),
                )

                offer_dict = dict(c)
                offer_dict["match_status"] = m_status.value
                offer_dict["rejection_reason"] = reason
                offer_dict["rejection_category"] = cat.value
                offer_dict["extracted_variants"] = cand_vars
                offer_dict["retailer_name"] = c.get("retailer_name") or target_retailer_name
                offer_dict["retrieval_timestamp"] = now_iso
                if "availability" not in offer_dict or not offer_dict["availability"]:
                    offer_dict["availability"] = "IN_STOCK"

                raw_offers.append(offer_dict)

                if m_status == MatchStatus.EXACT_MATCH:
                    exact_count += 1
                    cand_diags.append(CandidateMatchingDiagnostic(
                        candidate_title=c_title,
                        product_url=c_url,
                        retailer_product_id=c.get("retailer_product_id"),
                        classification="EXACT_MATCH",
                    ))
                else:
                    rejected_count += 1
                    cand_diags.append(CandidateMatchingDiagnostic(
                        candidate_title=c_title,
                        product_url=c_url,
                        retailer_product_id=c.get("retailer_product_id"),
                        classification=m_status.value,
                        rejection_reason=reason,
                        rejection_category=cat.value,
                    ))

            matching_diag = MatchingDiagnosticSummary(
                exact_match_count=exact_count,
                rejected_count=rejected_count,
                candidate_diagnostics=cand_diags,
            )

            if exact_count == 0:
                verdict_label = "NO EXACT MATCH"
                cross_platform_status_val = "all_candidates_rejected"
                summary = f"All {len(unique_cands)} retrieved listings rejected by deterministic matching."
                failure_class = FailureClassification(
                    retrieval_outcome="RETRIEVAL_SUCCEEDED",
                    matching_outcome="CANDIDATES_REJECTED_BY_MATCHER",
                    overall_classification="Retrieval succeeded, candidates rejected by matching",
                    diagnostic_message=summary,
                )
            else:
                verdict_label = "EXACT MATCH FOUND"
                cross_platform_status_val = "exact_match_found"
                summary = "Verified comparable offer found."
                failure_class = FailureClassification(
                    retrieval_outcome="RETRIEVAL_SUCCEEDED",
                    matching_outcome="EXACT_MATCH_VERIFIED",
                    overall_classification="Match verified successfully",
                    diagnostic_message=summary,
                )

            structured_diags = StructuredComparisonDiagnostics(
                source_product=source_diag,
                retrieval=RetrievalDiagnosticSummary(
                    target_retailer=target_retailer_name,
                    exact_search_query=query_used,
                    raw_result_card_count=len(cand_list),
                    candidates_accepted_count=len(unique_cands),
                    candidates_discarded_count=len(cand_list) - len(unique_cands),
                    normalized_candidate_count=len(unique_cands),
                    retrieval_status="found",
                ),
                matching=matching_diag,
                failure_classification=failure_class,
            )
    else:
        # SECTION A: Cross-Platform Retrieval (competing retailer only)
        try:
            raw_offers, queried_retailers, retailer_statuses, query_used, candidate_evaluations, retailer_diagnostics = (
                retrieval_service.retrieve_and_match(
                    payload.product_name,
                    source_variant=payload.variant,
                    source_url=payload.url,
                    source_retailer=getattr(payload, "source_retailer", None),
                    brand=getattr(payload, "brand", None),
                    model=getattr(payload, "model", None),
                    category=getattr(payload, "category", None),
                    specifications=getattr(payload, "specifications", None),
                    custom_query=getattr(payload, "custom_query", None),
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
        cross_platform_status_val = "success"
    else:
        lowest_price = None
        lowest_retailer = None
        lowest_url = None
        price_diff = None

        if not browser_mode:
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
        else:
            status = "no_offers_found"

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
        structured_diagnostics=structured_diags,
    )
