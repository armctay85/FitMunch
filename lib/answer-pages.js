'use strict';

/**
 * Answer pages. Copy is taken from public/index.html. If the homepage does
 * not say it, these pages do not say it.
 * Canonical host is www, matching the sitemap and every existing page.
 * The trial sentence and CTA label are the homepage strings, unchanged.
 */

const path = require('path');
const { stampHtml } = require('./asset-version');

const SITE = 'https://www.fitmunch.com.au';
const TRIAL_HREF = '/login.html?plan=premium#register';
const TRIAL_LABEL = 'Start the 14-day trial';
const TRIAL_REST = '. Card on file. Cancel before the trial ends and you are not charged.';
const TRIAL_SENTENCE = '14-day trial, then <span class="ln-price" data-fm-price="premiumMonthly"><span class="ln-price-fallback"><a href="/pricing.html">See current plans and prices</a>' + TRIAL_REST + '</span><span class="ln-price-live"></span></span>';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const SKIPPED = [
  {
    query: 'high protein meal plan australia',
    href: '/high-protein-staples-meal-plan',
    reason: 'Overlaps the existing high protein staples meal plan, which index already links as a high-protein week.',
  },
  {
    query: 'healthy meal prep for the week on a budget',
    href: '/meal-prep-shopping-list',
    reason: 'Overlaps the weekly meal prep shopping list. The word budget is banned in served copy, and index does not plan to a price.',
  },
  {
    query: 'how to plan meals and a grocery list for the week',
    href: '/grocery-meal-planner',
    reason: 'Overlaps the grocery meal planner, the meal prep shopping list, and the AI meal plan with a shopping list.',
  },
  {
    query: 'high protein grocery list',
    href: '/high-protein-shopping-list',
    reason: 'Overlaps the existing high protein shopping list.',
  },
  {
    query: 'family meal planner australia',
    href: '/family-meal-plan',
    reason: 'Overlaps the existing family meal plan page.',
  },
  {
    query: 'macro friendly meal ideas',
    href: '/macro-meal-planner',
    reason: 'Overlaps the macro meal planner, which already writes 7 days to the targets you set.',
  },
  {
    query: 'meal plan for weight loss australia',
    href: '/weekly-meal-plan-australia',
    reason: 'Dropped for health-claim risk. Index does not promise a result. This is not medical nutrition.',
  },
  {
    query: 'meal plan for muscle gain',
    href: '/meal-plan-and-workout-plan',
    reason: 'Dropped for health-claim risk. Index does not promise a result. This is not medical nutrition.',
  },
  {
    query: 'vegetarian high protein meal plan',
    href: '/high-protein-staples-meal-plan',
    reason: 'Index does not state a vegetarian feature or a gluten free feature, so the page is not shipped.',
  },
  {
    query: 'how much protein do I need a day',
    href: '/high-protein-staples-meal-plan',
    reason: 'Dropped. The homepage says the engine sets the day\'s calories and protein from the weight you log, and does not answer a daily protein amount.',
  },
  {
    query: 'how the shopping list follows the meals',
    href: '/grocery-meal-planner',
    reason: 'Dropped. The homepage already says the list is the food for the meals you lock, and you check out at the supermarket.',
  },
];

