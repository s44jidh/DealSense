"""
DealSense Backend Tests — Phase 3.3
Deterministic product matching, exact variant verification,
fail-closed matching, automatic comparison contracts, and savings calculations.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from app.main import analyze, compare_prices, retrieval_service
from app.matcher import MatchStatus, ProductMatcher, RejectionCategory
from app.models import (
    AnalyzeRequest,
    ComparableOffer,
    ComparePricesRequest,
)
from app.retrieval import AmazonRetriever, BaseRetriever, OfferRetrievalService, SerpApiGoogleShoppingRetriever


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

    # 20. Nivia football query strictly rejects Dell laptop candidates and preserves source product identity
    def test_20_football_comparison_rejects_laptop_and_preserves_identity(self):
        # Candidate returned from retailer is a Dell Alienware laptop (e.g. from broad search or ad)
        cand = [{
            "retailer_name": "Flipkart",
            "product_title": "Dell Alienware m16 R2 Gaming Laptop Intel Core Ultra 9",
            "product_url": "https://www.flipkart.com/dell-alienware/p/itm1",
            "current_price": 149990.0,
            "availability": "IN_STOCK",
        }]
        retriever = MockRetriever(name="Flipkart", offers=cand)
        with patch("app.main.retrieval_service", OfferRetrievalService(retrievers=[retriever])):
            res = compare_prices(ComparePricesRequest(
                url="https://www.amazon.in/dp/B00KVEB182",
                product_name="Nivia Storm Football - Rubber, Size 5",
                current_site_price=399.0,
                mrp=500.0,
            ))
            # Source product MUST strictly echo the football product
            self.assertEqual(res.source_product.product_name, "Nivia Storm Football - Rubber, Size 5")
            self.assertEqual(res.source_product.current_site_price, 399.0)
            self.assertEqual(res.source_product.url, "https://www.amazon.in/dp/B00KVEB182")
            # Dell laptop candidate must be rejected (MODEL_MISMATCH or category mismatch)
            self.assertEqual(res.status, "no_offers_found")
            self.assertEqual(len(res.verified_offers), 0)
            self.assertIsNone(res.lowest_price)

    # 21. Deterministic source_product integrity across sequential requests
    def test_21_source_product_integrity_sequential(self):
        dell_req = ComparePricesRequest(
            url="https://www.amazon.in/dp/B0D5BXYZ12",
            product_name="Dell Alienware m16 R2 Gaming Laptop",
            current_site_price=149990.0,
        )
        football_req = ComparePricesRequest(
            url="https://www.amazon.in/dp/B00KVEB182",
            product_name="Nivia Storm Football - Size 5",
            current_site_price=399.0,
        )
        retriever = MockRetriever(name="Flipkart", offers=[])
        with patch("app.main.retrieval_service", OfferRetrievalService(retrievers=[retriever])):
            dell_res = compare_prices(dell_req)
            football_res = compare_prices(football_req)

            self.assertEqual(dell_res.source_product.product_name, "Dell Alienware m16 R2 Gaming Laptop")
            self.assertEqual(football_res.source_product.product_name, "Nivia Storm Football - Size 5")
            self.assertNotEqual(dell_res.source_product.product_name, football_res.source_product.product_name)



    # ---------------------------------------------------------------------------
    # Regression Suite: Flipkart MacBook Exact Matching & Rigorous Classification
    # ---------------------------------------------------------------------------

    # Regression 1: MacBook Air 13" M5 24GB 1TB Midnight matches Flipkart MDHG4HN/A
    def test_regression_01_macbook_air_m5_exact_match(self):
        src_title = "Apple 2026 MacBook Air 13-inch with M5 chip (24 GB unified memory, 1 TB SSD, Midnight)"
        cand_title = "Apple MacBook Air (M5, 2026) M5 - (24 GB/1 TB SSD/Tahoe) MDHG4HN/A"
        cand_url = "https://www.flipkart.com/apple-macbook-air-m5-2026-24-gb-1-tb-ssd-tahoe-mdhg4hn-a/p/itm0b3c64c6090e7"
        
        status, reason, cat, cand_vars = ProductMatcher.evaluate_match(
            source_title=src_title,
            candidate_title=cand_title,
            source_variant="Midnight",
            candidate_url=cand_url,
        )
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)
        self.assertEqual(cand_vars["color"], "midnight")
        self.assertEqual(cand_vars["screen_size"], "13-inch")
        self.assertEqual(cand_vars["ram"], "24 GB")
        self.assertEqual(cand_vars["storage"], "1 TB")
        self.assertEqual(cand_vars["cpu_family"], "m5")

        # Full endpoint comparison: ₹1,88,890 Amazon vs ₹1,86,990 Flipkart saves ₹1,900
        cand = [{
            "retailer_name": "Flipkart",
            "product_title": cand_title,
            "product_url": cand_url,
            "current_price": 186990.0,
            "availability": "IN_STOCK",
        }]
        retriever = MockRetriever(name="Flipkart", offers=cand)
        with patch("app.main.retrieval_service", OfferRetrievalService(retrievers=[retriever])):
            res = compare_prices(ComparePricesRequest(
                url="https://www.amazon.in/dp/B0GR1C18B7",
                product_name=src_title,
                current_site_price=188890.0,
                variant="Midnight",
            ))
            self.assertEqual(res.status, "success")
            self.assertEqual(len(res.verified_offers), 1)
            self.assertEqual(res.verified_offers[0].match_status, "EXACT_MATCH")
            self.assertEqual(res.lowest_price, 186990.0)
            self.assertEqual(res.lowest_price_retailer, "Flipkart")
            self.assertEqual(res.price_difference, 1900.0)
            self.assertIn("LOWER ON FLIPKART", res.verdict_label)
            self.assertIn("1,900.00", res.summary)

    # Regression 2: MacBook with 16 GB RAM instead of 24 GB rejected as CONFIGURATION_MISMATCH
    def test_regression_02_macbook_ram_mismatch_rejected(self):
        src_title = "Apple 2026 MacBook Air 13-inch with M5 chip (24 GB unified memory, 1 TB SSD, Midnight)"
        cand_title = "Apple MacBook Air (M5, 2026) M5 - (16 GB/1 TB SSD/Tahoe) MDHC4HN/A"
        
        status, reason, cat, _ = ProductMatcher.evaluate_match(
            source_title=src_title,
            candidate_title=cand_title,
            source_variant="Midnight",
        )
        self.assertEqual(status, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("ram", reason.lower())
        self.assertIn("24 GB", reason)
        self.assertIn("16 GB", reason)

    # Regression 3: MacBook with 512 GB SSD instead of 1 TB rejected as CONFIGURATION_MISMATCH
    def test_regression_03_macbook_storage_mismatch_rejected(self):
        src_title = "Apple 2026 MacBook Air 13-inch with M5 chip (24 GB unified memory, 1 TB SSD, Midnight)"
        cand_title = "Apple MacBook Air (M5, 2026) M5 - (24 GB/512 GB SSD/Tahoe) MDHH4HN/A"
        
        status, reason, cat, _ = ProductMatcher.evaluate_match(
            source_title=src_title,
            candidate_title=cand_title,
            source_variant="Midnight",
        )
        self.assertEqual(status, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("storage", reason.lower())
        self.assertIn("1 TB", reason)
        self.assertIn("512 GB", reason)

    # Regression 4: An M4 MacBook instead of M5 rejected as CONFIGURATION_MISMATCH
    def test_regression_04_macbook_chip_mismatch_rejected(self):
        src_title = "Apple 2026 MacBook Air 13-inch with M5 chip (24 GB unified memory, 1 TB SSD, Midnight)"
        cand_title = "Apple MacBook Air (M4, 2024) M4 - (24 GB/1 TB SSD/Tahoe)"
        
        status, reason, cat, _ = ProductMatcher.evaluate_match(
            source_title=src_title,
            candidate_title=cand_title,
            source_variant="Midnight",
        )
        self.assertEqual(status, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("chip mismatch", reason.lower())
        self.assertIn("M5", reason)
        self.assertIn("M4", reason)

    # Regression 5: MacBook Pro instead of MacBook Air rejected as MODEL_MISMATCH
    def test_regression_05_macbook_pro_vs_air_rejected(self):
        src_title = "Apple 2026 MacBook Air 13-inch with M5 chip (24 GB unified memory, 1 TB SSD, Midnight)"
        cand_title = "Apple MacBook Pro (M5, 2026) M5 - (24 GB/1 TB SSD/Tahoe)"
        
        status, reason, cat, _ = ProductMatcher.evaluate_match(
            source_title=src_title,
            candidate_title=cand_title,
            source_variant="Midnight",
        )
        self.assertEqual(status, MatchStatus.MODEL_MISMATCH)
        self.assertEqual(cat, RejectionCategory.MODEL_MISMATCH)
        self.assertTrue("pro" in reason.lower() or "family" in reason.lower() or "model" in reason.lower())

    # Regression 6: Listing with missing model identifiers where color cannot be established -> POSSIBLE_MATCH
    def test_regression_06_macbook_missing_model_identifier_possible_match(self):
        src_title = "Apple 2026 MacBook Air 13-inch with M5 chip (24 GB unified memory, 1 TB SSD, Midnight)"
        cand_title = "Apple MacBook Air (M5, 2026) M5 - (24 GB/1 TB SSD/Tahoe)"
        
        status, reason, cat, _ = ProductMatcher.evaluate_match(
            source_title=src_title,
            candidate_title=cand_title,
            source_variant="Midnight",
        )
        self.assertEqual(status, MatchStatus.POSSIBLE_MATCH)
        self.assertEqual(cat, RejectionCategory.UNVERIFIED_VARIANT)
        self.assertIn("unverified", reason.lower())

    # Regression 7: Listing with conflicting model identifiers rejected
    def test_regression_07_conflicting_model_identifiers_rejected(self):
        src_title = "Apple 2026 MacBook Air 13-inch with M5 chip MDHG4HN/A"
        cand_title = "Apple MacBook Air (M5, 2026) MDHD4HN/A"
        
        status, reason, cat, _ = ProductMatcher.evaluate_match(
            source_title=src_title,
            candidate_title=cand_title,
        )
        self.assertEqual(status, MatchStatus.MODEL_MISMATCH)
        self.assertEqual(cat, RejectionCategory.MODEL_MISMATCH)
        self.assertIn("model identifier mismatch", reason.lower())

    # Regression 8: Listing with a different colour rejected as CONFIGURATION_MISMATCH
    def test_regression_08_macbook_different_color_rejected(self):
        src_title = "Apple 2026 MacBook Air 13-inch with M5 chip (24 GB, 1 TB SSD, Midnight)"
        cand_title = "Apple MacBook Air (M5, 2026) Starlight - (24 GB/1 TB SSD/Tahoe) MDHK4HN/A"
        
        status, reason, cat, _ = ProductMatcher.evaluate_match(
            source_title=src_title,
            candidate_title=cand_title,
            source_variant="Midnight",
        )
        self.assertEqual(status, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("color", reason.lower())

    # Regression 9: Failed retailer request correctly reported as Query failed
    def test_regression_09_failed_retailer_request_diagnostics(self):
        class FailingRetriever(BaseRetriever):
            name = "Flipkart"
            domain = "flipkart.com"
            is_enabled = True
            status_reason = "Active"
            last_http_status = 403

            def search(self, query: str, timeout: float = 6.0) -> list[dict]:
                self.last_http_status = 403
                return []

        retriever = FailingRetriever()
        svc = OfferRetrievalService(retrievers=[retriever])
        _, _, statuses, _, _, diags = svc.retrieve_and_match("Apple MacBook Air M5")
        
        self.assertIn("Flipkart", statuses)
        self.assertIn("Query failed (HTTP 403)", statuses["Flipkart"])
        self.assertNotIn("Queried successfully", statuses["Flipkart"])
        self.assertEqual(diags[0].http_status, 403)

    # Regression 10: Unrelated sponsored or recommended products appearing in search results rejected
    def test_regression_10_unrelated_sponsored_products_rejected(self):
        src_title = "Apple 2026 MacBook Air 13-inch with M5 chip (24 GB, 1 TB SSD, Midnight)"
        
        # Sponsored phone case
        cand_case = "Shockproof Armor Case for Apple MacBook Air 13-inch Midnight"
        st_case, _, cat_case, _ = ProductMatcher.evaluate_match(src_title, cand_case)
        self.assertEqual(st_case, MatchStatus.MISMATCH)
        self.assertEqual(cat_case, RejectionCategory.ACCESSORY_OR_CONDITION)

        # Sponsored Dell laptop
        cand_dell = "Dell Inspiron 15 Intel Core i5 Laptop (16 GB, 512 GB SSD)"
        st_dell, _, cat_dell, _ = ProductMatcher.evaluate_match(src_title, cand_dell)
        self.assertEqual(st_dell, MatchStatus.MODEL_MISMATCH)
        self.assertEqual(cat_dell, RejectionCategory.MODEL_MISMATCH)

    # Regression 11: Malformed or incomplete candidate returns INSUFFICIENT_DATA
    def test_regression_11_malformed_incomplete_candidate_rejected(self):
        src_title = "Apple 2026 MacBook Air 13-inch with M5 chip (24 GB, 1 TB SSD, Midnight)"
        cand_empty = "   "
        st_empty, reason_empty, cat_empty, _ = ProductMatcher.evaluate_match(src_title, cand_empty)
        self.assertEqual(st_empty, MatchStatus.INSUFFICIENT_DATA)
        self.assertEqual(cat_empty, RejectionCategory.INSUFFICIENT_DATA)
        self.assertIn("insufficient", reason_empty.lower())

    # Regression 12: Stale results from a previous product analysis do not leak
    def test_regression_12_stale_results_not_leaked(self):
        mac_req = ComparePricesRequest(
            url="https://www.amazon.in/dp/B0GR1C18B7",
            product_name="Apple 2026 MacBook Air 13-inch with M5 chip (24 GB, 1 TB SSD, Midnight)",
            current_site_price=188890.0,
            variant="Midnight",
        )
        football_req = ComparePricesRequest(
            url="https://www.amazon.in/dp/B00KVEB182",
            product_name="Nivia Storm Football - Size 5",
            current_site_price=399.0,
        )

        mac_cand = [{
            "retailer_name": "Flipkart",
            "product_title": "Apple MacBook Air (M5, 2026) M5 - (24 GB/1 TB SSD/Tahoe) MDHG4HN/A",
            "product_url": "https://www.flipkart.com/apple-macbook-air-m5-2026-24-gb-1-tb-ssd-tahoe-mdhg4hn-a/p/itm0b3c64c6090e7",
            "current_price": 186990.0,
            "availability": "IN_STOCK",
        }]
        retriever = MockRetriever(name="Flipkart", offers=mac_cand)
        with patch("app.main.retrieval_service", OfferRetrievalService(retrievers=[retriever])):
            mac_res = compare_prices(mac_req)
            self.assertEqual(mac_res.status, "success")
            self.assertEqual(len(mac_res.verified_offers), 1)

            # Sequential request for football must not retain macbook results
            empty_retriever = MockRetriever(name="Flipkart", offers=[])
            with patch("app.main.retrieval_service", OfferRetrievalService(retrievers=[empty_retriever])):
                fb_res = compare_prices(football_req)
                self.assertEqual(fb_res.status, "no_offers_found")
                self.assertEqual(len(fb_res.verified_offers), 0)
                self.assertEqual(fb_res.source_product.product_name, "Nivia Storm Football - Size 5")

    # Regression 13: Amazon-origin comparison queries Flipkart and excludes Amazon
    def test_regression_13_amazon_origin_queries_flipkart_excludes_amazon(self):
        req = ComparePricesRequest(
            url="https://www.amazon.in/dp/B0GR1C18B7",
            product_name="Apple 2026 MacBook Air 13-inch with M5 chip",
            current_site_price=188890.0,
            source_retailer="Amazon.in",
        )
        fk_offer = [{
            "retailer_name": "Flipkart",
            "product_title": "Apple MacBook Air (M5, 2026) (24 GB/1 TB SSD) MDHG4HN/A",
            "product_url": "https://www.flipkart.com/apple-macbook-air/p/itm123",
            "current_price": 186990.0,
            "availability": "IN_STOCK",
        }]
        amz_retriever = MockRetriever(name="Amazon.in", domain="amazon.in", offers=[])
        fk_retriever = MockRetriever(name="Flipkart", domain="flipkart.com", offers=fk_offer)

        service = OfferRetrievalService(retrievers=[amz_retriever, fk_retriever])
        with patch("app.main.retrieval_service", service):
            res = compare_prices(req)
            self.assertEqual(res.status, "success")
            self.assertIn("Flipkart", res.retailers_queried)
            self.assertNotIn("Amazon.in", res.retailers_queried, "Amazon-origin comparison must not query Amazon against itself")
            self.assertEqual(res.source_product.source_retailer, "Amazon.in")
            self.assertEqual(len(res.verified_offers), 1)
            self.assertEqual(res.verified_offers[0].retailer_name, "Flipkart")

    # Regression 14: Flipkart-origin comparison queries Amazon and excludes Flipkart
    def test_regression_14_flipkart_origin_queries_amazon_excludes_flipkart(self):
        req = ComparePricesRequest(
            url="https://www.flipkart.com/nothing-phone-4b-blue-128-gb/p/itm939608b40adbb",
            product_name="Nothing Phone (4b) (Black, 256 GB) (8 GB RAM)",
            current_site_price=40999.0,
            source_retailer="Flipkart",
        )
        amz_offer = [{
            "retailer_name": "Amazon.in",
            "product_title": "Nothing Phone 4b (Black, 256 GB) (8 GB RAM)",
            "product_url": "https://www.amazon.in/dp/B0H1X5XP25",
            "current_price": 39999.0,
            "availability": "IN_STOCK",
        }]
        amz_retriever = MockRetriever(name="Amazon.in", domain="amazon.in", offers=amz_offer)
        fk_retriever = MockRetriever(name="Flipkart", domain="flipkart.com", offers=[])

        service = OfferRetrievalService(retrievers=[amz_retriever, fk_retriever])
        with patch("app.main.retrieval_service", service):
            res = compare_prices(req)
            self.assertEqual(res.status, "success")
            self.assertIn("Amazon.in", res.retailers_queried)
            self.assertNotIn("Flipkart", res.retailers_queried, "Flipkart-origin comparison must not query Flipkart against itself")
            self.assertEqual(res.source_product.source_retailer, "Flipkart")
            self.assertEqual(len(res.verified_offers), 1)
            self.assertEqual(res.verified_offers[0].retailer_name, "Amazon.in")
            self.assertIn("saving", res.summary.lower())
            self.assertIn("flipkart", res.summary.lower())

    # Regression 15: Croma, Reliance Digital, and Vijay Sales are never queried
    def test_regression_15_inactive_retailers_never_queried(self):
        class SpyingRetriever(BaseRetriever):
            def __init__(self, name, domain, is_enabled):
                self.name = name
                self.domain = domain
                self.is_enabled = is_enabled
                self.status_reason = "Disabled"
                self.called = False

            def search(self, query: str, timeout: float = 6.0) -> list[dict]:
                self.called = True
                return []

        croma = SpyingRetriever("Croma", "croma.com", False)
        reliance = SpyingRetriever("Reliance Digital", "reliancedigital.in", False)
        vijay = SpyingRetriever("Vijay Sales", "vijaysales.com", False)
        fk = MockRetriever("Flipkart", "flipkart.com", [])

        service = OfferRetrievalService(retrievers=[fk, croma, reliance, vijay])
        service.retrieve_and_match("Apple MacBook Air", source_url="https://www.amazon.in/dp/B001")

        self.assertFalse(croma.called, "Croma must never be queried")
        self.assertFalse(reliance.called, "Reliance Digital must never be queried")
        self.assertFalse(vijay.called, "Vijay Sales must never be queried")

    # Regression 16: Nothing Phone 4b exact match verification
    def test_regression_16_nothing_phone_4b_exact_match(self):
        src = "Nothing Phone (4b) (Black, 256 GB) (8 GB RAM)"
        cand = "Nothing Phone 4b (Black, 256 GB) (8 GB RAM)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)

    # Regression 17: Nothing Phone 4b vs 2a model mismatch
    def test_regression_17_nothing_phone_4b_vs_2a_model_mismatch(self):
        src = "Nothing Phone (4b) (Black, 256 GB) (8 GB RAM)"
        cand = "Nothing Phone 2a (Black, 256 GB) (8 GB RAM)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.MODEL_MISMATCH)
        self.assertEqual(cat, RejectionCategory.MODEL_MISMATCH)
        self.assertIn("mismatch", reason.lower())

    # Regression 18: Nothing Phone 4b configuration mismatch
    def test_regression_18_nothing_phone_4b_config_mismatch(self):
        src = "Nothing Phone (4b) (Black, 256 GB) (8 GB RAM)"
        cand = "Nothing Phone 4b (Black, 128 GB) (8 GB RAM)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)

    # Regression 19: Shared product interface accepts retailer_product_id without treating it as MPN
    def test_regression_19_shared_product_interface_fields_accepted(self):
        req = ComparePricesRequest(
            product_title="Nothing Phone (4b) (Black, 256 GB)",
            product_url="https://www.flipkart.com/item/p/itm939608b40adbb",
            current_price=40999.0,
            source_retailer="Flipkart",
            retailer_product_id="MOBHZMBDNBKCHZ7B",
            manufacturer_part_number=None,
            brand="Nothing",
            category="smartphone",
            specifications={"storage": "256 GB", "color": "Black"},
        )
        self.assertEqual(req.product_name, "Nothing Phone (4b) (Black, 256 GB)")
        self.assertEqual(req.current_site_price, 40999.0)
        self.assertEqual(req.url, "https://www.flipkart.com/item/p/itm939608b40adbb")
        self.assertEqual(req.retailer_product_id, "MOBHZMBDNBKCHZ7B")
        self.assertIsNone(req.manufacturer_part_number)



    # ---------------------------------------------------------------------------
    # Phase 8 — Comprehensive Testing for Section A and Section B
    # ---------------------------------------------------------------------------

    # 1. Source routing: Amazon source -> Flipkart cross-platform + Amazon same-platform
    def test_routing_amazon_source_routes_correctly(self):
        req = ComparePricesRequest(
            url="https://www.amazon.in/dp/B0GR1C18B7",
            product_name="Apple 2026 MacBook Air 13-inch M5",
            current_site_price=188890.0,
            source_retailer="Amazon.in",
            seller="Appario Retail",
            variant="Midnight, 24 GB, 1 TB",
            retailer_product_id="B0GR1C18B7",
        )
        with patch.object(retrieval_service, "retrieve_and_match") as mock_cross,              patch.object(retrieval_service, "retrieve_same_platform_sellers") as mock_same:
            mock_cross.return_value = (
                [{
                    "retailer_name": "Flipkart",
                    "product_title": "Apple MacBook Air (M5, 2026)",
                    "product_url": "https://www.flipkart.com/p/itm123",
                    "current_price": 186990.0,
                    "match_status": "EXACT_MATCH",
                    "retrieval_timestamp": "2026-10-16T12:00:00Z",
                    "seller_name": "IndiFlashMart",
                }],
                ["Flipkart"],
                {"Flipkart": "Success"},
                "query",
                [],
                []
            )
            mock_same.return_value = (
                [{
                    "retailer_name": "Amazon.in",
                    "product_title": "Apple 2026 MacBook Air 13-inch M5",
                    "product_url": "https://www.amazon.in/dp/B0GR1C18B8",
                    "current_price": 187500.0,
                    "match_status": "EXACT_MATCH",
                    "retrieval_timestamp": "2026-10-16T12:00:00Z",
                    "seller_name": "Cloudtail India",
                    "price_difference": 1390.0,
                }],
                "success",
                [],
                187500.0,
                "Found 1 alternative verified seller(s) on Amazon.in."
            )
            res = compare_prices(req)
            self.assertEqual(len(res.cross_platform_offers), 1)
            self.assertEqual(res.cross_platform_offers[0].retailer_name, "Flipkart")
            self.assertNotIn("Amazon.in", [o.retailer_name for o in res.cross_platform_offers])

            self.assertEqual(len(res.same_platform_seller_offers), 1)
            self.assertEqual(res.same_platform_seller_offers[0].retailer_name, "Amazon.in")
            self.assertEqual(res.same_platform_seller_offers[0].seller_name, "Cloudtail India")
            self.assertEqual(res.same_platform_status, "success")

    # 2. Source routing: Flipkart source -> Amazon cross-platform + Flipkart same-platform
    def test_routing_flipkart_source_routes_correctly(self):
        req = ComparePricesRequest(
            url="https://www.flipkart.com/apple-macbook-air-m5/p/itm123",
            product_name="Apple MacBook Air (M5, 2026)",
            current_site_price=186990.0,
            source_retailer="Flipkart",
            seller="IndiFlashMart",
            variant="Midnight, 24 GB, 1 TB",
            retailer_product_id="MOB123XYZ",
        )
        with patch.object(retrieval_service, "retrieve_and_match") as mock_cross,              patch.object(retrieval_service, "retrieve_same_platform_sellers") as mock_same:
            mock_cross.return_value = (
                [{
                    "retailer_name": "Amazon.in",
                    "product_title": "Apple 2026 MacBook Air 13-inch M5",
                    "product_url": "https://www.amazon.in/dp/B0GR1C18B7",
                    "current_price": 188890.0,
                    "match_status": "EXACT_MATCH",
                    "retrieval_timestamp": "2026-10-16T12:00:00Z",
                    "seller_name": "Appario Retail",
                }],
                ["Amazon.in"],
                {"Amazon.in": "Success"},
                "query",
                [],
                []
            )
            mock_same.return_value = (
                [{
                    "retailer_name": "Flipkart",
                    "product_title": "Apple MacBook Air (M5, 2026)",
                    "product_url": "https://www.flipkart.com/p/itm999",
                    "current_price": 185000.0,
                    "match_status": "EXACT_MATCH",
                    "retrieval_timestamp": "2026-10-16T12:00:00Z",
                    "seller_name": "SuperComNet",
                    "price_difference": 1990.0,
                }],
                "success",
                [],
                185000.0,
                "Found 1 alternative verified seller(s) on Flipkart."
            )
            res = compare_prices(req)
            self.assertEqual(len(res.cross_platform_offers), 1)
            self.assertEqual(res.cross_platform_offers[0].retailer_name, "Amazon.in")
            self.assertNotIn("Flipkart", [o.retailer_name for o in res.cross_platform_offers])

            self.assertEqual(len(res.same_platform_seller_offers), 1)
            self.assertEqual(res.same_platform_seller_offers[0].retailer_name, "Flipkart")
            self.assertEqual(res.same_platform_seller_offers[0].seller_name, "SuperComNet")

    # 3. Flow isolation: failure in one flow does not erase results from the other
    def test_flow_isolation_failure_does_not_erase_other_flow(self):
        req = ComparePricesRequest(
            url="https://www.amazon.in/dp/B0GR1C18B7",
            product_name="Apple 2026 MacBook Air 13-inch M5",
            current_site_price=188890.0,
            source_retailer="Amazon.in",
        )
        with patch.object(retrieval_service, "retrieve_and_match") as mock_cross,              patch.object(retrieval_service, "retrieve_same_platform_sellers") as mock_same:
            mock_cross.return_value = (
                [{
                    "retailer_name": "Flipkart",
                    "product_title": "Apple MacBook Air (M5, 2026)",
                    "product_url": "https://www.flipkart.com/p/itm123",
                    "current_price": 186990.0,
                    "match_status": "EXACT_MATCH",
                    "retrieval_timestamp": "2026-10-16T12:00:00Z",
                }],
                ["Flipkart"],
                {"Flipkart": "Success"},
                "query",
                [],
                []
            )
            mock_same.side_effect = TimeoutError("Retailer network timeout")

            res = compare_prices(req)
            # Cross-platform offers must be preserved
            self.assertEqual(len(res.cross_platform_offers), 1)
            self.assertEqual(res.cross_platform_offers[0].current_price, 186990.0)
            self.assertEqual(res.status, "success")
            # Same-platform reports error without crashing response
            self.assertEqual(res.same_platform_status, "error")
            self.assertEqual(len(res.same_platform_seller_offers), 0)

    # 4. Seller verification: multiple genuinely distinct sellers and duplicate removal
    def test_seller_multiple_distinct_and_deduplication(self):
        candidates = [
            {"retailer_name": "Amazon.in", "product_title": "Logitech G29 Driving Force Racing Wheel", "product_url": "https://www.amazon.in/dp/B000SRC", "retailer_product_id": "B000SRC", "current_price": 29990.0, "seller_name": "Current Seller"},
            {"retailer_name": "Amazon.in", "product_title": "Logitech G29 Driving Force Racing Wheel", "product_url": "https://www.amazon.in/dp/B000ALT1", "retailer_product_id": "B000ALT1", "current_price": 27990.0, "seller_name": "Seller Alpha"},
            {"retailer_name": "Amazon.in", "product_title": "Logitech G29 Driving Force Racing Wheel", "product_url": "https://www.amazon.in/dp/B000ALT1_DUP", "retailer_product_id": "B000ALT1_DUP", "current_price": 27990.0, "seller_name": "Seller Alpha"},
            {"retailer_name": "Amazon.in", "product_title": "Logitech G29 Driving Force Racing Wheel", "product_url": "https://www.amazon.in/dp/B000ALT2", "retailer_product_id": "B000ALT2", "current_price": 31500.0, "seller_name": "Seller Beta"},
        ]
        from app.retrieval import BaseRetriever
        class MockRetriever(BaseRetriever):
            name = "Amazon.in"
            domain = "amazon.in"
            is_enabled = True
            status_reason = "Active"
            def search(self, query: str, timeout: float = 6.0):
                return candidates

        svc = OfferRetrievalService(retrievers=[MockRetriever()])
        offers, status, diags, lowest, summary = svc.retrieve_same_platform_sellers(
            source_title="Logitech G29 Driving Force Racing Wheel",
            source_retailer="Amazon.in",
            source_url="https://www.amazon.in/dp/B000SRC",
            source_price=29990.0,
            source_seller="Current Seller",
            source_product_id="B000SRC",
        )
        self.assertEqual(status, "success")
        self.assertEqual(len(offers), 2)
        self.assertEqual(offers[0]["seller_name"], "Seller Alpha")
        self.assertEqual(offers[0]["price_difference"], 2000.0) # 29990 - 27990
        self.assertEqual(offers[1]["seller_name"], "Seller Beta")
        self.assertEqual(offers[1]["price_difference"], -1510.0) # 29990 - 31500

    # 5. Seller verification: missing seller identity returns seller_data_unavailable truthfully
    def test_seller_missing_identity_reports_unavailable(self):
        candidates = [
            {"retailer_name": "Amazon.in", "product_title": "Logitech G29 Driving Force Racing Wheel", "product_url": "https://www.amazon.in/dp/B000ALT9", "retailer_product_id": "B000ALT9", "current_price": 27990.0, "seller_name": None}
        ]
        from app.retrieval import BaseRetriever
        class MockRetriever(BaseRetriever):
            name = "Amazon.in"
            domain = "amazon.in"
            is_enabled = True
            status_reason = "Active"
            def search(self, query: str, timeout: float = 6.0):
                return candidates

        svc = OfferRetrievalService(retrievers=[MockRetriever()])
        offers, status, diags, lowest, summary = svc.retrieve_same_platform_sellers(
            source_title="Logitech G29 Driving Force Racing Wheel",
            source_retailer="Amazon.in",
            source_url="https://www.amazon.in/dp/B000SRC",
            source_price=29990.0,
            source_seller="Current Seller",
            source_product_id="B000SRC",
        )
        self.assertEqual(status, "seller_data_unavailable")
        self.assertEqual(len(offers), 0)
        self.assertIn("Alternative sellers could not be verified", summary)

    # 6. Matching: Logitech G29 exact match with gamepad/controller wording
    def test_matching_controller_gamepad_wording_equivalence(self):
        src = "Logitech G29 Driving Force Racing Wheel and Pedals"
        cand = "Logitech G29 Gamepad / Controller Racing Wheel"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)

    # 7. Matching: Logitech G29 vs G920 model mismatch
    def test_matching_controller_model_mismatch_g29_vs_g920(self):
        src = "Logitech G29 Driving Force Racing Wheel"
        cand = "Logitech G920 Driving Force Racing Wheel"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.MODEL_MISMATCH)
        self.assertEqual(cat, RejectionCategory.MODEL_MISMATCH)

    # 8. Matching: Wired vs wireless controller configuration mismatch
    def test_matching_controller_wired_vs_wireless_mismatch(self):
        src = "Xbox Wireless Controller Carbon Black"
        cand = "Xbox Wired Controller Carbon Black"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)

    # 9. Matching: Shifter accessory rejected for racing wheel product
    def test_matching_controller_accessory_shifter_rejected(self):
        src = "Logitech G29 Driving Force Racing Wheel"
        cand = "Logitech G Driving Force Shifter for G29 and G920"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.MISMATCH)
        self.assertEqual(cat, RejectionCategory.ACCESSORY_OR_CONDITION)

    # 10. Retrieval failure: zero results reported truthfully
    def test_retrieval_failure_zero_results(self):
        from app.retrieval import BaseRetriever
        class EmptyRetriever(BaseRetriever):
            name = "Flipkart"
            domain = "flipkart.com"
            is_enabled = True
            status_reason = "Active"
            last_http_status = 200
            last_raw_count = 0
            last_parsed_count = 0
            def search(self, query: str, timeout: float = 6.0):
                return []

        svc = OfferRetrievalService(retrievers=[EmptyRetriever()])
        offers, queried, statuses, q, evals, diags = svc.retrieve_and_match(
            "Logitech G29 Driving Force Racing Wheel",
            source_retailer="Amazon.in"
        )
        self.assertEqual(len(offers), 0)
        self.assertIn("0 listings returned", statuses.get("Flipkart", ""))


    # -------------------------------------------------------------------------
    # Regression Test Suite: Live Pipeline & Shared Architecture (Phase 3.3)
    # -------------------------------------------------------------------------

    # 1. Amazon HTTP 503 and CAPTCHA/error pages
    def test_amazon_http_503_and_captcha_error_pages(self):
        retriever = AmazonRetriever()
        
        # Test 503 HTML body
        html_503 = """<html><head><title>503 - Service Unavailable Error</title></head>
        <body><p>It's rush hour and traffic is piling up on that page. Automated access to Amazon data.</p></body></html>"""
        status_503 = retriever._is_bot_blocked(html_503)
        self.assertEqual(status_503, "503_block")

        # Test CAPTCHA page
        html_captcha = """<html><body><h4>Type the characters you see in this image:</h4>
        <input name="captcha" /></body></html>"""
        status_captcha = retriever._is_bot_blocked(html_captcha)
        self.assertEqual(status_captcha, "captcha")

        # Test Akamai bot block page
        html_akamai = """<html><script>window.bm_verify = true; triggerInterstitialChallenge();</script></html>"""
        status_akamai = retriever._is_bot_blocked(html_akamai)
        self.assertEqual(status_akamai, "bot_block")

    # 2. Valid Amazon search results and price extraction
    def test_valid_amazon_search_results_and_price_extraction(self):
        retriever = AmazonRetriever()
        sample_html = """
        <div data-asin="B0FLJ5QFZQ" class="s-result-item">
            <h2><a href="/Kreo-Controller-Wireless-Gaming/dp/B0FLJ5QFZQ/ref=sr_1_1"><span>Surge XB Wireless Gaming Controller</span></a></h2>
            <span class="a-price"><span class="a-offscreen">₹1,899.00</span></span>
            <span class="a-price a-text-price"><span class="a-offscreen">₹4,999.00</span></span>
        </div>
        <div data-asin="B0GYX4H4GW" class="s-result-item">
            <h2><a href="/Kreo-Controller-Wired-Gaming/dp/B0GYX4H4GW"><span>Surge LITE Wired Gaming Controller</span></a></h2>
            <span class="a-price"><span class="a-offscreen">₹1,299.00</span></span>
        </div>
        """
        parsed = retriever._parse_amazon_html(sample_html)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0]["retailer_product_id"], "B0FLJ5QFZQ")
        self.assertEqual(parsed[0]["current_price"], 1899.0)
        self.assertEqual(parsed[0]["mrp"], 4999.0)
        self.assertIn("/Kreo-Controller-Wireless-Gaming/dp/B0FLJ5QFZQ", parsed[0]["product_url"])
        self.assertEqual(parsed[1]["current_price"], 1299.0)
        self.assertIsNone(parsed[1]["mrp"])

    # 3. Flipkart-to-Amazon and Amazon-to-Flipkart routing
    def test_flipkart_to_amazon_and_amazon_to_flipkart_routing(self):
        svc = OfferRetrievalService()
        
        # When source is Flipkart, cross-platform should target Amazon.in
        fk_url = "https://www.flipkart.com/kreo-surge-xb/p/itm9bd006ba2dbca"
        query = svc.build_search_query("Kreo Surge XB Wireless Gaming Controller")
        self.assertIn("Kreo", query)
        self.assertIn("Surge", query)

        # When source is Amazon, cross-platform should target Flipkart
        amz_url = "https://www.amazon.in/dp/B0FLJ5QFZQ"
        query_amz = svc.build_search_query("Logitech G29 Driving Force Racing Wheel")
        self.assertIn("Logitech", query_amz)
        self.assertIn("G29", query_amz)

    # 4. Genuine equivalent listings with different title wording
    def test_genuine_equivalent_different_title_wording_matches(self):
        src_fk = "Kreo Surge XB Wireless Gaming Controller with Hall Effect, Turbo Mode, RGB Bluetooth, USB Gamepad"
        cand_amz = "Surge XB Wireless Gaming Controller with Hall Effect Joysticks & Triggers, Tri-Mode, Turbo Mode, Macro Buttons, RGB, 1000Hz Polling, Gaming controller for PC Wireless, Android."
        cand_url = "https://www.amazon.in/Kreo-Controller-Joysticks-Connectivity-controller/dp/B0FLJ5QFZQ"

        status, reason, cat, vars = ProductMatcher.evaluate_match(src_fk, cand_amz, candidate_url=cand_url)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)
        self.assertEqual(vars["brand"], "kreo")
        self.assertEqual(vars["connectivity"], "wireless")

    # 5. Different model, generation, connectivity and configuration rejection
    def test_different_model_generation_connectivity_configuration_rejection(self):
        src = "Kreo Surge XB Wireless Gaming Controller with Hall Effect, Turbo Mode, RGB Bluetooth, USB Gamepad"
        
        # Different model: Mirage
        cand_mirage = "Mirage Wireless RGB Gaming Controller for PC, Android, iOS & PS4"
        st_m, _, cat_m, _ = ProductMatcher.evaluate_match(src, cand_mirage, candidate_url="https://www.amazon.in/Kreo-dp-B0CQYJXHRP")
        self.assertEqual(st_m, MatchStatus.MISMATCH)
        self.assertEqual(cat_m, RejectionCategory.MODEL_MISMATCH)

        # Different tier: Surge Ultra
        cand_ultra = "Surge Ultra Wireless Gaming Controller for PC, 1K Polling Rate, Gyroscope"
        st_u, _, cat_u, _ = ProductMatcher.evaluate_match(src, cand_ultra, candidate_url="https://www.amazon.in/Kreo-dp-B0GHN2NLG1")
        self.assertEqual(st_u, MatchStatus.MISMATCH)
        self.assertEqual(cat_u, RejectionCategory.MODEL_MISMATCH)

        # Different connectivity: Surge XB Wired
        cand_lite = "Surge XB Wired Gaming Controller for PC | Hall Effect Joysticks & Triggers"
        st_l, _, cat_l, _ = ProductMatcher.evaluate_match(src, cand_lite, candidate_url="https://www.amazon.in/Kreo-dp-B0GYX4H4GW")
        self.assertEqual(st_l, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat_l, RejectionCategory.CONFIG_MISMATCH)

        # Different brand: EvoFox Elite X2
        cand_evofox = "EvoFox Elite X2 Wireless Gaming Controller for PC, Android, TV"
        st_e, _, cat_e, _ = ProductMatcher.evaluate_match(src, cand_evofox, candidate_url="https://www.amazon.in/EvoFox-dp-B0FC284LX2")
        self.assertEqual(st_e, MatchStatus.MODEL_MISMATCH)
        self.assertEqual(cat_e, RejectionCategory.MODEL_MISMATCH)

    # 6. Duplicate listings and missing seller identity
    def test_duplicate_listings_and_missing_seller_identity(self):
        from app.retrieval import BaseRetriever
        class DupRetriever(BaseRetriever):
            name = "Amazon.in"
            domain = "amazon.in"
            is_enabled = True
            status_reason = "Active"
            last_http_status = 200
            last_raw_count = 3
            last_parsed_count = 3
            def search(self, query: str, timeout: float = 6.0):
                return [
                    {"retailer_name": "Amazon.in", "product_title": "Surge XB Wireless Gaming Controller", "product_url": "https://www.amazon.in/Kreo/dp/B0FLJ5QFZQ", "current_price": 1899.0, "retailer_product_id": "B0FLJ5QFZQ", "seller_name": None},
                    {"retailer_name": "Amazon.in", "product_title": "Surge XB Wireless Gaming Controller", "product_url": "https://www.amazon.in/Kreo/dp/B0FLJ5QFZQ", "current_price": 1899.0, "retailer_product_id": "B0FLJ5QFZQ", "seller_name": None},
                    {"retailer_name": "Amazon.in", "product_title": "Surge XB Wireless Gaming Controller Duplicate", "product_url": "https://www.amazon.in/Kreo/dp/B0FLJ5QFZQ", "current_price": 1899.0, "retailer_product_id": "B0FLJ5QFZQ", "seller_name": None},
                ]

        svc = OfferRetrievalService(retrievers=[DupRetriever()])
        offers, queried, statuses, q, evals, diags = svc.retrieve_and_match(
            "Kreo Surge XB Wireless Gaming Controller with Hall Effect, Turbo Mode, RGB Bluetooth, USB Gamepad",
            source_retailer="Flipkart"
        )
        # Should deduplicate to exactly 1 offer
        self.assertEqual(len(offers), 1)

    # 7. Partial results and one comparison section failing independently
    def test_partial_results_and_one_comparison_section_failing_independently(self):
        from app.retrieval import BaseRetriever
        class FailingAmazonRetriever(BaseRetriever):
            name = "Amazon.in"
            domain = "amazon.in"
            is_enabled = True
            status_reason = "Blocked: Amazon India returned HTTP 503."
            last_http_status = 503
            last_raw_count = 0
            last_parsed_count = 0
            def search(self, query: str, timeout: float = 6.0):
                return []

        class WorkingFlipkartRetriever(BaseRetriever):
            name = "Flipkart"
            domain = "flipkart.com"
            is_enabled = True
            status_reason = "Active"
            last_http_status = 200
            last_raw_count = 1
            last_parsed_count = 1
            def search(self, query: str, timeout: float = 6.0):
                return [
                    {"retailer_name": "Flipkart", "product_title": "Kreo Surge XB Wireless Gaming Controller", "product_url": "https://www.flipkart.com/kreo/p/itm123", "current_price": 1899.0, "retailer_product_id": "PID123", "seller_name": "RetailNet"}
                ]

        svc = OfferRetrievalService(retrievers=[WorkingFlipkartRetriever(), FailingAmazonRetriever()])
        
        # Section A: cross-platform search fails (Amazon 503)
        offers, queried, statuses, q, evals, diags = svc.retrieve_and_match(
            "Kreo Surge XB Wireless Gaming Controller",
            source_retailer="Flipkart"
        )
        self.assertEqual(len(offers), 0)
        self.assertEqual(diags[0].http_status, 503)

        # Section B: same-platform seller retrieval still succeeds independently
        same_offers, same_status, same_diags, lowest_p, summary = svc.retrieve_same_platform_sellers(
            source_title="Kreo Surge XB Wireless Gaming Controller",
            source_retailer="Flipkart",
            source_price=1899.0,
            source_seller="RetailNet",
            source_product_id="ACCHG3QHWY5EZYHG"
        )
        self.assertIn(same_status, ("no_other_sellers_found", "success"))
        self.assertIsNotNone(summary)

    # 8. Stale results after changing tabs or navigating to another product
    def test_stale_results_after_changing_tabs_or_navigating(self):
        svc = OfferRetrievalService()
        
        # Request 1: Controller
        q1 = svc.build_search_query("Kreo Surge XB Wireless Gaming Controller")
        self.assertIn("Kreo", q1)
        self.assertNotIn("MacBook", q1)
        self.assertNotIn("Refrigerator", q1)

        # Request 2: MacBook
        q2 = svc.build_search_query("Apple 2026 MacBook Air 13-inch with M5 chip 24 GB 1 TB Midnight")
        self.assertIn("MacBook", q2)
        self.assertNotIn("Kreo", q2)

        # Request 3: Refrigerator
        q3 = svc.build_search_query("Samsung 236 L Double Door Refrigerator Elegant Inox")
        self.assertIn("Refrigerator", q3)
        self.assertNotIn("MacBook", q3)
        self.assertNotIn("Kreo", q3)


    # 9. Inactive retailers (Croma, Reliance Digital, Vijay Sales) completely removed from active workflow
    def test_inactive_retailers_strictly_excluded_from_active_comparison_workflow(self):
        # Service defaults strictly to Flipkart and Amazon.in
        svc = OfferRetrievalService()
        active_names = [r.name for r in svc.retrievers]
        self.assertEqual(active_names, ["Flipkart", "Amazon.in"])
        self.assertNotIn("Croma", active_names)
        self.assertNotIn("Reliance Digital", active_names)
        self.assertNotIn("Vijay Sales", active_names)

        # Full comparison response contains only the active cross-platform retailer
        amz_src = ComparePricesRequest(
            source_retailer="Amazon.in",
            product_title="Apple MacBook Air 13-inch M5",
            product_url="https://www.amazon.in/dp/B001",
            current_price=188890.0
        )
        res_amz = compare_prices(amz_src)
        self.assertEqual(res_amz.retailers_queried, ["Flipkart"])
        for d in res_amz.retailer_diagnostics:
            self.assertEqual(d.retailer_name, "Flipkart")
            self.assertNotIn(d.retailer_name, ("Croma", "Reliance Digital", "Vijay Sales"))

        fk_src = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title="Nothing Phone 4b (Black, 256 GB)",
            product_url="https://www.flipkart.com/nothing-phone-4b/p/itm1",
            current_price=27999.0
        )
        res_fk = compare_prices(fk_src)
        self.assertEqual(res_fk.retailers_queried, ["Amazon.in"])
        for d in res_fk.retailer_diagnostics:
            self.assertEqual(d.retailer_name, "Amazon.in")
            self.assertNotIn(d.retailer_name, ("Croma", "Reliance Digital", "Vijay Sales"))

    # 10. Headphones & Audio Devices category verification
    def test_audio_category_matching_and_rejection(self):
        # Exact match with differing title wording
        src_amz = "Sony WH-1000XM5 Wireless Industry Leading Noise Canceling Headphones, Black"
        cand_fk = "Sony WH-1000XM5 Bluetooth Headset (Black, Over the Ear)"
        status, _, cat, vars = ProductMatcher.evaluate_match(src_amz, cand_fk)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)
        self.assertEqual(vars["brand"], "sony")
        self.assertEqual(vars["model_line"], "wh-1000xm5")

        # Different generation (XM5 vs XM4) -> MODEL_MISMATCH
        cand_xm4 = "Sony WH-1000XM4 Wireless Noise Canceling Headphones"
        st_xm4, _, cat_xm4, _ = ProductMatcher.evaluate_match(src_amz, cand_xm4)
        self.assertEqual(st_xm4, MatchStatus.MODEL_MISMATCH)
        self.assertEqual(cat_xm4, RejectionCategory.MODEL_MISMATCH)

        # Query construction
        svc = OfferRetrievalService()
        q_audio = svc.build_search_query(src_amz)
        self.assertIn("Sony", q_audio)
        self.assertIn("WH-1000XM5", q_audio)

    # 11. Monitors & Displays category verification
    def test_monitors_displays_matching_and_rejection(self):
        src_mon = "LG UltraGear 27-inch FHD IPS Gaming Monitor (144Hz, 1ms, AMD FreeSync)"
        cand_mon = "LG 27 inch UltraGear 144Hz Gaming Monitor, IPS Panel, Full HD"
        status, _, cat, vars = ProductMatcher.evaluate_match(src_mon, cand_mon)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)
        self.assertEqual(vars["brand"], "lg")
        self.assertEqual(vars["screen_size"], "27-inch")
        self.assertEqual(vars["refresh_rate"], "144Hz")

        # Screen size mismatch (27-inch vs 24-inch) -> CONFIG_MISMATCH
        cand_24 = "LG UltraGear 24-inch 144Hz FHD IPS Gaming Monitor"
        st_sz, _, cat_sz, _ = ProductMatcher.evaluate_match(src_mon, cand_24)
        self.assertEqual(st_sz, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat_sz, RejectionCategory.CONFIG_MISMATCH)

        # Refresh rate mismatch (144Hz vs 240Hz) -> CONFIG_MISMATCH
        cand_240 = "LG UltraGear 27-inch 240Hz FHD IPS Gaming Monitor"
        st_hz, _, cat_hz, _ = ProductMatcher.evaluate_match(src_mon, cand_240)
        self.assertEqual(st_hz, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat_hz, RejectionCategory.CONFIG_MISMATCH)

        # Resolution mismatch (FHD vs 4K) -> CONFIG_MISMATCH
        cand_4k = "LG UltraGear 27-inch 4K UHD 144Hz Gaming Monitor"
        st_res, _, cat_res, _ = ProductMatcher.evaluate_match(src_mon, cand_4k)
        self.assertEqual(st_res, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat_res, RejectionCategory.CONFIG_MISMATCH)

        # Query construction
        svc = OfferRetrievalService()
        q_mon = svc.build_search_query(src_mon)
        self.assertIn("Lg", q_mon)
        self.assertIn("Ultragear", q_mon)
        self.assertIn("27-inch", q_mon)
        self.assertIn("144Hz", q_mon)

    # 12. Storage Devices & Components category verification
    def test_storage_components_matching_and_rejection(self):
        src_ssd = "Crucial P3 Plus 1TB PCIe 4.0 3D NAND NVMe M.2 SSD, up to 5000MB/s"
        cand_ssd = "Crucial P3 Plus 1 TB Internal Solid State Drive (NVMe M.2 Gen 4)"
        status, _, cat, vars = ProductMatcher.evaluate_match(src_ssd, cand_ssd)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)
        self.assertEqual(vars["brand"], "crucial")
        self.assertEqual(vars["storage"], "1 TB")
        self.assertEqual(vars["model_line"], "p3 plus")

        # Capacity mismatch (1TB vs 2TB) -> CONFIG_MISMATCH
        cand_2tb = "Crucial P3 Plus 2TB PCIe 4.0 3D NAND NVMe M.2 SSD"
        st_cap, _, cat_cap, _ = ProductMatcher.evaluate_match(src_ssd, cand_2tb)
        self.assertEqual(st_cap, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat_cap, RejectionCategory.CONFIG_MISMATCH)

        # Model tier mismatch (P3 Plus vs P3 base) -> MODEL_MISMATCH
        cand_p3 = "Crucial P3 1TB PCIe 3.0 3D NAND NVMe M.2 SSD"
        st_p3, _, cat_p3, _ = ProductMatcher.evaluate_match(src_ssd, cand_p3)
        self.assertEqual(st_p3, MatchStatus.MISMATCH)
        self.assertEqual(cat_p3, RejectionCategory.MODEL_MISMATCH)

        # Interface mismatch (NVMe vs SATA) -> CONFIG_MISMATCH
        cand_sata = "Crucial P3 Plus 1TB Internal SATA SSD"
        st_sata, _, cat_sata, _ = ProductMatcher.evaluate_match(src_ssd, cand_sata)
        self.assertEqual(st_sata, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat_sata, RejectionCategory.CONFIG_MISMATCH)

        # Query construction
        svc = OfferRetrievalService()
        q_ssd = svc.build_search_query(src_ssd)
        self.assertIn("Crucial", q_ssd)
        self.assertIn("P3 Plus", q_ssd)
        self.assertIn("1 TB", q_ssd)

    # 13. Everyday Consumer Products (Sports & Household) verification
    def test_everyday_consumer_products_matching_and_rejection(self):
        src_fb = "Nivia Storm Football Size 5 (White/Black)"
        cand_fb = "Nivia Storm Rubber Football - Size: 5 (Black, White)"
        status, _, cat, vars = ProductMatcher.evaluate_match(src_fb, cand_fb)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)
        self.assertEqual(vars["brand"], "nivia")
        self.assertEqual(vars["model_line"], "storm")
        self.assertEqual(vars["item_size"], "Size 5")

        # Size mismatch (Size 5 vs Size 4) -> CONFIG_MISMATCH
        cand_sz4 = "Nivia Storm Football - Size: 4 (White)"
        st_sz, _, cat_sz, _ = ProductMatcher.evaluate_match(src_fb, cand_sz4)
        self.assertEqual(st_sz, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat_sz, RejectionCategory.CONFIG_MISMATCH)

        # Model line mismatch (Storm vs Shining Star) -> MODEL_MISMATCH
        cand_star = "Nivia Shining Star Football - Size: 5"
        st_star, _, cat_star, _ = ProductMatcher.evaluate_match(src_fb, cand_star)
        self.assertEqual(st_star, MatchStatus.MISMATCH)
        self.assertEqual(cat_star, RejectionCategory.MODEL_MISMATCH)

        # Query construction
        svc = OfferRetrievalService()
        q_fb = svc.build_search_query(src_fb)
        self.assertIn("Nivia", q_fb)
        self.assertIn("Storm", q_fb)
        self.assertIn("Football", q_fb)


    # 14. Amazon PA-API 5.0 response parsing and normalization
    def test_amazon_paapi_response_parsing_and_normalization(self):
        retriever = AmazonRetriever()
        paapi_sample = {
            "SearchResult": {
                "Items": [
                    {
                        "ASIN": "B0FLJ5QFZQ",
                        "DetailPageURL": "https://www.amazon.in/dp/B0FLJ5QFZQ",
                        "ItemInfo": {
                            "Title": {
                                "DisplayValue": "Kreo Surge XB Wireless Gaming Controller with Hall Effect, Turbo Mode, RGB Bluetooth, USB Gamepad"
                            }
                        },
                        "Images": {
                            "Primary": {
                                "Large": {
                                    "URL": "https://m.media-amazon.com/images/I/71example.jpg"
                                }
                            }
                        },
                        "Offers": {
                            "Listings": [
                                {
                                    "Price": {
                                        "Amount": 1899.0,
                                        "Currency": "INR"
                                    },
                                    "MerchantInfo": {
                                        "Name": "Appario Retail Private Ltd"
                                    },
                                    "Availability": {
                                        "Message": "In Stock"
                                    }
                                }
                            ]
                        }
                    }
                ]
            }
        }
        offers = retriever._parse_paapi_response(paapi_sample)
        self.assertEqual(len(offers), 1)
        self.assertEqual(offers[0]["retailer_name"], "Amazon.in")
        self.assertEqual(offers[0]["retailer_product_id"], "B0FLJ5QFZQ")
        self.assertEqual(offers[0]["current_price"], 1899.0)
        self.assertEqual(offers[0]["seller_name"], "Appario Retail Private Ltd")
        self.assertEqual(offers[0]["availability"], "IN_STOCK")
        self.assertIn("PA-API", offers[0]["data_source"])

    # 15. Amazon Rainforest API response parsing and normalization
    def test_amazon_rainforest_response_parsing_and_normalization(self):
        retriever = AmazonRetriever()
        rainforest_sample = {
            "search_results": [
                {
                    "title": "Kreo Surge XB Wireless Gaming Controller with Hall Effect, Turbo Mode, RGB Bluetooth, USB Gamepad",
                    "asin": "B0FLJ5QFZQ",
                    "link": "https://www.amazon.in/dp/B0FLJ5QFZQ",
                    "price": {"value": 1899.0},
                    "rrp": {"value": 4999.0},
                    "image": "https://m.media-amazon.com/images/I/71example.jpg",
                    "merchant_info": {"name": "Appario Retail"}
                }
            ]
        }
        offers = retriever._parse_rainforest_response(rainforest_sample)
        self.assertEqual(len(offers), 1)
        self.assertEqual(offers[0]["retailer_name"], "Amazon.in")
        self.assertEqual(offers[0]["retailer_product_id"], "B0FLJ5QFZQ")
        self.assertEqual(offers[0]["current_price"], 1899.0)
        self.assertEqual(offers[0]["mrp"], 4999.0)
        self.assertEqual(offers[0]["seller_name"], "Appario Retail")
        self.assertIn("Rainforest", offers[0]["data_source"])

    # 16. Flipkart -> Amazon comparison with verified candidate produces genuine cross-platform offer
    def test_flipkart_to_amazon_comparison_with_genuine_amazon_candidate(self):
        fk_source = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title="Kreo Surge XB Wireless Gaming Controller with Hall Effect, Turbo Mode, RGB Bluetooth, USB Gamepad",
            product_url="https://www.flipkart.com/kreo-surge-xb/p/itm9bd006ba2dbca",
            current_price=1999.0,
            variant="Wireless · Black"
        )
        amz_candidate = [{
            "retailer_name": "Amazon.in",
            "product_title": "Kreo Surge XB Wireless Gaming Controller (Black) with Hall Effect, Turbo Mode, RGB Bluetooth, USB Gamepad",
            "product_url": "https://www.amazon.in/dp/B0FLJ5QFZQ",
            "current_price": 1899.0,
            "mrp": 4999.0,
            "retailer_product_id": "B0FLJ5QFZQ",
            "availability": "IN_STOCK",
            "seller_name": "Appario Retail Private Ltd",
            "data_source": "Amazon Product Advertising API (PA-API v5)"
        }]
        retriever = MockRetriever(name="Amazon.in", offers=amz_candidate)
        with patch("app.main.retrieval_service", OfferRetrievalService(retrievers=[retriever])):
            resp = compare_prices(fk_source)
            self.assertEqual(resp.status, "success")
            self.assertEqual(resp.cross_platform_status, "success")
            self.assertEqual(resp.verdict_label, "LOWER ON AMAZON.IN")
            self.assertEqual(len(resp.verified_offers), 1)
            self.assertEqual(resp.verified_offers[0].retailer_name, "Amazon.in")
            self.assertEqual(resp.verified_offers[0].current_price, 1899.0)
            self.assertEqual(resp.price_difference, 100.0) # 1999 - 1899


    # ---------------------------------------------------------------------------
    # Tests for Browser-Based Amazon Tab Candidate Integration
    # ---------------------------------------------------------------------------

    def test_browser_candidates_exact_match_flipkart_to_amazon(self):
        req = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title="Nothing Phone (2a) 5G (Black, 128 GB)",
            product_url="https://www.flipkart.com/nothing-phone-2a/p/itm12345",
            current_price=23999.0,
            variant="128 GB · Black",
            browser_candidate_offers=[{
                "retailer_name": "Amazon.in",
                "product_title": "Nothing Phone (2a) 5G (Black, 128 GB)",
                "product_url": "https://www.amazon.in/dp/B0D1234567",
                "current_price": 21999.0,
                "mrp": 25999.0,
                "retailer_product_id": "B0D1234567",
                "availability": "IN_STOCK",
                "data_source": "Amazon Browser Tab Search",
            }],
            browser_retrieval_status="found",
        )
        res = compare_prices(req)
        self.assertEqual(res.status, "success")
        self.assertEqual(res.verdict_label, "LOWER ON AMAZON.IN")
        self.assertEqual(len(res.verified_offers), 1)
        self.assertEqual(res.verified_offers[0].retailer_name, "Amazon.in")
        self.assertEqual(res.verified_offers[0].current_price, 21999.0)
        self.assertEqual(res.price_difference, 2000.0)
        self.assertIn("saving", res.summary.lower())

    def test_browser_candidates_model_mismatch_rejected(self):
        req = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title="Nothing Phone (2a) 5G (Black, 128 GB)",
            product_url="https://www.flipkart.com/nothing-phone-2a/p/itm12345",
            current_price=23999.0,
            variant="128 GB · Black",
            browser_candidate_offers=[{
                "retailer_name": "Amazon.in",
                "product_title": "Nothing Phone (1) 5G (Black, 128 GB)",
                "product_url": "https://www.amazon.in/dp/B0B1111111",
                "current_price": 19999.0,
                "retailer_product_id": "B0B1111111",
                "availability": "IN_STOCK",
                "data_source": "Amazon Browser Tab Search",
            }],
            browser_retrieval_status="found",
        )
        res = compare_prices(req)
        self.assertEqual(res.status, "no_offers_found")
        self.assertEqual(res.cross_platform_status, "all_candidates_rejected")
        self.assertEqual(res.verdict_label, "NO EXACT MATCH")
        self.assertEqual(len(res.verified_offers), 0)

    def test_browser_candidates_config_mismatch_rejected(self):
        req = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title="Apple iPhone 15 (Blue, 128 GB)",
            product_url="https://www.flipkart.com/iphone-15/p/itm123",
            current_price=69999.0,
            variant="128 GB · Blue",
            browser_candidate_offers=[{
                "retailer_name": "Amazon.in",
                "product_title": "Apple iPhone 15 (Blue, 256 GB)",
                "product_url": "https://www.amazon.in/dp/B0CHX12345",
                "current_price": 64999.0,
                "retailer_product_id": "B0CHX12345",
                "availability": "IN_STOCK",
                "data_source": "Amazon Browser Tab Search",
            }],
            browser_retrieval_status="found",
        )
        res = compare_prices(req)
        self.assertEqual(res.status, "no_offers_found")
        self.assertEqual(res.cross_platform_status, "all_candidates_rejected")
        self.assertEqual(res.verdict_label, "NO EXACT MATCH")
        self.assertEqual(len(res.verified_offers), 0)

    def test_browser_retrieval_status_blocked_captcha(self):
        req = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title="Sony WH-1000XM5 Wireless Headphones",
            product_url="https://www.flipkart.com/sony-wh/p/itm123",
            current_price=29999.0,
            browser_candidate_offers=[],
            browser_retrieval_status="blocked",
            browser_status_reason="Amazon India displayed a CAPTCHA challenge in the browser tab.",
        )
        res = compare_prices(req)
        self.assertEqual(res.status, "no_offers_found")
        self.assertEqual(res.cross_platform_status, "retailer_unavailable")
        self.assertEqual(res.verdict_label, "AMAZON.IN UNAVAILABLE")
        self.assertIn("captcha", res.summary.lower())
        self.assertEqual(len(res.verified_offers), 0)

    def test_browser_retrieval_status_not_open(self):
        req = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title="Sony WH-1000XM5 Wireless Headphones",
            product_url="https://www.flipkart.com/sony-wh/p/itm123",
            current_price=29999.0,
            browser_candidate_offers=[],
            browser_retrieval_status="not_open",
            browser_status_reason="Amazon tab not open in browser. Open an Amazon search tab to compare live prices.",
        )
        res = compare_prices(req)
        self.assertEqual(res.status, "no_offers_found")
        self.assertEqual(res.cross_platform_status, "tab_not_open")
        self.assertEqual(res.verdict_label, "AMAZON.IN TAB NOT OPEN")
        self.assertEqual(len(res.verified_offers), 0)

    def test_browser_retrieval_status_empty_results(self):
        req = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title="Extremely Obscure Product XYZ 9999",
            product_url="https://www.flipkart.com/xyz/p/itm123",
            current_price=999.0,
            browser_candidate_offers=[],
            browser_retrieval_status="no_results",
        )
        res = compare_prices(req)
        self.assertEqual(res.status, "no_offers_found")
        self.assertEqual(res.cross_platform_status, "no_search_results")
        self.assertEqual(res.verdict_label, "NO RESULTS FOUND")
        self.assertEqual(len(res.verified_offers), 0)



