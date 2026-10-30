"""
DealSense API — review_models.py
Typed Pydantic schemas for product review sentiment analysis, aspect extraction,
suspicious pattern detection, dataset-based fake review classification (Model B),
LLM-generated executive summaries, and trust report generation.
"""

from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field


class ReviewItem(BaseModel):
    id: Optional[str] = None
    text: str = Field(..., description="Customer review text content")
    rating: Optional[int] = Field(None, ge=1, le=5, description="Star rating from 1 to 5")
    title: Optional[str] = Field(None, description="Review headline or summary")
    author: Optional[str] = Field(None, description="Reviewer name or alias")
    date: Optional[str] = Field(None, description="Review post date if available")
    verified_purchase: Optional[bool] = Field(None, description="Verified purchase badge indicator")


class SentimentPrediction(BaseModel):
    sentiment: str  # "positive", "neutral", "negative"
    confidence: float
    probabilities: dict[str, float]
    status: str = "SUCCESS"


class AnalyzeSentimentRequest(BaseModel):
    text: Optional[str] = None
    reviews: Optional[list[str]] = None


class AnalyzeSentimentResponse(BaseModel):
    status: str
    predictions: list[SentimentPrediction]


class FakeReviewPrediction(BaseModel):
    label: str  # "CG" or "OR"
    prediction_label: str  # "Computer-Generated (CG)" or "Original (OR)"
    cg_probability: float
    or_probability: float
    confidence: float
    status: str = "SUCCESS"


class ClassifyFakeReviewRequest(BaseModel):
    text: Optional[str] = None
    reviews: Optional[list[str]] = None


class ClassifyFakeReviewResponse(BaseModel):
    status: str
    predictions: list[FakeReviewPrediction]


class FakeReviewBatchResponse(BaseModel):
    status: str
    total_analyzed: int
    cg_count: int
    or_count: int
    cg_percentage: float
    or_percentage: float
    mean_cg_probability: float
    disclaimer: str


class LLMReviewSummaryResponse(BaseModel):
    status: str
    available: bool
    provider: Optional[str] = None
    summary: str
    verdict: Optional[str] = None
    verdict_sentiment: Optional[str] = None
    verdict_detail: Optional[str] = None
    confidence_score: Optional[float] = None
    confidence_level: Optional[str] = None
    confidence_explanation: Optional[str] = None
    suitable_for: Optional[str] = None
    avoid_if: Optional[str] = None
    total_reviews_analyzed: Optional[int] = None
    target_count: Optional[int] = None
    recurring_complaints: list[str] = Field(default_factory=list)
    common_positive_themes: list[str] = Field(default_factory=list)
    pros: list[str] = Field(default_factory=list)
    cons: list[str] = Field(default_factory=list)
    investigation_patterns: list[str] = Field(default_factory=list)
    error: Optional[str] = None


class AspectItem(BaseModel):
    aspect_id: str
    display_name: str
    category: str  # "product" vs "logistics_seller"
    mention_count: int
    positive_mentions: int
    negative_mentions: int
    positive_percentage: float
    negative_percentage: float
    positive_excerpts: list[str]
    negative_excerpts: list[str]
    summary: Optional[str] = None
    sentiment_label: Optional[str] = None


class AspectAnalysisResponse(BaseModel):
    status: str
    aspects: list[AspectItem]
    pros: list[dict[str, Any]]
    cons: list[dict[str, Any]]
    delivery_summary: dict[str, Any]


class SuspiciousFlagItem(BaseModel):
    review_id: str
    review_text: str
    rating: Optional[int]
    author: str
    date: Optional[str]
    predicted_sentiment: str
    flags: list[str]
    reasons: list[str]
    severity: str  # "HIGH" or "MEDIUM"


class SuspiciousAnalysisResponse(BaseModel):
    status: str
    total_analyzed: int
    suspicious_count: int
    clean_reviews_count: int
    suspicion_rate: float
    flags_breakdown: dict[str, int]
    flagged_reviews: list[SuspiciousFlagItem]
    disclaimer: str


class BatchReviewAnalysisRequest(BaseModel):
    product_name: str
    url: Optional[str] = None
    source_retailer: Optional[str] = "Amazon.in"
    reviews: list[ReviewItem] = Field(default_factory=list)
    target_count: Optional[int] = None


class BatchReviewAnalysisResponse(BaseModel):
    status: str
    product_name: str
    source_retailer: str
    total_reviews_extracted: int
    total_reviews_analyzed: int
    sentiment_distribution: dict[str, int]
    sentiment_percentages: dict[str, float]
    overall_sentiment_label: str
    average_rating: Optional[float] = None
    aspect_analysis: AspectAnalysisResponse
    suspicious_analysis: SuspiciousAnalysisResponse
    fake_review_analysis: Optional[FakeReviewBatchResponse] = None
    llm_summary: Optional[LLMReviewSummaryResponse] = None
    pros: list[dict[str, Any]]
    cons: list[dict[str, Any]]
    trust_score: float
    data_limitations: str
    analyzed_reviews: list[dict[str, Any]]
    rating_distribution: Optional[dict[str, int]] = Field(default_factory=dict)
    target_reviews_count: Optional[int] = None


class ModelStatusResponse(BaseModel):
    model_loaded: bool
    sentiment_model: Optional[dict[str, Any]] = None
    fake_review_model: Optional[dict[str, Any]] = None
    llm_status: Optional[dict[str, Any]] = None
    model_name: Optional[str] = None
    vocabulary_size: Optional[int] = None
    test_metrics: Optional[dict[str, Any]] = None
    dataset_stats: Optional[dict[str, Any]] = None
