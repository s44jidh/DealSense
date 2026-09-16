Create a complete high-fidelity **UI/UX mockup and interactive prototype** for a privacy-first browser extension called **ShopGuard AI**.

Important: This is a **UI/UX mockup only**. Do not implement real web scraping, machine learning, payment blocking, backend APIs, or actual browser-extension functionality. Use realistic mock data to demonstrate the intended future product experience.

## Product Concept

ShopGuard AI is an AI-powered shopping safety browser extension for e-commerce websites.

When a user manually activates the extension on a product page, ShopGuard AI:

1. Determines the product and exact variant.
2. Calculates the effective purchase price after discounts, coupons and visible offers.
3. Compares the price against legitimate alternative shopping websites.
4. Evaluates seller credibility.
5. Analyzes product reviews for potentially suspicious patterns.
6. Detects unusual or anomalous pricing.
7. Produces an explainable overall shopping-risk assessment.
8. Recommends whether the user should proceed, exercise caution, or avoid the purchase.
9. Suggests legitimate alternative stores when a better or safer option is available.

The product should feel like a real commercial privacy/security product rather than a college-project dashboard.

## Brand

Name:
**ShopGuard AI**

Tagline:
**Shop smarter. Buy safer. Stay private.**

Logo:
A minimal shield combined with a shopping bag or shopping cart.

Brand personality:

* Trustworthy
* Intelligent
* Private
* Modern
* Calm
* Professional
* Consumer-friendly

Avoid making it look like a hacking/cyberpunk application.

---

# DESIGN SYSTEM

Create a polished, modern browser-extension interface.

### General style

* Compact browser-extension dimensions
* Premium SaaS/security-product aesthetic
* Strong typography
* Excellent spacing
* Rounded cards
* Subtle borders
* Very restrained shadows
* Minimal animation
* Clear hierarchy
* No visual clutter
* No excessive gradients
* No excessive glowing effects
* No cyberpunk styling
* No unnecessary charts
* No huge dashboard elements

The extension should be understandable within approximately 5 seconds.

The most important information should always be:

**Should I buy this product or not?**

---

# LIGHT MODE / DARK MODE

Implement both visual themes in the mockup.

The header must contain a compact **Light/Dark mode toggle**.

Use a sun and moon icon.

### Light Mode

* Off-white or very light gray page background
* White cards
* Dark charcoal text
* Muted gray secondary text
* Subtle borders
* Soft shadows
* Green for safe
* Amber for caution
* Red for high risk
* Restrained blue accent for interactive elements

### Dark Mode

* Deep charcoal/near-black background
* Slightly lighter dark cards
* Soft white primary text
* Gray secondary text
* Subtle borders
* Minimal shadows
* Green for safe
* Amber for caution
* Red for high risk
* Restrained accent color

Do not use pure black everywhere.

The dark theme should feel like a premium cybersecurity/privacy application rather than a gaming UI.

The selected theme should be visually consistent across all screens.

The mockup should demonstrate that the theme preference is saved locally in the browser.

---

# MAIN EXTENSION POPUP

Design a compact browser extension popup approximately 380–420px wide.

## Header

Left:

* ShopGuard AI logo
* “ShopGuard AI”

Right:

* Privacy indicator: “Private Analysis”
* Light/Dark toggle
* Settings icon

Under the header, optionally show:

**Analysis is user-triggered**

This reinforces the privacy-first concept.

---

# SCREEN 1 — INITIAL / READY STATE

Display a product page context.

Example product:

**Sony WH-1000XM5 Wireless Headphones**

Store:
ExampleShop.com

Product image thumbnail.

Show a large primary button:

**Analyze Product**

Small explanatory text:

“Check price, seller, reviews and safer alternatives before buying.”

Include a small privacy message:

🔒 “Only the product information required for analysis is used.”

The initial screen should be extremely simple.

---

# SCREEN 2 — ANALYZING STATE

Create an elegant analysis loading state.

Title:

**Analyzing Product…**

Show progressive steps:

✓ Reading product information
✓ Calculating effective price
● Checking market prices
○ Analyzing reviews
○ Evaluating seller
○ Calculating shopping risk

Use a subtle progress indicator.

Do NOT use a giant AI animation.

The extension should feel lightweight and fast.

---

