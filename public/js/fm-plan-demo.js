/* Live sample day. No network. Numbers are a preview, not a saved plan. */
(function () {
  var root = document.getElementById('plan-demo');
  if (!root) return;

  var PLANS = {
    cut: {
      classic: {
        kcal: 2000, protein: 150,
        meals: [
          ['Breakfast', 'Veggie omelette with potatoes', '501 kcal · 38g protein'],
          ['Lunch', 'Chicken and sweet potato', '640 kcal · 48g protein'],
          ['Dinner', 'Salmon, greens and rice', '560 kcal · 42g protein'],
          ['Snack', 'Greek yoghurt and berries', '299 kcal · 22g protein']
        ],
        trolley: ['Eggs', 'Chicken breast', 'Sweet potato', 'Salmon', 'Greek yoghurt', 'Broccoli', 'Berries']
      },
      protein: {
        kcal: 2000, protein: 170,
        meals: [
          ['Breakfast', 'Egg whites and oats', '420 kcal · 40g protein'],
          ['Lunch', 'Chicken and broccoli', '610 kcal · 58g protein'],
          ['Dinner', 'Beef mince and rice', '640 kcal · 52g protein'],
          ['Snack', 'Cottage cheese', '330 kcal · 20g protein']
        ],
        trolley: ['Egg whites', 'Rolled oats', 'Chicken breast', 'Broccoli', 'Beef mince', 'Rice', 'Cottage cheese']
      },
      plant: {
        kcal: 2000, protein: 130,
        meals: [
          ['Breakfast', 'Tofu scramble and potatoes', '480 kcal · 38g protein'],
          ['Lunch', 'Chickpea and rice bowl', '620 kcal · 36g protein'],
          ['Dinner', 'Lentil tray and greens', '590 kcal · 44g protein'],
          ['Snack', 'Soy yoghurt and berries', '310 kcal · 12g protein']
        ],
        trolley: ['Tofu', 'Potatoes', 'Chickpeas', 'Rice', 'Lentils', 'Greens', 'Soy yoghurt']
      }
    },
    build: {
      classic: {
        kcal: 2800, protein: 180,
        meals: [
          ['Breakfast', 'Oats, eggs and banana', '740 kcal · 36g protein'],
          ['Lunch', 'Chicken rice bowl', '820 kcal · 58g protein'],
          ['Dinner', 'Beef, pasta and greens', '840 kcal · 54g protein'],
          ['Snack', 'Cottage cheese and fruit', '400 kcal · 32g protein']
        ],
        trolley: ['Rolled oats', 'Eggs', 'Banana', 'Chicken breast', 'Rice', 'Beef mince', 'Pasta']
      },
      protein: {
        kcal: 2800, protein: 210,
        meals: [
          ['Breakfast', 'Egg and oat stack', '680 kcal · 48g protein'],
          ['Lunch', 'Double chicken rice', '860 kcal · 72g protein'],
          ['Dinner', 'Beef and sweet potato', '820 kcal · 60g protein'],
          ['Snack', 'Greek yoghurt', '440 kcal · 30g protein']
        ],
        trolley: ['Eggs', 'Rolled oats', 'Chicken breast', 'Rice', 'Beef mince', 'Sweet potato', 'Greek yoghurt']
      },
      plant: {
        kcal: 2800, protein: 160,
        meals: [
          ['Breakfast', 'Tofu, oats and banana', '720 kcal · 38g protein'],
          ['Lunch', 'Tempeh rice bowl', '840 kcal · 46g protein'],
          ['Dinner', 'Lentil pasta and greens', '820 kcal · 54g protein'],
          ['Snack', 'Soy yoghurt and nuts', '420 kcal · 22g protein']
        ],
        trolley: ['Tofu', 'Rolled oats', 'Banana', 'Tempeh', 'Rice', 'Lentils', 'Pasta']
      }
    },
    hold: {
      classic: {
        kcal: 2300, protein: 140,
        meals: [
          ['Breakfast', 'Eggs on toast', '520 kcal · 28g protein'],
          ['Lunch', 'Tuna rice bowl', '640 kcal · 42g protein'],
          ['Dinner', 'Chicken tray and broccoli', '740 kcal · 48g protein'],
          ['Snack', 'Yoghurt and berries', '400 kcal · 22g protein']
        ],
        trolley: ['Eggs', 'Bread', 'Tuna', 'Rice', 'Chicken breast', 'Broccoli', 'Yoghurt']
      },
      protein: {
        kcal: 2300, protein: 170,
        meals: [
          ['Breakfast', 'Eggs and cottage cheese', '480 kcal · 44g protein'],
          ['Lunch', 'Chicken and sweet potato', '700 kcal · 56g protein'],
          ['Dinner', 'Turkey mince and rice', '720 kcal · 50g protein'],
          ['Snack', 'Greek yoghurt', '400 kcal · 20g protein']
        ],
        trolley: ['Eggs', 'Cottage cheese', 'Chicken breast', 'Sweet potato', 'Turkey mince', 'Rice', 'Greek yoghurt']
      },
      plant: {
        kcal: 2300, protein: 120,
        meals: [
          ['Breakfast', 'Tofu and toast', '510 kcal · 32g protein'],
          ['Lunch', 'Chickpea rice bowl', '680 kcal · 36g protein'],
          ['Dinner', 'Lentil tray', '710 kcal · 38g protein'],
          ['Snack', 'Soy yoghurt and berries', '400 kcal · 14g protein']
        ],
        trolley: ['Tofu', 'Bread', 'Chickpeas', 'Rice', 'Lentils', 'Greens', 'Soy yoghurt']
      }
    }
  };

  var goal = 'cut';
  var diet = 'classic';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var kcalEl = document.getElementById('plan-kcal');
  var proEl = document.getElementById('plan-pro');
  var kcalBar = document.getElementById('plan-kcal-bar');
  var proBar = document.getElementById('plan-pro-bar');
  var mealsEl = document.getElementById('plan-meals');
  var trolleyEl = document.getElementById('plan-trolley');
  var note = document.getElementById('plan-note');

  function comma(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function paint(animate) {
    var plan = PLANS[goal][diet];
    if (note) note.textContent = 'Sample Wednesday. Pick a goal. This is not your week until you log your body.';
    if (kcalEl) kcalEl.textContent = comma(plan.kcal);
    if (proEl) proEl.textContent = plan.protein + 'g';
    var kcalW = Math.round((plan.kcal / 3200) * 100);
    var proW = Math.round((plan.protein / 220) * 100);
    function bars() {
      if (kcalBar) kcalBar.style.width = kcalW + '%';
      if (proBar) proBar.style.width = proW + '%';
    }
    if (animate && !reduced) {
      if (kcalBar) kcalBar.style.width = '0%';
      if (proBar) proBar.style.width = '0%';
      requestAnimationFrame(function () { requestAnimationFrame(bars); });
    } else {
      bars();
    }
    if (mealsEl) {
      mealsEl.textContent = '';
      plan.meals.forEach(function (row, i) {
        var li = document.createElement('li');
        if (animate && !reduced) li.style.animationDelay = (i * 70) + 'ms';
        var slot = document.createElement('span');
        slot.className = 'slot';
        slot.textContent = row[0].slice(0, 1);
        var name = document.createElement('span');
        name.className = 'meal-name';
        name.textContent = row[1];
        var meta = document.createElement('span');
        meta.className = 'meal-meta';
        meta.textContent = row[0] + ' · ' + row[2];
        li.appendChild(slot);
        li.appendChild(name);
        li.appendChild(meta);
        mealsEl.appendChild(li);
      });
    }
    if (trolleyEl) {
      trolleyEl.textContent = '';
      plan.trolley.forEach(function (item) {
        var li = document.createElement('li');
        li.textContent = item;
        trolleyEl.appendChild(li);
      });
    }
    var totals = 'The sample day is ' + comma(plan.kcal) + ' kcal and ' + plan.protein + 'g protein.';
    var lock = document.querySelector('.hero-lock');
    if (lock) lock.textContent = totals + ' Pick another goal and the meals follow.';
    var cap = document.querySelector('.hero-shot figcaption');
    if (cap) {
      cap.textContent = (goal === 'cut' && diet === 'classic')
        ? 'Your first week: built for 82kg cutting to 78kg, at ' + comma(plan.kcal) + ' kcal and ' + plan.protein + 'g protein, with Swap open on breakfast.'
        : 'Sample day at ' + comma(plan.kcal) + ' kcal and ' + plan.protein + 'g protein.';
    }
  }

  function select(group, value, attr) {
    root.querySelectorAll('[data-' + attr + ']').forEach(function (btn) {
      var on = btn.getAttribute('data-' + attr) === value;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  root.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn || !root.contains(btn)) return;
    if (btn.hasAttribute('data-goal')) {
      goal = btn.getAttribute('data-goal');
      select('goal', goal, 'goal');
      paint(true);
    } else if (btn.hasAttribute('data-diet')) {
      diet = btn.getAttribute('data-diet');
      select('diet', diet, 'diet');
      paint(true);
    }
  });

  paint(false);

  var motionOk = !reduced && 'IntersectionObserver' in window;
  if (motionOk) document.documentElement.classList.add('fm-motion');
  var nodes = document.querySelectorAll('.reveal');
  if (!nodes.length || !motionOk) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.16 });
  nodes.forEach(function (n) { io.observe(n); });
})();
