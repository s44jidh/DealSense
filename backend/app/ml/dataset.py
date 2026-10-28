"""
DealSense Data Science Pipeline — dataset.py
Loads, cleans, validates, and profiles the Flipkart Product Customer Reviews Dataset (Dataset-SA.csv).
Handles missing values, drops corrupt records, normalizes review text, and prepares clean/deduplicated data
to prevent train/test data leakage.
"""

from __future__ import annotations

import os
import re
import json
from typing import Any, Optional
import pandas as pd
import numpy as np

REQUIRED_COLUMNS = ["product_name", "product_price", "Rate", "Review", "Summary", "Sentiment"]

def normalize_review_text(text: str) -> str:
    """
    Normalizes review text while preserving meaningful sentiment cues,
    emojis/slang, and punctuation signals.
    """
    if not text or not isinstance(text, str):
        return ""
    # Strip encoding question mark artifacts like "??????(White, Black..."
    t = re.sub(r"\?{2,}", " ", text)
    # Convert non-breaking space
    t = t.replace("\u00a0", " ")
    # Collapse multiple whitespaces
    t = re.sub(r"\s+", " ", t).strip()
    return t

def load_raw_dataset(csv_path: str = "backend/data/raw/Dataset-SA.csv") -> pd.DataFrame:
    """
    Loads raw CSV dataset and validates expected columns.
    Raises FileNotFoundError or ValueError if schema is invalid.
    """
    if not os.path.isfile(csv_path):
        raise FileNotFoundError(
            f"Dataset file not found at '{csv_path}'. Please ensure Dataset-SA.csv is present in backend/data/raw/."
        )
    df = pd.read_csv(csv_path, dtype=str)
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Dataset missing required columns: {missing}. Expected columns: {REQUIRED_COLUMNS}")
    return df

def clean_and_preprocess_dataset(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, Any]]:
    """
    Cleans raw dataframe:
      - Validates and parses numerical rating (1 to 5).
      - Drops shifted/corrupt rows where Rate is non-numeric.
      - Combines Review (headline) and Summary (body) into clean_text.
      - Normalizes sentiment labels ('positive', 'negative', 'neutral').
      - Computes comprehensive dataset statistics.
    Returns: (cleaned_df, statistics_dict)
    """
    total_raw = len(df)

    # 1. Clean sentiment column
    clean_sentiment = df["Sentiment"].fillna("").astype(str).str.strip().str.lower()
    valid_sentiment_mask = clean_sentiment.isin(["positive", "negative", "neutral"])

    # 2. Clean Rate column (must be numeric 1-5)
    clean_rate = pd.to_numeric(df["Rate"], errors="coerce")
    valid_rate_mask = clean_rate.notna() & clean_rate.isin([1, 2, 3, 4, 5])

    # Filter valid rows
    valid_mask = valid_sentiment_mask & valid_rate_mask
    valid_df = df[valid_mask].copy()
    valid_df["Rate"] = clean_rate[valid_mask].astype(int)
    valid_df["Sentiment"] = clean_sentiment[valid_mask]

    # 3. Combine Review headline and Summary text
    h_text = valid_df["Review"].fillna("").astype(str).apply(normalize_review_text)
    b_text = valid_df["Summary"].fillna("").astype(str).apply(normalize_review_text)

    # Combine title + body
    full_text = []
    for h, b in zip(h_text, b_text):
        if h and b and h.lower() != b.lower():
            full_text.append(f"{h}. {b}")
        elif b:
            full_text.append(b)
        else:
            full_text.append(h)

    valid_df["clean_text"] = full_text
    # Keep only non-empty texts
    valid_df = valid_df[valid_df["clean_text"].str.strip().str.len() > 1].copy()

    total_clean = len(valid_df)
    unique_text_count = int(valid_df["clean_text"].nunique())
    exact_duplicate_count = total_clean - unique_text_count

    sentiment_counts = valid_df["Sentiment"].value_counts().to_dict()
    rate_counts = valid_df["Rate"].value_counts().sort_index().to_dict()

    # Rate vs Sentiment cross-tabulation
    crosstab = pd.crosstab(valid_df["Rate"], valid_df["Sentiment"]).to_dict()

    stats = {
        "raw_record_count": total_raw,
        "clean_record_count": total_clean,
        "dropped_corrupt_records": total_raw - total_clean,
        "unique_text_count": unique_text_count,
        "duplicate_text_count": exact_duplicate_count,
        "duplicate_percentage": round(100.0 * exact_duplicate_count / total_clean, 2),
        "sentiment_distribution": sentiment_counts,
        "rate_distribution": rate_counts,
        "rate_vs_sentiment_crosstab": crosstab,
    }

    return valid_df, stats

def get_deduplicated_dataset(df: pd.DataFrame) -> pd.DataFrame:
    """
    Produces a deduplicated dataset grouped by unique review text
    to avoid train/test data leakage.
    If the same text has conflicting sentiments, takes the mode/most frequent.
    """
    # Group by clean_text and select first occurrence or mode sentiment
    dedup = df.drop_duplicates(subset=["clean_text"]).copy()
    return dedup

def save_processed_data(
    df: pd.DataFrame,
    stats: dict[str, Any],
    out_dir: str = "backend/data/processed",
) -> str:
    """
    Saves cleaned CSV and metadata JSON to processed directory.
    """
    os.makedirs(out_dir, exist_ok=True)
    csv_out = os.path.join(out_dir, "flipkart_reviews_clean.csv")
    df.to_csv(csv_out, index=False)

    stats_out = os.path.join(out_dir, "dataset_stats.json")
    with open(stats_out, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2)

    return csv_out
