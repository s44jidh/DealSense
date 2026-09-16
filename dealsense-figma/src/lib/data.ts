export type Risk = "safe" | "caution" | "danger";

export type ScenarioId = "good" | "suspicious" | "overpriced";

export interface Store {
  name: string;
  price: number;
  delta: number; // relative to current listing, negative = cheaper
  risk: Risk;
  recommended?: boolean;
}

export interface Scenario {
  id: ScenarioId;
  product: string;
  variant: string;
  store: string;
  image: string;
  verdict: Risk;
  score: number;
  headline: string;
  summary: string;
  price: {
    mrp: number;
    listed: number;
    instant: number;
    coupon: number;
    effective: number;
    marketLow: number;
    marketHigh: number;
    priceStatus: Risk;
    priceStatusLabel: string;
  };
  seller: {
    name: string;
    rating: number;
    reviews: number;
    status: string;
    risk: Risk;
    credibility: number; // 0-100
    returnPolicy: string;
    fulfillment: string;
    warranty: string;
    verified: boolean;
  };
  reviews: {
    score: number;
    analyzed: number;
    positive: number;
    neutral: number;
    negative: number;
    suspicious: number;
    risk: Risk;
    distribution: number[]; // 5,4,3,2,1 stars as percent
  };
  breakdown: {
    price: number;
    seller: number;
    review: number;
    listing: number;
    match: number;
  };
  match: number;
  reasons: { tone: "good" | "warn"; text: string }[];
  stores: Store[];
  cheaperThanCurrent?: number; // amount user overpays
}

export const INR = (n: number) => "₹" + n.toLocaleString("en-IN");

