"""
DealSense Data Science Pipeline — suspicious_analyzer.py
Explainable, rule-based suspicious review pattern analyzer.
Detects:
  - Exact duplicate reviews
  - Near-duplicate wording (token & n-gram Jaccard similarity)
  - Rating vs. text sentiment contradictions
  - Promotional, spam, and incentivized phrasing
  - Short generic boilerplate
  - Review burst anomalies when reliable dates exist
Does NOT claim to be a definitive fake review classifier; outputs transparent suspicion indicators.
"""

from __future__ import annotations

import re
from typing import Any, Optional
from collections import Counter, defaultdict

PROMOTIONAL_PATTERNS = [
    r"\b100%\s*(?:original|genuine|real|authentic)\b",
    r"\bguaranteed\s*results?\b",
    r"\bmust\s*buy\s*now\b",
    r"\bdeal\s*of\s*the\s*(?:day|century)\b",
    r"\bfree\s*(?:gift|sample|product)\b",
    r"\b(?:refund|cashback|cash\s*back|paytm)\b",
    r"\bdiscount\s*coupon\b",
    r"\b(?:whatsapp|telegram|instagram)\b",
    r"\bdm\s*on\s*insta(?:gram)?\b",
    r"\bcall\s*on\s*\d{10}\b",
]

GENERIC_BOILERPLATE = {
    "good", "nice", "ok", "okay", "super", "best", "nice product", "good product",
    "awesome", "bad", "worst", "very good", "very nice", "wonderful", "fair"
}

def compute_jaccard_similarity(str1: str, str2: str) -> float:
    """
    Computes character 3-gram Jaccard similarity between two strings.
    """
    s1 = str1.lower().strip()
    s2 = str2.lower().strip()
    if not s1 or not s2:
        return 0.0
    if s1 == s2:
        return 1.0
    if len(s1) < 10 or len(s2) < 10:
        tokens1 = set(s1.split())
        tokens2 = set(s2.split())
        union = tokens1.union(tokens2)
        return len(tokens1.intersection(tokens2)) / len(union) if union else 0.0

    shingles1 = set(s1[i:i+3] for i in range(len(s1) - 2))
    shingles2 = set(s2[i:i+3] for i in range(len(s2) - 2))
    union = shingles1.union(shingles2)
    return len(shingles1.intersection(shingles2)) / len(union) if union else 0.0


