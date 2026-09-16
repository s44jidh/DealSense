# ShopGuard AI — Full UI/UX Mockup Prompt

Create a complete high-fidelity **UI/UX mockup and interactive prototype** for a lightweight browser extension called **ShopGuard AI**.

Use the uploaded reference screenshot as the **physical size and compactness reference**. The popup should be approximately **410px wide × 450px tall**, only slightly taller than the reference. It must look and feel like a real browser-extension popup, not a website, web dashboard, or large application.

## Product

ShopGuard AI is a shopping-safety browser extension that helps users decide whether an e-commerce listing is worth buying.

When the user manually clicks **Analyze Product**, ShopGuard should:

- Identify the product and exact variant
- Determine the effective purchase price
- Account for visible discounts, offers, coupons and conditions
- Analyze seller credibility
- Analyze review patterns
- Detect unusual pricing
- Compare the same product with legitimate alternative stores
- Recommend whether the user should proceed

The primary recommendation states are:

- **SAFE TO PROCEED**
- **PROCEED WITH CAUTION**
- **DO NOT PROCEED**

There is also an **OVERPRICED / BETTER DEAL FOUND** state when the current listing is more expensive than comparable alternatives.

---

## Design Philosophy

Make the interface **extremely clean, human-looking, calm, premium, simple and visually refined**.

It should look like a carefully designed consumer product created by a professional product-design team.

It must NOT look like:

- An AI dashboard
- A cybersecurity control panel
- A developer tool
- A data-science project
- A generic SaaS template
- A futuristic/cyberpunk application

The user should understand the product without needing to understand AI or machine learning.

Prioritize:

**Clarity → Price → Decision → Alternatives**

Use progressive disclosure for everything else.

---

## Typography

**Use Anthropic Serif as the primary and consistent typeface throughout the entire interface.**

Use Anthropic Serif for:

- ShopGuard AI wordmark
- Product names
- Prices
- Headings
- Labels
- Buttons
- Body text
- Secondary information
- Settings
- Privacy information

Do NOT substitute it with:

- Inter
- Roboto
- Arial
- SF Pro
- Helvetica
- Any generic sans-serif

Use Anthropic Serif in a refined, contemporary way.

Keep typography:

- Highly readable
- Restrained
- Elegant
- Human
- Editorial

Use slightly stronger weight for:

- Product name
- Current price
- Main recommendation

Use regular/lighter weights for:

- Supporting information
- Explanations
- Secondary labels

Avoid excessive italics, decorative lettering, or overly stylized typography.

---

## Color System

Build the entire UI around a **black-and-white monochrome foundation**.

Primary colors:

- Near black
- White
- Off-white
- Charcoal
- Dark gray
- Medium gray
- Light gray

Use status colors only when necessary:

**Green** = safe / positive  
**Yellow** = caution / unusual  
**Red** = high risk / warning

Do not use any other accent colors.

Do not use:

- Blue
- Purple
- Cyan
- Neon colors
- Gradients
- Glassmorphism
- Glows
- Heavy drop shadows
- Decorative color effects

Status colors must be subtle and intentional rather than dominating the interface.

---

## Popup Size

Match the uploaded reference screenshot closely.

Target:

**410px wide × approximately 450px tall**

Slightly taller than the reference, but still compact.

Do not expand the interface to fit unnecessary information.

Do not create a permanent large navigation bar.

Do not create a desktop-style sidebar.

Do not create oversized cards.

Avoid excessive empty space as well as overcrowding.

---

## Header

Create a very compact header.

Left:

**ShopGuard AI**

Use a minimal shield mark beside the name.

Right:

- Light/Dark theme control
- Settings icon

No privacy badge.

No privacy label.

No privacy sentence.

No “Private Analysis” text.

No “On-demand analysis” text.

Keep the header visually quiet.

---

## Screen 1 — Before Analysis

This is the initial state when the user opens the extension.

Keep it extremely minimal.

Small section label:

**PRODUCT**

Product row:

[Product image]

**Sony WH-1000XM5**

Wireless Headphones · Black

ExampleShop.com

Important:

