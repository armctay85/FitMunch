/**
 * FitMunch hook lab — generate + score hooks before any creative work.
 * Usage: node scripts/fitmunch-hook-lab.mjs [pillar]
 * Writes winner into state/fitmunch-ig-daily-decision.json (hooks block).
 */
import fs from 'fs';
import path from 'path';

const STATE = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.openclaw/workspace/state'
);
const DECISION = path.join(STATE, 'fitmunch-ig-daily-decision.json');
const LEDGER = path.join(STATE, 'fitmunch-ig-performance.jsonl');

const BANK = {
  'myth-tips': [
    'This "high protein" yoghurt is basically dessert',
    'Mars bar sugar. "Healthy" tub branding.',
    'The snack aisle lied about your macros',
    'Protein bar or candy bar? Flip the pack',
  ],
  'ai-coach': [
    'I asked AI how to hit 180g protein from tonight\'s fridge',
    'Coach said skip the "healthy" wrap — here\'s why',
    'AI rebuilt dinner after I scanned the receipt',
    'What the coach changed when protein was 40g short',
  ],
  'workout-plans': [
    'No gym. Still trained. 3-day dumbbell week',
    'Home dumbbells. Full week. No guesswork',
    'Busy week plan: lifts that fit around night shift',
  ],
  'receipt-haul': [
    'Scanned a $143 Woolies shop. Graded B+',
    'Same spend. 40g more protein. Here\'s the swap',
    'Receipt said 987g protein. Flatmate didn\'t believe it',
  ],
  'budget-protein': [
    'Eggs beat chicken this week — price per 25g',
    'Marked-down chicken math in AUD',
    '$12 of protein anchors that actually hit macros',
  ],
  'meal-prep': [
    'Sunday containers from one Woolies run — no Pinterest',
    '15 seconds from receipt to 7 dinners',
    'Meal prep that starts from what you already bought',
  ],
};

const BANNED =
  /sunday prep|monday confidence|monday protein check|sunday shop check|midweek fridge|build the week from the shop|snap your woolies shop|know every macro|start your journey|level up/i;

function scoreHook(hook, pillar) {
  let score = 0;
  const reasons = [];
  const words = hook.trim().split(/\s+/).length;
  if (words >= 4 && words <= 14) {
    score += 2;
    reasons.push('length_ok');
  } else {
    reasons.push('length_bad');
  }
  if (BANNED.test(hook)) {
    score -= 10;
    reasons.push('banned_soft');
  }
  if (/\d/.test(hook) || /\$|AUD|Woolies|Coles|Aldi|protein|sugar|Mars|graded|B\+|A\+/i.test(hook)) {
    score += 3;
    reasons.push('specific_proof');
  } else {
    reasons.push('no_proof');
  }
  if (/vs|lied|skip|beat|short|didn't|don't|no gym|candy|dessert|swap/i.test(hook)) {
    score += 2;
    reasons.push('conflict');
  } else {
    reasons.push('no_conflict');
  }
  if (pillar === 'ai-coach' && /AI|coach/i.test(hook)) {
    score += 1;
    reasons.push('product_moment');
  }
  if (pillar === 'receipt-haul' && /scan|receipt|graded|Woolies/i.test(hook)) {
    score += 1;
    reasons.push('product_moment');
  }
  // Penalise near-dupes from ledger
  if (fs.existsSync(LEDGER)) {
    const text = fs.readFileSync(LEDGER, 'utf8');
    const stem = hook.slice(0, 24).toLowerCase();
    if (text.toLowerCase().includes(stem)) {
      score -= 4;
      reasons.push('near_dupe_ledger');
    }
  }
  return { hook, pillar, score, reasons };
}

const pillarArg = process.argv[2];
let decision = {};
if (fs.existsSync(DECISION)) {
  try {
    decision = JSON.parse(fs.readFileSync(DECISION, 'utf8'));
  } catch {
    decision = {};
  }
}
const pillar = pillarArg || decision.NEXT_PILLAR || 'myth-tips';
const candidates = BANK[pillar] || BANK['myth-tips'];
const scored = candidates.map((h) => scoreHook(h, pillar)).sort((a, b) => b.score - a.score);
const winner = scored.find((s) => s.score >= 4) || scored[0];

decision.hooks = { pillar, scored, winner, generatedAt: new Date().toISOString() };
decision.NEXT_HOOK = winner.hook;
decision.NEXT_PILLAR = pillar;
fs.mkdirSync(STATE, { recursive: true });
fs.writeFileSync(DECISION, JSON.stringify(decision, null, 2));

console.log('PILLAR', pillar);
for (const s of scored) console.log(String(s.score).padStart(3), s.hook, '→', s.reasons.join(','));
console.log('\nWINNER (score ' + winner.score + '):', winner.hook);
if (winner.score < 4) {
  console.error('\nHOOK LAB FAIL — winner below quality floor. Add better candidates; do not publish.');
  process.exit(1);
}
console.log('Wrote', DECISION);
