/**
 * FormPhotoResize.in — Shared Tool Engine v2
 * assets/tool.js
 *
 * Fixes in v2:
 *  - Binary-search smart KB compression (hits target KB automatically)
 *  - Correct auto-filename per preset (mpscphoto.jpg = 9 chars)
 *  - KB target input wired up
 *  - Validation strip shows pass/fail against maxKB
 *  - Share buttons (WhatsApp + copy link)
 *  - Star rating widget
 *  - No conflicts with any inline script
 *
 * Each page defines window.TOOL_CONFIG before this script loads:
 *   window.TOOL_CONFIG = {
 *     presets: [{ id, icon, name, sizeLabel, kbLabel, w, h, maxKB, format, filename }],
 *     defaultPresetId: 'aadhar',
 *     examName: 'MPSC',
 *   }
 */

(function () {
  'use strict';

  /* ── State ── */
  let originalFile   = null;
  let outputDataURL  = null;
  let outputFilename = 'photo.jpg';
  let activePreset   = null;

  /* ── DOM refs ── */
  let elPresets, elUploadZone, elFileInput, elBtnProcess, elResultCard,
      elBtnDownload, elInpW, elInpH, elInpFmt, elInpQ, elQDisplay,
      elInpKb, elOrigPreview, elOutPreview, elOrigLabel, elOutLabel,
      elStatOrig, elStatNew, elStatSaved, elStatDim,
      elFilename, elValidation, elStep1, elStep2, elStep3;

  /* ── Init ── */
  function init() {
    elPresets     = document.getElementById('preset-grid');
    elUploadZone  = document.getElementById('upload-zone');
    elFileInput   = document.getElementById('file-input');
    elBtnProcess  = document.getElementById('btn-process');
    elResultCard  = document.getElementById('result-card');
    elBtnDownload = document.getElementById('btn-download');
    elInpW        = document.getElementById('inp-w');
    elInpH        = document.getElementById('inp-h');
    elInpFmt      = document.getElementById('inp-fmt');
    elInpQ        = document.getElementById('inp-q');
    elQDisplay    = document.getElementById('q-display');
    elInpKb       = document.getElementById('inp-kb');
    elOrigPreview = document.getElementById('orig-preview');
    elOutPreview  = document.getElementById('out-preview');
    elOrigLabel   = document.getElementById('orig-label');
    elOutLabel    = document.getElementById('out-label');
    elStatOrig    = document.getElementById('stat-orig');
    elStatNew     = document.getElementById('stat-new');
    elStatSaved   = document.getElementById('stat-saved');
    elStatDim     = document.getElementById('stat-dim');
    elFilename    = document.getElementById('dl-filename');
    elValidation  = document.getElementById('validation-strip');
    elStep1       = document.getElementById('step-1');
    elStep2       = document.getElementById('step-2');
    elStep3       = document.getElementById('step-3');

    const config = window.TOOL_CONFIG || {};

    /* ── Render preset buttons ── */
    if (elPresets && config.presets && config.presets.length) {
      elPresets.innerHTML = '';
      config.presets.forEach((p, i) => {
        const btn = document.createElement('button');
        btn.className   = 'preset-btn' + (i === 0 ? ' active' : '');
        btn.dataset.id  = p.id;
        btn.innerHTML   = `
          <span class="p-icon">${p.icon || '📄'}</span>
          <span class="p-name">${p.name}</span>
          <span class="p-size">${p.sizeLabel}</span>
          <span class="p-kb">${p.kbLabel}</span>`;
        btn.addEventListener('click', () => selectPreset(p, btn));
        elPresets.appendChild(btn);
      });
      selectPreset(config.presets[0], elPresets.querySelector('.preset-btn'));
    }

    /* ── Quality slider ── */
    if (elInpQ && elQDisplay) {
      elInpQ.addEventListener('input', () => { elQDisplay.textContent = elInpQ.value + '%'; });
    }

    /* ── Upload zone ── */
    if (elUploadZone) {
      /* Inject AI auto-face-crop toggle (shared across all resizer pages) */
      if (!document.getElementById('auto-face-toggle')) {
        const wrap = document.createElement('div');
        wrap.className = 'auto-face-wrap';
        wrap.innerHTML = `
          <label class="auto-face-toggle">
            <input type="checkbox" id="auto-face-toggle" checked>
            <span>🎯 Auto-centre face with AI <em>(recommended)</em></span>
          </label>
          <div class="face-status" id="face-status" style="display:none;"></div>`;
        elUploadZone.insertAdjacentElement('afterend', wrap);
      }

      elUploadZone.addEventListener('click', () => elFileInput && elFileInput.click());
      elUploadZone.addEventListener('dragover', e => { e.preventDefault(); elUploadZone.classList.add('drag'); });
      elUploadZone.addEventListener('dragleave', () => elUploadZone.classList.remove('drag'));
      elUploadZone.addEventListener('drop', e => {
        e.preventDefault(); elUploadZone.classList.remove('drag');
        const f = e.dataTransfer.files[0];
        if (f && f.type.startsWith('image/')) loadFile(f);
        else showUploadError('Please drop a JPG or PNG image.');
      });
    }
    if (elFileInput) {
      elFileInput.addEventListener('change', () => {
        if (elFileInput.files[0]) loadFile(elFileInput.files[0]);
      });
    }
    const elAutoFace = document.getElementById('auto-face-toggle');
    if (elAutoFace) {
      elAutoFace.addEventListener('change', () => {
        if (elFileInput && elFileInput.files[0]) loadFile(elFileInput.files[0]);
      });
    }

    /* ── Process & download ── */
    if (elBtnProcess)  elBtnProcess.addEventListener('click', processImage);
    if (elBtnDownload) elBtnDownload.addEventListener('click', downloadImage);

    /* ── Share buttons ── */
    const shareWa = document.getElementById('share-wa');
    const shareCopy = document.getElementById('share-copy');
    if (shareWa) {
      shareWa.addEventListener('click', () => {
        window.open('https://wa.me/?text=' + encodeURIComponent(
          'Free tool to resize photos for government forms (Aadhar, PAN, MPSC, SSC) — ' + location.href
        ));
      });
    }
    if (shareCopy) {
      shareCopy.addEventListener('click', function () {
        navigator.clipboard.writeText(location.href).then(() => {
          this.textContent = 'Copied!';
          setTimeout(() => { this.textContent = 'Copy Link'; }, 2000);
        });
      });
    }

    /* ── Star rating ── */
    const stars = document.querySelectorAll('.star-btn');
    const ratingThanks = document.getElementById('rating-thanks');
    if (stars.length) {
      stars.forEach(star => {
        star.addEventListener('mouseover', () => {
          const v = +star.dataset.v;
          stars.forEach(s => s.classList.toggle('lit', +s.dataset.v <= v));
        });
        star.addEventListener('mouseout', () => {
          if (ratingThanks && ratingThanks.style.display !== 'block')
            stars.forEach(s => s.classList.remove('lit'));
        });
        star.addEventListener('click', () => {
          const v = +star.dataset.v;
          stars.forEach(s => s.classList.toggle('lit', +s.dataset.v <= v));
          if (ratingThanks) ratingThanks.style.display = 'block';
        });
      });
    }

    /* ── FAQ accordion ── */
    document.querySelectorAll('.faq-q-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const item    = btn.closest('.faq-item');
        const wasOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
        if (!wasOpen) item.classList.add('open');
      });
    });

    /* ── Mobile nav toggle ── */
    const navToggle = document.querySelector('.nav-toggle');
    const siteNav   = document.querySelector('.site-nav');
    if (navToggle && siteNav) {
      navToggle.addEventListener('click', () => siteNav.classList.toggle('open'));
    }

    setStep(1);
  }

  /* ── Preset selection ── */
  function selectPreset(preset, btn) {
    activePreset = preset;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    if (elInpW)  elInpW.value  = preset.w   || 200;
    if (elInpH)  elInpH.value  = preset.h   || 200;
    if (elInpFmt) elInpFmt.value = preset.format || 'jpeg';
    if (elInpKb && preset.maxKB) elInpKb.value = preset.maxKB;
  }

  /* ── Load file ── */
  function loadFile(file) {
    if (elBtnProcess) elBtnProcess.disabled = false;

    const reader = new FileReader();
    reader.onload = e => {
      const dataURL = e.target.result;

      if (isAutoFaceEnabled()) {
        const img = new Image();
        img.onload = () => tryFaceCrop(img, file, dataURL);
        img.src = dataURL;
      } else {
        finishLoad(file, dataURL);
      }
    };
    reader.readAsDataURL(file);
  }

  /* ── AI face auto-crop ── */
  function isAutoFaceEnabled() {
    const t = document.getElementById('auto-face-toggle');
    return !!(t && t.checked);
  }

  function setFaceStatus(msg, kind) {
    const el = document.getElementById('face-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'face-status' + (kind ? ' ' + kind : '');
    el.style.display = msg ? 'flex' : 'none';
  }

  function tryFaceCrop(img, file, dataURL) {
    setFaceStatus('🔎 Detecting face… (first time may take a few seconds)', 'busy');
    const toolScript = document.querySelector('script[src*="tool.js"]');
    const modUrl = toolScript ? new URL('ai-facecrop.js', toolScript.src) : './ai-facecrop.js';
    import(modUrl)
      .then(mod => mod.autoFaceCrop(img))
      .then(canvas => {
        if (!canvas) {
          setFaceStatus('ℹ️ No face detected — using full photo', 'info');
          finishLoad(file, dataURL);
          return;
        }
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        canvas.toBlob(blob => {
          if (!blob) { finishLoad(file, dataURL); return; }
          const cropped = new File([blob], file.name, { type: mime });
          setFaceStatus('✅ Face detected & auto-centred', 'ok');
          finishLoad(cropped, canvas.toDataURL(mime));
        }, mime, 0.95);
      })
      .catch(err => {
        console.warn('[ai-facecrop] failed:', err);
        setFaceStatus('ℹ️ Face detection unavailable — using full photo', 'info');
        finishLoad(file, dataURL);
      });
  }

  function finishLoad(file, dataURL) {
    originalFile = file;
    if (elOrigPreview) elOrigPreview.src = dataURL;
    const kb = fmtKB(file.size);
    if (elOrigLabel) elOrigLabel.innerHTML = `Original &nbsp;<span class="size-tag">${kb}</span>`;
    if (elStatOrig)  elStatOrig.textContent = kb;

    if (elUploadZone) {
      elUploadZone.classList.add('loaded');
      const icon  = elUploadZone.querySelector('.upload-icon');
      const title = elUploadZone.querySelector('.upload-title');
      const sub   = elUploadZone.querySelector('.upload-sub');
      if (icon)  icon.textContent = '✅';
      if (title) title.textContent = file.name;
      if (sub)   sub.innerHTML = `<strong>${kb}</strong> · Click to change`;
    }
    if (elResultCard) elResultCard.classList.remove('show');
    setStep(2);
  }

  function showUploadError(msg) {
    if (!elUploadZone) return;
    const sub = elUploadZone.querySelector('.upload-sub');
    if (sub) {
      sub.style.color = '#DC2626'; sub.textContent = msg;
      setTimeout(() => { sub.style.color = ''; sub.innerHTML = 'JPG, PNG supported · Max 10 MB'; }, 3000);
    }
  }

  /* ── Binary-search KB compression ── */
  function compressToTargetKB(canvas, mime, targetKB) {
    if (mime === 'image/png') return canvas.toDataURL('image/png');
    const targetBytes = targetKB * 1024;
    let lo = 0.05, hi = 1.0, bestURL = null;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const url = canvas.toDataURL(mime, mid);
      const bytes = b64Bytes(url);
      if (bytes <= targetBytes) { bestURL = url; lo = mid; }
      else hi = mid;
      if (hi - lo < 0.005) break;
    }
    /* If even quality=1.0 is under target, just return full quality */
    if (!bestURL) bestURL = canvas.toDataURL(mime, lo);
    return bestURL;
  }

  /* ── Process image ── */
  function processImage() {
    if (!originalFile) return;

    const w   = parseInt(elInpW  ? elInpW.value  : 200) || 200;
    const h   = parseInt(elInpH  ? elInpH.value  : 200) || 200;
    const fmt = elInpFmt ? elInpFmt.value : 'jpeg';
    const manualQ = elInpQ ? parseInt(elInpQ.value) / 100 : 0.82;

    /* Target KB: use inp-kb if present, else fallback to preset maxKB, else manual quality */
    const targetKB = elInpKb && elInpKb.value
      ? parseInt(elInpKb.value)
      : (activePreset && activePreset.maxKB ? activePreset.maxKB : null);

    if (elBtnProcess) {
      elBtnProcess.disabled = true;
      elBtnProcess.innerHTML = '<span style="display:inline-flex;align-items:center;gap:8px"><svg style="animation:spin .7s linear infinite" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>Processing…</span>';
    }

    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');

        /* White background */
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);

        /* Cover-crop — face-aware centre */
        const srcAsp = img.width / img.height;
        const dstAsp = w / h;
        let sx, sy, sw, sh;
        if (srcAsp > dstAsp) {
          /* Source wider than target — trim sides equally */
          sh = img.height; sw = sh * dstAsp;
          sx = (img.width - sw) / 2; sy = 0;
        } else {
          /* Source taller than target (portrait→square) — trim from bottom,
             keeping the top where the face sits after ai-facecrop.
             Starts 25% down instead of 50% so the head is never clipped. */
          sw = img.width; sh = sw / dstAsp;
          sx = 0;
          const maxSy = img.height - sh;
          sy = Math.min(maxSy * 0.25, maxSy);
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);

        const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';

        /* Smart compression: use binary search if targetKB set, else manual quality */
        if (targetKB && fmt !== 'png') {
          outputDataURL = compressToTargetKB(canvas, mime, targetKB);
        } else {
          outputDataURL = canvas.toDataURL(mime, manualQ);
        }

        const outBytes  = b64Bytes(outputDataURL);
        const origBytes = originalFile.size;
        const savedBytes = origBytes - outBytes;
        const savedPct   = savedBytes > 0 ? Math.round((savedBytes / origBytes) * 100) : 0;

        /* Populate result UI */
        if (elOutPreview) elOutPreview.src = outputDataURL;
        if (elOutLabel)   elOutLabel.innerHTML  = `Resized &nbsp;<span class="size-tag">${fmtKB(outBytes)}</span>`;
        if (elStatNew)    elStatNew.textContent  = fmtKB(outBytes);
        if (elStatSaved) {
          elStatSaved.textContent = savedBytes > 0
            ? `−${fmtKB(savedBytes)} (${savedPct}%)`
            : '+' + fmtKB(Math.abs(savedBytes));
          const box = elStatSaved.closest('.stat-box');
          if (box) box.className = 'stat-box ' + (savedBytes > 0 ? 'success' : 'warn');
        }
        if (elStatDim) elStatDim.textContent = `${w} × ${h} px`;

        /* Auto filename — preset filename takes priority */
        const ext = fmt === 'png' ? 'png' : 'jpg';
        if (activePreset && activePreset.filename) {
          outputFilename = activePreset.filename + '.' + ext;
        } else {
          const slug = activePreset
            ? activePreset.id
            : (window.TOOL_CONFIG && window.TOOL_CONFIG.examName
                ? window.TOOL_CONFIG.examName.toLowerCase().replace(/\s+/g, '')
                : 'photo');
          outputFilename = slug + 'photo.' + ext;
        }
        if (elFilename) elFilename.textContent = outputFilename;

        /* Validation strip — KB check */
        if (elValidation) {
          const outKB = outBytes / 1024;
          const limit = targetKB || (activePreset && activePreset.maxKB);
          if (limit) {
            if (outKB <= limit) {
              elValidation.className = 'validation-strip pass';
              elValidation.innerHTML = `✅ &nbsp;${fmtKB(outBytes)} — within the ${limit} KB limit`;
            } else {
              elValidation.className = 'validation-strip fail';
              elValidation.innerHTML = `⚠️ &nbsp;${fmtKB(outBytes)} — over the ${limit} KB limit. Lower quality slider further.`;
            }
            elValidation.style.display = 'flex';
          }
        }

        if (elResultCard) {
          elResultCard.classList.add('show');
          elResultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        /* Show rating box if present */
        const ratingBox = document.getElementById('rating-box');
        if (ratingBox) ratingBox.style.display = 'block';

        setStep(3);

        if (elBtnProcess) {
          elBtnProcess.disabled = false;
          elBtnProcess.innerHTML = 'Resize & Compress Photo';
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(originalFile);
  }

  /* ── Download ── */
  function downloadImage() {
    if (!outputDataURL) return;
    const a = document.createElement('a');
    a.href = outputDataURL;
    a.download = outputFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* ── Step bar ── */
  function setStep(n) {
    [elStep1, elStep2, elStep3].forEach((el, i) => {
      if (!el) return;
      el.classList.remove('active', 'done');
      if (i + 1 < n)  el.classList.add('done');
      if (i + 1 === n) el.classList.add('active');
    });
  }

  /* ── Helpers ── */
  function b64Bytes(dataURL) {
    try { return Math.round(atob(dataURL.split(',')[1]).length); }
    catch { return 0; }
  }

  function fmtKB(bytes) {
    if (bytes < 1024) return bytes + ' B';
    return (bytes / 1024).toFixed(1) + ' KB';
  }

  /* ── Spin animation ── */
  const sty = document.createElement('style');
  sty.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
  document.head.appendChild(sty);

  /* ── Boot ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.FPR = { selectPreset, loadFile, processImage, downloadImage };

})();
