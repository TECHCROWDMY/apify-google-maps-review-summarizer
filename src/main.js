import { Actor } from 'apify';
import { ApifyClient } from 'apify-client';

await Actor.init();

// ── 1. Read input ──────────────────────────────────────────────────────────
const input = await Actor.getInput();
const { googleMapsUrl, maxReviews = 100, geminiApiKey } = input;

if (!googleMapsUrl) throw new Error('❌ Please provide a Google Maps URL.');
if (!geminiApiKey)  throw new Error('❌ Please provide a Gemini API key.');

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

// ── 3. Grab business info ──────────────────────────────────────────────────
const businessName = reviews[0]?.name ?? 'This Business';
const avgRating    = reviews[0]?.totalScore ?? '?';
const totalReviews = reviews[0]?.reviewsCount ?? reviews.length;

// ── 4. Build review text for AI ────────────────────────────────────────────
const reviewTexts = reviews
  .filter(r => r.text && r.text.trim().length > 10)
  .slice(0, 80)
  .map((r, i) => `[${i + 1}] (${r.stars}★) ${r.text.trim()}`)
  .join('\n');

// ── 5. Call Gemini API (free tier) ─────────────────────────────────────────
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

const geminiRes = await fetch(
  `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 400, temperature: 0.3 },
    }),
  }
);

const geminiData = await geminiRes.json();

// Log full response to help debug
console.log('Gemini HTTP status:', geminiRes.status);
console.log('Gemini raw response:', JSON.stringify(geminiData, null, 2));

const summary = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

if (!summary) throw new Error('❌ Gemini returned no summary. See logs above for full response.');

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