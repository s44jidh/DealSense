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
    POSSIBLE_MATCH = "POSSIBLE_MATCH"
    CONFIGURATION_MISMATCH = "CONFIGURATION_MISMATCH"
    MODEL_MISMATCH = "MODEL_MISMATCH"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"
    # Backward compatibility members
    UNVERIFIED_VARIANT = "UNVERIFIED_VARIANT"
    MISMATCH = "MISMATCH"
    PROBABLE_MATCH = "PROBABLE_MATCH"
    UNCERTAIN_MATCH = "UNCERTAIN_MATCH"

    def __eq__(self, other: object) -> bool:
        if super().__eq__(other):
            return True
        val = other.value if isinstance(other, Enum) else str(other)
        if self.value in ("MODEL_MISMATCH", "CONFIGURATION_MISMATCH") and val == "MISMATCH":
            return True
        if self.value == "MISMATCH" and val in ("MODEL_MISMATCH", "CONFIGURATION_MISMATCH"):
            return True
        if self.value == "POSSIBLE_MATCH" and val == "UNVERIFIED_VARIANT":
            return True
        if self.value == "UNVERIFIED_VARIANT" and val == "POSSIBLE_MATCH":
            return True
        return False

    def __hash__(self) -> int:
        return hash(self.value)


class RejectionCategory(str, Enum):
    VALID_MATCH = "VALID_MATCH"
    POSSIBLE_MATCH = "POSSIBLE_MATCH"
    MODEL_MISMATCH = "MODEL_MISMATCH"
    CONFIG_MISMATCH = "CONFIG_MISMATCH"
    VARIANT_MISMATCH = "VARIANT_MISMATCH"
    ACCESSORY_OR_CONDITION = "ACCESSORY_OR_CONDITION"
    UNVERIFIED_VARIANT = "UNVERIFIED_VARIANT"
    PRICE_EXTRACTION_FAILED = "PRICE_EXTRACTION_FAILED"
    NO_SEARCH_RESULTS = "NO_SEARCH_RESULTS"
    UNCERTAIN_CONFIG = "UNCERTAIN_CONFIG"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA" 


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
    ram: Optional[str] = None  # "8 GB", "16 GB", "24 GB"
    screen_size: Optional[str] = None  # "13-inch", "15-inch", "14-inch", "16-inch"
    release_year: Optional[str] = None  # "2026", "2024", etc.
    chip_family: Optional[str] = None  # "m5", "m4", "m3", etc.
    color: Optional[str] = None  # "blue", "silver", "indigo", "black", "midnight" 
    is_accessory: bool = False
    is_refurbished: bool = False
    is_bundle: bool = False
    capacity: Optional[str] = None  # e.g. "236 L", "183 L" (refrigerator / appliance)
    door_type: Optional[str] = None  # e.g. "double door", "single door", "side by side", "french door"
    defrost_type: Optional[str] = None  # e.g. "frost free", "direct cool"
    star_rating: Optional[str] = None  # e.g. "3 star", "2 star", "4 star"
    appliance_type: Optional[str] = None  # e.g. "refrigerator", "washing machine", "air conditioner", "television"
    connectivity: Optional[str] = None  # e.g. "wireless", "wired"
    edition: Optional[str] = None
    refresh_rate: Optional[str] = None  # e.g. "144Hz", "165Hz", "240Hz", "60Hz"
    resolution: Optional[str] = None  # e.g. "4K UHD", "QHD 1440p", "FHD 1080p"
    panel_type: Optional[str] = None  # e.g. "IPS", "OLED", "VA"
    interface_type: Optional[str] = None  # e.g. "PCIe Gen 4 NVMe", "SATA"
    item_size: Optional[str] = None  # e.g. "Size 5", "Size 4", "1000 ml"


