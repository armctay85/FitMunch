/**
 * FitMunch Charts — Dashboard visualisations
 * Chart.js powered. Auto-initialises on DOMContentLoaded.
 */

(function() {
  'use strict';

  // ── Chart defaults ──────────────────────────────────────────────────────
  const defaults = {
    color: '#8B97B0',
    font: { family: "'Segoe UI', system-ui, sans-serif", size: 11 },
    plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }
  };

  const GREEN      = '#00E676';
  const GREEN_DIM  = '#00C853';
  const ACCENT     = '#448AFF';
  const ORANGE     = '#FF6D00';
  const CARD_BG    = '#111520';
  const BORDER_CLR = 'rgba(255,255,255,0.07)';

  function getChartColors() {
    const isLight = document.body.classList.contains('light-theme');
    return {
      grid: isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.05)',
      label: isLight ? '#4A5568' : '#8B97B0',
      bg: isLight ? '#fff' : '#111520',
    };
  }

  // ── Macro doughnut ──────────────────────────────────────────────────────
  function initMacroChart() {
    const canvas = document.getElementById('dashMacroChart');
    if (!canvas || !window.Chart) return;

    if (canvas._chart) canvas._chart.destroy();

    const c = getChartColors();

    canvas._chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Protein', 'Carbs', 'Fat'],
        datasets: [{
          data: [25, 45, 30],
          backgroundColor: ['#FF6B6B', '#4ECDC4', '#45B7D1'],
          borderWidth: 0,
          hoverOffset: 6,
        }]
      },
      options: {
        cutout: '72%',
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: { color: c.label, padding: 16, font: defaults.font, usePointStyle: true }
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.parsed}%`
            }
          }
        }
      }
    });
  }

  // ── Weekly activity bar chart ───────────────────────────────────────────
  function initWeeklyChart() {
    const canvas = document.getElementById('dashWeeklyChart');
    if (!canvas || !window.Chart) return;

    if (canvas._chart) canvas._chart.destroy();

    const c = getChartColors();
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // Pull from localStorage if available
    function getSavedData() {
      try {
        const d = JSON.parse(localStorage.getItem('weeklyCalories') || 'null');
        return d || [1850, 2100, 1750, 2200, 1900, 1600, 2050];
      } catch { return [1850, 2100, 1750, 2200, 1900, 1600, 2050]; }
    }

    canvas._chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: days,
        datasets: [{
          label: 'Calories',
          data: getSavedData(),
          backgroundColor: days.map((_, i) => i === new Date().getDay() - 1 ? GREEN : 'rgba(0,200,83,0.3)'),
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        scales: {
          x: {
            grid: { color: c.grid },
            ticks: { color: c.label, font: defaults.font }
          },
          y: {
            grid: { color: c.grid },
            ticks: { color: c.label, font: defaults.font },
            beginAtZero: true,
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: ctx => ` ${ctx.parsed.y} cal` }
          }
        }
      }
    });
  }

  // ── Analytics progress chart ────────────────────────────────────────────
  function initProgressChart() {
    const canvas = document.getElementById('progressChart');
    if (!canvas || !window.Chart) return;
    if (canvas._chart) canvas._chart.destroy();

    const c = getChartColors();
    const labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];

    canvas._chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Avg Calories',
          data: [1950, 2050, 1820, 1970],
          borderColor: GREEN,
          backgroundColor: 'rgba(0,230,118,0.1)',
          borderWidth: 2,
          pointBackgroundColor: GREEN,
          pointRadius: 4,
          fill: true,
          tension: 0.4,
        }]
      },
      options: {
        responsive: true,
        scales: {
          x: { grid: { color: c.grid }, ticks: { color: c.label, font: defaults.font } },
          y: { grid: { color: c.grid }, ticks: { color: c.label, font: defaults.font }, beginAtZero: false }
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} cal` } }
        }
      }
    });
  }

  // ── Nutrition doughnut (analytics page) ────────────────────────────────
  function initNutritionChart() {
    const canvas = document.getElementById('nutritionChart');
    if (!canvas || !window.Chart) return;
    if (canvas._chart) canvas._chart.destroy();

    canvas._chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Protein', 'Carbs', 'Fat'],
        datasets: [{
          data: [25, 45, 30],
          backgroundColor: ['#FF6B6B', '#4ECDC4', '#45B7D1'],
          borderWidth: 0,
          hoverOffset: 4,
        }]
      },
      options: {
        cutout: '65%',
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}%` } }
        }
      }
    });
  }

  // ── Init all charts ──────────────────────────────────────────────────────
  function initAllCharts() {
    if (!window.Chart) {
      console.warn('Chart.js not loaded yet');
      return;
    }

    // Apply global defaults
    Chart.defaults.color = getChartColors().label;
    Chart.defaults.font.family = defaults.font.family;

    initMacroChart();
    initWeeklyChart();
    initProgressChart();
    initNutritionChart();
  }

  // ── Update charts when macros change ────────────────────────────────────
  window.updateMacroChart = function(protein, carbs, fat) {
    const canvas = document.getElementById('dashMacroChart');
    if (!canvas || !canvas._chart) return;
    const total = protein + carbs + fat || 1;
    canvas._chart.data.datasets[0].data = [
      Math.round((protein / total) * 100),
      Math.round((carbs   / total) * 100),
      Math.round((fat     / total) * 100),
    ];
    canvas._chart.update('active');
  };

  // ── Wire up section navigation to init charts lazily ────────────────────
  const _origShowSection = window.showSection;
  window.showSection = function(sectionName) {
    if (typeof _origShowSection === 'function') _origShowSection(sectionName);
    if (sectionName === 'dashboard') { setTimeout(initMacroChart, 50); setTimeout(initWeeklyChart, 50); }
    if (sectionName === 'fitness')   { setTimeout(initProgressChart, 50); setTimeout(initNutritionChart, 50); }
  };

  // ── Init on load ─────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initAllCharts, 200));
  } else {
    setTimeout(initAllCharts, 200);
  }

  // Re-init on theme toggle
  document.addEventListener('themeChanged', initAllCharts);

  // Export
  window.fitmunchCharts = { initAllCharts, initMacroChart, initWeeklyChart };

})();