**DO NOT SHOW ANY PRICE BEFORE ANALYSIS.**

Do not show:

- Current price
- MRP
- Discount
- Coupon
- Market price
- Price history
- Alternative prices
- Risk score
- Review score

The only shopping action should be:

**Analyze Product**

Use a single clean primary button.

Under it, one concise sentence:

**Check the price, seller and reviews before buying.**

At the bottom use a subtle text link:

**Check another product**

No additional large buttons.

No bottom navigation.

No separate Home / Result / Privacy / Settings tabs.

---

## Screen 2 — Analyzing

Keep the loading state minimal.

Center:

**Analyzing product**

Then a small list:

Product information  
Effective price  
Seller and reviews  
Comparable prices

Indicate progress subtly.

Do not use:

- Large AI animations
- Rotating logos
- Glowing effects
- Large loaders
- Excessive motion

---

## Screen 3 — Safe Result

After analysis, show the full useful result immediately.

At the top:

**SAFE TO PROCEED**

Small supporting text:

**Low risk**

Use green only for the safe status.

Then make the current price the strongest visual element in the popup:

**₹28,999**

Small label:

**Effective price**

Below:

MRP ₹39,999  
Offer −₹5,000  
Coupon −₹1,000

Keep this as a compact single pricing block.

Then:

**Quick check**

Price — Good  
Seller — Low risk  
Reviews — Healthy

Use simple rows, not separate large cards.

Then automatically show:

**Comparable prices**

Store A — **₹27,999**  
₹1,000 less

Store B — ₹29,499  
Similar

Store C — ₹30,999  
₹2,000 more

Do NOT create a “Compare Prices” button.

Do NOT require another click to reveal alternative prices.

The alternatives must automatically appear immediately after analysis.

Add only a tiny secondary line:

**Same model · 98% match**

At the very bottom:

**Why this result**

as a compact expandable control.

---

## Screen 4 — Caution Result

Keep exactly the same structure as the safe state.

Change the decision state to:

**PROCEED WITH CAUTION**

Supporting text:

**Medium risk**

Use yellow only for the caution state.

Show:

**₹18,999**

Effective price

Typical market:

₹24,999–₹27,999

Quick check:

Price — Unusually low  
Seller — Low risk  
Reviews — Some concerns

Then automatically:

**Safer / comparable prices**

Store A — ₹23,499  
Store B — ₹24,199  
Store C — ₹25,999

Then two concise explanations:

**Price is significantly below the typical market range.**

**Some review patterns require additional attention.**

Do not overload the interface with metrics.

---

## Screen 5 — High-Risk Result

Use the same visual structure again.

Main state:

**DO NOT PROCEED**

Supporting text:

**High risk**

Use red only for the warning state.

Show:

**₹9,999**

Effective price

Typical market:

₹24,999

Quick check:

Price — Highly unusual  
Seller — High risk  
Reviews — Suspicious patterns

Then:

**Safer alternatives**

Store A — ₹23,999  
Store B — ₹24,499  
Store C — ₹25,199

Reasons:

**Price is far outside the normal market range.**

**Seller history appears limited.**

**Review patterns require caution.**

Never state:

**“This is definitely a scam.”**

Instead use:

**“High risk based on available signals.”**

---

## Screen 6 — Overpriced Result

Create a result for a legitimate but overpriced listing.

Main state:

**BETTER DEAL FOUND**

Use yellow only for this state.

Current effective price:

**₹79,999**

Typical market:

₹71,999–₹75,999

Message:

**This listing is more expensive than comparable offers.**

Immediately display:

**Better prices**

Store A — **₹71,999**  
₹8,000 less

Store B — ₹73,499  
₹6,500 less

Store C — ₹74,999  
₹5,000 less

Make Store A slightly more prominent as the lowest comparable option.

Do not create another comparison button.

---

## Effective Price Logic — UI

The interface must clearly distinguish between:

- MRP
- Listed price
- Automatic discount
- Coupon
- Conditional offer
- Effective final price

Example:

MRP ₹39,999  
Listed ₹34,999  
Offer −₹5,000  
Coupon −₹1,000  
Effective ₹28,999

