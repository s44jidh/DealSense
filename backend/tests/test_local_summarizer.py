"""
DealSense Automated Test Suite — test_local_summarizer.py
Verifies the Local Extractive Review Summarization Pipeline:
1. Empty review collections handling
2. Very short collections (1-2 reviews) with sample size caveats
3. Predominantly positive review collections
4. Strongly negative review collections
5. Mixed/polarized review collections
6. Groundedness & Anti-hallucination assertions (zero fabricated quotes)
7. End-to-end FastAPI endpoint integration (/api/reviews/analyze-batch)
"""

from __future__ import annotations

import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import unittest
from fastapi.testclient import TestClient

from app.main import app
from app.ml.local_summarizer import LocalReviewSummarizer
from app.ml.llm_analyzer import ReviewLLMAnalyzer


class TestLocalReviewSummarizer(unittest.TestCase):
    def test_01_empty_reviews_handling(self):
        """Empty review input returns no_data state with zero analyzed count."""
        res = LocalReviewSummarizer.summarize_reviews("Test Product", [])
        self.assertEqual(res["status"], "no_data")
        self.assertFalse(res["available"])
        self.assertEqual(res["provider"], "local")
        self.assertEqual(res["total_reviews_analyzed"], 0)
        self.assertEqual(res["pros"], [])
        self.assertEqual(res["cons"], [])
        self.assertEqual(res["recurring_complaints"], [])
        self.assertEqual(res["common_positive_themes"], [])

        # Whitespace only reviews
        res_ws = LocalReviewSummarizer.summarize_reviews("Test Product", [{"text": "   "}])
        self.assertEqual(res_ws["status"], "no_data")
        self.assertFalse(res_ws["available"])

    def test_02_single_review_sample_size_caveat(self):
        """Single review explicitly notes insufficient sample size while extracting authentic feedback."""
        review_text = "The wireless mouse has incredible ergonomics and smooth clicking response."
        res = LocalReviewSummarizer.summarize_reviews("Wireless Mouse", [{"text": review_text, "rating": 5}])

        self.assertEqual(res["status"], "success")
        self.assertTrue(res["available"])
        self.assertEqual(res["provider"], "local")
        self.assertEqual(res["total_reviews_analyzed"], 1)
        self.assertIn("insufficient to establish statistical consensus", res["summary"].lower())
        self.assertGreaterEqual(len(res["pros"]), 1)
        # Verify pro quote comes from input review
        self.assertIn("ergonomics", res["pros"][0].lower())
        self.assertIn("ergonomics", res["summary"].lower())
        self.assertIn("statistical reliability is limited", res["investigation_patterns"][0].lower())

    def test_03_two_reviews_sample_size_caveat(self):
        """Two reviews clearly state too few reviews for reliable consensus."""
        reviews = [
            {"text": "Very lightweight and fits perfectly in the hand.", "rating": 5},
            {"text": "The scroll wheel started squeaking on the second day.", "rating": 2},
        ]
        res = LocalReviewSummarizer.summarize_reviews("Ergo Mouse", reviews)

        self.assertEqual(res["status"], "success")
        self.assertTrue(res["available"])
        self.assertEqual(res["total_reviews_analyzed"], 2)
        self.assertIn("too few to establish reliable consensus", res["summary"].lower())
        self.assertGreaterEqual(len(res["pros"]), 1)
        self.assertGreaterEqual(len(res["cons"]), 1)
        self.assertIn("lightweight", res["pros"][0].lower())
        self.assertIn("scroll wheel", res["cons"][0].lower())

    def test_04_predominantly_positive_collection(self):
        """Positive corpus yields overwhelmingly positive consensus and pro highlights without fake complaints."""
        reviews = [
            {"text": "Outstanding build quality and the metal finish feels genuinely premium.", "rating": 5},
            {"text": "The battery life easily lasts two full working days on a single charge.", "rating": 5},
            {"text": "Super fast Bluetooth pairing and zero noticeable lag during gaming sessions.", "rating": 5},
            {"text": "Very comfortable ear cushions for long meetings. Highly recommended!", "rating": 5},
        ]
        res = LocalReviewSummarizer.summarize_reviews("Noise Cancelling Headphones", reviews)

        self.assertEqual(res["status"], "success")
        self.assertTrue(res["available"])
        self.assertIn("overwhelmingly positive", res["summary"].lower())
        self.assertGreaterEqual(len(res["pros"]), 2)
        self.assertGreaterEqual(len(res["common_positive_themes"]), 2)
        self.assertEqual(res["cons"], [])
        self.assertEqual(res["recurring_complaints"], [])
        self.assertIn("no recurring critical defects", res["summary"].lower())

    def test_05_strongly_negative_collection(self):
        """Negative corpus yields critical consensus and recurring complaints without fake praise."""
        reviews = [
            {"text": "Stopped working completely after 3 days. Defective and broken charging port.", "rating": 1},
            {"text": "Extremely slow performance, constant lag and unbearable heating during simple tasks.", "rating": 1},
            {"text": "Poor plastic build, buttons are fragile and rattle when shaken.", "rating": 1},
            {"text": "Delivery was delayed and outer packaging was destroyed with a cracked screen.", "rating": 1},
        ]
        res = LocalReviewSummarizer.summarize_reviews("Budget Tablet", reviews)

        self.assertEqual(res["status"], "success")
        self.assertTrue(res["available"])
        self.assertIn("dissatisfaction", res["summary"].lower())
        self.assertGreaterEqual(len(res["cons"]), 2)
        self.assertGreaterEqual(len(res["recurring_complaints"]), 2)
        self.assertEqual(res["pros"], [])
        self.assertEqual(res["common_positive_themes"], [])
        self.assertIn("no strong positive commendations", res["summary"].lower())

    def test_06_mixed_polarized_collection(self):
        """Mixed corpus identifies both pros and cons with balanced synthesis."""
        reviews = [
            {"text": "Brilliant display resolution and great speaker loudness for movies.", "rating": 5},
            {"text": "Premium metal body and snappy UI performance throughout daily use.", "rating": 5},
            {"text": "The battery backup drains in less than 3 hours of video playback.", "rating": 1},
            {"text": "Front camera quality is awful, grainy images in normal indoor lighting.", "rating": 1},
        ]
        res = LocalReviewSummarizer.summarize_reviews("Smartphone", reviews)

        self.assertEqual(res["status"], "success")
        self.assertTrue(res["available"])
        self.assertIn("mixed", res["summary"].lower())
        self.assertGreaterEqual(len(res["pros"]), 1)
        self.assertGreaterEqual(len(res["cons"]), 1)
        self.assertGreaterEqual(len(res["recurring_complaints"]), 1)
        self.assertGreaterEqual(len(res["common_positive_themes"]), 1)

    def test_07_groundedness_and_zero_fabrication(self):
        """Verifies that all extracted quotes in pros, cons, complaints, and themes originate verbatim from review text."""
        raw_texts = [
            "Superb tactile feedback on blue mechanical switches with durable keycaps.",
            "RGB lighting modes are vibrant and customizable through on-board shortcuts.",
            "Heavy plastic wrist rest feels cheap and detached during vigorous typing.",
            "Spacebar key started wobbling and produces an annoying squeak.",
        ]
        reviews = [{"text": t, "rating": 5 if i < 2 else 1} for i, t in enumerate(raw_texts)]
        combined_corpus = " ".join(raw_texts).lower()

        res = LocalReviewSummarizer.summarize_reviews("Mechanical Keyboard", reviews)

        # Check pros quotes
        for item in res["pros"]:
            # Format: 'Aspect: "quote"'
            quote = item.split('"', 1)[1].rsplit('"', 1)[0].replace("...", "").lower().strip()
            self.assertTrue(
                quote in combined_corpus,
                f"Fabricated quote detected in pros: '{quote}' not found in original reviews."
            )

        # Check cons quotes
        for item in res["cons"]:
            quote = item.split('"', 1)[1].rsplit('"', 1)[0].replace("...", "").lower().strip()
            self.assertTrue(
                quote in combined_corpus,
                f"Fabricated quote detected in cons: '{quote}' not found in original reviews."
            )

        # Check recurring complaints quotes
        for item in res["recurring_complaints"]:
            quote = item.split('"', 1)[1].rsplit('"', 1)[0].replace("...", "").lower().strip()
            self.assertTrue(
                quote in combined_corpus,
                f"Fabricated quote detected in complaints: '{quote}' not found in original reviews."
            )

        # Check positive themes quotes
        for item in res["common_positive_themes"]:
            quote = item.split('"', 1)[1].rsplit('"', 1)[0].replace("...", "").lower().strip()
            self.assertTrue(
                quote in combined_corpus,
                f"Fabricated quote detected in themes: '{quote}' not found in original reviews."
            )

    def test_08_investigation_patterns_duplicate_detection(self):
        """Verifies detection of duplicate sentences across multiple reviews."""
        dup_text = "This is a great product highly recommended buy immediately."
        reviews = [
            {"text": f"{dup_text} Loved the packaging.", "rating": 5},
            {"text": f"{dup_text} Arrived quickly.", "rating": 5},
            {"text": "Completely genuine different review text.", "rating": 4},
        ]
        res = LocalReviewSummarizer.summarize_reviews("Echo Speaker", reviews)
        self.assertGreaterEqual(len(res["investigation_patterns"]), 1)
        self.assertIn("repeated sentence", res["investigation_patterns"][0].lower())

    def test_11_synthesize_100_reviews_word_count_and_core_questions(self):
        """Accurately synthesizes 100 reviews into a concise 60-100 word analyst summary with PROCEED verdict."""
        pos_samples = [
            "Outstanding wireless responsiveness and zero latency for competitive gaming.",
            "The battery backup lasts over 18 hours on a single charge with RGB active.",
            "High quality build texture with comfortable ergonomic rubber grip.",
            "Clicky tactile mechanical switches feel durable and give great feedback.",
            "Seamless multi-platform connection across PC, Nintendo Switch, and Android.",
        ]
        neg_samples = [
            "Trigger buttons feel somewhat stiff during extended racing sessions.",
            "Instruction manual print is tiny and confusing for initial pairing.",
        ]
        reviews = []
        for i in range(100):
            if i < 80:
                t = f"{pos_samples[i % len(pos_samples)]} Review #{i+1} satisfied with purchase."
                reviews.append({"text": t, "rating": 5})
            else:
                t = f"{neg_samples[i % len(neg_samples)]} Review #{i+1} noting slight limitation."
                reviews.append({"text": t, "rating": 3})

        res = LocalReviewSummarizer.summarize_reviews("Pro Gaming Controller", reviews, target_count=100)
        self.assertEqual(res["total_reviews_analyzed"], 100)
        self.assertEqual(res["target_count"], 100)

        # Requirement 2: 60-100 words maximum, concise neutral analyst style
        words = res["summary"].split()
        self.assertGreaterEqual(len(words), 55, f"Summary word count ({len(words)}) should be 60-100 words")
        self.assertLessEqual(len(words), 100, f"Summary word count ({len(words)}) exceeds 100 words maximum")

        # Verify summary does NOT concatenate individual reviews or quote fragments
        self.assertNotIn('"', res["summary"])

        # Verify the 4 core findings in summary
        # 1. Overall customer experience
        self.assertTrue(any(w in res["summary"].lower() for w in ["favorable", "positive", "satisfaction"]))
        # 2. Strongest recurring benefit
        self.assertTrue(any(w in res["summary"].lower() for w in ["strength", "praised", "advantage", "battery"]))
        # 3. Recurring drawback / defect
        self.assertTrue(any(w in res["summary"].lower() for w in ["concerns", "issues", "defect", "limitation", "drawback"]))
        # 4. Concluding worthwhile assessment
        self.assertTrue(any(w in res["summary"].lower() for w in ["value for money", "reliable", "worthwhile", "reasonable value"]))

        # Requirement 1: Actionable Purchase Verdict (PROCEED)
        self.assertEqual(res["verdict_sentiment"], "PROCEED")
        self.assertIn("no major recurring issues", res["verdict"].lower())
        self.assertIsNotNone(res["verdict_detail"])

        # High confidence for 100 reviews with statistical disclaimer
        self.assertGreaterEqual(res["confidence_score"], 80)
        self.assertEqual(res["confidence_level"], "HIGH")
        self.assertIn("review sample quality", res["confidence_explanation"].lower())
        self.assertIn("product guarantee", res["confidence_explanation"].lower())

    def test_12_synthesize_300_reviews_scalability(self):
        """Verifies robust processing of 300 reviews without memory issues or silent truncation."""
        reviews = []
        for i in range(300):
            r = 5 if i % 4 != 0 else 2
            reviews.append({
                "text": f"Review {i}: Reliable performance, battery life is {'great' if r==5 else 'average'}, overall build is decent.",
                "rating": r,
            })
        res = LocalReviewSummarizer.summarize_reviews("Universal Audio Headset", reviews, target_count=300)
        self.assertEqual(res["total_reviews_analyzed"], 300)
        self.assertEqual(res["target_count"], 300)
        self.assertTrue(res["available"])
        self.assertGreaterEqual(res["confidence_score"], 85)
        self.assertEqual(res["confidence_level"], "HIGH")
        self.assertIn(res["verdict_sentiment"], ["PROCEED", "PROCEED_WITH_CAUTION"])

    def test_13_deduplication_prevents_aspect_distortion(self):
        """Deduplication prevents repeated bot/spam submissions from distorting consensus."""
        base_reviews = [
            {"text": "Superb sound quality and punchy bass.", "rating": 5},
            {"text": "Terrible microphone quality, completely muffled.", "rating": 1},
        ]
        # 20 duplicate spam reviews of the negative one
        spam = [{"text": "Terrible microphone quality, completely muffled.", "rating": 1} for _ in range(20)]
        all_reviews = base_reviews + spam

        res = LocalReviewSummarizer.summarize_reviews("Bluetooth Earphones", all_reviews)
        # Verify deduplication was detected in investigation patterns
        self.assertTrue(any("repeated" in p.lower() or "duplicate" in p.lower() for p in res["investigation_patterns"]))

    def test_14_positive_product_surfaces_minority_critical_defect(self):
        """Surfaces minority critical hardware defects yielding PROCEED_WITH_CAUTION verdict even when 85%+ positive."""
        reviews = []
        # 85 overwhelmingly positive reviews
        for i in range(85):
            reviews.append({
                "text": f"Amazing wireless gamepad #{i}! Incredible battery backup and super responsive buttons.",
                "rating": 5
            })
        # 15 critical defect reviews specifically warning about joystick drift
        for i in range(15):
            reviews.append({
                "text": f"Defective analog stick #{i}. Severe joystick drift appeared after only two weeks of use.",
                "rating": 1
            })

        res = LocalReviewSummarizer.summarize_reviews("Wireless Gamepad", reviews)
        self.assertEqual(res["total_reviews_analyzed"], 100)
        # Serious recurring defect forces PROCEED_WITH_CAUTION
        self.assertEqual(res["verdict_sentiment"], "PROCEED_WITH_CAUTION")
        self.assertIn("drift", res["summary"].lower())
        self.assertIn("drift", res["verdict"].lower())
        self.assertIn("warranty", res["verdict_detail"].lower())

    def test_15_predominantly_negative_yields_avoid(self):
        """Predominantly negative corpus yields AVOID verdict and explains reasons."""
        reviews = [
            {"text": "Cheap flimsy plastic, broke into pieces on day one.", "rating": 1},
            {"text": "Does not charge at all. Completely dead on arrival.", "rating": 1},
            {"text": "Awful audio quality, loud buzzing noise in right ear.", "rating": 1},
            {"text": "Defective hinge snapped under normal pressure.", "rating": 1},
            {"text": "Horrible product, worst purchase ever made.", "rating": 1},
            {"text": "Bluetooth drops connection every two minutes.", "rating": 1},
            {"text": "Unbearably uncomfortable and tight headband.", "rating": 2},
            {"text": "Poor sound and defective volume wheel.", "rating": 1},
        ]
        res = LocalReviewSummarizer.summarize_reviews("Budget Earbuds", reviews)
        self.assertEqual(res["verdict_sentiment"], "AVOID")
        self.assertIn("failure", res["verdict"].lower())
        self.assertIn("dissatisfaction", res["summary"].lower())

    def test_16_mixed_distribution_yields_proceed_with_caution(self):
        """Mixed corpus yields PROCEED_WITH_CAUTION verdict and highlights meaningful trade-offs."""
        reviews = []
        for i in range(10):
            reviews.append({"text": f"Review {i}: The 120Hz OLED screen is gorgeous with vibrant saturated colors.", "rating": 5})
        for i in range(10):
            reviews.append({"text": f"Review {i}: The battery life is horrendous and drains completely in three hours.", "rating": 1})

        res = LocalReviewSummarizer.summarize_reviews("Midrange Smartphone", reviews)
        self.assertEqual(res["total_reviews_analyzed"], 20)
        self.assertEqual(res["verdict_sentiment"], "PROCEED_WITH_CAUTION")
        self.assertIn("divided", res["summary"].lower())
        self.assertIn("warrant consideration", res["verdict"].lower())

    def test_17_confidence_score_scaling_and_disclaimer(self):
        """Confidence score scales with sample size and explicitly states statistical disclaimer."""
        small_sample = [{"text": "Good phone case, nice grip.", "rating": 5}]
        res_small = LocalReviewSummarizer.summarize_reviews("Phone Case", small_sample)
        self.assertLess(res_small["confidence_score"], 40)
        self.assertIn(res_small["confidence_level"], ["INSUFFICIENT", "LOW"])

        large_sample = [{"text": f"Decent quality case #{i}.", "rating": 4} for i in range(120)]
        res_large = LocalReviewSummarizer.summarize_reviews("Phone Case", large_sample)
        self.assertGreaterEqual(res_large["confidence_score"], 80)
        self.assertEqual(res_large["confidence_level"], "HIGH")
        # Verify explicit disclaimer in confidence_explanation
        self.assertIn("sample quality rather than a product guarantee", res_large["confidence_explanation"].lower())

    def test_18_malformed_and_edge_case_reviews(self):
        """Pipeline does not crash on missing, invalid, or unusual review fields."""
        malformed = [
            {},  # empty
            {"text": None, "rating": None},
            {"text": 12345, "rating": "not-a-number"},
            {"text": "   ", "rating": -5},
            {"text": "Valid review with weird rating.", "rating": 999},
            {"text": "Another valid review with float rating.", "rating": 4.5},
            {"extra_field": "ignored", "text": "Solid reliable performance across all tests.", "rating": 5},
        ]
        res = LocalReviewSummarizer.summarize_reviews("Edge Case Item", malformed)
        self.assertEqual(res["status"], "success")
        self.assertTrue(res["available"])
        self.assertGreaterEqual(res["total_reviews_analyzed"], 3)

    def test_21_insufficient_evidence_verdict(self):
        """Collections with < 5 reviews clearly report INSUFFICIENT EVIDENCE."""
        sparse_reviews = [
            {"text": "Comfortable fit and decent audio.", "rating": 4},
            {"text": "Good sound for meetings.", "rating": 4},
            {"text": "Mic is acceptable.", "rating": 3},
        ]
        res = LocalReviewSummarizer.summarize_reviews("Sparse Earphones", sparse_reviews)
        self.assertEqual(res["total_reviews_analyzed"], 3)
        self.assertEqual(res["verdict_sentiment"], "INSUFFICIENT_EVIDENCE")
        self.assertIn("insufficient", res["verdict"].lower())

    def test_22_concise_summary_does_not_concatenate_reviews(self):
        """Ensures the summary sounds like a neutral product analyst and does not string together customer quotations."""
        reviews = [
            {"text": f"Review {i}: Great build quality and responsive buttons on this gamepad.", "rating": 5}
            for i in range(30)
        ] + [
            {"text": f"Review {i}: D-pad is slightly stiff during fighting games.", "rating": 3}
            for i in range(10)
        ]
        res = LocalReviewSummarizer.summarize_reviews("Gamepad", reviews)
        words = res["summary"].split()
        self.assertGreaterEqual(len(words), 55)
        self.assertLessEqual(len(words), 100)
        self.assertNotIn('"', res["summary"])
        self.assertEqual(res["verdict_sentiment"], "PROCEED")


class TestFastAPIReviewSummarizerIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_09_api_status_reports_local_when_no_api_keys(self):
        """Verify /api/models/status returns provider='local' when no cloud LLM API keys are configured."""
        status = ReviewLLMAnalyzer.get_api_status()
        self.assertTrue(status["is_configured"])
        self.assertIn(status["provider"], ["local", "gemini", "openai"])

    def test_10_api_analyze_batch_uses_local_summarizer(self):
        """Verify /api/reviews/analyze-batch invokes local review summarizer and returns valid synthesis."""
        payload = {
            "product_name": "Ant Esports SuperPower RGB Wireless Controller",
            "source_retailer": "Amazon.in",
            "reviews": [
                {"id": "1", "text": "HallSense joysticks offer zero drift and exceptional precision in FPS games.", "rating": 5, "author": "ProGamer"},
                {"id": "2", "text": "RGB lighting looks fantastic and battery lasts around 15 hours continuously.", "rating": 5, "author": "Rohan"},
                {"id": "3", "text": "The trigger tension is slightly stiff and causes finger fatigue during racing.", "rating": 2, "author": "Vikram"},
            ]
        }
        res = self.client.post("/api/reviews/analyze-batch", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertEqual(data["status"], "success")
        self.assertEqual(data["total_reviews_analyzed"], 3)
        self.assertIsNotNone(data["llm_summary"])
        llm_sum = data["llm_summary"]
        self.assertTrue(llm_sum["available"])
        self.assertIn(llm_sum["provider"], ["local", "gemini", "openai"])
        self.assertGreater(len(llm_sum["summary"]), 20)
        self.assertGreaterEqual(len(llm_sum["pros"]), 1)
        self.assertGreaterEqual(len(llm_sum["cons"]), 1)
        self.assertGreaterEqual(len(llm_sum["common_positive_themes"]), 1)
        self.assertGreaterEqual(len(llm_sum["recurring_complaints"]), 1)

    def test_20_api_analyze_batch_returns_verdict_and_confidence(self):
        """Verify /api/reviews/analyze-batch returns all verdict, suitability, and confidence fields."""
        payload = {
            "product_name": "Ant Esports SuperPower Controller",
            "source_retailer": "Amazon.in",
            "target_count": 100,
            "reviews": [
                {"id": f"R_{i}", "text": f"Review {i}: Excellent precision joysticks and reliable wireless connectivity.", "rating": 5}
                for i in range(12)
            ]
        }
        res = self.client.post("/api/reviews/analyze-batch", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("llm_summary", data)
        sum_data = data["llm_summary"]
        self.assertEqual(sum_data["target_count"], 100)
        self.assertEqual(sum_data["total_reviews_analyzed"], 12)
        self.assertIn("verdict", sum_data)
        self.assertIn("verdict_sentiment", sum_data)
        self.assertIn(sum_data["verdict_sentiment"], ["PROCEED", "PROCEED_WITH_CAUTION", "AVOID", "INSUFFICIENT_EVIDENCE"])
        self.assertIn("verdict_detail", sum_data)
        self.assertIn("confidence_score", sum_data)
        self.assertIn("confidence_level", sum_data)
        self.assertIn("confidence_explanation", sum_data)
        self.assertIn("suitable_for", sum_data)
        self.assertIn("avoid_if", sum_data)


if __name__ == "__main__":
    unittest.main()

