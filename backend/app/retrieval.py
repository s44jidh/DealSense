"""
DealSense API — retrieval.py
Live retailer product search and offer extraction service for Indian e-commerce.
Queries live public search endpoints with timeout enforcement and anti-bot handling.
Deterministic parsing of titles, prices, and links without mock or fabricated data.
"""

from __future__ import annotations

import re
import ssl
import urllib.parse
import urllib.request
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Optional

from app.matcher import MatchStatus, ProductMatcher, RejectionCategory
from app.models import RetailerDiagnostic


class BaseRetriever(ABC):
    name: str
    domain: str
    is_enabled: bool
    status_reason: str
    last_http_status: Optional[int] = None
    last_raw_count: int = 0
    last_parsed_count: int = 0

    @abstractmethod
    def search(self, query: str, timeout: float = 6.0) -> list[dict]:
        """Retrieve raw candidate offers for a search query."""
        pass


class FlipkartRetriever(BaseRetriever):
    name = "Flipkart"
    domain = "flipkart.com"
    is_enabled = True
    status_reason = "Active: Live public search retrieval with deterministic validation."

    def search(self, query: str, timeout: float = 6.0) -> list[dict]:
        url = f"https://www.flipkart.com/search?q={urllib.parse.quote(query)}"
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }
        ctx = ssl.create_default_context()
        req = urllib.request.Request(url, headers=headers)

        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                self.last_http_status = resp.status
                if resp.status != 200:
                    return []
                html = resp.read().decode("utf-8", errors="ignore")
        except urllib.error.HTTPError as he:
            self.last_http_status = he.code
            return []
        except Exception:
            self.last_http_status = None
            return []

        parsed = self._parse_flipkart_html(html)
        self.last_parsed_count = len(parsed)
        return parsed

    def _parse_flipkart_html(self, html: str) -> list[dict]:
        cards = re.findall(
            r"(<a[^>]+href=\"(/[^\"]+/p/itm[^\"]+)\"[^>]*>.*?</a>)",
            html,
            re.DOTALL,
        )

        self.last_raw_count = len(cards)

        items_by_url: dict[str, dict] = {}

        for full_a, href in cards:
            clean_path = href.split("?")[0]
            pid_m = re.search(r"pid=([A-Z0-9]+)", href)
            prod_url = f"https://www.flipkart.com{clean_path}" + (
                f"?pid={pid_m.group(1)}" if pid_m else ""
            )

            if prod_url not in items_by_url:
                items_by_url[prod_url] = {
                    "texts": [],
                    "full_snippets": [],
                    "title_attr": None,
                }

            items_by_url[prod_url]["full_snippets"].append(full_a)

            # Check for title attribute
            tm = re.search(r'title=\"([^\"]+)\"', full_a)
            if tm and not items_by_url[prod_url]["title_attr"]:
                items_by_url[prod_url]["title_attr"] = tm.group(1).strip()

            # Check for img alt
            alt_m = re.search(r'<img[^>]+alt=\"([^\"]+)\"', full_a)
            if alt_m and not items_by_url[prod_url]["title_attr"]:
                items_by_url[prod_url]["title_attr"] = alt_m.group(1).strip()

            for chunk in re.findall(r">([^<]+)<", full_a):
                txt = chunk.strip()
                if txt and len(txt) > 2 and txt not in items_by_url[prod_url]["texts"]:
                    items_by_url[prod_url]["texts"].append(txt)

        offers: list[dict] = []
        seen_urls: set[str] = set()

        for prod_url, d in items_by_url.items():
            if prod_url in seen_urls:
                continue
            seen_urls.add(prod_url)

            title = d["title_attr"]
            if not title:
                for t in d["texts"]:
                    if not t.startswith("₹") and not t.startswith("Add to") and len(t) > 10:
                        clean_t = t
                        for pfx in ("Add to Compare", "Currently unavailable"):
                            if clean_t.startswith(pfx):
                                clean_t = clean_t[len(pfx):].strip()
                        title = clean_t
                        break

            if not title:
                continue

            all_prices: list[float] = []
            for snippet in d["full_snippets"]:
                no_comm = re.sub(r"<!--.*?-->", "", snippet)
                cl_txt = re.sub(r"<[^>]+>", " ", no_comm)
                cl_txt = re.sub(r"\s+", " ", cl_txt).strip()
                main_block = cl_txt.split("Upto")[0].split("Exchange")[0]
                p_matches = re.findall(r"₹\s*([0-9,]+)", main_block)
                for pm in p_matches:
                    val = float(pm.replace(",", ""))
                    if val > 0:
                        all_prices.append(val)

            if not all_prices:
                # Recorded internally as price extraction failed
                offers.append({
                    "retailer_name": "Flipkart",
                    "product_title": title,
                    "product_url": prod_url,
                    "current_price": -1.0,  # indicates missing/failed price
                    "mrp": None,
                    "currency": "INR",
                    "availability": "OUT_OF_STOCK",
                    "rejection_category": RejectionCategory.PRICE_EXTRACTION_FAILED.value,
                })
                continue

            selling_price = all_prices[0]
            mrp = (
                all_prices[1]
                if len(all_prices) > 1 and all_prices[1] > selling_price
                else None
            )

            is_unavailable = any("Currently unavailable" in t for t in d["texts"])
            availability = "OUT_OF_STOCK" if is_unavailable else "IN_STOCK"

            offers.append({
                "retailer_name": "Flipkart",
                "product_title": title,
                "product_url": prod_url,
                "current_price": selling_price,
                "mrp": mrp,
                "currency": "INR",
                "availability": availability,
                "rejection_category": None,
            })

        return offers


