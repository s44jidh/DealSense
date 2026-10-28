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
    category: Optional[str] = None  # "laptop", "smartphone", "audio", "tablet", "accessory", "service_plan", "controller", "kitchen_home", "footwear", "clothing", "personal_care", "toys_games", "watches", "bags_luggage", etc.
    brand: Optional[str] = None
    product_family: Optional[str] = None  # e.g. "aspire one", "aspire 3", "alienware 15", "g15"
    model_line: Optional[str] = None
    model_name: Optional[str] = None
    model_number: Optional[str] = None
    generic_model: Optional[str] = None  # generic model / style code (e.g. "pkoss 1.5", "hd9200", "qt4011", "511", "smash v2", "10698")
    model_qualifiers: list[str] = field(default_factory=list)
    mpn: Optional[str] = None
    gtin: Optional[str] = None
    is_service_plan: bool = False
    controller_subtype: Optional[str] = None  # "pc", "mobile", "console"
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
    volume_capacity: Optional[str] = None  # e.g. "1.5L", "4.2L", "500ML", "5L"
    power_wattage: Optional[str] = None  # e.g. "1500W", "750W", "2000W"
    pack_count: Optional[int] = None  # e.g. 1, 2, 3, 5
    apparel_size: Optional[str] = None  # e.g. "UK 8", "SIZE 9", "XL", "L", "M", "S", "32", "34"
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
    isbn: Optional[str] = None  # e.g. "9781847941831", "9390166268"
    book_author: Optional[str] = None
    component_type: Optional[str] = None  # "ram", "gpu", "cpu", "motherboard", "psu"
    fragrance: Optional[str] = None


# Known brand names (lowercase) across electronics, appliances, lifestyle, fashion, and home
KNOWN_BRANDS = [
    # Electronics, Gaming & Computing
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
    "hitachi", "carrier", "blue star", "lloyd", "benq", "viewsonic", "aoc",
    "msi", "gigabyte", "backbone", "redragon", "keychron", "royal kludge",
    "tvs", "aula", "epomaker", "magegee",

    # Kitchen, Home & Large Appliances
    "prestige", "pigeon", "butterfly", "hawkins", "bajaj", "havells", "crompton",
    "usha", "morphy richards", "borosil", "milton", "cello", "wonderchef",
    "kent", "aquaguard", "eureka forbes", "sujata", "lifelong", "agaro", "inalsa",

    # Footwear & Sports
    "puma", "nike", "adidas", "reebok", "asics", "skechers", "crocs",
    "bata", "woodland", "campus", "red tape", "sparx", "flite", "clarks",
    "under armour", "new balance", "nivia", "cosco", "yonex", "vector x",

    # Clothing & Fashion Apparel
    "levi's", "levis", "levi s", "levi", "wrangler", "pepe jeans", "spykar", "allen solly",
    "van heusen", "louis philippe", "peter england", "arrow", "park avenue",
    "raymond", "us polo assn", "u.s. polo assn.", "u s polo assn", "us polo", "polo assn", "tommy hilfiger", "calvin klein",
    "zara", "h&m", "marks & spencer", "max", "pantaloons", "biba", "w", "aurelia",

    # Personal Care, Skincare & Grooming
    "braun", "oral-b", "veet", "gillette", "nova", "syska", "beardo",
    "minimalist", "biotique", "derma co", "the derma co", "plum", "mamaearth",
    "wow", "nivea", "garnier", "l'oreal", "cetaphil", "neutrogena", "dot & key",
    "mcaffeine", "foxtale", "himalaya",

    # Household Supplies & Cleaning
    "surf excel", "vim", "ariel", "harpic", "lizol", "colin", "comfort", "dettol",
    "godrej aer", "presto", "pril", "tide", "rin", "all out", "good knight",
    "scotch-brite", "odonil",

    # Books & Publishers
    "james clear", "morgan housel", "robert kiyosaki", "penguin", "harpercollins",
    "bloomsbury", "rupa", "o'reilly", "scholastic", "oxford", "pearson",

    # Computer Components & PC Hardware
    "crucial", "corsair", "g.skill", "kingston", "zotac", "deepcool", "antec",
    "cooler master", "thermaltake", "inno3d", "galax", "sapphire", "xfx",

    # Toys & Games
    "lego", "hot wheels", "hasbro", "mattel", "nerf", "funskool", "barbie", "fisher-price",

    # Watches & Wearables
    "casio", "g-shock", "titan", "fastrack", "sonata", "timex", "fossil",
    "citizen", "seiko", "fire-boltt", "amazfit",

    # Bags & Luggage
    "american tourister", "skybags", "safari", "vip", "wildcraft", "aristocrat",
    "lavie", "caprese", "baggit"
]

# Service plans, extended warranties, and protection packs
SERVICE_PLAN_TERMS = [
    r"\bapplecare\+?\b",
    r"\bprotection\s*plan\b",
    r"\bservice\s*(?:plan|contract|pack)\b",
    r"\bextended\s*warranty\b",
    r"\bcare\s*pack\b",
    r"\bdamage\s*protection\b",
    r"\bdevice\s*protection\b",
    r"\baccidental\s*damage\b",
    r"\bwarranty\s*pack\b",
    r"\bmaintenance\s*plan\b",
    r"\binsurance\b",
    r"\bamc\b",
]

