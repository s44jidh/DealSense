"""
DealSense Test Suite — Universal Product Extraction and Matching Tests
Verifies category-diverse product extraction, query construction, deterministic matching,
fail-closed variant differentiation, and brand-alone safeguards across:
  - Kitchen & Home Appliances (kettles, air fryers, mixer grinders)
  - Footwear & Shoes (sneakers, running shoes, clogs)
  - Clothing & Apparel (jeans, polo t-shirts)
  - Personal Care & Grooming (trimmers, shavers)
  - Toys & Games (Lego sets)
  - Watches & Wearables (analog, digital, G-Shock)
  - Bags & Luggage (backpacks)
"""

import unittest
from unittest.mock import patch

from app.matcher import MatchStatus, ProductMatcher, RejectionCategory
from app.models import ComparePricesRequest
from app.retrieval import BaseRetriever, OfferRetrievalService
from app.main import compare_prices


class MockRetriever(BaseRetriever):
    def __init__(self, name: str, domain: str, offers: list[dict], http_status: int = 200):
        self.name = name
        self.domain = domain
        self.is_enabled = True
        self.status_reason = "Mock Retriever Active"
        self._offers = offers
        self.last_http_status = http_status
        self.last_raw_count = len(offers)
        self.last_parsed_count = len(offers)

    def search(self, query: str, timeout: float = 6.0) -> list[dict]:
        return self._offers


class UniversalProductExtractionTests(unittest.TestCase):
    """Verifies structured attribute extraction on diverse non-tech products."""

    def test_kitchen_kettle_extraction(self):
        title = "Prestige PKOSS 1.5 Litre Electric Kettle (Stainless Steel)"
        specs = ProductMatcher.extract_specs(title)
        self.assertEqual(specs.brand, "prestige")
        self.assertIn("pkoss", specs.generic_model.lower())
        self.assertEqual(specs.volume_capacity, "1.5L")
        self.assertEqual(specs.category, "kitchen_home")

    def test_kitchen_air_fryer_extraction(self):
        title = "Philips HD9200/90 Air Fryer (4.1 Litre, Rapid Air Technology)"
        specs = ProductMatcher.extract_specs(title)
        self.assertEqual(specs.brand, "philips")
        self.assertEqual(specs.generic_model, "hd9200/90")
        self.assertEqual(specs.volume_capacity, "4.1L")
        self.assertEqual(specs.category, "kitchen_home")

    def test_kitchen_mixer_grinder_power_extraction(self):
        title = "Bajaj Rex 500W Mixer Grinder with 3 Jars (White)"
        specs = ProductMatcher.extract_specs(title)
        self.assertEqual(specs.brand, "bajaj")
        self.assertEqual(specs.power_wattage, "500W")
        self.assertEqual(specs.category, "kitchen_home")

    def test_footwear_sneakers_and_size_extraction(self):
        title = "Puma Smash v2 Leather Casual Sneakers - UK 9 (Black)"
        specs = ProductMatcher.extract_specs(title)
        self.assertEqual(specs.brand, "puma")
        self.assertEqual(specs.generic_model, "smash v2")
        self.assertEqual(specs.apparel_size, "UK 9")
        self.assertEqual(specs.category, "footwear")
        self.assertEqual(specs.color, "black")

    def test_footwear_crocs_clogs_extraction(self):
        title = "Crocs Classic Unisex Clogs - Navy (Size UK 8)"
        specs = ProductMatcher.extract_specs(title)
        self.assertEqual(specs.brand, "crocs")
        self.assertEqual(specs.apparel_size, "UK 8")
        self.assertEqual(specs.category, "footwear")

    def test_clothing_levis_jeans_extraction(self):
        title = "Levi's Men's 511 Slim Fit Jeans (32W, Dark Indigo)"
        specs = ProductMatcher.extract_specs(title)
        self.assertIn("levi", specs.brand)
        self.assertEqual(specs.generic_model, "511")
        self.assertEqual(specs.apparel_size, "32W")
        self.assertEqual(specs.category, "clothing")

    def test_clothing_polo_letter_size_extraction(self):
        title = "U.S. Polo Assn. Men Solid Cotton Polo T-Shirt (Size XL, Blue)"
        specs = ProductMatcher.extract_specs(title)
        self.assertIn("polo", specs.brand)
        self.assertEqual(specs.apparel_size, "XL")
        self.assertEqual(specs.category, "clothing")
        self.assertEqual(specs.color, "blue")

    def test_personal_care_trimmer_extraction(self):
        title = "Philips QT4011/15 Corded & Cordless Titanium Blade Beard Trimmer"
        specs = ProductMatcher.extract_specs(title)
        self.assertEqual(specs.brand, "philips")
        self.assertEqual(specs.generic_model, "qt4011/15")
        self.assertEqual(specs.category, "personal_care")

    def test_toys_lego_brick_box_extraction(self):
        title = "LEGO Classic Large Creative Brick Box 10698 Building Blocks Set"
        specs = ProductMatcher.extract_specs(title)
        self.assertEqual(specs.brand, "lego")
        self.assertEqual(specs.generic_model, "10698")
        self.assertEqual(specs.category, "toys_games")

    def test_watches_casio_vintage_extraction(self):
        title = "Casio Vintage Series Digital Dial Unisex Watch - A158WA-1DF"
        specs = ProductMatcher.extract_specs(title)
        self.assertEqual(specs.brand, "casio")
        self.assertIn("a158wa", specs.generic_model)
        self.assertEqual(specs.category, "watches")

    def test_watches_gshock_extraction(self):
        title = "Casio G-Shock Carbon Core Guard Analog-Digital Watch GA-2100-1A1DR"
        specs = ProductMatcher.extract_specs(title)
        self.assertEqual(specs.brand, "casio")
        self.assertIn("ga-2100", specs.generic_model)
        self.assertEqual(specs.category, "watches")

    def test_bags_american_tourister_backpack_extraction(self):
        title = "American Tourister 32L Casual Backpack with Rain Cover (Teal)"
        specs = ProductMatcher.extract_specs(title)
        self.assertEqual(specs.brand, "american tourister")
        self.assertEqual(specs.volume_capacity, "32L")
        self.assertEqual(specs.category, "bags_luggage")
        self.assertEqual(specs.color, "teal")


