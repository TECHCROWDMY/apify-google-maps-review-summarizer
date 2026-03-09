import { Actor } from 'apify';
import { ApifyClient } from 'apify-client';
import Anthropic from '@anthropic-ai/sdk';

await Actor.init();

// ── 1. Read input ──────────────────────────────────────────────────────────
const input = await Actor.getInput();
const { googleMapsUrl, maxReviews = 100, claudeApiKey } = input;

if (!googleMapsUrl) throw new Error('❌ Please provide a Google Maps URL.');
if (!claudeApiKey)  throw new Error('❌ Please provide a Claude API key.');

console.log(`📍 Fetching reviews for: ${googleMapsUrl}`);

// ── 2. Call the reviews scraper ────────────────────────────────────────────
const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const run = await client.actor('compass/google-maps-reviews-scraper').call({
  startUrls: [{ url: googleMapsUrl }],
  maxReviews,
  reviewsSort: 'newest',
  language: 'en',
});

const { items: reviews } = await client.dataset(run.defaultDatasetId).listItems();

if (!reviews || reviews.length === 0) {
  throw new Error('❌ No reviews found. Check the URL and try again.');
}

console.log(`✅ Pulled ${reviews.length} reviews. Summarising...`);

// ── 3. Grab business info from first review item ───────────────────────────
const businessName = reviews[0]?.name ?? 'This Business';
const avgRating    = reviews[0]?.totalScore ?? '?';
const totalReviews = reviews[0]?.reviewsCount ?? reviews.length;

// ── 4. Build review text for AI ────────────────────────────────────────────
const reviewTexts = reviews
  .filter(r => r.text && r.text.trim().length > 10)
  .slice(0, 80)
  .map((r, i) => `[${i + 1}] (${r.stars}★) ${r.text.trim()}`)
  .join('\n');

// ── 5. Call Claude API ─────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: claudeApiKey });

const message = await anthropic.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 400,
  messages: [
    {
      role: 'user',
      content: `
You are a business analyst. Below are customer reviews for "${businessName}".

Analyse them and return ONLY the following format, nothing else:

BUSINESS: ${businessName}
RATING: ${avgRating} stars across ${totalReviews} reviews

✅ LOVE: <3 short bullet points on what customers consistently praise>
❌ HATE: <3 short bullet points on the most common complaints>
💬 MOST MENTIONED: <top 3 words or phrases that appear repeatedly>
⚠️  RECENT TREND: <any pattern in the most recent reviews, 1 sentence>
💡 QUICK WIN: <single most actionable thing the owner could fix tomorrow>

Be concise. Plain English only. No jargon.

REVIEWS:
${reviewTexts}
      `.trim(),
    },
  ],
});

const summary = message.content[0].text.trim();

console.log('\n─────────────────────────────────');
console.log(summary);
console.log('─────────────────────────────────\n');

// ── 6. Charge the user ─────────────────────────────────────────────────────
await Actor.charge({ eventName: 'run' });

// ── 7. Save output ─────────────────────────────────────────────────────────
await Actor.pushData({
  businessName,
  googleMapsUrl,
  avgRating,
  totalReviews,
  reviewsAnalysed: reviews.length,
  summary,
  generatedAt: new Date().toISOString(),
});

console.log('🎉 Done! Check the dataset for your summary card.');

await Actor.exit();