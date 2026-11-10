'use strict';

/**
 * Answer-first pages for meal-planning questions.
 * Canonical host is www: the apex domain redirects there, and every existing
 * public page and sitemap loc already uses https://www.fitmunch.com.au.
 * Trial href and the 14-day length are copied from the homepage button.
 * Copy stays inside features the site already describes. No prices.
 */

const { stampHtml } = require('./asset-version');

const SITE = 'https://www.fitmunch.com.au';
const TRIAL_HREF = '/login.html?plan=premium#register';
const TRIAL_LABEL = 'Start the 14-day trial';
const TRIAL_NOTE = 'Card on file. Cancel before the trial ends and you are not charged. The trial is on the web.';
const GUIDELINES = {
  phrase: 'Australian Dietary Guidelines',
  href: 'https://www.eatforhealth.gov.au/guidelines',
};

const SKIPPED = [
  {
    query: 'high protein meal plan australia',
    href: '/high-protein-staples-meal-plan',
    reason: 'Overlaps the existing high protein staples meal plan, which already plans a high protein week from everyday staples.',
  },
  {
    query: 'healthy meal prep for the week on a budget',
    href: '/meal-prep-shopping-list',
    reason: 'Overlaps the weekly meal prep shopping list. The word budget is also banned in served copy, and the query is a money frame.',
  },
  {
    query: 'how to plan meals and a grocery list for the week',
    href: '/grocery-meal-planner',
    reason: 'Overlaps the grocery meal planner, the meal prep shopping list, and the AI meal plan with a shopping list.',
  },
  {
    query: 'high protein grocery list',
    href: '/high-protein-shopping-list',
    reason: 'Overlaps the existing high protein shopping list, which is already sized to a target you set.',
  },
  {
    query: 'family meal planner australia',
    href: '/family-meal-plan',
    reason: 'Overlaps the existing family meal plan page for an Australian household week.',
  },
  {
    query: 'macro friendly meal ideas',
    href: '/macro-meal-planner',
    reason: 'Overlaps the macro meal planner, which already writes 7 days to the targets you set.',
  },
];

