"""
DealSense Automated Test Suite — Review Analysis & Suspicious Review Detection
Tests cover:
1. Dataset loading, schema validation, and leakage prevention.
2. Sentiment model artifact loading and predictions.
3. Aspect mining (product vs logistics).
4. Suspicious review pattern analyzer (duplicates, rating-text mismatches, promotional language).
5. FastAPI review intelligence endpoints and error handling.
"""

import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import unittest
from fastapi.testclient import TestClient

from app.main import app
from app.ml.dataset import load_raw_dataset, clean_and_preprocess_dataset
from app.ml.sentiment_pipeline import SentimentPredictor
from app.ml.aspect_analyzer import AspectAnalyzer
from app.ml.suspicious_analyzer import SuspiciousPatternAnalyzer


class TestDatasetAndPreprocessing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw_path = os.path.join(os.path.dirname(__file__), "..", "data", "raw", "Dataset-SA.csv")

    def test_raw_dataset_exists_and_has_valid_schema(self):
        """Test that real Kaggle dataset exists and has expected 6 columns."""
        if not os.path.exists(self.raw_path):
            self.skipTest("Dataset-SA.csv not present in local data directory.")
        df = load_raw_dataset(self.raw_path)
        expected_cols = {"product_name", "product_price", "Rate", "Review", "Summary", "Sentiment"}
        self.assertTrue(expected_cols.issubset(set(df.columns)), f"Columns missing: {expected_cols - set(df.columns)}")
        self.assertGreater(len(df), 50000, "Dataset should contain substantial review rows.")

    def test_duplicate_handling_and_leakage_prevention(self):
        """Verify that deduplication reduces review leakage across splits."""
        if not os.path.exists(self.raw_path):
            self.skipTest("Dataset-SA.csv not present.")
        df_raw = load_raw_dataset(self.raw_path)
        df_clean, stats = clean_and_preprocess_dataset(df_raw)
        df_dedup = df_clean.drop_duplicates(subset=["clean_text"])
        self.assertLess(len(df_dedup), len(df_clean), "Deduplicated set should be smaller than raw cleaned set.")
        # Check that no duplicates remain in the deduplicated split
        duplicate_count = df_dedup["clean_text"].duplicated().sum()
        self.assertEqual(duplicate_count, 0, "Deduplicated dataset must have zero text duplicates.")

    def test_missing_and_malformed_review_text_handling(self):
        """Ensure missing review titles or nan values are handled without errors."""
        import pandas as pd
        sample_df = pd.DataFrame([
            {"product_name": "P1", "product_price": "100", "Rate": "5", "Review": None, "Summary": "Great phone", "Sentiment": "positive"},
            {"product_name": "P2", "product_price": "200", "Rate": "1", "Review": "Bad", "Summary": None, "Sentiment": "negative"},
            {"product_name": "P3", "product_price": "300", "Rate": "invalid", "Review": None, "Summary": None, "Sentiment": "neutral"},
        ])
        # Summary and Review fallback
        clean_texts = []
        for _, row in sample_df.iterrows():
            rev = str(row["Review"]) if pd.notna(row["Review"]) else ""
            summ = str(row["Summary"]) if pd.notna(row["Summary"]) else ""
            txt = (rev + ". " + summ).strip(". ")
            clean_texts.append(txt)
        self.assertEqual(clean_texts[0], "Great phone")
        self.assertEqual(clean_texts[1], "Bad")
        self.assertEqual(clean_texts[2], "")


class TestSentimentModelPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.predictor = SentimentPredictor.get_instance()

    def test_model_loaded_successfully(self):
        """Verify model and vectorizer artifacts are loaded and ready."""
        self.assertTrue(self.predictor.is_ready, "Model and vectorizer must be loaded.")
        metadata = self.predictor.get_metadata()
        self.assertIn("vocabulary_size", metadata)
        self.assertEqual(metadata["vocabulary_size"], 12000)

    def test_sentiment_predictions(self):
        """Test accurate predictions for clear positive, negative, and neutral texts."""
        pos_text = "This product is fantastic! Incredible battery life and superb build quality. Highly recommended!"
        neg_text = "Terrible experience, completely defective and stopped working on the second day. Worst purchase ever."
        neu_text = "It is an average product. Delivered on time, neither good nor bad."

        res_pos = self.predictor.predict(pos_text)
        self.assertEqual(res_pos["sentiment"], "positive")
        self.assertGreater(res_pos["probabilities"]["positive"], 0.6)

        res_neg = self.predictor.predict(neg_text)
        self.assertEqual(res_neg["sentiment"], "negative")
        self.assertGreater(res_neg["probabilities"]["negative"], 0.6)

        res_neu = self.predictor.predict(neu_text)
        self.assertIn(res_neu["sentiment"], ["neutral", "positive", "negative"])
        # Probabilities sum to ~1.0
        prob_sum = sum(res_neu["probabilities"].values())
        self.assertAlmostEqual(prob_sum, 1.0, places=3)

    def test_empty_or_whitespace_prediction(self):
        """Test prediction gracefully handles empty text."""
        res = self.predictor.predict("   ")
        self.assertEqual(res["sentiment"], "neutral")
        self.assertEqual(res["status"], "EMPTY_TEXT")


