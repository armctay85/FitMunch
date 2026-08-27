/**
 * Stranger first haul: photograph YOUR receipt, get YOUR score and tonight's dinner.
 * Never paints a sample Woolies shop as the visitor's trolley.
 * First screen is the job: file input + getUserMedia capture, not a later-step link.
 */
(function () {
  if (window.FMFirstScan) return;

  var PREMIUM_HREF = '/login.html?plan=premium&utm_source=homepage&utm_medium=first_scan&utm_campaign=value_first#register';

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function show(el, on) {
    if (!el) return;
    el.hidden = !on;
    el.style.display = on ? '' : 'none';
  }

  function preferNativeCapture() {
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
    } catch (_) {}
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
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
    var previewWrap = root.querySelector('[data-fs-preview-wrap]');
    var drop = root.querySelector('[data-fs-drop]');
    var photoBtn = root.querySelector('[data-fs-open-camera]');
    var uploadBtn = root.querySelector('[data-fs-open-library]');
    var shutter = root.querySelector('[data-fs-shutter]');
    var scanBtn = root.querySelector('[data-fs-scan]');
    var clearBtn = root.querySelector('[data-fs-clear]');
    var loading = root.querySelector('[data-fs-loading]');
    var empty = root.querySelector('[data-fs-empty]');
    var results = root.querySelector('[data-fs-results]');
    var video = root.querySelector('[data-fs-live]');
    var out = root.querySelector('[data-fs-out]');
    var blob = null;
    var stream = null;

    function markOut(state) {
      if (!out) return;
      out.setAttribute('data-fs-state', state);
    }

    function setMode(mode) {
      root.setAttribute('data-fs-mode', mode);
      show(drop, mode === 'ready');
      show(video, mode === 'live');
      show(previewWrap, mode === 'preview');
      show(photoBtn, mode === 'ready');
      show(uploadBtn, mode === 'ready');
      show(shutter, mode === 'live');
      show(scanBtn, mode === 'preview');
      show(clearBtn, mode === 'live' || mode === 'preview');
    }

    function stopLive() {
      if (stream) {
        stream.getTracks().forEach(function (track) {
          try { track.stop(); } catch (_) {}
        });
        stream = null;
      }
      if (video) {
        try { video.pause(); } catch (_) {}
        video.srcObject = null;
      }
    }

    function openInput(input) {
      if (!input) {
        setError(root, 'Photo picker missing. Refresh and try again.');
        return;
      }
      setError(root, '');
      try { input.value = ''; input.click(); }
      catch (_) { setError(root, 'Could not open the camera or library. Try upload a photo.'); }
    }

    function startLiveCamera() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return Promise.reject(new Error('no getUserMedia'));
      }
      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 1920 },
        },
      }).then(function (next) {
        stream = next;
        if (!video) throw new Error('Live view missing');
        video.srcObject = next;
        video.setAttribute('playsinline', '');
        video.muted = true;
        var play = video.play();
        if (play && play.catch) play.catch(function () {});
        setMode('live');
        setError(root, '');
      });
    }

    function photograph() {
      setError(root, '');
      if (preferNativeCapture()) {
        openInput(camera);
        return;
      }
      startLiveCamera().catch(function () {
        openInput(camera);
      });
    }

    function applyBlob(next) {
      blob = next;
      if (!preview) {
        setMode('preview');
        return;
      }
      var reader = new FileReader();
      reader.onload = function (ev) {
        preview.src = ev.target.result;
        setMode('preview');
      };
      reader.onerror = function () {
        setError(root, 'Could not read that image. Try another photo.');
      };
      reader.readAsDataURL(next);
    }

    function captureLiveFrame() {
      if (!video || !video.videoWidth) {
        setError(root, 'Camera is still starting. Try again in a moment.');
        return;
      }
      var canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      canvas.toBlob(function (next) {
        stopLive();
        if (!next) {
          setError(root, 'Could not capture that frame. Try upload a photo.');
          setMode('ready');
          return;
        }
        applyBlob(next);
      }, 'image/jpeg', 0.86);
    }

    if (photoBtn) {
      photoBtn.addEventListener('click', function (e) {
        e.preventDefault();
        photograph();
      });
    }
    if (uploadBtn) {
      uploadBtn.addEventListener('click', function (e) {
        e.preventDefault();
        stopLive();
        openInput(library);
      });
    }
    if (shutter) {
      shutter.addEventListener('click', function (e) {
        e.preventDefault();
        captureLiveFrame();
      });
    }

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
        applyBlob(next);
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
        stopLive();
        if (camera) camera.value = '';
        if (library) library.value = '';
        if (preview) preview.src = '';
        setMode('ready');
        show(results, false);
        show(empty, true);
        show(loading, false);
        markOut('idle');
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
        markOut('loading');
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
              markOut('result');
            });
          })
          .catch(function (err) {
            show(empty, true);
            show(results, false);
            markOut('error');
            setError(root, (err && err.message) || 'Could not read that receipt. Try a flatter photo in better light.');
          })
          .then(function () {
            show(loading, false);
            scanBtn.disabled = false;
          });
      });
    }

    function release() {
      stopLive();
    }
    window.addEventListener('pagehide', release);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) release();
    });

    setMode('ready');
    markOut('idle');
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