class UniversalDeterministicMatchingTests(unittest.TestCase):
    """Verifies fail-closed exact matching across diverse product categories."""

    # 1. Exact Matches across diverse categories
    def test_exact_match_prestige_kettle(self):
        src = "Prestige PKOSS 1.5 Litre Electric Kettle - Stainless Steel"
        cand = "Prestige PKOSS 1.5 L Electric Kettle (Silver)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)

    def test_exact_match_philips_air_fryer(self):
        src = "Philips HD9200/90 Air Fryer (4.1 L, Rapid Air Technology)"
        cand = "Philips HD9200 4.1 Litre Air Fryer (Black)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)

    def test_exact_match_puma_smash_sneakers(self):
        src = "Puma Smash v2 Leather Sneakers - UK 8 (White)"
        cand = "Puma Unisex Smash v2 Sneakers (White, UK 8)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)

    def test_exact_match_levis_511_jeans(self):
        src = "Levi's Men's 511 Slim Fit Jeans (32W, Blue)"
        cand = "Levi's 511 Slim Fit Denim Jeans (Waist 32, Blue)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)

    def test_exact_match_lego_set(self):
        src = "LEGO Classic 10698 Large Creative Brick Box (790 Pieces)"
        cand = "Lego 10698 Classic Creative Brick Building Blocks Set"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)

    def test_exact_match_casio_watch(self):
        src = "Casio GA-2100-1A1DR G-Shock Analog-Digital Watch (Black)"
        cand = "Casio G-Shock GA-2100 Black Dial Watch for Men"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.EXACT_MATCH)
        self.assertEqual(cat, RejectionCategory.VALID_MATCH)

    # 2. Configuration & Variant Mismatches
    def test_kettle_capacity_mismatch(self):
        src = "Prestige PKOSS 1.5 Litre Electric Kettle"
        cand = "Prestige PKOSS 1.8 Litre Electric Kettle"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("Capacity mismatch", reason)

    def test_mixer_grinder_power_mismatch(self):
        src = "Bajaj Rex 500W Mixer Grinder with 3 Jars"
        cand = "Bajaj Rex 750W Mixer Grinder with 3 Jars"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("Power/Wattage mismatch", reason)

    def test_footwear_size_mismatch(self):
        src = "Puma Smash v2 Sneakers - UK 8"
        cand = "Puma Smash v2 Sneakers - UK 9"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("Size mismatch", reason)

    def test_clothing_waist_size_mismatch(self):
        src = "Levi's 511 Slim Fit Jeans (32W)"
        cand = "Levi's 511 Slim Fit Jeans (34W)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("Size mismatch", reason)

    def test_clothing_letter_size_mismatch(self):
        src = "U.S. Polo Assn. Solid Polo T-Shirt (Size M)"
        cand = "U.S. Polo Assn. Solid Polo T-Shirt (Size XL)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("Size mismatch", reason)

    def test_pack_count_mismatch(self):
        src = "Cello Butterflow Ball Pen (Pack of 1)"
        cand = "Cello Butterflow Ball Pen (Pack of 5)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.CONFIGURATION_MISMATCH)
        self.assertEqual(cat, RejectionCategory.CONFIG_MISMATCH)
        self.assertIn("Pack count", reason)

    # 3. Model Mismatches
    def test_levis_model_mismatch(self):
        src = "Levi's 511 Slim Fit Jeans (32W)"
        cand = "Levi's 512 Slim Tapered Jeans (32W)"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.MODEL_MISMATCH)
        self.assertEqual(cat, RejectionCategory.MODEL_MISMATCH)
        self.assertIn("model mismatch", reason.lower())

    def test_philips_air_fryer_model_mismatch(self):
        src = "Philips HD9200/90 Air Fryer"
        cand = "Philips HD9252/90 Digital Air Fryer"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.MODEL_MISMATCH)
        self.assertEqual(cat, RejectionCategory.MODEL_MISMATCH)
        self.assertIn("model mismatch", reason.lower())

    def test_lego_model_mismatch(self):
        src = "LEGO Classic Large Creative Brick Box 10698"
        cand = "LEGO Classic Medium Creative Brick Box 10696"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.MODEL_MISMATCH)
        self.assertEqual(cat, RejectionCategory.MODEL_MISMATCH)
        self.assertIn("model mismatch", reason.lower())

    def test_casio_watch_model_mismatch(self):
        src = "Casio G-Shock GA-2100 Watch"
        cand = "Casio G-Shock GA-110 Watch"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.MODEL_MISMATCH)
        self.assertEqual(cat, RejectionCategory.MODEL_MISMATCH)

    # 4. Brand-alone safeguard: Never declare exact match on brand alone
    def test_generic_brand_alone_safeguard_kettle(self):
        src = "Prestige Electric Kettle"
        cand = "Prestige Stainless Steel Kettle"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.POSSIBLE_MATCH)
        self.assertEqual(cat, RejectionCategory.UNVERIFIED_VARIANT)
        self.assertIn("cannot confirm exact match based on brand alone", reason)

    def test_generic_brand_alone_safeguard_shoes(self):
        src = "Puma Running Shoes"
        cand = "Puma Sports Shoes"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.POSSIBLE_MATCH)
        self.assertEqual(cat, RejectionCategory.UNVERIFIED_VARIANT)
        self.assertIn("cannot confirm exact match based on brand alone", reason)

    # 5. Unverified Variant when key spec is omitted in candidate
    def test_unverified_variant_omitted_capacity(self):
        src = "Prestige PKOSS 1.5 Litre Electric Kettle"
        cand = "Prestige PKOSS Electric Kettle"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.POSSIBLE_MATCH)
        self.assertEqual(cat, RejectionCategory.UNVERIFIED_VARIANT)
        self.assertIn("Capacity unverified", reason)

    def test_unverified_variant_omitted_size(self):
        src = "Puma Smash v2 Leather Sneakers - UK 8"
        cand = "Puma Smash v2 Leather Sneakers"
        status, reason, cat, _ = ProductMatcher.evaluate_match(src, cand)
        self.assertEqual(status, MatchStatus.POSSIBLE_MATCH)
        self.assertEqual(cat, RejectionCategory.UNVERIFIED_VARIANT)
        self.assertIn("Size unverified", reason)


