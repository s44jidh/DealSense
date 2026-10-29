export interface ExtractedReview {
  id?: string;
  text: string;
  rating?: number | null;
  title?: string | null;
  author?: string;
  date?: string | null;
  verified_purchase?: boolean;
}

export interface AspectItem {
  aspect_id: string;
  display_name: string;
  category: "product" | "logistics_seller";
  mention_count: number;
  positive_mentions: number;
  negative_mentions: number;
  positive_percentage: number;
  negative_percentage: number;
  positive_excerpts: string[];
  negative_excerpts: string[];
}

export interface ProConItem {
  aspect: string;
  summary: string;
  sample_quote: string;
}

export interface DeliverySummary {
  mentions: number;
  positive_percentage: number;
  sample_quote: string | null;
}

export interface AspectAnalysisResponse {
  status: string;
  aspects: AspectItem[];
  pros: ProConItem[];
  cons: ProConItem[];
  delivery_summary: DeliverySummary;
}

export interface SuspiciousFlagItem {
  review_id: string;
  review_text: string;
  rating: number | null;
  author: string;
  date: string | null;
  predicted_sentiment: string;
  flags: string[];
  reasons: string[];
  severity: "HIGH" | "MEDIUM";
}

export interface SuspiciousAnalysisResponse {
  status: string;
  total_analyzed: number;
  suspicious_count: number;
  clean_reviews_count: number;
  suspicion_rate: number;
  flags_breakdown: Record<string, number>;
  flagged_reviews: SuspiciousFlagItem[];
  disclaimer: string;
}

export interface FakeReviewBatchResponse {
  status: string;
  total_analyzed: number;
  cg_count: number;
  or_count: number;
  cg_percentage: number;
  or_percentage: number;
  mean_cg_probability: number;
  disclaimer: string;
}

export interface LLMReviewSummaryResponse {
  status: string;
  available: boolean;
  provider?: string | null;
  summary: string;
  verdict?: string | null;
  verdict_sentiment?: string | null;
  verdict_detail?: string | null;
  confidence_score?: number | null;
  confidence_level?: string | null;
  confidence_explanation?: string | null;
  suitable_for?: string | null;
  avoid_if?: string | null;
  total_reviews_analyzed?: number | null;
  target_count?: number | null;
  recurring_complaints: string[];
  common_positive_themes: string[];
  pros: string[];
  cons: string[];
  investigation_patterns: string[];
  error?: string | null;
}

export interface AnalyzedReviewItem {
  id: string;
  text: string;
  rating: number | null;
  title: string | null;
  author: string;
  date: string | null;
  verified_purchase: boolean | null;
  sentiment: "positive" | "neutral" | "negative";
  confidence: number;
  cg_label?: "CG" | "OR";
  cg_probability?: number;
}

export interface BatchReviewAnalysisResponse {
  status: string;
  product_name: string;
  source_retailer: string;
  total_reviews_extracted: number;
  total_reviews_analyzed: number;
  sentiment_distribution: {
    positive: number;
    neutral: number;
    negative: number;
  };
  sentiment_percentages: {
    positive: number;
    neutral: number;
    negative: number;
  };
  overall_sentiment_label: string;
  average_rating: number | null;
  aspect_analysis: AspectAnalysisResponse;
  suspicious_analysis: SuspiciousAnalysisResponse;
  fake_review_analysis?: FakeReviewBatchResponse | null;
  llm_summary?: LLMReviewSummaryResponse | null;
  pros: ProConItem[];
  cons: ProConItem[];
  trust_score: number;
  data_limitations: string;
  analyzed_reviews: AnalyzedReviewItem[];
  rating_distribution?: Record<string, number>;
  target_reviews_count?: number;
}

export interface ComparableOffer {
  retailer_name: string;
  product_title: string;
  product_url: string;
  current_price: number;
  mrp?: number | null;
  currency?: string;
  availability?: string;
  match_status?: string;
  rejection_reason?: string | null;
  rejection_category?: string | null;
  match_details?: string | null;
  seller_name?: string | null;
  data_source?: string;
  model_identifier?: string | null;
  retailer_product_id?: string | null;
  image_url?: string | null;
}

export interface ComparePricesResponse {
  status: string;
  source_product?: any;
  offers: ComparableOffer[];
  verified_offers: ComparableOffer[];
  possible_offers?: ComparableOffer[];
  lowest_price: number | null;
  lowest_price_retailer: string | null;
  lowest_price_url: string | null;
  price_difference: number | null;
  verdict_label: string;
  summary: string;
  retrieval_timestamp: string;
  retailers_queried: string[];
  retailer_statuses: Record<string, string>;
  message: string;
  cross_platform_offers?: ComparableOffer[];
  cross_platform_status?: string;
  lowest_verified_cross_platform_price?: number | null;
  cross_platform_summary?: string | null;
  same_platform_seller_offers?: ComparableOffer[];
  same_platform_status?: string;
  lowest_verified_same_platform_price?: number | null;
  same_platform_summary?: string | null;
}