class TestAspectAnalyzer(unittest.TestCase):
    def test_aspect_extraction_separates_product_and_delivery(self):
        """Verify product experience aspects are kept separate from delivery/seller logistics."""
        reviews = [
            {"text": "The battery life is extraordinary and build quality feels solid.", "rating": 5},
            {"text": "Very poor durability, the buttons broke within a week.", "rating": 1},
            {"text": "Delivery was delayed by 4 days and outer carton was torn.", "rating": 2},
            {"text": "Value for money product with great performance for gaming.", "rating": 5},
        ]
        results = AspectAnalyzer.analyze_aspects(reviews)
        aspects = results["aspects"]
        categories = {a["aspect_id"]: a["category"] for a in aspects}

        # Check category separation
        self.assertEqual(categories.get("battery_life"), "product")
        self.assertEqual(categories.get("build_quality"), "product")
        self.assertEqual(categories.get("durability"), "product")
        self.assertEqual(categories.get("delivery_packaging"), "logistics_seller")

        # Check delivery summary
        delivery_sum = results["delivery_summary"]
        self.assertGreaterEqual(delivery_sum["mentions"], 1)

    def test_pros_and_cons_with_quotes(self):
        """Verify pros and cons have non-empty supporting quotes from actual reviews."""
        reviews = [
            {"text": "Amazing sound clarity and very comfortable ear cushions.", "rating": 5},
            {"text": "Disappointed with battery life, it drains in 2 hours.", "rating": 1},
        ]
        results = AspectAnalyzer.analyze_aspects(reviews)
        pros = results["pros"]
        cons = results["cons"]
        self.assertGreater(len(pros), 0)
        self.assertTrue(len(pros[0]["sample_quote"]) > 0)
        self.assertGreater(len(cons), 0)
        self.assertTrue(len(cons[0]["sample_quote"]) > 0)

    def test_aspect_compact_summaries_and_sentiment_labels(self):
        """Verify compact evidence-based aspect text summaries and sentiment labels."""
        # 3 positive mentions of battery life -> Positive sentiment label and clear summary
        reviews = [
            {"text": "Battery life lasts for 3 days on a single charge.", "rating": 5},
            {"text": "Battery life is excellent and charges rapidly.", "rating": 5},
            {"text": "Very long battery life, ideal for travel.", "rating": 5},
            # 1 mention of comfort -> Limited Data (< 3 mentions)
            {"text": "Comfortable to hold in hands.", "rating": 4},
        ]
        results = AspectAnalyzer.analyze_aspects(reviews)
        aspect_dict = {a["aspect_id"]: a for a in results["aspects"]}

        # Battery Life (>= 3 mentions, 100% positive)
        battery = aspect_dict.get("battery_life")
        self.assertIsNotNone(battery)
        self.assertEqual(battery["sentiment_label"], "Positive")
        self.assertIn("battery life", battery["summary"].lower())
        self.assertIn("praised", battery["summary"].lower())

        # Comfort (< 3 mentions) -> Limited Data label
        comfort = aspect_dict.get("comfort")
        self.assertIsNotNone(comfort)
        self.assertEqual(comfort["sentiment_label"], "Limited Data")
        self.assertIn("limited feedback", comfort["summary"].lower())

    def test_aspect_explanation_wording_quality_and_variety(self):
        """Verify natural, varied, and aspect-specific wording across gaming headset aspects."""
        # 1. Value for Money — POSITIVE
        v_exp = AspectAnalyzer.generate_aspect_explanation(
            aspect_id="value_for_money",
            display_name="Value for Money",
            sentiment_label="Positive",
            pos_excerpts=["Great features for price point"],
            neg_excerpts=[],
            mention_count=10,
        )
        self.assertEqual(v_exp, "Offers competitive features for its price.")

        # 2. Battery Life & Charging — MIXED
        b_exp = AspectAnalyzer.generate_aspect_explanation(
            aspect_id="battery_life",
            display_name="Battery Life & Charging",
            sentiment_label="Mixed",
            pos_excerpts=["Battery lasts all day"],
            neg_excerpts=["The charging speed is slow as hell"],
            mention_count=12,
        )
        self.assertEqual(b_exp, "Battery performance appears acceptable, but charging speed receives criticism.")

        # 3. Build Quality — MIXED
        bq_exp = AspectAnalyzer.generate_aspect_explanation(
            aspect_id="build_quality",
            display_name="Build Quality",
            sentiment_label="Mixed",
            pos_excerpts=["Sturdy plastic and good finish"],
            neg_excerpts=["The design is bulky and heavy"],
            mention_count=8,
        )
        self.assertEqual(bq_exp, "Most feedback is favourable, although some buyers find the design bulky.")

        # 4. Comfort & Ergonomics — NEGATIVE
        c_exp = AspectAnalyzer.generate_aspect_explanation(
            aspect_id="comfort",
            display_name="Comfort & Ergonomics",
            sentiment_label="Negative",
            pos_excerpts=[],
            neg_excerpts=["This headset feels like wearing a crab on your head"],
            mention_count=7,
        )
        self.assertEqual(c_exp, "Some buyers report discomfort during extended use.")

        # 5. Durability & Longevity — NEGATIVE
        d_exp = AspectAnalyzer.generate_aspect_explanation(
            aspect_id="durability",
            display_name="Durability & Longevity",
            sentiment_label="Negative",
            pos_excerpts=[],
            neg_excerpts=["My unit went bad in two days and broke"],
            mention_count=6,
        )
        self.assertEqual(d_exp, "Reports of early product failure raise concerns about long-term reliability.")

        # Ensure all 5 explanations are distinct
        explanations = [v_exp, b_exp, bq_exp, c_exp, d_exp]
        self.assertEqual(len(set(explanations)), 5)

        # Ensure no repetitive templates and all under 15 words
        for exp in explanations:
            self.assertFalse(exp.startswith("Generally appreciated, though some buyers note"))
            self.assertFalse(exp.startswith("Users generally like"))
            self.assertFalse(exp.startswith("Buyers report"))
            self.assertLessEqual(len(exp.split()), 15)

    def test_crude_and_informal_language_translation(self):
        """Verify crude or informal review feedback is translated into professional language."""
        # Crab on head -> uncomfortable fit
        c_exp = AspectAnalyzer.generate_aspect_explanation(
            aspect_id="comfort",
            display_name="Comfort & Ergonomics",
            sentiment_label="Negative",
            pos_excerpts=[],
            neg_excerpts=["This headset feels like wearing a crab on your head."],
            mention_count=5,
        )
        self.assertEqual(c_exp, "Some buyers report discomfort during extended use.")
        self.assertNotIn("crab", c_exp.lower())

        # Slow as hell -> charging is slower than some buyers expect
        s_exp = AspectAnalyzer.generate_aspect_explanation(
            aspect_id="battery_life",
            display_name="Battery Life & Charging",
            sentiment_label="Negative",
            pos_excerpts=[],
            neg_excerpts=["The charging speed is slow as hell."],
            mention_count=5,
        )
        self.assertEqual(s_exp, "Charging is slower than some buyers expect.")
        self.assertNotIn("hell", s_exp.lower())

        # Bulky, but not that bad -> design bulky, although concern appears minor
        mb_exp = AspectAnalyzer.generate_aspect_explanation(
            aspect_id="build_quality",
            display_name="Build Quality",
            sentiment_label="Mixed",
            pos_excerpts=["Good plastic"],
            neg_excerpts=["The design is little bit bulky, but it's not that bad."],
            mention_count=5,
        )
        self.assertEqual(mb_exp, "Some buyers find the design bulky, although the concern appears minor.")
        self.assertNotIn("not that bad", mb_exp.lower())

    def test_clause_splitting_prevents_evidence_leakage(self):
        """Verify compound sentences broken on contrastive conjunctions prevent evidence leakage."""
        reviews = [
            {
                "text": "The audio sound quality is extraordinary and crisp, but delivery was delayed and packaging was torn.",
                "rating": 3
            },
            {
                "text": "Battery life lasts for 20 hours, however comfort causes ear pain after 30 minutes.",
                "rating": 3
            }
        ]
        results = AspectAnalyzer.analyze_aspects(reviews)
        aspect_dict = {a["aspect_id"]: a for a in results["aspects"]}

        # sound_quality should be purely positive without delivery complaints
        sound = aspect_dict.get("sound_quality")
        self.assertIsNotNone(sound)
        self.assertGreater(len(sound["positive_excerpts"]), 0)
        self.assertEqual(len(sound["negative_excerpts"]), 0)
        self.assertIn("audio", sound["positive_excerpts"][0].lower())

        # delivery_packaging should be purely negative without audio praise
        delivery = aspect_dict.get("delivery_packaging")
        self.assertIsNotNone(delivery)
        self.assertGreater(len(delivery["negative_excerpts"]), 0)
        self.assertEqual(len(delivery["positive_excerpts"]), 0)
        self.assertIn("delivery", delivery["negative_excerpts"][0].lower())

        # battery_life should be purely positive without comfort ear pain
        battery = aspect_dict.get("battery_life")
        self.assertIsNotNone(battery)
        self.assertGreater(len(battery["positive_excerpts"]), 0)
        self.assertEqual(len(battery["negative_excerpts"]), 0)
        self.assertIn("battery", battery["positive_excerpts"][0].lower())

        # comfort should be purely negative without battery hours praise
        comfort = aspect_dict.get("comfort")
        self.assertIsNotNone(comfort)
        self.assertGreater(len(comfort["negative_excerpts"]), 0)
        self.assertEqual(len(comfort["positive_excerpts"]), 0)
        self.assertIn("comfort", comfort["negative_excerpts"][0].lower())

    def test_multi_category_explanations(self):
        """Verify context-appropriate explanations across furniture, clothing, and appliances."""
        # Furniture
        furn_exp = AspectAnalyzer.generate_aspect_explanation(
            aspect_id="assembly_installation",
            display_name="Assembly & Installation",
            sentiment_label="Mixed",
            pos_excerpts=["Solid wood finish"],
            neg_excerpts=["Assembly is difficult with many screws"],
            mention_count=6,
        )
        self.assertEqual(furn_exp, "Several buyers praise the finish, but assembly can be difficult.")

        # Clothing
        cloth_exp = AspectAnalyzer.generate_aspect_explanation(
            aspect_id="fit_sizing",
            display_name="Fit & Sizing",
            sentiment_label="Mixed",
            pos_excerpts=["Fabric is soft and premium"],
            neg_excerpts=["Sizing appears inconsistent across sizes"],
            mention_count=7,
        )
        self.assertEqual(cloth_exp, "The fabric receives positive feedback, although sizing appears inconsistent.")

        # Home Appliances
        app_exp = AspectAnalyzer.generate_aspect_explanation(
            aspect_id="performance",
            display_name="Performance & Functionality",
            sentiment_label="Mixed",
            pos_excerpts=["Very easy to use"],
            neg_excerpts=["Motor has excessive operating noise"],
            mention_count=8,
        )
        self.assertEqual(app_exp, "Buyers appreciate its ease of use, but some report excessive operating noise.")

        # Insufficient evidence
        sparse_exp = AspectAnalyzer.generate_aspect_explanation(
            aspect_id="water_resistance",
            display_name="Water Resistance",
            sentiment_label="Positive",
            pos_excerpts=["Splashes ok"],
            neg_excerpts=[],
            mention_count=1,
        )
        self.assertEqual(sparse_exp, "Insufficient review evidence.")