# SCREEN 3 — LOW-RISK / SAFE RESULT

Create a polished result screen.

Example:

### 🟢 LOW RISK

**82/100**

**SAFE TO PROCEED**

Text:

“Price, seller and review signals appear normal based on the available information.”

Then display four compact cards:

### Price Health

🟢 Good

Effective price:
**₹28,999**

Typical market range:
**₹28,499 – ₹31,999**

### Seller Risk

🟢 Low

Seller rating:
**4.6/5**

Seller history:
**Established**

### Review Health

🟢 Good

Reviews analyzed:
**2,841**

Suspicious-pattern signal:
**Low**

### Product Match

🟢 High confidence

“Exact model and storage variant identified.”

---

# SCREEN 4 — CAUTION RESULT

Create a yellow/amber risk state.

### 🟡 PROCEED WITH CAUTION

**64/100**

Text:

“This listing appears potentially legitimate, but several signals require additional verification.”

Show:

### Price Health

🟡 Unusually low

Current effective price:
**₹18,999**

Typical market price:
**₹24,999**

Difference:
**24% below typical price**

### Seller Risk

🟢 Low

### Review Health

🟡 Moderate concern

### Offer Conditions

🟡 Coupon required

Then add:

## Why this recommendation?

✓ Seller has established history
✓ Product variant appears correct
⚠ Price is significantly below market
⚠ Several reviews show repetitive wording
⚠ Lowest price depends on a coupon

Use careful wording such as:
“Potentially suspicious”
“Unusual pricing”
“Requires verification”

Never say:
“This is definitely a scam.”

---

# SCREEN 5 — HIGH-RISK RESULT

Create a strong but professional warning screen.

### 🔴 HIGH RISK

**87/100**

### DO NOT PROCEED

Text:

“Multiple unusual signals were detected in this listing. Consider purchasing from a verified alternative store.”

Show a risk breakdown:

**Price anomaly**
HIGH

**Seller risk**
HIGH

**Review risk**
MEDIUM

**Product consistency**
MEDIUM

Then:

## Why?

⚠ Price is significantly outside the typical market range
⚠ Seller has limited history
⚠ Review patterns appear unusual
⚠ Return/refund information requires verification

Add a prominent button:

**View Safer Alternatives**

Secondary action:

**Review Details**

Do not use threatening or sensational language.

---

# SCREEN 6 — EFFECTIVE PRICE ANALYSIS

Create a detailed price card.

Example:

Product:
Sony WH-1000XM5

MRP:
₹39,999

Listed price:
₹34,999

Instant discount:
−₹5,000

Coupon:
−₹1,000

---

### Effective Price

**₹28,999**

Then show:

### Market Comparison

Typical market price:
**₹25,499 – ₹31,999**

Current effective price:
**₹28,999**

Status:
🟢 Within normal market range

Important:

Do NOT automatically assume the advertised discount is genuine.

Clearly differentiate:

* MRP
* Listed price
* Automatic discount
* Coupon discount
* Conditional offers
* Final effective price

Include an optional expandable section:

**How was the effective price calculated?**

---

# SCREEN 7 — PRICE COMPARISON

Create a polished section:

## Better Prices From Other Stores

Display legitimate alternative stores.

Example:

### Store A

₹27,999

₹1,000 cheaper

🟢 Low risk

[View Deal]

### Store B

₹29,499

₹500 more expensive

🟢 Low risk

[View Deal]

### Store C

₹31,999

₹3,000 more expensive

🟢 Low risk

[View Deal]

Add:

**Product Match: 98%**

Make clear that the comparison refers to the same model/variant.

Include:

“Prices checked recently”

Use neutral wording such as:
“Supported store”
“Available comparison”
“Price may change”

The UI should not imply that ShopGuard guarantees merchant legitimacy.

---

# SCREEN 8 — EXPENSIVE DEAL / BETTER ALTERNATIVE

Create a scenario where the user's current store is overpriced.

Example:

Current website:

**₹42,999**

ShopGuard discovers:

Store A:
**₹38,499**

Store B:
**₹39,199**

Store C:
**₹40,999**

Display:

### 💡 Better Deal Found

“You may be paying approximately ₹4,500 more than the lowest comparable listing.”

Then:

**Recommended alternative**

Store A
₹38,499
🟢 Low risk
[View Deal]

