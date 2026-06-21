/**
 * ai-facecrop.js — FormPhotoResizer.in
 * Shared face detection + auto-crop module.
 *
 * Uses face-api.js (TinyFaceDetector — 190 KB model, fast, browser-based).
 * Model weights are loaded from jsDelivr CDN — no local files needed.
 *
 * Usage from any page:
 *   import { autoFaceCrop, isFaceApiReady } from '../assets/ai-facecrop.js';
 *
 *   const croppedCanvas = await autoFaceCrop(imageElement);
 *   // croppedCanvas is a <canvas> centred on the detected face
 *   // ready to pass into the resize/compress pipeline
 *
 * If no face is found, OR if the face is already well-framed (portrait aspect
 * ratio, proper headroom/chin-room, face the right size), returns null so the
 * caller can use the original image as-is without unnecessary zoom-in.
 */

/* ── CDN for face-api.js ── */
const FACE_API_CDN = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';

/* ── Model base URL (jsDelivr GitHub — includes /weights folder) ── */
const MODEL_BASE = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';

let faceApiLoaded  = false;
let modelsLoaded   = false;
let loadingPromise = null;

/* ────────────────────────────────────────────────
   Public API
──────────────────────────────────────────────── */

export function isFaceApiReady() {
  return modelsLoaded;
}

/**
 * autoFaceCrop(imageSource)
 *
 * Detects the largest face in the image and returns a canvas cropped
 * to passport/government-photo proportions (3:4 width:height), with
 * the face centred and correctly padded — matching what professional
 * photo studios produce.
 *
 * Padding strategy (relative to FACE BOX height):
 *   - Above head (forehead + clearance): 1.4×
 *   - Below chin:                        0.9×
 *   - Left/right:                        forced by 3:4 aspect ratio
 *
 * The resulting crop is then normalised to exactly 3:4 aspect ratio
 * by extending whichever dimension is shorter, keeping the face centred.
 *
 * @param {HTMLImageElement|HTMLCanvasElement|string} imageSource
 * @returns {Promise<HTMLCanvasElement|null>}
 */