export const scenarios: Record<ScenarioId, Scenario> = {
  good: {
    id: "good",
    product: "Sony WH-1000XM5",
    variant: "Wireless Headphones · Black",
    store: "ExampleShop.com",
    image:
      "https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?w=200&h=200&fit=crop&auto=format",
    verdict: "safe",
    score: 82,
    headline: "Safe to proceed",
    summary:
      "Price, seller and review signals appear normal based on the available information.",
    price: {
      mrp: 39999,
      listed: 34999,
      instant: 5000,
      coupon: 1000,
      effective: 28999,
      marketLow: 28499,
      marketHigh: 31999,
      priceStatus: "safe",
      priceStatusLabel: "Within normal market range",
    },
    seller: {
      name: "TechWorld Electronics",
      rating: 4.6,
      reviews: 12480,
      status: "Established",
      risk: "safe",
      credibility: 88,
      returnPolicy: "10-day replacement",
      fulfillment: "Marketplace fulfilled",
      warranty: "1-year brand warranty",
      verified: true,
    },
    reviews: {
      score: 78,
      analyzed: 2841,
      positive: 74,
      neutral: 14,
      negative: 12,
      suspicious: 6,
      risk: "safe",
      distribution: [58, 22, 9, 5, 6],
    },
    breakdown: { price: 24, seller: 18, review: 22, listing: 20, match: 96 },
    match: 98,
    reasons: [
      { tone: "good", text: "Seller has an established trading history" },
      { tone: "good", text: "Exact model and variant identified" },
      { tone: "good", text: "Effective price sits within the typical range" },
      { tone: "good", text: "Review language and timing look varied" },
    ],
    stores: [
      { name: "PrimeCart", price: 27999, delta: -1000, risk: "safe", recommended: true },
      { name: "GadgetHub", price: 29499, delta: 500, risk: "safe" },
      { name: "MegaStore", price: 31999, delta: 3000, risk: "safe" },
    ],
  },
  suspicious: {
    id: "suspicious",
    product: "Galaxy S24 Ultra",
    variant: "Premium Smartphone · 256GB",
    store: "DealBazaar.in",
    image:
      "https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?w=200&h=200&fit=crop&auto=format",
    verdict: "danger",
    score: 87,
    headline: "Do not proceed",
    summary:
      "Multiple unusual signals were detected in this listing. Consider purchasing from a verified alternative store.",
    price: {
      mrp: 42999,
      listed: 24999,
      instant: 4000,
      coupon: 1000,
      effective: 19999,
      marketLow: 32999,
      marketHigh: 35999,
      priceStatus: "danger",
      priceStatusLabel: "Far below typical market range",
    },
    seller: {
      name: "MobileMart Global",
      rating: 1.8,
      reviews: 214,
      status: "Limited history",
      risk: "danger",
      credibility: 34,
      returnPolicy: "No returns stated",
      fulfillment: "Seller shipped",
      warranty: "Unverified",
      verified: false,
    },
    reviews: {
      score: 52,
      analyzed: 486,
      positive: 38,
      neutral: 9,
      negative: 53,
      suspicious: 41,
      risk: "danger",
      distribution: [22, 8, 6, 12, 52],
    },
    breakdown: { price: 88, seller: 82, review: 74, listing: 63, match: 71 },
    match: 71,
    reasons: [
      { tone: "warn", text: "Price is unusually low — far below the typical market range" },
      { tone: "warn", text: "Seller has very low ratings and a high volume of negative buyer feedback" },
      { tone: "warn", text: "Multiple reviews report counterfeit items, bad packaging and possible scams" },
      { tone: "warn", text: "High proportion of potentially fake reviews detected" },
    ],
    stores: [
      { name: "PrimeCart", price: 33499, delta: 13500, risk: "safe", recommended: true },
      { name: "GadgetHub", price: 34199, delta: 14200, risk: "safe" },
      { name: "MegaStore", price: 35499, delta: 15500, risk: "safe" },
    ],
  },
  overpriced: {
    id: "overpriced",
    product: 'ProBook 14" Laptop',
    variant: "Ryzen 7 · 16GB · 512GB SSD",
    store: "QuickBuy.com",
    image:
      "https://images.unsplash.com/photo-1496181133206-80ce9b88a853?w=200&h=200&fit=crop&auto=format",
    verdict: "caution",
    score: 64,
    headline: "A better deal exists",
    summary:
      "This listing appears legitimate, but the same product is available for meaningfully less elsewhere.",
    price: {
      mrp: 84999,
      listed: 79999,
      instant: 0,
      coupon: 0,
      effective: 79999,
      marketLow: 71999,
      marketHigh: 74999,
      priceStatus: "caution",
      priceStatusLabel: "Above typical market range",
    },
    seller: {
      name: "QuickBuy Retail",
      rating: 4.3,
      reviews: 5210,
      status: "Established",
      risk: "safe",
      credibility: 79,
      returnPolicy: "7-day return",
      fulfillment: "Marketplace fulfilled",
      warranty: "1-year brand warranty",
      verified: true,
    },
    reviews: {
      score: 74,
      analyzed: 1633,
      positive: 70,
      neutral: 17,
      negative: 13,
      suspicious: 8,
      risk: "safe",
      distribution: [52, 24, 11, 6, 7],
    },
    breakdown: { price: 72, seller: 22, review: 30, listing: 41, match: 94 },
    match: 96,
    reasons: [
      { tone: "good", text: "Seller has an established trading history" },
      { tone: "good", text: "Product variant appears correct" },
      { tone: "warn", text: "Listed price is above the typical market range" },
      { tone: "warn", text: "A comparable listing is meaningfully cheaper" },
    ],
    stores: [
      { name: "PrimeCart", price: 71999, delta: -8000, risk: "safe", recommended: true },
      { name: "GadgetHub", price: 73499, delta: -6500, risk: "safe" },
      { name: "MegaStore", price: 74999, delta: -5000, risk: "safe" },
    ],
    cheaperThanCurrent: 8000,
  },
};

export const analyzingSteps = [
  "Reading product information",
  "Calculating effective price",
  "Checking market prices",
  "Analyzing reviews",
  "Evaluating seller",
  "Calculating shopping risk",
];

export const riskMeta: Record<
  Risk,
  { label: string; dot: string; color: string; soft: string; border: string; emoji: string }
> = {
  safe: { label: "Low risk", dot: "🟢", color: "text-safe", soft: "bg-safe-soft", border: "border-safe-border", emoji: "🟢" },
  caution: { label: "Caution", dot: "🟡", color: "text-caution", soft: "bg-caution-soft", border: "border-caution-border", emoji: "🟡" },
  danger: { label: "High risk", dot: "🔴", color: "text-danger", soft: "bg-danger-soft", border: "border-danger-border", emoji: "🔴" },
};
