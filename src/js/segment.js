// FreeCut — remoção de fundo por IA (MediaPipe Selfie Segmenter, roda localmente na GPU)
import { FilesetResolver, ImageSegmenter } from '../vendor/mediapipe/vision_bundle.mjs';

let segmenter = null, loading = null, failed = null;
const maskCanvas = document.createElement('canvas');
const cache = new Map();

export function segmenterReady() { return !!segmenter; }
export function segmenterError() { return failed; }

export function loadSegmenter() {
  if (segmenter || loading) return loading;
  loading = (async () => {
    try {
      const files = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
      const make = delegate => ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/vendor/mediapipe/selfie_segmenter.tflite', delegate },
        runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false
      });
      try { segmenter = await make('GPU'); } catch { segmenter = await make('CPU'); }
    } catch (e) { failed = e; console.error('segmentação', e); }
    return segmenter;
  })();
  return loading;
}

/** Devolve um canvas com a máscara (vermelho = pessoa) para a fonte, ou null se a IA não estiver pronta. */
export function maskFor(key, source) {
  if (!segmenter) { loadSegmenter(); return null; }
  if (cache.has(key)) return cache.get(key);
  let result;
  try { result = segmenter.segment(source); } catch (e) { console.warn(e); return null; }
  const m = result.confidenceMasks && result.confidenceMasks[0];
  if (!m) return null;
  const w = m.width, h = m.height, data = m.getAsFloat32Array();
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const img = c.getContext('2d').createImageData(w, h);
  for (let i = 0; i < data.length; i++) { const v = data[i] * 255; img.data[i * 4] = v; img.data[i * 4 + 3] = 255; }
  c.getContext('2d').putImageData(img, 0, 0);
  result.close && result.close();
  if (cache.size > 90) cache.delete(cache.keys().next().value);
  cache.set(key, c);
  void maskCanvas;
  return c;
}