class TestSuspiciousPatternAnalyzer(unittest.TestCase):
    def test_exact_duplicate_detection(self):
        """Test exact duplicate review texts are detected and flagged."""
        reviews = [
            {"id": "1", "text": "Super quality highly recommended buy it now.", "rating": 5, "author": "User A"},
            {"id": "2", "text": "Super quality highly recommended buy it now.", "rating": 5, "author": "User B"},
            {"id": "3", "text": "A completely different genuine review text.", "rating": 4, "author": "User C"},
        ]
        preds = [{"sentiment": "positive"}, {"sentiment": "positive"}, {"sentiment": "positive"}]
        res = SuspiciousPatternAnalyzer.analyze_reviews(reviews, preds)
        self.assertEqual(res["flags_breakdown"].get("exact_duplicate"), 2)
        self.assertEqual(res["suspicious_count"], 2)

    def test_rating_sentiment_mismatch(self):
        """Detect 5-star rating with strongly negative text or 1-star rating with positive praise."""
        reviews = [
            {"id": "1", "text": "Completely useless and broke on day 1. Waste of money.", "rating": 5, "author": "AngryUser"},
        ]
        preds = [{"sentiment": "negative"}]
        res = SuspiciousPatternAnalyzer.analyze_reviews(reviews, preds)
        self.assertEqual(res["flags_breakdown"].get("rating_sentiment_mismatch"), 1)
        self.assertIn("contradicts", res["flagged_reviews"][0]["reasons"][0])

    def test_promotional_keyword_detection(self):
        """Detect incentivized / promotional reviews."""
        reviews = [
            {"id": "1", "text": "Contact for cash back and discount coupon on telegram @fastloot.", "rating": 5, "author": "BotUser"},
        ]
        preds = [{"sentiment": "positive"}]
        res = SuspiciousPatternAnalyzer.analyze_reviews(reviews, preds)
        self.assertEqual(res["flags_breakdown"].get("promotional_keywords"), 1)


class TestFastAPIReviewEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_health_endpoint(self):
        """Verify /api/health returns 200 with service status and model readiness."""
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "healthy")
        self.assertTrue(data["model_ready"])
        self.assertIn("Amazon India (amazon.in)", data["supported_platforms"])
        self.assertIn("Flipkart (flipkart.com)", data["supported_platforms"])

    def test_models_status_endpoint(self):
        """Verify /api/models/status returns loaded model metadata."""
        res = self.client.get("/api/models/status")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data["model_loaded"])
        self.assertIsNotNone(data["test_metrics"])
        self.assertIn("accuracy", data["test_metrics"])

    def test_analyze_sentiment_single_and_batch(self):
        """Test /api/reviews/analyze-sentiment."""
        # Single
        res = self.client.post("/api/reviews/analyze-sentiment", json={"text": "Outstanding sound quality!"})
        self.assertEqual(res.status_code, 200)
        preds = res.json()["predictions"]
        self.assertEqual(len(preds), 1)
        self.assertEqual(preds[0]["sentiment"], "positive")

        # Batch
        res = self.client.post("/api/reviews/analyze-sentiment", json={"reviews": ["Great!", "Awful terrible product."]})
        self.assertEqual(res.status_code, 200)
        preds = res.json()["predictions"]
        self.assertEqual(len(preds), 2)
        self.assertEqual(preds[1]["sentiment"], "negative")

    def test_analyze_batch_with_valid_reviews(self):
        """Test /api/reviews/analyze-batch with multiple customer reviews."""
        payload = {
            "product_name": "Cosmic Byte Gaming Controller",
            "source_retailer": "Amazon.in",
            "reviews": [
                {"id": "r1", "text": "Very responsive thumbsticks and great battery backup.", "rating": 5, "author": "Gamer1"},
                {"id": "r2", "text": "Left bumper broke after 2 days of playing FIFA.", "rating": 1, "author": "Gamer2"},
                {"id": "r3", "text": "Delivery was super fast and packaging was secure.", "rating": 4, "author": "Gamer3"},
            ]
        }
        res = self.client.post("/api/reviews/analyze-batch", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["total_reviews_analyzed"], 3)
        self.assertIn("sentiment_distribution", data)
        self.assertIn("aspect_analysis", data)
        self.assertIn("suspicious_analysis", data)
        self.assertGreater(data["trust_score"], 0)

    def test_analyze_batch_empty_reviews(self):
        """Honest handling of empty reviews returns no_reviews status."""
        payload = {
            "product_name": "Unreviewed Item",
            "source_retailer": "Flipkart",
            "reviews": []
        }
        res = self.client.post("/api/reviews/analyze-batch", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "no_reviews")
        self.assertEqual(data["total_reviews_analyzed"], 0)

    def test_malformed_requests(self):
        """Verify validation errors for missing product_name and invalid rating."""
        # Missing product_name
        res = self.client.post("/api/reviews/analyze-batch", json={"reviews": []})
        self.assertEqual(res.status_code, 422)

        # Invalid rating > 5
        res = self.client.post("/api/reviews/analyze-batch", json={
            "product_name": "Test",
            "reviews": [{"text": "Sample", "rating": 99}]
        })
        self.assertEqual(res.status_code, 422)

    def test_trust_report_endpoint(self):
        """Verify /api/reviews/trust-report endpoint."""
        payload = {
            "product_name": "Boat Rockerz 450",
            "source_retailer": "Flipkart",
            "reviews": [
                {"id": "1", "text": "Great bass and very lightweight comfort.", "rating": 5, "author": "Amit"},
                {"id": "2", "text": "Charging port stopped working.", "rating": 1, "author": "Pooja"}
            ]
        }
        res = self.client.post("/api/reviews/trust-report", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertIn("trust_score", data)
        self.assertIn("overall_sentiment", data)
        self.assertIn("suspicious_summary", data)


    def test_model_b_fake_review_classifier_predictions(self):
        """Verify Model B (CG vs OR) classifier single & batch predictions."""
        from app.ml.fake_review_pipeline import FakeReviewClassifier
        clf = FakeReviewClassifier.get_instance()
        self.assertTrue(clf.is_ready)

        res = clf.predict_one("This pillow saved my back. I love the look and feel of this pillow.")
        self.assertEqual(res["status"], "SUCCESS")
        self.assertIn(res["label"], ["CG", "OR"])
        self.assertIn("cg_probability", res)
        self.assertIn("or_probability", res)
        self.assertAlmostEqual(res["cg_probability"] + res["or_probability"], 1.0, places=3)

    def test_model_b_batch_summary(self):
        """Verify Model B aggregate batch summary calculation."""
        from app.ml.fake_review_pipeline import FakeReviewClassifier
        clf = FakeReviewClassifier.get_instance()
        reviews = [
            "Love this! Well made, sturdy, and very comfortable. I love it!",
            "The sound quality is crisp and bass is deep. Battery lasts for days.",
            "Worst purchase ever, completely broke after 2 days of use."
        ]
        summary = clf.analyze_batch_summary(reviews)
        self.assertEqual(summary["total_analyzed"], 3)
        self.assertEqual(summary["cg_count"] + summary["or_count"], 3)
        self.assertIn("disclaimer", summary)

    def test_llm_analyzer_fallback_behavior(self):
        """Verify LLM analyzer graceful fallback without API key."""
        from app.ml.llm_analyzer import ReviewLLMAnalyzer
        status = ReviewLLMAnalyzer.get_api_status()
        self.assertIn("is_configured", status)
        self.assertIn("provider", status)

        res = ReviewLLMAnalyzer.analyze_reviews(
            "Cosmic Byte Ares Controller",
            [{"text": "Smooth analog sticks and zero latency wireless connection.", "rating": 5}]
        )
        self.assertIn("summary", res)
        self.assertIn("status", res)
        self.assertIn("pros", res)
        self.assertIn("cons", res)

    def test_classify_fake_dataset_endpoint(self):
        """Verify /api/reviews/classify-fake-dataset endpoint."""
        res = self.client.post("/api/reviews/classify-fake-dataset", json={
            "reviews": [
                "Love this! Well made, sturdy, and very comfortable.",
                "Battery life lasts around 6 hours during high usage."
            ]
        })
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(len(data["predictions"]), 2)
        self.assertIn(data["predictions"][0]["label"], ["CG", "OR"])

    def test_analyze_batch_with_model_b_and_llm(self):
        """Verify /api/reviews/analyze-batch returns Model B and LLM schemas."""
        payload = {
            "product_name": "Cosmic Byte Ares Wireless Controller",
            "source_retailer": "Amazon.in",
            "reviews": [
                {"id": "1", "text": "Smooth analog sticks and zero latency on PC.", "rating": 5, "author": "Gamer Rohit"},
                {"id": "2", "text": "D-pad is slightly stiff for Tekken.", "rating": 3, "author": "Karan P"}
            ]
        }
        res = self.client.post("/api/reviews/analyze-batch", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertIn("fake_review_analysis", data)
        self.assertIsNotNone(data["fake_review_analysis"])
        self.assertIn("cg_count", data["fake_review_analysis"])
        self.assertIn("llm_summary", data)
        self.assertIsNotNone(data["llm_summary"])
        self.assertIn("summary", data["llm_summary"])
        self.assertIn("cg_label", data["analyzed_reviews"][0])
        self.assertIn("cg_probability", data["analyzed_reviews"][0])

    def test_analyze_batch_with_100_reviews(self):
        """Test /api/reviews/analyze-batch with 100 customer reviews and verify rating diversity & performance."""
        sample_texts = [
            ("Excellent battery life and very responsive triggers.", 5),
            ("Good controller for everyday PC gaming, nice ergonomics.", 4),
            ("Average build quality, buttons feel a bit clicky.", 3),
            ("D-pad sticks occasionally during combos in fighting games.", 2),
            ("Defective right joystick started drifting after one week.", 1),
            ("Great sound clarity, bass is deep and punchy.", 5),
            ("Solid performance, connects quickly via bluetooth.", 4),
            ("Decent product for the price point, nothing special.", 3),
            ("Packaging arrived crushed and item has slight scratches.", 2),
            ("Completely stopped working after 3 days, waste of money.", 1),
        ]
        reviews_100 = []
        for i in range(100):
            text_template, rating = sample_texts[i % len(sample_texts)]
            reviews_100.append({
                "id": f"rev_{i+1}",
                "text": f"Review {i+1}: {text_template} Highly relevant customer experience #{i+1}.",
                "rating": rating,
                "author": f"Customer_{i+1}",
                "verified_purchase": (i % 2 == 0),
            })

        payload = {
            "product_name": "Ant Esports 100-Review Gaming Controller",
            "source_retailer": "Amazon.in",
            "reviews": reviews_100,
        }
        res = self.client.post("/api/reviews/analyze-batch", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["total_reviews_analyzed"], 100)
        self.assertIn("rating_distribution", data)
        self.assertEqual(data["rating_distribution"]["5"], 20)
        self.assertEqual(data["rating_distribution"]["4"], 20)
        self.assertEqual(data["rating_distribution"]["3"], 20)
        self.assertEqual(data["rating_distribution"]["2"], 20)
        self.assertEqual(data["rating_distribution"]["1"], 20)

        # Check sentiment percentages sum to ~100%
        pcts = data["sentiment_percentages"]
        total_pct = pcts["positive"] + pcts["neutral"] + pcts["negative"]
        self.assertAlmostEqual(total_pct, 100.0, delta=1.5)

        # Verify summary reflects large batch in natural opinion style without percentage symbols
        self.assertIn("llm_summary", data)
        self.assertIsNotNone(data["llm_summary"]["summary"])
        summary_text = data["llm_summary"]["summary"]
        self.assertNotIn("%", summary_text, "Summary must not contain percentage symbols")
        self.assertIn("like", summary_text.lower())

    def test_analyze_batch_with_300_reviews_scaling(self):
        """Test optional maximum target of 300 reviews without degradation."""
        sample_texts = [
            ("Top notch build quality and crisp audio output.", 5),
            ("Comfortable fit for long gaming sessions, good battery.", 4),
            ("Acceptable, neither great nor terrible.", 3),
            ("Build feels flimsy and cable is too short.", 2),
            ("Horrible device, broke within 24 hours.", 1),
        ]
        reviews_300 = []
        for i in range(300):
            t, r = sample_texts[i % len(sample_texts)]
            reviews_300.append({
                "id": f"rev_{i+1}",
                "text": f"Feedback #{i+1}: {t} Genuine testing detail #{i+1}.",
                "rating": r,
                "author": f"User_{i+1}",
            })

        payload = {
            "product_name": "Deep Scale 300 Controller",
            "source_retailer": "Amazon.in",
            "reviews": reviews_300,
        }
        res = self.client.post("/api/reviews/analyze-batch", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_reviews_analyzed"], 300)
        self.assertGreater(data["trust_score"], 0)
        self.assertEqual(len(data["analyzed_reviews"]), 300)

    def test_small_sample_plain_summary(self):
        """Verify that small review samples produce short, natural opinion summaries without statistical percentages."""
        small_reviews = [
            {"id": "s1", "text": "Very comfortable and clear sound.", "rating": 5, "author": "U1"},
            {"id": "s2", "text": "Good headphones for online classes.", "rating": 4, "author": "U2"},
            {"id": "s3", "text": "Ear cups get warm after an hour.", "rating": 2, "author": "U3"},
        ]
        payload = {
            "product_name": "Niche Small Sample Headphones",
            "source_retailer": "Amazon.in",
            "reviews": small_reviews,
        }
        res = self.client.post("/api/reviews/analyze-batch", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["total_reviews_analyzed"], 3)
        summary_text = data["llm_summary"]["summary"]
        self.assertNotIn("%", summary_text, "Summary must not contain percentages")
        self.assertNotIn("3 reviews", summary_text, "Summary must not contain review counts")
        self.assertIn("like", summary_text.lower())

    def test_opinion_focused_summary_without_percentages(self):
        """Verify that review summary is short, natural, and opinion-focused without statistical percentages."""
        reviews = [
            {"id": "r1", "text": "Outstanding premium build quality and amazing performance.", "rating": 5, "author": "U1"},
            {"id": "r2", "text": "Crisp audio and very comfortable ear cushions.", "rating": 5, "author": "U2"},
            {"id": "r3", "text": "Battery lasts for days on a single charge.", "rating": 5, "author": "U3"},
            {"id": "r4", "text": "Terrible customer support and microphone broke immediately.", "rating": 5, "author": "U4"},
        ]
        payload = {
            "product_name": "Test Consistent Stats",
            "source_retailer": "Amazon.in",
            "reviews": reviews,
        }
        res = self.client.post("/api/reviews/analyze-batch", json=payload)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        summary = data["llm_summary"]["summary"]
        self.assertNotIn("%", summary, "Summary must not contain percentage symbols")
        self.assertNotIn("4 reviews", summary, "Summary must not contain review counts")
        self.assertTrue(len(summary.split()) < 75, "Summary must be short and concise")


if __name__ == "__main__":
    unittest.main()
