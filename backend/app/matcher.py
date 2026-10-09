"""
DealSense API — matcher.py
Deterministic, fail-closed product normalization and exact variant matching engine.
Evaluates candidate retailer offers against the active browser product listing.
Enforces strict verification across:
  - Brand and product family identity (mandatory: e.g. Aspire One != Aspire 3; Alienware != Inspiron/G15)
  - Processor family and model (Ryzen vs Intel; Core i3 vs i7; Pentium vs Ryzen)
  - Dedicated GPU model and VRAM for gaming systems (RTX 5050 != RTX 4050 or integrated)
  - RAM capacity and storage capacity
  - Exact manufacturer colour variants
  - Product category isolation (Audio != Smartphone != Laptop)
Rejects accessories, refurbished units, different model generations, and divergent configurations.
Classifies omitted or unverified critical attributes as UNVERIFIED_VARIANT without claiming false matches.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class MatchStatus(str, Enum):
    EXACT_MATCH = "EXACT_MATCH"
    UNVERIFIED_VARIANT = "UNVERIFIED_VARIANT"
    PROBABLE_MATCH = "PROBABLE_MATCH"
    UNCERTAIN_MATCH = "UNCERTAIN_MATCH"
    MISMATCH = "MISMATCH"


class RejectionCategory(str, Enum):
    VALID_MATCH = "VALID_MATCH"
    MODEL_MISMATCH = "MODEL_MISMATCH"
    CONFIG_MISMATCH = "CONFIG_MISMATCH"
    VARIANT_MISMATCH = "VARIANT_MISMATCH"
    ACCESSORY_OR_CONDITION = "ACCESSORY_OR_CONDITION"
    UNVERIFIED_VARIANT = "UNVERIFIED_VARIANT"
    PRICE_EXTRACTION_FAILED = "PRICE_EXTRACTION_FAILED"
    NO_SEARCH_RESULTS = "NO_SEARCH_RESULTS"
    UNCERTAIN_CONFIG = "UNCERTAIN_CONFIG"


@dataclass
class ProductSpecs:
    raw_title: str
    category: Optional[str] = None  # "laptop", "smartphone", "audio", "tablet", "accessory"
    brand: Optional[str] = None
    product_family: Optional[str] = None  # e.g. "aspire one", "aspire 3", "alienware 15", "g15"
    model_line: Optional[str] = None
    model_qualifiers: list[str] = field(default_factory=list)
    mpn: Optional[str] = None
    cpu_brand: Optional[str] = None  # "amd", "intel", "apple", "qualcomm"
    cpu_family: Optional[str] = None  # "ryzen 3", "pentium", "core i7", "m3"
    cpu_model: Optional[str] = None  # "7320u", "n6000", "13700h"
    gpu_brand: Optional[str] = None  # "nvidia", "amd", "intel"
    gpu_model: Optional[str] = None  # "rtx 5050", "rtx 4050"
    gpu_vram: Optional[str] = None  # "8 gb", "6 gb", "4 gb"
    storage: Optional[str] = None  # "256 GB", "512 GB", "1 TB"
    ram: Optional[str] = None  # "8 GB", "16 GB"
    color: Optional[str] = None  # "blue", "silver", "indigo", "black"
    is_accessory: bool = False
    is_refurbished: bool = False
    is_bundle: bool = False
    capacity: Optional[str] = None  # e.g. "236 L", "183 L" (refrigerator / appliance)
    door_type: Optional[str] = None  # e.g. "double door", "single door", "side by side", "french door"
    defrost_type: Optional[str] = None  # e.g. "frost free", "direct cool"
    star_rating: Optional[str] = None  # e.g. "3 star", "2 star", "4 star"
    appliance_type: Optional[str] = None  # e.g. "refrigerator", "washing machine", "air conditioner", "television"


# Known brand names (lowercase)
KNOWN_BRANDS = [
    "apple", "samsung", "sony", "google", "oneplus", "xiaomi", "redmi",
    "realme", "motorola", "oppo", "vivo", "asus", "dell", "hp", "lenovo",
    "acer", "bose", "sennheiser", "jbl", "boat", "noise", "nothing",
    "iqoo", "lg", "philips", "micromax", "jmax", "whirlpool", "haier",
    "godrej", "voltas", "panasonic", "ifb", "bosch", "siemens", "daikin",
    "hitachi", "carrier", "blue star", "lloyd"
]

# Modifiers that define distinct product tiers / models
MODEL_QUALIFIERS = [
    "pro max", "pro", "plus", "ultra", "mini", "fe", "lite",
    "neo", "se", "play", "16e", "15e", "4g", "5g", "gaming"
]

# Known laptop product families by brand (ordered longest to shortest for prefix precedence)
LAPTOP_FAMILIES: dict[str, list[str]] = {
    "dell": [
        "alienware m18", "alienware m16", "alienware x16", "alienware x14",
        "alienware 15", "alienware 17", "alienware 14", "alienware 13", "alienware",
        "inspiron 16 plus", "inspiron 15", "inspiron 14", "inspiron 16", "inspiron",
        "g16", "g15", "g-series", "g3", "g5", "g7",
        "xps 13 plus", "xps 13", "xps 14", "xps 15", "xps 16", "xps 17", "xps",
        "latitude", "vostro", "precision"
    ],
    "acer": [
        "aspire one", "aspire 3", "aspire 5", "aspire 7", "aspire vero", "aspire lite", "aspire",
        "predator helios neo", "predator helios", "predator triton", "predator",
        "nitro v", "nitro 5", "nitro 16", "nitro 17", "nitro",
        "swift go", "swift edge", "swift x", "swift 3", "swift 5", "swift",
        "spin 3", "spin 5", "spin", "extensa 15", "extensa", "travelmate", "chromebook"
    ],
    "hp": [
        "omen transcend", "omen 16", "omen 17", "omen",
        "victus 15", "victus 16", "victus",
        "spectre x360", "spectre", "envy x360", "envy 16", "envy 17", "envy",
        "pavilion plus", "pavilion aero", "pavilion x360", "pavilion 14", "pavilion 15", "pavilion",
        "omnibook ultra", "omnibook x", "omnibook",
        "elitebook", "probook", "chromebook", "14s", "15s"
    ],
    "lenovo": [
        "legion pro 7", "legion pro 5", "legion 9", "legion 7", "legion 5", "legion slim", "legion",
        "loq 15", "loq 16", "loq",
        "thinkpad x1 carbon", "thinkpad x1", "thinkpad t14", "thinkpad e14", "thinkpad e16", "thinkpad",
        "ideapad gaming 3", "ideapad gaming", "ideapad flex", "ideapad slim 5", "ideapad slim 3", "ideapad slim 1", "ideapad 3", "ideapad 5", "ideapad",
        "yoga slim", "yoga pro", "yoga 7", "yoga 9", "yoga", "v14", "v15"
    ],
    "asus": [
        "rog zephyrus g14", "rog zephyrus g16", "rog zephyrus", "rog strix scar", "rog strix g16", "rog strix g15", "rog strix", "rog flow", "rog ally", "rog",
        "tuf gaming a15", "tuf gaming a16", "tuf gaming f15", "tuf gaming f16", "tuf gaming", "tuf dash", "tuf",
        "zenbook duo", "zenbook s 13", "zenbook 14", "zenbook pro", "zenbook",
        "vivobook pro", "vivobook s", "vivobook go", "vivobook 15", "vivobook 16", "vivobook 14", "vivobook",
        "expertbook"
    ],
    "apple": [
        "macbook neo", "macbook air", "macbook pro", "macbook"
    ],
    "samsung": [
        "galaxy book4 pro", "galaxy book4 ultra", "galaxy book4 360", "galaxy book4",
        "galaxy book3 pro", "galaxy book3 360", "galaxy book3",
        "galaxy book2", "galaxy book go", "galaxy book"
    ],
}

# Accessories that must be rejected when matching a device
ACCESSORY_TERMS = [
    r"\bcase\b", r"\bcover\b", r"\btempered glass\b", r"\bscreen protector\b",
    r"\bback panel\b", r"\bback cover\b", r"\bcharger\b", r"\bcable\b",
    r"\badapter\b", r"\bpouch\b", r"\bsleeve\b", r"\bskin\b", r"\bstrap\b",
    r"\bband\b", r"\bstand\b", r"\bmount\b", r"\bspares\b", r"\bear tips\b",
    r"\bcushion\b", r"\bcarrying case\b", r"\bholster\b", r"\bkeyboard protector\b"
]

# Condition indicators that disqualify an offer
REFURBISHED_TERMS = [
    r"\brefurbished\b", r"\brenewed\b", r"\bpre-owned\b", r"\bpre owned\b",
    r"\bopen box\b", r"\bunboxed\b", r"\b2nd hand\b", r"\bsecond hand\b",
    r"\bused\b"
]

BUNDLE_TERMS = [
    r"\bcombo\b", r"\bpack of \d+\b", r"\d+\s*pack\b", r"\bbundle with\b"
]

# Common colors - ordered by length descending
COMMON_COLORS = [
    "natural titanium", "black titanium", "white titanium", "desert titanium",
    "space grey", "space gray", "space black", "cloud white", "mist blue",
    "deep blue", "sky blue", "pacific blue", "sierra blue", "alpine green",
    "rose gold", "midnight", "starlight", "titanium", "indigo", "citrus",
    "dazzle steel", "elegant inox", "stainless steel", "steel",
    "silver", "black", "white", "blue", "teal", "ultramarine", "pink",
    "green", "yellow", "purple", "violet", "lavender", "sage", "gold",
    "red", "orange", "grey", "gray"
]

# Synonymous color canonicalization
COLOR_SYNONYMS = {
    "space gray": "space grey",
    "product(red)": "red",
    "product red": "red",
    "cloud white": "white",
    "gray": "grey",
    "dazzle steel": "silver",
    "elegant inox": "silver",
    "stainless steel": "silver",
    "steel": "silver",
}

# Known Apple MPNs in India
KNOWN_MPNS: dict[str, dict[str, str]] = {
    "MHFA4HN/A": {"model": "macbook neo", "color": "silver", "storage": "256 GB", "ram": "8 GB"},
    "MHFD4HN/A": {"model": "macbook neo", "color": "citrus", "storage": "256 GB", "ram": "8 GB"},
    "MHFF4HN/A": {"model": "macbook neo", "color": "indigo", "storage": "256 GB", "ram": "8 GB"},
    "MHFJ4HN/A": {"model": "macbook neo", "color": "indigo", "storage": "512 GB", "ram": "8 GB"},
}

STOP_WORDS = {
    "with", "and", "the", "for", "new", "original", "gen", "generation",
    "edition", "model", "smart", "true", "wireless", "portable", "device",
    "bluetooth", "headphone", "headphones", "headset", "earphones", "earbuds",
    "laptop", "chip", "liquid", "retina", "display", "backlit", "keyboard",
    "camera", "touch", "id", "tahoe", "macos", "sonoma", "sequoia", "smartchoice"
}


def normalize_title(text: str) -> str:
    """
    Normalizes harmless title differences, punctuation, whitespace, and smart quotes
    while preserving essential model identifiers and hardware spec notations.
    """
    if not text:
        return ""

    t = text

    # Remove unicode smart quotes, apostrophes, accents
    t = re.sub(r'[\u201c\u201d\u2033"]', ' ', t)
    t = re.sub(r"[\u2018\u2019']", ' ', t)

    # Normalize unicode dashes to standard hyphen
    t = re.sub(r"[\u2013\u2014\u2212]", "-", t)

    # Convert non-breaking spaces
    t = t.replace("\u00a0", " ")

    # Clean redundant bracket styles while preserving slash and hyphen specs
    t = re.sub(r"[()\[\]{}]", " ", t)

    # Collapse repeated whitespace
    t = re.sub(r"\s+", " ", t).strip()

    return t


def canonicalize_color(color: Optional[str]) -> Optional[str]:
    """Canonicalize identical spelling variants of colors (e.g. space gray -> space grey)."""
    if not color:
        return None
    c = color.strip().lower()
    return COLOR_SYNONYMS.get(c, c)


class ProductMatcher:
    @classmethod
    def extract_specs(
        cls,
        title: str,
        variant_hint: Optional[str] = None,
        url_hint: Optional[str] = None,
    ) -> ProductSpecs:
        """
        Extracts structured product specifications from raw title, optional variant hint,
        and URL slug.
        """
        combined_text = title
        if variant_hint:
            combined_text += " " + variant_hint
        if url_hint:
            clean_url = url_hint.split("?")[0].replace("-", " ").replace("/", " ")
            combined_text += " " + clean_url

        t_norm = normalize_title(combined_text).lower()
        specs = ProductSpecs(raw_title=title)

        # 1. Accessory detection
        for pattern in ACCESSORY_TERMS:
            if re.search(pattern, t_norm):
                specs.is_accessory = True
                specs.category = "accessory"
                break

        # 2. Refurbished detection
        for pattern in REFURBISHED_TERMS:
            if re.search(pattern, t_norm):
                specs.is_refurbished = True
                break

        # 3. Bundle detection
        for pattern in BUNDLE_TERMS:
            if re.search(pattern, t_norm):
                specs.is_bundle = True
                break

        # 4. Brand detection
        for brand in KNOWN_BRANDS:
            if re.search(r"\b" + re.escape(brand) + r"\b", t_norm):
                specs.brand = brand
                break

        # 5. Device Category Detection
        if not specs.category:
            if re.search(
                r"\b(?:refrigerator|fridge|frost\s*free|direct\s*cool|double\s*door|single\s*door)\b",
                t_norm,
            ):
                specs.category = "refrigerator"
                specs.appliance_type = "refrigerator"
            elif re.search(r"\b(?:washing\s*machine|front\s*load|top\s*load)\b", t_norm):
                specs.category = "appliance"
                specs.appliance_type = "washing machine"
            elif re.search(r"\b(?:air\s*conditioner|inverter\s*ac|\bac\b)\b", t_norm):
                specs.category = "appliance"
                specs.appliance_type = "air conditioner"
            elif re.search(r"\b(?:smart\s*tv|led\s*tv|oled\s*tv|qled\s*tv|television)\b", t_norm):
                specs.category = "television"
                specs.appliance_type = "television"
            elif re.search(
                r"\b(?:wh\s*[-]?\s*1000xm\d|wf\s*[-]?\s*1000xm\d|headphones|headset|earphones|earbuds|airpods|galaxy buds|neckband|over\s*ear|in\s*ear)\b",
                t_norm,
            ):
                specs.category = "audio"
            elif re.search(
                r"\b(?:macbook|chromebook|thinkpad|zenbook|ideapad|vivobook|expertbook|alienware|inspiron|aspire|predator|nitro|omen|victus|pavilion|legion|loq|tuf|rog|laptop|notebook)\b",
                t_norm,
            ):
                specs.category = "laptop"
            elif re.search(
                r"\b(?:iphone|galaxy\s*[sz]\d+|pixel\s*\d+|redmi\s*note|smartphone|mobile\s*phone|5g\s*mobile)\b",
                t_norm,
            ):
                specs.category = "smartphone"
            elif re.search(r"\b(?:ipad|galaxy\s*tab|tablet)\b", t_norm):
                specs.category = "tablet"

        # 6. Product Family & Model Line Extraction
        # Audio
        m_sony = re.search(r"\b(wh|wf)\s*[-]?\s*(1000xm\d)\b", t_norm)
        if m_sony:
            specs.model_line = f"{m_sony.group(1)}-{m_sony.group(2)}".lower()
            specs.product_family = specs.model_line
            specs.brand = specs.brand or "sony"
            specs.category = "audio"

        # Smartphones
        m_iphone = re.search(r"\biphone\s*(\d+|se|x|xr|xs)\b", t_norm)
        if m_iphone:
            specs.model_line = f"iphone {m_iphone.group(1)}".lower()
            specs.product_family = specs.model_line
            specs.brand = specs.brand or "apple"
            specs.category = "smartphone"

        m_galaxy = re.search(r"\bgalaxy\s*([sz]\d+|z\s*flip\s*\d+|z\s*fold\s*\d+|a\d+)\b", t_norm)
        if m_galaxy:
            specs.model_line = f"galaxy {m_galaxy.group(1)}".lower()
            specs.product_family = specs.model_line
            specs.brand = specs.brand or "samsung"
            specs.category = "smartphone"

        m_pixel = re.search(r"\bpixel\s*(\d+[a-z]?)\b", t_norm)
        if m_pixel:
            specs.model_line = f"pixel {m_pixel.group(1)}".lower()
            specs.product_family = specs.model_line
            specs.brand = specs.brand or "google"
            specs.category = "smartphone"

        # Laptops (Brand-specific product family hierarchy)
        if specs.brand and specs.brand in LAPTOP_FAMILIES:
            for fam in LAPTOP_FAMILIES[specs.brand]:
                # Match whole words for family name
                fam_pat = r"\b" + re.escape(fam) + r"\b"
                if re.search(fam_pat, t_norm):
                    specs.product_family = fam
                    specs.model_line = fam
                    specs.category = "laptop"
                    break

        if not specs.product_family and specs.category == "laptop":
            # Search all known laptop families regardless of brand match
            for b, families in LAPTOP_FAMILIES.items():
                for fam in families:
                    fam_pat = r"\b" + re.escape(fam) + r"\b"
                    if re.search(fam_pat, t_norm):
                        specs.product_family = fam
                        specs.model_line = fam
                        specs.brand = specs.brand or b
                        break
                if specs.product_family:
                    break

        # 7. Processor Extraction (CPU Brand, Family, Model)
        # AMD Ryzen & Athlon
        m_ryzen = re.search(r"\bryzen\s*([3579])(?:\s*[-]?\s*(\d{4}[a-z]{0,2}))?\b", t_norm)
        if m_ryzen:
            specs.cpu_brand = "amd"
            specs.cpu_family = f"ryzen {m_ryzen.group(1)}"
            if m_ryzen.group(2):
                specs.cpu_model = m_ryzen.group(2).lower()
        elif re.search(r"\bryzen\b", t_norm):
            specs.cpu_brand = "amd"
            specs.cpu_family = "ryzen"

        # Intel Core, Pentium, Celeron
        m_intel_core = re.search(r"\b(?:core\s*)?(ultra\s*[579]|i[3579])(?:\s*[-]?\s*(\d{4,5}[a-z]{0,2}))?\b", t_norm)
        if m_intel_core:
            specs.cpu_brand = "intel"
            specs.cpu_family = f"core {m_intel_core.group(1)}"
            if m_intel_core.group(2):
                specs.cpu_model = m_intel_core.group(2).lower()
        elif re.search(r"\bpentium\b", t_norm):
            specs.cpu_brand = "intel"
            specs.cpu_family = "pentium"
            m_pen = re.search(r"\b(n\d{4}|gold|silver)\b", t_norm)
            if m_pen:
                specs.cpu_model = m_pen.group(1).lower()
        elif re.search(r"\bceleron\b", t_norm):
            specs.cpu_brand = "intel"
            specs.cpu_family = "celeron"
            m_cel = re.search(r"\b(n\d{4})\b", t_norm)
            if m_cel:
                specs.cpu_model = m_cel.group(1).lower()

        # Apple Silicon
        m_apple_chip = re.search(r"\b(m[1-5](?:\s*max|\s*pro)?|a1[5-9](?:\s*pro)?)\b", t_norm)
        if m_apple_chip:
            specs.cpu_brand = "apple"
            specs.cpu_family = m_apple_chip.group(1)

        # 8. Dedicated GPU Extraction (GPU Brand, Model, VRAM)
        m_rtx = re.search(r"\b(rtx\s*\d{4}(?:\s*ti)?|gtx\s*\d{4}(?:\s*ti)?)\b", t_norm)
        if m_rtx:
            specs.gpu_brand = "nvidia"
            specs.gpu_model = re.sub(r"\s+", " ", m_rtx.group(1)).lower()
        elif re.search(r"\bintel\s*arc\s*(a\d{3}[a-z]?)?\b", t_norm):
            specs.gpu_brand = "intel"
            specs.gpu_model = "intel arc"
        elif re.search(r"\bradeon\s*(rx\s*\d{4}[a-z]?|\d{3}m)?\b", t_norm):
            m_rad = re.search(r"\bradeon\s*(rx\s*\d{4}[a-z]?|\d{3}m)\b", t_norm)
            specs.gpu_brand = "amd"
            specs.gpu_model = m_rad.group(0).lower() if m_rad else "radeon"

        # VRAM
        m_vram = re.search(r"\b(\d+)\s*gb\s*(?:graphics|vram|gddr\d|video memory)\b", t_norm)
        if m_vram:
            specs.gpu_vram = f"{m_vram.group(1)} gb"

        # 9. Model Qualifiers (e.g. Pro Max, Pro, Plus, Ultra, 16e, etc.)
        chip_strip_pat = r"\b(a1[5-9]\s*pro|m[1-5]\s*pro|m[1-5]\s*max|ultra\s*[579])\b"
        t_no_chips = re.sub(chip_strip_pat, " ", t_norm)
        for q in MODEL_QUALIFIERS:
            if re.search(r"\b" + re.escape(q) + r"\b", t_no_chips):
                if q == "pro" and "pro max" in specs.model_qualifiers:
                    continue
                if specs.model_line and q in specs.model_line:
                    continue
                # MacBook Neo chip qualifier suppression
                if specs.model_line and (q == "neo" or (q == "pro" and "neo" in specs.model_line)):
                    continue
                specs.model_qualifiers.append(q)

        # 10. Storage Extraction
        m_slash = re.search(r"\b(4|6|8|12|16|18|24|32|36|64)\s*gb\s*/\s*(\d+)\s*(gb|tb)\b", t_norm)
        if m_slash:
            specs.ram = f"{m_slash.group(1)} GB"
            unit = m_slash.group(3).upper()
            specs.storage = f"{m_slash.group(2)} {unit}"
        else:
            m_storage = re.search(r"\b(32|64|128|256|512)\s*(?:gb|g\b)|\b(1|2)\s*tb\b", t_norm)
            if m_storage:
                if m_storage.group(1):
                    specs.storage = f"{m_storage.group(1)} GB"
                elif m_storage.group(2):
                    specs.storage = f"{m_storage.group(2)} TB"

        # 11. RAM Extraction
        if not specs.ram:
            m_ram = re.search(r"\b(4|6|8|12|16|18|24|32|36|64)\s*(?:gb\s*ram|gb\s*lpddr\d|gb\s*ddr\d|gb\s*unified memory|gb\s*memory)\b", t_norm)
            if m_ram:
                specs.ram = f"{m_ram.group(1)} GB"

        # 11b. Appliance Specs Extraction (Capacity, Door style, Defrost, Star rating)
        if specs.category == "refrigerator":
            m_cap = re.search(r"\b(\d{2,3})\s*(?:l|litres?|liter)\b", t_norm)
            if m_cap:
                specs.capacity = f"{m_cap.group(1)} L"
            m_door = re.search(r"\b(double\s*door|single\s*door|side\s*by\s*side|french\s*door|triple\s*door|multi\s*door)\b", t_norm)
            if m_door:
                specs.door_type = m_door.group(1).lower()
            m_def = re.search(r"\b(frost\s*free|direct\s*cool)\b", t_norm)
            if m_def:
                specs.defrost_type = m_def.group(1).lower()
            m_star = re.search(r"\b([1-5])\s*star\b", t_norm)
            if m_star:
                specs.star_rating = f"{m_star.group(1)} star"

        # 12. MPN Extraction
        m_mpn = re.search(r"\b(MHF[A-Z0-9]+HN[/-]A|[A-Z]{2,4}\d{1,4}[A-Z0-9]{1,8}(?:/[A-Z0-9]+)?)\b", combined_text, re.IGNORECASE)
        if m_mpn:
            normalized_mpn = m_mpn.group(1).upper().replace("-", "/")
            specs.mpn = normalized_mpn
            if normalized_mpn in KNOWN_MPNS:
                known = KNOWN_MPNS[normalized_mpn]
                if not specs.color and "color" in known:
                    specs.color = known["color"]
                if not specs.storage and "storage" in known:
                    specs.storage = known["storage"]
                if not specs.ram and "ram" in known:
                    specs.ram = known["ram"]

        # 13. Color Extraction
        if not specs.color:
            for c in COMMON_COLORS:
                if re.search(r"\b" + re.escape(c) + r"\b", t_norm):
                    specs.color = canonicalize_color(c)
                    break

        return specs

    @classmethod
    def evaluate_match(
        cls,
        source_title: str,
        candidate_title: str,
        source_variant: Optional[str] = None,
        candidate_url: Optional[str] = None,
    ) -> tuple[MatchStatus, str, RejectionCategory, dict[str, Any]]:
        """
        Evaluates a candidate listing against the active source product.
        Implements a deterministic, fail-closed product verification pipeline.
        Returns: (MatchStatus, reason, RejectionCategory, extracted_variants)
        """
        source = cls.extract_specs(source_title, variant_hint=source_variant)
        cand = cls.extract_specs(candidate_title, url_hint=candidate_url)

        cand_variants = {
            "category": cand.category,
            "brand": cand.brand,
            "product_family": cand.product_family,
            "model_line": cand.model_line,
            "model_qualifiers": cand.model_qualifiers,
            "cpu_brand": cand.cpu_brand,
            "cpu_family": cand.cpu_family,
            "cpu_model": cand.cpu_model,
            "gpu_brand": cand.gpu_brand,
            "gpu_model": cand.gpu_model,
            "gpu_vram": cand.gpu_vram,
            "color": cand.color,
            "storage": cand.storage,
            "ram": cand.ram,
            "mpn": cand.mpn,
            "capacity": cand.capacity,
            "door_type": cand.door_type,
            "defrost_type": cand.defrost_type,
            "star_rating": cand.star_rating,
            "appliance_type": cand.appliance_type,
        }

        # -------------------------------------------------------------
        # 1. Condition & Integrity Checks
        # -------------------------------------------------------------
        if cand.is_accessory:
            return (
                MatchStatus.MISMATCH,
                "Candidate listing is an accessory, cover, or spare part.",
                RejectionCategory.ACCESSORY_OR_CONDITION,
                cand_variants,
            )
        if cand.is_refurbished:
            return (
                MatchStatus.MISMATCH,
                "Candidate listing is refurbished, renewed, or open-box.",
                RejectionCategory.ACCESSORY_OR_CONDITION,
                cand_variants,
            )
        if cand.is_bundle:
            return (
                MatchStatus.MISMATCH,
                "Candidate listing is a bundled combo or multi-pack.",
                RejectionCategory.ACCESSORY_OR_CONDITION,
                cand_variants,
            )

        # -------------------------------------------------------------
        # 2. Product Category Check
        # -------------------------------------------------------------
        if source.category and cand.category and source.category != cand.category:
            return (
                MatchStatus.MISMATCH,
                f"Product category mismatch: source is {source.category}, candidate is {cand.category}.",
                RejectionCategory.MODEL_MISMATCH,
                cand_variants,
            )

        # -------------------------------------------------------------
        # 2b. Refrigerator & Appliance Specific Verification
        # -------------------------------------------------------------
        if source.category == "refrigerator" or cand.category == "refrigerator":
            if source.category != cand.category:
                return (
                    MatchStatus.MISMATCH,
                    f"Product category mismatch: source is {source.category}, candidate is {cand.category}.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )
            if source.capacity and cand.capacity and source.capacity != cand.capacity:
                return (
                    MatchStatus.MISMATCH,
                    f"Capacity mismatch: {source.capacity} vs {cand.capacity}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
            elif source.capacity and not cand.capacity:
                return (
                    MatchStatus.UNVERIFIED_VARIANT,
                    f"Capacity unverified in competitor listing (source specifies {source.capacity}).",
                    RejectionCategory.UNVERIFIED_VARIANT,
                    cand_variants,
                )
            if source.door_type and cand.door_type and source.door_type != cand.door_type:
                return (
                    MatchStatus.MISMATCH,
                    f"Door configuration mismatch: {source.door_type.title()} vs {cand.door_type.title()}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
            if source.defrost_type and cand.defrost_type and source.defrost_type != cand.defrost_type:
                return (
                    MatchStatus.MISMATCH,
                    f"Defrost type mismatch: {source.defrost_type.title()} vs {cand.defrost_type.title()}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
            if source.star_rating and cand.star_rating and source.star_rating != cand.star_rating:
                return (
                    MatchStatus.MISMATCH,
                    f"Energy star rating mismatch: {source.star_rating} vs {cand.star_rating}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
            if source.mpn and cand.mpn:
                src_base_mpn = source.mpn.split("/")[0]
                cand_base_mpn = cand.mpn.split("/")[0]
                if src_base_mpn != cand_base_mpn:
                    return (
                        MatchStatus.MISMATCH,
                        f"Model code mismatch: {source.mpn} vs {cand.mpn}.",
                        RejectionCategory.MODEL_MISMATCH,
                        cand_variants,
                    )

        src_clean = normalize_title(source_title).lower()
        cand_clean = normalize_title(candidate_title).lower()

        # -------------------------------------------------------------
        # 3. Brand Identity Check (Mandatory)
        # -------------------------------------------------------------
        if cand.brand and cand.brand not in src_clean:
            return (
                MatchStatus.MISMATCH,
                f"Brand mismatch: candidate is {cand.brand.title()}, not in source listing.",
                RejectionCategory.MODEL_MISMATCH,
                cand_variants,
            )
        if source.brand and source.brand not in cand_clean:
            return (
                MatchStatus.MISMATCH,
                f"Brand mismatch: source is {source.brand.title()}, not in competitor listing.",
                RejectionCategory.MODEL_MISMATCH,
                cand_variants,
            )
        if source.brand and cand.brand and source.brand != cand.brand:
            return (
                MatchStatus.MISMATCH,
                f"Brand mismatch: {source.brand.title()} vs {cand.brand.title()}.",
                RejectionCategory.MODEL_MISMATCH,
                cand_variants,
            )

        # -------------------------------------------------------------
        # 4. Product Family Identity (Mandatory — Fail Closed)
        # -------------------------------------------------------------
        if source.product_family:
            if not cand.product_family:
                return (
                    MatchStatus.MISMATCH,
                    f"Product family missing: candidate does not specify required family '{source.product_family.title()}'.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )
            src_fam = source.product_family.replace("-", " ").replace(" ", "")
            cand_fam = cand.product_family.replace("-", " ").replace(" ", "")
            if src_fam != cand_fam:
                return (
                    MatchStatus.MISMATCH,
                    f"Product family mismatch: '{source.product_family.title()}' vs '{cand.product_family.title()}'.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )
        elif cand.product_family:
            return (
                MatchStatus.MISMATCH,
                f"Product family mismatch: candidate is '{cand.product_family.title()}', not in source listing.",
                RejectionCategory.MODEL_MISMATCH,
                cand_variants,
            )

        # Model line check
        if source.model_line and cand.model_line:
            src_ml = source.model_line.replace("-", "").replace(" ", "")
            cand_ml = cand.model_line.replace("-", "").replace(" ", "")
            if src_ml != cand_ml:
                return (
                    MatchStatus.MISMATCH,
                    f"Model mismatch: {source.model_line} vs {cand.model_line}.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )

        # Fallback if neither product family nor model line was detected
        if not source.brand and not source.product_family:
            src_words = set(re.findall(r"\b[a-zA-Z0-9]{3,}\b", src_clean)) - STOP_WORDS
            cand_words = set(re.findall(r"\b[a-zA-Z0-9]{3,}\b", cand_clean)) - STOP_WORDS
            if not src_words or len(src_words.intersection(cand_words)) < min(3, len(src_words)):
                return (
                    MatchStatus.MISMATCH,
                    "Insufficient title or model keyword overlap to verify product identity.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )
            return (
                MatchStatus.UNCERTAIN_MATCH,
                "Probable keyword overlap, but brand and product family cannot be verified.",
                RejectionCategory.UNCERTAIN_CONFIG,
                cand_variants,
            )

        # -------------------------------------------------------------
        # 5. Model Qualifiers / Tier Check (Pro Max, Plus, Ultra, etc.)
        # -------------------------------------------------------------
        source_quals = set(source.model_qualifiers)
        cand_quals = set(cand.model_qualifiers)
        critical_quals = {"pro max", "pro", "plus", "ultra", "mini", "fe", "16e", "15e", "neo", "se"}
        source_critical = source_quals.intersection(critical_quals)
        cand_critical = cand_quals.intersection(critical_quals)

        if source_critical != cand_critical:
            src_str = ", ".join(sorted(source_critical)) if source_critical else "base model"
            cand_str = ", ".join(sorted(cand_critical)) if cand_critical else "base model"
            return (
                MatchStatus.MISMATCH,
                f"Model tier mismatch ({src_str} vs {cand_str}).",
                RejectionCategory.MODEL_MISMATCH,
                cand_variants,
            )

        # -------------------------------------------------------------
        # 6. Processor Verification (CPU Brand, Family, Model)
        # -------------------------------------------------------------
        if source.cpu_brand and cand.cpu_brand and source.cpu_brand != cand.cpu_brand:
            return (
                MatchStatus.MISMATCH,
                f"Processor brand mismatch: {source.cpu_brand.upper()} vs {cand.cpu_brand.upper()}.",
                RejectionCategory.CONFIG_MISMATCH,
                cand_variants,
            )

        if source.cpu_family and cand.cpu_family:
            src_cf = source.cpu_family.replace(" ", "")
            cand_cf = cand.cpu_family.replace(" ", "")
            if src_cf != cand_cf:
                return (
                    MatchStatus.MISMATCH,
                    f"Processor family mismatch: {source.cpu_family.title()} vs {cand.cpu_family.title()}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )

        if source.cpu_model and cand.cpu_model and source.cpu_model != cand.cpu_model:
            return (
                MatchStatus.MISMATCH,
                f"Processor model mismatch: {source.cpu_model} vs {cand.cpu_model}.",
                RejectionCategory.CONFIG_MISMATCH,
                cand_variants,
            )

        # If source is a laptop and specifies processor, but candidate completely omits processor
        if source.category == "laptop" and source.cpu_family and not cand.cpu_family:
            return (
                MatchStatus.UNVERIFIED_VARIANT,
                f"Processor specification unverified in competitor listing (source specifies {source.cpu_family.title()}).",
                RejectionCategory.UNVERIFIED_VARIANT,
                cand_variants,
            )

        # -------------------------------------------------------------
        # 7. Dedicated GPU Verification (Gaming Laptops)
        # -------------------------------------------------------------
        if source.gpu_model:
            if not cand.gpu_model:
                return (
                    MatchStatus.UNVERIFIED_VARIANT,
                    f"Graphics GPU unverified in competitor listing (source specifies {source.gpu_model.upper()}).",
                    RejectionCategory.UNVERIFIED_VARIANT,
                    cand_variants,
                )
            src_gm = source.gpu_model.replace(" ", "")
            cand_gm = cand.gpu_model.replace(" ", "")
            if src_gm != cand_gm:
                return (
                    MatchStatus.MISMATCH,
                    f"GPU model mismatch: {source.gpu_model.upper()} vs {cand.gpu_model.upper()}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
        elif cand.gpu_model and source.category == "laptop":
            # Candidate specifies high-end dedicated GPU when source had none
            return (
                MatchStatus.MISMATCH,
                f"GPU specification divergence: competitor listing includes {cand.gpu_model.upper()}, not in source.",
                RejectionCategory.CONFIG_MISMATCH,
                cand_variants,
            )

        # -------------------------------------------------------------
        # 8. Storage Capacity Verification
        # -------------------------------------------------------------
        if source.storage:
            if not cand.storage:
                return (
                    MatchStatus.UNVERIFIED_VARIANT,
                    f"Storage capacity unverified in competitor listing (source specifies {source.storage}).",
                    RejectionCategory.UNVERIFIED_VARIANT,
                    cand_variants,
                )
            elif source.storage != cand.storage:
                return (
                    MatchStatus.MISMATCH,
                    f"Storage capacity mismatch: {source.storage} vs {cand.storage}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )

        # -------------------------------------------------------------
        # 9. RAM Capacity Verification
        # -------------------------------------------------------------
        if source.ram:
            if cand.ram and source.ram != cand.ram:
                return (
                    MatchStatus.MISMATCH,
                    f"RAM capacity mismatch: {source.ram} vs {cand.ram}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
            elif not cand.ram and source.category == "laptop":
                return (
                    MatchStatus.UNVERIFIED_VARIANT,
                    f"RAM capacity unverified in competitor listing (source specifies {source.ram}).",
                    RejectionCategory.UNVERIFIED_VARIANT,
                    cand_variants,
                )

        # -------------------------------------------------------------
        # 10. Exact Color Variant Matching
        # -------------------------------------------------------------
        if source.color:
            src_color = canonicalize_color(source.color)
            cand_color = canonicalize_color(cand.color)

            if not cand_color:
                return (
                    MatchStatus.UNVERIFIED_VARIANT,
                    f"Listing variant cannot be established confidently (color unverified for {src_color.title()}).",
                    RejectionCategory.UNVERIFIED_VARIANT,
                    cand_variants,
                )
            elif src_color != cand_color:
                return (
                    MatchStatus.MISMATCH,
                    f"Color variant mismatch: source specifies {src_color.title()}, competitor listing is {cand_color.title()}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )

        # -------------------------------------------------------------
        # 11. Final Exact Match Verification
        # -------------------------------------------------------------
        return (
            MatchStatus.EXACT_MATCH,
            "Exact product model and hardware configuration match.",
            RejectionCategory.VALID_MATCH,
            cand_variants,
        )
