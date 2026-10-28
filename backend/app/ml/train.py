"""
DealSense Data Science Pipeline — train.py
Driver script to load raw/clean dataset, train the sentiment model, and export metrics & artifacts.
"""

import sys
import os
import json

# Ensure backend directory is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.ml.dataset import load_raw_dataset, clean_and_preprocess_dataset, get_deduplicated_dataset, save_processed_data
from app.ml.sentiment_pipeline import train_and_evaluate_sentiment_model

def run_training():
    print("=== DEALSENSE SENTIMENT MODEL TRAINING PIPELINE ===")
    print("Step 1: Loading raw dataset...")
    raw_df = load_raw_dataset()
    print(f"Loaded raw dataset with {len(raw_df)} records.")

    print("\nStep 2: Cleaning, validating, and preprocessing...")
    clean_df, stats = clean_and_preprocess_dataset(raw_df)
    save_processed_data(clean_df, stats)
    print(f"Clean records: {stats['clean_record_count']}. Dropped corrupt records: {stats['dropped_corrupt_records']}.")

    print("\nStep 3: Deduplicating records to eliminate train/test data leakage...")
    dedup_df = get_deduplicated_dataset(clean_df)
    print(f"Deduplicated dataset size: {len(dedup_df)} unique reviews (avoided {stats['duplicate_text_count']} duplicate review leaks).")

    print("\nStep 4: Training and evaluating TF-IDF + Logistic Regression model...")
    metadata = train_and_evaluate_sentiment_model(dedup_df, random_state=42)

    print("\n=== MODEL TRAINING & EVALUATION COMPLETE ===")
    print(f"Model: {metadata['model_name']}")
    print(f"Vocabulary Size: {metadata['vocabulary_size']}")
    print(f"Test Accuracy: {metadata['test_metrics']['accuracy'] * 100:.2f}%")
    print(f"Test Macro F1: {metadata['test_metrics']['f1_macro']:.4f}")
    print(f"Test Weighted F1: {metadata['test_metrics']['f1_weighted']:.4f}")
    print("\nPer-Class Breakdown:")
    for cls_name, m in metadata['test_metrics']['per_class'].items():
        print(f"  [{cls_name.upper()}] Precision: {m['precision']:.4f} | Recall: {m['recall']:.4f} | F1: {m['f1_score']:.4f} | Support: {m['support']}")

    print("\nConfusion Matrix (Negative, Neutral, Positive):")
    for row in metadata['test_metrics']['confusion_matrix']['matrix']:
        print(" ", row)

    print("\nArtifacts saved successfully in backend/models/")

if __name__ == "__main__":
    run_training()