This screen should strongly communicate the combination of:

**PRICE INTELLIGENCE + SAFETY**

---

# SCREEN 9 — REVIEW ANALYSIS

Create a detailed review-analysis screen.

Title:

## Review Health

Overall:
**78/100**

Status:
🟢 Mostly healthy

Show:

Reviews analyzed:
**2,841**

Positive:
**74%**

Neutral:
**14%**

Negative:
**12%**

Potentially suspicious patterns:
**6%**

Include examples of reasons:

✓ Reviews contain varied language
✓ Rating distribution looks normal
✓ Review timing is reasonably distributed
⚠ Some repetitive review wording detected

Do not label individual reviews as definitively fake.

Use the phrase:

**“Potentially suspicious review patterns”**

not:

**“Fake reviews detected.”**

Include a small chart showing rating distribution from 1–5 stars.

---

# SCREEN 10 — SELLER ANALYSIS

Create:

## Seller Health

Seller:
**TechWorld Electronics**

Seller rating:
**4.6 / 5**

Seller status:
🟢 Established

Show:

* Seller rating
* Review count
* Available seller history
* Return policy
* Fulfillment information
* Warranty information
* Marketplace verification where available

Use a simple credibility meter.

Avoid inventing absolute guarantees.

---

# SCREEN 11 — RISK BREAKDOWN

Create a visual explanation of the overall recommendation.

Example:

## Overall Shopping Risk

**64/100 — MEDIUM**

Breakdown:

Price Risk:
**72**

Seller Risk:
**22**

Review Risk:
**58**

Listing Risk:
**41**

Product Match:
**94**

Represent these using horizontal progress bars or compact meters.

Below:

## What influenced the result?

Price anomaly:
High impact

Seller:
Low impact

Reviews:
Medium impact

Offer conditions:
Medium impact

Make this screen useful for demonstrating **explainable AI**.

---

# SCREEN 12 — PRIVACY PANEL

Create a dedicated privacy panel.

Title:

## 🔒 Your Privacy

Main statement:

**“ShopGuard does not need to know who you are to protect your purchase.”**

Show:

✓ No passwords collected
✓ No payment information collected
✓ No browsing history collected
✓ No cookies sent for analysis
✓ No personal identity required
✓ Analysis is user-triggered
✓ Only required product information is processed

Include:

### Data Handling

**Product information**
Used for analysis

**Personal information**
Not required

**Analysis results**
Automatically discarded unless the user chooses to save them

Add a small status:

🔒 **Privacy-first mode enabled**

---

# SCREEN 13 — SETTINGS

Create a clean settings page.

## Analysis

Toggle:
**Analyze only when I click**

Toggle:
**Show price comparisons**

Toggle:
**Show review analysis**

Toggle:
**Show seller analysis**

Toggle:
**Show shopping-risk recommendation**

## Privacy

Toggle:
**Use local processing when available**

Toggle:
**Automatically delete analysis data**

Toggle:
**Send only required product information**

## Appearance

Theme:
**System / Light / Dark**

## Alerts

Toggle:
**Warn when a listing has unusually high risk**

Toggle:
**Notify when a significantly cheaper legitimate alternative is found**

Avoid unnecessary settings.

---

# SCREEN 14 — LOCAL / PRIVACY-FIRST ANALYSIS STATUS

Create a small technical information screen demonstrating the architecture.

Title:

## Analysis & Privacy

Show:

**Browser**
Product information extraction

↓

**Local processing**
Lightweight preprocessing where possible

↓

**Secure analysis service**
Only required structured product information

↓

**Risk result**
Returned to extension

Then state:

**No continuous page monitoring**

**No background browsing-history collection**

This screen is primarily for the project presentation and technical explanation.

---

# SCREEN 15 — PRODUCT MATCH CONFIDENCE

Because cross-store comparison can accidentally compare different variants, create a compact product matching component.

Example:

## Product Match

Current listing:
Sony WH-1000XM5

Compared listing:
Sony WH-1000XM5 Black

### Match Confidence

**98%**

Matched:
✓ Brand
✓ Model
✓ Storage/variant
✓ Color
✓ Product category

Possible difference:
⚠ Seller warranty

Use this to demonstrate that ShopGuard compares the correct products rather than simply comparing names.