export async function autoFaceCrop(imageSource) {
  await _ensureLoaded();

  const img = await _toImageElement(imageSource);
  if (!img) return null;

  const W = img.naturalWidth;
  const H = img.naturalHeight;

  /* ── Detect faces ── */
  let detections;
  try {
    detections = await window.faceapi
      .detectAllFaces(img, new window.faceapi.TinyFaceDetectorOptions({
        inputSize:      416,
        scoreThreshold: 0.35,   // slightly lower threshold — catches angled faces
      }));
  } catch (e) {
    console.warn('[ai-facecrop] Detection error:', e);
    return null;
  }

  if (!detections || detections.length === 0) {
    console.info('[ai-facecrop] No face detected — returning null.');
    return null;
  }

  /* Use the largest detected face */
  const box = detections
    .map(d => d.box)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];

  const fh = box.height;   // face box height — all padding is relative to this
  const fw = box.width;

  /*
   * ── Already well-framed check ──
   *
   * If the photo is already a good passport/ID crop — face centred,
   * proper headroom above, chin-to-bottom clearance, and portrait
   * aspect ratio — skip cropping to avoid unnecessary zoom-in.
   *
   * Criteria (all must pass):
   *   1. Aspect ratio is portrait-ish (W/H ≤ 0.90 — covers 3:4, 2:3, etc.)
   *   2. Face width occupies 25–80% of image width
   *      (25% lower bound catches properly-framed photos with shoulder room;
   *       80% upper bound catches extreme close-ups that still need re-crop)
   *   3. Face vertical centre sits in the upper 20–70% of image height
   *      (relaxed from 30–65% — catches faces slightly higher or lower)
   *   4. Adequate headroom above face box top  (≥ 8% of image height)
   *      (relaxed from 15% — some well-framed photos have tighter headroom)
   *   5. Adequate chin room below face box bottom (≥ 8% of image height)
   *      (relaxed from 10%)
   */
  const aspectRatio      = W / H;
  const faceWidthRatio   = fw / W;
  const faceCentreYRatio = (box.y + fh / 2) / H;
  const headroomRatio    = box.y / H;                      // space above face box top
  const chinRoomRatio    = (H - (box.y + fh)) / H;        // space below face box bottom

  const isPortrait            = aspectRatio <= 0.90;
  const faceWellSized         = faceWidthRatio >= 0.25 && faceWidthRatio <= 0.80;
  const faceCentredVertically = faceCentreYRatio >= 0.20 && faceCentreYRatio <= 0.70;
  const hasHeadroom           = headroomRatio >= 0.08;
  const hasChinRoom           = chinRoomRatio >= 0.08;

  if (isPortrait && faceWellSized && faceCentredVertically && hasHeadroom && hasChinRoom) {
    console.info(
      `[ai-facecrop] Face already well-framed — skipping crop. ` +
      `(aspect=${aspectRatio.toFixed(2)}, faceW%=${(faceWidthRatio*100).toFixed(1)}, ` +
      `faceY%=${(faceCentreYRatio*100).toFixed(1)}, headroom%=${(headroomRatio*100).toFixed(1)}, ` +
      `chinRoom%=${(chinRoomRatio*100).toFixed(1)})`
    );
    return null;   // caller treats null as "use original image as-is"
  }

  /*
   * ── Padding values (tuned for passport/government photos) ──
   *
   * Think of it like the competitor's manual crop:
   *   "face takes up ~55% of the frame height, centred slightly above middle"
   *
   * padTop: room for top-of-head above the detected face box.
   *         face-api boxes clip at roughly the eyebrow line, so we need
   *         ~0.5 × fh just to reach the top of the head, then extra
   *         clearance above that. Total: 1.4 × fh.
   *
   * padBot: chin to bottom of frame. Includes neck + a bit of shoulders.
   *         Total: 0.9 × fh.
   *
   * Side padding is derived from the 3:4 aspect ratio constraint below.
   */
  const padTop = fh * 1.4;
  const padBot = fh * 0.9;

  /* Raw crop region (unconstrained width for now) */
  let cropY  = box.y - padTop;
  let cropH  = fh + padTop + padBot;

  /* Clamp to image bounds */
  if (cropY < 0) { cropH += cropY; cropY = 0; }
  if (cropY + cropH > H) cropH = H - cropY;

  /*
   * ── Force 3:4 aspect ratio (width:height) ──
   *
   * Government/passport photos are portrait 3:4.
   * Derive the required width from the cropped height,
   * centred horizontally on the face.
   */
  let cropW = cropH * (3 / 4);
  let cropX = (box.x + fw / 2) - cropW / 2;   // centre on face

  /* Clamp horizontally */
  if (cropX < 0) cropX = 0;
  if (cropX + cropW > W) cropX = W - cropW;

  /* If image is narrower than the desired width, reduce and re-centre */
  if (cropW > W) {
    cropW = W;
    cropX = 0;
    /* Recalc height to maintain 3:4, then re-centre vertically on face */
    cropH = cropW * (4 / 3);
    const faceCentreY = box.y + fh / 2;
    cropY = faceCentreY - cropH * 0.42;   // face sits slightly above centre (passport standard)
    if (cropY < 0) cropY = 0;
    if (cropY + cropH > H) cropY = H - cropH;
  }

  /* ── Draw to canvas ── */
  const canvas  = document.createElement('canvas');
  canvas.width  = Math.round(cropW);
  canvas.height = Math.round(cropH);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.drawImage(
    img,
    Math.round(cropX), Math.round(cropY),
    Math.round(cropW), Math.round(cropH),
    0, 0,
    canvas.width, canvas.height
  );

  console.info(`[ai-facecrop] Cropped: x=${Math.round(cropX)} y=${Math.round(cropY)} w=${Math.round(cropW)} h=${Math.round(cropH)} (face box: ${Math.round(fw)}×${Math.round(fh)})`);

  return canvas;
}

/* ────────────────────────────────────────────────
   Internal helpers
──────────────────────────────────────────────── */

async function _ensureLoaded() {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    if (!window.faceapi) {
      await _loadScript(FACE_API_CDN);
      faceApiLoaded = true;
    }
    await window.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_BASE);
    modelsLoaded = true;
    console.info('[ai-facecrop] face-api.js + TinyFaceDetector loaded ✓');
  })();

  return loadingPromise;
}

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s   = document.createElement('script');
    s.src     = src;
    s.onload  = resolve;
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

async function _toImageElement(source) {
  if (source instanceof HTMLImageElement) {
    if (!source.complete) await new Promise(r => source.addEventListener('load', r));
    return source;
  }
  if (source instanceof HTMLCanvasElement) {
    const img = new Image();
    img.src = source.toDataURL();
    await new Promise(r => img.addEventListener('load', r));
    return img;
  }
  if (typeof source === 'string') {
    const img = new Image();
    img.src = source;
    await new Promise((resolve, reject) => {
      img.onload  = resolve;
      img.onerror = reject;
    });
    return img;
  }
  return null;
}