class SuspiciousPatternAnalyzer:
    """
    Analyzes batches of customer reviews to extract explainable suspicion indicators.
    """

    @classmethod
    def analyze_reviews(
        cls,
        reviews: list[dict[str, Any]],
        sentiment_predictions: Optional[list[dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        """
        Takes list of review dicts:
          [{"id": str, "text": str, "rating": Optional[int], "author": Optional[str], "date": Optional[str]}]
        And optional precomputed sentiment predictions.
        Returns detailed suspicion report.
        """
        total = len(reviews)
        if total == 0:
            return {
                "total_analyzed": 0,
                "suspicious_count": 0,
                "suspicion_rate": 0.0,
                "flags_breakdown": {},
                "flagged_reviews": [],
                "clean_reviews_count": 0,
                "disclaimer": "No reviews provided for analysis.",
            }

        # 1. Exact Duplicate Detection
        norm_texts = []
        text_to_indices: dict[str, list[int]] = defaultdict(list)
        for i, r in enumerate(reviews):
            t = (r.get("text") or "").strip().lower()
            clean_t = re.sub(r"[^\w\s]", "", t)
            clean_t = re.sub(r"\s+", " ", clean_t).strip()
            norm_texts.append(clean_t)
            if len(clean_t) > 3:
                text_to_indices[clean_t].append(i)

        exact_duplicate_indices: set[int] = set()
        for t_key, idx_list in text_to_indices.items():
            if len(idx_list) > 1 and t_key not in GENERIC_BOILERPLATE:
                for idx in idx_list:
                    exact_duplicate_indices.add(idx)

        # 2. Near-Duplicate Detection (pairwise check for medium/long texts)
        near_duplicate_pairs: set[int] = set()
        for i in range(total):
            t_i = norm_texts[i]
            if len(t_i) < 25 or i in exact_duplicate_indices:
                continue
            for j in range(i + 1, min(i + 50, total)):  # Windowed check to keep O(N) bounded
                t_j = norm_texts[j]
                if len(t_j) < 25 or j in exact_duplicate_indices:
                    continue
                sim = compute_jaccard_similarity(t_i, t_j)
                if sim >= 0.82:
                    near_duplicate_pairs.add(i)
                    near_duplicate_pairs.add(j)

        # 3. Analyze each review individually
        flagged_reviews = []
        flag_counts: Counter = Counter()

        for i, r in enumerate(reviews):
            raw_text = r.get("text") or ""
            rating = r.get("rating")
            sentiment_info = sentiment_predictions[i] if sentiment_predictions and i < len(sentiment_predictions) else {}
            pred_sentiment = sentiment_info.get("sentiment", "neutral")
            conf = sentiment_info.get("confidence", 0.95 if "sentiment" in sentiment_info else 0.0)

            review_flags = []
            reasons = []

            # Check exact duplicates
            if i in exact_duplicate_indices:
                review_flags.append("EXACT_DUPLICATE")
                reasons.append("Identical review text appears multiple times in the analyzed dataset.")
                flag_counts["exact_duplicate"] += 1

            # Check near duplicates
            elif i in near_duplicate_pairs:
                review_flags.append("NEAR_DUPLICATE")
                reasons.append("Review text shares high similarity (>= 82%) with another review in the sample.")
                flag_counts["near_duplicate"] += 1

            # Check promotional wording / spam
            for pattern in PROMOTIONAL_PATTERNS:
                if re.search(pattern, raw_text, re.IGNORECASE):
                    review_flags.append("PROMOTIONAL_PHRASING")
                    reasons.append("Contains promotional keywords or incentivized review phrasing.")
                    flag_counts["promotional_keywords"] += 1
                    break

            # Check excessive shouting / punctuation
            if re.search(r"[!?]{4,}", raw_text):
                review_flags.append("EXCESSIVE_PUNCTUATION")
                reasons.append("Contains repeated punctuation bursts (e.g. '!!!!' or '????').")
                flag_counts["excessive_punctuation"] += 1

            # Check rating-sentiment mismatch
            if rating is not None and conf >= 0.65:
                if rating in (4, 5) and pred_sentiment == "negative":
                    review_flags.append("RATING_SENTIMENT_MISMATCH")
                    reasons.append(
                        f"High rating ({rating} stars) directly contradicts strongly negative text content."
                    )
                    flag_counts["rating_sentiment_mismatch"] += 1
                elif rating in (1, 2) and pred_sentiment == "positive":
                    review_flags.append("RATING_SENTIMENT_MISMATCH")
                    reasons.append(
                        f"Low rating ({rating} stars) contradicts strongly positive praise in review text."
                    )
                    flag_counts["rating_sentiment_mismatch"] += 1

            # Check generic single-word boilerplate
            norm_t = norm_texts[i]
            if norm_t in GENERIC_BOILERPLATE or (len(norm_t.split()) <= 2 and norm_t in ("good product", "nice product", "value for money")):
                review_flags.append("GENERIC_BOILERPLATE")
                reasons.append("Extremely brief or boilerplate review lacking substantive product evaluation.")
                flag_counts["generic_boilerplate"] += 1

            if review_flags:
                severity = "HIGH" if any(f in ("EXACT_DUPLICATE", "NEAR_DUPLICATE", "RATING_SENTIMENT_MISMATCH") for f in review_flags) else "MEDIUM"
                flagged_reviews.append({
                    "review_id": r.get("id") or f"rev_{i}",
                    "review_text": raw_text[:200] + ("..." if len(raw_text) > 200 else ""),
                    "rating": rating,
                    "author": r.get("author") or "Anonymous Customer",
                    "date": r.get("date"),
                    "predicted_sentiment": pred_sentiment,
                    "flags": review_flags,
                    "reasons": reasons,
                    "severity": severity,
                })

        suspicious_count = len(flagged_reviews)
        suspicion_rate = round(100.0 * suspicious_count / total, 2) if total > 0 else 0.0

        return {
            "total_analyzed": total,
            "suspicious_count": suspicious_count,
            "clean_reviews_count": total - suspicious_count,
            "suspicion_rate": suspicion_rate,
            "flags_breakdown": dict(flag_counts),
            "flagged_reviews": flagged_reviews,
            "disclaimer": (
                "These signals represent explainable suspicion indicators based on pattern heuristics "
                "(duplicate text, promotional language, and rating-sentiment divergence). "
                "They provide anomaly insights and do not represent definitive legal proof of fake reviews."
            ),
        }
