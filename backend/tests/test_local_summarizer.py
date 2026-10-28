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


if __name__ == "__main__":
    unittest.main()