const PAGES = [
  {
    slug: 'weekly-meal-plan-australia',
    query: 'weekly meal plan australia',
    layout: 'steps',
    title: 'Weekly Meal Plan Australia | FitMunch',
    description: 'Set a goal. FitMunch plans 7 days of meals and training from the body you log. The grocery list, supermarket trolley, and family week are separate pages.',
    h1: '7 days of meals and training from your body',
    answer: 'Set a goal. FitMunch plans 7 days of meals and training from the body you log, then writes the shopping list. This page is that week of meals and training. The grocery list, the supermarket trolley, and a family week each have their own page.',
    intro: 'The week starts with your body. Weight, goal and training set the calories and the protein.',
    steps: [
      ['Commit', 'Pick the week. The engine writes meals and training from your body, not a blank recipe pile.'],
      ['Meals and training', 'FitMunch plans 7 days of meals and training. Weekly training plans and workout tracking sit with the meals.'],
      ['Then the shop', 'The trolley is the food for the meals you lock. The grocery, supermarket, and family pages cover that shop.'],
    ],
    faqs: [
      ['Where does the week start?', 'With the health engine. You log your body and the goal. FitMunch writes the meals and the training, then the shopping list.'],
      ['What does the engine set?', 'You log the weight you are and the weight you are heading for. The engine sets the day\'s calories and protein.'],
      ['Is the grocery list on this page?', 'No. The grocery meal planner, the supermarket meal planner, and the family meal plan each have their own page.'],
      ['Is this medical nutrition?', 'This is not medical nutrition.'],
    ],
    links: [
      ['/grocery-meal-planner', 'Grocery meal planner'],
      ['/supermarket-meal-planner', 'Supermarket meal planner'],
      ['/family-meal-plan', 'Family meal plan'],
      ['/meal-plan-and-workout-plan', 'Meal plan and workout plan'],
      ['/high-protein-staples-meal-plan', 'High protein staples meal plan'],
      ['/macro-meal-planner', 'Macro meal planner'],
      ['/meal-prep-shopping-list', 'Meal prep shopping list'],
      ['/high-protein-shopping-list', 'High protein shopping list'],
    ],
  },
  {
    slug: 'quick-weeknight-dinners',
    query: 'easy dinners for busy weeknights',
    layout: 'list',
    title: 'Quick Weeknight Dinners, Planned | FitMunch',
    description: 'Dinner sits with breakfast, lunch and a snack on the targets the engine set. The trolley is the food for the meals you lock.',
    h1: 'Quick weeknight dinners, planned',
    answer: 'Dinner is one meal on the day. Breakfast, lunch, dinner and a snack land on the targets the engine set. FitMunch plans 7 days of meals, and the trolley is the food for the meals you lock. You check out at the supermarket.',
    intro: 'Swap one meal and the day stays on the same numbers. The list is the ingredients for that week.',
    rows: [
      ['Dinner', 'one meal on the day'],
      ['Breakfast, lunch, snack', 'the rest of the day'],
      ['Chicken breast 1kg', '4 dinners'],
      ['The trolley', 'the food for the meals you lock'],
    ],
    faqs: [
      ['Where does dinner sit?', 'Breakfast, lunch, dinner and a snack land on the targets the engine set. Swap one meal and the day stays on the same numbers.'],
      ['What is the trolley?', 'The trolley is the food for the meals you lock. The list is the ingredients for that week.'],
      ['Who checks out?', 'You check out at the supermarket. Approve is the plan, not a supermarket checkout.'],
      ['Does FitMunch show shop prices?', 'FitMunch does not show supermarket prices. The list is the food for the meals you locked.'],
    ],
    links: [
      ['/meal-prep-shopping-list', 'Meal prep shopping list'],
      ['/meal-plan-for-one', 'Meal plan for one'],
      ['/family-meal-plan', 'Family meal plan'],
      ['/grocery-meal-planner', 'Grocery meal planner'],
    ],
  },
  {
    slug: 'macro-tracking-or-a-meal-plan',
    query: 'calorie counting vs meal planning',
    layout: 'compare',
    title: 'Macro Tracking or a Meal Plan | FitMunch',
    description: 'Macro and meal logging keeps a log. The engine plans 7 days of meals and training from the body you log, then writes the shopping list.',
    h1: 'Macro tracking or a meal plan',
    answer: 'Macro logging is a log of meals. A meal plan is the engine writing 7 days of meals and training from the body you log, then the shopping list. Weight, goal and training set the calories and the protein. Meals hit those numbers. You check out at the supermarket.',
    intro: 'Free includes macro and meal logging. Premium unlocks the coach, meal plans, training, and the drafted trolley.',
    table: {
      caption: 'Macro tracking or a meal plan',
      headers: ['', 'What it is'],
      rows: [
        ['Macro logging', 'Macro and meal logging. A log of meals you keep yourself.'],
        ['Meal plan', 'The engine plans 7 days of meals and training from the body you log, then writes the shopping list.'],
        ['Calories and protein', 'Weight, goal and training set the calories and the protein. The engine sets the day\'s calories and protein.'],
        ['After the shop', 'A receipt comes after the shop. FitMunch scores that haul.'],
      ],
    },
    faqs: [
      ['What is macro logging?', 'Macro and meal logging. It is on the free plan, with a starter plan allowance.'],
      ['What is a meal plan here?', 'FitMunch plans 7 days of meals and training, writes the shopping list and scores your receipt.'],
      ['What sets the calories and the protein?', 'Weight, goal and training. The engine sets the day\'s calories and protein.'],
      ['When does a receipt come in?', 'After you have shopped. Photograph any supermarket receipt and FitMunch scores that haul.'],
    ],
    links: [
      ['/macro-meal-planner', 'Macro meal planner'],
      ['/ai-meal-planner-australia', 'AI meal planner Australia'],
      ['/pricing', 'Pricing'],
      ['/receipt-nutrition-scanner', 'Receipt nutrition scanner'],
    ],
  },
  {
    slug: 'how-to-plan-meals-when-you-are-busy',
    query: 'how to plan when the day is busy',
    layout: 'steps',
    title: 'How to Plan Meals When You Are Busy | FitMunch',
    description: 'You commit to the week. FitMunch plans eat, train, and shop from the body you log. The engine writes meals and training from your body.',
    h1: 'How to plan meals when you are busy',
    answer: 'You commit to the week. FitMunch plans eat, train, and shop from the body you log. Pick the week. The engine writes meals and training from your body, not a blank recipe pile. Then you eat what the week planned and train to match.',
    intro: 'You commit to the week. FitMunch plans eat, train, and shop from the body you log.',
    steps: [
      ['Commit', 'Pick the week. You commit to the week before the days arrive.'],
      ['Eat, train, and shop', 'The engine writes meals and training from your body, not a blank recipe pile.'],
      ['Cook and train', 'Eat what the week planned. Train to match. A receipt comes after the shop, not as the first screen.'],
    ],
    faqs: [
      ['What do I commit to?', 'The week. FitMunch plans eat, train, and shop from the body you log.'],
      ['What does the engine write?', 'Meals and training from your body, not a blank recipe pile.'],
      ['What do I do with the week?', 'Eat what the week planned. Train to match.'],
      ['When does the receipt come in?', 'After the shop, not as the first screen. The receipt camera is not the first screen.'],
    ],
    links: [
      ['/weekly-meal-plan-australia', 'Weekly meal plan Australia'],
      ['/meal-prep-shopping-list', 'Meal prep shopping list'],
      ['/meal-plan-for-one', 'Meal plan for one'],
      ['/supermarket-meal-planner', 'Supermarket meal planner'],
    ],
  },
  {
    slug: 'meal-plan-and-workout-plan',
    query: 'meal plan for gym beginners',
    layout: 'steps',
    title: 'Meal Plan and Workout Plan | FitMunch',
    description: 'Weekly training plans and workout tracking sit with 7 days of meals. You log your body and the goal. The trolley follows the meals you lock.',
    h1: 'Meal plan and workout plan',
    answer: 'FitMunch plans 7 days of meals and training. Weekly training plans and workout tracking sit with the meals. You log your body and the goal. The trolley is the food for the meals you lock. You check out at the supermarket.',
    intro: 'Premium includes meal plans and shopping lists, plus weekly training plans and workout tracking.',
    steps: [
      ['Body and goal', 'You log your body and the goal. Weight, goal and training set the calories and the protein.'],
      ['Training', 'Weekly training plans and workout tracking. Train to match the week.'],
      ['Meals and trolley', '7 days of meals. The trolley is the food for the meals you lock. You check out at the supermarket.'],
    ],
    faqs: [
      ['What training is in the week?', 'Weekly training plans and workout tracking, with the meals.'],
      ['What sets the meals?', 'Weight, goal and training set the calories and the protein. The engine sets the day\'s calories and protein.'],
      ['Who checks out?', 'You do. You check out at the supermarket. FitMunch does not show supermarket prices.'],
      ['Is this medical nutrition?', 'This is not medical nutrition. You stay the coach if you train other people. FitMunch writes the plan.'],
    ],
    links: [
      ['/for-pts', 'For personal trainers'],
      ['/pt-client-meal-plans', 'PT client meal plans'],
      ['/weekly-meal-plan-australia', 'Weekly meal plan Australia'],
      ['/macro-meal-planner', 'Macro meal planner'],
    ],
  },
  {
    slug: 'how-to-plan-meals-in-australia',
    query: 'how to plan meals in australia',
    layout: 'compare',
    title: 'How to Plan Meals in Australia | FitMunch',
    description: 'Macro logging, a week the engine writes, or a receipt after the shop. FitMunch plans 7 days of meals and training, then the shopping list.',
    h1: 'How to plan meals in Australia',
    answer: 'Macro and meal logging is one way. The engine is another: it plans 7 days of meals and training from the body you log, then writes the shopping list. A receipt comes after the shop. FitMunch scores that haul from the lines it found.',
    intro: 'Macro and meal logging, a week the engine writes, and a receipt after the shop.',
    table: {
      caption: 'How to plan meals in Australia',
      headers: ['Way', 'What happens'],
      rows: [
        ['Macro logging', 'Macro and meal logging on the free plan.'],
        ['The engine', 'Set a goal. FitMunch plans 7 days of meals and training, writes the shopping list and scores your receipt.'],
        ['After the shop', 'A receipt comes after the shop. Photograph any supermarket receipt. The score is from that trolley.'],
      ],
    },
    faqs: [
      ['Does this page rank them?', 'No. It describes macro logging, the engine, and a receipt after the shop. Those are on the homepage.'],
      ['What does the engine plan?', '7 days of meals and training from the body you log, then the shopping list.'],
      ['What is the receipt for?', 'A receipt closes what you actually bought. It is not the first screen.'],
      ['Is FitMunch a web app?', 'FitMunch is a web app today. Approve is the plan, not a supermarket checkout.'],
    ],
    links: [
      ['/ai-meal-planner-australia', 'AI meal planner Australia'],
      ['/pricing', 'Pricing'],
      ['/receipt-nutrition-scanner', 'Receipt nutrition scanner'],
      ['/haul-teardown', 'Haul teardown'],
    ],
  },
  {
    slug: 'lunches-for-work',
    query: 'lunch ideas for work',
    layout: 'list',
    title: 'Lunches for Work, Planned | FitMunch',
    description: 'Lunch is one meal on the day, with breakfast, dinner and a snack. The list is the ingredients for that week. You check out at the supermarket.',
    h1: 'Lunches for work, planned',
    answer: 'Lunch is one meal on the day, with breakfast, dinner and a snack. Those meals land on the targets the engine set. The list is the ingredients for that week, and the trolley is the food for the meals you lock. You check out at the supermarket.',
    intro: 'Breakfast, lunch, dinner and a snack land on those targets. The list is the ingredients for that week.',
    rows: [
      ['Lunch', 'one meal on the day'],
      ['Eggs x12', '6 lunches'],
      ['Breakfast, dinner, snack', 'the rest of the day'],
      ['The list', 'the ingredients for that week'],
    ],
    faqs: [
      ['Where does lunch sit?', 'With breakfast, dinner and a snack. Those meals land on the targets the engine set.'],
      ['Can I swap a lunch?', 'Swap one meal and the day stays on the same numbers.'],
      ['What is the list?', 'The ingredients for that week. The trolley is the food for the meals you lock.'],
      ['Who checks out?', 'You check out at the supermarket. FitMunch does not show supermarket prices.'],
    ],
    links: [
      ['/meal-plan-for-one', 'Meal plan for one'],
      ['/meal-prep-shopping-list', 'Meal prep shopping list'],
      ['/family-meal-plan', 'Family meal plan'],
      ['/macro-meal-planner', 'Macro meal planner'],
    ],
  },
];