Only show this information **after analysis**.

The UI should not automatically treat a large advertised discount as proof of a good deal.

---

## Review Details

Reviews should not dominate the popup.

Use a compact expandable section:

**Review details**

When opened, show:

Reviews analyzed: 2,841

Potentially suspicious patterns: 6%

Normal rating distribution

Varied review language

Some repetitive wording

Never say:

**Fake reviews detected**

Use:

**Potentially suspicious patterns**

No large graphs.

No complex sentiment dashboard.

---

## Seller Details

Use another compact expandable section:

**Seller details**

Rating: 4.6/5

History: Established

Returns: Available

Risk: Low

Keep it secondary.

---

## Why This Result

Create one compact expandable area:

**Why this result**

When opened, show a few human-readable explanations.

Example:

Price significantly below market  
Seller history appears established  
Some reviews show repetitive wording

Do not expose technical ML terminology to the normal shopper.

Avoid:

- Model confidence
- Classification probability
- Feature contribution
- Anomaly score

---

## Manual Product Check

Provide a minimal secondary flow through:

**Check another product**

Allow the user to paste a product URL.

Keep this screen extremely simple:

**Check a product**

Input:

Paste product URL

Button:

**Analyze**

No complicated form.

---

## Settings

The settings screen should be very minimal.

### Appearance

System  
Light  
Dark

### Analysis

Analyze only when requested  
Show comparable prices  
Show review details

### Privacy

No browsing history  
No passwords  
No payment information  
Only required product information is processed

Keep settings concise.

---

## Light Mode

Create a refined light theme:

- White/off-white background
- Black text
- Dark gray secondary text
- Light gray borders
- Minimal shadows
- Green/yellow/red status colors only when needed

No blue accent.

The design should feel editorial, premium and human.

---

## Dark Mode

Create a refined dark theme:

- Near-black background
- Charcoal content surfaces
- White text
- Gray secondary text
- Subtle gray borders
- Green/yellow/red status colors only when needed

No blue accent.

No neon.

No glow.

No gradients.

---

## Iconography

Use a very small, restrained icon set.

Icons should be:

- Simple
- Thin
- Consistent
- Professional

Avoid decorative icons.

**Do not use emojis anywhere in the UI.**

Status should be communicated through:

- Text
- Subtle color
- Minimal UI indicators

For example:

**SAFE TO PROCEED**

rather than an emoji.

---

## UI Density

The popup must remain compact enough that the user can understand the result without extensive scrolling.

The hierarchy should be:

**Recommendation**

**Effective price**

**Quick assessment**

**Comparable prices**

**Optional details**

Do not give equal visual weight to every piece of information.

---

## Human-Like Copy

Use natural language that a normal shopper would understand.

Prefer:

**Safe to proceed**

**Better deal found**

**Price is unusually low**

**This listing is more expensive than comparable offers**

**Some review patterns need attention**

Avoid:

“AI confidence”

“Model prediction”

“Risk probability”

“Classification result”

“Feature importance”

“Anomaly score”

Technical explanations belong only in documentation, not the consumer-facing popup.

---

## Privacy UI

Do NOT place any privacy message, privacy badge, privacy note, or privacy label on the main product screen.

Privacy information should exist **only inside Settings / Privacy**.

The main shopping experience must remain completely clean.

---

## Final Flow

### Before analysis

Product  
Store  
**Analyze Product**

### After analysis

**Recommendation**

**Effective price**

**Price / Seller / Reviews**

**Comparable prices automatically displayed**

**Why this result**

No additional comparison action.

---

## Final Visual Goal

The final interface should feel like a **quiet, premium, highly polished shopping companion**.

It should be:

**Minimal**

**Human**

**Elegant**

**Fast-looking**

**Trustworthy**

**Easy to understand**

It must feel substantially lighter and simpler than the current mockup while preserving all important functionality.

The uploaded screenshot should remain the primary reference for **physical popup proportions and compactness**.

**The most important rule: do not make the interface look like a dashboard. It is a small browser popup designed around one decision: should I buy this product?**
