"""
DealSense Data Science Pipeline — aspect_analyzer.py
Extracts recurring product aspects and summarizes pros & cons with authentic review excerpts.
Separates core product experience aspects (Build, Durability, Performance, Battery, Comfort, Ease of Use, Value)
from delivery and seller logistics experience (Packaging, Delivery).
"""

from __future__ import annotations

import re
from typing import Any, Optional

ASPECT_DEFINITIONS = {
    "build_quality": {
        "display_name": "Build Quality & Materials",
        "category": "product",
        "keywords": [
            r"\bbuild(?:\s*quality)?\b", r"\bmaterial\b", r"\bplastic\b", r"\bmetal\b",
            r"\bfinish\b", r"\bsturdy\b", r"\bfragile\b", r"\bbody\b", r"\bpremium\b",
            r"\blook and feel\b", r"\bdesign\b", r"\bweight\b"
        ],
    },
    "durability": {
        "display_name": "Durability & Longevity",
        "category": "product",
        "keywords": [
            r"\bdurab(?:le|ility)\b", r"\blasted\b", r"\blongevity\b", r"\blife\b",
            r"\bstopped working\b", r"\bbroke(?:n)?\b", r"\bdamaged after\b",
            r"\blong lasting\b", r"\bwarranty\b", r"\bdefective\b"
        ],
    },
    "performance": {
        "display_name": "Performance & Functionality",
        "category": "product",
        "keywords": [
            r"\bperform(?:ance)?\b", r"\bspeed\b", r"\bfast\b", r"\bslow\b",
            r"\bsmooth\b", r"\blag(?:gy)?\b", r"\bpower(?:ful)?\b", r"\beffective\b",
            r"\bworking fine\b", r"\bresponse\b", r"\bheating\b", r"\bcooling\b"
        ],
    },
    "battery_life": {
        "display_name": "Battery Life & Charging",
        "category": "product",
        "keywords": [
            r"\bbattery\b", r"\bbackup\b", r"\bcharg(?:e|ing|er)\b", r"\bdrain(?:ing)?\b",
            r"\bstandby\b", r"\bmah\b", r"\bpower backup\b"
        ],
    },
    "comfort": {
        "display_name": "Comfort & Ergonomics",
        "category": "product",
        "keywords": [
            r"\bcomfort(?:able)?\b", r"\bergonom(?:ic)?\b", r"\bfit\b", r"\bgrip\b",
            r"\bpain\b", r"\blightweight\b", r"\bheavy\b", r"\beasy to hold\b"
        ],
    },
    "ease_of_use": {
        "display_name": "Ease of Use & Setup",
        "category": "product",
        "keywords": [
            r"\beasy to use\b", r"\bsetup\b", r"\binstall(?:ation)?\b",
            r"\buser friendly\b", r"\bsimple\b", r"\bplug and play\b", r"\bcomplex\b"
        ],
    },
    "value_for_money": {
        "display_name": "Value for Money & Pricing",
        "category": "product",
        "keywords": [
            r"\bvalue for money\b", r"\bworth\b", r"\bbudget\b", r"\bexpensive\b",
            r"\bcheap\b", r"\bprice\b", r"\bcostly\b", r"\baffordable\b", r"\boverpriced\b"
        ],
    },
    "delivery_packaging": {
        "display_name": "Delivery & Packaging",
        "category": "logistics_seller",
        "keywords": [
            r"\bdelivery\b", r"\bpackag(?:e|ing)\b", r"\bcourier\b", r"\bshipping\b",
            r"\bdelayed\b", r"\bon time\b", r"\bbox\b", r"\bbroken box\b", r"\bflipkart delivery\b", r"\bamazon delivery\b"
        ],
    },
}

POSITIVE_CUES = {
    "good", "great", "excellent", "awesome", "super", "superb", "best", "nice",
    "amazing", "perfect", "love", "satisfied", "worth", "sturdy", "fast", "durable"
}

NEGATIVE_CUES = {
    "bad", "worst", "poor", "terrible", "horrible", "useless", "waste", "defective",
    "broke", "broken", "slow", "fragile", "disappointed", "pathetic", "fake", "issue"
}