---

# SCREEN 16 — EMPTY / ERROR STATE

Create professional fallback states.

Example:

### Unable to Analyze

“ShopGuard couldn't reliably identify this product.”

Reasons:

* Product information unavailable
* Variant unclear
* Supported data unavailable

Button:

**Try Again**

And:

**Continue Shopping**

Another state:

### Price Comparison Unavailable

“Comparable pricing could not be reliably established.”

Never invent prices.

---

# SCREEN 17 — MANUAL PRODUCT CHECK

Allow the user to manually enter a product URL or product name.

Title:

**Check a Product**

Input:

“Paste product URL or search for a product”

Button:

**Analyze**

This demonstrates that the system can work beyond automatically detected product pages.

---

# INTERACTION DESIGN

Create realistic prototype interactions between the screens.

Flow:

Product page
→ Open ShopGuard
→ Analyze Product
→ Loading
→ Result
→ Why?
→ Price Comparison
→ Review Analysis
→ Seller Analysis
→ Safer Alternatives

High-risk flow:

Product page
→ Analyze Product
→ High Risk
→ Why?
→ Safer Alternatives
→ Alternative store comparison

Safe flow:

Product page
→ Analyze
→ Low Risk
→ Good Deal
→ Proceed Shopping

Theme flow:

Light
↔ Dark

Privacy flow:

Main screen
→ Privacy
→ Settings
→ Analysis preferences

---

# IMPORTANT UX PRINCIPLES

The extension is intentionally lightweight.

Do not show huge dashboards.

Do not continuously scan all browsing activity.

Do not show unnecessary technical ML terminology in the primary UI.

Users should see simple language:

Instead of:
“Classification confidence = 0.87”

Use:
**“High shopping risk”**

Put technical details under:
**Why this recommendation?**

Every recommendation must be explainable.

Never claim certainty.

The system should distinguish:

**Cheap ≠ Scam**

**High discount ≠ Fraud**

**Suspicious review patterns ≠ Proven fake reviews**

The final decision is a risk assessment based on available information.

---

# DEMONSTRATION DATA

Use realistic mock e-commerce data.

Create at least three demo scenarios:

### Scenario A — Good Deal

Product:
Sony WH-1000XM5

Effective price:
₹28,999

Typical market:
₹28,499–₹31,999

Seller:
Low risk

Reviews:
Healthy

Result:
🟢 SAFE TO PROCEED

### Scenario B — Suspicious Cheap Deal

Product:
Premium smartphone

Effective price:
₹19,999

Typical market:
₹32,999–₹35,999

Seller:
Medium/high risk

Reviews:
Potentially suspicious

Result:
🔴 DO NOT PROCEED

### Scenario C — Overpriced Listing

Product:
Laptop

Current price:
₹79,999

Comparable legitimate alternatives:
₹71,999
₹73,499
₹74,999

Result:

💡 BETTER DEAL FOUND

Recommend the best legitimate alternative.

---

# RESPONSIVE EXTENSION CONSTRAINTS

Design specifically for a browser extension popup.

Prioritize:

* 380–420px width
* Compact vertical layout
* Scannable information
* Clear CTAs
* Smooth scrolling only when necessary
* Mobile-like card hierarchy within the extension
* No full desktop dashboard

Also create an optional larger “expanded analysis” view for detailed information.

---

# ACCESSIBILITY

* Strong contrast
* Readable typography
* Do not communicate risk through color alone
* Always combine color with icon + text
* Clear focus states
* Buttons clearly labeled
* Avoid tiny text
* Support both light and dark modes

Risk labels must appear as:

🟢 LOW RISK

🟡 PROCEED WITH CAUTION

🔴 HIGH RISK

---

# FINAL VISUAL IMPRESSION

The finished mockup should look like a real browser-extension product that could eventually be submitted to the Chrome Web Store or Firefox Add-ons.

It should communicate these three ideas immediately:

### 🛡️ SAFETY

“Is this purchase risky?”

### 💰 PRICE INTELLIGENCE

“Am I actually getting a good deal?”

### 🔒 PRIVACY

“Is my browsing information being collected?”

The interface should be polished enough to present to a university project evaluator and visually demonstrate how ShopGuard AI would work before the actual machine-learning and browser-extension implementation is built.
