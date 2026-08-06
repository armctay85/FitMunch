/**
 * Schedule a Reddit follow-up via Postiz.
 * Requires POSTIZ_API_KEY and POSTIZ_REDDIT_INTEGRATION_ID in env.
 * Do not hardcode secrets in this file.
 */
const KEY = process.env.POSTIZ_API_KEY;
const INTEGRATION = process.env.POSTIZ_REDDIT_INTEGRATION_ID || 'cmprv1ujb01dcrw0ywnoymrzf';
if (!KEY) {
  console.error('Missing POSTIZ_API_KEY');
  process.exit(1);
}
const when = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
const body = {
  type: 'schedule',
  date: when,
  shortLink: false,
  tags: [],
  posts: [
    {
      integration: { id: INTEGRATION },
      settings: {
        subreddit: [
          {
            value: {
              subreddit: 'MealPrepSunday',
              title:
                'AU follow-up: using the grocery receipt as the meal plan (method + free tool)',
              type: 'text',
              is_flair_required: false,
            },
          },
        ],
      },
      value: [
        {
          content: `Method: ignore shelf price, compare price per ~25g protein, then build meals from what you already bought.

Worked AU example: https://www.fitmunch.com.au/haul-teardown?utm_source=reddit&utm_medium=organic&utm_campaign=mrr_sprint&utm_content=mealprep_followup

Happy to answer AU grocery/macro questions either way.`,
          image: [],
        },
      ],
    },
  ],
};
const res = await fetch('https://api.postiz.com/public/v1/posts', {
  method: 'POST',
  headers: { Authorization: KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
console.log(res.status, await res.text());
