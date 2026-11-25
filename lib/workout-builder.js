'use strict';

/**
 * Deterministic workout plan for when every AI provider fails.
 * No network and no credit. Exercise names stay food-free.
 */
const NOTICE = "The AI didn't answer, so this program was built from FitMunch's training template. It didn't use an AI credit.";

const DAYS = [
  ['Full body A', [
    ['Goblet squat', 3, '8-10'],
    ['Push-up or bench press', 3, '8-10'],
    ['Dumbbell row', 3, '10-12'],
    ['Romanian deadlift', 3, '8-10'],
    ['Plank', 3, '30-45 s'],
  ]],
  ['Full body B', [
    ['Split squat', 3, '8-10 each leg'],
    ['Overhead press', 3, '8-10'],
    ['Lat pulldown or band pull-down', 3, '10-12'],
    ['Glute bridge', 3, '10-12'],
    ['Side plank', 3, '20-30 s each side'],
  ]],
  ['Full body C', [
    ['Leg press or step-up', 3, '10-12'],
    ['Incline push-up or dumbbell press', 3, '8-12'],
    ['Seated cable row or band row', 3, '10-12'],
    ['Hip hinge', 3, '10-12'],
    ['Bird dog', 3, '8-10 each side'],
  ]],
];

function buildWorkoutPlan({ goal, level, daysPerWeek, equipment, sessionMinutes } = {}) {
  const days = Math.min(Math.max(parseInt(daysPerWeek, 10) || 3, 1), 7);
  const lvl = ['beginner', 'intermediate', 'advanced'].includes(level) ? level : 'intermediate';
  const workouts = [];
  for (let d = 1; d <= days; d += 1) {
    const [name, list] = DAYS[(d - 1) % DAYS.length];
    list.forEach(([exercise, sets, reps], i) => {
      workouts.push({
        day: d,
        name: exercise,
        sets: lvl === 'beginner' ? Math.max(2, sets - 1) : sets,
        reps,
        rest: lvl === 'advanced' ? 120 : 90,
        notes: i === 0 ? `${name}: warm up for 5 to 10 minutes first.` : '',
      });
    });
  }
  const bits = ['A balanced full-body program from FitMunch.'];
  if (goal) bits.push(`Goal: ${String(goal).replace(/_/g, ' ')}.`);
  if (equipment) bits.push(`Equipment: ${equipment}.`);
  if (Number(sessionMinutes) > 0) bits.push(`About ${Math.round(Number(sessionMinutes))} minutes a session.`);
  bits.push('Add a little weight or a rep each week while your form stays solid.');
  return {
    plan: {
      planName: `${days}-day full body program`,
      summary: bits.join(' '),
      level: lvl,
      frequency: days,
      workouts,
    },
    notice: NOTICE,
    source: 'builder',
  };
}

module.exports = { buildWorkoutPlan, NOTICE };
