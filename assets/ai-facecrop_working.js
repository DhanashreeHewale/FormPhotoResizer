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
 * If no face is found, returns null so the caller can fall back gracefully.
 */

/* ── CDN for face-api.js ── */
const FACE_API_CDN = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';

/* ── Model base URL (jsDelivr — no CORS issues) ── */
const MODEL_BASE = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';

let faceApiLoaded  = false;
let modelsLoaded   = false;
let loadingPromise = null;

/* ────────────────────────────────────────────────
   Public API
──────────────────────────────────────────────── */

/**
 * Returns true if face-api.js is ready to use.
 */
export function isFaceApiReady() {
  return modelsLoaded;
}

/**
 * autoFaceCrop(imageSource, paddingFactor?)
 *
 * @param {HTMLImageElement|HTMLCanvasElement|string} imageSource
 *   — an <img> element, <canvas>, or a data URL string.
 * @param {number} [paddingFactor=0.5]
 *   — how much padding to add around the detected face box (0.5 = 50%).
 *
 * @returns {Promise<HTMLCanvasElement|null>}
 *   — canvas cropped and centred on the face, or null if no face found.
 */
export async function autoFaceCrop(imageSource, paddingFactor = 0.5) {
  await _ensureLoaded();

  /* Normalise input to HTMLImageElement */
  const img = await _toImageElement(imageSource);
  if (!img) return null;

  /* Detect faces */
  let detections;
  try {
    detections = await window.faceapi
      .detectAllFaces(img, new window.faceapi.TinyFaceDetectorOptions({
        inputSize:   416,
        scoreThreshold: 0.4,
      }));
  } catch (e) {
    console.warn('[ai-facecrop] Detection error:', e);
    return null;
  }

  if (!detections || detections.length === 0) {
    console.info('[ai-facecrop] No face detected — returning null.');
    return null;
  }

  /* Use the largest detected face (most prominent) */
  const box = detections
    .map(d => d.box)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];

  /* ── Calculate crop region ──
     Government passport photos need:
     - Face centred horizontally
     - ~60% padding above face for forehead/top-of-head
     - ~35% padding below chin
     - ~45% padding on each side
  */
  const padX   = box.width  * paddingFactor;
  const padTop = box.height * 0.65;
  const padBot = box.height * 0.40;

  const cx = Math.max(0, box.x - padX);
  const cy = Math.max(0, box.y - padTop);
  const cw = Math.min(img.naturalWidth  - cx, box.width  + padX * 2);
  const ch = Math.min(img.naturalHeight - cy, box.height + padTop + padBot);

  /* ── Draw cropped region to canvas ── */
  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(cw);
  canvas.height = Math.round(ch);
  const ctx = canvas.getContext('2d');

  /* White background (in case of transparent edges) */
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.drawImage(
    img,
    Math.round(cx), Math.round(cy),
    Math.round(cw), Math.round(ch),
    0, 0,
    canvas.width, canvas.height
  );

  return canvas;
}

/* ────────────────────────────────────────────────
   Internal helpers
──────────────────────────────────────────────── */

async function _ensureLoaded() {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    /* 1. Load face-api.js library if not already on window */
    if (!window.faceapi) {
      await _loadScript(FACE_API_CDN);
      faceApiLoaded = true;
    }

    /* 2. Load TinyFaceDetector model weights from CDN */
    await window.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_BASE);

    modelsLoaded = true;
    console.info('[ai-facecrop] face-api.js + TinyFaceDetector loaded ✓');
  })();

  return loadingPromise;
}

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve(); return;
    }
    const s    = document.createElement('script');
    s.src      = src;
    s.onload   = resolve;
    s.onerror  = () => reject(new Error(`Failed to load: ${src}`));
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
