import { Actor } from 'apify';
import { ApifyClient } from 'apify-client';
import OpenAI from 'openai';

await Actor.init();

// ── 1. Read input ──────────────────────────────────────────────────────────
const input = await Actor.getInput();
const { googleMapsUrl, maxReviews = 100, openaiApiKey } = input;

if (!googleMapsUrl) throw new Error('❌ Please provide a Google Maps URL.');
if (!openaiApiKey)  throw new Error('❌ Please provide an OpenAI API key.');

console.log(`📍 Fetching reviews for: ${googleMapsUrl}`);

// ── 2. Use ApifyClient directly with token ─────────────────────────────────
const client = new ApifyClient({ token: process.env.APIFY_TOKEN });

const run = await client.actor('apify/google-maps-scraper').call({
  startUrls: [{ url: googleMapsUrl }],
  maxCrawledPlaces: 1,
  includeReviews: true,
  maxReviews,
  reviewsSort: 'newest',
  language: 'en',
});

const { items: places } = await client.dataset(run.defaultDatasetId).listItems();

const place   = places?.[0];
const reviews = place?.reviews ?? [];

if (!reviews || reviews.length === 0) {
  throw new Error('❌ No reviews found. Check the URL and try again.');
}

console.log(`✅ Pulled ${reviews.length} reviews. Summarising...`);

// ── 3. Grab business info ──────────────────────────────────────────────────
const businessName = place?.title ?? 'This Business';
const avgRating    = place?.totalScore ?? '?';
const totalReviews = place?.reviewsCount ?? '?';

// ── 4. Build review text for AI ────────────────────────────────────────────
const reviewTexts = reviews
  .filter(r => r.text && r.text.trim().length > 10)
  .slice(0, 80)
  .map((r, i) => `[${i + 1}] (${r.stars}★) ${r.text.trim()}`)
  .join('\n');

// ── 5. Call OpenAI ─────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: openaiApiKey });

const prompt = `
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
`.trim();

const completion = await openai.chat.completions.create({
  model: 'gpt-3.5-turbo',
  messages: [{ role: 'user', content: prompt }],
  temperature: 0.3,
  max_tokens: 400,
});

const summary = completion.choices[0].message.content.trim();

console.log('\n─────────────────────────────────');
console.log(summary);
console.log('─────────────────────────────────\n');

// ── 6. Save output ─────────────────────────────────────────────────────────
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