class AspectAnalyzer:
    """
    Analyzes customer reviews to identify recurring topics, aspect sentiment scores,
    and concrete supporting excerpts.
    """

    @classmethod
    def analyze_aspects(cls, reviews: list[dict[str, Any]]) -> dict[str, Any]:
        """
        Takes list of reviews and returns:
          - aspects_summary: list of aspect objects with category, mention count, positive/negative rates, quotes
          - pros: top positive findings with excerpts
          - cons: top negative findings with excerpts
        """
        aspect_data = {
            k: {
                "aspect_id": k,
                "display_name": meta["display_name"],
                "category": meta["category"],
                "mention_count": 0,
                "positive_mentions": 0,
                "negative_mentions": 0,
                "positive_excerpts": [],
                "negative_excerpts": [],
            }
            for k, meta in ASPECT_DEFINITIONS.items()
        }

        for r in reviews:
            text = (r.get("text") or "").strip()
            if not text:
                continue

            # Split into sentences
            sentences = [s.strip() for s in re.split(r"[.!?\n]+", text) if len(s.strip()) > 5]

            for s in sentences:
                s_lower = s.lower()
                s_tokens = set(re.findall(r"\b\w+\b", s_lower))

                is_pos = bool(s_tokens.intersection(POSITIVE_CUES))
                is_neg = bool(s_tokens.intersection(NEGATIVE_CUES))

                for aspect_id, meta in ASPECT_DEFINITIONS.items():
                    matched = False
                    for pat in meta["keywords"]:
                        if re.search(pat, s_lower):
                            matched = True
                            break

                    if matched:
                        data = aspect_data[aspect_id]
                        data["mention_count"] += 1

                        clean_excerpt = s[:120].strip()
                        if is_pos and not is_neg:
                            data["positive_mentions"] += 1
                            if len(data["positive_excerpts"]) < 3 and clean_excerpt not in data["positive_excerpts"]:
                                data["positive_excerpts"].append(clean_excerpt)
                        elif is_neg and not is_pos:
                            data["negative_mentions"] += 1
                            if len(data["negative_excerpts"]) < 3 and clean_excerpt not in data["negative_excerpts"]:
                                data["negative_excerpts"].append(clean_excerpt)
                        else:
                            # Contextual fallback based on overall rating if available
                            rating = r.get("rating")
                            if rating and rating >= 4:
                                data["positive_mentions"] += 1
                                if len(data["positive_excerpts"]) < 3 and clean_excerpt not in data["positive_excerpts"]:
                                    data["positive_excerpts"].append(clean_excerpt)
                            elif rating and rating <= 2:
                                data["negative_mentions"] += 1
                                if len(data["negative_excerpts"]) < 3 and clean_excerpt not in data["negative_excerpts"]:
                                    data["negative_excerpts"].append(clean_excerpt)

        # Build aspect list
        results = []
        for aspect_id, d in aspect_data.items():
            cnt = d["mention_count"]
            if cnt > 0:
                pos_rate = round(100.0 * d["positive_mentions"] / cnt, 1)
                neg_rate = round(100.0 * d["negative_mentions"] / cnt, 1)
            else:
                pos_rate = 0.0
                neg_rate = 0.0

            results.append({
                "aspect_id": aspect_id,
                "display_name": d["display_name"],
                "category": d["category"],
                "mention_count": cnt,
                "positive_mentions": d["positive_mentions"],
                "negative_mentions": d["negative_mentions"],
                "positive_percentage": pos_rate,
                "negative_percentage": neg_rate,
                "positive_excerpts": d["positive_excerpts"],
                "negative_excerpts": d["negative_excerpts"],
            })

        # Sort aspects by frequency
        results.sort(key=lambda x: x["mention_count"], reverse=True)

        # Synthesize top Pros and Cons from actual review evidence
        pros = []
        cons = []

        for a in results:
            if a["category"] == "product" and a["positive_percentage"] >= 60 and a["positive_excerpts"]:
                pros.append({
                    "aspect": a["display_name"],
                    "summary": f"High customer satisfaction on {a['display_name'].lower()} ({a['positive_percentage']}% positive).",
                    "sample_quote": a["positive_excerpts"][0],
                })
            elif a["category"] == "product" and a["negative_percentage"] >= 35 and a["negative_excerpts"]:
                cons.append({
                    "aspect": a["display_name"],
                    "summary": f"Frequent customer complaints regarding {a['display_name'].lower()} ({a['negative_percentage']}% negative).",
                    "sample_quote": a["negative_excerpts"][0],
                })

        # Logistics separately
        delivery_aspect = next((a for a in results if a["aspect_id"] == "delivery_packaging"), None)

        return {
            "aspects": results,
            "product_aspects": [a for a in results if a["category"] == "product"],
            "logistics_aspects": [a for a in results if a["category"] == "logistics_seller"],
            "pros": pros[:4],
            "cons": cons[:4],
            "delivery_summary": {
                "mentions": delivery_aspect["mention_count"] if delivery_aspect else 0,
                "positive_percentage": delivery_aspect["positive_percentage"] if delivery_aspect else 0.0,
                "sample_quote": (delivery_aspect["positive_excerpts"] or delivery_aspect["negative_excerpts"] or ["No delivery quotes"])[0] if delivery_aspect and (delivery_aspect["positive_excerpts"] or delivery_aspect["negative_excerpts"]) else None,
            }
        }
