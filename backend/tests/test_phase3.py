"""
DealSense Backend Tests — Phase 3.3
Deterministic product matching, exact variant verification,
fail-closed matching, automatic comparison contracts, and savings calculations.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.main import analyze, compare_prices
from app.matcher import MatchStatus, ProductMatcher, RejectionCategory
from app.models import (
    AnalyzeRequest,
    ComparableOffer,
    ComparePricesRequest,
)
from app.retrieval import BaseRetriever, OfferRetrievalService


class MockRetriever(BaseRetriever):
    def __init__(self, name: str = "MockStore", domain: str = "flipkart.com", offers: list[dict] = None):
        self.name = name
        self.domain = domain
        self.is_enabled = True
        self.status_reason = "Mock retriever active."
        self._offers = offers or []

    def search(self, query: str, timeout: float = 6.0) -> list[dict]:
        return self._offers


class DealSenseStrictMatchingTests(unittest.TestCase):
    # 1. Acer Aspire One Ryzen 3 7320U vs Acer Aspire 3 Pentium N6000 -> REJECT
    def test_01_acer_aspire_one_vs_aspire_3_rejected(self):
        src = "Acer Smartchoice Aspire One, Ryzen 3 7320U, 8 GB LPDDR5 RAM, 256 GB SSD"
        cand = "Acer Aspire 3, Intel Pentium Silver N6000, 8 GB RAM, 256 GB SSD"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.MISMATCH)
        self.assertEqual(cat, RejectionCategory.MODEL_MISMATCH)
        self.assertIn("family mismatch", reason.lower())

    # 2. Dell Alienware 15 vs Dell Inspiron 15 -> REJECT
    def test_02_dell_alienware_vs_inspiron_rejected(self):
        src = "Dell Alienware 15 Gaming Laptop, Ryzen processor, RTX 5050 8 GB graphics, 16 GB RAM, 512 GB SSD"
        cand = "Dell Inspiron 15, 16 GB RAM, 512 GB SSD"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.MISMATCH)
        self.assertEqual(cat, RejectionCategory.MODEL_MISMATCH)
        self.assertIn("family mismatch", reason.lower())

    # 3. Dell Alienware 15 vs Dell G15 -> REJECT
    def test_03_dell_alienware_vs_g15_rejected(self):
        src = "Dell Alienware 15 Gaming Laptop, Ryzen processor, RTX 5050 8 GB graphics, 16 GB RAM, 512 GB SSD"
        cand = "Dell G15 Gaming Laptop, 16 GB RAM, 512 GB SSD"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.MISMATCH)
        self.assertEqual(cat, RejectionCategory.MODEL_MISMATCH)
        self.assertIn("family mismatch", reason.lower())

    # 4. Same laptop model with conflicting GPU -> REJECT
    def test_04_same_laptop_model_conflicting_gpu_rejected(self):
        src = "Dell Alienware 15 Gaming Laptop, Ryzen 7, RTX 5050 8 GB graphics, 16 GB RAM, 512 GB SSD"
        cand_4050 = "Dell Alienware 15 Gaming Laptop, Ryzen 7, RTX 4050 6 GB graphics, 16 GB RAM, 512 GB SSD"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand_4050)
        self.assertEqual(status, MatchStatus.MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("gpu model mismatch", reason.lower())

    # 5. Same laptop model with conflicting RAM or storage -> REJECT
    def test_05_same_laptop_conflicting_ram_or_storage_rejected(self):
        src = "Acer Aspire 3, Ryzen 3 7320U, 8 GB RAM, 256 GB SSD"
        cand_ram = "Acer Aspire 3, Ryzen 3 7320U, 16 GB RAM, 256 GB SSD"
        cand_storage = "Acer Aspire 3, Ryzen 3 7320U, 8 GB RAM, 512 GB SSD"

        # RAM mismatch
        st_ram, reas_ram, cat_ram, _ = ProductMatcher.evaluate_match(src, cand_ram)
        self.assertEqual(st_ram, MatchStatus.MISMATCH)
        self.assertEqual(cat_ram, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("ram capacity mismatch", reas_ram.lower())

        # Storage mismatch
        st_st, reas_st, cat_st, _ = ProductMatcher.evaluate_match(src, cand_storage)
        self.assertEqual(st_st, MatchStatus.MISMATCH)
        self.assertEqual(cat_st, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("storage capacity mismatch", reas_st.lower())

    # 6. Blue MacBook Neo vs Silver MacBook Neo -> REJECT
    def test_06_blue_macbook_neo_vs_silver_macbook_neo_rejected(self):
        src = "Apple MacBook Neo (13-inch, 8GB Unified Memory, 256GB SSD Storage) - Blue"
        cand_silver = "Apple Macbook Neo A18 Pro(2026) A18 Pro - (8 GB/256 GB SSD/Tahoe) MHFA4HN/A"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand_silver)
        self.assertEqual(status, MatchStatus.MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("color variant mismatch", reason.lower())
        self.assertIn("silver", reason.lower())

    # 7. Same model and configuration with harmless title formatting differences -> MATCH
    def test_07_same_model_harmless_formatting_matches(self):
        src = "Acer Aspire 3 (15.6-inch, AMD Ryzen 3-7320U, 8GB LPDDR5, 256GB SSD) - Pure Silver"
        cand = "Acer Aspire 3 AMD Ryzen 3 7320U - (8 GB / 256 GB SSD / Windows 11 Home) Pure Silver"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)
        self.assertIn("exact product", reason.lower())

    # 8. Same model with missing colour when source specifies colour -> UNVERIFIED_VARIANT
    def test_08_missing_color_when_source_specifies_color_unverified(self):
        src = "Apple MacBook Neo (13-inch, 8GB Unified Memory, 256GB SSD Storage) - Blue"
        cand_no_color = "Apple Macbook Neo A18 Pro - (8 GB/256 GB SSD/Tahoe)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand_no_color)
        self.assertEqual(status, MatchStatus.UNVERIFIED_VARIANT)
        self.assertEqual(cat, RejectionCategory.UNVERIFIED_VARIANT)
        self.assertIn("color unverified", reason.lower())

    # 9. Accessory or refurbished listing -> REJECT
    def test_09_accessory_or_refurbished_rejected(self):
        src = "Sony WH-1000XM5 Wireless Noise Cancelling Headphones - Black"
        cand_acc = "Protective Silicone Case Cover for Sony WH-1000XM5 Headphones"
        cand_refurb = "Sony WH-1000XM5 Wireless Headphones (Refurbished / Open Box)"

        st_acc, _, cat_acc, _ = ProductMatcher.evaluate_match(src, cand_acc)
        self.assertEqual(st_acc, MatchStatus.MISMATCH)
        self.assertEqual(cat_acc, RejectionCategory.ACCESSORY_OR_CONDITION)

        st_ref, _, cat_ref, _ = ProductMatcher.evaluate_match(src, cand_refurb)
        self.assertEqual(st_ref, MatchStatus.MISMATCH)
        self.assertEqual(cat_ref, RejectionCategory.ACCESSORY_OR_CONDITION)

    # 10. iPhone listing compared with different iPhone model or storage -> REJECT
    def test_10_iphone_different_model_or_storage_rejected(self):
        src = "Apple iPhone 16 (128 GB) - Black"
        cand_plus = "Apple iPhone 16 Plus (Black, 128 GB)"
        cand_15 = "Apple iPhone 15 (Black, 128 GB)"
        cand_256 = "Apple iPhone 16 (Black, 256 GB)"

        st_p, _, cat_p, _ = ProductMatcher.evaluate_match(src, cand_plus)
        self.assertEqual(st_p, MatchStatus.MISMATCH)
        self.assertEqual(cat_p, RejectionCategory.MODEL_MISMATCH)

        st_15, _, cat_15, _ = ProductMatcher.evaluate_match(src, cand_15)
        self.assertEqual(st_15, MatchStatus.MISMATCH)
        self.assertEqual(cat_15, RejectionCategory.MODEL_MISMATCH)

        st_256, _, cat_256, _ = ProductMatcher.evaluate_match(src, cand_256)
        self.assertEqual(st_256, MatchStatus.MISMATCH)
        self.assertEqual(cat_256, RejectionCategory.CONFIG_MISMATCH)

    # 11. Changing source product while comparison is in progress: results bound strictly to product
    def test_11_changing_source_product_clears_and_binds_results(self):
        offers_alienware = [{
            "retailer_name": "Flipkart",
            "product_title": "Dell Alienware 15 (Ryzen 7/16 GB/512 GB SSD/RTX 5050)",
            "product_url": "https://www.flipkart.com/alienware/p/itm1",
            "current_price": 145000.0,
            "availability": "IN_STOCK",
        }]
        offers_iphone = [{
            "retailer_name": "Flipkart",
            "product_title": "Apple iPhone 16 (Black, 128 GB)",
            "product_url": "https://www.flipkart.com/iphone/p/itm2",
            "current_price": 75000.0,
            "availability": "IN_STOCK",
        }]

        retriever = MockRetriever(name="Flipkart")
        with patch("app.main.retrieval_service", OfferRetrievalService(retrievers=[retriever])):
            # First product: Alienware
            retriever._offers = offers_alienware
            res_a = compare_prices(ComparePricesRequest(
                url="https://www.amazon.in/dp/B0ALIENWARE",
                product_name="Dell Alienware 15 (Ryzen 7, 16GB RAM, 512GB SSD, RTX 5050)",
                current_site_price=150000.0,
            ))
            self.assertEqual(res_a.source_product.product_name, "Dell Alienware 15 (Ryzen 7, 16GB RAM, 512GB SSD, RTX 5050)")
            self.assertEqual(res_a.lowest_price, 145000.0)

            # Second product: iPhone 16
            retriever._offers = offers_iphone
            res_b = compare_prices(ComparePricesRequest(
                url="https://www.amazon.in/dp/B0IPHONE",
                product_name="Apple iPhone 16 (128 GB) - Black",
                current_site_price=79900.0,
            ))
            self.assertEqual(res_b.source_product.product_name, "Apple iPhone 16 (128 GB) - Black")
            self.assertEqual(res_b.lowest_price, 75000.0)
            # Must not contain Alienware
            self.assertNotIn("Alienware", res_b.verified_offers[0].product_title)

    # 12. Automated comparison contract: endpoint accepts direct payload and returns comparison
    def test_12_automatic_comparison_endpoint_contract(self):
        cand = [{
            "retailer_name": "Flipkart",
            "product_title": "Acer Aspire 3 Ryzen 3 7320U - (8 GB/256 GB SSD) Pure Silver",
            "product_url": "https://www.flipkart.com/aspire3/p/itm1",
            "current_price": 28990.0,
            "availability": "IN_STOCK",
        }]
        retriever = MockRetriever(name="Flipkart", offers=cand)
        with patch("app.main.retrieval_service", OfferRetrievalService(retrievers=[retriever])):
            res = compare_prices(ComparePricesRequest(
                url="https://www.amazon.in/dp/B0ACER3",
                product_name="Acer Aspire 3 (15.6-inch, AMD Ryzen 3-7320U, 8GB RAM, 256GB SSD) - Pure Silver",
                current_site_price=31990.0,
            ))
            self.assertEqual(res.status, "success")
            self.assertEqual(res.verdict_label, "LOWER ON FLIPKART")
            self.assertEqual(res.lowest_price, 28990.0)
            self.assertEqual(res.price_difference, 3000.0)

    # 13. Deduplication of repeated competitor offers
    def test_13_duplicate_candidate_offers_removed(self):
        duplicate_candidates = [
            {
                "retailer_name": "Flipkart",
                "product_title": "Acer Aspire 3 Ryzen 3 7320U - (8 GB/256 GB SSD) Pure Silver",
                "product_url": "https://www.flipkart.com/aspire3/p/itm1?pid=PID1",
                "current_price": 28990.0,
                "availability": "IN_STOCK",
            },
            {
                "retailer_name": "Flipkart",
                "product_title": "Acer Aspire 3 Ryzen 3 7320U - (8 GB/256 GB SSD) Pure Silver",
                "product_url": "https://www.flipkart.com/aspire3/p/itm1?pid=PID1",
                "current_price": 28990.0,
                "availability": "IN_STOCK",
            },
        ]
        retriever = MockRetriever(name="Flipkart", offers=duplicate_candidates)
        with patch("app.main.retrieval_service", OfferRetrievalService(retrievers=[retriever])):
            res = compare_prices(ComparePricesRequest(
                url="https://www.amazon.in/dp/B0ACER3",
                product_name="Acer Aspire 3 (AMD Ryzen 3-7320U, 8GB, 256GB SSD) - Pure Silver",
                current_site_price=31990.0,
            ))
            self.assertEqual(len(res.offers), 1)
            self.assertEqual(len(res.verified_offers), 1)

    # 14. Savings calculated only from verified equivalent offers
    def test_14_savings_calculated_only_from_verified_equivalent_offers(self):
        mixed_candidates = [
            # Cheap unmatched budget laptop (Inspiron) -> 35000, must NOT be used for savings
            {
                "retailer_name": "Flipkart",
                "product_title": "Dell Inspiron 15 (Intel Core i3/8 GB/256 GB SSD)",
                "product_url": "https://www.flipkart.com/inspiron/p/itm1",
                "current_price": 35000.0,
                "availability": "IN_STOCK",
            },
            # Exact match Alienware 15 -> 140000
            {
                "retailer_name": "Flipkart",
                "product_title": "Dell Alienware 15 Gaming Laptop (Ryzen 7/16 GB/512 GB SSD/RTX 5050)",
                "product_url": "https://www.flipkart.com/alienware/p/itm2",
                "current_price": 140000.0,
                "availability": "IN_STOCK",
            },
        ]
        retriever = MockRetriever(name="Flipkart", offers=mixed_candidates)
        with patch("app.main.retrieval_service", OfferRetrievalService(retrievers=[retriever])):
            res = compare_prices(ComparePricesRequest(
                url="https://www.amazon.in/dp/B0ALIEN",
                product_name="Dell Alienware 15 Gaming Laptop, Ryzen 7, RTX 5050 8 GB graphics, 16 GB RAM, 512 GB SSD",
                current_site_price=150000.0,
            ))
            self.assertEqual(res.status, "success")
            # Lowest verified price must be Alienware 140,000 (NOT Inspiron 35,000!)
            self.assertEqual(res.lowest_price, 140000.0)
            self.assertEqual(res.price_difference, 10000.0)
            self.assertEqual(len(res.verified_offers), 1)


    # 15. Refrigerator specs extraction & targeted search query construction
    def test_15_refrigerator_query_construction_and_specs_extraction(self):
        title = "Samsung 236 L, 3 Star, Digital Inverter, Frost Free Double Door Refrigerator (RT28C3053S8/HL, Silver, Dazzle Steel)"
        specs = ProductMatcher.extract_specs(title)
        self.assertEqual(specs.category, "refrigerator")
        self.assertEqual(specs.capacity, "236 L")
        self.assertEqual(specs.door_type, "double door")
        self.assertEqual(specs.defrost_type, "frost free")
        self.assertEqual(specs.star_rating, "3 star")
        self.assertEqual(specs.mpn, "RT28C3053S8/HL")
        self.assertEqual(specs.color, "silver")

        service = OfferRetrievalService()
        query = service.build_search_query(title)
        self.assertEqual(query, "Samsung 236 L Refrigerator")
        self.assertNotIn("Dazzle Steel", query)

    # 16. Refrigerator matching rules (category, capacity, doors, star rating)
    def test_16_refrigerator_matching_rules(self):
        src = "Samsung 236 L, 3 Star, Digital Inverter, Frost Free Double Door Refrigerator (RT28C3053S8/HL, Silver, Dazzle Steel)"

        # Mismatched category (Phone vs Refrigerator) -> REJECT
        cand_phone = "Samsung Galaxy S25 FE 5G (Navy, 128 GB)"
        st_phone, _, cat_phone, _ = ProductMatcher.evaluate_match(src, cand_phone)
        self.assertEqual(st_phone, MatchStatus.MISMATCH)
        self.assertEqual(cat_phone, RejectionCategory.MODEL_MISMATCH)

        # Mismatched capacity (183 L vs 236 L) -> REJECT
        cand_183 = "Samsung 183 L Direct Cool Single Door 3 Star Refrigerator"
        st_183, reas_183, cat_183, _ = ProductMatcher.evaluate_match(src, cand_183)
        self.assertEqual(st_183, MatchStatus.MISMATCH)
        self.assertEqual(cat_183, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("capacity mismatch", reas_183.lower())

        # Mismatched star rating (2 Star vs 3 Star) -> REJECT
        cand_2star = "Samsung 236 L Frost Free Double Door 2 Star Refrigerator - Dazzle Steel"
        st_2s, reas_2s, cat_2s, _ = ProductMatcher.evaluate_match(src, cand_2star)
        self.assertEqual(st_2s, MatchStatus.MISMATCH)
        self.assertEqual(cat_2s, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("star rating mismatch", reas_2s.lower())

        # Exact matching candidate -> EXACT MATCH
        cand_exact = "Samsung 236 L Frost Free Double Door 3 Star Refrigerator (RT28C3053S8, Dazzle Steel)"
        st_ex, reas_ex, cat_ex, _ = ProductMatcher.evaluate_match(src, cand_exact)
        self.assertEqual(st_ex, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat_ex, RejectionCategory.VALID_MATCH)

    # 17. Gaming laptop query construction includes GPU to avoid wrong tiers
    def test_17_gaming_laptop_query_construction_includes_gpu(self):
        title = "HP Victus Gaming Laptop, 12th Gen Intel Core i5-12450H, 4GB RTX 2050 GPU, 15.6-inch (39.6 cm), FHD, IPS, 144Hz, 16GB DDR4, 512GB SSD"
        specs = ProductMatcher.extract_specs(title)
        self.assertEqual(specs.category, "laptop")
        self.assertEqual(specs.product_family, "victus")
        self.assertEqual(specs.gpu_model, "rtx 2050")
        self.assertEqual(specs.storage, "512 GB")

        service = OfferRetrievalService()
        query = service.build_search_query(title)
        self.assertEqual(query, "Hp Victus RTX 2050 512 GB")

    # 18. Structured retailer diagnostics returned from compare-prices
    def test_18_retailer_diagnostics_returned(self):
        cand = [{
            "retailer_name": "Flipkart",
            "product_title": "HP Victus Intel Core i5 (8 GB/512 GB SSD/RTX 2050)",
            "product_url": "https://www.flipkart.com/victus/p/itm1",
            "current_price": 52990.0,
            "availability": "IN_STOCK",
        }]
        retriever = MockRetriever(name="Flipkart", offers=cand)
        with patch("app.main.retrieval_service", OfferRetrievalService(retrievers=[retriever])):
            res = compare_prices(ComparePricesRequest(
                url="https://www.amazon.in/dp/B0HPVICTUS",
                product_name="HP Victus Gaming Laptop, Intel Core i5, 16GB RAM, 512GB SSD, RTX 2050",
                current_site_price=54990.0,
            ))
            self.assertTrue(len(res.retailer_diagnostics) >= 1)
            fk_diag = next(d for d in res.retailer_diagnostics if d.retailer_name == "Flipkart")
            self.assertEqual(fk_diag.parsed_listings_count, 1)
            self.assertEqual(fk_diag.config_mismatch_count, 1)  # 8GB RAM vs 16GB RAM
            self.assertEqual(fk_diag.exact_matches_count, 0)
            self.assertIn("CONFIG_MISMATCH", fk_diag.rejection_breakdown)

    # 19. Re-check stores freshness contract
    def test_19_recheck_stores_freshness(self):
        retriever = MockRetriever(name="Flipkart", offers=[])
        with patch("app.main.retrieval_service", OfferRetrievalService(retrievers=[retriever])):
            # First check: 0 offers
            res1 = compare_prices(ComparePricesRequest(
                url="https://www.amazon.in/dp/B0ACER",
                product_name="Acer Aspire 3, Ryzen 3 7320U, 8 GB RAM, 256 GB SSD",
                current_site_price=27990.0,
            ))
            self.assertEqual(res1.status, "no_offers_found")

            # Store updates inventory, user clicks Re-check stores
            retriever._offers = [{
                "retailer_name": "Flipkart",
                "product_title": "Acer Aspire 3 Ryzen 3 7320U - (8 GB/256 GB SSD/Windows 11 Home)",
                "product_url": "https://www.flipkart.com/aspire3/p/itm1",
                "current_price": 26990.0,
                "availability": "IN_STOCK",
            }]

            res2 = compare_prices(ComparePricesRequest(
                url="https://www.amazon.in/dp/B0ACER",
                product_name="Acer Aspire 3, Ryzen 3 7320U, 8 GB RAM, 256 GB SSD",
                current_site_price=27990.0,
            ))
            self.assertEqual(res2.status, "success")
            self.assertEqual(res2.lowest_price, 26990.0)
            self.assertEqual(res2.price_difference, 1000.0)


if __name__ == "__main__":
    unittest.main()