class CromaRetriever(BaseRetriever):
    name = "Croma"
    domain = "croma.com"
    is_enabled = False
    last_http_status = 403
    status_reason = (
        "Disabled: Croma public endpoints enforce anti-bot controls (HTTP 403 Forbidden)."
    )

    def search(self, query: str, timeout: float = 6.0) -> list[dict]:
        return []


class RelianceDigitalRetriever(BaseRetriever):
    name = "Reliance Digital"
    domain = "reliancedigital.in"
    is_enabled = False
    status_reason = (
        "Disabled: Reliance Digital search requires client-side JavaScript SPA hydration; "
        "public server-side rendered search results are not served."
    )

    def search(self, query: str, timeout: float = 6.0) -> list[dict]:
        return []


class VijaySalesRetriever(BaseRetriever):
    name = "Vijay Sales"
    domain = "vijaysales.com"
    is_enabled = False
    last_http_status = 404
    status_reason = (
        "Disabled: Vijay Sales public search endpoint is currently unavailable (HTTP 404)."
    )

    def search(self, query: str, timeout: float = 6.0) -> list[dict]:
        return []


class OfferRetrievalService:
    def __init__(self, retrievers: Optional[list[BaseRetriever]] = None):
        self.retrievers = retrievers or [
            FlipkartRetriever(),
            CromaRetriever(),
            RelianceDigitalRetriever(),
            VijaySalesRetriever(),
        ]

    def build_search_query(self, title: str, variant: Optional[str] = None) -> str:
        specs = ProductMatcher.extract_specs(title, variant_hint=variant)
        parts: list[str] = []
        if specs.brand:
            parts.append(specs.brand.title())

        # 1. Refrigerators & Appliances
        if specs.category == "refrigerator":
            if specs.capacity:
                parts.append(specs.capacity)
            parts.append("Refrigerator")
            return " ".join(parts)

        # 2. Laptops
        if specs.category == "laptop" or specs.product_family:
            clean_fam = (specs.product_family or "").title()
            if "Macbook" in clean_fam:
                clean_fam = clean_fam.replace("Macbook", "MacBook")
            if clean_fam:
                parts.append(clean_fam)

            # Dedicated GPU for gaming laptops
            if specs.gpu_model:
                parts.append(specs.gpu_model.upper())
            elif specs.cpu_family and clean_fam and specs.cpu_family not in clean_fam.lower():
                parts.append(specs.cpu_family.title())

            if specs.storage:
                parts.append(specs.storage)
            return " ".join(parts).strip()

        # 3. Audio
        if specs.category == "audio":
            if specs.model_line:
                clean_ml = specs.model_line.replace(" ", "").replace("-", "")
                if clean_ml.startswith("wh") and "1000xm" in clean_ml:
                    ml = "WH-" + clean_ml[2:].upper()
                elif clean_ml.startswith("wf") and "1000xm" in clean_ml:
                    ml = "WF-" + clean_ml[2:].upper()
                else:
                    ml = specs.model_line.title()
                parts.append(ml)
            return " ".join(parts)

        # 4. Smartphones
        if specs.category == "smartphone":
            clean_fam = (specs.product_family or specs.model_line or "").title()
            if "Iphone" in clean_fam:
                clean_fam = clean_fam.replace("Iphone", "iPhone")
            if clean_fam:
                parts.append(clean_fam)
            for q in specs.model_qualifiers:
                if q not in ("neo", "gaming"):
                    parts.append(q.title())
            if specs.storage:
                parts.append(specs.storage)
            if specs.color and specs.model_line in ("macbook neo", "iphone 16"):
                parts.append(specs.color.title())
            return " ".join(parts)

        # General / other categories
        if specs.model_line:
            parts.append(specs.model_line.title())
        for q in specs.model_qualifiers:
            if q not in ("neo", "gaming"):
                parts.append(q.title())
        if specs.storage:
            parts.append(specs.storage)

        if parts:
            return " ".join(parts)

        # Fallback to cleaning the first 5 words of title
        cleaned = re.sub(r"[^a-zA-Z0-9\s]", " ", title)
        words = [w for w in cleaned.split() if len(w) > 1][:5]
        return " ".join(words)

    def retrieve_and_match(
        self,
        source_title: str,
        source_variant: Optional[str] = None,
        timeout_per_retriever: float = 6.0,
    ) -> tuple[list[dict], list[str], dict[str, str], str, list[dict], list[RetailerDiagnostic]]:
        now_iso = datetime.now(timezone.utc).isoformat()
        query = self.build_search_query(source_title, variant=source_variant)

        queried_retailers: list[str] = []
        statuses: dict[str, str] = {}
        retailer_diagnostics: list[RetailerDiagnostic] = []
        all_evaluated_offers: list[dict] = []
        candidate_evaluations: list[dict] = []
        seen_urls: set[str] = set()

        for retriever in self.retrievers:
            queried_retailers.append(retriever.name)

            if not retriever.is_enabled:
                statuses[retriever.name] = retriever.status_reason
                retailer_diagnostics.append(RetailerDiagnostic(
                    retailer_name=retriever.name,
                    search_query=query,
                    http_status=getattr(retriever, "last_http_status", None),
                    status_reason=retriever.status_reason,
                    raw_listings_count=0,
                    parsed_listings_count=0,
                    valid_price_count=0,
                    price_failed_count=0,
                    model_mismatch_count=0,
                    config_mismatch_count=0,
                    unverified_variant_count=0,
                    condition_mismatch_count=0,
                    exact_matches_count=0,
                    rejection_breakdown={},
                ))
                continue

            try:
                candidates = retriever.search(query, timeout=timeout_per_retriever)
                http_st = getattr(retriever, "last_http_status", 200)
                raw_cnt = getattr(retriever, "last_raw_count", len(candidates))
                parsed_cnt = len(candidates)
                if not candidates:
                    statuses[retriever.name] = f"Queried successfully (HTTP {http_st}); 0 listings returned."
                else:
                    statuses[retriever.name] = f"Queried successfully (HTTP {http_st}); retrieved {len(candidates)} listings."
            except Exception as err:
                statuses[retriever.name] = f"Query failed: {type(err).__name__}"
                candidates = []
                http_st = getattr(retriever, "last_http_status", None)
                raw_cnt = 0
                parsed_cnt = 0

            # Diagnostics counters for this retailer
            valid_price_cnt = 0
            price_failed_cnt = 0
            model_mismatch_cnt = 0
            config_mismatch_cnt = 0
            unverified_cnt = 0
            condition_cnt = 0
            exact_matches_cnt = 0
            rej_breakdown: dict[str, int] = {}

            for raw_offer in candidates:
                cand_title = raw_offer["product_title"]
                cand_url = raw_offer["product_url"]

                # Deduplicate repeated results from the same listing
                if cand_url in seen_urls:
                    continue
                seen_urls.add(cand_url)

                # Price verification
                price = raw_offer.get("current_price", -1.0)
                if price <= 0:
                    status = MatchStatus.MISMATCH
                    reason = "Price could not be verified from listing HTML."
                    rejection_category = RejectionCategory.PRICE_EXTRACTION_FAILED
                    cand_vars = {}
                    price_failed_cnt += 1
                else:
                    valid_price_cnt += 1
                    status, reason, rejection_category, cand_vars = ProductMatcher.evaluate_match(
                        source_title,
                        cand_title,
                        source_variant=source_variant,
                        candidate_url=cand_url,
                    )

                # Update diagnostic counters
                if status == MatchStatus.EXACT_MATCH:
                    exact_matches_cnt += 1
                else:
                    cat_val = rejection_category.value
                    rej_breakdown[cat_val] = rej_breakdown.get(cat_val, 0) + 1
                    if rejection_category == RejectionCategory.MODEL_MISMATCH:
                        model_mismatch_cnt += 1
                    elif rejection_category == RejectionCategory.CONFIG_MISMATCH:
                        config_mismatch_cnt += 1
                    elif rejection_category == RejectionCategory.UNVERIFIED_VARIANT:
                        unverified_cnt += 1
                    elif rejection_category == RejectionCategory.ACCESSORY_OR_CONDITION:
                        condition_cnt += 1

                candidate_evaluations.append({
                    "candidate_title": cand_title,
                    "price": price,
                    "product_url": cand_url,
                    "extracted_variants": cand_vars,
                    "extraction_status": "SUCCESS" if price > 0 else "PRICE_EXTRACTION_FAILED",
                    "status": status.value,
                    "rejection_category": rejection_category.value,
                    "reason": reason,
                })

                all_evaluated_offers.append({
                    "retailer_name": raw_offer["retailer_name"],
                    "product_title": cand_title,
                    "product_url": cand_url,
                    "current_price": price,
                    "mrp": raw_offer.get("mrp"),
                    "currency": "INR",
                    "match_status": status.value,
                    "match_details": reason,
                    "rejection_category": rejection_category.value,
                    "retrieval_timestamp": now_iso,
                    "availability": raw_offer.get("availability", "IN_STOCK"),
                    "shipping_cost": None,
                    "model_identifier": cand_vars.get("mpn"),
                    "configuration": cand_vars.get("storage") or cand_vars.get("capacity"),
                    "extracted_variants": cand_vars,
                })

            retailer_diagnostics.append(RetailerDiagnostic(
                retailer_name=retriever.name,
                search_query=query,
                http_status=http_st,
                status_reason=statuses[retriever.name],
                raw_listings_count=raw_cnt,
                parsed_listings_count=parsed_cnt,
                valid_price_count=valid_price_cnt,
                price_failed_count=price_failed_cnt,
                model_mismatch_count=model_mismatch_cnt,
                config_mismatch_count=config_mismatch_cnt,
                unverified_variant_count=unverified_cnt,
                condition_mismatch_count=condition_cnt,
                exact_matches_count=exact_matches_cnt,
                rejection_breakdown=rej_breakdown,
            ))

        return all_evaluated_offers, queried_retailers, statuses, query, candidate_evaluations, retailer_diagnostics
