/* Live sample day. No network. Numbers are a preview, not a saved plan. */
(function (exp) {
  var PLANS = {
    cut: {
      classic: {
        kcal: 2000, protein: 150,
        meals: [
          meal('Breakfast', 'Veggie omelette with potatoes', '501 kcal · 38g protein', ['Eggs', 'Potatoes', 'Vegetables']),
          meal('Lunch', 'Chicken and sweet potato', '640 kcal · 48g protein', ['Chicken breast', 'Sweet potato']),
          meal('Dinner', 'Salmon, greens and rice', '560 kcal · 42g protein', ['Salmon', 'Greens', 'Rice']),
          meal('Snack', 'Greek yoghurt and berries', '299 kcal · 22g protein', ['Greek yoghurt', 'Berries'])
        ]
      },
      protein: {
        kcal: 2000, protein: 170,
        meals: [
          meal('Breakfast', 'Egg whites and oats', '420 kcal · 40g protein', ['Egg whites', 'Rolled oats']),
          meal('Lunch', 'Chicken and broccoli', '610 kcal · 58g protein', ['Chicken breast', 'Broccoli']),
          meal('Dinner', 'Beef mince and rice', '640 kcal · 52g protein', ['Beef mince', 'Rice']),
          meal('Snack', 'Cottage cheese', '330 kcal · 20g protein', ['Cottage cheese'])
        ]
      },
      plant: {
        kcal: 2000, protein: 130,
        meals: [
          meal('Breakfast', 'Tofu scramble and potatoes', '480 kcal · 38g protein', ['Tofu', 'Potatoes']),
          meal('Lunch', 'Chickpea and rice bowl', '620 kcal · 36g protein', ['Chickpeas', 'Rice']),
          meal('Dinner', 'Lentil tray and greens', '590 kcal · 44g protein', ['Lentils', 'Greens']),
          meal('Snack', 'Soy yoghurt and berries', '310 kcal · 12g protein', ['Soy yoghurt', 'Berries'])
        ]
      }
    },
    build: {
      classic: {
        kcal: 2800, protein: 180,
        meals: [
          meal('Breakfast', 'Oats, eggs and banana', '740 kcal · 36g protein', ['Rolled oats', 'Eggs', 'Banana']),
          meal('Lunch', 'Chicken rice bowl', '820 kcal · 58g protein', ['Chicken breast', 'Rice']),
          meal('Dinner', 'Beef, pasta and greens', '840 kcal · 54g protein', ['Beef mince', 'Pasta', 'Greens']),
          meal('Snack', 'Cottage cheese and fruit', '400 kcal · 32g protein', ['Cottage cheese', 'Fruit'])
        ]
      },
      protein: {
        kcal: 2800, protein: 210,
        meals: [
          meal('Breakfast', 'Egg and oat stack', '680 kcal · 48g protein', ['Eggs', 'Rolled oats']),
          meal('Lunch', 'Double chicken rice', '860 kcal · 72g protein', ['Chicken breast', 'Rice']),
          meal('Dinner', 'Beef and sweet potato', '820 kcal · 60g protein', ['Beef mince', 'Sweet potato']),
          meal('Snack', 'Greek yoghurt', '440 kcal · 30g protein', ['Greek yoghurt'])
        ]
      },
      plant: {
        kcal: 2800, protein: 160,
        meals: [
          meal('Breakfast', 'Tofu, oats and banana', '720 kcal · 38g protein', ['Tofu', 'Rolled oats', 'Banana']),
          meal('Lunch', 'Tempeh rice bowl', '840 kcal · 46g protein', ['Tempeh', 'Rice']),
          meal('Dinner', 'Lentil pasta and greens', '820 kcal · 54g protein', ['Lentils', 'Pasta', 'Greens']),
          meal('Snack', 'Soy yoghurt and nuts', '420 kcal · 22g protein', ['Soy yoghurt', 'Nuts'])
        ]
      }
    },
    hold: {
      classic: {
        kcal: 2300, protein: 140,
        meals: [
          meal('Breakfast', 'Eggs on toast', '520 kcal · 28g protein', ['Eggs', 'Bread']),
          meal('Lunch', 'Tuna rice bowl', '640 kcal · 42g protein', ['Tuna', 'Rice']),
          meal('Dinner', 'Chicken tray and broccoli', '740 kcal · 48g protein', ['Chicken breast', 'Broccoli']),
          meal('Snack', 'Yoghurt and berries', '400 kcal · 22g protein', ['Yoghurt', 'Berries'])
        ]
      },
      protein: {
        kcal: 2300, protein: 170,
        meals: [
          meal('Breakfast', 'Eggs and cottage cheese', '480 kcal · 44g protein', ['Eggs', 'Cottage cheese']),
          meal('Lunch', 'Chicken and sweet potato', '700 kcal · 56g protein', ['Chicken breast', 'Sweet potato']),
          meal('Dinner', 'Turkey mince and rice', '720 kcal · 50g protein', ['Turkey mince', 'Rice']),
          meal('Snack', 'Greek yoghurt', '400 kcal · 20g protein', ['Greek yoghurt'])
        ]
      },
      plant: {
        kcal: 2300, protein: 120,
        meals: [
          meal('Breakfast', 'Tofu and toast', '510 kcal · 32g protein', ['Tofu', 'Bread']),
          meal('Lunch', 'Chickpea rice bowl', '680 kcal · 36g protein', ['Chickpeas', 'Rice']),
          meal('Dinner', 'Lentil tray', '710 kcal · 38g protein', ['Lentils']),
          meal('Snack', 'Soy yoghurt and berries', '400 kcal · 14g protein', ['Soy yoghurt', 'Berries'])
        ]
      }
    }
  };

  function meal(slot, name, meta, items) {
    return { slot: slot, name: name, meta: meta, items: items };
  }

  function trolleyFor(plan) {
    var seen = {};
    var out = [];
    plan.meals.forEach(function (row) {
      row.items.forEach(function (item) {
        if (seen[item]) return;
        seen[item] = true;
        out.push(item);
      });
    });
    return out;
  }

  function comma(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function captionFor(goal, diet, plan) {
    var kcal = comma(plan.kcal);
    var pro = plan.protein + 'g protein';
    if (goal === 'cut' && diet === 'classic') {
      return 'Your first week: built for 82kg cutting to 78kg, at ' + kcal + ' kcal and ' + pro + ', with Swap open on breakfast.';
    }
    var goalName = { cut: 'Cut', build: 'Build', hold: 'Hold' }[goal];
    var dietName = { classic: 'Classic', protein: 'High protein', plant: 'Plant' }[diet];
    return goalName + ', ' + dietName + ': a sample day at ' + kcal + ' kcal and ' + pro + '.';
  }

  if (exp) {
    exp.PLANS = PLANS;
    exp.trolleyFor = trolleyFor;
    exp.captionFor = captionFor;
  }

  if (typeof document === 'undefined') return;
  var root = document.getElementById('plan-demo');
  if (!root) return;

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
        slot.textContent = row.slot.slice(0, 1);
        var name = document.createElement('span');
        name.className = 'meal-name';
        name.textContent = row.name;
        var meta = document.createElement('span');
        meta.className = 'meal-meta';
        meta.textContent = row.slot + ' · ' + row.meta;
        li.appendChild(slot);
        li.appendChild(name);
        li.appendChild(meta);
        mealsEl.appendChild(li);
      });
    }
    if (trolleyEl) {
      trolleyEl.textContent = '';
      trolleyFor(plan).forEach(function (item) {
        var li = document.createElement('li');
        li.textContent = item;
        trolleyEl.appendChild(li);
      });
    }
    var totals = 'The sample day is ' + comma(plan.kcal) + ' kcal and ' + plan.protein + 'g protein.';
    var lock = document.querySelector('.hero-lock');
    if (lock) lock.textContent = totals + ' Pick another goal and the meals follow.';
    var cap = document.querySelector('.hero-shot figcaption');
    if (cap) cap.textContent = captionFor(goal, diet, plan);
  }

  function select(value, attr) {
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
      select(goal, 'goal');
      paint(true);
    } else if (btn.hasAttribute('data-diet')) {
      diet = btn.getAttribute('data-diet');
      select(diet, 'diet');
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
})(typeof module !== 'undefined' && module.exports ? module.exports : null);
