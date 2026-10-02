(function revealLoop() {
  var steps = document.querySelectorAll('.step');
  if (!steps.length) return;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { steps.forEach(function (s) { s.classList.add('show'); }); return; }
  var rail = document.getElementById('loop-rail');
  if (!rail || !('IntersectionObserver' in window)) {
    steps.forEach(function (s) { s.classList.add('show'); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    if (entries.some(function (e) { return e.isIntersecting; })) {
      steps.forEach(function (s) { s.classList.add('show'); });
      io.disconnect();
    }
  }, { threshold: 0.25 });
  io.observe(rail);
})();

(function haulScoreMotion() {
  var device = document.getElementById('proof-device');
  var score = document.querySelector('[data-count]');
  var protein = document.querySelector('[data-count-protein]');
  if (!device || !score || !protein) return;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var run = function () {
    device.classList.add('in');
    if (reduced) {
      score.textContent = score.getAttribute('data-count');
      protein.textContent = protein.getAttribute('data-count-protein') + 'g protein';
      return;
    }
    var target = Number(score.getAttribute('data-count') || 0);
    var pTarget = Number(protein.getAttribute('data-count-protein') || 0);
    var start = performance.now();
    var dur = 1100;
    var tick = function (now) {
      var t = Math.min(1, (now - start) / dur);
      var e = 1 - Math.pow(1 - t, 3);
      score.textContent = String(Math.round(target * e));
      protein.textContent = Math.round(pTarget * e) + 'g protein';
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) { run(); io.disconnect(); }
    }, { threshold: 0.35 });
    io.observe(device);
  } else run();
})();
