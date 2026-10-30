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
            r"\bbuild(?:\s*quality)?\b", r"\bmaterial(?:s)?\b", r"\bplastic\b", r"\bmetal\b",
            r"\bfinish\b", r"\bsturdy\b", r"\bfragile\b", r"\bbody\b", r"\bpremium\b",
            r"\blook and feel\b", r"\bdesign\b", r"\bchunky\b", r"\bbulky\b"
        ],
    },
    "durability": {
        "display_name": "Durability & Longevity",
        "category": "product",
        "keywords": [
            r"\bdurab(?:le|ility)\b", r"\blasted\b", r"(?<!battery\s)(?<!shelf\s)\blongevity\b",
            r"(?<!battery\s)(?<!shelf\s)\blifespan\b", r"\bproduct life\b",
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
            r"\bworking fine\b", r"\bresponse\b", r"\bheating\b", r"\bcooling\b",
            r"\boperating noise\b", r"\bnoisy\b"
        ],
    },
    "battery_life": {
        "display_name": "Battery Life & Charging",
        "category": "product",
        "keywords": [
            r"\bbattery\b", r"\bbackup\b", r"\bcharg(?:e|ing|er)\b", r"\bdrain(?:ing)?\b",
            r"\bstandby\b", r"\bmah\b", r"\bpower backup\b", r"\bbattery life\b"
        ],
    },
    "comfort": {
        "display_name": "Comfort & Ergonomics",
        "category": "product",
        "keywords": [
            r"\bcomfort(?:able)?\b", r"\bergonom(?:ic)?\b", r"\bfit\b", r"\bgrip\b",
            r"\bpain\b", r"\blightweight\b", r"\beasy to hold\b", r"\bcushion(?:s)?\b",
            r"\bheadband\b", r"\bclamp\b", r"\bwear(?:ing)?\b"
        ],
    },
    "ease_of_use": {
        "display_name": "Ease of Use & Setup",
        "category": "product",
        "keywords": [
            r"\beasy to use\b", r"\bsetup\b", r"\binstall(?:ation)?\b",
            r"\buser friendly\b", r"\bsimple\b", r"\bplug and play\b", r"\bcomplex\b",
            r"\binterface\b", r"\bcontrols\b"
        ],
    },
    "value_for_money": {
        "display_name": "Value for Money & Pricing",
        "category": "product",
        "keywords": [
            r"\bvalue for money\b", r"\bworth\s+(?:the\s+)?(?:money|price|cost|penny|amount|it|buying)\b",
            r"\bbudget\b", r"\bexpensive\b", r"\bcheap\b", r"\bprice\b", r"\bcostly\b",
            r"\baffordable\b", r"\boverpriced\b", r"\bpricing\b"
        ],
    },
    "sound_quality": {
        "display_name": "Sound Quality",
        "category": "product",
        "keywords": [
            r"\bsound(?:\s*quality)?\b", r"\baudio\b", r"\bbass\b", r"\btreble\b",
            r"\bclarity\b", r"\bvolume\b", r"\bspeaker\b", r"\bmic(?:rophone)?\b",
            r"\bnoise cancell(?:ation|ing)?\b", r"\banc\b", r"\bacoustic\b"
        ],
    },
    "display_screen": {
        "display_name": "Display & Screen",
        "category": "product",
        "keywords": [
            r"\bdisplay\b", r"\bscreen\b", r"\bbrightness\b", r"\boled\b",
            r"\bamoled\b", r"\bresolution\b", r"\brefresh rate\b", r"\bviewing angle\b"
        ],
    },
    "camera": {
        "display_name": "Camera Quality",
        "category": "product",
        "keywords": [
            r"\bcamera\b", r"\bphoto(?:s)?\b", r"\bpicture quality\b", r"\bvideo recording\b",
            r"\blens\b", r"\bselfie\b"
        ],
    },
    "fit_sizing": {
        "display_name": "Fit & Sizing",
        "category": "product",
        "keywords": [
            r"\bfit(?:ting|s)?\b", r"\bsiz(?:e|ing|es)\b", r"\btoo tight\b",
            r"\btoo loose\b", r"\btrue to size\b", r"\bwaist\b", r"\bproportions\b"
        ],
    },
    "material_fabric": {
        "display_name": "Fabric & Material Quality",
        "category": "product",
        "keywords": [
            r"\bfabric\b", r"\bcloth\b", r"\bcotton\b", r"\bleather\b",
            r"\btexture\b", r"\bstitching\b", r"\blinen\b", r"\bpolyester\b"
        ],
    },
    "assembly_installation": {
        "display_name": "Assembly & Installation",
        "category": "product",
        "keywords": [
            r"\bassembl(?:y|e|ing|ed)\b", r"\bputting together\b", r"\bmanual instructions\b"
        ],
    },
    "taste_flavor": {
        "display_name": "Taste & Flavor",
        "category": "product",
        "keywords": [
            r"\btaste\b", r"\bflavor\b", r"\bflavour\b", r"\baroma\b",
            r"\bfragrance\b", r"\bscent\b", r"\bdelicious\b"
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
    "amazing", "perfect", "love", "satisfied", "worth", "sturdy", "fast", "durable",
    "crisp", "clear", "extraordinary", "solid", "premium", "reliable", "smooth",
    "comfortable", "responsive", "quiet", "sharp", "flawless", "brilliant", "favourable",
    "lasts", "lasting"
}

NEGATIVE_CUES = {
    "bad", "worst", "poor", "terrible", "horrible", "useless", "waste", "defective",
    "broke", "broken", "slow", "fragile", "disappointed", "pathetic", "fake", "issue",
    "delayed", "torn", "damaged", "pain", "uncomfortable", "muffled", "noisy", "heavy",
    "drain", "draining", "lag", "cheap", "bulky", "stiff", "fail", "failed"
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

            # Split into sentences, then clauses on contrastive conjunctions
            raw_sentences = [s.strip() for s in re.split(r"[.!?\n]+", text) if len(s.strip()) > 4]
            clauses = []
            for s in raw_sentences:
                parts = re.split(r"\b(?:but|however|although|though|while|yet|whereas)\b|;", s, flags=re.IGNORECASE)
                for p in parts:
                    p_clean = p.strip()
                    if len(p_clean) > 3:
                        clauses.append(p_clean)

            for s in clauses:
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

            aspect_summary, sentiment_label = cls._generate_aspect_summary(
                aspect_id=aspect_id,
                display_name=d["display_name"],
                mention_count=cnt,
                pos_cnt=d["positive_mentions"],
                neg_cnt=d["negative_mentions"],
                pos_rate=pos_rate,
                neg_rate=neg_rate,
                pos_excerpts=d["positive_excerpts"],
                neg_excerpts=d["negative_excerpts"],
            )

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
                "summary": aspect_summary,
                "sentiment_label": sentiment_label,
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

    @classmethod
    def generate_aspect_explanation(
        cls,
        aspect_id: str,
        display_name: str,
        sentiment_label: str,
        pos_excerpts: list[str],
        neg_excerpts: list[str],
        mention_count: int = 1,
    ) -> str:
        """
        Generates a concise, natural, professional aspect explanation under 15 words.
        Eliminates repetitive templates and translates crude/informal feedback into neutral consumer findings.
        """
        if mention_count < 2 or sentiment_label in ("Limited Data", "No Data"):
            return "Insufficient review evidence."

        sentiment = sentiment_label.lower()
        key = f"{aspect_id} {display_name}".lower()

        pos_text = " ".join(pos_excerpts).lower()
        neg_text = " ".join(neg_excerpts).lower()
        all_text = f"{pos_text} {neg_text}"

        # Nuance signals without reproducing crude language
        has_slow_charging = bool(re.search(r"slow as hell|slow\s+charg|takes\s+forever|crap\s+charger|slow\s+speed", neg_text))
        has_fast_drain = bool(re.search(r"drain|dies\s+fast|battery\s+dies|poor\s+backup|rapid\s+discharge", neg_text))
        has_bulky_design = bool(re.search(r"bulky|chunky|heavy\s+design|thick|little\s+bit\s+bulky", neg_text))
        has_minor_bulky = bool(re.search(r"little\s+bit\s+bulky|not\s+that\s+bad", neg_text))
        has_early_failure = bool(re.search(r"went\s+bad|two\s+days|stopped\s+working|broke\s+in|broke\s+within|died\s+after|defective|drift", neg_text))
        has_discomfort = bool(re.search(r"crab|uncomfortable|pain|tight|hurts|clamp|fatigue|pressure", neg_text))
        has_noise = bool(re.search(r"noise|noisy|loud|jet\s+engine|airplane|humming", neg_text))
        has_heat = bool(re.search(r"heat|heats|oven|warm|thermal|overheating", neg_text))
        has_weak_bass = bool(re.search(r"bass|muddy|low\s+end|weak\s+bass", neg_text))
        has_mic_issue = bool(re.search(r"mic|microphone|muffled\s+voice|call\s+quality", neg_text))

        # A. VALUE FOR MONEY & PRICING
        if any(w in key for w in ("value", "price", "pricing", "cost", "worth")):
            if sentiment == "positive":
                return "Offers competitive features for its price."
            if sentiment == "negative":
                return "Pricing is widely viewed as high for what is offered."
            return "Feature set is solid, but pricing feels somewhat steep."

        # B. BATTERY LIFE & CHARGING
        if any(w in key for w in ("battery", "charging", "power backup")):
            if sentiment == "positive":
                return "Praised for dependable battery life endurance with long-lasting performance."
            if sentiment == "negative":
                if has_slow_charging:
                    return "Charging is slower than some buyers expect."
                if has_fast_drain:
                    return "Battery drains faster than expected during regular use."
                return "Battery endurance falls noticeably short of expectations."
            # Mixed
            if has_slow_charging:
                return "Battery performance appears acceptable, but charging speed receives criticism."
            if has_fast_drain:
                return "Battery endurance is adequate, though heavy usage requires frequent recharging."
            return "Battery performance appears acceptable, but endurance varies with heavy usage."

        # C. BUILD QUALITY & MATERIALS
        if any(w in key for w in ("build", "material", "finish", "construction", "sturdy")):
            if sentiment == "positive":
                return "Solid construction with quality materials."
            if sentiment == "negative":
                if has_bulky_design and not has_minor_bulky:
                    return "Bulky form factor makes handling cumbersome."
                return "Construction materials feel less robust than expected."
            if has_minor_bulky:
                return "Some buyers find the design bulky, although the concern appears minor."
            if has_bulky_design:
                return "Most feedback is favourable, although some buyers find the design bulky."
            return "Overall construction is satisfactory, though certain components feel less premium."

        # D. COMFORT & ERGONOMICS
        if any(w in key for w in ("comfort", "ergonom", "grip", "cushion")):
            if sentiment == "positive":
                return "Comfortable fit with lightweight ergonomics."
            if sentiment == "negative":
                if has_discomfort:
                    return "Some buyers report discomfort during extended use."
                return "Ergonomics and fit draw complaints during daily use."
            return "Generally comfortable for short periods, but extended wear causes fatigue."

        # E. DURABILITY & LONGEVITY
        if any(w in key for w in ("durab", "longev", "reliability", "lifespan")):
            if sentiment == "positive":
                return "Demonstrates dependable long-term reliability and build integrity."
            if sentiment == "negative":
                if has_early_failure:
                    return "Reports of early product failure raise concerns about long-term reliability."
                return "Frequent complaints regarding premature wear and component failure."
            if has_early_failure:
                return "A buyer reported an early product failure, though most units hold up."
            return "Durability is acceptable for light use, with minor signs of wear reported."

        # F. SOUND QUALITY
        if any(w in key for w in ("sound", "audio", "speaker", "acoustic", "bass")):
            if sentiment == "positive":
                return "Delivers clear audio output with balanced frequencies."
            if sentiment == "negative":
                if has_mic_issue:
                    return "Microphone pickup is muffled and lacks clarity during calls."
                return "Audio output lacks clarity and exhibits noticeable distortion."
            if has_weak_bass:
                return "Clear audio output, but bass quality receives mixed feedback."
            if has_mic_issue:
                return "Clear audio output, though microphone clarity receives mixed feedback."
            return "Audio playback is clear, although tonal balance divides opinion."

        # G. PERFORMANCE & FUNCTIONALITY
        if any(w in key for w in ("perform", "speed", "response", "functionality")):
            if sentiment == "positive":
                return "Smooth and responsive operational performance across tasks."
            if sentiment == "negative":
                if has_noise:
                    return "Excessive operational noise disrupts everyday use."
                if has_heat:
                    return "Excessive heat buildup causes thermal throttling."
                return "Frequent performance lag and sluggish response times."
            if has_noise:
                return "Buyers appreciate its ease of use, but some report excessive operating noise."
            if has_heat:
                return "Performance is generally well received, while battery endurance remains a concern."
            return "Performance is generally well received, with occasional slowdowns noted under load."

        # H. FIT & SIZING
        if any(w in key for w in ("fit", "siz")):
            if sentiment == "positive":
                return "Fits true to size with comfortable proportions."
            if sentiment == "negative":
                return "Sizing is inconsistent and deviates notably from standard measurements."
            return "The fabric receives positive feedback, although sizing appears inconsistent."

        # I. FABRIC & MATERIAL
        if any(w in key for w in ("fabric", "cloth", "cotton", "leather", "texture")):
            if sentiment == "positive":
                return "High-quality fabric with a pleasant tactile feel."
            if sentiment == "negative":
                return "Fabric feels thin and prone to premature wear."
            return "Fabric receives positive feedback, although sizing appears inconsistent."

        # J. ASSEMBLY & INSTALLATION
        if any(w in key for w in ("assembl", "install", "putting together")):
            if sentiment == "positive":
                return "Straightforward assembly with clear and well-organized instructions."
            if sentiment == "negative":
                return "Assembly is challenging due to ambiguous instructions and misaligned parts."
            return "Several buyers praise the finish, but assembly can be difficult."

        # K. DELIVERY & PACKAGING
        if any(w in key for w in ("deliver", "packag", "shipping")):
            if sentiment == "positive":
                return "Prompt delivery with secure protective packaging."
            if sentiment == "negative":
                return "Frequent delivery delays and damaged outer packaging."
            return "Delivered on schedule, though outer packaging showed handling wear."

        # L. EASE OF USE & SETUP
        if any(w in key for w in ("ease", "setup", "simple")):
            if sentiment == "positive":
                return "Intuitive controls with an effortless initial setup."
            if sentiment == "negative":
                return "Complicated setup and unintuitive everyday controls."
            return "Basic operation is simple, but advanced features require a learning curve."

        # M. TASTE & FLAVOR
        if any(w in key for w in ("taste", "flavor", "flavour", "scent", "fragrance")):
            if sentiment == "positive":
                return "Pleasant flavor profile with natural, fresh taste."
            if sentiment == "negative":
                return "Flavor is underwhelming and artificial in taste."
            return "Flavor is pleasant, though sweetness levels divide consumer preferences."

        # N. DISPLAY & SCREEN
        if any(w in key for w in ("display", "screen", "panel")):
            if sentiment == "positive":
                return "Vibrant color reproduction and sharp viewing clarity."
            if sentiment == "negative":
                return "Display lacks brightness and exhibits muted color contrast."
            return "Sharp display indoors, though outdoor brightness is somewhat limited."

        # O. CAMERA QUALITY
        if any(w in key for w in ("camera", "photo", "picture")):
            if sentiment == "positive":
                return "Captures sharp photos with accurate color reproduction."
            if sentiment == "negative":
                return "Camera performance is grainy with sluggish focusing speeds."
            return "Good daylight photography, though low-light shots suffer from noise."

        # P. DYNAMIC CATEGORY FALLBACK
        clean_name = display_name.strip().lower()
        if sentiment == "positive":
            return f"Demonstrates dependable quality and solid {clean_name}."
        if sentiment == "negative":
            return f"Performance regarding {clean_name} falls short of expectations."
        return f"Feedback on {clean_name} is mostly favourable, with minor reservations noted."

    @classmethod
    def _generate_aspect_summary(
        cls,
        aspect_id: str,
        display_name: str,
        mention_count: int,
        pos_cnt: int,
        neg_cnt: int,
        pos_rate: float,
        neg_rate: float,
        pos_excerpts: list[str],
        neg_excerpts: list[str],
    ) -> tuple[str, str]:
        """
        Generates a concise, evidence-based text summary and sentiment label
        for a product aspect strictly from authentic review excerpts and mention statistics.
        Suppresses or qualifies conclusions on very small samples (< 3 mentions).
        """
        if mention_count == 0:
            return "Insufficient review evidence.", "No Data"

        # Suppress or qualify conclusions based on very small samples (< 3 mentions)
        if mention_count < 3:
            label = "Limited Data"
            summary = f"Limited feedback ({mention_count} mention{'s' if mention_count > 1 else ''}): insufficient review evidence."
            return summary, label

        # Sufficient evidence (>= 3 mentions)
        if pos_rate >= 70.0 and neg_rate <= 20.0:
            label = "Positive"
        elif neg_rate >= 45.0 or (pos_rate < 35.0 and neg_cnt > pos_cnt):
            label = "Negative"
        else:
            label = "Mixed"

        summary = cls.generate_aspect_explanation(
            aspect_id=aspect_id,
            display_name=display_name,
            sentiment_label=label,
            pos_excerpts=pos_excerpts,
            neg_excerpts=neg_excerpts,
            mention_count=mention_count,
        )

        return summary, label
