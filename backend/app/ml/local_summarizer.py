"""
DealSense Data Science Pipeline — local_summarizer.py
Local Extractive Review Summarization & Thematic Mining.

Features:
- 100% offline extractive summarization (zero external API keys or remote LLMs required)
- Sentiment separation (positive, neutral, negative)
- Information density & TF-IDF sentence ranking
- Aspect-guided thematic grouping (build quality, performance, battery, comfort, value, logistics)
- Genuine review excerpt quotation (zero hallucination / zero fabrication)
- Transparent sample-size caveat handling for sparse reviews (< 3 reviews)
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Dict, List, Optional, Set, Tuple

from app.ml.aspect_analyzer import ASPECT_DEFINITIONS, POSITIVE_CUES, NEGATIVE_CUES

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False


# Enhanced sentiment cues for review text mining
LOCAL_POSITIVE_CUES = set(POSITIVE_CUES).union({
    "smooth", "crisp", "clear", "responsive", "comfortable", "sturdy", "reliable",
    "solid", "premium", "lightweight", "ergonomic", "quiet", "sharp", "fast",
    "durable", "worth", "satisfied", "satisfaction", "flawless", "superb", "brilliant"
})

LOCAL_NEGATIVE_CUES = set(NEGATIVE_CUES).union({
    "stiff", "fatigue", "pain", "heavy", "heating", "heats", "drain", "drains",
    "draining", "lag", "laggy", "loose", "hard", "difficult", "cheap", "noisy",
    "scratch", "problem", "complaint", "flaw", "flaws", "rough", "uncomfortable",
    "poor", "broke", "broken", "defective", "waste", "horrible", "terrible", "worst"
})


class LocalReviewSummarizer:
    """
    Local extractive summarizer that mines genuine customer review feedback,
    extracts key pros and cons with authentic quotes, identifies recurring complaints,
    and constructs a factually grounded executive review synthesis.
    """

    @classmethod
    def summarize_reviews(
        cls,
        product_name: str,
        reviews: List[Dict[str, Any]],
        sentiment_preds: Optional[List[Dict[str, Any]]] = None,
        aspects_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Synthesizes customer review feedback locally.
        Returns a dictionary compatible with LLMReviewSummaryResponse.
        """
        # Filter valid review items with non-empty text
        valid_reviews: List[Dict[str, Any]] = []
        for i, r in enumerate(reviews):
            text = (r.get("text") or "").strip()
            if text:
                valid_reviews.append({
                    "index": i,
                    "text": text,
                    "rating": r.get("rating"),
                    "title": r.get("title"),
                    "author": r.get("author") or "Customer",
                    "sentiment_pred": sentiment_preds[i] if (sentiment_preds and i < len(sentiment_preds)) else None,
                })

        total_reviews = len(valid_reviews)

        # 1. Empty review handling
        if total_reviews == 0:
            return {
                "status": "no_data",
                "available": False,
                "provider": "local",
                "summary": "No customer reviews available to analyze.",
                "recurring_complaints": [],
                "common_positive_themes": [],
                "pros": [],
                "cons": [],
                "investigation_patterns": [],
                "total_reviews_analyzed": 0,
                "error": "NO_REVIEWS",
            }

        # 2. Extract and classify sentences across all reviews
        extracted_sentences: List[Dict[str, Any]] = []
        review_sentiments: List[str] = []

        for r_item in valid_reviews:
            r_text = r_item["text"]
            r_rating = r_item["rating"]
            r_pred = r_item["sentiment_pred"]

            # Determine review-level sentiment based on customer rating and Model A prediction
            if r_rating is not None and r_rating <= 2:
                r_sentiment = "negative"
            elif r_rating is not None and r_rating >= 4:
                r_sentiment = "positive"
            elif r_pred and r_pred.get("sentiment") in ("positive", "neutral", "negative"):
                r_sentiment = r_pred["sentiment"]
            else:
                r_sentiment = "neutral"
            review_sentiments.append(r_sentiment)

            # Tokenize into sentences
            raw_sents = cls._split_into_sentences(r_text)
            for s in raw_sents:
                clean_s = cls._clean_sentence(s)
                if not clean_s or len(clean_s) < 10 or len(clean_s.split()) < 3:
                    continue

                sent_polarity = cls._classify_sentence_polarity(clean_s, r_sentiment, r_rating)
                aspect_ids = cls._detect_aspects(clean_s)

                extracted_sentences.append({
                    "text": clean_s,
                    "polarity": sent_polarity,
                    "aspect_ids": aspect_ids,
                    "review_index": r_item["index"],
                    "rating": r_rating,
                    "score": 0.0,
                })

        # Calculate sentiment distribution
        pos_rev_count = sum(1 for s in review_sentiments if s == "positive")
        neg_rev_count = sum(1 for s in review_sentiments if s == "negative")
        neu_rev_count = total_reviews - pos_rev_count - neg_rev_count

        pos_pct = round(100.0 * pos_rev_count / total_reviews, 1)
        neg_pct = round(100.0 * neg_rev_count / total_reviews, 1)
        neu_pct = round(100.0 * neu_rev_count / total_reviews, 1)

        # 3. Score sentences for informativeness and representativeness
        cls._score_sentences(extracted_sentences)

        # 4. Small collection handling (1 to 2 reviews)
        if total_reviews < 3:
            return cls._synthesize_small_sample(
                product_name=product_name,
                total_reviews=total_reviews,
                extracted_sentences=extracted_sentences,
                review_sentiments=review_sentiments,
            )

        # 5. Standard extractive synthesis (3 or more reviews)
        return cls._synthesize_standard_sample(
            product_name=product_name,
            total_reviews=total_reviews,
            pos_pct=pos_pct,
            neg_pct=neg_pct,
            neu_pct=neu_pct,
            extracted_sentences=extracted_sentences,
            valid_reviews=valid_reviews,
        )

    @classmethod
    def _split_into_sentences(cls, text: str) -> List[str]:
        """Split text on sentence boundaries and bullet points."""
        chunks = re.split(r'(?:[\.\!\?;\n\r\t]+|•|\- |\* )', text)
        return [c.strip() for c in chunks if c.strip()]

    @classmethod
    def _clean_sentence(cls, s: str) -> str:
        """Strip enclosing quotes, excess whitespace, and markdown noise."""
        cleaned = re.sub(r'[\s\xa0]+', ' ', s).strip()
        cleaned = cleaned.strip("\"'‘“’”`~*()[]{}")
        # Strip URL references
        if re.search(r'https?://\S+|www\.\S+', cleaned):
            cleaned = re.sub(r'https?://\S+|www\.\S+', '', cleaned).strip()
        return cleaned

    @classmethod
    def _classify_sentence_polarity(
        cls,
        sentence: str,
        review_sentiment: str,
        review_rating: Optional[int]
    ) -> str:
        """
        Determines the sentence-level sentiment polarity using aspect sentiment cues
        with fallback to the parent review rating and Model A prediction.
        """
        words = set(re.findall(r"\b[a-zA-Z]{3,}\b", sentence.lower()))
        pos_matches = words.intersection(LOCAL_POSITIVE_CUES)
        neg_matches = words.intersection(LOCAL_NEGATIVE_CUES)

        if len(pos_matches) > len(neg_matches):
            return "positive"
        elif len(neg_matches) > len(pos_matches):
            return "negative"
        elif len(pos_matches) > 0 and len(neg_matches) > 0:
            # Mixed cues: rely on parent review sentiment or rating
            if review_rating is not None:
                if review_rating <= 2:
                    return "negative"
                elif review_rating >= 4:
                    return "positive"
            return review_sentiment

        # Default to parent review rating/sentiment
        if review_rating is not None:
            if review_rating <= 2:
                return "negative"
            elif review_rating >= 4:
                return "positive"
        return review_sentiment

    @classmethod
    def _detect_aspects(cls, sentence: str) -> List[str]:
        """Identifies which product aspects are mentioned in a sentence."""
        s_lower = sentence.lower()
        matched = []
        for aspect_id, meta in ASPECT_DEFINITIONS.items():
            for pat in meta["keywords"]:
                if re.search(pat, s_lower):
                    matched.append(aspect_id)
                    break
        return matched

    @classmethod
    def _score_sentences(cls, sentences: List[Dict[str, Any]]) -> None:
        """
        Ranks sentences by information density, TF-IDF weights, aspect relevance,
        and optimal excerpt length (35-130 characters).
        """
        if not sentences:
            return

        texts = [s["text"] for s in sentences]

        tfidf_scores = [1.0] * len(sentences)
        if HAS_SKLEARN and len(texts) >= 2:
            try:
                vectorizer = TfidfVectorizer(
                    stop_words="english",
                    ngram_range=(1, 2),
                    max_features=500,
                    token_pattern=r"\b[a-zA-Z]{3,}\b"
                )
                matrix = vectorizer.fit_transform(texts)
                weights = matrix.sum(axis=1)
                tfidf_scores = [float(weights[i, 0]) for i in range(len(texts))]
            except Exception:
                tfidf_scores = [float(len(t.split())) for t in texts]
        else:
            tfidf_scores = [float(len(t.split())) for t in texts]

        for i, s in enumerate(sentences):
            raw_score = tfidf_scores[i]
            length = len(s["text"])

            # Optimal length bonus (punchy, readable quote)
            if 35 <= length <= 130:
                len_multiplier = 1.3
            elif length < 25:
                len_multiplier = 0.6
            elif length > 180:
                len_multiplier = 0.8
            else:
                len_multiplier = 1.0

            # Aspect bonus (mentions core feature like battery, build, performance)
            aspect_multiplier = 1.25 if s["aspect_ids"] else 1.0

            s["score"] = round(raw_score * len_multiplier * aspect_multiplier, 3)

    @classmethod
    def _truncate_excerpt(cls, text: str, max_len: int = 120) -> str:
        """Truncates excerpt cleanly without breaking words."""
        if len(text) <= max_len:
            return text
        truncated = text[:max_len].rsplit(" ", 1)[0].strip()
        return f"{truncated}..."

    @classmethod
    def _synthesize_small_sample(
        cls,
        product_name: str,
        total_reviews: int,
        extracted_sentences: List[Dict[str, Any]],
        review_sentiments: List[str],
    ) -> Dict[str, Any]:
        """Handles sparse review collections (< 3 reviews) with honest caveats."""
        pos_sents = [s for s in extracted_sentences if s["polarity"] == "positive"]
        neg_sents = [s for s in extracted_sentences if s["polarity"] == "negative"]

        pos_sents.sort(key=lambda x: x["score"], reverse=True)
        neg_sents.sort(key=lambda x: x["score"], reverse=True)

        best_pos = cls._truncate_excerpt(pos_sents[0]["text"]) if pos_sents else None
        best_neg = cls._truncate_excerpt(neg_sents[0]["text"]) if neg_sents else None

        # Build concise objective summary with explicit sample size caveat
        if total_reviews == 1:
            base_caveat = "Analysis based on only 1 visible customer review, which is insufficient to establish statistical consensus."
        else:
            base_caveat = f"Analysis based on only {total_reviews} visible customer reviews, which is too few to establish reliable consensus."

        if best_pos and best_neg:
            summary = f"{base_caveat} Customer feedback highlights \"{best_pos}\", but also reports \"{best_neg}\"."
        elif best_pos:
            summary = f"{base_caveat} Customer feedback highlights: \"{best_pos}\"."
        elif best_neg:
            summary = f"{base_caveat} Customer feedback reports: \"{best_neg}\"."
        elif extracted_sentences:
            best_any = cls._truncate_excerpt(extracted_sentences[0]["text"])
            summary = f"{base_caveat} Customer feedback notes: \"{best_any}\"."
        else:
            summary = f"{base_caveat} No clear descriptive sentences could be extracted."

        pros = [f"Observed positive feedback: \"{best_pos}\""] if best_pos else []
        cons = [f"Reported issue: \"{best_neg}\""] if best_neg else []
        common_pos = [f"Observed highlight: \"{best_pos}\""] if best_pos else []
        complaints = [f"Reported issue: \"{best_neg}\""] if best_neg else []

        patterns = [
            f"Small sample size ({total_reviews} review{'s' if total_reviews > 1 else ''} extracted) — statistical reliability is limited."
        ]

        return {
            "status": "success",
            "available": True,
            "provider": "local",
            "summary": summary,
            "recurring_complaints": complaints,
            "common_positive_themes": common_pos,
            "pros": pros,
            "cons": cons,
            "investigation_patterns": patterns,
            "total_reviews_analyzed": total_reviews,
            "error": None,
        }

    @classmethod
    def _synthesize_standard_sample(
        cls,
        product_name: str,
        total_reviews: int,
        pos_pct: float,
        neg_pct: float,
        neu_pct: float,
        extracted_sentences: List[Dict[str, Any]],
        valid_reviews: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Synthesizes reviews for 3 or more reviews using extractive NLP."""
        # Separate positive and negative sentences
        pos_sents = [s for s in extracted_sentences if s["polarity"] == "positive"]
        neg_sents = [s for s in extracted_sentences if s["polarity"] == "negative"]

        pos_sents.sort(key=lambda x: x["score"], reverse=True)
        neg_sents.sort(key=lambda x: x["score"], reverse=True)

        # 1. Overall Consensus Sentence
        short_name = product_name[:40].strip()
        if pos_pct >= 75:
            consensus_str = f"Customer reception across {total_reviews} analyzed reviews is overwhelmingly positive ({pos_pct}% positive)."
        elif neg_pct >= 65:
            consensus_str = f"Customer feedback across {total_reviews} analyzed reviews reflects substantial dissatisfaction ({neg_pct}% negative vs {pos_pct}% positive)."
        elif abs(pos_pct - neg_pct) <= 25:
            consensus_str = f"Customer reception across {total_reviews} analyzed reviews is divided with mixed opinions ({pos_pct}% positive vs {neg_pct}% negative)."
        elif pos_pct >= 55:
            consensus_str = f"Customer reception across {total_reviews} analyzed reviews is largely favorable ({pos_pct}% positive), with occasional negative remarks ({neg_pct}% negative)."
        elif neg_pct >= 50:
            consensus_str = f"Customer feedback across {total_reviews} analyzed reviews reflects substantial dissatisfaction ({neg_pct}% negative vs {pos_pct}% positive)."
        else:
            consensus_str = f"Customer reception across {total_reviews} analyzed reviews is moderately positive ({pos_pct}% positive, {neu_pct}% neutral)."

        # 2. Key Positive & Negative Excerpts for Summary
        summary_parts = [consensus_str]
        top_pos_quote = None
        top_neg_quote = None

        if pos_sents:
            top_pos_quote = cls._truncate_excerpt(pos_sents[0]["text"])
            summary_parts.append(f"Customers frequently praise: \"{top_pos_quote}\".")
        else:
            summary_parts.append("No strong positive commendations were identified in the analyzed sample.")

        if neg_sents:
            top_neg_quote = cls._truncate_excerpt(neg_sents[0]["text"])
            summary_parts.append(f"Reported concerns include: \"{top_neg_quote}\".")
        else:
            summary_parts.append("No recurring critical defects or negative complaints were reported.")

        overall_summary = " ".join(summary_parts)

        # 3. Group sentences by aspect
        aspect_pos: Dict[str, List[Dict[str, Any]]] = {}
        aspect_neg: Dict[str, List[Dict[str, Any]]] = {}

        for s in pos_sents:
            for asp in s["aspect_ids"]:
                aspect_pos.setdefault(asp, []).append(s)

        for s in neg_sents:
            for asp in s["aspect_ids"]:
                aspect_neg.setdefault(asp, []).append(s)

        # 4. Formulate Pros & Common Positive Themes
        pros: List[str] = []
        positive_themes: List[str] = []
        seen_pro_texts: Set[str] = set()

        for asp_id, s_list in sorted(aspect_pos.items(), key=lambda kv: len(kv[1]), reverse=True):
            display_name = ASPECT_DEFINITIONS.get(asp_id, {}).get("display_name", asp_id.replace("_", " ").title())
            best_s = s_list[0]
            clean_q = cls._truncate_excerpt(best_s["text"])
            if clean_q.lower() not in seen_pro_texts:
                seen_pro_texts.add(clean_q.lower())
                pros.append(f"{display_name}: \"{clean_q}\"")
                count_str = f" ({len(s_list)} mentions)" if len(s_list) > 1 else ""
                positive_themes.append(f"{display_name}{count_str}: \"{clean_q}\"")
            if len(pros) >= 4:
                break

        # Fallback pros if aspect matching yielded fewer than 2
        if len(pros) < 2 and pos_sents:
            for s in pos_sents:
                clean_q = cls._truncate_excerpt(s["text"])
                if clean_q.lower() not in seen_pro_texts:
                    seen_pro_texts.add(clean_q.lower())
                    pros.append(f"Positive Highlight: \"{clean_q}\"")
                    positive_themes.append(f"Customer Praise: \"{clean_q}\"")
                if len(pros) >= 3:
                    break

        # 5. Formulate Cons & Recurring Complaints
        cons: List[str] = []
        recurring_complaints: List[str] = []
        seen_con_texts: Set[str] = set()

        for asp_id, s_list in sorted(aspect_neg.items(), key=lambda kv: len(kv[1]), reverse=True):
            display_name = ASPECT_DEFINITIONS.get(asp_id, {}).get("display_name", asp_id.replace("_", " ").title())
            best_s = s_list[0]
            clean_q = cls._truncate_excerpt(best_s["text"])
            if clean_q.lower() not in seen_con_texts:
                seen_con_texts.add(clean_q.lower())
                cons.append(f"{display_name}: \"{clean_q}\"")
                count_str = f" ({len(s_list)} mentions)" if len(s_list) > 1 else ""
                recurring_complaints.append(f"{display_name}{count_str}: \"{clean_q}\"")
            if len(cons) >= 4:
                break

        # Fallback cons if aspect matching yielded fewer than 2
        if len(cons) < 2 and neg_sents:
            for s in neg_sents:
                clean_q = cls._truncate_excerpt(s["text"])
                if clean_q.lower() not in seen_con_texts:
                    seen_con_texts.add(clean_q.lower())
                    cons.append(f"Reported Concern: \"{clean_q}\"")
                    recurring_complaints.append(f"Reported Issue: \"{clean_q}\"")
                if len(cons) >= 3:
                    break

        # 6. Investigation Patterns (Heuristic Signals)
        patterns: List[str] = []

        # Check for duplicated sentences across reviews
        sent_counts = Counter(s["text"].lower() for s in extracted_sentences if len(s["text"]) >= 20)
        duplicates = [text for text, cnt in sent_counts.items() if cnt > 1]
        if duplicates:
            patterns.append(f"Detected {len(duplicates)} identical repeated sentence(s) across different review submissions.")

        # Check for extreme bimodal polarization
        ratings = [r["rating"] for r in valid_reviews if r.get("rating") is not None]
        if len(ratings) >= 4:
            five_star = sum(1 for rt in ratings if rt == 5)
            one_star = sum(1 for rt in ratings if rt == 1)
            mid_star = sum(1 for rt in ratings if 2 <= rt <= 4)
            if mid_star == 0 and five_star >= 2 and one_star >= 2:
                patterns.append("Bimodal review polarization detected: ratings consist exclusively of 5-star praise and 1-star complaints with zero neutral evaluations.")

        # Check for high proportion of very short generic reviews
        short_revs = [r for r in valid_reviews if len(r["text"]) < 20]
        if len(short_revs) >= 3 and (len(short_revs) / total_reviews) >= 0.5:
            patterns.append(f"High concentration of short/terse reviews ({len(short_revs)} of {total_reviews} under 20 characters).")

        return {
            "status": "success",
            "available": True,
            "provider": "local",
            "summary": overall_summary,
            "recurring_complaints": recurring_complaints,
            "common_positive_themes": positive_themes,
            "pros": pros,
            "cons": cons,
            "investigation_patterns": patterns,
            "total_reviews_analyzed": total_reviews,
            "error": None,
        }