class UniversalQueryBuildingTests(unittest.TestCase):
    """Verifies clean search query formatting for non-tech categories."""

    def setUp(self):
        self.service = OfferRetrievalService(retrievers=[])

    def test_kettle_search_query(self):
        title = "Prestige PKOSS 1.5 Litre Electric Kettle (Stainless Steel)"
        q = self.service.build_search_query(title)
        self.assertIn("Prestige", q)
        self.assertIn("PKOSS", q)
        self.assertIn("1.5L", q)
        self.assertIn("Kettle", q)

    def test_footwear_search_query(self):
        title = "Puma Smash v2 Leather Casual Sneakers - UK 9 (Black)"
        q = self.service.build_search_query(title)
        self.assertIn("Puma", q)
        self.assertIn("Smash V2", q)
        self.assertIn("Sneakers", q)

    def test_clothing_search_query(self):
        title = "Levi's Men's 511 Slim Fit Jeans (32W, Dark Indigo)"
        q = self.service.build_search_query(title)
        self.assertIn("Levi'S", q)
        self.assertIn("511", q)
        self.assertIn("Jeans", q)

    def test_trimmer_search_query(self):
        title = "Philips QT4011/15 Corded & Cordless Titanium Blade Beard Trimmer"
        q = self.service.build_search_query(title)
        self.assertIn("Philips", q)
        self.assertIn("QT4011", q)
        self.assertIn("Trimmer", q)

    def test_backpack_search_query(self):
        title = "American Tourister 32L Casual Backpack with Rain Cover"
        q = self.service.build_search_query(title)
        self.assertIn("American Tourister", q)
        self.assertIn("32L", q)
        self.assertIn("Backpack", q)


