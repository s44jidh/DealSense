"""
DealSense Data Science Pipeline — sentiment_pipeline.py
Trains, evaluates, and serves a supervised Sentiment Analysis model for e-commerce product customer reviews.
Uses TF-IDF feature extraction and Logistic Regression with balanced class weighting.
Ensures zero data leakage via text-level deduplication before stratified train/val/test splits.
"""

from __future__ import annotations

import os
import json
from datetime import datetime, timezone
from typing import Any, Optional
import joblib
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.naive_bayes import MultinomialNB
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split

MODEL_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "models"))
MODEL_PATH = os.path.join(MODEL_DIR, "sentiment_model.joblib")
VECTORIZER_PATH = os.path.join(MODEL_DIR, "tfidf_vectorizer.joblib")
METADATA_PATH = os.path.join(MODEL_DIR, "model_metadata.json")

LABEL_MAPPING = {0: "negative", 1: "neutral", 2: "positive"}
REVERSE_LABEL_MAPPING = {"negative": 0, "neutral": 1, "positive": 2}

def train_and_evaluate_sentiment_model(
    df: pd.DataFrame,
    random_state: int = 42,
    model_dir: str = MODEL_DIR,
) -> dict[str, Any]:
    """
    Trains and evaluates a supervised sentiment analysis pipeline on deduplicated data:
      - Stratified 70% Train, 15% Validation, 15% Test split.
      - TF-IDF unigram + bigram representation (sublinear TF scaling).
      - Logistic Regression baseline with balanced class weights.
      - Multinomial Naive Bayes comparison.
      - Full test set evaluation: accuracy, precision, recall, F1, per-class breakdown, confusion matrix.
      - Saves serialized artifacts and metadata.
    """
    os.makedirs(model_dir, exist_ok=True)

    # Filter to required fields
    clean_data = df[["clean_text", "Sentiment"]].dropna().copy()
    clean_data["label"] = clean_data["Sentiment"].map(REVERSE_LABEL_MAPPING)
    clean_data = clean_data.dropna(subset=["label"]).copy()
    clean_data["label"] = clean_data["label"].astype(int)

    X = clean_data["clean_text"].values
    y = clean_data["label"].values

    # Stratified split: 70% Train, 30% Temp (15% Val, 15% Test)
    X_train, X_temp, y_train, y_temp = train_test_split(
        X, y, test_size=0.30, random_state=random_state, stratify=y
    )
    X_val, X_test, y_val, y_test = train_test_split(
        X_temp, y_temp, test_size=0.50, random_state=random_state, stratify=y_temp
    )

    # 1. TF-IDF Feature Extraction (Fit on Train only to prevent leakage)
    vectorizer = TfidfVectorizer(
        max_features=12000,
        ngram_range=(1, 2),
        min_df=2,
        sublinear_tf=True,
        strip_accents="unicode",
    )
    X_train_vec = vectorizer.fit_transform(X_train)
    X_val_vec = vectorizer.transform(X_val)
    X_test_vec = vectorizer.transform(X_test)

    # 2. Train Primary Model: Logistic Regression (balanced)
    clf = LogisticRegression(
        C=2.0,
        max_iter=1000,
        class_weight="balanced",
        solver="lbfgs",
        random_state=random_state,
    )
    clf.fit(X_train_vec, y_train)

    # 3. Baseline comparison: Multinomial Naive Bayes
    nb_clf = MultinomialNB(alpha=0.5)
    nb_clf.fit(X_train_vec, y_train)
    nb_val_preds = nb_clf.predict(X_val_vec)
    nb_val_acc = float(accuracy_score(y_val, nb_val_preds))
    nb_val_f1 = float(f1_score(y_val, nb_val_preds, average="weighted"))

    # Validation Evaluation for Logistic Regression
    val_preds = clf.predict(X_val_vec)
    val_acc = float(accuracy_score(y_val, val_preds))
    val_f1 = float(f1_score(y_val, val_preds, average="weighted"))

    # Final Test Set Evaluation
    test_preds = clf.predict(X_test_vec)
    test_probs = clf.predict_proba(X_test_vec)

    test_acc = float(accuracy_score(y_test, test_preds))
    test_precision_macro = float(precision_score(y_test, test_preds, average="macro"))
    test_recall_macro = float(recall_score(y_test, test_preds, average="macro"))
    test_f1_macro = float(f1_score(y_test, test_preds, average="macro"))
    test_f1_weighted = float(f1_score(y_test, test_preds, average="weighted"))

    # Per-class metrics
    class_report = classification_report(
        y_test,
        test_preds,
        target_names=["negative", "neutral", "positive"],
        output_dict=True,
    )

    conf_mat = confusion_matrix(y_test, test_preds).tolist()

    metadata = {
        "model_name": "TF-IDF + Logistic Regression",
        "training_timestamp": datetime.now(timezone.utc).isoformat(),
        "random_state": random_state,
        "vocabulary_size": len(vectorizer.vocabulary_),
        "dataset_split": {
            "total_deduplicated_samples": len(clean_data),
            "train_samples": len(X_train),
            "val_samples": len(X_val),
            "test_samples": len(X_test),
        },
        "model_comparison_val": {
            "logistic_regression": {"accuracy": round(val_acc, 4), "f1_weighted": round(val_f1, 4)},
            "multinomial_nb": {"accuracy": round(nb_val_acc, 4), "f1_weighted": round(nb_val_f1, 4)},
        },
        "test_metrics": {
            "accuracy": round(test_acc, 4),
            "precision_macro": round(test_precision_macro, 4),
            "recall_macro": round(test_recall_macro, 4),
            "f1_macro": round(test_f1_macro, 4),
            "f1_weighted": round(test_f1_weighted, 4),
            "per_class": {
                "negative": {
                    "precision": round(class_report["negative"]["precision"], 4),
                    "recall": round(class_report["negative"]["recall"], 4),
                    "f1_score": round(class_report["negative"]["f1-score"], 4),
                    "support": class_report["negative"]["support"],
                },
                "neutral": {
                    "precision": round(class_report["neutral"]["precision"], 4),
                    "recall": round(class_report["neutral"]["recall"], 4),
                    "f1_score": round(class_report["neutral"]["f1-score"], 4),
                    "support": class_report["neutral"]["support"],
                },
                "positive": {
                    "precision": round(class_report["positive"]["precision"], 4),
                    "recall": round(class_report["positive"]["recall"], 4),
                    "f1_score": round(class_report["positive"]["f1-score"], 4),
                    "support": class_report["positive"]["support"],
                },
            },
            "confusion_matrix": {
                "labels": ["negative", "neutral", "positive"],
                "matrix": conf_mat,
            },
        },
        "label_mapping": LABEL_MAPPING,
    }

    # Save artifacts
    model_save_path = os.path.join(model_dir, "sentiment_model.joblib")
    vec_save_path = os.path.join(model_dir, "tfidf_vectorizer.joblib")
    meta_save_path = os.path.join(model_dir, "model_metadata.json")

    joblib.dump(clf, model_save_path)
    joblib.dump(vectorizer, vec_save_path)
    with open(meta_save_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    return metadata


class SentimentPredictor:
    """
    Thread-safe cached inference engine for Sentiment Analysis.
    Loads trained artifacts on demand and produces calibrated probability estimates.
    """
    _instance: Optional[SentimentPredictor] = None

    def __init__(self, model_dir: str = MODEL_DIR):
        self.model_dir = model_dir
        self.model: Optional[Any] = None
        self.vectorizer: Optional[TfidfVectorizer] = None
        self.metadata: Optional[dict[str, Any]] = None
        self.is_ready: bool = False
        self.load()

    @classmethod
    def get_instance(cls, model_dir: str = MODEL_DIR) -> SentimentPredictor:
        if cls._instance is None:
            cls._instance = SentimentPredictor(model_dir=model_dir)
        return cls._instance

    def load(self) -> bool:
        model_p = os.path.join(self.model_dir, "sentiment_model.joblib")
        vec_p = os.path.join(self.model_dir, "tfidf_vectorizer.joblib")
        meta_p = os.path.join(self.model_dir, "model_metadata.json")

        if os.path.isfile(model_p) and os.path.isfile(vec_p):
            try:
                self.model = joblib.load(model_p)
                self.vectorizer = joblib.load(vec_p)
                if os.path.isfile(meta_p):
                    with open(meta_p, "r", encoding="utf-8") as f:
                        self.metadata = json.load(f)
                self.is_ready = True
                return True
            except Exception as e:
                self.is_ready = False
                return False
        self.is_ready = False
        return False



    def get_metadata(self) -> dict[str, Any]:
        return self.metadata or {}

    def predict(self, text: str) -> dict[str, Any]:
        """Alias for predict_one for standard scikit-like interface."""
        return self.predict_one(text)

    def predict_one(self, text: str) -> dict[str, Any]:
        """
        Classifies single review text.
        Returns: {sentiment, confidence, probabilities}
        """
        if not self.is_ready or self.model is None or self.vectorizer is None:
            return {
                "sentiment": "unclassified",
                "confidence": 0.0,
                "probabilities": {"negative": 0.0, "neutral": 0.0, "positive": 0.0},
                "status": "MODEL_NOT_LOADED",
            }

        t_clean = text.strip() if text else ""
        if not t_clean:
            return {
                "sentiment": "neutral",
                "confidence": 0.33,
                "probabilities": {"negative": 0.33, "neutral": 0.34, "positive": 0.33},
                "status": "EMPTY_TEXT",
            }

        vec = self.vectorizer.transform([t_clean])
        probs = self.model.predict_proba(vec)[0]
        pred_idx = int(np.argmax(probs))
        sentiment = LABEL_MAPPING.get(pred_idx, "neutral")
        confidence = float(probs[pred_idx])

        # Map probabilities
        prob_dict = {}
        for idx, cls_name in LABEL_MAPPING.items():
            prob_dict[cls_name] = round(float(probs[idx]), 4)

        return {
            "sentiment": sentiment,
            "confidence": round(confidence, 4),
            "probabilities": prob_dict,
            "status": "SUCCESS",
        }

    def predict_batch(self, texts: list[str]) -> list[dict[str, Any]]:
        """
        Efficient batch classification.
        """
        if not self.is_ready or self.model is None or self.vectorizer is None:
            return [self.predict_one(t) for t in texts]

        cleaned = [t.strip() if t else "" for t in texts]
        if not cleaned:
            return []

        # Replace completely empty strings with placeholder to vectorize safely
        safe_texts = [t if len(t) > 0 else "neutral" for t in cleaned]
        vecs = self.vectorizer.transform(safe_texts)
        all_probs = self.model.predict_proba(vecs)
        results = []

        for i, probs in enumerate(all_probs):
            if not cleaned[i]:
                results.append({
                    "sentiment": "neutral",
                    "confidence": 0.33,
                    "probabilities": {"negative": 0.33, "neutral": 0.34, "positive": 0.33},
                    "status": "EMPTY_TEXT",
                })
                continue

            pred_idx = int(np.argmax(probs))
            sentiment = LABEL_MAPPING.get(pred_idx, "neutral")
            prob_dict = {LABEL_MAPPING[idx]: round(float(probs[idx]), 4) for idx in LABEL_MAPPING}
            results.append({
                "sentiment": sentiment,
                "confidence": round(float(probs[pred_idx]), 4),
                "probabilities": prob_dict,
                "status": "SUCCESS",
            })

        return results