const PAGES = [
  {
    slug: 'weekly-meal-plan-australia',
    query: 'weekly meal plan australia',
    title: 'Weekly Meal Plan Australia | FitMunch',
    description: 'Plan a weekly meal plan in Australia: seven days of meals and training to targets you set, then one shopping list. The trial is on the web.',
    h1: 'Weekly meal plan Australia: seven days, one list',
    kicker: 'Short answer',
    answer: 'A weekly meal plan in Australia is seven days of meals written to the calorie and protein targets you set, plus one shopping list for that week. FitMunch is a health engine for food, fitness and shopping. It plans the meals and the training, then you check out at the store yourself.',
    intro: 'FitMunch is a health engine for food, fitness and shopping. The week is meals, training and one list. You shop that list yourself.',
    steps: [
      ['Log a goal', 'You log your body and a goal. Calories and protein for the day come from the targets you set.'],
      ['Plan seven days', 'FitMunch writes 7 days of meals and training. You can change the targets and write a new week.'],
      ['Shop the list', 'The shopping list is the food for the meals you lock. You check out at the store. FitMunch never places or pays for the order.'],
    ],
    faqs: [
      ['What is a weekly meal plan here?', 'Seven days of meals and training written to calorie and protein targets you set, then one shopping list for that week.'],
      ['Does FitMunch order the shop?', 'No. FitMunch drafts the list. You check out at the store and pay the store directly. FitMunch never places or pays for your supermarket order.'],
      ['Is training part of the same week?', 'Yes. The health engine plans meals and training together, then writes the shopping list from the meals you lock.'],
      ['Where does the trial run?', 'The trial is on the web. Card on file. Cancel before the trial ends and you are not charged.'],
    ],
    links: [
      ['/supermarket-meal-planner', 'Supermarket meal planner'],
      ['/grocery-meal-planner', 'Grocery meal planner'],
      ['/ai-meal-planner-australia', 'AI meal planner Australia'],
      ['/family-meal-plan', 'Family meal plan'],
      ['/high-protein-staples-meal-plan', 'High protein staples meal plan'],
    ],
    cardTitle: 'Draft week',
    cardSub: 'Worked example',
    days: [['Mon', 'Oats'], ['Tue', 'Chicken'], ['Wed', 'Rice'], ['Thu', 'Eggs'], ['Fri', 'Fish'], ['Sat', 'Beans'], ['Sun', 'Soup']],
    lines: [['oats', '1 pack'], ['chicken thigh', '1 pack'], ['brown rice', '1 bag'], ['eggs', '1 carton']],
    close: 'Plan the Australian week on the web. Meals, training and one list. You check out at the store.',
  },
  {
    slug: 'meal-plan-for-weight-loss-australia',
    query: 'meal plan for weight loss australia',
    title: 'Meal Plan for Weight Loss Australia | FitMunch',
    description: 'Plan meals for a weight loss goal in Australia. FitMunch writes the week to targets you set and does not guarantee weight loss or any health outcome.',
    h1: 'A meal plan for weight loss, written to targets you set',
    kicker: 'Short answer',
    answer: 'A meal plan for weight loss in Australia is a week of meals written to calorie and protein targets you set from the weight you are and the weight you are heading for. FitMunch plans that week and the shopping list. It does not guarantee weight loss or any health outcome.',
    intro: 'If the goal you set is weight loss, the plan is still a week of meals written to targets you choose. FitMunch does not guarantee weight loss, muscle gain, or any health outcome.',
    steps: [
      ['Log where you are heading', 'You log the weight you are and the weight you are heading for. You set the calorie and protein targets.'],
      ['Write the meals', 'FitMunch plans 7 days of meals and training to those targets. This is food planning, not a promised result.'],
      ['Shop it yourself', 'One shopping list follows the meals you lock. You check out at the store. FitMunch never places or pays for the order.'],
    ],
    faqs: [
      ['Will this plan make me lose weight?', 'No. FitMunch does not guarantee weight loss or any health outcome. It writes meals to calorie and protein targets you set.'],
      ['Who chooses the targets?', 'You do. You log your body and the goal. The engine uses the calorie and protein targets in your plan.'],
      ['Is this medical advice?', 'No. It is food planning support only, not medical advice. A health professional is the right person for personal advice.'],
      ['Does the trial run on the web?', 'Yes. The trial is on the web. Card on file. Cancel before the trial ends and you are not charged.'],
    ],
    links: [
      ['/macro-meal-planner', 'Macro meal planner'],
      ['/meal-plan-for-one', 'Meal plan for one'],
      ['/high-protein-staples-meal-plan', 'High protein staples meal plan'],
      ['/ai-meal-planner-australia', 'AI meal planner Australia'],
    ],
    cardTitle: 'Draft week',
    cardSub: 'Targets you set',
    days: [['Mon', 'Eggs'], ['Tue', 'Chicken'], ['Wed', 'Salad'], ['Thu', 'Fish'], ['Fri', 'Rice'], ['Sat', 'Soup'], ['Sun', 'Yoghurt']],
    lines: [['eggs', '1 carton'], ['chicken thigh', '1 pack'], ['leafy greens', '1 bunch'], ['fish', '1 pack']],
    close: 'Plan the week to targets you set. FitMunch does not guarantee weight loss or any health outcome.',
  },
  {
    slug: 'meal-plan-for-muscle-gain',
    query: 'meal plan for muscle gain',
    title: 'Meal Plan for Muscle Gain | FitMunch',
    description: 'Plan meals for a muscle gain goal. FitMunch writes seven days to calorie and protein targets you set. It does not guarantee muscle gain.',
    h1: 'A meal plan for muscle gain, written to targets you set',
    kicker: 'Short answer',
    answer: 'A meal plan for muscle gain is a week of meals and training written to calorie and protein targets you choose. FitMunch plans those seven days and writes one shopping list. It does not guarantee muscle gain or any health outcome. You check out at the store yourself.',
    intro: 'If the goal you set is muscle gain, FitMunch writes meals and training to the calorie and protein targets you choose. It does not guarantee muscle gain or any health outcome.',
    steps: [
      ['Set the targets', 'You choose the calorie and protein targets for the goal you logged. FitMunch does not invent a result.'],
      ['Plan meals and training', 'The health engine writes 7 days of meals and training to those targets.'],
      ['One list, your shop', 'The shopping list is the food for the meals you lock. You check out at the store yourself.'],
    ],
    faqs: [
      ['Does FitMunch guarantee muscle gain?', 'No. FitMunch does not guarantee muscle gain or any health outcome. It plans meals to targets you set.'],
      ['Where does the protein number come from?', 'From you. You set the protein target. FitMunch writes the week to that target and does not tell you the number to use.'],
      ['Is training included?', 'Yes. Weekly training plans sit with the meals. The shopping list still comes from the meals you lock.'],
      ['Who pays for the shop?', 'You do. FitMunch never places or pays for your supermarket order.'],
    ],
    links: [
      ['/high-protein-staples-meal-plan', 'High protein staples meal plan'],
      ['/high-protein-shopping-list', 'High protein shopping list'],
      ['/macro-meal-planner', 'Macro meal planner'],
      ['/for-pts', 'For personal trainers'],
    ],
    cardTitle: 'Draft week',
    cardSub: 'Meals you lock',
    days: [['Mon', 'Oats'], ['Tue', 'Chicken'], ['Wed', 'Rice'], ['Thu', 'Tofu'], ['Fri', 'Eggs'], ['Sat', 'Fish'], ['Sun', 'Beans']],
    lines: [['oats', '1 pack'], ['chicken thigh', '1 pack'], ['rice', '1 bag'], ['eggs', '1 carton']],
    close: 'Plan meals and training to targets you set. You check out at the store. No promised result.',
  },
  {
    slug: 'easy-healthy-dinners-for-busy-weeknights',
    query: 'easy healthy dinners for busy weeknights',
    title: 'Easy Healthy Dinners for Busy Weeknights | FitMunch',
    description: 'Plan dinners for busy weeknights. FitMunch writes seven days of meals to targets you set, then one shopping list you check out yourself.',
    h1: 'Easy healthy dinners for busy weeknights',
    kicker: 'Short answer',
    answer: 'Easy dinners for busy weeknights start with the week already planned. FitMunch writes seven days of meals, including dinners, to the calorie and protein targets you set, then one shopping list. You shop that list yourself. The plan is food for the week, not a promise about health results.',
    intro: 'A busy weeknight is simpler when dinner is already on the plan. FitMunch writes those dinners into the same 7-day plan as the rest of the week, then one shopping list.',
    steps: [
      ['Pick the dinners', 'You commit the dinners you will actually eat. Breakfasts and lunches can sit on the same list.'],
      ['Write them to your targets', 'The week follows the calorie and protein targets you set. FitMunch does not promise a health result.'],
      ['One shop', 'Shared foods are listed once. You check out at the store. FitMunch never places or pays for the order.'],
    ],
    faqs: [
      ['Are these dinners a health treatment?', 'No. They are meals in a weekly plan. FitMunch does not promise a health result and this is not medical advice.'],
      ['Can I repeat a dinner?', 'Yes. Repeat a protein or a carb on purpose and it becomes one line on the shopping list.'],
      ['Do I still shop myself?', 'Yes. Copy or print the list and check out at the store, in person or in your own online order.'],
      ['What else is in the week?', 'Meals and training, then the shopping list. FitMunch is a health engine for food, fitness and shopping.'],
    ],
    links: [
      ['/meal-prep-shopping-list', 'Meal prep shopping list'],
      ['/grocery-meal-planner', 'Grocery meal planner'],
      ['/meal-plan-for-one', 'Meal plan for one'],
      ['/family-meal-plan', 'Family meal plan'],
    ],
    cardTitle: 'Draft dinners',
    cardSub: 'Busy week',
    days: [['Mon', 'Soup'], ['Tue', 'Pasta'], ['Wed', 'Tacos'], ['Thu', 'Curry'], ['Fri', 'Fish'], ['Sat', 'Rice'], ['Sun', 'Eggs']],
    lines: [['pasta', '1 bag'], ['tinned tomatoes', '1 tin'], ['mince', '1 pack'], ['rice', '1 bag']],
    close: 'Plan the dinners with the rest of the week, then shop the list yourself.',
  },
  {
    slug: 'how-much-protein-do-i-need-a-day',
    query: 'how much protein do I need a day',
    title: 'How Much Protein Do I Need a Day? | FitMunch',
    description: 'How much protein you need varies by person and goal. See the Australian Dietary Guidelines or a health professional. FitMunch plans to a target you set.',
    h1: 'How much protein do I need a day?',
    kicker: 'Short answer',
    answer: 'How much protein you need in a day varies by person and by goal. FitMunch does not set that number for you. The Australian Dietary Guidelines and a health professional are the right place to ask. Once you choose a target, FitMunch plans meals to the target you set.',
    intro: 'FitMunch does not tell you how much protein to eat. That varies by person and by goal. Ask a health professional, and read the Australian Dietary Guidelines. FitMunch plans meals to a target you set after that.',
    note: 'Read the Australian Dietary Guidelines or ask a health professional before you pick a target. FitMunch plans to the target you set. This is food planning support, not medical advice.',
    noteLink: GUIDELINES,
    steps: [
      ['Ask outside the app', 'A daily protein need varies by person and by goal. A health professional or the Australian Dietary Guidelines can help you decide.'],
      ['Set your own target', 'You enter the calorie and protein targets. FitMunch does not choose them and does not promise a health result.'],
      ['Plan the week', 'FitMunch writes meals to the target you set, then one shopping list. You check out at the store yourself.'],
    ],
    faqs: [
      ['Does FitMunch tell me how much protein to eat?', 'No. It varies by person and by goal. FitMunch does not publish a figure and does not set the number for you.'],
      ['Where should I look?', 'Read the Australian Dietary Guidelines or ask a health professional. FitMunch is not a substitute for either.'],
      ['What happens after I set a target?', 'FitMunch writes a week of meals to the calorie and protein targets you set, then one shopping list.'],
      ['Is this medical advice?', 'No. Food planning support only, not medical advice. FitMunch does not guarantee any health outcome.'],
    ],
    faqLinks: { 'Where should I look?': GUIDELINES },
    links: [
      ['/high-protein-staples-meal-plan', 'High protein staples meal plan'],
      ['/high-protein-shopping-list', 'High protein shopping list'],
      ['/macro-meal-planner', 'Macro meal planner'],
      ['/support', 'Support'],
    ],
    cardTitle: 'Your target',
    cardSub: 'You set it',
    days: [['Mon', 'Oats'], ['Tue', 'Tofu'], ['Wed', 'Eggs'], ['Thu', 'Lentils'], ['Fri', 'Rice'], ['Sat', 'Yoghurt'], ['Sun', 'Beans']],
    lines: [['tofu', ''], ['lentils', ''], ['eggs', ''], ['yoghurt', '']],
    close: 'Set a protein target with a health professional if you need one. FitMunch plans to the target you enter.',
    plainFigures: true,
  },
  {
    slug: 'calorie-counting-vs-meal-planning',
    query: 'calorie counting vs meal planning',
    title: 'Calorie Counting vs Meal Planning | FitMunch',
    description: 'Calorie counting logs what you ate. Meal planning writes the week and a shopping list to targets you set. FitMunch does the planning on the web.',
    h1: 'Calorie counting vs meal planning',
    kicker: 'Short answer',
    answer: 'Calorie counting logs what you already ate. Meal planning chooses the week first, then writes meals and one shopping list to the calorie and protein targets you set. FitMunch does the planning: seven days of meals and training, then the list. You still check out at the store.',
    intro: 'Counting records the past. Planning writes the next 7 days. FitMunch does the planning: meals, training and one shopping list. It does not promise a health result.',
    steps: [
      ['Counting', 'A count is a log of meals you already ate. Useful as a record. It does not write next week or a shopping list.'],
      ['Planning', 'You set calorie and protein targets. FitMunch writes 7 days of meals and training before you shop.'],
      ['Then the list', 'The shopping list is the food for the meals you lock. You check out at the store yourself.'],
    ],
    faqs: [
      ['Does FitMunch replace a food log?', 'It plans the week ahead. You still choose what you eat. The plan is meals written to targets you set, plus a shopping list.'],
      ['Do I have to count every meal by hand?', 'No. You set the targets and FitMunch writes the week. You can change the targets and write a new week.'],
      ['Which one shops for me?', 'Neither. FitMunch never places or pays for your supermarket order. You check out at the store.'],
      ['Is one of them a medical plan?', 'No. Both are ways to organise food. FitMunch is food planning support, not medical advice.'],
    ],
    links: [
      ['/macro-meal-planner', 'Macro meal planner'],
      ['/ai-meal-planner-australia', 'AI meal planner Australia'],
      ['/meal-plan-for-one', 'Meal plan for one'],
      ['/grocery-meal-planner', 'Grocery meal planner'],
    ],
    cardTitle: 'Planned week',
    cardSub: 'Before the shop',
    days: [['Mon', 'Oats'], ['Tue', 'Chicken'], ['Wed', 'Rice'], ['Thu', 'Eggs'], ['Fri', 'Beans'], ['Sat', 'Fish'], ['Sun', 'Soup']],
    lines: [['oats', '1 pack'], ['chicken thigh', '1 pack'], ['rice', '1 bag'], ['beans', '1 tin']],
    close: 'Plan the week first, then shop the list. The trial is on the web.',
  },
  {
    slug: 'how-to-eat-healthy-when-busy',
    query: 'how to eat healthy when you are busy',
    title: 'How to Eat Healthy When You Are Busy | FitMunch',
    description: 'When you are busy, plan the week first. FitMunch writes seven days of meals and training to targets you set, then one shopping list.',
    h1: 'How to eat healthy when you are busy',
    kicker: 'Short answer',
    answer: 'When the day is busy, eating well starts with a plan you made earlier. FitMunch writes seven days of meals and training to the calorie and protein targets you set, and one shopping list for that week. You check out yourself. The plan does not promise a health result.',
    intro: 'When the day is already full, the useful move is a week you planned before the rush. FitMunch writes meals and training for 7 days, then one list. It does not promise a health result.',
    steps: [
      ['Plan before the rush', 'Set calorie and protein targets once, then let the week be written before the busy days arrive.'],
      ['Meals and training together', 'FitMunch is a health engine for food, fitness and shopping. The same week holds meals and training.'],
      ['Shop once for that week', 'One shopping list covers the meals you lock. You check out at the store. FitMunch never places the order.'],
    ],
    faqs: [
      ['Does a plan make food healthy?', 'No. FitMunch does not promise a health result. It writes meals to targets you set so the week is decided before you are busy.'],
      ['What if I only have time for one shop?', 'The list is built from the whole week, so one shop can cover the meals you committed.'],
      ['Can I change a day?', 'Yes. Change the meals or the targets and write a new week. The list follows what you lock.'],
      ['Is the trial on the web?', 'Yes. The trial is on the web. Card on file. Cancel before the trial ends and you are not charged.'],
    ],
    links: [
      ['/meal-prep-shopping-list', 'Meal prep shopping list'],
      ['/meal-plan-for-one', 'Meal plan for one'],
      ['/supermarket-meal-planner', 'Supermarket meal planner'],
      ['/ai-meal-plan-shopping-list', 'AI meal plan with shopping list'],
    ],
    cardTitle: 'Draft week',
    cardSub: 'Planned ahead',
    days: [['Mon', 'Oats'], ['Tue', 'Wrap'], ['Wed', 'Rice'], ['Thu', 'Soup'], ['Fri', 'Pasta'], ['Sat', 'Eggs'], ['Sun', 'Beans']],
    lines: [['wraps', '1 pack'], ['rice', '1 bag'], ['eggs', '1 carton'], ['beans', '1 tin']],
    close: 'Decide the week before it gets busy, then shop the list yourself.',
  },
  {
    slug: 'meal-plan-for-gym-beginners',
    query: 'meal plan for gym beginners',
    title: 'Meal Plan for Gym Beginners | FitMunch',
    description: 'A first week of meals and training for gym beginners, written to targets you set. FitMunch does not promise a fitness result. The trial is on the web.',
    h1: 'A meal plan for gym beginners',
    kicker: 'Short answer',
    answer: 'A meal plan for gym beginners is a first week of meals and training written to calorie and protein targets you set. FitMunch plans those seven days and one shopping list. It does not promise a fitness result. You stay in charge of the shop and you check out at the store.',
    intro: 'A beginner week is meals and training written to targets you set. FitMunch includes weekly training plans and workout tracking with the meals. It does not promise a fitness result.',
    steps: [
      ['Start with targets you set', 'You log a goal and the calorie and protein targets. FitMunch does not promise what training will do.'],
      ['Meals and training', 'The week holds 7 days of meals plus a training plan. You can change either and write a new week.'],
      ['Shop the food yourself', 'The shopping list is the food for the meals you lock. You check out at the store.'],
    ],
    faqs: [
      ['Is this a beginner program with promised results?', 'No. It is a first week of meals and training written to targets you set. FitMunch does not promise a fitness result.'],
      ['Do I need a trainer first?', 'No. You can plan your own week. Personal trainers can also draft a week for a client from the trainer tools.'],
      ['What is in the week?', 'Meals, a training plan, and one shopping list. You check out at the store yourself.'],
      ['Is this medical advice?', 'No. Food and training planning support only, not medical advice.'],
    ],
    links: [
      ['/for-pts', 'For personal trainers'],
      ['/pt-client-meal-plans', 'PT client meal plans'],
      ['/high-protein-staples-meal-plan', 'High protein staples meal plan'],
      ['/macro-meal-planner', 'Macro meal planner'],
    ],
    cardTitle: 'First week',
    cardSub: 'Meals and training',
    days: [['Mon', 'Oats'], ['Tue', 'Chicken'], ['Wed', 'Rice'], ['Thu', 'Eggs'], ['Fri', 'Beans'], ['Sat', 'Fish'], ['Sun', 'Soup']],
    lines: [['oats', '1 pack'], ['chicken thigh', '1 pack'], ['rice', '1 bag'], ['eggs', '1 carton']],
    close: 'Plan a first week of meals and training. You set the targets. You check out at the store.',
  },
  {
    slug: 'vegetarian-high-protein-meal-plan',
    query: 'vegetarian high protein meal plan',
    title: 'Vegetarian High Protein Meal Plan | FitMunch',
    description: 'A vegetarian week planned to the protein target you set, from foods such as tofu, lentils and chickpeas, plus one shopping list.',
    h1: 'A vegetarian high protein meal plan',
    kicker: 'Short answer',
    answer: 'A vegetarian high protein meal plan is a week written to the protein target you set, using foods that fit a vegetarian preference. FitMunch can plan that week from staples such as tofu, tempeh, lentils and chickpeas, then write one shopping list. It does not set your protein number for you.',
    intro: 'Pick a vegetarian preference and FitMunch plans the week from foods that fit, such as tofu, tempeh, lentils and chickpeas. The protein target is one you set.',
    steps: [
      ['Choose vegetarian', 'Pick your dietary requirements. The week is planned from staples that fit them.'],
      ['Set the protein target', 'You choose the number. FitMunch writes meals to that target and does not tell you what the number should be.'],
      ['One list', 'Tofu, lentils, chickpeas and the rest of the week become one shopping list. You check out at the store.'],
    ],
    faqs: [
      ['Can the week be vegetarian?', 'Yes. Pick a vegetarian preference and the week is planned from foods that fit, such as tofu, tempeh, lentils and chickpeas.'],
      ['Who sets the protein target?', 'You do. FitMunch does not choose how much protein you need. It plans to the target you enter.'],
      ['Does it order the shop?', 'No. FitMunch does not show supermarket prices and never places or pays for your supermarket order.'],
      ['Can I add other requirements?', 'Yes. Dietary requirements such as gluten free can be set with the vegetarian preference, and the week follows them.'],
    ],
    links: [
      ['/high-protein-staples-meal-plan', 'High protein staples meal plan'],
      ['/high-protein-shopping-list', 'High protein shopping list'],
      ['/meal-plan-for-one', 'Meal plan for one'],
      ['/grocery-meal-planner', 'Grocery meal planner'],
    ],
    cardTitle: 'Plant week',
    cardSub: 'Preference you set',
    days: [['Mon', 'Oats'], ['Tue', 'Tofu'], ['Wed', 'Lentils'], ['Thu', 'Eggs'], ['Fri', 'Chickpea'], ['Sat', 'Rice'], ['Sun', 'Yoghurt']],
    lines: [['tofu', '1 pack'], ['lentils', '1 bag'], ['chickpeas', '1 tin'], ['eggs', '1 carton']],
    close: 'Plan a vegetarian week to a protein target you set, then shop the list yourself.',
  },
  {
    slug: 'best-meal-planning-app-australia',
    query: 'best meal planning app australia',
    title: 'Best Meal Planning App Australia | FitMunch',
    description: 'Compare a notebook, a spreadsheet and a web app for meal planning in Australia. No ranking and no other product names. FitMunch plans the week on the web.',
    h1: 'What to compare in a meal planning app in Australia',
    kicker: 'Short answer',
    answer: 'There is no single best meal planning app. A notebook holds ideas, a spreadsheet holds numbers, and a web app can write the week for you. FitMunch plans seven days of meals and training to targets you set, then one shopping list. The trial is on the web. You check out yourself.',
    intro: 'People compare three ways to plan: a notebook, a spreadsheet, and a web app. FitMunch is the web app. This page names no other product and does not rank a winner.',
    steps: [
      ['Notebook', 'You write meals by hand. Nothing builds the shopping list until you do.'],
      ['Spreadsheet', 'You type foods and targets and you keep the sheet up to date yourself.'],
      ['Web app', 'You set targets. FitMunch writes 7 days of meals and training and one shopping list. You check out yourself. The trial is on the web.'],
    ],
    faqs: [
      ['Is FitMunch the best app?', 'There is no ranking on this page. FitMunch is one way to plan: a web app that writes the week and a shopping list to targets you set.'],
      ['Why are no other apps named?', 'So the comparison stays about the approach: notebook, spreadsheet, or a web plan. It is not a leaderboard.'],
      ['Where do I open the plan?', 'The trial is on the web. You use FitMunch in the browser.'],
      ['Does the app buy the groceries?', 'No. FitMunch never places or pays for your supermarket order. You check out at the store.'],
    ],
    links: [
      ['/ai-meal-planner-australia', 'AI meal planner Australia'],
      ['/fitmunch-coach-vs-spreadsheets', 'FitMunch Coach vs spreadsheets'],
      ['/pricing', 'Pricing'],
      ['/for-pts', 'For personal trainers'],
    ],
    cardTitle: 'Web plan',
    cardSub: 'One approach',
    days: [['Mon', 'Oats'], ['Tue', 'Chicken'], ['Wed', 'Rice'], ['Thu', 'Eggs'], ['Fri', 'Beans'], ['Sat', 'Fish'], ['Sun', 'Soup']],
    lines: [['oats', '1 pack'], ['chicken thigh', '1 pack'], ['rice', '1 bag'], ['beans', '1 tin']],
    close: 'Try the web plan: seven days of meals and training, then one list you shop yourself.',
  },
  {
    slug: 'stop-wasting-food-and-money-on-groceries',
    query: 'how to stop wasting food and money on groceries',
    title: 'Stop Wasting Food and Money on Groceries | FitMunch',
    description: 'Match the shop to the meals you will eat. FitMunch writes one list from the week you commit. It does not show supermarket prices.',
    h1: 'How to stop wasting food and money on groceries',
    kicker: 'Short answer',
    answer: 'You waste less food when the shop matches the meals you will actually eat. FitMunch writes one shopping list from the seven days you commit, so food outside that week stays off the list. You check out at the store yourself. FitMunch does not show supermarket prices.',
    intro: 'The shop stays closer to what you will eat when the list is built from the meals you already committed. FitMunch writes that list. It does not show supermarket prices and it does not quote a figure for the shop.',
    steps: [
      ['Commit the meals', 'Pick the week you will actually eat. Food you did not plan is not added to the list.'],
      ['One list from that week', 'FitMunch turns the locked meals into one shopping list. Repeated foods become one line.'],
      ['You check out', 'You shop the list yourself. FitMunch never places or pays for the order and does not show supermarket prices.'],
    ],
    faqs: [
      ['Does this promise I will spend a certain way?', 'No. FitMunch does not show supermarket prices and does not quote the shop. It writes the list from the meals you commit.'],
      ['How does that relate to wasted food?', 'The list is the food for the meals you locked, so items outside that week are not on it.'],
      ['Can I still shop in person?', 'Yes. Copy or print the list and check out at the store, or type it into your own online order.'],
      ['Who pays?', 'You pay the store. FitMunch never places or pays for your supermarket order.'],
    ],
    links: [
      ['/grocery-meal-planner', 'Grocery meal planner'],
      ['/meal-prep-shopping-list', 'Meal prep shopping list'],
      ['/ai-meal-plan-shopping-list', 'AI meal plan with shopping list'],
      ['/supermarket-meal-planner', 'Supermarket meal planner'],
    ],
    cardTitle: 'Matched list',
    cardSub: 'From the week',
    days: [['Mon', 'Soup'], ['Tue', 'Rice'], ['Wed', 'Eggs'], ['Thu', 'Pasta'], ['Fri', 'Beans'], ['Sat', 'Chicken'], ['Sun', 'Salad']],
    lines: [['rice', '1 bag'], ['pasta', '1 bag'], ['eggs', '1 carton'], ['beans', '1 tin']],
    close: 'Write the list from the meals you will eat, then check out at the store yourself.',
  },
  {
    slug: 'healthy-lunch-ideas-for-work',
    query: 'healthy lunch ideas for work',
    title: 'Healthy Lunch Ideas for Work | FitMunch',
    description: 'Work lunches planned with the rest of the week. FitMunch writes seven days of meals to targets you set, then one shopping list you can pack from.',
    h1: 'Healthy lunch ideas for work',
    kicker: 'Short answer',
    answer: 'Healthy lunch ideas for work are lunches you planned with the rest of the week. FitMunch writes seven days of meals, including lunches, to the calorie and protein targets you set, then one shopping list. You pack from that list. It does not promise a health result.',
    intro: 'A work lunch is one meal in the same week as breakfast and dinner. FitMunch writes all of them to the targets you set, then one shopping list you can pack from.',
    steps: [
      ['Put lunch on the week', 'Commit lunches with the other meals. They share the same calorie and protein targets.'],
      ['One list', 'Ingredients for lunch and dinner are added up together. You shop once for the week you locked.'],
      ['Pack from the list', 'You check out at the store, then pack lunch from what you bought. FitMunch does not place the order.'],
    ],
    faqs: [
      ['Are these lunches a health claim?', 'No. They are meals in the weekly plan. FitMunch does not promise a health result.'],
      ['Can lunch share foods with dinner?', 'Yes. Plan them in the same week and shared foods become one line on the shopping list.'],
      ['Does this suit one person?', 'Yes. A week can be sized to you. A household week is a different page if more people eat the same dinners.'],
      ['Where is the trial?', 'On the web. Card on file. Cancel before the trial ends and you are not charged.'],
    ],
    links: [
      ['/meal-prep-shopping-list', 'Meal prep shopping list'],
      ['/meal-plan-for-one', 'Meal plan for one'],
      ['/family-meal-plan', 'Family meal plan'],
      ['/macro-meal-planner', 'Macro meal planner'],
    ],
    cardTitle: 'Work lunches',
    cardSub: 'With the week',
    days: [['Mon', 'Rice'], ['Tue', 'Wrap'], ['Wed', 'Salad'], ['Thu', 'Soup'], ['Fri', 'Eggs'], ['Sat', 'Pasta'], ['Sun', 'Beans']],
    lines: [['rice', '1 bag'], ['wraps', '1 pack'], ['eggs', '1 carton'], ['leafy greens', '1 bunch']],
    close: 'Plan work lunches with the rest of the week, then shop and pack from that list.',
  },
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

function withLink(text, link) {
  const safe = esc(text);
  if (!link) return safe;
  const phrase = esc(link.phrase);
  if (!safe.includes(phrase)) return safe;
  const anchor = `<a href="${esc(link.href)}" rel="noopener noreferrer">${phrase}</a>`;
  return safe.replace(phrase, anchor);
}

function renderPage(page) {
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
  const days = page.days.map(([d, meal]) => `<div class="ln-day"><b>${esc(d)}</b><span>${esc(meal)}</span></div>`).join('');
  const lines = page.lines.map(([name, qty]) => (
    qty ? `<li>${esc(name)} <em>${esc(qty)}</em></li>` : `<li>${esc(name)}</li>`
  )).join('');
  const steps = page.steps.map(([title, body], i) => (
    `<article><div class="n">${String(i + 1).padStart(2, '0')}</div><h3>${esc(title)}</h3><p>${esc(body)}</p></article>`
  )).join('');
  const faqs = page.faqs.map(([q, a]) => {
    const link = page.faqLinks && page.faqLinks[q];
    return `<dt>${esc(q)}</dt><dd>${withLink(a, link)}</dd>`;
  }).join('');
  const links = page.links.map(([href, label]) => `<li><a href="${esc(href)}">${esc(label)}</a></li>`).join('');
  const note = page.note ? `<p class="ln-note">${withLink(page.note, page.noteLink)}</p>` : '';
  const cta = `<a class="fm-btn fm-btn-leaf" href="${TRIAL_HREF}" data-fm-auth="register" data-fm-plan="premium">${esc(TRIAL_LABEL)}</a>`;

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
<script type="application/ld+json">${jsonScript(webPage)}</script>
<script type="application/ld+json">${jsonScript(faqPage)}</script>
</head>
<body class="fm-body">
<nav class="fm-nav fm-nav-abs" aria-label="Primary">
  <a class="fm-brand" href="/" aria-label="FitMunch"><img src="/assets/logo.svg" alt="" width="32" height="32"/>Fit<span>Munch</span></a>
  <div class="fm-nav-links">
    <a href="/#loop">How it works</a>
    <a href="/pricing">Pricing</a>
    <a href="/login.html" data-fm-auth="login">Sign in</a>
    <a class="fm-nav-cta" href="${TRIAL_HREF}" data-fm-auth="register" data-fm-plan="premium">${esc(TRIAL_LABEL)}</a>
  </div>
</nav>
<main>
<header class="ln-hero">
  <div class="ln-hero-inner">
    <div>
      <div class="ln-kicker">${esc(page.kicker)}</div>
      <h1>${esc(page.h1)}</h1>
      <p class="ln-lead ln-answer">${esc(page.answer)}</p>
      <div class="ln-ctas">${cta}</div>
      <p class="ln-small">${esc(TRIAL_NOTE)}</p>
    </div>
    <aside class="ln-card" aria-label="${esc(page.cardTitle)}">
      <div class="ln-card-top"><b>${esc(page.cardTitle)}</b><span>${esc(page.cardSub)}</span></div>
      <div class="ln-week">${days}</div>
      <ul class="ln-lines">${lines}</ul>
      <p class="ln-card-foot">Not a live trolley. You check out at the store. FitMunch does not show supermarket prices.</p>
    </aside>
  </div>
</header>
<section class="ln-section">
  <div class="ln-inner">
    <h2>How it works</h2>
    <p>${esc(page.intro)}</p>
    <div class="ln-steps">${steps}</div>
    ${note}
  </div>
</section>
<section class="ln-section faq" style="padding-top:0">
  <div class="ln-inner">
    <h2>Questions people ask</h2>
    <dl>${faqs}</dl>
    <p class="ln-sign">More questions? <a href="/support">Visit support</a>.<br/><strong>The FitMunch team</strong></p>
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
      <h2>Start the 14-day trial on the web.</h2>
      <p>${esc(page.close)} ${esc(TRIAL_NOTE)}</p>
      <div class="fm-ctas">${cta}</div>
    </div>
  </div>
</section>
</main>
<footer class="fm-footer">
  <div class="fm-footer-inner">
    <div class="fm-footer-brand">Fit<span>Munch</span></div>
    <div class="fm-footer-links">
      <a href="/">Home</a>
      <a href="/supermarket-meal-planner">Supermarket meal planner</a>
      <a href="/grocery-meal-planner">Grocery meal planner</a>
      <a href="/meal-prep-shopping-list">Meal prep list</a>
      <a href="/pricing">Pricing</a>
      <a href="/privacy">Privacy</a>
      <a href="/terms">Terms</a>
      <a href="/login.html" data-fm-auth="login">Sign in</a>
    </div>
    <p class="fm-footer-note">© 2026 FitMunch. Food planning support only. Not medical advice. FitMunch is not affiliated with any supermarket. We do not pay any supermarket for you.</p>
  </div>
</footer>
<script src="/js/fm-track.js" defer></script>
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

const BANNED = [
  [/\u2014/, 'em dash'],
  [/\u2013/, 'en dash'],
  [/ -- /, 'double hyphen'],
  [/\bbudget\b/i, 'budget'],
  [/\bcheap(?:er|est|ly)?\b/i, 'cheap'],
  [/\bsavings?\b/i, 'saving'],
  [/\bspend(?:ing)? less\b/i, 'spend less'],
  [/\bcosts? less\b/i, 'cost less'],
  [/\baffordable\b/i, 'affordable'],
  [/woolworths|woolies|\bcoles\b|\baldi\b|\biga\b|costco/i, 'store name'],
  [/pty ltd/i, 'Pty Ltd'],
  [/inc\.?\s*gst/i, 'inc. GST'],
  [/\$|&#0*36;|&#x0*24;|&dollar;/i, 'price mark'],
  [/\bthe total\b/i, 'the total'],
  [/\bspecials?\b/i, 'special'],
  [/\bcatalogues?\b/i, 'catalogue'],
  [/\bpriced\b/i, 'priced'],
  [/shelf price/i, 'shelf price'],
  [/dietitian/i, 'dietitian'],
  [/guaranteed weight loss/i, 'guaranteed weight loss'],
  [/app store/i, 'App Store'],
  [/aggregaterating/i, 'AggregateRating'],
  [/\bstar rating/i, 'star rating'],
  [/testimonial/i, 'testimonial'],
  [/\breviews?\b/i, 'review'],
  [/buys your groceries/i, 'buys groceries'],
  [/automatic checkout/i, 'automatic checkout'],
  [/\bGrok\b|\bOpenClaw\b|\bMRR\b/i, 'internal name'],
  [/(?<!user[-_ ]?)\bagents?\b/i, 'agent'],
  [/per\s*kg/i, 'per kg'],
  [/\bfor less\b/i, 'for less'],
  [/cheaper at/i, 'cheaper at'],
];

function auditIssues() {
  const issues = [];
  if (PAGES.length < 8 || PAGES.length > 12) issues.push(`page count ${PAGES.length}`);
  const seen = new Map();
  for (const key of ['slug', 'title', 'description', 'h1', 'answer']) {
    seen.set(key, new Set());
  }
  const linked = new Set();
  for (const page of PAGES) {
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
    if (page.steps.length !== 3) issues.push(`${page.slug} steps`);
    if (page.faqs.length < 4) issues.push(`${page.slug} faqs`);
    if (page.links.length < 3) issues.push(`${page.slug} links`);
    for (const [href] of page.links) linked.add(href);
    const html = renderPage(page);
    if (!html.includes(`href="${TRIAL_HREF}"`)) issues.push(`${page.slug} missing trial href`);
    if ((html.match(new RegExp(`href="${TRIAL_HREF.replace(/[?#]/g, '\\$&')}"`, 'g')) || []).length < 3) {
      issues.push(`${page.slug} expected 3 trial CTAs`);
    }
    for (const [re, label] of BANNED) {
      if (re.test(html)) issues.push(`${page.slug} ${label}`);
    }
    if (page.plainFigures) {
      const body = html.replace(/<footer[\s\S]*<\/footer>/i, '');
      if (/\bgrams?\b/i.test(body) || /\bkg\b/i.test(body) || /per\s*kg/i.test(body) || /\d+\s*g\b/i.test(body)) {
        issues.push(`${page.slug} protein figure`);
      }
    }
    if (!html.includes('"@type":"FAQPage"') && !html.includes('"@type": "FAQPage"')) issues.push(`${page.slug} faq ld`);
    if (!html.includes('"@type":"WebPage"')) issues.push(`${page.slug} webpage ld`);
    for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      JSON.parse(block[1]);
    }
  }
  for (const skip of SKIPPED) {
    if (!skip.reason || skip.reason.length < 40) issues.push(`short skip reason: ${skip.query}`);
    if (!linked.has(skip.href)) issues.push(`skip target not linked: ${skip.href}`);
  }
  return issues;
}

module.exports = {
  SITE,
  TRIAL_HREF,
  TRIAL_LABEL,
  TRIAL_NOTE,
  PAGES,
  SKIPPED,
  wordCount,
  renderPage,
  buildPage,
  auditIssues,
};