# Non-gaming / electrical / smart home controllers
NON_GAMING_CONTROLLER_TERMS = [
    r"\bled\s*(?:strip)?\s*(?:light\s*)?controller\b",
    r"\bcct\s*(?:led\s*)?(?:strip\s*)?controller\b",
    r"\brgb\s*(?:fan\s*|light\s*|strip\s*)controller\b",
    r"\bsolar\s*(?:charge\s*)?controller\b",
    r"\bmotor\s*(?:speed\s*)?controller\b",
    r"\btemperature\s*controller\b",
    r"\bthermostat\b",
    r"\bcircuit\s*breaker\b",
    r"\bsmart\s*(?:circuit\s*)?breaker\b",
    r"\bsmart\s*switch\b",
    r"\bmidi\s*controller\b",
    r"\bdj\s*controller\b",
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
    r"\bsilicone\s*cover\b", r"\bthumb\s*grips?\b", r"\bthumbsticks?\b",
    r"\banalog\s*sticks?\b", r"\bjoystick\s*caps?\b", r"\bjoystick\s*cover\b",
    r"\btrigger\s*buttons?\b", r"\bcontroller\s*skin\b", r"\bcontroller\s*stand\b",
    r"\b(?:controller\s*)?charging\s*(?:dock|station|stand)\b",
    r"\bwireless\s*receiver\b", r"\busb\s*dongle\b", r"\bdongle\s*only\b", r"\breceiver\s*only\b",
    r"\bcase\b", r"\bcover\b", r"\btempered glass\b", r"\bscreen protector\b",
    r"\bback panel\b", r"\bback cover\b", r"\bcharger\b", r"\bcable\b",
    r"\badapter\b", r"\bpouch\b", r"\bsleeve\b", r"\bskin\b", r"\bstrap\b",
    r"\bband\b", r"\bstand\b", r"\bmount\b", r"\bspares\b", r"\bear tips\b",
    r"\bear\s*pads?\b", r"\bearpads?\b", r"\breplacement\s*(?:ear\s*)?pads?\b",
    r"\bheadband\b", r"\bheadphone\s*case\b", r"\bprotective\s*case\b",
    r"\bcushion\b", r"\bcarrying case\b", r"\bholster\b", r"\bkeyboard protector\b",
    r"\bkeycaps?\b", r"\bkeyboard\s*cover\b"
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
    "navy blue", "navy", "teal green", "silver", "black", "white", "blue", "teal", "ultramarine", "pink",
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
    "navy": "navy blue",
    "teal green": "teal",
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
    (e.g., Amazon ASIN 'B0GR1C18B7' or Flipkart PID 'COMHZQX4QGCYC8SK' / 'ITM123') rather than
    a manufacturer model identifier (MPN).
    """
    if not token:
        return False
    t_up = token.strip().upper()
    # Amazon ASIN (B0 followed by alphanumeric characters)
    if re.match(r"^B0[A-Z0-9]+$", t_up):
        return True
    # Flipkart product/listing IDs
    if re.match(r"^(?:COM|ITM|LST|MOB|TAB|LAP)[A-Z0-9]+$", t_up):
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

    # Normalize brand variations
    t = re.sub(r"\bant\s*esports?\b", "ant esports", t, flags=re.IGNORECASE)
    t = re.sub(r"\bred\s*gear\b", "redgear", t, flags=re.IGNORECASE)
    t = re.sub(r"\bevo\s*fox\b", "evofox", t, flags=re.IGNORECASE)
    t = re.sub(r"\bcosmic\s*[-]?\s*byte\b", "cosmic byte", t, flags=re.IGNORECASE)
    t = re.sub(r"\bsteel\s*[-]?\s*series\b", "steelseries", t, flags=re.IGNORECASE)
    t = re.sub(r"\bhyper\s*[-]?\s*x\b", "hyperx", t, flags=re.IGNORECASE)
    t = re.sub(r"\broyal\s*[-]?\s*kludge\b", "royal kludge", t, flags=re.IGNORECASE)

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
        category_hint: Optional[str] = None,
        brand_hint: Optional[str] = None,
        model_hint: Optional[str] = None,
        specs_hint: Optional[dict[str, Any]] = None,
    ) -> ProductSpecs:
        """
        Extracts structured product specifications from raw title, optional variant hint,
        URL slug, and optional category/brand/model/spec hints.
        """
        combined_text = title
        if variant_hint:
            combined_text += " " + variant_hint
        if url_hint:
            clean_url = url_hint.split("?")[0]
            clean_url = re.sub(r"/(?:p|dp)/[a-zA-Z0-9]+", " ", clean_url)
            clean_url = clean_url.replace("-", " ").replace("/", " ")
            combined_text += " " + clean_url

        t_norm = normalize_title(combined_text).lower()
        specs = ProductSpecs(raw_title=title)

        # 1. Service Plan / Protection Pack detection
        for pattern in SERVICE_PLAN_TERMS:
            if re.search(pattern, t_norm):
                specs.is_service_plan = True
                specs.category = "service_plan"
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

        if not specs.brand and brand_hint and brand_hint.strip() and brand_hint.lower() not in ("generic", "unknown", "visit"):
            specs.brand = brand_hint.strip().lower()

        if not specs.brand and t_norm.split():
            first_w = t_norm.split()[0]
            if first_w in KNOWN_BRANDS:
                specs.brand = first_w

        # Canonicalize brand
        if specs.brand in ("levi s", "levi", "levis"):
            specs.brand = "levi's"
        elif specs.brand in ("u s polo assn", "us polo", "u.s. polo", "polo assn", "u.s. polo assn."):
            specs.brand = "us polo assn"

        # 5. Category Hint Mapping
        if category_hint and not specs.category:
            c_h = category_hint.strip().lower().replace("-", "_").replace(" ", "_")
            cat_map = {
                "kitchen": "kitchen_home",
                "kitchen_home": "kitchen_home",
                "home_kitchen": "kitchen_home",
                "appliances": "kitchen_home",
                "kitchen_appliances": "kitchen_home",
                "small_appliances": "kitchen_home",
                "cookware": "kitchen_home",
                "home_appliances": "kitchen_home",
                "footwear": "footwear",
                "shoes": "footwear",
                "clothing": "clothing",
                "apparel": "clothing",
                "fashion": "clothing",
                "personal_care": "personal_care",
                "grooming": "personal_care",
                "beauty": "beauty",
                "skincare": "beauty",
                "haircare": "beauty",
                "cosmetics": "beauty",
                "household": "household",
                "cleaning": "household",
                "home_care": "household",
                "books": "books",
                "book": "books",
                "novel": "books",
                "textbook": "books",
                "computer_components": "computer_components",
                "components": "computer_components",
                "ram": "computer_components",
                "toys": "toys_games",
                "toys_games": "toys_games",
                "games": "toys_games",
                "watches": "watches",
                "bags": "bags_luggage",
                "luggage": "bags_luggage",
                "bags_luggage": "bags_luggage",
                "backpacks": "bags_luggage",
                "laptop": "laptop",
                "laptops": "laptop",
                "smartphone": "smartphone",
                "smartphones": "smartphone",
                "phones": "smartphone",
                "audio": "audio",
                "headphones": "audio",
                "storage": "storage",
                "controller": "controller",
                "keyboard": "keyboard",
                "mouse": "mouse",
                "monitor": "monitor",
                "refrigerator": "refrigerator",
                "sports": "sports",
            }
            if c_h in cat_map:
                specs.category = cat_map[c_h]

        # 6. Device & Product Category Detection
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
                r"\b(?:racing\s*wheel|driving\s*force|steering\s*wheel|gamepad|flight\s*stick|fight\s*stick|arcade\s*stick|backbone\s*one)\b",
                t_norm,
            ) or (
                re.search(r"\b(?:controller|joystick)\b", t_norm)
                and any(w in t_norm for w in (
                    "game", "gaming", "pc", "windows", "xbox", "playstation", "ps4", "ps5", "switch",
                    "wireless", "wired", "bluetooth", "rumble", "hall effect", "trigger", "d-pad", "dpad",
                    "cosmic byte", "evofox", "redgear", "kreo", "8bitdo", "gamesir", "flydigi", "thrustmaster", "logitech",
                    "ant esports", "amkette", "zebronics", "portronics", "fantech", "claw", "redragon"
                ))
            ):
                specs.category = "controller"
            elif re.search(
                r"\b(?:wh\s*[-]?\s*1000xm\d|wf\s*[-]?\s*1000xm\d|headphones|headset|earphones|earbuds|airpods|galaxy buds|neckband|over\s*ear|in\s*ear)\b",
                t_norm,
            ):
                specs.category = "audio"
            elif re.search(
                r"\b(?:(?:laptop|desktop|pc)?\s*(?:ram|memory|ddr[345]|sodimm|udimm)|graphics\s*card|video\s*card|\bgpu\b|motherboard|\bprocessor\b|intel\s*core|amd\s*ryzen|power\s*supply|\bsmps\b|pc\s*cabinet|pc\s*case)\b",
                t_norm,
            ) and not re.search(r"\b(?:laptop\s*bag|laptop\s*backpack|laptop\s*stand|laptop\s*table|laptop\s*sleeve)\b", t_norm):
                specs.category = "computer_components"
            elif re.search(
                r"\b(?:internal\s*ssd|external\s*ssd|nvme\s*ssd|m\.2\s*ssd|portable\s*ssd|sata\s*ssd|solid\s*state\s*drive|internal\s*hdd|external\s*hdd|hard\s*drive|flash\s*drive|pen\s*drive|pendrive|usb\s*drive|otg\s*drive|dual\s*drive|thumb\s*drive|micro\s*sd|sd\s*card|memory\s*card|\bm\.2\b|\bnvme\b|\bssd\b)\b",
                t_norm,
            ):
                specs.category = "storage"
            elif re.search(
                r"\b(?:mechanical\s*keyboard|gaming\s*keyboard|wireless\s*keyboard|wired\s*keyboard|membrane\s*keyboard|rgb\s*keyboard|\bkeyboards?\b)\b",
                t_norm,
            ):
                specs.category = "keyboard"
            elif re.search(
                r"\b(?:gaming\s*mouse|wireless\s*mouse|wired\s*mouse|optical\s*mouse|bluetooth\s*mouse|trackball|\bmice\b|\bmouse\b)\b",
                t_norm,
            ) and not re.search(r"\b(?:mouse\s*pad|mousepad|desk\s*mat)\b", t_norm):
                specs.category = "mouse"
            elif re.search(
                r"\b(?:macbook|chromebook|thinkpad|zenbook|ideapad|vivobook|expertbook|alienware|inspiron|aspire|predator|nitro|omen|victus|pavilion|legion|loq|tuf|rog|laptop|notebook)\b",
                t_norm,
            ) and not re.search(r"\b(?:keyboard|keyboards|mouse|mice|ram|memory|sodimm|udimm|backpack|bag|sleeve|skin|stand|table)\b", t_norm):
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
                r"\b(?:football|soccer\s*ball|basketball|volleyball|badminton\s*racquet|tennis\s*racquet|water\s*bottle|flask|shaker)\b",
                t_norm,
            ):
                specs.category = "sports"
            elif re.search(
                r"\b(?:electric\s*kettle|kettle|mixer\s*grinder|air\s*fryer|blender|toaster|juicer|food\s*processor|sandwich\s*maker|induction\s*cooktop|pressure\s*cooker|cookware|frying\s*pan|kadai|saucepan|microwave(?:\s*oven)?|vacuum\s*cleaner|water\s*purifier|geyser|water\s*heater|steam\s*iron|\biron\b)\b",
                t_norm,
            ):
                specs.category = "kitchen_home"
            elif re.search(
                r"\b(?:sneakers?|running\s*shoes?|walking\s*shoes?|casual\s*shoes?|formal\s*shoes?|clogs?|loafers?|sandals?|slippers?|flip\s*flops?|boots?|crocs)\b",
                t_norm,
            ):
                specs.category = "footwear"
            elif re.search(
                r"\b(?:jeans|denim|t-shirt|tshirt|shirt|polo|trousers?|chinos?|hoodie|sweatshirt|jacket|kurta|shorts?|joggers?|track\s*pants?)\b",
                t_norm,
            ):
                specs.category = "clothing"
            elif re.search(
                r"\b(?:sunscreen|face\s*wash|serum|shampoo|conditioner|moisturizer|face\s*cream|body\s*lotion|perfume|deodorant|body\s*wash|cleanser|sun\s*cream|sun\s*gel|spf\s*\d+|lip\s*balm|kajal|mascara|lipstick|beard\s*oil)\b",
                t_norm,
            ):
                specs.category = "beauty"
            elif re.search(
                r"\b(?:detergent|dishwash|floor\s*cleaner|toilet\s*cleaner|disinfectant|surface\s*cleaner|garbage\s*bags?|trash\s*bags?|liquid\s*detergent|fabric\s*conditioner|mosquito\s*refill|liquid\s*vaporizer|mop|scrub\s*pad)\b",
                t_norm,
            ):
                specs.category = "household"
            elif re.search(
                r"\b(?:paperback|hardcover|kindle\s*edition|novel|novels|textbook|author|isbn|illustrated\s*edition)\b",
                t_norm,
            ) or (
                re.search(r"\bbook\b", t_norm)
                and not any(w in t_norm for w in ("macbook", "chromebook", "notebook", "facebook", "zenbook", "ideapad", "vivobook", "surface"))
            ):
                specs.category = "books"
            elif re.search(
                r"\b(?:beard\s*trimmer|hair\s*trimmer|trimmer|shaver|hair\s*dryer|hair\s*straightener|electric\s*toothbrush|epilator)\b",
                t_norm,
            ):
                specs.category = "personal_care"
            elif re.search(
                r"\b(?:lego|building\s*blocks?|brick\s*box|hot\s*wheels|board\s*game|action\s*figure|puzzle|nerf)\b",
                t_norm,
            ):
                specs.category = "toys_games"
            elif re.search(
                r"\b(?:analog\s*watch|digital\s*watch|chronograph(?:\s*watch)?|wristwatch|wrist\s*watch)\b",
                t_norm,
            ) or (
                re.search(r"\bwatch\b", t_norm)
                and not any(w in t_norm for w in ("smartwatch", "apple watch", "galaxy watch", "fire-boltt", "noise", "boat", "amazfit"))
            ):
                specs.category = "watches"
            elif re.search(
                r"\b(?:backpack|rucksack|duffel\s*bag|trolley\s*bag|luggage|suitcase|messenger\s*bag|laptop\s*backpack|school\s*bag)\b",
                t_norm,
            ):
                specs.category = "bags_luggage"

        # Accessory detection across all items (even if category was previously matched)
        is_accessory_listing = False
        if re.search(
            r"\b(?:(?:hard\s+|shockproof\s+|silicone\s+|protective\s+|travel\s+|leather\s+|clear\s+)?(?:case|cover|skin|sleeve|stand|mount|shifter|cushion|headband|ear\s*pads?|earpads?|protector|strap)|replacement\s+\w+)\s+(?:for|compatible\s+with)\b",
            t_norm,
        ):
            is_accessory_listing = True
        elif re.search(
            r"^(?:(?:hard\s+|shockproof\s+|silicone\s+|protective\s+|travel\s+|clear\s+)?(?:case|cover|skin|sleeve|stand|mount|shifter|cushion|headband|ear\s*pads?|earpads?|protector|screen\s*protector)|replacement|soulwit)\b",
            t_norm,
        ):
            is_accessory_listing = True
        elif re.search(
            r"\b(?:shifter|wheel\s*stand|pedal\s*mount|headband\s*cushion|replacement\s*(?:headband|cushion|ear\s*pads?|earpads?)|ear\s*pads?|earpads?|thumb\s*grips?|joystick\s*caps?|silicone\s*(?:cover|case)|protective\s*(?:case|cover)|keyboard\s*(?:cover|skin|protector)|controller\s*(?:skin|silicone|cover)|mouse\s*pad|mousepad|desk\s*mat)\b",
            t_norm,
        ):
            is_accessory_listing = True

        if is_accessory_listing:
            if not any(w in t_norm for w in ("backpack", "duffel", "trolley", "suitcase")) or "case for" in t_norm:
                specs.is_accessory = True
                specs.category = "accessory"

        # Accessory & Non-gaming Controller detection (after primary categories)
        if not specs.category:
            for pattern in NON_GAMING_CONTROLLER_TERMS:
                if re.search(pattern, t_norm):
                    specs.category = "electrical_controller"
                    break

        if not specs.category:
            for pattern in ACCESSORY_TERMS:
                if re.search(pattern, t_norm):
                    if pattern in (r"\bcover\b", r"\bcase\b") and any(w in t_norm for w in ("backpack", "bag", "luggage", "suitcase", "rain cover", "dust cover")):
                        continue
                    if pattern == r"\bpouch\b" and any(w in t_norm for w in ("detergent", "refill", "liquid", "surf", "vim", "ariel", "rin", "tea", "coffee")):
                        continue
                    if pattern == r"\bcable\b" and any(w in t_norm for w in ("mouse", "mice", "keyboard", "controller", "headphone", "earphone", "headset", "iron")):
                        continue
                    if pattern == r"\badapter\b" and any(w in t_norm for w in ("flash drive", "otg", "pen drive", "drive", "sandisk", "dual drive")):
                        continue
                    specs.is_accessory = True
                    specs.category = "accessory"
                    break

        # 6. Product Family & Model Line Extraction
        # Monitors & Displays
        if specs.category == "monitor" or "monitor" in t_norm:
            m_mon = re.search(r"\b(ultragear|odyssey(?:\s*[a-z]\d+)?|predator|nitro|tuf|mobiuz)\b", t_norm)
            if m_mon:
                specs.model_line = m_mon.group(1).lower()
                specs.product_family = specs.model_line

        # Storage Devices & Components
        if specs.category == "storage" or any(s in t_norm for s in ("ssd", "nvme", "hdd")):
            m_ssd = re.search(r"\b(bx500|mx500|p3\s*plus|p3|t500|t700|980\s*pro|990\s*pro|970\s*evo(?:\s*plus)?|870\s*evo|870\s*qvo|sn770|sn850x|sn580|sn570|nv2|kc3000|extreme\s*portable|ultra\s*dual\s*drive(?:\s*go|\s*luxe)?|cruzer\s*blade|cruzer\s*glide|ultra\s*flair|ultra\s*shift|extreme\s*pro)\b", t_norm)
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
        if specs.category == "controller" or any(b in t_norm for b in ("logitech", "razer", "thrustmaster", "dualsense", "dualshock", "xbox", "backbone", "cosmic byte", "ant esports", "redgear", "evofox", "kreo")):
            # Ant Esports
            m_ae_c = re.search(r"\b(superpower|supernova(?:\s*lite)?|gp\s*300(?:\s*pro(?:\s*v2)?)?|gp\s*310r?|gp\s*325|gp\s*365(?:\s*pro)?|gp\s*400|gp\s*100|gp\s*130|gpl\s*200|gpl\s*300|combatant(?:\s*\d+)?|cosmos|mg\s*15(?:\s*super\s*cube)?|ultranova)\b", t_norm)
            if m_ae_c and (specs.brand == "ant esports" or "ant esports" in t_norm):
                specs.model_line = m_ae_c.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "ant esports"
                specs.category = "controller"

            # Cosmic Byte
            m_cb = re.search(r"\b(ares|blitz|nebula|stratos|quantum|stellaris|interstellar|themis|equinox|c1070t|c3070w|ebon|orion|firestorm|callisto|kilonova|hydra)\b", t_norm)
            if m_cb and (specs.brand == "cosmic byte" or "cosmic byte" in t_norm):
                specs.model_line = m_cb.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "cosmic byte"
                specs.category = "controller"

            # Backbone
            m_bb = re.search(r"\b(backbone\s*one(?:\s*gen\s*2)?|backbone)\b", t_norm)
            if m_bb:
                specs.model_line = "backbone one"
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "backbone"
                specs.category = "controller"
                specs.controller_subtype = specs.controller_subtype or "mobile"

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

            m_kreo = re.search(r"\b(mirage|chimera)\b", t_norm)
            if m_kreo and (specs.brand == "kreo" or "kreo" in t_norm):
                specs.model_line = m_kreo.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "kreo"
                specs.category = "controller"

            m_ef = re.search(r"\b(elite\s*x2|elite\s*x|one|blade)\b", t_norm)
            if m_ef and (specs.brand == "evofox" or "evofox" in t_norm):
                specs.model_line = m_ef.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "evofox"
                specs.category = "controller"

            if not specs.model_line:
                cleaned_controller = re.sub(
                    r"^(?:playstation|microsoft|sony|logitech|razer|kreo|cosmic\s*byte|evofox|8bitdo|gamesir|flydigi|gulikit|ant\s*esports|redgear|backbone)\s*",
                    "",
                    t_norm,
                )
                if specs.brand and cleaned_controller.startswith(specs.brand):
                    cleaned_controller = cleaned_controller[len(specs.brand):].strip()
                cleaned_controller = re.sub(r"^(?:wireless|wired|tri\s*mode|bluetooth|usb|rgb|gaming|3\s*in\s*1|3in1|3\s*mode)\s+", "", cleaned_controller)
                m_gen = re.search(
                    r"^\s*([a-z0-9]+(?:\s+[a-z0-9]+)?)\s+(?:wireless|wired|rgb|gaming|controller|gamepad|usb|joystick|hall\s*effect|tri\s*mode|bluetooth|3\s*in\s*1|3in1|3\s*mode)\b",
                    cleaned_controller,
                )
                if m_gen:
                    cand_ml = m_gen.group(1).strip()
                    cand_ml = re.sub(r"\s+(?:wireless|wired|rgb|gaming)$", "", cand_ml).strip()
                    if cand_ml not in ("new", "best", "pro", "mini", "usb", "bluetooth", "wireless", "wired", "original", "gaming", "official", "game"):
                        specs.model_line = cand_ml
                        specs.product_family = specs.model_line

        # Controller Platform / Subtype extraction (PC vs Mobile vs Console)
        if specs.category == "controller":
            if re.search(r"\b(?:for\s*(?:iphone|android|ios|mobile|smartphone)|mobile\s*gaming|mobile\s*controller|backbone\s*one|kishi)\b", t_norm):
                specs.controller_subtype = "mobile"
            elif re.search(r"\b(?:for\s*pc|for\s*windows|pc\s*controller|pc\s*gamepad|windows\s*1[01]|windows\s*gaming)\b", t_norm):
                specs.controller_subtype = "pc"
            elif re.search(r"\b(?:ps5|ps4|playstation|xbox\s*series|xbox\s*one|nintendo\s*switch)\b", t_norm):
                specs.controller_subtype = "console"

        # Mice & Pointing Devices
        if specs.category == "mouse" or any(m in t_norm for m in ("gaming mouse", "optical mouse", "wireless mouse", "wired mouse")):
            # Ant Esports Mice
            m_ae_m = re.search(r"\b(gm\s*320(?:\s*pro)?|gm\s*500|gm\s*600|gm\s*700|gm\s*800|gm\s*900|gm\s*100|gm\s*200|gm\s*270|gm\s*300|gm\s*310|gm\s*325|gm\s*330|gm\s*340|gm\s*350|gm\s*400|gm\s*450|gm\s*550|gm\s*650|gm\s*750|gm\s*850|gm\s*950|fedora|vortex|phantom|katana|ranger)\b", t_norm)
            if m_ae_m and (specs.brand == "ant esports" or "ant esports" in t_norm):
                specs.model_line = m_ae_m.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "ant esports"
                specs.category = "mouse"

            # Logitech Mice
            m_logi_m = re.search(r"\b(g502(?:\s*(?:hero|lightspeed|x))?|g402|g102(?:\s*lightsync)?|g304(?:\s*lightspeed)?|g305|g203|g\s*pro(?:\s*superlight(?:\s*2)?)?|g903|g703|g604|g600|m90|b100|m170|m220|m240|m330|m331|m590|m720|mx\s*master(?:\s*[23][s]?)?|mx\s*anywhere(?:\s*[23][s]?)?|lift|pebble)\b", t_norm)
            if m_logi_m:
                specs.model_line = m_logi_m.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "logitech"
                specs.category = "mouse"

            # Razer Mice
            m_rz_m = re.search(r"\b(deathadder(?:\s*(?:v2|v3|essential|chroma|elite))?|viper(?:\s*(?:v2|v3|mini|ultimate))?|basilisk(?:\s*(?:v2|v3|ultimate))?|naga|cobra|orochi(?:\s*v2)?|mamba|abyssus)\b", t_norm)
            if m_rz_m:
                specs.model_line = m_rz_m.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "razer"
                specs.category = "mouse"

            # Redragon Mice
            m_rd_m = re.search(r"\b(centrophorus(?:\s*2)?|m601|m711(?:\s*cobra)?|cobra|predator|m908|impact|griffin|m607|storm|m808)\b", t_norm)
            if m_rd_m:
                specs.model_line = m_rd_m.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "redragon"
                specs.category = "mouse"

            # Cosmic Byte Mice
            m_cb_m = re.search(r"\b(kilonova(?:\s*\d+)?|firestorm|hyperion|zero[-]?g|equinox|themis|killawatt|spectrum|asteroid)\b", t_norm)
            if m_cb_m:
                specs.model_line = m_cb_m.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "cosmic byte"
                specs.category = "mouse"

            # Generic mouse model extraction
            if not specs.model_line:
                cleaned_mouse = re.sub(
                    r"^(?:ant\s*esports|logitech|razer|redragon|cosmic\s*byte|kreo|evofox|zebronics|portronics|amkette|fantech)\s*",
                    "",
                    t_norm,
                )
                if specs.brand and cleaned_mouse.startswith(specs.brand):
                    cleaned_mouse = cleaned_mouse[len(specs.brand):].strip()
                cleaned_mouse = re.sub(r"^(?:wireless|wired|rgb|gaming|optical|bluetooth|usb)\s+", "", cleaned_mouse)
                m_gen_m = re.search(r"^\s*([a-z0-9]+(?:\s+[a-z0-9]+)?)\s+(?:wireless|wired|rgb|gaming|optical|mouse|mice|sensor|dpi|buttons?)\b", cleaned_mouse)
                if m_gen_m:
                    cand_m = m_gen_m.group(1).strip()
                    if cand_m not in ("new", "best", "pro", "mini", "usb", "bluetooth", "wireless", "wired", "original", "gaming", "official", "mouse"):
                        specs.model_line = cand_m
                        specs.product_family = specs.model_line

        # Keyboards
        if specs.category == "keyboard" or any(k in t_norm for k in ("keyboard", "keyboards", "mechanical keyboard")):
            # Ant Esports Keyboards
            m_ae_k = re.search(r"\b(mk\s*1000|mk\s*1200(?:\s*mini)?|mk\s*1300(?:\s*mini)?|mk\s*1400|mk\s*1500|mk\s*1600|mk\s*1700|mk\s*3000|mk\s*3200|mk\s*3400(?:\s*v2)?|mk\s*3500|mk\s*4500|km\s*500|km\s*540|km\s*560|km\s*600|km\s*700|eleven|warrior|neo|shadow)\b", t_norm)
            if m_ae_k and (specs.brand == "ant esports" or "ant esports" in t_norm):
                specs.model_line = m_ae_k.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "ant esports"
                specs.category = "keyboard"

            # Redragon Keyboards
            m_rd_k = re.search(r"\b(k552|kumara|k551|vara|k556|devarajas|k530|draconic|k617|fizz|k582|surara|k580|vata|shiva|k512)\b", t_norm)
            if m_rd_k:
                raw_m = m_rd_k.group(1).lower().split()[0]
                rd_canon = {
                    "kumara": "k552",
                    "vara": "k551",
                    "draconic": "k530",
                    "fizz": "k617",
                    "devarajas": "k556",
                    "surara": "k582",
                    "vata": "k580",
                }
                specs.model_line = rd_canon.get(raw_m, raw_m)
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "redragon"
                specs.category = "keyboard"

            # Logitech Keyboards
            m_logi_k = re.search(r"\b(g213(?:\s*prodigy)?|g413(?:\s*(?:se|carbon))?|g512(?:\s*carbon)?|g915(?:\s*tkl)?|g815|g613|g713|g715|k380|k400(?:\s*plus)?|k480|k580|k780|k120|k230|k270|mx\s*keys(?:\s*(?:mini|s))?|mx\s*mechanical(?:\s*mini)?|pop\s*keys|signature\s*k650|wave\s*keys)\b", t_norm)
            if m_logi_k:
                specs.model_line = m_logi_k.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "logitech"
                specs.category = "keyboard"

            # Razer Keyboards
            m_rz_k = re.search(r"\b(blackwidow(?:\s*(?:v3|v4|mini|tenkeyless|pro))?|huntsman(?:\s*(?:mini|v2|v3|tournament|elite))?|ornata(?:\s*(?:v2|v3))?|cynosa(?:\s*(?:v2|lite))?|deathstalker(?:\s*v2)?)\b", t_norm)
            if m_rz_k:
                specs.model_line = m_rz_k.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "razer"
                specs.category = "keyboard"

            # Cosmic Byte Keyboards
            m_cb_k = re.search(r"\b(firefly|vanth|pandora|artemis|gk[-]?16|gk[-]?18|gk[-]?21|corona|sirius|oberon)\b", t_norm)
            if m_cb_k:
                specs.model_line = m_cb_k.group(1).lower()
                specs.product_family = specs.model_line
                specs.brand = specs.brand or "cosmic byte"
                specs.category = "keyboard"

            # Generic keyboard model extraction
            if not specs.model_line:
                cleaned_kbd = re.sub(
                    r"^(?:ant\s*esports|redragon|logitech|razer|cosmic\s*byte|kreo|evofox|zebronics|portronics|amkette|keychron|royal\s*kludge)\s*",
                    "",
                    t_norm,
                )
                if specs.brand and cleaned_kbd.startswith(specs.brand):
                    cleaned_kbd = cleaned_kbd[len(specs.brand):].strip()
                cleaned_kbd = re.sub(r"^(?:wireless|wired|rgb|gaming|mechanical|membrane|bluetooth|usb)\s+", "", cleaned_kbd)
                m_gen_k = re.search(r"^\s*([a-z0-9]+(?:\s+[a-z0-9]+)?)\s+(?:wireless|wired|rgb|gaming|mechanical|membrane|keyboard|tkl|tenkeyless|layout)\b", cleaned_kbd)
                if m_gen_k:
                    cand_k = m_gen_k.group(1).strip()
                    if cand_k not in ("new", "best", "pro", "mini", "usb", "bluetooth", "wireless", "wired", "original", "gaming", "official", "keyboard"):
                        specs.model_line = cand_k
                        specs.product_family = specs.model_line
        if specs.category == "controller":
            if re.search(r"\b(?:for\s*(?:iphone|android|ios|mobile|smartphone)|mobile\s*gaming|mobile\s*controller|backbone\s*one|kishi)\b", t_norm):
                specs.controller_subtype = "mobile"
            elif re.search(r"\b(?:for\s*pc|for\s*windows|pc\s*controller|pc\s*gamepad|windows\s*1[01]|windows\s*gaming)\b", t_norm):
                specs.controller_subtype = "pc"
            elif re.search(r"\b(?:ps5|ps4|playstation|xbox\s*series|xbox\s*one|nintendo\s*switch)\b", t_norm):
                specs.controller_subtype = "console"

        # Connectivity extraction
        if re.search(r"\b(?:wireless|bluetooth|2\.4ghz|2\.4\s*g|tri\s*[-]?\s*mode|3\s*[-]?\s*mode)\b", t_norm):
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
        else:
            m_audio = re.search(
                r"\b(rockerz\s*\d+[a-z]?|airpods(?:\s*pro|\s*max|\s*\d+)?|tune\s*\d+[a-z]?|bassheads\s*\d+|crusher(?:\s*evo)?|major\s*[ivx]+|c100si|endurance(?:\s*run|\s*dive|\s*peak)?|buds\s*(?:air|pro|\d+)|quietcomfort(?:\s*\d+)?)\b",
                t_norm,
            )
            if m_audio:
                specs.model_line = m_audio.group(1).lower()
                specs.product_family = specs.model_line
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

        def _match_laptop_fam(fam_name: str, text: str) -> bool:
            if re.search(r"\b" + re.escape(fam_name) + r"\b", text):
                return True
            w_list = fam_name.split()
            if len(w_list) > 1:
                sep_pat = r"(?:\s+(?:1[0-9](?:\.[0-9])?(?:-?inch|\"|\bin\b)?|202[0-9]|laptop)\s+|\s+)"
                full_pat = r"\b" + sep_pat.join([re.escape(w) for w in w_list]) + r"\b"
                if re.search(full_pat, text):
                    return True
            return False

        # Laptops (Brand-specific product family hierarchy)
        if specs.brand and specs.brand in LAPTOP_FAMILIES:
            for fam in LAPTOP_FAMILIES[specs.brand]:
                if _match_laptop_fam(fam, t_norm):
                    specs.product_family = fam
                    specs.model_line = fam
                    specs.category = "laptop"
                    break

        if not specs.product_family and specs.category == "laptop":
            # Search all known laptop families regardless of brand match
            for b, families in LAPTOP_FAMILIES.items():
                for fam in families:
                    if _match_laptop_fam(fam, t_norm):
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

        # 10. Storage & RAM Multi-spec Extraction
        m_multi = re.search(r"\b(4|6|8|12|16|18|24|32|36|64)\s*gb\s*[/,\+\-]\s*(\d+)\s*(gb|tb)\b", t_norm)
        if m_multi:
            specs.ram = f"{m_multi.group(1)} GB"
            unit = m_multi.group(3).upper()
            specs.storage = f"{m_multi.group(2)} {unit}"
        else:
            m_storage = re.search(r"\b(32|64|120|128|240|250|256|480|500|512|1000)\s*(?:gb|g\b)|\b(1|2|4)\s*tb\b", t_norm)
            if m_storage:
                if m_storage.group(1):
                    specs.storage = f"{m_storage.group(1)} GB"
                elif m_storage.group(2):
                    specs.storage = f"{m_storage.group(2)} TB"

        # 11. RAM Extraction
        if not specs.ram:
            m_ram = re.search(r"\b(4|6|8|12|16|18|24|32|36|64)\s*(?:gb\s*ram|gb\s*lpddr\d*|gb\s*ddr\d*|gb\s*unified memory|gb\s*memory)\b", t_norm)
            if m_ram:
                specs.ram = f"{m_ram.group(1)} GB"
            elif specs.storage:
                for m_r in re.finditer(r"\b(4|6|8|12|16|18|24|32|36|64)\s*gb\b", t_norm):
                    cand_ram = f"{m_r.group(1)} GB"
                    if cand_ram != specs.storage:
                        specs.ram = cand_ram
                        break

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

        # 12a. Single-architecture product family processor binding
        if specs.product_family == "macbook neo" and not specs.cpu_family:
            specs.cpu_family = "a18 pro"
            specs.cpu_brand = "apple"
            specs.chip_family = "a18 pro"
        elif specs.product_family == "macbook air m1" and not specs.cpu_family:
            specs.cpu_family = "m1"
            specs.cpu_brand = "apple"
            specs.chip_family = "m1"
        elif specs.product_family == "macbook air m2" and not specs.cpu_family:
            specs.cpu_family = "m2"
            specs.cpu_brand = "apple"
            specs.chip_family = "m2"
        elif specs.product_family == "macbook air m3" and not specs.cpu_family:
            specs.cpu_family = "m3"
            specs.cpu_brand = "apple"
            specs.chip_family = "m3"
        elif specs.product_family == "macbook air m5" and not specs.cpu_family:
            specs.cpu_family = "m5"
            specs.cpu_brand = "apple"
            specs.chip_family = "m5"

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

        # 12e. Generic Model & Distinctive Identifier Extraction
        if model_hint and model_hint.strip() and model_hint.lower() not in ("unavailable", "unknown", "n/a", "generic"):
            specs.generic_model = model_hint.strip().lower()

        # Extract ISBN for books
        if specs_hint and isinstance(specs_hint, dict):
            for k in ("isbn", "isbn-10", "isbn-13", "ISBN", "ISBN-10", "ISBN-13"):
                if k in specs_hint and specs_hint[k]:
                    val = str(specs_hint[k]).replace("-", "").replace(" ", "").strip()
                    if len(val) >= 9:
                        specs.isbn = val
                        if not specs.generic_model:
                            specs.generic_model = val
                        break
            for k in ("author", "Author", "byline", "Byline"):
                if k in specs_hint and specs_hint[k]:
                    val = str(specs_hint[k]).strip()
                    if val and val.lower() not in ("generic", "unknown", "unavailable"):
                        specs.book_author = val
                        break

        if not specs.isbn and specs.category == "books":
            m_isbn = re.search(r"\b(97[89][\d-]{10,14}[\dxX]|\d{9}[\dxX])\b", t_norm)
            if m_isbn:
                specs.isbn = m_isbn.group(1).replace("-", "").strip()
                if not specs.generic_model:
                    specs.generic_model = specs.isbn

        if not specs.book_author and specs.category == "books":
            m_auth = re.search(r"\bby\s+([a-z\s\.]+?)(?:\s*\((?:author|editor|contributor)\)|\s*,\s*|\s*-\s*|\s*$)", t_norm)
            if m_auth:
                specs.book_author = m_auth.group(1).strip()

        # Component Type extraction (for computer components)
        if specs.category == "computer_components" or any(w in t_norm for w in ("ram", "ddr4", "ddr5", "rtx", "geforce", "radeon", "motherboard")):
            if re.search(r"\b(?:ddr[345]|ram|sodimm|udimm|memory)\b", t_norm):
                specs.component_type = "ram"
                m_ddr = re.search(r"\b(ddr[345])\b", t_norm)
                m_freq = re.search(r"\b(\d{4})\s*mhz\b", t_norm)
                parts_comp = []
                if m_ddr:
                    parts_comp.append(m_ddr.group(1))
                if m_freq:
                    parts_comp.append(f"{m_freq.group(1)}mhz")
                if parts_comp and not specs.generic_model:
                    specs.generic_model = " ".join(parts_comp)
            elif re.search(r"\b(?:rtx\s*\d{4}|gtx\s*\d{4}|rx\s*\d{4}|graphics\s*card|gpu)\b", t_norm):
                specs.component_type = "gpu"
                m_gpu = re.search(r"\b(rtx\s*\d{4}(?:\s*ti)?|gtx\s*\d{4}(?:\s*ti)?|rx\s*\d{4}(?:\s*xt)?)\b", t_norm)
                if m_gpu and not specs.generic_model:
                    specs.generic_model = m_gpu.group(1).lower()

        if not specs.generic_model and specs.category in (
            "kitchen_home", "clothing", "footwear", "toys_games", "personal_care", "watches", "bags_luggage", "beauty", "household", "books"
        ):
            # 1. Philips / Kitchen slash-codes: e.g. HD9200/90, QT4011/15, HR3705/10, etc.
            m_slash = re.search(r"\b([a-z]{1,4}\d{2,5}(?:/\d{2,4})?)\b", t_norm)
            if m_slash:
                c_code = m_slash.group(1).lower()
                if not is_retailer_identifier(c_code) and not any(w == c_code for w in ("2024", "2025", "2026", "1080p", "1440p", "4k", "5g", "4g")):
                    specs.generic_model = c_code

            # 2. Prestige / Kitchen models: e.g. PKOSS, Delight, Nakshatra, Svachh, Omega, Triply
            if not specs.generic_model and specs.category == "kitchen_home":
                m_kit = re.search(r"\b(pkoss|delight|nakshatra|svachh|omega|triply|atlas|iris|dias)\b", t_norm)
                if m_kit:
                    specs.generic_model = m_kit.group(1).lower()

            # 3. Levi's / Jeans style numbers: e.g. 511, 501, 512, 514, 527, 541, 6550
            if not specs.generic_model and specs.category == "clothing":
                m_jean = re.search(r"\b(501|511|512|513|514|527|541|550|6550)\b", t_norm)
                if m_jean:
                    specs.generic_model = m_jean.group(1).lower()

            # 4. Footwear models: Smash v2, Classic Clogs, Air Max, Stan Smith, Superstar, Chuck Taylor, etc.
            if not specs.generic_model and specs.category == "footwear":
                m_shoe = re.search(r"\b(smash\s*v2|smash|classic\s*clog[s]?|air\s*max|stan\s*smith|superstar|old\s*skool|chuck\s*taylor|court\s*royale|revolution\s*\d+)\b", t_norm)
                if m_shoe:
                    specs.generic_model = m_shoe.group(1).lower()

            # 5. Lego set numbers (5-digit code): e.g. 10698, 42115, etc.
            if not specs.generic_model and specs.category == "toys_games":
                m_lego = re.search(r"\b(\d{5})\b", t_norm)
                if m_lego:
                    specs.generic_model = m_lego.group(1).lower()

            # 6. Casio / Watch models: e.g. A158WA, GA-2100, F91W, MTP-V002D, etc.
            if not specs.generic_model and specs.category == "watches":
                m_watch = re.search(r"\b([a-z]{1,4}[-]?\d{3,4}[a-z0-9]*)\b", t_norm)
                if m_watch:
                    specs.generic_model = m_watch.group(1).lower()

            # 7. Beauty formulations & active lines: e.g. SPF 50, Salicylic Acid, Niacinamide, Vitamin C
            if not specs.generic_model and specs.category == "beauty":
                m_beauty = re.search(r"\b(spf\s*50|spf\s*30|spf\s*60|niacinamide\s*(?:10%|5%)?|salicylic\s*acid(?:\s*2%)?|vitamin\s*c|hyaluronic\s*acid|retinol|bio\s*neem|tea\s*tree|aloe\s*vera)\b", t_norm)
                if m_beauty:
                    specs.generic_model = m_beauty.group(1).lower()

            # 8. Household sub-lines & formulations: e.g. Matic Front Load, Matic Top Load, Power Gel
            if not specs.generic_model and specs.category == "household":
                m_house = re.search(r"\b(matic\s*front\s*load|matic\s*top\s*load|matic|liquid\s*detergent|power\s*gel|oxi\s*stain|easy\s*wash|dishwash\s*gel|lemon|neem)\b", t_norm)
                if m_house:
                    specs.generic_model = m_house.group(1).lower()

            # 9. Books format / edition
            if not specs.generic_model and specs.category == "books":
                m_book = re.search(r"\b(paperback|hardcover|kindle|box\s*set)\b", t_norm)
                if m_book:
                    specs.generic_model = m_book.group(1).lower()

        elif not specs.generic_model and not specs.category and not specs.product_family and not specs.model_line:
            # Check for explicit slash-codes if category is unassigned (e.g. HD9200/90, QT4011/15)
            m_explicit_slash = re.search(r"\b([a-z]{1,4}\d{2,5}/\d{2,4})\b", t_norm)
            if m_explicit_slash:
                specs.generic_model = m_explicit_slash.group(1).lower()

        if not specs.model_line and specs.generic_model:
            specs.model_line = specs.generic_model
            if not specs.product_family and specs.category in ("laptop", "smartphone", "tablet", "audio", "monitor", "storage", "controller"):
                specs.product_family = specs.generic_model

        # 12f. Volume & Fluid Capacity Extraction (e.g. 1.5L, 1.8L, 500ML, 4.2L, 32L)
        m_vol = re.search(r"\b(\d+(?:\.\d+)?)\s*(l|litres?|liter|ml)\b", t_norm)
        if m_vol:
            val_f = float(m_vol.group(1))
            unit_str = "ML" if "ml" in m_vol.group(2) else "L"
            specs.volume_capacity = f"{val_f:g}{unit_str}"
            if not specs.capacity and specs.category in ("refrigerator", "kitchen_home"):
                specs.capacity = specs.volume_capacity

        # 12g. Power & Wattage Extraction (e.g. 1500W, 750W, 500 Watts)
        if specs.category not in ("clothing", "footwear", "apparel"):
            m_pow = re.search(r"\b(\d{2,4})\s*(?:w|watts?)\b", t_norm)
            if m_pow:
                specs.power_wattage = f"{m_pow.group(1)}W"

        # 12h. Pack Count Extraction (e.g. Pack of 2, 3 Pack, Set of 4)
        m_pack = re.search(r"\b(?:pack\s*of\s*(\d+)|(\d+)\s*pack|set\s*of\s*(\d+))\b", t_norm)
        if m_pack:
            p_val = m_pack.group(1) or m_pack.group(2) or m_pack.group(3)
            if p_val:
                specs.pack_count = int(p_val)

        # 12i. Apparel & Footwear Size Extraction (e.g. UK 8, Size 9, XL, L, M, S, 32W)
        if specs_hint and isinstance(specs_hint, dict):
            for k in ("size", "size_name", "Size", "Size Name"):
                if k in specs_hint and specs_hint[k]:
                    val = str(specs_hint[k]).strip()
                    if val and val.lower() not in ("generic", "standard", "unavailable"):
                        specs.apparel_size = val.upper()
                        break

        if not specs.apparel_size:
            m_shoe_sz = re.search(r"\b(?:uk|us|ind|size)\s*[:\-]?\s*([3-9]|1[0-3])\b", t_norm)
            if m_shoe_sz:
                specs.apparel_size = f"UK {m_shoe_sz.group(1)}"
            elif specs.category in ("clothing", "footwear", "apparel"):
                m_cloth_sz = re.search(r"\b(?:size\s*[:\-]?\s*)?(xs|xxl|2xl|3xl|4xl|xl|xxxl)\b|\bsize\s*[:\-]?\s*([sml])\b", t_norm)
                if m_cloth_sz:
                    sz_str = m_cloth_sz.group(1) or m_cloth_sz.group(2)
                    if sz_str:
                        specs.apparel_size = sz_str.upper()
                if not specs.apparel_size:
                    m_waist = re.search(r"\b(?:waist\s*[:\-]?\s*)?(2[89]|3[0-9]|4[0-2])\s*(?:w|waist|inch|\"|in)?\b", t_norm)
                    if m_waist and any(w in t_norm for w in ("waist", "jeans", "denim", "trouser", "pant")):
                        specs.apparel_size = f"{m_waist.group(1)}W"

        # 13. Color Extraction
        if not specs.color and specs_hint and isinstance(specs_hint, dict):
            for k in ("color", "color_name", "colour", "Colour", "Color"):
                if k in specs_hint and specs_hint[k]:
                    cand_col = str(specs_hint[k]).strip().lower()
                    if cand_col and cand_col not in ("generic", "standard", "unavailable"):
                        specs.color = canonicalize_color(cand_col)
                        break

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
        source_category: Optional[str] = None,
        source_brand: Optional[str] = None,
        source_model: Optional[str] = None,
        source_specs: Optional[dict[str, Any]] = None,
    ) -> tuple[MatchStatus, str, RejectionCategory, dict[str, Any]]:
        """
        Evaluates a candidate listing against the active source product.
        Implements a deterministic, fail-closed product verification pipeline.
        Returns: (MatchStatus, reason, RejectionCategory, extracted_variants)
        """
        source = cls.extract_specs(
            source_title,
            variant_hint=source_variant,
            category_hint=source_category,
            brand_hint=source_brand,
            model_hint=source_model,
            specs_hint=source_specs,
        )
        cand = cls.extract_specs(
            candidate_title,
            url_hint=candidate_url,
            category_hint=source.category,
        )

        cand_variants = {
            "category": cand.category,
            "brand": cand.brand,
            "product_family": cand.product_family,
            "model_line": cand.model_line,
            "generic_model": cand.generic_model,
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
            "volume_capacity": cand.volume_capacity,
            "power_wattage": cand.power_wattage,
            "pack_count": cand.pack_count,
            "apparel_size": cand.apparel_size,
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
        # 1. Service Plan, Condition & Integrity Checks
        # -------------------------------------------------------------
        if cand.is_service_plan or cand.category == "service_plan":
            if not source.is_service_plan:
                return (
                    MatchStatus.MISMATCH,
                    "Candidate listing is a service plan, protection pack, or warranty, not the physical product.",
                    RejectionCategory.ACCESSORY_OR_CONDITION,
                    cand_variants,
                )
        if source.is_service_plan and not cand.is_service_plan:
            return (
                MatchStatus.MISMATCH,
                "Source product is a service plan or warranty; competitor listing is hardware.",
                RejectionCategory.ACCESSORY_OR_CONDITION,
                cand_variants,
            )

        if cand.is_accessory and not source.is_accessory:
            return (
                MatchStatus.MISMATCH,
                "Candidate listing is an accessory, cover, or spare part.",
                RejectionCategory.ACCESSORY_OR_CONDITION,
                cand_variants,
            )
        if cand.is_refurbished and not source.is_refurbished:
            return (
                MatchStatus.MISMATCH,
                "Candidate listing is refurbished, renewed, or open-box.",
                RejectionCategory.ACCESSORY_OR_CONDITION,
                cand_variants,
            )
        if cand.is_bundle and not source.is_bundle:
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
        # 2b. Brand Identity Check (Mandatory — Fail Closed)
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
                # For books, author may be written as "Last First" (e.g. Clear James vs James Clear)
                # or candidate title may not have extracted author as brand
                is_author_match = False
                if source.category == "books":
                    brand_words = [w for w in source.brand.split() if len(w) > 2]
                    if brand_words and all(bw in cand_clean for bw in brand_words):
                        is_author_match = True
                    elif source.isbn and source.isbn in cand_clean:
                        is_author_match = True

                if not is_author_match:
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
        # 2c. Controller & Gaming Peripheral Verification
        # -------------------------------------------------------------
        if source.category == "controller" or cand.category == "controller":
            # Check platform / subtype compatibility (PC vs Mobile vs Console)
            if source.controller_subtype and cand.controller_subtype and source.controller_subtype != cand.controller_subtype:
                return (
                    MatchStatus.MODEL_MISMATCH,
                    f"Platform incompatibility: source is {source.controller_subtype.upper()} controller, competitor listing is {cand.controller_subtype.upper()} controller.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )

            # Model line check must take precedence over configuration/connectivity variants
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
                        MatchStatus.MISMATCH,
                        f"Controller model missing or unverified in competitor listing (source requires {source.model_line.upper()}).",
                        RejectionCategory.MODEL_MISMATCH,
                        cand_variants,
                    )
            elif cand.model_line and not source.model_line:
                cand_ml_clean = cand.model_line.lower()
                if cand_ml_clean not in src_clean:
                    return (
                        MatchStatus.MISMATCH,
                        f"Competitor listing specifies model {cand.model_line.upper()}, not present in source listing.",
                        RejectionCategory.MODEL_MISMATCH,
                        cand_variants,
                    )

            # Check wired vs wireless connectivity for the same model
            if source.connectivity and cand.connectivity and source.connectivity != cand.connectivity:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Connectivity mismatch: source is {source.connectivity}, candidate is {cand.connectivity}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )

            # Check Tri-Mode / Multi-Mode divergence for the same model
            src_is_tri = bool(re.search(r"\b(?:tri\s*[-]?\s*mode|3\s*[-]?\s*mode|multi\s*[-]?\s*mode|3\s*in\s*1|3in1|3\s*in1)\b", src_clean) or ("bluetooth" in src_clean and ("usb" in src_clean or "wireless" in src_clean)))
            cand_is_tri = bool(re.search(r"\b(?:tri\s*[-]?\s*mode|3\s*[-]?\s*mode|multi\s*[-]?\s*mode|3\s*in\s*1|3in1|3\s*in1)\b", cand_clean) or ("bluetooth" in cand_clean and ("usb" in cand_clean or "wireless" in cand_clean)))
            if src_is_tri and not cand_is_tri:
                return (
                    MatchStatus.POSSIBLE_MATCH,
                    "Connectivity mode unverified in competitor listing (source specifies Tri-Mode / Multi-Mode).",
                    RejectionCategory.UNVERIFIED_VARIANT,
                    cand_variants,
                )
            elif cand_is_tri and not src_is_tri:
                return (
                    MatchStatus.POSSIBLE_MATCH,
                    "Competitor listing specifies Tri-Mode / Multi-Mode connectivity, unverified in source.",
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

        # -------------------------------------------------------------
        # 2d. Monitor & Display Specific Verification
        # -------------------------------------------------------------
        if source.category == "monitor" or cand.category == "monitor":
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

        # -------------------------------------------------------------
        # 2e. Storage Device & Component Verification
        # -------------------------------------------------------------
        if source.category == "storage" or cand.category == "storage":
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

        # -------------------------------------------------------------
        # 2f. Sports & Everyday Consumer Products Verification
        # -------------------------------------------------------------
        if source.category == "sports" or cand.category == "sports":
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

        # -------------------------------------------------------------
        # 2g. Refrigerator & Appliance Specific Verification
        # -------------------------------------------------------------
        if source.category == "refrigerator" or cand.category == "refrigerator":
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
        # 2h. Mouse & Keyboard Specific Verification
        # -------------------------------------------------------------
        if source.category in ("mouse", "keyboard") or cand.category in ("mouse", "keyboard"):
            if source.category and cand.category and source.category != cand.category:
                return (
                    MatchStatus.MISMATCH,
                    f"Product category mismatch: source is {source.category}, candidate is {cand.category}.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )

            # Model line check
            if source.model_line and cand.model_line:
                src_p_ml = source.model_line.replace("-", "").replace(" ", "").lower()
                cand_p_ml = cand.model_line.replace("-", "").replace(" ", "").lower()
                if src_p_ml != cand_p_ml:
                    return (
                        MatchStatus.MISMATCH,
                        f"{source.category.title()} model mismatch: source is {source.model_line.upper()}, candidate is {cand.model_line.upper()}.",
                        RejectionCategory.MODEL_MISMATCH,
                        cand_variants,
                    )
            elif source.model_line and not cand.model_line:
                src_p_clean = source.model_line.lower()
                if src_p_clean not in cand_clean and src_p_clean not in cand_url_clean:
                    return (
                        MatchStatus.MISMATCH,
                        f"{source.category.title()} model missing or unverified in competitor listing (source requires {source.model_line.upper()}).",
                        RejectionCategory.MODEL_MISMATCH,
                        cand_variants,
                    )
            elif cand.model_line and not source.model_line:
                cand_p_clean = cand.model_line.lower()
                if cand_p_clean not in src_clean:
                    return (
                        MatchStatus.MISMATCH,
                        f"Competitor listing specifies model {cand.model_line.upper()}, not present in source listing.",
                        RejectionCategory.MODEL_MISMATCH,
                        cand_variants,
                    )

            # Connectivity mismatch (wired vs wireless)
            if source.connectivity and cand.connectivity and source.connectivity != cand.connectivity:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Connectivity mismatch: source is {source.connectivity}, candidate is {cand.connectivity}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )

        # -------------------------------------------------------------
        # 4. Product Family Identity (Mandatory for Laptops / Smartphones / Tablets)
        # -------------------------------------------------------------
        if source.category in ("laptop", "smartphone", "tablet") or cand.category in ("laptop", "smartphone", "tablet"):
            if source.product_family:
                if not cand.product_family:
                    cand_t_clean = cand.raw_title.lower().replace("-", " ")
                    src_fam_clean = source.product_family.lower().replace("-", " ")
                    if src_fam_clean not in cand_t_clean:
                        return (
                            MatchStatus.MODEL_MISMATCH,
                            f"Product family missing: candidate does not specify required family '{source.product_family.title()}'.",
                            RejectionCategory.MODEL_MISMATCH,
                            cand_variants,
                        )
                else:
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
            src_base = src_ml.split("/")[0]
            cand_base = cand_ml.split("/")[0]
            if src_base != cand_base:
                is_cap_variant = False
                for cap in (source.volume_capacity, cand.volume_capacity, source.power_wattage, cand.power_wattage):
                    if cap:
                        cap_clean = cap.lower().replace(" ", "")
                        cap_num = re.sub(r"[a-z]", "", cap_clean)
                        if (src_base == cand_base + cap_clean or src_base == cand_base + cap_num or
                            cand_base == src_base + cap_clean or cand_base == src_base + cap_num):
                            is_cap_variant = True
                            break
                if not is_cap_variant and (source.category == "books" or cand.category == "books"):
                    is_isbn_vs_format = (
                        (src_base.isdigit() and len(src_base) in (10, 13) and cand_base in ("paperback", "hardcover", "kindle", "boxset")) or
                        (cand_base.isdigit() and len(cand_base) in (10, 13) and src_base in ("paperback", "hardcover", "kindle", "boxset"))
                    )
                    if is_isbn_vs_format:
                        src_fmt = "hardcover" if "hardcover" in src_clean else ("paperback" if "paperback" in src_clean else None)
                        cand_fmt = "hardcover" if "hardcover" in cand_clean else ("paperback" if "paperback" in cand_clean else None)
                        if src_fmt and cand_fmt and src_fmt != cand_fmt:
                            return (
                                MatchStatus.CONFIGURATION_MISMATCH,
                                f"Book format mismatch: {src_fmt} vs {cand_fmt}.",
                                RejectionCategory.CONFIG_MISMATCH,
                                cand_variants,
                            )
                        is_cap_variant = True

                if not is_cap_variant:
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
        # 11b. Universal Generic Model & Variant Attributes Verification
        # -------------------------------------------------------------
        if source.generic_model and cand.generic_model:
            src_gm_clean = source.generic_model.replace(" ", "").replace("-", "")
            cand_gm_clean = cand.generic_model.replace(" ", "").replace("-", "")
            src_gm_base = src_gm_clean.split("/")[0]
            cand_gm_base = cand_gm_clean.split("/")[0]
            if src_gm_base != cand_gm_base:
                is_cap_var = False
                for cap in (source.volume_capacity, cand.volume_capacity, source.power_wattage, cand.power_wattage):
                    if cap:
                        cap_clean = cap.lower().replace(" ", "")
                        cap_num = re.sub(r"[a-z]", "", cap_clean)
                        if (src_gm_base == cand_gm_base + cap_clean or src_gm_base == cand_gm_base + cap_num or
                            cand_gm_base == src_gm_base + cap_clean or cand_gm_base == src_gm_base + cap_num):
                            is_cap_var = True
                            break
                if not is_cap_var and (source.category == "books" or cand.category == "books"):
                    is_isbn_vs_format = (
                        (src_gm_base.isdigit() and len(src_gm_base) in (10, 13) and cand_gm_base in ("paperback", "hardcover", "kindle", "boxset")) or
                        (cand_gm_base.isdigit() and len(cand_gm_base) in (10, 13) and src_gm_base in ("paperback", "hardcover", "kindle", "boxset"))
                    )
                    if is_isbn_vs_format:
                        src_fmt = "hardcover" if "hardcover" in src_clean else ("paperback" if "paperback" in src_clean else None)
                        cand_fmt = "hardcover" if "hardcover" in cand_clean else ("paperback" if "paperback" in cand_clean else None)
                        if src_fmt and cand_fmt and src_fmt != cand_fmt:
                            return (
                                MatchStatus.CONFIGURATION_MISMATCH,
                                f"Book format mismatch: {src_fmt} vs {cand_fmt}.",
                                RejectionCategory.CONFIG_MISMATCH,
                                cand_variants,
                            )
                        is_cap_var = True

                if not is_cap_var:
                    return (
                        MatchStatus.MODEL_MISMATCH,
                        f"Product model mismatch: source requires '{source.generic_model.upper()}', candidate is '{cand.generic_model.upper()}'.",
                        RejectionCategory.MODEL_MISMATCH,
                        cand_variants,
                    )
        elif source.generic_model and not cand.generic_model:
            src_gm_base = source.generic_model.replace("-", "").split("/")[0].strip()
            if src_gm_base not in cand_clean and src_gm_base not in cand_url_clean:
                return (
                    MatchStatus.MODEL_MISMATCH,
                    f"Product model missing or unverified in competitor listing (source requires {source.generic_model.upper()}).",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )
        elif cand.generic_model and not source.generic_model:
            cand_gm_base = cand.generic_model.replace("-", "").split("/")[0].strip()
            if cand_gm_base not in src_clean:
                return (
                    MatchStatus.MODEL_MISMATCH,
                    f"Competitor listing specifies model {cand.generic_model.upper()}, not present in source listing.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )

        # Volume / Capacity verification (kettles, fryers, bottles, backpacks)
        if source.volume_capacity and cand.volume_capacity:
            if source.volume_capacity != cand.volume_capacity:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Capacity mismatch: source {source.volume_capacity}, candidate {cand.volume_capacity}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
        elif source.volume_capacity and not cand.volume_capacity:
            return (
                MatchStatus.POSSIBLE_MATCH,
                f"Capacity unverified in competitor listing (source specifies {source.volume_capacity}).",
                RejectionCategory.UNVERIFIED_VARIANT,
                cand_variants,
            )

        # Power / Wattage verification (mixer grinders, heaters, kettles)
        if source.power_wattage and cand.power_wattage:
            if source.power_wattage != cand.power_wattage:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Power/Wattage mismatch: source {source.power_wattage}, candidate {cand.power_wattage}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
        elif source.power_wattage and not cand.power_wattage:
            return (
                MatchStatus.POSSIBLE_MATCH,
                f"Wattage unverified in competitor listing (source specifies {source.power_wattage}).",
                RejectionCategory.UNVERIFIED_VARIANT,
                cand_variants,
            )

        # Apparel & Footwear Size verification
        if source.apparel_size and cand.apparel_size:
            if source.apparel_size != cand.apparel_size:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Size mismatch: source {source.apparel_size}, candidate {cand.apparel_size}.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
        elif source.apparel_size and not cand.apparel_size:
            return (
                MatchStatus.POSSIBLE_MATCH,
                f"Size unverified in competitor listing (source specifies {source.apparel_size}).",
                RejectionCategory.UNVERIFIED_VARIANT,
                cand_variants,
            )

        # Pack Count verification (single vs multi-packs)
        if source.pack_count and cand.pack_count:
            if source.pack_count != cand.pack_count:
                return (
                    MatchStatus.CONFIGURATION_MISMATCH,
                    f"Pack count mismatch: source is {source.pack_count}-pack, candidate is {cand.pack_count}-pack.",
                    RejectionCategory.CONFIG_MISMATCH,
                    cand_variants,
                )
        elif (source.pack_count and source.pack_count > 1) or (cand.pack_count and cand.pack_count > 1):
            return (
                MatchStatus.CONFIGURATION_MISMATCH,
                "Pack count divergence: multi-pack vs single unit.",
                RejectionCategory.CONFIG_MISMATCH,
                cand_variants,
            )

        # Books Author & ISBN verification
        if source.category == "books" or cand.category == "books":
            if source.isbn and cand.isbn and source.isbn != cand.isbn:
                return (
                    MatchStatus.MISMATCH,
                    f"Book ISBN mismatch: {source.isbn} vs {cand.isbn}.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )
            if source.book_author and cand.book_author:
                s_auth = source.book_author.lower().strip()
                c_auth = cand.book_author.lower().strip()
                if s_auth not in c_auth and c_auth not in s_auth:
                    return (
                        MatchStatus.MISMATCH,
                        f"Book author mismatch: {source.book_author} vs {cand.book_author}.",
                        RejectionCategory.MODEL_MISMATCH,
                        cand_variants,
                    )

        # Computer Components Type verification
        if source.category == "computer_components" or cand.category == "computer_components":
            if source.component_type and cand.component_type and source.component_type != cand.component_type:
                return (
                    MatchStatus.MISMATCH,
                    f"Component type mismatch: source is {source.component_type}, candidate is {cand.component_type}.",
                    RejectionCategory.MODEL_MISMATCH,
                    cand_variants,
                )

        # -------------------------------------------------------------
        # 12. Final Exact Match Verification
        # -------------------------------------------------------------
        # Safeguard (Requirement 5): Never label a product as an exact match based on brand alone
        has_identifier = bool(
            source.model_line or cand.model_line or
            source.product_family or cand.product_family or
            source.mpn or cand.mpn or
            source.generic_model or cand.generic_model or
            (source.category == "monitor" and source.screen_size) or
            (source.category == "storage" and source.storage) or
            (source.category == "refrigerator" and source.capacity) or
            (source.category == "sports" and source.item_size) or
            (source.volume_capacity and cand.volume_capacity) or
            (source.power_wattage and cand.power_wattage) or
            (source.apparel_size and cand.apparel_size) or
            (source.category == "books" and (source.isbn or source.book_author or "paperback" in cand.raw_title.lower() or "hardcover" in cand.raw_title.lower())) or
            (source.category == "computer_components" and (source.ram or source.storage or source.component_type or source.generic_model)) or
            (source.category in ("beauty", "household") and (source.volume_capacity or source.fragrance or source.generic_model))
        )
        if not has_identifier:
            return (
                MatchStatus.POSSIBLE_MATCH,
                "Model identifier unverified in listing: cannot confirm exact match based on brand alone.",
                RejectionCategory.UNVERIFIED_VARIANT,
                cand_variants,
            )

        return (
            MatchStatus.EXACT_MATCH,
            "Exact product model and hardware configuration match.",
            RejectionCategory.VALID_MATCH,
            cand_variants,
        )
