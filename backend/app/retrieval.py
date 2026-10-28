"""
DealSense API — retrieval.py
Live retailer product search and offer extraction service for Indian e-commerce.
Queries live public search endpoints with timeout enforcement and anti-bot handling.
Deterministic parsing of titles, prices, and links without mock or fabricated data.
"""

from __future__ import annotations

import json
import os
import re
import ssl
import http.cookiejar
import urllib.parse
import urllib.request
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Optional

from app.matcher import MatchStatus, ProductMatcher, RejectionCategory
from app.models import RetailerDiagnostic

def _load_env_file() -> None:
    """
    Loads environment variables from backend/.env or .env if present.
    Preserves any pre-existing environment variables without logging or exposing values.
    """
    candidates = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".env")),
        os.path.abspath(os.path.join(os.getcwd(), "backend", ".env")),
        os.path.abspath(os.path.join(os.getcwd(), ".env")),
    ]
    for p in candidates:
        if os.path.isfile(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'\"")
                        if k and k not in os.environ:
                            os.environ[k] = v
            except Exception:
                pass
            break

_load_env_file()



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
    data_source = "Flipkart Live Search"

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

            seller_name = None
            for t in d["texts"]:
                sm = re.search(r'Seller\s*:\s*([^,\n]+)', t, re.IGNORECASE)
                if sm:
                    seller_name = sm.group(1).strip()
                    break

            delivery_est = None
            for t in d["texts"]:
                if "delivery by" in t.lower() or "free delivery" in t.lower():
                    delivery_est = t.strip()
                    break

            img_url = None
            if d.get("full_snippets"):
                img_m = re.search(r'<img[^>]+src=\"([^\"]+)\"', d["full_snippets"][0])
                if img_m:
                    img_url = img_m.group(1)

            pid_match = re.search(r'pid=([A-Z0-9]+)', prod_url)
            ret_pid = pid_match.group(1) if pid_match else None

            offers.append({
                "retailer_name": "Flipkart",
                "product_title": title,
                "product_url": prod_url,
                "retailer_product_id": ret_pid,
                "current_price": selling_price,
                "mrp": mrp,
                "currency": "INR",
                "availability": availability,
                "seller_name": seller_name,
                "delivery_estimate": delivery_est,
                "image_url": img_url,
                "condition": "New",
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




class AmazonRetriever(BaseRetriever):
    name = "Amazon.in"
    domain = "amazon.in"
    is_enabled = True
    status_reason = "Active: Live public search retrieval with deterministic validation."
    data_source: str = "Amazon Direct Search"

    # Bot-block, CAPTCHA, and 503 challenge indicators
    _BOT_BLOCK_INDICATORS = [
        "bm-verify",
        "interstitialChallenge",
        "AkamaiGHost",
        "triggerInterstitialChallenge",
    ]
    _CAPTCHA_INDICATORS = [
        "captchacharacters",
        "/errors/validatecaptcha",
        "type the characters you see",
        "enter the characters you see below",
        "sorry, we just need to make sure you're not a robot",
    ]
    _503_INDICATORS = [
        "503 - Service Unavailable Error",
        "rush hour and traffic is piling up",
        "automated access to Amazon data",
    ]

    def __init__(self):
        super().__init__()
        self._cj = http.cookiejar.CookieJar()
        self._opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self._cj))
        self._warmed = False

        # Mode A: Official Amazon Product Advertising API (PA-API 5.0)
        self.paapi_key = os.getenv("AMAZON_PAAPI_ACCESS_KEY")
        self.paapi_secret = os.getenv("AMAZON_PAAPI_SECRET_KEY")
        self.paapi_tag = os.getenv("AMAZON_PAAPI_PARTNER_TAG")
        self.paapi_region = os.getenv("AMAZON_PAAPI_REGION", "eu-west-1")

        # Mode B: Authorized Product Data Provider (Rainforest API)
        self.rainforest_key = os.getenv("RAINFOREST_API_KEY")

        # Mode C: Bright Data Web Scraper / SERP API (Optional Free Allowance / Trial)
        self.bright_data_key = os.getenv("BRIGHT_DATA_API_KEY")
        self.bright_data_zone = os.getenv("BRIGHT_DATA_ZONE", "web_unlocker1")

        if self.paapi_key and self.paapi_secret and self.paapi_tag:
            self.data_source = "Amazon Product Advertising API (PA-API v5)"
        elif self.bright_data_key:
            self.data_source = "Bright Data Web Scraper (Amazon India)"
        elif self.rainforest_key:
            self.data_source = "Rainforest API (Amazon India)"
        else:
            self.data_source = "Amazon Direct Search"

    def search(self, query: str, timeout: float = 6.0) -> list[dict]:
        """
        Dispatches to the configured permitted Amazon India data source:
        1. Official PA-API 5.0 (if AMAZON_PAAPI_* keys configured)
        2. Bright Data Web Scraper (if BRIGHT_DATA_API_KEY configured)
        3. Rainforest API (if RAINFOREST_API_KEY configured)
        4. Direct Search (with honest CloudFront WAF 503/403 detection)
        """
        if self.paapi_key and self.paapi_secret and self.paapi_tag:
            return self._search_paapi(query, timeout=timeout)
        elif self.bright_data_key:
            return self._search_bright_data(query, timeout=timeout)
        elif self.rainforest_key:
            return self._search_rainforest(query, timeout=timeout)
        else:
            return self._search_direct(query, timeout=timeout)

    def _search_bright_data(self, query: str, timeout: float = 8.0) -> list[dict]:
        """
        Optional backend retrieval adapter using Bright Data's Web Unlocker / SERP API.
        Active only when BRIGHT_DATA_API_KEY is configured in backend/.env.
        Enables reliable retrieval of Amazon India search listings without CloudFront WAF blocks.
        """
        if not self.bright_data_key:
            return self._search_direct(query, timeout=timeout)

        url = "https://api.brightdata.com/request"
        target_url = f"https://www.amazon.in/s?k={urllib.parse.quote(query)}"
        payload_data = json.dumps({
            "zone": self.bright_data_zone,
            "url": target_url,
            "format": "raw"
        }).encode("utf-8")

        headers = {
            "Authorization": f"Bearer {self.bright_data_key}",
            "Content-Type": "application/json",
            "User-Agent": "DealSense-Backend/2.0"
        }

        try:
            req = urllib.request.Request(url, data=payload_data, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as response:
                html = response.read().decode("utf-8", errors="replace")
                self.last_http_status = response.getcode()
                return self._parse_amazon_html(html)
        except Exception as err:
            self.last_http_status = 502
            self.status_reason = f"Bright Data request failed: {str(err)}"
            return self._search_direct(query, timeout=timeout)

    def _search_paapi(self, query: str, timeout: float = 6.0) -> list[dict]:
        """
        Queries Amazon's official Product Advertising API (PA-API 5.0)
        using AWS Signature Version 4 authentication.
        """
        import hashlib
        import hmac
        from datetime import datetime, timezone

        host = "webservices.amazon.in"
        endpoint = f"https://{host}/paapi5/searchitems"
        service = "ProductAdvertisingAPI"
        region = self.paapi_region
        now = datetime.now(timezone.utc)
        amz_date = now.strftime("%Y%m%dT%H%M%SZ")
        date_stamp = now.strftime("%Y%m%d")

        payload = {
            "Keywords": query,
            "SearchIndex": "All",
            "ItemCount": 10,
            "Resources": [
                "ItemInfo.Title",
                "Offers.Listings.Price",
                "Offers.Listings.Availability.Message",
                "Offers.Listings.MerchantInfo",
                "Images.Primary.Large",
            ],
            "PartnerTag": self.paapi_tag,
            "PartnerType": "Associates",
            "Marketplace": "www.amazon.in",
        }
        body_bytes = json.dumps(payload).encode("utf-8")

        canonical_uri = "/paapi5/searchitems"
        canonical_querystring = ""
        canonical_headers = (
            f"content-encoding:amz-1.0\n"
            f"content-type:application/json; charset=utf-8\n"
            f"host:{host}\n"
            f"x-amz-date:{amz_date}\n"
            f"x-amz-target:com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems\n"
        )
        signed_headers = "content-encoding;content-type;host;x-amz-date;x-amz-target"
        payload_hash = hashlib.sha256(body_bytes).hexdigest()
        canonical_request = (
            f"POST\n{canonical_uri}\n{canonical_querystring}\n"
            f"{canonical_headers}\n{signed_headers}\n{payload_hash}"
        )

        algorithm = "AWS4-HMAC-SHA256"
        credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
        string_to_sign = (
            f"{algorithm}\n{amz_date}\n{credential_scope}\n"
            f"{hashlib.sha256(canonical_request.encode('utf-8')).hexdigest()}"
        )

        def _sign(k: bytes, m: str) -> bytes:
            return hmac.new(k, m.encode("utf-8"), hashlib.sha256).digest()

        k_date = _sign(("AWS4" + self.paapi_secret).encode("utf-8"), date_stamp)
        k_region = _sign(k_date, region)
        k_service = _sign(k_region, service)
        k_signing = _sign(k_service, "aws4_request")
        signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

        auth_header = (
            f"{algorithm} Credential={self.paapi_key}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )

        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Encoding": "amz-1.0",
            "X-Amz-Date": amz_date,
            "X-Amz-Target": "com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems",
            "Authorization": auth_header,
            "Host": host,
        }

        try:
            req = urllib.request.Request(endpoint, data=body_bytes, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                self.last_http_status = resp.status
                data = json.loads(resp.read().decode("utf-8"))
                return self._parse_paapi_response(data)
        except urllib.error.HTTPError as he:
            self.last_http_status = he.code
            err_msg = he.read().decode("utf-8", errors="ignore")
            self.status_reason = f"PA-API error (HTTP {he.code}): {err_msg[:200]}"
            return []
        except Exception as e:
            self.last_http_status = None
            self.status_reason = f"PA-API request failed: {type(e).__name__}"
            return []

    def _parse_paapi_response(self, data: dict) -> list[dict]:
        items = data.get("SearchResult", {}).get("Items", [])
        self.last_raw_count = len(items)
        offers: list[dict] = []
        for it in items:
            asin = it.get("ASIN")
            title = it.get("ItemInfo", {}).get("Title", {}).get("DisplayValue")
            url = it.get("DetailPageURL", f"https://www.amazon.in/dp/{asin}")
            img = it.get("Images", {}).get("Primary", {}).get("Large", {}).get("URL")

            price_val = -1.0
            listings = it.get("Offers", {}).get("Listings", [])
            merchant_name = None
            avail = "IN_STOCK"
            if listings:
                first = listings[0]
                price_val = first.get("Price", {}).get("Amount", -1.0)
                merchant_name = first.get("MerchantInfo", {}).get("Name")
                avail_msg = first.get("Availability", {}).get("Message", "")
                if "out of stock" in avail_msg.lower():
                    avail = "OUT_OF_STOCK"

            if not title or price_val <= 0:
                continue

            offers.append({
                "retailer_name": "Amazon.in",
                "product_title": title,
                "product_url": url,
                "retailer_product_id": asin,
                "current_price": float(price_val),
                "mrp": None,
                "currency": "INR",
                "availability": avail,
                "seller_name": merchant_name,
                "delivery_estimate": None,
                "image_url": img,
                "condition": "New",
                "rejection_category": None,
                "data_source": "Amazon Product Advertising API (PA-API v5)",
            })
        self.last_parsed_count = len(offers)
        self.status_reason = f"Queried successfully via PA-API 5.0 (HTTP 200); retrieved {len(offers)} offers."
        return offers

    def _search_rainforest(self, query: str, timeout: float = 6.0) -> list[dict]:
        """
        Queries Rainforest API for structured Amazon India product search.
        """
        params = urllib.parse.urlencode({
            "api_key": self.rainforest_key,
            "type": "search",
            "amazon_domain": "amazon.in",
            "search_term": query,
        })
        url = f"https://api.rainforestapi.com/request?{params}"
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                self.last_http_status = resp.status
                data = json.loads(resp.read().decode("utf-8"))
                return self._parse_rainforest_response(data)
        except urllib.error.HTTPError as he:
            self.last_http_status = he.code
            self.status_reason = f"Rainforest API error (HTTP {he.code})."
            return []
        except Exception as e:
            self.last_http_status = None
            self.status_reason = f"Rainforest API request failed: {type(e).__name__}."
            return []

    def _parse_rainforest_response(self, data: dict) -> list[dict]:
        results = data.get("search_results", [])
        self.last_raw_count = len(results)
        offers: list[dict] = []
        for it in results:
            title = it.get("title")
            asin = it.get("asin")
            link = it.get("link", f"https://www.amazon.in/dp/{asin}")
            price_obj = it.get("price", {})
            price_val = price_obj.get("value", -1.0)
            rrp_obj = it.get("rrp", {})
            mrp_val = rrp_obj.get("value")
            img = it.get("image")
            seller = it.get("merchant_info", {}).get("name")

            if not title or price_val <= 0:
                continue

            offers.append({
                "retailer_name": "Amazon.in",
                "product_title": title,
                "product_url": link,
                "retailer_product_id": asin,
                "current_price": float(price_val),
                "mrp": float(mrp_val) if mrp_val else None,
                "currency": "INR",
                "availability": "IN_STOCK",
                "seller_name": seller,
                "delivery_estimate": None,
                "image_url": img,
                "condition": "New",
                "rejection_category": None,
                "data_source": "Rainforest API (Amazon India)",
            })
        self.last_parsed_count = len(offers)
        self.status_reason = f"Queried successfully via Rainforest API (HTTP 200); retrieved {len(offers)} offers."
        return offers

    def _get_headers(self, referer: str = "https://www.amazon.in/") -> dict[str, str]:
        return {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
            "Upgrade-Insecure-Requests": "1",
        }

    def _ensure_session(self, timeout: float = 6.0) -> None:
        pass

    def _is_bot_blocked(self, html: str) -> str:
        if not html:
            return "empty"
        for ind in self._503_INDICATORS:
            if ind in html:
                return "503_block"
        hl = html.lower()
        for indicator in self._CAPTCHA_INDICATORS:
            if indicator.lower() in hl:
                return "captcha"
        for indicator in self._BOT_BLOCK_INDICATORS:
            if indicator in html:
                return "bot_block"
        if len(html) < 400:
            return "empty"
        if "s-result-item" not in html and "data-asin" not in html:
            if len(html) < 5000:
                return "bot_block"
        return "ok"

    def _search_direct(self, query: str, timeout: float = 6.0) -> list[dict]:
        import time as _time

        self.data_source = "Amazon Direct Search"
        self._ensure_session(timeout=min(timeout, 4.0))
        url = f"https://www.amazon.in/s?k={urllib.parse.quote(query)}"
        headers = self._get_headers(referer="https://www.amazon.in/")

        max_attempts = 2
        html = ""
        for attempt in range(max_attempts):
            req = urllib.request.Request(url, headers=headers)
            try:
                with self._opener.open(req, timeout=timeout) as resp:
                    self.last_http_status = resp.status
                    html = resp.read().decode("utf-8", errors="ignore")
            except urllib.error.HTTPError as he:
                self.last_http_status = he.code
                error_body = ""
                try:
                    error_body = he.read().decode("utf-8", errors="ignore")
                except Exception:
                    pass
                if he.code == 503 or any(ind in error_body for ind in self._503_INDICATORS):
                    self.status_reason = (
                        "Blocked: Amazon India CloudFront bot protection restricts automated server retrieval (HTTP 503). "
                        "Configure official Amazon PA-API 5.0 credentials (AMAZON_PAAPI_ACCESS_KEY) or Rainforest API (RAINFOREST_API_KEY) for production reverse search."
                    )
                    self.last_http_status = 503
                    return []
                elif he.code in (403, 429):
                    self.status_reason = (
                        f"Blocked: Amazon India CloudFront bot protection returned HTTP {he.code} (Anti-bot restriction). "
                        "Configure official Amazon PA-API 5.0 credentials or Rainforest API for production reverse search."
                    )
                    self.last_http_status = he.code
                    return []
                else:
                    self.status_reason = f"Amazon returned HTTP {he.code}."
                    return []
            except Exception as e:
                self.last_http_status = None
                self.status_reason = f"Amazon request failed: {type(e).__name__}."
                return []

            block_status = self._is_bot_blocked(html)
            if block_status == "ok":
                self.last_http_status = 200
                break
            elif block_status == "503_block":
                self.status_reason = (
                    "Blocked: Amazon India CloudFront returned a 503 Service Unavailable page. "
                    "Automated server retrieval is restricted by retailer access controls."
                )
                self.last_http_status = 503
                return []
            elif block_status == "bot_block":
                self.status_reason = (
                    "Blocked: Amazon India served an Akamai bot-detection challenge page (HTTP 403). "
                    "Configure official Amazon PA-API 5.0 credentials (AMAZON_PAAPI_ACCESS_KEY) or Rainforest API (RAINFOREST_API_KEY) for production reverse search."
                )
                self.last_http_status = 403
                if attempt < max_attempts - 1:
                    _time.sleep(1.0)
                    continue
                return []
            elif block_status == "captcha":
                self.status_reason = (
                    "Blocked: Amazon India served a CAPTCHA challenge (HTTP 403). "
                    "Automated retrieval cannot solve CAPTCHAs. Configure official Amazon PA-API 5.0 credentials for production reverse search."
                )
                self.last_http_status = 403
                return []
            elif block_status == "empty":
                self.status_reason = "Amazon returned an empty or malformed response."
                self.last_http_status = 204
                return []

        parsed = self._parse_amazon_html(html)
        self.last_parsed_count = len(parsed)
        if self.last_http_status == 200:
            if len(parsed) == 0 and self.last_raw_count == 0:
                self.status_reason = f"Queried successfully (HTTP 200); 0 listings returned for query '{query}'."
            else:
                self.status_reason = f"Queried successfully (HTTP 200); retrieved {len(parsed)} parsed listings."
        return parsed

    def _parse_amazon_html(self, html: str) -> list[dict]:
        cards = re.findall(
            r'<div[^>]+(?:data-asin="([A-Z0-9]{10})"[^>]*class="[^"]*s-result-item[^"]*"|class="[^"]*s-result-item[^"]*"[^>]*data-asin="([A-Z0-9]{10})")[^>]*>(.*?)(?=<div[^>]+data-asin=|\Z)',
            html,
            re.DOTALL,
        )
        self.last_raw_count = len(cards)
        offers: list[dict] = []
        seen_asins: set[str] = set()

        for m in cards:
            asin = m[0] or m[1]
            block = m[2]
            if not asin or asin == "0000000000" or asin in seen_asins:
                continue
            seen_asins.add(asin)

            # 1. Brand header (if Amazon renders brand separately in h2.a-size-mini or h2.s-line-clamp-1)
            brand_prefix = ""
            bh_m = re.search(r'<h2[^>]*class="[^"]*(?:s-line-clamp-1|a-size-mini)[^"]*"[^>]*>(.*?)</h2>', block, re.DOTALL)
            if bh_m:
                cand_b = re.sub(r"<[^>]+>", "", bh_m.group(1)).strip()
                if len(cand_b) < 30 and "sponsored" not in cand_b.lower() and "let us know" not in cand_b.lower():
                    brand_prefix = cand_b

            # 2. Main product title link
            title = ""
            # Priority A: Anchor with a-text-normal (standard Amazon product title anchor)
            tm = re.search(r'<a[^>]+class="[^"]*a-text-normal[^"]*"[^>]*>(.*?)</a>', block, re.DOTALL)
            if tm:
                title = re.sub(r"<[^>]+>", "", tm.group(1)).strip()
            # Priority B: Anchor inside h2/h3
            if not title:
                tm = re.search(r'<h[23][^>]*>.*?<a[^>]*>(.*?)</a>.*?</h[23]>', block, re.DOTALL)
                if tm:
                    title = re.sub(r"<[^>]+>", "", tm.group(1)).strip()
            # Priority C: Heading text
            if not title:
                tm = re.search(r'<h[23][^>]*>(.*?)</h[23]>', block, re.DOTALL)
                if tm:
                    title = re.sub(r"<[^>]+>", "", tm.group(1)).strip()

            if not title or len(title) < 3:
                continue

            # Prefix brand name if present in card header and missing from title text
            if brand_prefix and brand_prefix.lower() not in title.lower():
                title = f"{brand_prefix} {title}"

            prices = re.findall(
                r'<span class="a-price"[^>]*>.*?<span class="a-offscreen">₹\s*([0-9,]+(?:\.[0-9]+)?)</span>',
                block,
                re.DOTALL,
            )
            selling_price = -1.0
            if prices:
                try:
                    selling_price = float(prices[0].replace(",", ""))
                except Exception:
                    selling_price = -1.0

            mrps = re.findall(
                r'<span class="a-price a-text-price"[^>]*>.*?<span class="a-offscreen">₹\s*([0-9,]+(?:\.[0-9]+)?)</span>',
                block,
                re.DOTALL,
            )
            mrp = None
            if mrps:
                try:
                    mrp_val = float(mrps[0].replace(",", ""))
                    if mrp_val > selling_price:
                        mrp = mrp_val
                except Exception:
                    mrp = None

            href_m = re.search(r'href="(/[^"]+/dp/[A-Z0-9]{10}[^"]*)"', block)
            if href_m:
                clean_path = href_m.group(1).split("/ref=")[0].split("?")[0]
                prod_url = f"https://www.amazon.in{clean_path}"
            else:
                prod_url = f"https://www.amazon.in/dp/{asin}"

            seller_name = None
            sm = re.search(r'(?:sold by|fulfilled by)\s*([^<\n\.]+)', block, re.IGNORECASE)
            if sm:
                seller_name = sm.group(1).strip()
            if not seller_name:
                sm2 = re.search(r'<span class="a-size-small\s+a-color-secondary">by\s+<span class="a-size-small[^"]*">([^<]+)</span>', block)
                if sm2:
                    seller_name = sm2.group(1).strip()

            delivery_est = None
            dm = re.search(r'(?:FREE Delivery|Get it)\s+by\s+([A-Za-z0-9,\s]+?)(?:<|\.|\n)', block, re.IGNORECASE)
            if dm:
                delivery_est = dm.group(0).strip().rstrip(".")

            img_url = None
            im = re.search(r'<img[^>]+class="[^"]*s-image[^"]*"[^>]+src="([^"]+)"', block)
            if im:
                img_url = im.group(1)

            offers.append({
                "retailer_name": "Amazon.in",
                "product_title": title,
                "product_url": prod_url,
                "retailer_product_id": asin,
                "current_price": selling_price,
                "mrp": mrp,
                "currency": "INR",
                "availability": "IN_STOCK",
                "seller_name": seller_name,
                "delivery_estimate": delivery_est,
                "image_url": img_url,
                "condition": "New",
                "rejection_category": None if selling_price > 0 else RejectionCategory.PRICE_EXTRACTION_FAILED.value,
                "data_source": "Amazon Direct Search",
            })

        return offers




class SerpApiGoogleShoppingRetriever(BaseRetriever):
    name = "SerpApi Google Shopping"
    domain = "google.co.in"
    data_source = "SerpApi Google Shopping (India)"

    def __init__(self):
        super().__init__()
        _load_env_file()
        self.api_key = os.getenv("SERPAPI_API_KEY")
        self.is_enabled = bool(self.api_key and self.api_key.strip())
        if self.is_enabled:
            self.status_reason = "Active: Live SerpApi Google Shopping retrieval for Indian retailers."
        else:
            self.status_reason = "Disabled: SERPAPI_API_KEY environment variable is not configured."

    @classmethod
    def unwrap_google_url(cls, raw_link: str) -> str:
        """
        Unwraps Google redirect URLs (e.g. google.co.in/url?url=...)
        to recover the direct retailer product URL.
        """
        if not raw_link:
            return ""
        if "google." in raw_link and ("/url?" in raw_link or "/url/" in raw_link):
            try:
                parsed = urllib.parse.urlparse(raw_link)
                qs = urllib.parse.parse_qs(parsed.query)
                if "url" in qs and qs["url"]:
                    return qs["url"][0]
                if "q" in qs and qs["q"]:
                    return qs["q"][0]
            except Exception:
                pass
        return raw_link

    @classmethod
    def identify_retailer_and_seller(cls, source_text: Optional[str], unwrapped_url: str) -> tuple[Optional[str], Optional[str]]:
        """
        Deterministically identifies whether a Google Shopping result belongs to
        Amazon.in or Flipkart. Rejects all other third-party retailers.
        Extracts verified seller name if distinguishable.
        Returns: (retailer_name, seller_name)
        """
        src = (source_text or "").strip()
        src_lower = src.lower()
        url_lower = (unwrapped_url or "").lower()

        retailer: Optional[str] = None
        seller: Optional[str] = None

        # Check Amazon India
        if "amazon.in" in url_lower or re.search(r"\bamazon(?:\.in)?\b", src_lower):
            retailer = "Amazon.in"
            if " - " in src:
                seller_part = src.split(" - ", 1)[1].strip()
                if seller_part and seller_part.lower() not in ("amazon", "amazon.in"):
                    seller = seller_part
            return retailer, seller

        # Check Flipkart
        if "flipkart.com" in url_lower or re.search(r"\bflipkart\b", src_lower):
            retailer = "Flipkart"
            if " - " in src:
                seller_part = src.split(" - ", 1)[1].strip()
                if seller_part and seller_part.lower() not in ("flipkart", "flipkart.com"):
                    seller = seller_part
            return retailer, seller

        # Third-party / brand stores (Croma, Tata CLiQ, brand direct, etc.)
        return None, None

    def search(self, query: str, timeout: float = 6.0) -> list[dict]:
        """
        Retrieves live Indian shopping results from SerpApi Google Shopping engine.
        Filters and normalizes offers for supported Indian platforms (Amazon.in, Flipkart).
        """
        _load_env_file()
        key = os.getenv("SERPAPI_API_KEY") or self.api_key
        if not key or not key.strip():
            self.is_enabled = False
            self.last_http_status = None
            self.status_reason = "Disabled: SERPAPI_API_KEY is not set."
            return []

        self.is_enabled = True
        params = {
            "engine": "google_shopping",
            "q": query,
            "google_domain": "google.co.in",
            "gl": "in",
            "hl": "en",
            "api_key": key.strip(),
        }
        encoded = urllib.parse.urlencode(params)
        url = f"https://serpapi.com/search.json?{encoded}"

        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "DealSense/1.0",
                "Accept": "application/json",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                self.last_http_status = resp.status
                body = resp.read().decode("utf-8", errors="ignore")
                data = json.loads(body)
                return self.parse_shopping_results(data)
        except urllib.error.HTTPError as he:
            self.last_http_status = he.code
            if he.code == 401:
                self.status_reason = "SerpApi error (HTTP 401): Unauthorized. Check that SERPAPI_API_KEY is valid."
            elif he.code == 429:
                self.status_reason = "SerpApi error (HTTP 429): Plan search rate limit exceeded."
            else:
                self.status_reason = f"SerpApi returned HTTP {he.code}."
            return []
        except urllib.error.URLError as ue:
            self.last_http_status = None
            reason_name = type(ue.reason).__name__ if hasattr(ue, "reason") and ue.reason else "Connection failed"
            self.status_reason = f"SerpApi network connection error: {reason_name}."
            return []
        except Exception as e:
            self.last_http_status = None
            self.status_reason = f"SerpApi request failed: {type(e).__name__}."
            return []

    def parse_shopping_results(self, data: dict) -> list[dict]:
        """
        Normalizes SerpApi shopping_results into standard DealSense offer dictionaries.
        """
        items = data.get("shopping_results") or []
        self.last_raw_count = len(items)
        offers: list[dict] = []

        for item in items:
            title = (item.get("title") or "").strip()
            if not title:
                continue

            raw_link = item.get("link") or item.get("product_link") or ""
            direct_url = self.unwrap_google_url(raw_link)

            source_field = item.get("source")
            if not source_field and isinstance(item.get("merchant"), dict):
                source_field = item.get("merchant", {}).get("name")
            if not source_field and isinstance(item.get("merchant"), str):
                source_field = item.get("merchant")

            retailer, seller = self.identify_retailer_and_seller(source_field, direct_url)

            # Skip items not from active platforms (e.g. Croma, Reliance, brand websites)
            if not retailer:
                continue

            # Price extraction
            price = -1.0
            if item.get("extracted_price") is not None:
                try:
                    price = float(item["extracted_price"])
                except Exception:
                    price = -1.0

            if price <= 0 and item.get("price"):
                p_clean = re.sub(r"[^\d.]", "", item["price"].replace(",", ""))
                try:
                    price = float(p_clean)
                except Exception:
                    price = -1.0

            if price <= 0:
                continue

            # MRP extraction
            mrp = None
            if item.get("extracted_old_price") is not None:
                try:
                    mrp_val = float(item["extracted_old_price"])
                    if mrp_val > price:
                        mrp = mrp_val
                except Exception:
                    mrp = None
            elif item.get("old_price"):
                m_clean = re.sub(r"[^\d.]", "", item["old_price"].replace(",", ""))
                try:
                    mrp_val = float(m_clean)
                    if mrp_val > price:
                        mrp = mrp_val
                except Exception:
                    mrp = None

            # Identifier extraction (ASIN or PID)
            product_id = None
            if retailer == "Amazon.in":
                asin_m = re.search(r"/(?:dp|gp/product)/([A-Z0-9]{10})", direct_url)
                if asin_m:
                    product_id = asin_m.group(1)
                    direct_url = f"https://www.amazon.in/dp/{product_id}"
            elif retailer == "Flipkart":
                pid_m = re.search(r"pid=([A-Z0-9]+)", direct_url)
                if pid_m:
                    product_id = pid_m.group(1)
                clean_path_m = re.search(r"(https?://(?:www\.)?flipkart\.com/[^?]+)", direct_url)
                if clean_path_m:
                    direct_url = clean_path_m.group(1) + (f"?pid={product_id}" if product_id else "")

            condition = "New"
            cond_field = str(item.get("second_hand_condition") or "").lower()
            if "used" in cond_field or "refurbished" in cond_field or "pre-owned" in cond_field:
                condition = "Used" if "used" in cond_field else "Refurbished"

            thumbnail = item.get("thumbnail")
            delivery = item.get("delivery")

            offers.append({
                "retailer_name": retailer,
                "product_title": title,
                "product_url": direct_url or raw_link,
                "retailer_product_id": product_id,
                "current_price": price,
                "mrp": mrp,
                "currency": "INR",
                "availability": "IN_STOCK",
                "seller_name": seller,
                "delivery_estimate": delivery,
                "image_url": thumbnail,
                "condition": condition,
                "rejection_category": None,
                "data_source": "SerpApi Google Shopping (India)",
            })

        self.last_parsed_count = len(offers)
        if self.last_http_status == 200:
            self.status_reason = f"Queried successfully via SerpApi (HTTP 200); retrieved {len(offers)} parsed listings."
        return offers


INACTIVE_RETAILERS = {"Croma", "Reliance Digital", "Vijay Sales"}


class OfferRetrievalService:
    ACTIVE_RETAILERS = ["Flipkart", "Amazon.in"]

    def __init__(self, retrievers: Optional[list[BaseRetriever]] = None):
        if retrievers is None:
            self.retrievers = [
                FlipkartRetriever(),
                AmazonRetriever(),
            ]
        else:
            self.retrievers = [
                r for r in retrievers
                if r.name not in INACTIVE_RETAILERS
                and not isinstance(r, (CromaRetriever, RelianceDigitalRetriever, VijaySalesRetriever))
            ]
        self.is_custom_retrievers = bool(retrievers is not None)
        self.serpapi_retriever = SerpApiGoogleShoppingRetriever()

    def build_search_query(
        self,
        title: str,
        variant: Optional[str] = None,
        brand: Optional[str] = None,
        model: Optional[str] = None,
        category: Optional[str] = None,
        specifications: Optional[dict[str, Any]] = None,
    ) -> str:
        specs = ProductMatcher.extract_specs(
            title,
            variant_hint=variant,
            category_hint=category,
            brand_hint=brand,
            model_hint=model,
            specs_hint=specifications,
        )

        if not specs.brand and brand and brand.strip().lower() not in ("unavailable", "null", "none"):
            specs.brand = brand.strip().lower()

        if not specs.model_line and model and model.strip().lower() not in ("unavailable", "null", "none"):
            specs.model_line = model.strip().lower()

        if not specs.category and (brand or model):
            hint_specs = ProductMatcher.extract_specs(f"{brand or ''} {model or ''}")
            if hint_specs.category:
                specs.category = hint_specs.category
            if not specs.model_line and hint_specs.model_line:
                specs.model_line = hint_specs.model_line
            if not specs.brand and hint_specs.brand:
                specs.brand = hint_specs.brand

        parts: list[str] = []
        if specs.brand:
            parts.append(specs.brand.title())

        # 1. Refrigerators & Appliances
        if specs.category == "refrigerator":
            if specs.capacity:
                parts.append(specs.capacity)
            parts.append("Refrigerator")
            return " ".join(parts)

        # 1b. Kitchen & Small Home Appliances
        if specs.category in ("kitchen_home", "kitchen", "appliances"):
            if specs.model_line or specs.generic_model:
                cand_m = specs.model_line or specs.generic_model
                parts.append(cand_m.upper() if (cand_m.upper() in title or any(c.isdigit() for c in cand_m)) else cand_m.title())
            if specs.volume_capacity:
                parts.append(specs.volume_capacity)
            elif specs.power_wattage:
                parts.append(specs.power_wattage)
            for noun in ("Kettle", "Air Fryer", "Mixer Grinder", "Blender", "Toaster", "Cooker", "Oven"):
                if noun.lower() in title.lower():
                    if not any(noun.lower() in p.lower() for p in parts):
                        parts.append(noun)
                    break
            return " ".join(parts).strip()

        # 1c. Footwear
        if specs.category in ("footwear", "shoes"):
            if specs.model_line or specs.generic_model:
                parts.append((specs.model_line or specs.generic_model).title())
            for noun in ("Sneakers", "Shoes", "Clogs", "Loafers", "Sandals", "Boots"):
                if noun.lower() in title.lower():
                    if not any(noun.lower() in p.lower() for p in parts):
                        parts.append(noun)
                    break
            return " ".join(parts).strip()

        # 1d. Clothing & Apparel
        if specs.category in ("clothing", "apparel"):
            if specs.model_line or specs.generic_model:
                cand_m = specs.model_line or specs.generic_model
                parts.append(cand_m.upper() if any(c.isdigit() for c in cand_m) else cand_m.title())
            for noun in ("Jeans", "T-Shirt", "Shirt", "Trousers", "Hoodie", "Jacket", "Polo"):
                if noun.lower() in title.lower():
                    if not any(noun.lower() in p.lower() for p in parts):
                        parts.append(noun)
                    break
            return " ".join(parts).strip()

        # 1e. Personal Care & Grooming
        if specs.category in ("personal_care", "grooming"):
            if specs.model_line or specs.generic_model:
                cand_m = specs.model_line or specs.generic_model
                parts.append(cand_m.upper() if any(c.isdigit() for c in cand_m) else cand_m.title())
            for noun in ("Trimmer", "Shaver", "Hair Dryer", "Toothbrush"):
                if noun.lower() in title.lower():
                    if not any(noun.lower() in p.lower() for p in parts):
                        parts.append(noun)
                    break
            return " ".join(parts).strip()

        # 1f. Toys & Games
        if specs.category in ("toys_games", "toys"):
            if specs.model_line or specs.generic_model:
                cand_m = specs.model_line or specs.generic_model
                parts.append(cand_m.upper() if any(c.isdigit() for c in cand_m) else cand_m.title())
            for noun in ("Classic", "Blocks", "Puzzle", "Car"):
                if noun.lower() in title.lower():
                    if not any(noun.lower() in p.lower() for p in parts):
                        parts.append(noun)
                    break
            return " ".join(parts).strip()

        # 1g. Watches
        if specs.category == "watches":
            if specs.model_line or specs.generic_model:
                cand_m = specs.model_line or specs.generic_model
                parts.append(cand_m.upper() if any(c.isdigit() for c in cand_m) else cand_m.title())
            if not any(w in " ".join(parts).lower() for w in ("watch", "chronograph")):
                parts.append("Watch")
            return " ".join(parts).strip()

        # 1h. Bags & Luggage
        if specs.category in ("bags_luggage", "bags", "luggage"):
            if specs.model_line or specs.generic_model:
                parts.append((specs.model_line or specs.generic_model).title())
            if specs.volume_capacity:
                parts.append(specs.volume_capacity)
            for noun in ("Backpack", "Rucksack", "Suitcase", "Luggage", "Duffel"):
                if noun.lower() in title.lower():
                    if not any(noun.lower() in p.lower() for p in parts):
                        parts.append(noun)
                    break
            return " ".join(parts).strip()

        # 1i. Books
        if specs.category == "books":
            if specs.isbn:
                return f"{specs.isbn}"
            clean_t = re.sub(r"\s*[\(\[].*?[\)\]]", "", title)
            clean_t = clean_t.split(":")[0].split("–")[0].split("-")[0].strip()
            if specs.book_author:
                return f"{clean_t} {specs.book_author}".strip()
            elif specs.brand and specs.brand != "generic":
                return f"{clean_t} {specs.brand.title()}".strip()
            return clean_t

        # 1j. Beauty & Personal Care
        if specs.category == "beauty":
            if specs.generic_model:
                parts.append(specs.generic_model.title())
            for prod_kw in ("Sunscreen", "Face Wash", "Serum", "Shampoo", "Moisturizer", "Face Cream", "Body Lotion", "Cleanser"):
                if prod_kw.lower() in title.lower() and not any(prod_kw.lower() in p.lower() for p in parts):
                    parts.append(prod_kw)
                    break
            if specs.volume_capacity:
                parts.append(specs.volume_capacity)
            return " ".join(parts).strip()

        # 1k. Household Products
        if specs.category == "household":
            if specs.generic_model:
                parts.append(specs.generic_model.title())
            for house_kw in ("Matic Front Load", "Matic Top Load", "Matic", "Liquid Detergent", "Dishwash Gel", "Floor Cleaner", "Toilet Cleaner", "Detergent"):
                if house_kw.lower() in title.lower() and not any(house_kw.lower() in p.lower() for p in parts):
                    parts.append(house_kw)
                    break
            if specs.volume_capacity:
                parts.append(specs.volume_capacity)
            return " ".join(parts).strip()

        # 1l. Computer Components
        if specs.category == "computer_components":
            if specs.component_type == "ram":
                if specs.ram:
                    parts.append(specs.ram)
                if specs.generic_model:
                    parts.append(specs.generic_model.upper())
                parts.append("RAM")
            elif specs.component_type == "gpu":
                if specs.generic_model:
                    parts.append(specs.generic_model.upper())
                else:
                    parts.append("Graphics Card")
            elif specs.generic_model:
                parts.append(specs.generic_model.upper())
            return " ".join(parts).strip()

        # 2. Laptops
        if specs.category == "laptop" or (specs.product_family and specs.category not in ("monitor", "storage", "sports", "controller", "audio", "refrigerator")):
            clean_fam = (specs.product_family or "").title()
            if "Macbook" in clean_fam:
                clean_fam = clean_fam.replace("Macbook", "MacBook")
            if clean_fam:
                parts.append(clean_fam)

            # Dedicated GPU for gaming laptops
            if specs.gpu_model:
                parts.append(specs.gpu_model.upper())
            elif specs.cpu_family and clean_fam and specs.cpu_family not in clean_fam.lower():
                if clean_fam.lower() not in ("macbook neo", "macbook air m1", "macbook air m2", "macbook air m3", "macbook air m5"):
                    parts.append(specs.cpu_family.title())

            if specs.storage:
                parts.append(specs.storage)
            return " ".join(parts).strip()

        # 3. Controllers & Gaming Peripherals
        if specs.category == "controller":
            if specs.model_line:
                parts.append(specs.model_line.upper() if specs.brand == "logitech" else specs.model_line.title())
            if specs.connectivity:
                parts.append(specs.connectivity.title())
            if not any(w in " ".join(parts).lower() for w in ("controller", "wheel", "pedal", "gamepad")):
                parts.append("Controller")
            return " ".join(parts).strip()

        # 3b. Audio
        if specs.category == "audio":
            if specs.model_line:
                clean_ml = specs.model_line.replace(" ", "").replace("-", "")
                if "1000xm" in clean_ml:
                    ml = clean_ml.upper()
                    if ml.startswith("WH") and not ml.startswith("WH-"):
                        ml = "WH-" + ml[2:]
                    elif ml.startswith("WF") and not ml.startswith("WF-"):
                        ml = "WF-" + ml[2:]
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

        # 5. Monitors & Displays
        if specs.category == "monitor":
            if specs.model_line:
                parts.append(specs.model_line.title())
            if specs.screen_size:
                parts.append(specs.screen_size)
            if specs.refresh_rate:
                parts.append(specs.refresh_rate)
            if not any("monitor" in p.lower() for p in parts):
                parts.append("Monitor")
            return " ".join(parts).strip()

        # 6. Storage Devices & Components
        if specs.category == "storage":
            if specs.model_line:
                parts.append(specs.model_line.title())
            if specs.storage:
                parts.append(specs.storage)
            if not any(w in " ".join(parts).lower() for w in ("ssd", "hdd", "nvme", "drive")):
                parts.append("SSD")
            return " ".join(parts).strip()

        # 7. Sports & Everyday Consumer Products
        if specs.category == "sports":
            if specs.model_line:
                parts.append(specs.model_line.title())
            for noun in ("Football", "Basketball", "Racquet", "Flask", "Bottle"):
                if noun.lower() in title.lower():
                    if not any(noun.lower() in p.lower() for p in parts):
                        parts.append(noun)
                    break
            return " ".join(parts).strip()

        # 8. Mice & Pointing Devices
        if specs.category == "mouse":
            if specs.model_line:
                parts.append(specs.model_line.upper() if any(c.isdigit() for c in specs.model_line) else specs.model_line.title())
            if specs.connectivity and specs.connectivity.lower() == "wireless":
                parts.append("Wireless")
            if not any(w in " ".join(parts).lower() for w in ("mouse", "mice")):
                parts.append("Mouse")
            return " ".join(parts).strip()

        # 9. Keyboards
        if specs.category == "keyboard":
            if specs.model_line:
                parts.append(specs.model_line.upper() if any(c.isdigit() for c in specs.model_line) else specs.model_line.title())
            if "mechanical" in title.lower():
                parts.append("Mechanical")
            if not any(w in " ".join(parts).lower() for w in ("keyboard", "keyboards")):
                parts.append("Keyboard")
            return " ".join(parts).strip()

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
        source_url: Optional[str] = None,
        source_retailer: Optional[str] = None,
        brand: Optional[str] = None,
        model: Optional[str] = None,
        category: Optional[str] = None,
        specifications: Optional[dict[str, Any]] = None,
        custom_query: Optional[str] = None,
        timeout_per_retriever: float = 6.0,
    ) -> tuple[list[dict], list[str], dict[str, str], str, list[dict], list[RetailerDiagnostic]]:
        now_iso = datetime.now(timezone.utc).isoformat()
        if custom_query and custom_query.strip():
            query = custom_query.strip()
        else:
            query = self.build_search_query(
                source_title,
                variant=source_variant,
                brand=brand,
                model=model,
                category=category,
                specifications=specifications,
            )

        is_flipkart_source = bool(
            (source_retailer and "flipkart" in source_retailer.lower()) or
            (source_url and "flipkart.com" in source_url.lower())
        )
        is_amazon_source = bool(
            (source_retailer and "amazon" in source_retailer.lower()) or
            (source_url and "amazon.in" in source_url.lower()) or
            (not is_flipkart_source)
        )

        queried_retailers: list[str] = []
        statuses: dict[str, str] = {}
        retailer_diagnostics: list[RetailerDiagnostic] = []
        all_evaluated_offers: list[dict] = []
        candidate_evaluations: list[dict] = []
        seen_urls: set[str] = set()

        for retriever in self.retrievers:
            if retriever.name in INACTIVE_RETAILERS or isinstance(retriever, (CromaRetriever, RelianceDigitalRetriever, VijaySalesRetriever)):
                continue

            # Source isolation: do not query the source retailer against itself
            if is_flipkart_source and retriever.name == "Flipkart":
                continue
            if is_amazon_source and retriever.name == "Amazon.in":
                continue

            queried_retailers.append(retriever.name)

            if not retriever.is_enabled:
                statuses[retriever.name] = retriever.status_reason
                retailer_diagnostics.append(RetailerDiagnostic(
                    retailer_name=retriever.name,
                    search_query=query,
                    http_status=getattr(retriever, "last_http_status", None),
                    status_reason=retriever.status_reason,
                    data_source=getattr(retriever, "data_source", None),
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

            candidates = []
            used_serpapi = False
            serp_key = os.getenv("SERPAPI_API_KEY")
            if not self.is_custom_retrievers and serp_key and serp_key.strip():
                try:
                    serp_offers = self.serpapi_retriever.search(query, timeout=timeout_per_retriever)
                    target_serp_offers = [
                        o for o in serp_offers if o.get("retailer_name") == retriever.name
                    ]
                    if target_serp_offers:
                        candidates = list(target_serp_offers)
                        used_serpapi = True
                        http_st = self.serpapi_retriever.last_http_status or 200
                        raw_cnt = getattr(self.serpapi_retriever, "last_raw_count", len(target_serp_offers))
                        parsed_cnt = len(target_serp_offers)
                        statuses[retriever.name] = f"Queried successfully via SerpApi Google Shopping (HTTP 200); retrieved {len(candidates)} listings for {retriever.name}."
                except Exception:
                    candidates = []

            # Retrieve more search candidates when initial results are insufficient (< 10 listings)
            if not candidates or len(candidates) < 10:
                try:
                    direct_candidates = retriever.search(query, timeout=timeout_per_retriever)
                    seen_cand_urls = {c.get("product_url") for c in candidates if c.get("product_url")}
                    for dc in direct_candidates:
                        u = dc.get("product_url")
                        if u and u not in seen_cand_urls:
                            candidates.append(dc)
                            seen_cand_urls.add(u)
                    http_st = getattr(retriever, "last_http_status", 200) if not used_serpapi else (http_st or 200)
                    raw_cnt = len(candidates)
                    parsed_cnt = len(candidates)
                    if not candidates:
                        if http_st and http_st >= 400:
                            statuses[retriever.name] = f"Query failed (HTTP {http_st})"
                        else:
                            statuses[retriever.name] = f"Queried successfully (HTTP {http_st}); 0 listings returned."
                    else:
                        if not used_serpapi:
                            statuses[retriever.name] = f"Queried successfully (HTTP {http_st}); retrieved {len(candidates)} listings."
                        else:
                            statuses[retriever.name] = f"Queried successfully via SerpApi & direct search (HTTP {http_st}); retrieved {len(candidates)} listings for {retriever.name}."
                except Exception as err:
                    if not candidates:
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
                        source_category=category,
                        source_brand=brand,
                        source_model=model,
                        source_specs=specifications,
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
                    elif rejection_category in (RejectionCategory.UNVERIFIED_VARIANT, RejectionCategory.POSSIBLE_MATCH):
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
                    "retailer_product_id": raw_offer.get("retailer_product_id"),
                    "current_price": price,
                    "mrp": raw_offer.get("mrp"),
                    "currency": "INR",
                    "match_status": status.value,
                    "match_details": reason,
                    "rejection_category": rejection_category.value,
                    "retrieval_timestamp": now_iso,
                    "availability": raw_offer.get("availability", "IN_STOCK"),
                    "shipping_cost": None,
                    "seller_name": raw_offer.get("seller_name"),
                    "delivery_estimate": raw_offer.get("delivery_estimate"),
                    "condition": raw_offer.get("condition", "New"),
                    "image_url": raw_offer.get("image_url"),
                    "model_identifier": cand_vars.get("mpn"),
                    "configuration": cand_vars.get("storage") or cand_vars.get("capacity"),
                    "extracted_variants": cand_vars,
                    "data_source": raw_offer.get("data_source", getattr(retriever, "data_source", None)),
                })

            retailer_diagnostics.append(RetailerDiagnostic(
                retailer_name=retriever.name,
                search_query=query,
                http_status=http_st,
                status_reason=statuses[retriever.name],
                data_source=getattr(retriever, "data_source", None),
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

    def match_candidate_offers(
        self,
        candidates: list[dict],
        source_title: str,
        source_variant: Optional[str] = None,
        retailer_name: str = "Amazon.in",
        data_source: str = "Amazon Browser Tab Search",
        status_reason: Optional[str] = None,
        retrieval_status: Optional[str] = None,
        http_status: Optional[int] = 200,
    ) -> tuple[list[dict], list[str], dict[str, str], str, list[dict], list[RetailerDiagnostic]]:
        """
        Evaluates candidate offers extracted from a live user-opened browser tab
        using the deterministic, fail-closed ProductMatcher.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        query = self.build_search_query(source_title, variant=source_variant)
        queried_retailers = [retailer_name]
        statuses: dict[str, str] = {}
        all_evaluated_offers: list[dict] = []
        candidate_evaluations: list[dict] = []
        seen_urls: set[str] = set()

        # Handle explicit blocked status
        if retrieval_status == "blocked" or (http_status and http_status in (403, 503)):
            eff_status = http_status or 403
            eff_reason = status_reason or "Blocked: Amazon India displayed a CAPTCHA challenge or access restriction in the browser tab."
            statuses[retailer_name] = eff_reason
            diag = RetailerDiagnostic(
                retailer_name=retailer_name,
                search_query=query,
                http_status=eff_status,
                status_reason=eff_reason,
                data_source=data_source,
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
            )
            return [], queried_retailers, statuses, query, [], [diag]

        # Handle tab not open status
        if retrieval_status == "not_open":
            eff_reason = status_reason or "Amazon tab not open in browser. Open an Amazon search tab to compare live prices."
            statuses[retailer_name] = f"Unlinked: {eff_reason}"
            diag = RetailerDiagnostic(
                retailer_name=retailer_name,
                search_query=query,
                http_status=200,
                status_reason=eff_reason,
                data_source=data_source,
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
            )
            return [], queried_retailers, statuses, query, [], [diag]

        raw_cnt = len(candidates)
        parsed_cnt = len(candidates)
        valid_price_cnt = 0
        price_failed_cnt = 0
        model_mismatch_cnt = 0
        config_mismatch_cnt = 0
        unverified_cnt = 0
        condition_cnt = 0
        exact_matches_cnt = 0
        rej_breakdown: dict[str, int] = {}

        for raw_offer in candidates:
            cand_title = raw_offer.get("product_title", "")
            cand_url = raw_offer.get("product_url", "")
            if not cand_title or not cand_url:
                continue

            if cand_url in seen_urls:
                continue
            seen_urls.add(cand_url)

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

            if status == MatchStatus.EXACT_MATCH:
                exact_matches_cnt += 1
            else:
                cat_val = rejection_category.value
                rej_breakdown[cat_val] = rej_breakdown.get(cat_val, 0) + 1
                if rejection_category == RejectionCategory.MODEL_MISMATCH:
                    model_mismatch_cnt += 1
                elif rejection_category == RejectionCategory.CONFIG_MISMATCH:
                    config_mismatch_cnt += 1
                elif rejection_category in (RejectionCategory.UNVERIFIED_VARIANT, RejectionCategory.POSSIBLE_MATCH):
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
                "retailer_name": raw_offer.get("retailer_name", retailer_name),
                "product_title": cand_title,
                "product_url": cand_url,
                "retailer_product_id": raw_offer.get("retailer_product_id"),
                "current_price": price,
                "mrp": raw_offer.get("mrp"),
                "currency": raw_offer.get("currency", "INR"),
                "match_status": status.value,
                "match_details": reason,
                "rejection_category": rejection_category.value,
                "retrieval_timestamp": now_iso,
                "availability": raw_offer.get("availability", "IN_STOCK"),
                "shipping_cost": None,
                "seller_name": raw_offer.get("seller_name"),
                "delivery_estimate": raw_offer.get("delivery_estimate"),
                "condition": raw_offer.get("condition", "New"),
                "image_url": raw_offer.get("image_url"),
                "model_identifier": cand_vars.get("mpn"),
                "configuration": cand_vars.get("storage") or cand_vars.get("capacity"),
                "extracted_variants": cand_vars,
                "data_source": raw_offer.get("data_source", data_source),
            })

        if not candidates:
            eff_reason = status_reason or f"Queried successfully (HTTP 200); 0 listings returned on {retailer_name}."
            statuses[retailer_name] = eff_reason
        else:
            statuses[retailer_name] = f"Retrieved {len(all_evaluated_offers)} listings via {data_source}."

        retailer_diagnostics = [
            RetailerDiagnostic(
                retailer_name=retailer_name,
                search_query=query,
                http_status=http_status or 200,
                status_reason=statuses[retailer_name],
                data_source=data_source,
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
            )
        ]

        return all_evaluated_offers, queried_retailers, statuses, query, candidate_evaluations, retailer_diagnostics

    def retrieve_same_platform_sellers(
        self,
        source_title: str,
        source_retailer: Optional[str] = None,
        source_url: Optional[str] = None,
        source_price: float = 0.0,
        source_seller: Optional[str] = None,
        source_variant: Optional[str] = None,
        source_product_id: Optional[str] = None,
        timeout: float = 6.0,
    ) -> tuple[list[dict], str, list[RetailerDiagnostic], Optional[float], str]:
        """
        Discovers other verified sellers for the exact same product and variant
        on the platform currently being viewed (Amazon or Flipkart).

        Strict rules:
        - Amazon source -> queries AmazonRetriever only.
        - Flipkart source -> queries FlipkartRetriever only.
        - Only considers EXACT_MATCH candidates.
        - Filters out the source offer itself (by URL, product ID, or seller+price).
        - Excludes duplicates, accessories, refurbished, or conflicting variants.
        - Only claims a seller is different when seller identity is verified and accessible.
        - Never fabricates seller names.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        is_flipkart_source = bool(
            (source_retailer and "flipkart" in source_retailer.lower()) or
            (source_url and "flipkart.com" in source_url.lower())
        )
        target_name = "Flipkart" if is_flipkart_source else "Amazon.in"

        target_retriever = None
        for r in self.retrievers:
            if r.name == target_name:
                target_retriever = r
                break

        if not target_retriever:
            return [], "error", [], None, f"Retriever for {target_name} not found."

        query = self.build_search_query(source_title, variant=source_variant)

        candidates = []
        serp_key = os.getenv("SERPAPI_API_KEY")
        if not self.is_custom_retrievers and serp_key and serp_key.strip():
            try:
                serp_offers = self.serpapi_retriever.search(query, timeout=timeout)
                target_serp = [o for o in serp_offers if o.get("retailer_name") == target_name]
                if target_serp:
                    candidates = target_serp
                    http_st = self.serpapi_retriever.last_http_status or 200
                    raw_cnt = len(target_serp)
                    parsed_cnt = len(target_serp)
            except Exception:
                candidates = []

        if not candidates:
            try:
                candidates = target_retriever.search(query, timeout=timeout)
                http_st = getattr(target_retriever, "last_http_status", 200)
                raw_cnt = getattr(target_retriever, "last_raw_count", len(candidates))
                parsed_cnt = len(candidates)
            except Exception as err:
                diag = RetailerDiagnostic(
                    retailer_name=target_name,
                    search_query=query,
                    http_status=getattr(target_retriever, "last_http_status", None),
                    status_reason=f"Same-platform query failed: {type(err).__name__}",
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
                )
                return [], "error", [diag], None, f"Query error on {target_name}: {str(err)}"

        valid_price_cnt = 0
        price_failed_cnt = 0
        model_mismatch_cnt = 0
        config_mismatch_cnt = 0
        unverified_cnt = 0
        condition_cnt = 0
        exact_matches_cnt = 0
        rej_breakdown: dict[str, int] = {}

        verified_seller_offers: list[dict] = []
        seen_seller_keys: set[str] = set()
        matched_candidates_without_seller = 0

        norm_source_seller = source_seller.strip().lower() if source_seller else None
        norm_source_pid = source_product_id.strip().upper() if source_product_id else None
        clean_source_url = source_url.split("?")[0].rstrip("/") if source_url else ""

        for raw_offer in candidates:
            cand_title = raw_offer["product_title"]
            cand_url = raw_offer["product_url"]
            cand_pid = (raw_offer.get("retailer_product_id") or "").strip().upper()
            clean_cand_url = cand_url.split("?")[0].rstrip("/")

            price = raw_offer.get("current_price", -1.0)
            if price <= 0:
                price_failed_cnt += 1
                continue

            valid_price_cnt += 1

            status, reason, rejection_category, cand_vars = ProductMatcher.evaluate_match(
                source_title,
                cand_title,
                source_variant=source_variant,
                candidate_url=cand_url,
            )

            if status != MatchStatus.EXACT_MATCH:
                cat_val = rejection_category.value
                rej_breakdown[cat_val] = rej_breakdown.get(cat_val, 0) + 1
                if rejection_category == RejectionCategory.MODEL_MISMATCH:
                    model_mismatch_cnt += 1
                elif rejection_category == RejectionCategory.CONFIG_MISMATCH:
                    config_mismatch_cnt += 1
                elif rejection_category in (RejectionCategory.UNVERIFIED_VARIANT, RejectionCategory.POSSIBLE_MATCH):
                    unverified_cnt += 1
                elif rejection_category == RejectionCategory.ACCESSORY_OR_CONDITION:
                    condition_cnt += 1
                continue

            exact_matches_cnt += 1

            # Check if this candidate is the source offer itself
            is_same_url = bool(clean_source_url and clean_cand_url == clean_source_url)
            is_same_pid = bool(norm_source_pid and cand_pid and norm_source_pid == cand_pid)
            cand_seller = raw_offer.get("seller_name")
            norm_cand_seller = cand_seller.strip().lower() if cand_seller else None

            if is_same_url or is_same_pid:
                continue

            if norm_source_seller and norm_cand_seller and norm_source_seller == norm_cand_seller and abs(price - source_price) < 0.01:
                continue

            if not cand_seller or not cand_seller.strip():
                matched_candidates_without_seller += 1
                continue

            if norm_source_seller and norm_cand_seller == norm_source_seller:
                continue

            if norm_cand_seller in seen_seller_keys:
                continue
            seen_seller_keys.add(norm_cand_seller)

            price_diff = round(source_price - price, 2)

            verified_seller_offers.append({
                "retailer_name": target_name,
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
                "seller_name": cand_seller.strip(),
                "condition": raw_offer.get("condition", "New"),
                "delivery_estimate": raw_offer.get("delivery_estimate"),
                "price_difference": price_diff,
                "retailer_product_id": cand_pid or None,
                "image_url": raw_offer.get("image_url"),
                "model_identifier": cand_vars.get("mpn"),
                "configuration": cand_vars.get("storage") or cand_vars.get("capacity"),
                "extracted_variants": cand_vars,
            })

        verified_seller_offers.sort(key=lambda x: x["current_price"])

        if verified_seller_offers:
            status = "success"
            lowest_price = verified_seller_offers[0]["current_price"]
            diff = round(source_price - lowest_price, 2)
            if diff > 0:
                summary = (
                    f"Found {len(verified_seller_offers)} alternative verified seller(s) on {target_name}. "
                    f"Lowest alternative price is ₹{lowest_price:,.2f} (save ₹{diff:,.2f} vs current seller)."
                )
            elif diff < 0:
                summary = (
                    f"Found {len(verified_seller_offers)} alternative verified seller(s) on {target_name}. "
                    f"Current seller offer is ₹{abs(diff):,.2f} lower than alternative sellers."
                )
            else:
                summary = (
                    f"Found {len(verified_seller_offers)} alternative verified seller(s) on {target_name} "
                    f"with matching price ₹{lowest_price:,.2f}."
                )
        elif matched_candidates_without_seller > 0:
            status = "seller_data_unavailable"
            lowest_price = None
            summary = "Alternative sellers could not be verified from the available retailer data."
        else:
            status = "no_other_sellers_found"
            lowest_price = None
            summary = (
                f"Current listing is sold by {source_seller.strip()}. "
                f"No additional verified sellers were found on {target_name}."
                if source_seller and source_seller.strip()
                else f"No additional verified sellers were found on {target_name}."
            )

        diagnostic = RetailerDiagnostic(
            retailer_name=target_name,
            search_query=query,
            http_status=http_st,
            status_reason=summary,
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
        )

        return verified_seller_offers, status, [diagnostic], lowest_price, summary