class UniversalComparePricesIntegrationTest(unittest.TestCase):
    """Verifies end-to-end price comparison on non-tech products with mocked retailer."""

    def test_compare_prices_prestige_kettle(self):
        req = ComparePricesRequest(
            url="https://www.amazon.in/dp/B07585P6K9",
            product_name="Prestige PKOSS 1.5 Litre Electric Kettle (Stainless Steel)",
            current_site_price=899.0,
            mrp=1195.0,
            source_retailer="Amazon.in",
            category="kitchen_home",
            brand="Prestige",
            model="PKOSS 1.5",
        )
        fk_offers = [
            {
                "retailer_name": "Flipkart",
                "product_title": "Prestige PKOSS 1.5 L Electric Kettle (Silver)",
                "product_url": "https://www.flipkart.com/prestige-pkoss-1-5-l-electric-kettle/p/itm123",
                "current_price": 849.0,
                "mrp": 1195.0,
                "availability": "IN_STOCK",
            },
            {
                "retailer_name": "Flipkart",
                "product_title": "Prestige PKOSS 1.8 L Electric Kettle (Silver)",
                "product_url": "https://www.flipkart.com/prestige-pkoss-1-8-l-electric-kettle/p/itm456",
                "current_price": 999.0,
                "mrp": 1395.0,
                "availability": "IN_STOCK",
            }
        ]
        amz_retriever = MockRetriever(name="Amazon.in", domain="amazon.in", offers=[])
        fk_retriever = MockRetriever(name="Flipkart", domain="flipkart.com", offers=fk_offers)

        service = OfferRetrievalService(retrievers=[amz_retriever, fk_retriever])
        with patch("app.main.retrieval_service", service):
            res = compare_prices(req)
            self.assertEqual(res.status, "success")
            self.assertEqual(len(res.verified_offers), 1)
            verified = res.verified_offers[0]
            self.assertEqual(verified.retailer_name, "Flipkart")
            self.assertEqual(verified.current_price, 849.0)
            self.assertEqual(verified.match_status, "EXACT_MATCH")
            self.assertIn("PKOSS 1.5 L", verified.product_title)
            # The 1.8L should be rejected as CONFIGURATION_MISMATCH
            self.assertEqual(res.lowest_price, 849.0)
            self.assertEqual(res.lowest_price_retailer, "Flipkart")


if __name__ == "__main__":
    unittest.main()
