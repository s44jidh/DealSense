"""
DealSense ML — fake_review_pipeline.py
Model B: Dataset-based Review Classification (CG vs OR).
Trains a TF-IDF + Logistic Regression baseline using the Kaggle Fake Reviews dataset.
Labels:
  CG = Computer-Generated review
  OR = Original review
"""

import os
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional, Dict, List

import joblib
import numpy as np
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split

logger = logging.getLogger('dealsense.fake_review_ml')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_CSV_PATH = os.path.join(BASE_DIR, 'data', 'raw', 'fake reviews dataset.csv')
DEFAULT_MODEL_DIR = os.path.join(BASE_DIR, 'models')

LABEL_MAP = {
    'CG': 'Computer-Generated (CG)',
    'OR': 'Original (OR)',
}


def train_fake_review_model(
    csv_path: str = DEFAULT_CSV_PATH,
    model_dir: str = DEFAULT_MODEL_DIR,
    random_state: int = 42,
    max_features: int = 15000,
) -> Dict[str, Any]:
    """
    Trains TF-IDF + Logistic Regression on the fake reviews dataset with stratified split.
    Saves model artifacts and returns comprehensive evaluation metrics.
    """
    if not os.path.isfile(csv_path):
        alt_path = os.path.join(BASE_DIR, 'data', 'raw', 'fake_reviews_dataset.csv')
        if os.path.isfile(alt_path):
            csv_path = alt_path
        else:
            raise FileNotFoundError(f'Fake reviews dataset not found at {csv_path}')

    os.makedirs(model_dir, exist_ok=True)
    df = pd.read_csv(csv_path)
    df = df.dropna(subset=['text_', 'label']).reset_index(drop=True)

    X = df['text_'].astype(str)
    y = df['label'].astype(str)

    # Stratified 80/20 train/test split to prevent leakage
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=random_state, stratify=y
    )

    vectorizer = TfidfVectorizer(
        max_features=max_features,
        ngram_range=(1, 2),
        sublinear_tf=True,
        min_df=2,
    )
    X_train_vec = vectorizer.fit_transform(X_train)
    X_test_vec = vectorizer.transform(X_test)

    clf = LogisticRegression(max_iter=1000, random_state=random_state, C=1.0)
    clf.fit(X_train_vec, y_train)

    # Evaluate on held-out test set
    y_pred = clf.predict(X_test_vec)
    acc = float(accuracy_score(y_test, y_pred))
    prec_macro = float(precision_score(y_test, y_pred, average='macro'))
    rec_macro = float(recall_score(y_test, y_pred, average='macro'))
    f1_m = float(f1_score(y_test, y_pred, average='macro'))
    f1_w = float(f1_score(y_test, y_pred, average='weighted'))

    class_rep = classification_report(y_test, y_pred, output_dict=True)
    conf_mat = confusion_matrix(y_test, y_pred).tolist()

    metadata = {
        'model_name': 'TF-IDF + Logistic Regression (Fake Review Baseline)',
        'task': 'Binary Classification: Computer-Generated (CG) vs Original (OR)',
        'training_timestamp': datetime.now(timezone.utc).isoformat(),
        'random_state': random_state,
        'vocabulary_size': len(vectorizer.vocabulary_),
        'dataset_split': {
            'total_samples': len(df),
            'train_samples': len(X_train),
            'test_samples': len(X_test),
            'cg_samples': int((df['label'] == 'CG').sum()),
            'or_samples': int((df['label'] == 'OR').sum()),
        },
        'test_metrics': {
            'accuracy': round(acc, 4),
            'precision_macro': round(prec_macro, 4),
            'recall_macro': round(rec_macro, 4),
            'f1_macro': round(f1_m, 4),
            'f1_weighted': round(f1_w, 4),
            'per_class': {
                'CG': {
                    'precision': round(class_rep['CG']['precision'], 4),
                    'recall': round(class_rep['CG']['recall'], 4),
                    'f1_score': round(class_rep['CG']['f1-score'], 4),
                    'support': class_rep['CG']['support'],
                },
                'OR': {
                    'precision': round(class_rep['OR']['precision'], 4),
                    'recall': round(class_rep['OR']['recall'], 4),
                    'f1_score': round(class_rep['OR']['f1-score'], 4),
                    'support': class_rep['OR']['support'],
                },
            },
            'confusion_matrix': {
                'labels': ['CG', 'OR'],
                'matrix': conf_mat,
            },
        },
        'classes': list(clf.classes_),
        'disclaimer': (
            'Trained on the Kaggle Fake Reviews Dataset. '
            'Estimates whether textual phrasing resembles computer-generated (CG) '
            'or original (OR) dataset samples. Not definitive proof of live review fraud.'
        ),
    }

    model_p = os.path.join(model_dir, 'fake_review_model.joblib')
    vec_p = os.path.join(model_dir, 'fake_review_vectorizer.joblib')
    meta_p = os.path.join(model_dir, 'fake_review_metadata.json')

    joblib.dump(clf, model_p)
    joblib.dump(vectorizer, vec_p)
    with open(meta_p, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)

    return metadata