# ===========================================================================
# Phase 7: Engineering Task 1 — Comprehensive Regression Tests (15 Scenarios)
# ===========================================================================

class CrossPlatformMatchingTask1RegressionTests(unittest.TestCase):
    """
    Automated regression suite verifying the 15 required cross-platform matching scenarios:
    1. Same model with different title wording.
    2. Same model with reordered title terms.
    3. Same model with compatible optional fields missing.
    4. Different model within the same product family.
    5. Incompatible storage or configuration.
    6. Different generation.
    7. Similar titles referring to different products (accessories/covers).
    8. Missing critical identity attributes.
    9. Indian currency and decimal price parsing.
    10. Duplicate cards deduplicated.
    11. Mixed valid and invalid candidates.
    12. Successful empty search.
    13. Listings retrieved but all rejected by the matcher.
    14. CAPTCHA and HTTP 503 status.
    15. Amazon tab missing or page still loading.
    """

    def setUp(self):
        self.fk_macbook_title = (
            "Apple MacBook Neo Apple A18 Pro - (8 GB/256 GB SSD/macOS) MHFA4HN/A  "
            "(13 Inch, Silver, 1.2 Kg)"
        )
        self.fk_url = "https://www.flipkart.com/apple-macbook-neo/p/itm12345"

    # 1. Same model with different title wording
    def test_01_same_model_different_title_wording(self):
        cand = "Apple MacBook Neo Laptop with A18 Pro chip: 13-inch Liquid Retina Display, 8GB Unified Memory, 256GB SSD Storage, Silver"
        status, reason, cat, _ = ProductMatcher.evaluate_match(self.fk_macbook_title, cand)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)

    # 2. Same model with reordered title terms
    def test_02_same_model_reordered_title_terms(self):
        cand = "Apple MacBook 13-inch Neo (8GB RAM, 256GB SSD, Silver)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(self.fk_macbook_title, cand)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)

    # 3. Same model with compatible optional fields missing (e.g. year, screen size omitted)
    def test_03_same_model_compatible_optional_fields_missing(self):
        src = "Apple MacBook Neo (13-inch, 8GB RAM, 256GB SSD, Silver)"
        cand = "Apple MacBook Neo 8GB RAM 256GB SSD - Silver"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)

    # 4. Different model within the same product family
    def test_04_different_model_within_same_product_family(self):
        cand_air = "Apple 2024 MacBook Air 13-inch with M3 chip (8GB Unified Memory, 256GB SSD, Silver)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(self.fk_macbook_title, cand_air)
        self.assertEqual(status, MatchStatus.MODEL_MISMATCH)
        self.assertEqual(cat, RejectionCategory.MODEL_MISMATCH)
        self.assertIn("Product family mismatch", reason)

    # 5. Incompatible storage or configuration
    def test_05_incompatible_storage_or_configuration(self):
        cand_512 = "Apple MacBook Neo (13-inch, Apple A18 Pro chip, 8GB RAM, 512GB SSD, Silver)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(self.fk_macbook_title, cand_512)
        self.assertEqual(status, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("Storage capacity mismatch", reason)

        cand_16gb = "Apple MacBook Neo (13-inch, Apple A18 Pro chip, 16GB RAM, 256GB SSD, Silver)"
        status2, reason2, cat2, _ = ProductMatcher.evaluate_match(self.fk_macbook_title, cand_16gb)
        self.assertEqual(status2, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat2, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("RAM capacity mismatch", reason2)

    # 6. Different generation
    def test_06_different_generation(self):
        src_ip15 = "Apple iPhone 15 (128 GB, Black)"
        cand_ip16 = "Apple iPhone 16 (128 GB, Black)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src_ip15, cand_ip16)
        self.assertEqual(status, MatchStatus.MODEL_MISMATCH)
        self.assertIn("mismatch", reason.lower())

        src_sony = "Sony WH-1000XM4 Wireless Noise Cancelling Headphones"
        cand_sony = "Sony WH-1000XM5 Wireless Noise Cancelling Headphones"
        status2, reason2, cat2, _ = ProductMatcher.evaluate_match(src_sony, cand_sony)
        self.assertEqual(status2, MatchStatus.MODEL_MISMATCH)

    # 7. Similar titles referring to different products (accessories/covers)
    def test_07_similar_titles_referring_to_different_products(self):
        cand_case = "Hard Case Cover for Apple MacBook Neo 13-inch (Clear)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(self.fk_macbook_title, cand_case)
        self.assertEqual(status, MatchStatus.MISMATCH)
        self.assertEqual(cat, RejectionCategory.ACCESSORY_OR_CONDITION)
        self.assertIn("accessory", reason.lower())

    # 8. Missing critical identity attributes
    def test_08_missing_critical_identity_attributes(self):
        cand_vague = "Fast Ultra-Thin Laptop with High Resolution Screen"
        status, reason, cat, _ = ProductMatcher.evaluate_match(self.fk_macbook_title, cand_vague)
        self.assertIn(status, (MatchStatus.INSUFFICIENT_DATA, MatchStatus.MODEL_MISMATCH))

    # 9. Indian currency and decimal price parsing
    def test_09_indian_currency_and_decimal_price_parsing(self):
        from app.matcher import normalize_title
        req = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title=self.fk_macbook_title,
            current_price=109990.50,
            url=self.fk_url,
            browser_retrieval_status="found",
            browser_candidate_offers=[
                {
                    "retailer_name": "Amazon.in",
                    "product_title": "Apple MacBook Neo (13-inch, Apple A18 Pro chip, 8GB RAM, 256GB SSD, Silver)",
                    "product_url": "https://www.amazon.in/dp/B0D1234567",
                    "current_price": 104990.25,
                    "mrp": 119990.00,
                    "currency": "INR",
                    "availability": "IN_STOCK",
                    "data_source": "Amazon Browser Tab Search"
                }
            ]
        )
        res = compare_prices(req)
        self.assertEqual(res.status, "success")
        self.assertEqual(res.lowest_price, 104990.25)
        self.assertEqual(res.source_product.current_site_price, 109990.50)

    # 10. Duplicate cards deduplicated
    def test_10_duplicate_cards_deduplicated(self):
        cand_item = {
            "retailer_name": "Amazon.in",
            "product_title": "Apple MacBook Neo (13-inch, Apple A18 Pro chip, 8GB RAM, 256GB SSD, Silver)",
            "product_url": "https://www.amazon.in/dp/B0D1234567",
            "retailer_product_id": "B0D1234567",
            "current_price": 104990.0,
            "mrp": 119990.0,
            "currency": "INR",
            "availability": "IN_STOCK",
            "data_source": "Amazon Browser Tab Search"
        }
        req = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title=self.fk_macbook_title,
            current_price=109990.0,
            url=self.fk_url,
            browser_retrieval_status="found",
            browser_candidate_offers=[cand_item, cand_item, cand_item]  # 3 duplicates
        )
        res = compare_prices(req)
        self.assertEqual(res.status, "success")
        self.assertEqual(len(res.verified_offers), 1)

    # 11. Mixed valid and invalid candidates
    def test_11_mixed_valid_and_invalid_candidates(self):
        req = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title=self.fk_macbook_title,
            current_price=109990.0,
            url=self.fk_url,
            browser_retrieval_status="found",
            browser_candidate_offers=[
                # Valid exact match
                {
                    "retailer_name": "Amazon.in",
                    "product_title": "Apple MacBook Neo (13-inch, Apple A18 Pro chip, 8GB RAM, 256GB SSD, Silver)",
                    "product_url": "https://www.amazon.in/dp/B0D1234567",
                    "retailer_product_id": "B0D1234567",
                    "current_price": 104990.0,
                    "availability": "IN_STOCK",
                },
                # Price failed
                {
                    "retailer_name": "Amazon.in",
                    "product_title": "Apple MacBook Neo (13-inch, Apple A18 Pro chip, 8GB RAM, 256GB SSD, Silver)",
                    "product_url": "https://www.amazon.in/dp/B0D9999999",
                    "current_price": -1.0,
                    "availability": "IN_STOCK",
                },
                # Model mismatch (Air)
                {
                    "retailer_name": "Amazon.in",
                    "product_title": "Apple MacBook Air M3 (8GB RAM, 256GB SSD)",
                    "product_url": "https://www.amazon.in/dp/B0D8888888",
                    "current_price": 99990.0,
                    "availability": "IN_STOCK",
                },
                # Storage mismatch (512GB)
                {
                    "retailer_name": "Amazon.in",
                    "product_title": "Apple MacBook Neo (13-inch, Apple A18 Pro chip, 8GB RAM, 512GB SSD, Silver)",
                    "product_url": "https://www.amazon.in/dp/B0D7777777",
                    "current_price": 124990.0,
                    "availability": "IN_STOCK",
                },
            ]
        )
        res = compare_prices(req)
        self.assertEqual(res.status, "success")
        self.assertEqual(len(res.verified_offers), 1)
        self.assertEqual(res.verified_offers[0].retailer_product_id, "B0D1234567")
        sd = res.structured_diagnostics
        self.assertEqual(sd.matching.exact_match_count, 1)
        self.assertEqual(sd.matching.rejected_count, 3)

    # 12. Successful empty search
    def test_12_successful_empty_search(self):
        req = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title="Extremely Obscure Product 12345678",
            current_price=1000.0,
            url="https://www.flipkart.com/obscure/p/itm999",
            browser_retrieval_status="no_results",
            browser_candidate_offers=[],
        )
        res = compare_prices(req)
        self.assertEqual(res.status, "no_offers_found")
        self.assertEqual(res.cross_platform_status, "no_search_results")
        self.assertEqual(len(res.verified_offers), 0)
        sd = res.structured_diagnostics
        self.assertEqual(sd.failure_classification.retrieval_outcome, "SEARCH_PAGE_EMPTY")
        self.assertEqual(sd.failure_classification.overall_classification, "Retrieval succeeded, no relevant matches")

    # 13. Listings retrieved but all rejected by the matcher
    def test_13_listings_retrieved_all_rejected_by_matcher(self):
        # 29 MacBook Air/Pro candidates returned for MacBook Neo source
        req = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title=self.fk_macbook_title,
            current_price=109990.0,
            url=self.fk_url,
            browser_retrieval_status="found",
            browser_candidate_offers=[
                {
                    "retailer_name": "Amazon.in",
                    "product_title": f"Apple 2024 MacBook Air 13-inch Laptop with M3 chip {i}",
                    "product_url": f"https://www.amazon.in/dp/B0D{i:07d}",
                    "retailer_product_id": f"B0D{i:07d}",
                    "current_price": 104990.0,
                    "mrp": 114990.0,
                    "currency": "INR",
                    "availability": "IN_STOCK",
                    "data_source": "Amazon Browser Tab Search"
                }
                for i in range(29)
            ]
        )
        res = compare_prices(req)
        self.assertEqual(res.status, "no_offers_found")
        self.assertEqual(res.cross_platform_status, "all_candidates_rejected")
        self.assertEqual(len(res.verified_offers), 0)
        self.assertEqual(res.verdict_label, "NO EXACT MATCH")

        sd = res.structured_diagnostics
        # Critical assertion: must NEVER report matcher rejection as retrieval failure!
        self.assertEqual(sd.failure_classification.retrieval_outcome, "RETRIEVAL_SUCCEEDED")
        self.assertEqual(sd.failure_classification.matching_outcome, "CANDIDATES_REJECTED_BY_MATCHER")
        self.assertEqual(sd.failure_classification.overall_classification, "Retrieval succeeded, candidates rejected by matching")
        self.assertEqual(sd.matching.rejected_count, 29)
        self.assertEqual(sd.matching.exact_match_count, 0)

    # 14. CAPTCHA and HTTP 503 status
    def test_14_captcha_and_http_503_status(self):
        req = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title=self.fk_macbook_title,
            current_price=109990.0,
            url=self.fk_url,
            browser_retrieval_status="blocked",
            browser_status_reason="Amazon India displayed a CAPTCHA challenge in the browser tab.",
            browser_candidate_offers=[],
        )
        res = compare_prices(req)
        self.assertEqual(res.status, "no_offers_found")
        self.assertEqual(res.cross_platform_status, "retailer_unavailable")
        self.assertIn("UNAVAILABLE", res.verdict_label)
        sd = res.structured_diagnostics
        self.assertEqual(sd.failure_classification.retrieval_outcome, "AMAZON_ACCESS_BLOCKED")
        self.assertEqual(sd.failure_classification.matching_outcome, "NOT_EVALUATED")

    # 15. Amazon tab missing or page still loading
    def test_15_amazon_tab_missing_or_loading(self):
        req = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title=self.fk_macbook_title,
            current_price=109990.0,
            url=self.fk_url,
            browser_retrieval_status="not_open",
            browser_status_reason="Amazon tab not open in browser. Open an Amazon search tab to compare live prices.",
            browser_candidate_offers=[],
        )
        res = compare_prices(req)
        self.assertEqual(res.status, "no_offers_found")
        self.assertEqual(res.cross_platform_status, "tab_not_open")
        self.assertEqual(res.verdict_label, "AMAZON.IN TAB NOT OPEN")
        sd = res.structured_diagnostics
        self.assertEqual(sd.failure_classification.retrieval_outcome, "AMAZON_TAB_NOT_OPEN")
        self.assertEqual(sd.failure_classification.matching_outcome, "NOT_EVALUATED")



    # 16. Automatic Flipkart -> Amazon retrieval without requiring open tab or manual click
    def test_16_flipkart_to_amazon_automatic_retrieval(self):
        req = ComparePricesRequest(
            source_retailer="Flipkart",
            product_title="Sony WH-1000XM4 Wireless Noise Cancelling Headphones",
            current_price=24990.0,
            url="https://www.flipkart.com/sony-wh-1000xm4/p/itm123",
            # No browser_candidate_offers or browser_retrieval_status passed
        )
        res = compare_prices(req)
        # Verify Amazon was automatically queried
        self.assertIn("Amazon.in", res.retailers_queried)
        self.assertIsNotNone(res.cross_platform_status)
        self.assertNotEqual(res.cross_platform_status, "tab_not_open")
        self.assertNotEqual(res.verdict_label, "AMAZON.IN TAB NOT OPEN")

    # 17. Accessory safeguards: replacement ear pads, headbands, cases rejected
    def test_17_accessory_safeguards_rejection(self):
        source = "Sony WH-1000XM4 Wireless Noise Cancelling Headphones"
        accessories = [
            "SOULWIT Replacement Ear Pads for Sony WH-1000XM4 Headphones",
            "Replacement Headband Cushion for Sony WH-1000XM4",
            "Hard Travel Case for Sony WH-1000XM4 Noise Canceling Headphones",
            "Silicone Protective Cover for Sony WH-1000XM4 Ear Cups",
        ]
        for acc in accessories:
            status, reason, cat, vars = ProductMatcher.evaluate_match(source, acc)
            self.assertEqual(status, MatchStatus.MISMATCH, f"Failed to reject accessory: {acc}")
            self.assertEqual(cat, RejectionCategory.ACCESSORY_OR_CONDITION, f"Wrong rejection category for: {acc}")

    # 18. Amazon HTML Parser: Brand header + product title link assembly
    def test_18_amazon_html_parser_brand_prefix(self):
        sample_html = """
        <div data-asin="B0863TXGM3" class="s-result-item s-asin">
            <h2 class="a-size-mini s-line-clamp-1"><span class="a-size-medium a-color-base">Sony</span></h2>
            <a class="a-link-normal s-line-clamp-2 a-text-normal" href="/Sony-WH-1000XM4-Cancelling-Headphones-Mic/dp/B0863TXGM3">
                <span class="a-size-medium a-color-base a-text-normal">WH-1000XM4 Wireless Noise Cancelling Headphones with Mic (Black)</span>
            </a>
            <span class="a-price"><span class="a-offscreen">₹22,990.00</span></span>
            <span class="a-price a-text-price"><span class="a-offscreen">₹29,990.00</span></span>
        </div>
        """
        retriever = AmazonRetriever()
        parsed = retriever._parse_amazon_html(sample_html)
        self.assertEqual(len(parsed), 1)
        item = parsed[0]
        self.assertEqual(item["retailer_product_id"], "B0863TXGM3")
        self.assertTrue(item["product_title"].startswith("Sony WH-1000XM4"))
        self.assertEqual(item["current_price"], 22990.0)
        self.assertEqual(item["mrp"], 29990.0)

    # 19. Preserving Amazon -> Flipkart retrieval
    def test_19_amazon_to_flipkart_retrieval(self):
        req = ComparePricesRequest(
            source_retailer="Amazon.in",
            product_title="Sony WH-1000XM4 Wireless Noise Cancelling Headphones",
            current_price=22990.0,
            url="https://www.amazon.in/dp/B0863TXGM3",
        )
        res = compare_prices(req)
        self.assertIn("Flipkart", res.retailers_queried)
        self.assertIsNotNone(res.cross_platform_status)


    # 20. SerpApi Google Shopping Response Parsing & Normalization
    def test_20_serpapi_response_parsing_and_normalization(self):
        sample_payload = {
            "search_metadata": {
                "status": "Success",
                "google_shopping_url": "https://www.google.co.in/search?tbm=shop&q=cosmic+byte+blitz"
            },
            "shopping_results": [
                {
                    "position": 1,
                    "title": "Cosmic Byte Blitz Wireless Gamepad for PC (Black)",
                    "link": "https://www.google.co.in/url?url=https://www.amazon.in/Cosmic-Byte-Wireless-Controller-Black/dp/B09XYZ1234&rct=j&q=test",
                    "source": "Amazon.in - Appario Retail",
                    "price": "₹1,499.00",
                    "extracted_price": 1499.0,
                    "extracted_old_price": 1999.0,
                    "thumbnail": "https://encrypted-tbn3.gstatic.com/shopping?q=tbn:sample1",
                    "delivery": "Free delivery"
                },
                {
                    "position": 2,
                    "title": "Cosmic Byte Blitz Wireless Gamepad",
                    "link": "https://www.flipkart.com/cosmic-byte-blitz/p/itm12345?pid=CBBLITZ123",
                    "source": "Flipkart - RetailNet",
                    "price": "₹1,449.00",
                    "extracted_price": 1449.0,
                    "thumbnail": "https://encrypted-tbn3.gstatic.com/shopping?q=tbn:sample2"
                },
                {
                    "position": 3,
                    "title": "Cosmic Byte Blitz Gamepad on Croma",
                    "link": "https://www.croma.com/cosmic-byte-blitz/p/234",
                    "source": "Croma",
                    "extracted_price": 1599.0
                },
                {
                    "position": 4,
                    "title": "Cosmic Byte Blitz No Price",
                    "link": "https://www.amazon.in/dp/B000000000",
                    "source": "Amazon.in",
                    "extracted_price": None,
                    "price": None
                }
            ]
        }

        retriever = SerpApiGoogleShoppingRetriever()
        offers = retriever.parse_shopping_results(sample_payload)

        # Invariant 1: Only Amazon.in and Flipkart are included; Croma and price-less items are discarded
        self.assertEqual(len(offers), 2)

        # Invariant 2: Amazon.in offer is normalized with direct URL and extracted seller
        amz_offer = [o for o in offers if o["retailer_name"] == "Amazon.in"][0]
        self.assertEqual(amz_offer["product_title"], "Cosmic Byte Blitz Wireless Gamepad for PC (Black)")
        self.assertEqual(amz_offer["current_price"], 1499.0)
        self.assertEqual(amz_offer["mrp"], 1999.0)
        self.assertEqual(amz_offer["product_url"], "https://www.amazon.in/dp/B09XYZ1234")
        self.assertEqual(amz_offer["seller_name"], "Appario Retail")
        self.assertEqual(amz_offer["retailer_product_id"], "B09XYZ1234")
        self.assertEqual(amz_offer["data_source"], "SerpApi Google Shopping (India)")

        # Invariant 3: Flipkart offer is normalized with PID and seller
        fk_offer = [o for o in offers if o["retailer_name"] == "Flipkart"][0]
        self.assertEqual(fk_offer["product_title"], "Cosmic Byte Blitz Wireless Gamepad")
        self.assertEqual(fk_offer["current_price"], 1449.0)
        self.assertEqual(fk_offer["seller_name"], "RetailNet")
        self.assertEqual(fk_offer["retailer_product_id"], "CBBLITZ123")
        self.assertEqual(fk_offer["data_source"], "SerpApi Google Shopping (India)")

    # 21. SerpApi Retailer Identification & Platform Separation
    def test_21_serpapi_retailer_identification(self):
        # Must identify Amazon.in and Flipkart
        r1, s1 = SerpApiGoogleShoppingRetriever.identify_retailer_and_seller("Amazon.in", "https://www.amazon.in/dp/B0863TXGM3")
        self.assertEqual(r1, "Amazon.in")
        self.assertIsNone(s1)

        r2, s2 = SerpApiGoogleShoppingRetriever.identify_retailer_and_seller("Amazon.in - Clicktech", "https://www.amazon.in/dp/B0863TXGM3")
        self.assertEqual(r2, "Amazon.in")
        self.assertEqual(s2, "Clicktech")

        r3, s3 = SerpApiGoogleShoppingRetriever.identify_retailer_and_seller("Flipkart", "https://www.flipkart.com/p/itm123")
        self.assertEqual(r3, "Flipkart")
        self.assertIsNone(s3)

        r4, s4 = SerpApiGoogleShoppingRetriever.identify_retailer_and_seller("Flipkart - SuperComNet", "https://www.flipkart.com/p/itm123")
        self.assertEqual(r4, "Flipkart")
        self.assertEqual(s4, "SuperComNet")

        # Must reject other stores per Requirement 7
        for other_source, other_url in [
            ("Croma", "https://www.croma.com/p/123"),
            ("Tata CLiQ", "https://www.tatacliq.com/p/456"),
            ("Reliance Digital", "https://www.reliancedigital.in/p/789"),
            ("The Cosmic Byte", "https://thecosmicbyte.com/products/blitz"),
            ("Myntra", "https://www.myntra.com/p/999"),
        ]:
            rx, sx = SerpApiGoogleShoppingRetriever.identify_retailer_and_seller(other_source, other_url)
            self.assertIsNone(rx, f"Failed to reject external retailer: {other_source}")

    # 22. SerpApi Missing Fields & Malformed Payload Safety
    def test_22_serpapi_missing_fields_safety(self):
        retriever = SerpApiGoogleShoppingRetriever()

        # Empty payload
        self.assertEqual(retriever.parse_shopping_results({}), [])
        self.assertEqual(retriever.parse_shopping_results({"shopping_results": None}), [])
        self.assertEqual(retriever.parse_shopping_results({"shopping_results": []}), [])

        # Item with missing / null fields
        malformed = {
            "shopping_results": [
                {"title": "", "price": "₹500", "source": "Amazon.in"},
                {"title": "Valid Title But Invalid Price", "price": "Free", "extracted_price": None, "source": "Amazon.in"},
                {"title": "Valid Title But Missing Source and URL", "price": "₹1,000"},
            ]
        }
        offers = retriever.parse_shopping_results(malformed)
        self.assertEqual(len(offers), 0)

    # 23. SerpApi API Error Handling and Fallback
    def test_23_serpapi_api_failures_and_fallback(self):
        import urllib.error
        retriever = SerpApiGoogleShoppingRetriever()

        # Simulate 401 Unauthorized
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.side_effect = urllib.error.HTTPError(
                url="https://serpapi.com/search.json",
                code=401,
                msg="Unauthorized",
                hdrs={},
                fp=None,
            )
            with patch.dict("os.environ", {"SERPAPI_API_KEY": "invalid_key"}):
                res = retriever.search("cosmic byte blitz")
                self.assertEqual(res, [])
                self.assertEqual(retriever.last_http_status, 401)
                self.assertIn("401", retriever.status_reason)

        # Simulate 429 Rate Limit
        with patch("urllib.request.urlopen") as mock_open:
            mock_open.side_effect = urllib.error.HTTPError(
                url="https://serpapi.com/search.json",
                code=429,
                msg="Too Many Requests",
                hdrs={},
                fp=None,
            )
            with patch.dict("os.environ", {"SERPAPI_API_KEY": "valid_key"}):
                res = retriever.search("cosmic byte blitz")
                self.assertEqual(res, [])
                self.assertEqual(retriever.last_http_status, 429)
                self.assertIn("429", retriever.status_reason)

        # Simulate Network Timeout -> Service cleanly falls back to direct retrieval
        service = OfferRetrievalService()
        with patch.object(service.serpapi_retriever, "search", side_effect=TimeoutError("Request timed out")):
            with patch.dict("os.environ", {"SERPAPI_API_KEY": "valid_key"}):
                # Request from Flipkart to Amazon: should fallback to Amazon direct search without crashing
                req = ComparePricesRequest(
                    source_retailer="Flipkart",
                    product_title="Cosmic Byte Blitz Wireless Gamepad",
                    current_price=1499.0,
                    url="https://www.flipkart.com/cosmic-byte-blitz/p/itm123",
                )
                res = compare_prices(req)
                self.assertIsNotNone(res)
                self.assertIn("Amazon.in", res.retailers_queried)

    # 24. Strict Product Identity: Controller Model Mismatch Safeguards
    def test_24_strict_controller_matching_safeguards(self):
        source = "Cosmic Byte Blitz Wireless Gamepad"

        # 1. Exact match
        same = "Cosmic Byte Blitz Wireless Gamepad for PC (Black)"
        status, reason, cat, vars = ProductMatcher.evaluate_match(source, same)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)

        # 2. Conflicting controller model line (Ares != Blitz)
        diff_model = "Cosmic Byte Ares Wireless Gamepad for PC"
        status, reason, cat, vars = ProductMatcher.evaluate_match(source, diff_model)
        self.assertEqual(status, MatchStatus.MISMATCH)
        self.assertEqual(cat, RejectionCategory.MODEL_MISMATCH)
        self.assertIn("mismatch", reason.lower())

        # 3. Conflicting connectivity (Wired != Wireless)
        diff_conn = "Cosmic Byte Blitz Wired Controller"
        status, reason, cat, vars = ProductMatcher.evaluate_match(source, diff_conn)
        self.assertEqual(status, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)

        # 4. Controller accessory (Silicone Cover Case != Controller)
        acc = "Cosmic Byte Controller Silicone Cover Case"
        status, reason, cat, vars = ProductMatcher.evaluate_match(source, acc)
        self.assertEqual(status, MatchStatus.MISMATCH)
        self.assertEqual(cat, RejectionCategory.ACCESSORY_OR_CONDITION)

        # 5. Generic brand listing without model line cannot be an exact match
        generic = "Cosmic Byte Wireless Game Controller for PC"
        status, reason, cat, vars = ProductMatcher.evaluate_match(source, generic)
        self.assertNotEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.MODEL_MISMATCH)
        self.assertEqual(status, MatchStatus.MISMATCH)

if __name__ == "__main__":
    unittest.main()

