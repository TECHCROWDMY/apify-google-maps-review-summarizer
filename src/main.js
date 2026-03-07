import { Actor } from 'apify';
import OpenAI from 'openai';

await Actor.init();

// ── 1. Read input ──────────────────────────────────────────────────────────
const input = await Actor.getInput();
const { googleMapsUrl, maxReviews = 100, openaiApiKey } = input;

if (!googleMapsUrl) throw new Error('❌ Please provide a Google Maps URL.');
if (!openaiApiKey)  throw new Error('❌ Please provide an OpenAI API key.');

console.log(`📍 Fetching reviews for: ${googleMapsUrl}`);

// ── 2. Run the Google Maps Reviews scraper ─────────────────────────────────
const reviewRun = await Actor.callTask('apify/google-maps-reviews-scraper', {
  startUrls: [{ url: googleMapsUrl }],
  maxReviews,
  reviewsSort: 'newest',
  language: 'en',
});

const { items: reviews } = await Actor.openDataset(reviewRun.defaultDatasetId);

if (!reviews || reviews.length === 0) {
  throw new Error('❌ No reviews found. Check the URL and try again.');
}

console.log(`✅ Pulled ${reviews.length} reviews. Summarising...`);

// ── 3. Grab business name + star rating from first review ──────────────────
const businessName = reviews[0]?.name ?? 'This Business';
const totalReviews  = reviews[0]?.totalScore ?? '?';
const avgRating     = reviews[0]?.stars ?? '?';

// ── 4. Build review text for AI (keep tokens low) ─────────────────────────
const reviewTexts = reviews
  .filter(r => r.text && r.text.trim().length > 10)
  .slice(0, 80) // cap at 80 for token efficiency
  .map((r, i) => `[${i + 1}] (${r.stars}★) ${r.text.trim()}`)
  .join('\n');

// ── 5. Call OpenAI ─────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: openaiApiKey });

const prompt = `
You are a business analyst. Below are customer reviews for "${businessName}".

Analyse them and return ONLY the following format, nothing else:

BUSINESS: <name>
RATING: <avg stars> stars across <total> reviews

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