const RETIRED_SLUGS = [
  'meal-plan-for-weight-loss-australia',
  'meal-plan-for-muscle-gain',
  'easy-healthy-dinners-for-busy-weeknights',
  'calorie-counting-vs-meal-planning',
  'how-to-eat-healthy-when-busy',
  'meal-plan-for-gym-beginners',
  'vegetarian-high-protein-meal-plan',
  'best-meal-planning-app-australia',
  'stop-wasting-food-and-money-on-groceries',
  'healthy-lunch-ideas-for-work',
  'how-much-protein-do-i-need-a-day',
  'list-for-the-meals-you-lock',
  'macro-logging-or-meal-plan',
  'commit-to-the-week',
  'meals-and-training-for-the-week',
  'ways-to-plan-meals-australia',
];

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function jsonScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function assertPublicSlug(slug, publicDir = PUBLIC_DIR) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) {
    throw new Error(`slug rejected: ${slug}`);
  }
  const root = path.resolve(publicDir);
  const file = path.resolve(root, `${slug}.html`);
  if (file !== path.join(root, `${slug}.html`) || !file.startsWith(root + path.sep)) {
    throw new Error(`slug resolves outside public/: ${slug}`);
  }
  return file;
}

const BANNED = [
  [/\u2014/, 'em dash'],
  [/\u2013/, 'en dash'],
  [/ -- /, 'double hyphen'],
  [/\bbudget\b/i, 'budget'],
  [/\bcheap(?:er|est|ly)?\b/i, 'cheap'],
  [/\bsavings?\b/i, 'saving'],
  [/\bspend(?:ing)? less\b/i, 'spend less'],
  [/\bweight loss\b/i, 'weight loss'],
  [/\blose weight\b/i, 'lose weight'],
  [/\bmuscle gain\b/i, 'muscle gain'],
  [/\bhealthy\b/i, 'healthy'],
  [/\bbest\b/i, 'best'],
  [/waste less/i, 'waste less'],
  [/woolworths|woolies|\bcoles\b|\baldi\b|\biga\b|costco/i, 'store name'],
  [/pty ltd/i, 'Pty Ltd'],
  [/inc\.?\s*gst/i, 'inc. GST'],
  [/\$|&#0*36;|&#x0*24;|&dollar;/i, 'price mark'],
  [/\bthe total\b/i, 'the total'],
  [/dietitian/i, 'dietitian'],
  [/app store/i, 'App Store'],
  [/aggregaterating/i, 'AggregateRating'],
  [/buys your groceries/i, 'buys groceries'],
  [/automatic checkout/i, 'automatic checkout'],
  [/\bGrok\b|\bOpenClaw\b|\bMRR\b/i, 'internal name'],
  [/(?<!user[-_ ]?)\bagents?\b/i, 'agent'],
  [/per\s*kg/i, 'per kg'],
  [/vegetarian mode/i, 'vegetarian mode'],
  [/gluten free/i, 'gluten free'],
  [/\bvegetarian\b/i, 'vegetarian'],
];

function withoutAllowedTrial(html) {
  const label = TRIAL_LABEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(html)
    .split(TRIAL_SENTENCE)
    .join('')
    .split(TRIAL_REST)
    .join('')
    .replace(new RegExp(`${label}(?=<)`, 'g'), '');
}

function guardHits(html) {
  const hits = [];
  for (const [re, label] of BANNED) {
    if (re.test(html)) hits.push(label);
    re.lastIndex = 0;
  }
  if (/trial|14-day/i.test(withoutAllowedTrial(html))) hits.push('trial sentence');
  return hits;
}

function renderPage(page) {
  assertPublicSlug(page.slug);
  const url = `${SITE}/${page.slug}`;
  const faqEntities = page.faqs.map(([name, text]) => ({
    '@type': 'Question',
    name,
    acceptedAnswer: { '@type': 'Answer', text },
  }));
  const webPage = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    description: page.description,
    url,
    inLanguage: 'en-AU',
    isPartOf: { '@type': 'WebSite', name: 'FitMunch', url: `${SITE}/` },
  };
  const faqPage = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqEntities,
  };
  const faqs = page.faqs.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('');
  const links = page.links.map(([href, label]) => `<li><a href="${esc(href)}">${esc(label)}</a></li>`).join('');
  const cta = `<a class="fm-btn fm-btn-leaf" href="${TRIAL_HREF}" data-fm-auth="register" data-fm-plan="premium">${TRIAL_LABEL}</a>`;
  let primary = '';
  if (page.layout === 'steps') {
    const steps = page.steps.map(([title, body], i) => (
      `<article><div class="n">${String(i + 1).padStart(2, '0')}</div><h3>${esc(title)}</h3><p>${esc(body)}</p></article>`
    )).join('');
    primary = `<div class="ln-steps">${steps}</div>`;
  } else if (page.layout === 'list') {
    const rows = page.rows.map(([name, role]) => `<li><span>${esc(name)}</span><em>${esc(role)}</em></li>`).join('');
    primary = `<ul class="ln-rows">${rows}</ul>`;
  } else if (page.layout === 'compare') {
    const head = page.table.headers.map((cell) => `<th scope="col">${esc(cell)}</th>`).join('');
    const body = page.table.rows.map(([way, what]) => `<tr><th scope="row">${esc(way)}</th><td>${esc(what)}</td></tr>`).join('');
    primary = `<table class="ln-table"><caption>${esc(page.table.caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }
  const aside = page.layout === 'list'
    ? `<aside class="ln-card" aria-label="${esc(page.h1)}"><div class="ln-card-top"><b>From the week</b><span>Meals you lock</span></div>${primary}<p class="ln-card-foot">You check out at the supermarket. FitMunch does not show supermarket prices.</p></aside>`
    : '';

  return `<!DOCTYPE html>
<html lang="en-AU">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${esc(page.title)}</title>
<meta name="description" content="${esc(page.description)}"/>
<link rel="canonical" href="${url}"/>
<meta property="og:title" content="${esc(page.title)}"/>
<meta property="og:description" content="${esc(page.description)}"/>
<meta property="og:url" content="${url}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="FitMunch"/>
<meta property="og:locale" content="en_AU"/>
<meta property="og:image" content="${SITE}/assets/og-image.jpg"/>
<meta property="og:image:alt" content="FitMunch"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(page.title)}"/>
<meta name="twitter:description" content="${esc(page.description)}"/>
<meta name="twitter:image" content="${SITE}/assets/og-image.jpg"/>
<meta name="theme-color" content="#07130d"/>
<link rel="icon" type="image/svg+xml" href="/assets/logo.svg"/>
<link rel="stylesheet" href="/css/fm-tokens.css"/>
<link rel="stylesheet" href="/css/fm-shell.css"/>
<link rel="stylesheet" href="/css/fm-lander.css"/>
<style>
.ln-answer .fm-brand img{width:28px;height:28px;border-radius:7px}
.ln-answer .fm-nav{position:relative;background:#07130d;flex-wrap:wrap;row-gap:8px}
.ln-answer .ln-hero{padding-top:28px}
.ln-answer .ln-hero h1{max-width:22ch}
.ln-answer.layout-steps .ln-hero-inner,.ln-answer.layout-compare .ln-hero-inner{grid-template-columns:minmax(0,1fr)}
.ln-answer.layout-steps .ln-lead,.ln-answer.layout-compare .ln-lead{max-width:62ch}
.ln-answer .ln-table{width:100%;border-collapse:collapse;margin-top:8px;background:#fff;border:1px solid var(--line)}
.ln-answer .ln-table caption{text-align:left;font-family:'Bricolage Grotesque','Bricolage Grotesque Fallback',system-ui,sans-serif;font-weight:800;font-size:1.15rem;padding:0 0 12px;caption-side:top}
.ln-answer .ln-table th,.ln-answer .ln-table td{text-align:left;vertical-align:top;padding:14px 16px;border-bottom:1px solid var(--line);font-size:1rem;line-height:1.5}
.ln-answer .ln-table thead th{font-family:'IBM Plex Mono','IBM Plex Mono Fallback',ui-monospace,monospace;font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;color:var(--mute)}
.ln-answer .ln-table tbody th{font-family:'Bricolage Grotesque','Bricolage Grotesque Fallback',system-ui,sans-serif;font-weight:800;width:34%}
.ln-answer .ln-rows{list-style:none;margin:0;padding:0}
.ln-answer .ln-rows li{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px dashed rgba(255,255,255,.16);color:#e8efe6}
.ln-answer .ln-rows li span{font-weight:700}
.ln-answer .ln-rows li em{font-style:normal;font-family:'IBM Plex Mono','IBM Plex Mono Fallback',ui-monospace,monospace;font-size:.78rem;color:#c5d4c8;text-align:right}
.ln-answer .ln-offer{margin-top:8px}
.ln-answer .ln-price{display:inline-grid;max-width:100%;vertical-align:baseline;justify-items:stretch;align-items:start}
.ln-answer .ln-price>.ln-price-fallback,.ln-answer .ln-price>.ln-price-live{grid-area:1/1;min-width:0}
.ln-answer .ln-price.is-ready>.ln-price-fallback{visibility:hidden}
.ln-answer .ln-small .ln-price-fallback a,.ln-answer .ln-section .ln-price-fallback a,.ln-answer .ln-offer .ln-price-fallback a{display:inline;min-height:0;height:auto;padding:0;line-height:inherit}
@media(max-width:860px){
  .ln-answer.layout-list .ln-hero-inner{grid-template-columns:minmax(0,1fr)}
}
@media(max-width:640px){
  .ln-answer .ln-table thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .ln-answer .ln-table,.ln-answer .ln-table tbody,.ln-answer .ln-table tr,.ln-answer .ln-table th,.ln-answer .ln-table td{display:block;width:100%}
  .ln-answer .ln-table tbody th{width:auto;padding-bottom:0;border-bottom:0}
  .ln-answer .ln-table td{padding-top:4px}
}
@media(max-width:390px){
  .ln-answer .ln-table caption{display:block;width:100%}
}
</style>
<script type="application/ld+json">${jsonScript(webPage)}</script>
<script type="application/ld+json">${jsonScript(faqPage)}</script>
</head>
<body class="fm-body ln-answer layout-${esc(page.layout)}">
<nav class="fm-nav" aria-label="Primary">
  <a class="fm-brand" href="/" aria-label="FitMunch"><img src="/assets/logo.svg" alt="" width="28" height="28"/>FitMunch</a>
  <div class="fm-nav-links">
    <a href="/#loop">How it works</a>
    <a href="/pricing">Pricing</a>
    <a href="/login.html" data-fm-auth="login">Sign in</a>
    <a class="fm-nav-cta" href="${TRIAL_HREF}" data-fm-auth="register" data-fm-plan="premium">${TRIAL_LABEL}</a>
  </div>
</nav>
<main>
<header class="ln-hero">
  <div class="ln-hero-inner">
    <div>
      <div class="ln-kicker">Short answer</div>
      <h1>${esc(page.h1)}</h1>
      <p class="ln-lead ln-answer-text">${esc(page.answer)}</p>
      <div class="ln-ctas">${cta}</div>
      <p class="ln-small ln-offer">${TRIAL_SENTENCE}</p>
    </div>
    ${aside}
  </div>
</header>
<section class="ln-section">
  <div class="ln-inner">
    <h2>How it works</h2>
    <p>${esc(page.intro)}</p>
    ${page.layout === 'list' ? '' : primary}
  </div>
</section>
<section class="ln-section faq" style="padding-top:0">
  <div class="ln-inner">
    <h2>Questions people ask</h2>
    <dl>${faqs}</dl>
    <p class="ln-sign">More questions? <a href="/support">Visit support</a>.</p>
  </div>
</section>
<section class="ln-section" style="padding-top:0">
  <div class="ln-inner">
    <h2>Plan from here</h2>
    <ul class="ln-links">${links}</ul>
  </div>
</section>
<section class="ln-section" style="padding-top:0">
  <div class="ln-inner">
    <div class="fm-convert">
      <h2>${TRIAL_LABEL}</h2>
      <p class="ln-offer">${TRIAL_SENTENCE}</p>
      <div class="fm-ctas">${cta}</div>
    </div>
  </div>
</section>
</main>
<footer class="fm-footer">
  <div class="fm-footer-inner">
    <div class="fm-footer-brand">FitMunch</div>
    <div class="fm-footer-links">
      <a href="/#loop">How it works</a>
      <a href="/pricing">Pricing</a>
      <a href="/ai-meal-planner-australia">AI meal planner</a>
      <a href="/high-protein-staples-meal-plan">High protein staples meal plan</a>
      <a href="/haul-teardown">Haul teardown</a>
      <a href="/receipt-nutrition-scanner">Receipt scanner</a>
      <a href="/for-pts.html">For trainers</a>
      <a href="/contact">Contact</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/refund">Refunds</a>
      <a href="/login.html" data-fm-auth="login">Sign in</a>
    </div>
    <p class="fm-footer-note">© 2026 FitMunch. Made in Australia for Australian shops. FitMunch is a web app in your browser. On iPhone you can Add to Home Screen. This is not medical nutrition.</p>
  </div>
</footer>
<script src="/js/fm-track.js" defer></script>
<script>
(function () {
  if (!window.fetch) return;
  fetch('/api/pricing/config', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg) return;
      document.querySelectorAll('[data-fm-price]').forEach(function (el) {
        var key = el.getAttribute('data-fm-price');
        var live = el.querySelector('.ln-price-live');
        if (live && cfg[key]) {
          live.textContent = cfg[key] + ${JSON.stringify(TRIAL_REST)};
          el.classList.add('is-ready');
        }
      });
    })
    .catch(function () {});
})();
</script>
<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments);};
window.va('beforeSend',function(e){try{var u=new URL(e.url);return Object.assign({},e,{url:u.origin+u.pathname});}catch(_){return null;}});</script>
<script defer src="/_vercel/insights/script.js"></script>
</body>
</html>
`;
}

function buildPage(page) {
  return stampHtml(renderPage(page));
}

function auditIssues() {
  const issues = [];
  if (PAGES.length < 7 || PAGES.length > 12) issues.push(`page count ${PAGES.length}`);
  const seen = new Map();
  for (const key of ['slug', 'title', 'description', 'h1', 'answer']) seen.set(key, new Set());
  const linked = new Set();
  for (const page of PAGES) {
    try { assertPublicSlug(page.slug); } catch (err) { issues.push(err.message); }
    for (const key of seen.keys()) {
      if (seen.get(key).has(page[key])) issues.push(`duplicate ${key}: ${page[key]}`);
      seen.get(key).add(page[key]);
    }
    const words = wordCount(page.answer);
    if (words < 40 || words > 60) issues.push(`${page.slug} answer words ${words}`);
    if (page.title.length > 60) issues.push(`${page.slug} title length ${page.title.length}`);
    if (page.description.length < 80 || page.description.length > 155) {
      issues.push(`${page.slug} description length ${page.description.length}`);
    }
    if (page.layout === 'steps' && (!page.steps || page.steps.length !== 3)) issues.push(`${page.slug} steps`);
    if (page.layout === 'list') {
      if (!page.rows || page.rows.length < 3) issues.push(`${page.slug} rows`);
      for (const row of page.rows || []) {
        if (!row[0] || !row[1]) issues.push(`${page.slug} blank row`);
      }
    }
    if (page.layout === 'compare' && (!page.table || page.table.rows.length < 3)) issues.push(`${page.slug} table`);
    if (page.faqs.length < 4) issues.push(`${page.slug} faqs`);
    for (const [href] of page.links) linked.add(href);
    const html = renderPage(page);
    const hits = guardHits(html);
    if (hits.length) issues.push(`${page.slug} ${hits.join(', ')}`);
    const ctas = [...html.matchAll(/<a\b[^>]*class="[^"]*(?:fm-btn|fm-nav-cta)[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1]);
    if (ctas.length < 3 || ctas.some((text) => text !== TRIAL_LABEL)) issues.push(`${page.slug} cta wording`);
    if (!html.includes(`href="${TRIAL_HREF}"`)) issues.push(`${page.slug} trial href`);
    if ((html.split(TRIAL_SENTENCE).length - 1) < 2) issues.push(`${page.slug} trial sentence`);
    if (page.plainFigures) {
      const body = html.replace(/<footer[\s\S]*<\/footer>/i, '');
      if (/\bgrams?\b/i.test(body) || /\bkg\b/i.test(body) || /per\s*kg/i.test(body) || /\d+\s*g\b/i.test(body)) {
        issues.push(`${page.slug} protein figure`);
      }
    }
    for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      const data = JSON.parse(block[1]);
      if (data['@type'] === 'AggregateRating' || data.aggregateRating || data.offers) issues.push(`${page.slug} rating or offer`);
    }
  }
  for (const skip of SKIPPED) {
    if (!skip.reason || skip.reason.length < 40) issues.push(`short skip reason: ${skip.query}`);
    if (!linked.has(skip.href)) issues.push(`skip target not linked: ${skip.href}`);
  }
  const dropped = SKIPPED.filter((skip) => /health-claim risk/i.test(skip.reason)).map((skip) => skip.query);
  if (dropped.length < 2) issues.push('health-claim skips missing');
  return issues;
}

module.exports = {
  SITE,
  TRIAL_HREF,
  TRIAL_LABEL,
  TRIAL_SENTENCE,
  PUBLIC_DIR,
  PAGES,
  SKIPPED,
  RETIRED_SLUGS,
  wordCount,
  renderPage,
  buildPage,
  auditIssues,
  guardHits,
  assertPublicSlug,
  withoutAllowedTrial,
};