# Known brand names (lowercase)
KNOWN_BRANDS = [
    "logitech", "razer", "thrustmaster", "corsair", "steelseries", "microsoft",
    "hyperx", "8bitdo", "turtle beach", "scuf", "kreo", "cosmic byte", "evofox",
    "ant esports", "amkette", "redgear", "claw", "enter", "zebronics", "portronics",
    "quantum", "fantech", "flydigi", "gamesir", "gulikit", "dualsense", "playstation",
    "xbox", "nintendo", "crucial", "kingston", "sandisk", "western digital", "seagate",
    "apple", "samsung", "sony", "google", "oneplus", "xiaomi", "redmi",
    "realme", "motorola", "oppo", "vivo", "asus", "dell", "hp", "lenovo",
    "acer", "bose", "sennheiser", "jbl", "boat", "noise", "nothing",
    "iqoo", "lg", "philips", "micromax", "jmax", "whirlpool", "haier",
    "godrej", "voltas", "panasonic", "ifb", "bosch", "siemens", "daikin",
    "hitachi", "carrier", "blue star", "lloyd",
    "nivia", "cosco", "yonex", "milton", "cello",
    "benq", "viewsonic", "aoc", "msi", "gigabyte"
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
    r"\bshifter\b", r"\bwheel stand\b", r"\bwheel base\b", r"\bpedal mount\b",
    r"\bpedals only\b", r"\bclamp\b",
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

# Known Apple MPNs in India and internationally
KNOWN_MPNS: dict[str, dict[str, str]] = {
    # 2026 MacBook Neo (13-inch, A18 Pro)
    "MHFA4HN/A": {"model": "macbook neo", "color": "silver", "storage": "256 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "a18 pro", "year": "2026"},
    "MHFD4HN/A": {"model": "macbook neo", "color": "citrus", "storage": "256 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "a18 pro", "year": "2026"},
    "MHFF4HN/A": {"model": "macbook neo", "color": "indigo", "storage": "256 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "a18 pro", "year": "2026"},
    "MHFJ4HN/A": {"model": "macbook neo", "color": "indigo", "storage": "512 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "a18 pro", "year": "2026"},

    # 2026 MacBook Air 13-inch (M5)
    "MDH74HN/A": {"model": "macbook air", "color": "space grey", "storage": "512 GB", "ram": "16 GB", "screen_size": "13-inch", "cpu": "m5", "year": "2026"},
    "MDHA4HN/A": {"model": "macbook air", "color": "silver", "storage": "512 GB", "ram": "16 GB", "screen_size": "13-inch", "cpu": "m5", "year": "2026"},
    "MDHE4HN/A": {"model": "macbook air", "color": "starlight", "storage": "512 GB", "ram": "16 GB", "screen_size": "13-inch", "cpu": "m5", "year": "2026"},
    "MDHH4HN/A": {"model": "macbook air", "color": "midnight", "storage": "512 GB", "ram": "16 GB", "screen_size": "13-inch", "cpu": "m5", "year": "2026"},
    "MDHC4HN/A": {"model": "macbook air", "color": "space grey", "storage": "1 TB", "ram": "16 GB", "screen_size": "13-inch", "cpu": "m5", "year": "2026"},
    "MDHF4HN/A": {"model": "macbook air", "color": "silver", "storage": "1 TB", "ram": "16 GB", "screen_size": "13-inch", "cpu": "m5", "year": "2026"},
    "MDHJ4HN/A": {"model": "macbook air", "color": "starlight", "storage": "1 TB", "ram": "16 GB", "screen_size": "13-inch", "cpu": "m5", "year": "2026"},
    "MDHD4HN/A": {"model": "macbook air", "color": "space grey", "storage": "1 TB", "ram": "24 GB", "screen_size": "13-inch", "cpu": "m5", "year": "2026"},
    "MDHG4HN/A": {"model": "macbook air", "color": "midnight", "storage": "1 TB", "ram": "24 GB", "screen_size": "13-inch", "cpu": "m5", "year": "2026"},
    "MDHK4HN/A": {"model": "macbook air", "color": "starlight", "storage": "1 TB", "ram": "24 GB", "screen_size": "13-inch", "cpu": "m5", "year": "2026"},

    # 2026 MacBook Air 15-inch (M5)
    "MDVH4HN/A": {"model": "macbook air", "color": "midnight", "storage": "512 GB", "ram": "16 GB", "screen_size": "15-inch", "cpu": "m5", "year": "2026"},
    "MDVQ4HN/A": {"model": "macbook air", "color": "starlight", "storage": "512 GB", "ram": "16 GB", "screen_size": "15-inch", "cpu": "m5", "year": "2026"},
    "MDVA4HN/A": {"model": "macbook air", "color": "space grey", "storage": "1 TB", "ram": "16 GB", "screen_size": "15-inch", "cpu": "m5", "year": "2026"},
    "MDVK4HN/A": {"model": "macbook air", "color": "starlight", "storage": "1 TB", "ram": "16 GB", "screen_size": "15-inch", "cpu": "m5", "year": "2026"},
    "MDVT4HN/A": {"model": "macbook air", "color": "silver", "storage": "1 TB", "ram": "16 GB", "screen_size": "15-inch", "cpu": "m5", "year": "2026"},
    "MDVF4HN/A": {"model": "macbook air", "color": "space grey", "storage": "1 TB", "ram": "24 GB", "screen_size": "15-inch", "cpu": "m5", "year": "2026"},
    "MDVN4HN/A": {"model": "macbook air", "color": "midnight", "storage": "1 TB", "ram": "24 GB", "screen_size": "15-inch", "cpu": "m5", "year": "2026"},

    # 2024 MacBook Air 13-inch (M3)
    "MRXN3HN/A": {"model": "macbook air", "color": "space grey", "storage": "256 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "m3", "year": "2024"},
    "MRXV3HN/A": {"model": "macbook air", "color": "midnight", "storage": "256 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "m3", "year": "2024"},
    "MRXU3HN/A": {"model": "macbook air", "color": "silver", "storage": "256 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "m3", "year": "2024"},
    "MRXQ3HN/A": {"model": "macbook air", "color": "starlight", "storage": "256 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "m3", "year": "2024"},
    "MXCR3HN/A": {"model": "macbook air", "color": "space grey", "storage": "512 GB", "ram": "16 GB", "screen_size": "13-inch", "cpu": "m3", "year": "2024"},
    "MXCV3HN/A": {"model": "macbook air", "color": "midnight", "storage": "512 GB", "ram": "16 GB", "screen_size": "13-inch", "cpu": "m3", "year": "2024"},
    "MXCT3HN/A": {"model": "macbook air", "color": "silver", "storage": "512 GB", "ram": "16 GB", "screen_size": "13-inch", "cpu": "m3", "year": "2024"},
    "MXCU3HN/A": {"model": "macbook air", "color": "starlight", "storage": "512 GB", "ram": "16 GB", "screen_size": "13-inch", "cpu": "m3", "year": "2024"},

    # 2022 MacBook Air 13-inch (M2)
    "MLXW3HN/A": {"model": "macbook air", "color": "space grey", "storage": "256 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "m2", "year": "2022"},
    "MLY33HN/A": {"model": "macbook air", "color": "midnight", "storage": "256 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "m2", "year": "2022"},
    "MLY13HN/A": {"model": "macbook air", "color": "starlight", "storage": "256 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "m2", "year": "2022"},
    "MLXY3HN/A": {"model": "macbook air", "color": "silver", "storage": "256 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "m2", "year": "2022"},

    # 2020 MacBook Air 13-inch (M1)
    "MGN63HN/A": {"model": "macbook air", "color": "space grey", "storage": "256 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "m1", "year": "2020"},
    "MGND3HN/A": {"model": "macbook air", "color": "gold", "storage": "256 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "m1", "year": "2020"},
    "MGN93HN/A": {"model": "macbook air", "color": "silver", "storage": "256 GB", "ram": "8 GB", "screen_size": "13-inch", "cpu": "m1", "year": "2020"},
}

def is_retailer_identifier(token: str) -> bool:
    """
    Detects if an identifier belongs to a retailer-specific SKU/listing namespace
    (e.g., Amazon ASIN 'B0GR1C18B7' or Flipkart PID 'COMHZQX4QGCYC8SK') rather than
    a manufacturer model identifier (MPN).
    """
    if not token:
        return False
    t_up = token.strip().upper()
    # Amazon ASIN (B0 followed by 8 alphanumeric characters)
    if re.match(r"^B0[A-Z0-9]{8}$", t_up):
        return True
    # Flipkart product/listing IDs
    if re.match(r"^(?:COM|ITM|LST|MOB|TAB|LAP)[A-Z0-9]{8,}$", t_up):
        return True
    return False

def lookup_known_mpn(mpn_code: str) -> Optional[dict[str, str]]:
    if not mpn_code or is_retailer_identifier(mpn_code):
        return None
    code = mpn_code.upper().replace("-", "/")
    if code in KNOWN_MPNS:
        return KNOWN_MPNS[code]
    # Check base code without 2-letter country / revision suffix
    base = re.sub(r"[A-Z]{2}/[A-Z]$", "", code)
    if base in KNOWN_MPNS:
        return KNOWN_MPNS[base]
    for k, v in KNOWN_MPNS.items():
        if k.startswith(base) or base.startswith(k.split("/")[0]):
            return v
    return None

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

    # Normalize equivalent gaming peripheral terms (gamepad <-> controller)
    t = re.sub(r"\bgamepads?\b", "controller", t, flags=re.IGNORECASE)

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
                r"\b(?:racing\s*wheel|driving\s*force|steering\s*wheel|controller|gamepad|joystick|flight\s*stick)\b",
                t_norm,
            ):
                specs.category = "controller"
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
                r"\b(?:iphone|galaxy\s*[sz]\d+|pixel\s*\d+|redmi\s*note|phone\s*\d+[a-z]?|nothing\s*phone|smartphone|mobile\s*phone|5g\s*mobile)\b",
                t_norm,
            ):
                specs.category = "smartphone"
            elif re.search(r"\b(?:ipad|galaxy\s*tab|tablet)\b", t_norm):
                specs.category = "tablet"
            elif re.search(r"\b(?:gaming\s*monitor|curved\s*monitor|ultrawide\s*monitor|pc\s*monitor|\bmonitor\b)\b", t_norm):
                specs.category = "monitor"
            elif re.search(
                r"\b(?:internal\s*ssd|external\s*ssd|nvme\s*ssd|m\.2\s*ssd|portable\s*ssd|sata\s*ssd|solid\s*state\s*drive|internal\s*hdd|external\s*hdd|hard\s*drive|\bm\.2\b|\bnvme\b|\bssd\b)\b",
                t_norm,
            ):
                specs.category = "storage"
            elif re.search(
                r"\b(?:football|soccer\s*ball|basketball|volleyball|badminton\s*racquet|tennis\s*racquet|water\s*bottle|flask|shaker)\b",
                t_norm,
            ):
                specs.category = "sports"

        # 6. Product Family & Model Line Extraction
        # Monitors & Displays
        if specs.category == "monitor" or "monitor" in t_norm:
            m_mon = re.search(r"\b(ultragear|odyssey(?:\s*[a-z]\d+)?|predator|nitro|tuf|mobiuz)\b", t_norm)
            if m_mon:
                specs.model_line = m_mon.group(1).lower()
                specs.product_family = specs.model_line

        # Storage Devices & Components
        if specs.category == "storage" or any(s in t_norm for s in ("ssd", "nvme", "hdd")):
            m_ssd = re.search(r"\b(p3\s*plus|p3|t500|t700|980\s*pro|990\s*pro|970\s*evo(?:\s*plus)?|sn770|sn850x|sn580|sn570|nv2|kc3000|extreme\s*portable)\b", t_norm)
            if m_ssd:
                specs.model_line = m_ssd.group(1).lower()
                specs.product_family = specs.model_line

        # Sports & Everyday Consumer Products
        if specs.category == "sports" or any(sp in t_norm for sp in ("football", "ball", "racquet", "bottle", "flask")):
            m_sp = re.search(r"\b(storm|shining\s*star|vega|trainer|dominator|carbonex(?:\s*\d+)?|nanoray|astrox|thermosteel)\b", t_norm)
            if m_sp:
                specs.model_line = m_sp.group(1).lower()
                specs.product_family = specs.model_line

        # Controllers & Gaming Peripherals
        if specs.category == "controller" or any(b in t_norm for b in ("logitech", "razer", "thrustmaster", "dualsense", "dualshock", "xbox")):
            m_logi = re.search(r"\b(g29|g920|g923|g27|g25|f710|f310)\b", t_norm)
            if m_logi:
                specs.model_line = m_logi.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "logitech"
                specs.category = "controller"

            m_sony_c = re.search(r"\b(dualsense\s*edge|dualsense|dualshock\s*4|dualshock)\b", t_norm)
            if m_sony_c:
                specs.model_line = m_sony_c.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "sony"
                specs.category = "controller"

            m_xbox_c = re.search(r"\b(xbox\s*elite(?:\s*series\s*2)?|xbox(?:\s*(?:wireless|wired))?\s*controller)\b", t_norm)
            if m_xbox_c:
                raw_xb = m_xbox_c.group(1).lower()
                specs.model_line = "xbox controller" if "elite" not in raw_xb else raw_xb
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "microsoft"
                specs.category = "controller"

            m_tm = re.search(r"\b(t300\s*rs|t300|t248|t150|t80|t-gt\s*ii)\b", t_norm)
            if m_tm:
                specs.model_line = m_tm.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "thrustmaster"
                specs.category = "controller"

            m_rz = re.search(r"\b(wolverine\s*v2(?:\s*pro|\s*chroma)?|kishi\s*v2(?:\s*pro)?|kishi)\b", t_norm)
            if m_rz:
                specs.model_line = m_rz.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "razer"
                specs.category = "controller"

            if not specs.model_line:
                cleaned_controller = re.sub(
                    r"^(?:playstation|microsoft|sony|logitech|razer|kreo|cosmic\s*byte|evofox|8bitdo|gamesir|flydigi|gulikit|ant\s*esports|redgear)\s*",
                    "",
                    t_norm,
                )
                if specs.brand and cleaned_controller.startswith(specs.brand):
                    cleaned_controller = cleaned_controller[len(specs.brand):].strip()
                m_gen = re.search(
                    r"^\s*([a-z0-9]+(?:\s+[a-z0-9]+)?)\s+(?:wireless|wired|rgb|gaming|controller|gamepad|usb|joystick|hall\s*effect|tri\s*mode|bluetooth)\b",
                    cleaned_controller,
                )
                if m_gen:
                    cand_ml = m_gen.group(1).strip()
                    cand_ml = re.sub(r"\s+(?:wireless|wired|rgb|gaming)$", "", cand_ml).strip()
                    if cand_ml not in ("new", "best", "pro", "mini", "usb", "bluetooth", "wireless", "wired", "original", "gaming", "official"):
                        specs.model_line = cand_ml
                        specs.product_family = specs.model_line

        # Connectivity extraction
        if re.search(r"\b(?:wireless|bluetooth|2\.4ghz|2\.4\s*g)\b", t_norm):
            specs.connectivity = "wireless"
        elif re.search(r"\bwired\b", t_norm):
            specs.connectivity = "wired"

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

        # Nothing Phones
        m_nothing = re.search(r"\b(?:nothing\s+)?phone\s*\(?(\d+[a-z]?)\)?\b", t_norm)
        if m_nothing and (specs.brand == "nothing" or "nothing" in t_norm):
            specs.model_line = f"phone {m_nothing.group(1)}".lower()
            specs.product_family = specs.model_line
            specs.brand = specs.brand or "nothing"
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

        # Apple Silicon & Processors (e.g. M5, Apple M5 Processor, with M5 chip)
        m_apple_chip = re.search(
            r"\b(?:apple\s+)?(m[1-5](?:\s*max|\s*pro)?|a1[5-9](?:\s*pro)?)(?:\s+(?:chip|processor))?\b",
            t_norm,
        )
        if m_apple_chip:
            specs.cpu_brand = "apple"
            raw_chip = m_apple_chip.group(1).lower().strip()
            specs.cpu_family = re.sub(r"\s+", " ", raw_chip)
            specs.chip_family = specs.cpu_family

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

        # 11c. Screen Size Extraction (e.g. 13-inch, 15-inch, 13.6", 15.3")
        m_screen = re.search(r"\b(11|12|13|13\.3|13\.6|14|14\.2|15|15\.3|15\.6|16|16\.2|17|17\.3)\s*(?:-|inch|\"|\bin\b)\b", t_norm)
        if m_screen:
            val = float(m_screen.group(1))
            if val < 13.0:
                specs.screen_size = f"{val:g}-inch"
            elif val < 14.0:
                specs.screen_size = "13-inch"
            elif val < 15.0:
                specs.screen_size = "14-inch"
            elif val < 16.0:
                specs.screen_size = "15-inch"
            elif val < 17.0:
                specs.screen_size = "16-inch"
            else:
                specs.screen_size = f"{val:g}-inch"

        # 11d. Release Year Extraction (e.g. 2026, 2024)
        m_year = re.search(r"\b(202[0-9])\b", t_norm)
        if m_year:
            specs.release_year = m_year.group(1)

        # 12. MPN Extraction (Separating Apple/Manufacturer MPN from Amazon ASIN & Retailer SKUs)
        m_mpn = re.search(r"\b(MHF[A-Z0-9]+HN[/-]A|MD[A-Z0-9]+HN[/-]A|MR[A-Z0-9]+HN[/-]A|MX[A-Z0-9]+HN[/-]A|ML[A-Z0-9]+HN[/-]A|MG[A-Z0-9]+HN[/-]A|[A-Z]{2,4}\d{1,4}[A-Z0-9]{1,8}(?:/[A-Z0-9]+)?)\b", combined_text, re.IGNORECASE)
        if m_mpn:
            cand_code = m_mpn.group(1).upper().replace("-", "/")
            if not is_retailer_identifier(cand_code):
                specs.mpn = cand_code
                known = lookup_known_mpn(cand_code)
                if known:
                    if not specs.color and "color" in known:
                        specs.color = known["color"]
                    if not specs.storage and "storage" in known:
                        specs.storage = known["storage"]
                    if not specs.ram and "ram" in known:
                        specs.ram = known["ram"]
                    if not specs.screen_size and "screen_size" in known:
                        specs.screen_size = known["screen_size"]
                    if not specs.cpu_family and "cpu" in known:
                        specs.cpu_family = known["cpu"]
                        specs.cpu_brand = "apple"
                        specs.chip_family = known["cpu"]
                    if not specs.release_year and "year" in known:
                        specs.release_year = known["year"]
                    if not specs.product_family and "model" in known:
                        specs.product_family = known["model"]
                        specs.model_line = known["model"]

        # 12b. Monitor Specifications (Screen size, Refresh rate, Resolution)
        if specs.category == "monitor" or not specs.screen_size:
            m_mon_sz = re.search(r"\b(21(?:\.5)?|22|23|23\.8|24|24\.5|25|27|28|31\.5|32|34|43|49)\s*(?:-|inch|\"|\bin\b)\b", t_norm)
            if m_mon_sz:
                sz_f = float(m_mon_sz.group(1))
                if sz_f in (23.8, 24.5):
                    specs.screen_size = f"{sz_f:g}-inch"
                elif 23.0 <= sz_f < 25.0:
                    specs.screen_size = "24-inch"
                elif 26.5 <= sz_f <= 28.0:
                    specs.screen_size = "27-inch"
                elif 31.0 <= sz_f <= 33.0:
                    specs.screen_size = "32-inch"
                else:
                    specs.screen_size = f"{sz_f:g}-inch"

        m_hz = re.search(r"\b(60|75|100|120|144|165|170|180|200|240|280|360)\s*hz\b", t_norm)
        if m_hz:
            specs.refresh_rate = f"{m_hz.group(1)}Hz"

        m_res = re.search(r"\b(4k(?:\s*uhd)?|uhd|3840\s*x\s*2160|qhd|2k|1440p|2560\s*x\s*1440|wqhd|fhd|1080p|1920\s*x\s*1080)\b", t_norm)
        if m_res:
            res_str = m_res.group(1)
            if any(k in res_str for k in ("4k", "uhd", "3840")):
                specs.resolution = "4K UHD"
            elif any(k in res_str for k in ("qhd", "2k", "1440", "wqhd")):
                specs.resolution = "QHD 1440p"
            elif any(k in res_str for k in ("fhd", "1080", "1920")):
                specs.resolution = "FHD 1080p"

        # 12c. Storage & Component Interface Type
        has_sata = bool(re.search(r"\b(?:sata(?:\s*iii|\s*3)?|2\.5\s*inch)\b", t_norm))
        has_nvme = bool(re.search(r"\b(?:nvme|m\.2)\b", t_norm))
        has_gen4 = bool(re.search(r"\b(?:pcie\s*4\.0|4\.0|gen\s*4)\b", t_norm))
        has_gen3 = bool(re.search(r"\b(?:pcie\s*3\.0|3\.0|gen\s*3)\b", t_norm))

        if has_sata and not has_nvme:
            specs.interface_type = "SATA"
        elif has_gen4:
            specs.interface_type = "PCIe Gen 4 NVMe"
        elif has_gen3:
            specs.interface_type = "PCIe Gen 3 NVMe"
        elif has_nvme:
            specs.interface_type = "NVMe"

        # 12d. Sports / Everyday Product Size
        m_sz = re.search(r"\bsize(?:\s*:|\s+)\s*([1-7])\b", t_norm)
        if m_sz:
            specs.item_size = f"Size {m_sz.group(1)}"
        else:
            m_sz2 = re.search(r"\b(\d+\s*ml|\d+\s*litres?)\b", t_norm)
            if m_sz2:
                specs.item_size = m_sz2.group(1).title()

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
            "screen_size": cand.screen_size,
            "release_year": cand.release_year,
            "chip_family": cand.chip_family,
            "mpn": cand.mpn,
            "capacity": cand.capacity,
            "door_type": cand.door_type,
            "defrost_type": cand.defrost_type,
            "star_rating": cand.star_rating,
            "appliance_type": cand.appliance_type,
            "connectivity": cand.connectivity,
            "edition": cand.edition,
            "refresh_rate": cand.refresh_rate,
            "resolution": cand.resolution,
            "panel_type": cand.panel_type,
            "interface_type": cand.interface_type,
            "item_size": cand.item_size,
        }

        # Check for malformed or completely empty candidate data
        if not cand.raw_title or not cand.raw_title.strip() or (not cand.brand and not cand.product_family and not cand.category and not cand.ram and not cand.storage):
            return (
                MatchStatus.INSUFFICIENT_DATA,
                "Candidate extraction failed: insufficient product specifications found in listing.",
                RejectionCategory.INSUFFICIENT_DATA,
                cand_variants,
            )


        src_clean = normalize_title(source_title).lower()
        cand_clean = normalize_title(candidate_title).lower()
        cand_url_clean = (candidate_url or "").lower().replace("-", " ").replace("/", " ")

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
        # -------------------------------------------------------------
        # 2c. Controller & Gaming Peripheral Verification
        # -------------------------------------------------------------
        cand_url_clean = (candidate_url or "").lower().replace("-", " ").replace("/", " ")
        if source.category == "controller" or cand.category == "controller":
            if source.category != cand.category:
                return (
                    MatchStatus.MISMATCH,
                    f"Product category mismatch: source is {source.category}, candidate is {cand.category}.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )
            # Check connectivity first: wired vs wireless is a direct configuration mismatch
            if source.connectivity and cand.connectivity and source.connectivity != cand.connectivity:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Connectivity mismatch: source is {source.connectivity}, candidate is {cand.connectivity}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )

            if source.model_line and cand.model_line:
                src_c_ml = source.model_line.replace("-", "").replace(" ", "").lower()
                cand_c_ml = cand.model_line.replace("-", "").replace(" ", "").lower()
                if src_c_ml != cand_c_ml:
                    return (
                        MatchStatus.MISMATCH,
                        f"Controller model mismatch: source is {source.model_line.upper()}, candidate is {cand.model_line.upper()}.",
                        RejectionCategory.MODEL_MISMATCH,
                        cand_variants,
                    )
            elif source.model_line and not cand.model_line:
                src_ml_clean = source.model_line.lower()
                if src_ml_clean not in cand_clean and src_ml_clean not in cand_url_clean:
                    return (
                        MatchStatus.POSSIBLE_MATCH,
                        f"Controller model line unverified in competitor listing (source specifies {source.model_line.upper()}).",
                        RejectionCategory.UNVERIFIED_VARIANT,
                        cand_variants,
                    )
            elif cand.model_line and not source.model_line:
                cand_ml_clean = cand.model_line.lower()
                if cand_ml_clean not in src_clean:
                    return (
                        MatchStatus.POSSIBLE_MATCH,
                        f"Competitor listing specifies model {cand.model_line.upper()}, unverified in source listing.",
                        RejectionCategory.UNVERIFIED_VARIANT,
                        cand_variants,
                    )

            if source.connectivity and not cand.connectivity:
                return (
                    MatchStatus.POSSIBLE_MATCH,
                    f"Connectivity unverified in competitor listing (source specifies {source.connectivity}).",
                    RejectionCategory.UNVERIFIED_VARIANT,
                    cand_variants,
                )

        # 2d. Monitor & Display Specific Verification
        # -------------------------------------------------------------
        if source.category == "monitor" or cand.category == "monitor":
            if source.category != cand.category:
                return (
                    MatchStatus.MISMATCH,
                    f"Product category mismatch: source is {source.category}, candidate is {cand.category}.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )
            if source.screen_size and cand.screen_size and source.screen_size != cand.screen_size:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Screen size mismatch: source {source.screen_size}, candidate {cand.screen_size}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
            if source.refresh_rate and cand.refresh_rate and source.refresh_rate != cand.refresh_rate:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Refresh rate mismatch: source {source.refresh_rate}, candidate {cand.refresh_rate}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
            elif source.refresh_rate and not cand.refresh_rate:
                return (
                    MatchStatus.POSSIBLE_MATCH,
                    f"Refresh rate unverified in competitor listing (source specifies {source.refresh_rate}).",
                    RejectionCategory.UNVERIFIED_VARIANT,
                    cand_variants,
                )
            if source.resolution and cand.resolution and source.resolution != cand.resolution:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Display resolution mismatch: source {source.resolution}, candidate {cand.resolution}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )

        # 2e. Storage Device & Component Verification
        # -------------------------------------------------------------
        if source.category == "storage" or cand.category == "storage":
            if source.category != cand.category:
                return (
                    MatchStatus.MISMATCH,
                    f"Product category mismatch: source is {source.category}, candidate is {cand.category}.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )
            if source.model_line and cand.model_line:
                src_s_ml = source.model_line.replace("-", "").replace(" ", "").lower()
                cand_s_ml = cand.model_line.replace("-", "").replace(" ", "").lower()
                if src_s_ml != cand_s_ml:
                    return (
                        MatchStatus.MISMATCH,
                        f"Storage model line mismatch: source {source.model_line.title()}, candidate {cand.model_line.title()}.",
                        RejectionCategory.MODEL_MISMATCH,
                        cand_variants,
                    )
            if source.storage and cand.storage and source.storage != cand.storage:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Storage capacity mismatch: source {source.storage}, candidate {cand.storage}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
            if source.interface_type and cand.interface_type:
                src_is_sata = "SATA" in source.interface_type
                cand_is_sata = "SATA" in cand.interface_type
                if src_is_sata != cand_is_sata:
                    return (
                        MatchStatus.CONFIGURATION_MISMATCH,
                        f"Interface mismatch: source {source.interface_type}, candidate {cand.interface_type}.",
                        RejectionCategory.CONFIG_MISMATCH,
                        cand_variants,
                    )
                if source.interface_type != cand.interface_type:
                    # e.g. Gen 4 vs unverified Gen (just "NVMe")
                    if source.interface_type in ("PCIe Gen 4 NVMe", "PCIe Gen 3 NVMe") and cand.interface_type == "NVMe":
                        return (
                            MatchStatus.POSSIBLE_MATCH,
                            f"Interface generation unverified in competitor listing (source specifies {source.interface_type}).",
                            RejectionCategory.UNVERIFIED_VARIANT,
                            cand_variants,
                        )
                    return (
                        MatchStatus.CONFIGURATION_MISMATCH,
                        f"Interface mismatch: source {source.interface_type}, candidate {cand.interface_type}.",
                        RejectionCategory.CONFIG_MISMATCH,
                        cand_variants,
                    )

        # 2f. Sports & Everyday Consumer Products Verification
        # -------------------------------------------------------------
        if source.category == "sports" or cand.category == "sports":
            if source.category != cand.category:
                return (
                    MatchStatus.MISMATCH,
                    f"Product category mismatch: source is {source.category}, candidate is {cand.category}.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )
            if source.model_line and cand.model_line:
                src_sp_ml = source.model_line.replace("-", "").replace(" ", "").lower()
                cand_sp_ml = cand.model_line.replace("-", "").replace(" ", "").lower()
                if src_sp_ml != cand_sp_ml:
                    return (
                        MatchStatus.MISMATCH,
                        f"Product model mismatch: source {source.model_line.title()}, candidate {cand.model_line.title()}.",
                        RejectionCategory.MODEL_MISMATCH,
                        cand_variants,
                    )
            if source.item_size and cand.item_size and source.item_size != cand.item_size:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Product size mismatch: source {source.item_size}, candidate {cand.item_size}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )

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



        # -------------------------------------------------------------
        # -------------------------------------------------------------
        # 3. Brand Identity Check (Mandatory)
        # -------------------------------------------------------------
        cand_url_clean = (candidate_url or "").lower().replace("-", " ").replace("/", " ")
        if source.brand and cand.brand:
            if source.brand != cand.brand:
                return (
                    MatchStatus.MODEL_MISMATCH,
                    f"Brand mismatch: {source.brand.title()} vs {cand.brand.title()}.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )
        elif source.brand and not cand.brand:
            if source.brand not in cand_clean and source.brand not in cand_url_clean:
                return (
                    MatchStatus.MODEL_MISMATCH,
                    f"Brand mismatch: source is {source.brand.title()}, not found in competitor listing or URL.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )
        elif cand.brand and not source.brand:
            if cand.brand not in src_clean:
                return (
                    MatchStatus.MODEL_MISMATCH,
                    f"Brand mismatch: candidate is {cand.brand.title()}, not in source listing.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )

        # -------------------------------------------------------------
        # 4. Product Family Identity (Mandatory — Fail Closed)
        # -------------------------------------------------------------
        if source.product_family:
            if not cand.product_family:
                return (
                    MatchStatus.MODEL_MISMATCH,
                    f"Product family missing: candidate does not specify required family '{source.product_family.title()}'.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )
            src_fam = source.product_family.replace("-", " ").replace(" ", "")
            cand_fam = cand.product_family.replace("-", " ").replace(" ", "")
            if src_fam != cand_fam:
                return (
                    MatchStatus.MODEL_MISMATCH,
                    f"Product family mismatch: source '{source.product_family.title()}', candidate '{cand.product_family.title()}'.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )
        elif cand.product_family:
            return (
                MatchStatus.MODEL_MISMATCH,
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
                    MatchStatus.MODEL_MISMATCH,
                    f"Model mismatch: {source.model_line} vs {cand.model_line}.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )

        # -------------------------------------------------------------
        # 4b. Manufacturer Part Number (MPN) Cross-Check
        # -------------------------------------------------------------
        if source.mpn and cand.mpn:
            if not is_retailer_identifier(source.mpn) and not is_retailer_identifier(cand.mpn):
                def get_base_mpn(m: str) -> str:
                    s = m.replace("-", "/").strip().upper()
                    s = re.sub(r"[A-Z]{2}/[A-Z]$", "", s)
                    if "/" in s:
                        s = s.split("/")[0]
                    return s

                src_base = get_base_mpn(source.mpn)
                cand_base = get_base_mpn(cand.mpn)
                if src_base and cand_base and src_base != cand_base:
                    return (
                        MatchStatus.MODEL_MISMATCH,
                        f"Model identifier mismatch: source {source.mpn}, candidate {cand.mpn}",
                        RejectionCategory.MODEL_MISMATCH,
                        cand_variants,
                    )

        # -------------------------------------------------------------
        # 5. Model Qualifiers & Generation Check
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
                MatchStatus.MODEL_MISMATCH,
                f"Model tier mismatch ({src_str} vs {cand_str}).",
                RejectionCategory.MODEL_MISMATCH,
                cand_variants,
            )

        # -------------------------------------------------------------
        # 6. Screen Size Verification
        # -------------------------------------------------------------
        if source.screen_size and cand.screen_size:
            if source.screen_size != cand.screen_size:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Screen size mismatch: source {source.screen_size}, candidate {cand.screen_size}",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )

        # -------------------------------------------------------------
        # 7. Processor Verification (CPU Brand, Family, Model)
        # -------------------------------------------------------------
        if source.cpu_brand and cand.cpu_brand and source.cpu_brand != cand.cpu_brand:
            return (
                MatchStatus.CONFIGURATION_MISMATCH,
                f"Processor brand mismatch: source {source.cpu_brand.upper()}, candidate {cand.cpu_brand.upper()}",
                RejectionCategory.CONFIG_MISMATCH,
                cand_variants,
            )

        if source.cpu_family and cand.cpu_family:
            src_cf = source.cpu_family.replace(" ", "")
            cand_cf = cand.cpu_family.replace(" ", "")
            if src_cf != cand_cf:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Chip mismatch: source {source.cpu_family.upper()}, candidate {cand.cpu_family.upper()}",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )

        if source.cpu_model and cand.cpu_model and source.cpu_model != cand.cpu_model:
            return (
                MatchStatus.CONFIGURATION_MISMATCH,
                f"Processor model mismatch: source {source.cpu_model}, candidate {cand.cpu_model}",
                RejectionCategory.CONFIG_MISMATCH,
                cand_variants,
            )

        # If source is a laptop and specifies processor, but candidate completely omits processor
        if source.category == "laptop" and source.cpu_family and not cand.cpu_family:
            return (
                MatchStatus.POSSIBLE_MATCH,
                f"Processor specification unverified in competitor listing (source specifies {source.cpu_family.title()}).",
                RejectionCategory.UNVERIFIED_VARIANT,
                cand_variants,
            )

        # -------------------------------------------------------------
        # 8. Dedicated GPU Verification (Gaming Laptops)
        # -------------------------------------------------------------
        if source.gpu_model:
            if not cand.gpu_model:
                return (
                    MatchStatus.POSSIBLE_MATCH,
                    f"Graphics GPU unverified in competitor listing (source specifies {source.gpu_model.upper()}).",
                    RejectionCategory.UNVERIFIED_VARIANT,
                    cand_variants,
                )
            src_gm = source.gpu_model.replace(" ", "")
            cand_gm = cand.gpu_model.replace(" ", "")
            if src_gm != cand_gm:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"GPU model mismatch: source {source.gpu_model.upper()}, candidate {cand.gpu_model.upper()}",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
        elif cand.gpu_model and source.category == "laptop":
            return (
                MatchStatus.CONFIGURATION_MISMATCH,
                f"GPU specification divergence: competitor listing includes {cand.gpu_model.upper()}, not in source.",
                RejectionCategory.CONFIG_MISMATCH,
                cand_variants,
            )

        # -------------------------------------------------------------
        # 9. RAM Capacity Verification
        # -------------------------------------------------------------
        if source.ram:
            if cand.ram and source.ram != cand.ram:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"RAM capacity mismatch: source {source.ram}, candidate {cand.ram}",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
            elif not cand.ram and source.category == "laptop":
                return (
                    MatchStatus.POSSIBLE_MATCH,
                    f"RAM capacity unverified in competitor listing (source specifies {source.ram}).",
                    RejectionCategory.UNVERIFIED_VARIANT,
                    cand_variants,
                )

        # -------------------------------------------------------------
        # 10. Storage Capacity Verification
        # -------------------------------------------------------------
        if source.storage:
            if not cand.storage:
                return (
                    MatchStatus.POSSIBLE_MATCH,
                    f"Storage capacity unverified in competitor listing (source specifies {source.storage}).",
                    RejectionCategory.UNVERIFIED_VARIANT,
                    cand_variants,
                )
            elif source.storage != cand.storage:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Storage capacity mismatch: source {source.storage}, candidate {cand.storage}",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )

        # -------------------------------------------------------------
        # 11. Exact Color Variant Matching
        # -------------------------------------------------------------
        if source.color:
            src_color = canonicalize_color(source.color)
            cand_color = canonicalize_color(cand.color)

            if not cand_color:
                return (
                    MatchStatus.POSSIBLE_MATCH,
                    f"Color unverified (colour unverified): candidate does not specify '{src_color.title()}' and model identifier unavailable",
                    RejectionCategory.UNVERIFIED_VARIANT,
                    cand_variants,
                )
            elif src_color != cand_color:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Color variant mismatch: source specifies {src_color.title()}, competitor listing is {cand_color.title()}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )

        # -------------------------------------------------------------
        # 12. Final Exact Match Verification
        # -------------------------------------------------------------
        return (
            MatchStatus.EXACT_MATCH,
            "Exact product model and hardware configuration match.",
            RejectionCategory.VALID_MATCH,
            cand_variants,
        )
