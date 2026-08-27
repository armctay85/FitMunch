/**
 * Stranger first haul: photograph YOUR receipt, get YOUR score and tonight's dinner.
 * Never paints a sample Woolies shop as the visitor's trolley.
 */
(function () {
  if (window.FMFirstScan) return;

  var PREMIUM_HREF = '/login.html?plan=premium&utm_source=homepage&utm_medium=first_scan&utm_campaign=value_first#register';

  function $(id) { return document.getElementById(id); }

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function show(el, on) {
    if (!el) return;
    el.hidden = !on;
    el.style.display = on ? '' : 'none';
  }

  function compressFile(file, maxEdge, quality) {
    maxEdge = maxEdge || 1600;
    quality = quality || 0.82;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var width = img.width;
          var height = img.height;
          var scale = Math.min(1, maxEdge / Math.max(width, height));
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          canvas.toBlob(function (blob) {
            URL.revokeObjectURL(url);
            if (!blob) return reject(new Error('Could not compress photo'));
            resolve(blob);
          }, 'image/jpeg', quality);
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Could not read that image'));
      };
      img.src = url;
    });
  }

  function storeHaul(data) {
    try {
      sessionStorage.setItem('fm_guest_haul', JSON.stringify({
        haulScore: data.haulScore,
        weeklyTotals: data.weeklyTotals,
        itemCount: data.itemCount,
        tonightDinner: data.tonightDinner,
        items: (data.items || []).slice(0, 12).map(function (i) {
          return { name: i.name, nutrition: i.nutrition };
        }),
        savedAt: Date.now(),
      }));
    } catch (_) {}
  }

  function renderResult(root, data) {
    var score = data.haulScore != null ? data.haulScore : data.macroMatchScore;
    var totals = data.weeklyTotals || {};
    var dinner = data.tonightDinner || {};
    var scoreEl = root.querySelector('[data-fs-score]');
    var proteinEl = root.querySelector('[data-fs-protein]');
    var itemsEl = root.querySelector('[data-fs-items]');
    var mealEl = root.querySelector('[data-fs-meal]');
    var whyEl = root.querySelector('[data-fs-why]');
    var usesEl = root.querySelector('[data-fs-uses]');
    setText(scoreEl, String(score));
    setText(proteinEl, (totals.protein || 0) + 'g protein');
    setText(itemsEl, (data.itemCount || 0) + ' items from your receipt');
    setText(mealEl, dinner.meal || 'Cook the highest-protein lines we read on this receipt.');
    setText(whyEl, dinner.why || 'One dinner from items we actually read on your receipt.');
    if (usesEl) {
      usesEl.innerHTML = '';
      (dinner.usesDetectedItems || []).forEach(function (name) {
        var li = document.createElement('li');
        li.textContent = name;
        usesEl.appendChild(li);
      });
    }
    var trial = root.querySelector('[data-fs-trial]');
    if (trial) {
      trial.href = PREMIUM_HREF;
    }
    storeHaul(data);
    if (window.FMTrack && FMTrack.send) {
      FMTrack.send('first_scan_result', {
        haulScore: score,
        itemCount: data.itemCount || 0,
      });
    }
  }

  function setError(root, msg) {
    var err = root.querySelector('[data-fs-error]');
    if (!err) return;
    err.hidden = !msg;
    err.textContent = msg || '';
  }

  function bind(root) {
    if (!root || root.getAttribute('data-fs-bound')) return;
    root.setAttribute('data-fs-bound', '1');

    var camera = root.querySelector('[data-fs-camera]');
    var library = root.querySelector('[data-fs-library]');
    var preview = root.querySelector('[data-fs-preview]');
    var drop = root.querySelector('[data-fs-drop]');
    var scanBtn = root.querySelector('[data-fs-scan]');
    var clearBtn = root.querySelector('[data-fs-clear]');
    var loading = root.querySelector('[data-fs-loading]');
    var empty = root.querySelector('[data-fs-empty]');
    var results = root.querySelector('[data-fs-results]');
    var blob = null;

    function openInput(input) {
      if (!input) {
        setError(root, 'Photo picker missing. Refresh and try again.');
        return;
      }
      setError(root, '');
      try { input.value = ''; input.click(); }
      catch (_) { setError(root, 'Could not open the camera or library. Try the other button.'); }
    }

    root.querySelectorAll('[data-fs-open-camera]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openInput(camera);
      });
    });
    root.querySelectorAll('[data-fs-open-library]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openInput(library);
      });
    });

    function onFile(e) {
      var file = e.target && e.target.files && e.target.files[0];
      if (!file) return;
      setError(root, '');
      if (file.size > 20 * 1024 * 1024) {
        setError(root, 'Image is over 20MB. Take a tighter photo of the receipt.');
        e.target.value = '';
        return;
      }
      var looksHeic = /heic|heif/i.test(file.type || '') || /\.heic$/i.test(file.name || '');
      compressFile(file).then(function (next) {
        blob = next;
        var reader = new FileReader();
        reader.onload = function (ev) {
          if (preview) preview.src = ev.target.result;
          show(preview && preview.closest('[data-fs-preview-wrap]'), true);
          show(drop, false);
        };
        reader.onerror = function () {
          setError(root, 'Could not read that image. Try another photo.');
        };
        reader.readAsDataURL(next);
      }).catch(function () {
        setError(root, looksHeic
          ? 'This HEIC photo could not be prepared. On iPhone, set Camera > Formats to Most Compatible, then retake as JPG.'
          : 'Could not prepare that photo.');
        e.target.value = '';
      });
    }

    if (camera) camera.addEventListener('change', onFile);
    if (library) library.addEventListener('change', onFile);

    if (clearBtn) {
      clearBtn.addEventListener('click', function (e) {
        e.preventDefault();
        blob = null;
        if (camera) camera.value = '';
        if (library) library.value = '';
        if (preview) preview.src = '';
        show(preview && preview.closest('[data-fs-preview-wrap]'), false);
        show(drop, true);
        show(results, false);
        show(empty, true);
        setError(root, '');
      });
    }

    if (scanBtn) {
      scanBtn.addEventListener('click', function (e) {
        e.preventDefault();
        if (!blob) {
          setError(root, 'Take a photo or choose a receipt first.');
          return;
        }
        setError(root, '');
        show(loading, true);
        show(empty, false);
        show(results, false);
        scanBtn.disabled = true;
        var fd = new FormData();
        fd.append('receipt', blob, 'receipt.jpg');
        fetch('/api/receipt/first-scan', { method: 'POST', body: fd })
          .then(function (r) {
            return r.text().then(function (raw) {
              var data = {};
              try { data = raw ? JSON.parse(raw) : {}; } catch (_) {
                throw new Error(r.status === 413
                  ? 'Photo still too large. Retake closer so the receipt fills the frame.'
                  : 'Scanner returned an invalid response.');
              }
              if (!r.ok || !data.success) {
                throw new Error(data.error || 'Could not read that receipt. Try a flatter photo in better light.');
              }
              if (data.scannerProvider === 'fallback' || (data.items || []).some(function (i) {
                return i.confidence === 'sample-fallback';
              })) {
                throw new Error('Could not read that receipt. Try a flatter photo in better light.');
              }
              if (!data.itemCount && !(data.items && data.items.length)) {
                throw new Error('No grocery items found. Try a clearer, flatter receipt photo.');
              }
              renderResult(root, data);
              show(results, true);
              show(empty, false);
            });
          })
          .catch(function (err) {
            show(empty, true);
            show(results, false);
            setError(root, (err && err.message) || 'Could not read that receipt. Try a flatter photo in better light.');
          })
          .then(function () {
            show(loading, false);
            scanBtn.disabled = false;
          });
      });
    }
  }

  function init(scope) {
    var roots = (scope || document).querySelectorAll('[data-first-scan]');
    roots.forEach(bind);
  }

  window.FMFirstScan = { init: init, renderResult: renderResult };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(document); });
  } else {
    init(document);
  }
})();