class FakeReviewClassifier:
    """
    Thread-safe inference engine for Model B (CG vs OR review classification).
    Loaded once at backend startup.
    """
    _instance: Optional['FakeReviewClassifier'] = None

    def __init__(self, model_dir: str = DEFAULT_MODEL_DIR):
        self.model_dir = model_dir
        self.model: Optional[Any] = None
        self.vectorizer: Optional[TfidfVectorizer] = None
        self.metadata: Optional[Dict[str, Any]] = None
        self.is_ready: bool = False
        self.load()

    @classmethod
    def get_instance(cls, model_dir: str = DEFAULT_MODEL_DIR) -> 'FakeReviewClassifier':
        if cls._instance is None:
            cls._instance = FakeReviewClassifier(model_dir=model_dir)
        return cls._instance

    def load(self) -> bool:
        model_p = os.path.join(self.model_dir, 'fake_review_model.joblib')
        vec_p = os.path.join(self.model_dir, 'fake_review_vectorizer.joblib')
        meta_p = os.path.join(self.model_dir, 'fake_review_metadata.json')

        if os.path.isfile(model_p) and os.path.isfile(vec_p):
            try:
                self.model = joblib.load(model_p)
                self.vectorizer = joblib.load(vec_p)
                if os.path.isfile(meta_p):
                    with open(meta_p, 'r', encoding='utf-8') as f:
                        self.metadata = json.load(f)
                self.is_ready = True
                return True
            except Exception as e:
                logger.error('Failed to load Model B artifacts: %s', e)
                self.is_ready = False
                return False
        self.is_ready = False
        return False

    def get_metadata(self) -> Dict[str, Any]:
        return self.metadata or {}

    def predict_one(self, text: str) -> Dict[str, Any]:
        """
        Classifies single review text as CG or OR.
        """
        if not self.is_ready or self.model is None or self.vectorizer is None:
            return {
                'label': 'OR',
                'prediction_label': 'Original (OR)',
                'cg_probability': 0.0,
                'or_probability': 1.0,
                'confidence': 0.5,
                'status': 'MODEL_NOT_LOADED',
            }

        t_clean = text.strip() if text else ''
        if not t_clean:
            return {
                'label': 'OR',
                'prediction_label': 'Original (OR)',
                'cg_probability': 0.5,
                'or_probability': 0.5,
                'confidence': 0.5,
                'status': 'EMPTY_TEXT',
            }

        vec = self.vectorizer.transform([t_clean])
        probs = self.model.predict_proba(vec)[0]
        classes = list(self.model.classes_)
        cg_idx = classes.index('CG') if 'CG' in classes else 0
        or_idx = classes.index('OR') if 'OR' in classes else 1

        cg_prob = float(probs[cg_idx])
        or_prob = float(probs[or_idx])
        pred_label = 'CG' if cg_prob >= 0.5 else 'OR'
        conf = max(cg_prob, or_prob)

        return {
            'label': pred_label,
            'prediction_label': LABEL_MAP.get(pred_label, pred_label),
            'cg_probability': round(cg_prob, 4),
            'or_probability': round(or_prob, 4),
            'confidence': round(conf, 4),
            'status': 'SUCCESS',
        }

    def predict_batch(self, texts: List[str]) -> List[Dict[str, Any]]:
        """
        Batch prediction for efficiency.
        """
        if not self.is_ready or self.model is None or self.vectorizer is None:
            return [self.predict_one(t) for t in texts]

        cleaned = [t.strip() if t else '' for t in texts]
        if not cleaned:
            return []

        safe_texts = [t if len(t) > 0 else 'sample review' for t in cleaned]
        vecs = self.vectorizer.transform(safe_texts)
        all_probs = self.model.predict_proba(vecs)
        classes = list(self.model.classes_)
        cg_idx = classes.index('CG') if 'CG' in classes else 0
        or_idx = classes.index('OR') if 'OR' in classes else 1

        results = []
        for i, probs in enumerate(all_probs):
            if not cleaned[i]:
                results.append({
                    'label': 'OR',
                    'prediction_label': 'Original (OR)',
                    'cg_probability': 0.5,
                    'or_probability': 0.5,
                    'confidence': 0.5,
                    'status': 'EMPTY_TEXT',
                })
                continue

            cg_p = float(probs[cg_idx])
            or_p = float(probs[or_idx])
            pred_lbl = 'CG' if cg_p >= 0.5 else 'OR'
            results.append({
                'label': pred_lbl,
                'prediction_label': LABEL_MAP.get(pred_lbl, pred_lbl),
                'cg_probability': round(cg_p, 4),
                'or_probability': round(or_p, 4),
                'confidence': round(max(cg_p, or_p), 4),
                'status': 'SUCCESS',
            })

        return results

    def analyze_batch_summary(self, texts: List[str]) -> Dict[str, Any]:
        """
        Computes aggregate statistics across a collection of reviews.
        """
        preds = self.predict_batch(texts)
        total = len(preds)
        if total == 0:
            return {
                'total_analyzed': 0,
                'cg_count': 0,
                'or_count': 0,
                'cg_percentage': 0.0,
                'or_percentage': 0.0,
                'mean_cg_probability': 0.0,
                'disclaimer': (
                    'Dataset-based classification using TF-IDF + Logistic Regression '
                    'trained on CG/OR samples. Not definitive proof of authenticity.'
                ),
            }

        cg_count = sum(1 for p in preds if p['label'] == 'CG')
        or_count = total - cg_count
        mean_cg = float(np.mean([p['cg_probability'] for p in preds]))

        return {
            'total_analyzed': total,
            'cg_count': cg_count,
            'or_count': or_count,
            'cg_percentage': round(100.0 * cg_count / total, 1),
            'or_percentage': round(100.0 * or_count / total, 1),
            'mean_cg_probability': round(mean_cg, 4),
            'disclaimer': (
                'Statistical similarity to Computer-Generated (CG) vs Original (OR) '
                'training samples from the Kaggle Fake Reviews dataset. '
                'Heuristic indicator, not proof of falsity.'
            ),
        }
