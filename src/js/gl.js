// FreeCut — processador de efeitos em WebGL2 (cor, filtros, efeitos, chroma key, máscara de fundo)

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D tex, maskTex;
uniform vec2 res;
uniform float t, amt;
uniform int effect, hasMask;
uniform float bright, contr, sat, expo, temp, tint, hue, hil, shad, vib, sharp, vign, fade, grain;
uniform vec3 shTone, hiTone;
uniform int chroma; uniform vec3 key; uniform float sim, smooth_, spill;

float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 hueRot(vec3 c, float a){
  float cs = cos(a), sn = sin(a);
  mat3 m = mat3(0.299 + 0.701*cs + 0.168*sn, 0.299 - 0.299*cs - 0.328*sn, 0.299 - 0.3*cs + 1.25*sn,
                0.587 - 0.587*cs + 0.33*sn, 0.587 + 0.413*cs + 0.035*sn, 0.587 - 0.588*cs - 1.05*sn,
                0.114 - 0.114*cs - 0.497*sn, 0.114 - 0.114*cs + 0.292*sn, 0.114 + 0.886*cs - 0.203*sn);
  return clamp(m * c, 0.0, 1.0);
}
vec4 S(vec2 q){ return texture(tex, clamp(q, 0.0, 1.0)); }

void main(){
  vec2 q = uv;
  float A = amt;
  // ---------- distorções de coordenadas ----------
  if (effect == 5) { float n = mix(160.0, 12.0, A); vec2 cells = vec2(n, n * res.y / res.x); q = (floor(q * cells) + 0.5) / cells; }
  if (effect == 6) { if (q.x > 0.5) q.x = 1.0 - q.x; }
  if (effect == 10) { vec2 c = q - 0.5; float a = atan(c.y, c.x), r = length(c); float seg = 6.2831853 / 6.0; a = mod(a, seg); a = abs(a - seg / 2.0); q = 0.5 + r * vec2(cos(a), sin(a)); }
  if (effect == 11) { vec2 c = q - 0.5; float r = length(c); q = 0.5 + c * (1.0 - A * 0.6 * (0.5 - r * r * 2.0)); }
  if (effect == 12) { q.x += sin(q.y * 25.0 + t * 4.0) * 0.012 * A; q.y += cos(q.x * 20.0 + t * 3.0) * 0.008 * A; }
  if (effect == 19) { q.x = fract(q.x * 3.0) * 0.333 + 0.333; }
  if (effect == 1) {
    float band = floor(q.y * 18.0 + floor(t * 12.0) * 7.0);
    float g = step(1.0 - 0.35 * A, rnd(vec2(band, floor(t * 15.0))));
    q.x += (rnd(vec2(band * 1.3, floor(t * 20.0))) - 0.5) * 0.12 * A * g;
  }
  if (effect == 3) { q.x += (rnd(vec2(floor(q.y * 240.0), floor(t * 30.0))) - 0.5) * 0.004 * A + sin(q.y * 3.0 + t * 2.0) * 0.002 * A; }
  if (effect == 18) { q.x += sin(q.y * 60.0 + t * 8.0) * 0.002 * A; }

  vec4 c;
  if (effect == 2 || effect == 1 || effect == 3) {
    float off = (effect == 2 ? 0.012 : 0.006) * A * (effect == 1 ? (0.5 + rnd(vec2(floor(t * 10.0), 1.0))) : 1.0);
    vec4 m = S(q);
    c = vec4(S(q + vec2(off, 0.0)).r, m.g, S(q - vec2(off, 0.0)).b, m.a);
  } else if (effect == 4 || effect == 17) {
    float r = (effect == 4 ? 0.012 : 0.006) * A;
    vec4 acc = vec4(0.0); float wsum = 0.0;
    for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) {
      vec2 d = vec2(float(i), float(j)) / 3.0; float w = exp(-dot(d, d) * 2.0);
      acc += S(q + d * r * vec2(1.0, res.x / res.y)) * w; wsum += w;
    }
    c = acc / wsum;
    if (effect == 17) { vec4 s = S(q); c = vec4(max(s.rgb, c.rgb * 1.15) * 0.6 + s.rgb * 0.4, s.a); }
  } else if (effect == 13) {
    vec2 px = 1.0 / res;
    float l = luma(S(q).rgb);
    float gx = luma(S(q + vec2(px.x, 0.0)).rgb) - luma(S(q - vec2(px.x, 0.0)).rgb);
    float gy = luma(S(q + vec2(0.0, px.y)).rgb) - luma(S(q - vec2(0.0, px.y)).rgb);
    float e = 1.0 - clamp(length(vec2(gx, gy)) * 6.0, 0.0, 1.0);
    c = vec4(mix(S(q).rgb, vec3(e * (0.9 + l * 0.1)), A), S(q).a);
  } else c = S(q);

  // ---------- nitidez ----------
  if (sharp > 0.0) {
    vec2 px = 1.0 / res;
    vec3 n = S(q + vec2(px.x, 0.0)).rgb + S(q - vec2(px.x, 0.0)).rgb + S(q + vec2(0.0, px.y)).rgb + S(q - vec2(0.0, px.y)).rgb;
    c.rgb = clamp(c.rgb + (c.rgb * 4.0 - n) * sharp * 0.6, 0.0, 1.0);
  }

  // ---------- chroma key ----------
  if (chroma == 1) {
    vec2 kc = vec2(dot(key, vec3(-0.169, -0.331, 0.5)), dot(key, vec3(0.5, -0.419, -0.081)));
    vec2 cc = vec2(dot(c.rgb, vec3(-0.169, -0.331, 0.5)), dot(c.rgb, vec3(0.5, -0.419, -0.081)));
    float d = distance(cc, kc);
    float a = smoothstep(sim, sim + smooth_ + 0.001, d);
    c.a *= a;
    float sp = clamp(1.0 - a, 0.0, 1.0) * spill;
    c.rgb = mix(c.rgb, vec3(luma(c.rgb)), sp);
  }
  // ---------- remoção de fundo (máscara de segmentação) ----------
  if (hasMask == 1) { float m = texture(maskTex, uv).r; c.a *= smoothstep(0.35, 0.65, m); }

  // ---------- cor ----------
  vec3 col = c.rgb;
  col *= pow(2.0, expo);
  col += bright * 0.35;
  col.r += temp * 0.12; col.b -= temp * 0.12; col.g += temp * 0.02;
  col.g -= tint * 0.1; col.r += tint * 0.04; col.b += tint * 0.04;
  float L = luma(col);
  col += hil * 0.35 * smoothstep(0.45, 1.0, L);
  col += shad * 0.35 * (1.0 - smoothstep(0.0, 0.55, L));
  col = (col - 0.5) * (1.0 + contr) + 0.5;
  L = luma(col);
  float mx = max(col.r, max(col.g, col.b)), mn = min(col.r, min(col.g, col.b));
  col = mix(vec3(L), col, 1.0 + sat + vib * (1.0 - (mx - mn)));
  if (abs(hue) > 0.0001) col = hueRot(clamp(col, 0.0, 1.0), hue);
  L = luma(clamp(col, 0.0, 1.0));
  col += shTone * (1.0 - L) * (1.0 - L) + hiTone * L * L;
  col = mix(col, col * 0.82 + 0.1, fade);
  if (vign > 0.0) { float d = distance(uv, vec2(0.5)); col *= 1.0 - vign * smoothstep(0.3, 0.85, d); }
  if (grain > 0.0) col += (rnd(uv * res + t * 61.0) - 0.5) * grain * 0.25;

  // ---------- efeitos de cor ----------
  if (effect == 7) col = mix(col, 1.0 - col, A);
  if (effect == 8) { float f = pow(max(0.0, sin(t * 6.2831 * 1.5)), 8.0); col += f * A; }
  if (effect == 9) col *= 1.0 - A * 0.35 * step(0.5, fract(uv.y * res.y / 3.0));
  if (effect == 3) { col += (rnd(uv * res + floor(t * 30.0)) - 0.5) * 0.12 * A; col = mix(col, col * vec3(1.05, 0.95, 1.08), A); col *= 1.0 - 0.25 * A * step(0.97, fract(uv.y * 6.0 - t * 0.7)); }
  if (effect == 14) { float lv = mix(12.0, 3.0, A); col = floor(col * lv) / lv; }
  if (effect == 15) {
    vec2 c1 = vec2(0.15 + 0.2 * sin(t * 0.7), 0.9), c2 = vec2(0.95, 0.2 + 0.2 * cos(t * 0.5));
    col += A * (vec3(1.0, 0.45, 0.15) * exp(-distance(uv, c1) * 3.5) + vec3(1.0, 0.2, 0.5) * exp(-distance(uv, c2) * 4.0)) * 0.9;
  }
  if (effect == 16) { col *= mix(1.0, step(0.5, fract(t * 6.0)) * 1.4 + 0.2, A); }
  if (effect == 18) { float r = rnd(vec2(floor(uv.x * 140.0), floor((uv.y + t * 1.6) * 18.0))); col += step(0.985, r) * 0.35 * A; col *= 1.0 - 0.15 * A; }
  if (effect == 1) { col = mix(col, col.gbr, 0.25 * A * step(0.85, rnd(vec2(floor(t * 8.0), floor(uv.y * 9.0))))); }

  col = clamp(col, 0.0, 1.0);
  o = vec4(col * c.a, c.a);
}`;

export class GLFX {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 16;
    const gl = this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL2 indisponível');
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = this.prog = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['tex', 'maskTex', 'res', 't', 'amt', 'effect', 'hasMask', 'bright', 'contr', 'sat', 'expo', 'temp', 'tint', 'hue', 'hil', 'shad', 'vib', 'sharp', 'vign', 'fade', 'grain', 'shTone', 'hiTone', 'chroma', 'key', 'sim', 'smooth_', 'spill'])
      this.u[n] = gl.getUniformLocation(p, n);
    this.tex = this.mkTex(); this.maskTex = this.mkTex();
    gl.uniform1i(this.u.tex, 0); gl.uniform1i(this.u.maskTex, 1);
    // segunda tela para encadear vários efeitos
    this.tmp = document.createElement('canvas');
  }
  mkTex() {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /**
   * Processa uma fonte (vídeo, imagem ou canvas) e devolve um canvas com o resultado.
   * a = ajustes já combinados (filtro + ajustes manuais), fx = [{gl, amount}], chroma, mask = ImageData/canvas da segmentação
   */
  process(src, w, h, { a = {}, fx = [], chroma = null, mask = null, time = 0 }) {
    const passes = fx.length ? fx : [null];
    let input = src;
    let out = null;
    passes.forEach((e, i) => {
      const last = i === passes.length - 1;
      this.pass(input, w, h, {
        a: last ? a : {}, e, chroma: i === 0 ? chroma : null, mask: i === 0 ? mask : null, time
      });
      if (!last) {
        // copia para a tela temporária e usa como entrada do próximo passe
        this.tmp.width = w; this.tmp.height = h;
        const c = this.tmp.getContext('2d');
        c.clearRect(0, 0, w, h); c.drawImage(this.canvas, 0, 0);
        input = this.tmp;
      }
      out = this.canvas;
    });
    return out;
  }

  pass(src, w, h, { a, e, chroma, mask, time }) {
    const gl = this.gl, u = this.u;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    if (mask) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, mask);
    gl.uniform1i(u.hasMask, mask ? 1 : 0);
    gl.uniform2f(u.res, w, h);
    gl.uniform1f(u.t, time);
    gl.uniform1i(u.effect, e ? e.gl : 0);
    gl.uniform1f(u.amt, e ? e.amount : 0);
    const v = k => (a[k] || 0) / 100;
    gl.uniform1f(u.bright, v('brightness')); gl.uniform1f(u.contr, v('contrast')); gl.uniform1f(u.sat, v('saturation'));
    gl.uniform1f(u.expo, v('exposure') * 1.5); gl.uniform1f(u.temp, v('temperature')); gl.uniform1f(u.tint, v('tint'));
    gl.uniform1f(u.hue, (a.hue || 0) * Math.PI / 180); gl.uniform1f(u.hil, v('highlights')); gl.uniform1f(u.shad, v('shadows'));
    gl.uniform1f(u.vib, v('vibrance')); gl.uniform1f(u.sharp, v('sharpen')); gl.uniform1f(u.vign, v('vignette'));
    gl.uniform1f(u.fade, v('fade')); gl.uniform1f(u.grain, v('grain'));
    gl.uniform3fv(u.shTone, a.sh || [0, 0, 0]); gl.uniform3fv(u.hiTone, a.hi || [0, 0, 0]);
    gl.uniform1i(u.chroma, chroma ? 1 : 0);
    if (chroma) {
      const n = parseInt(chroma.color.slice(1), 16);
      gl.uniform3f(u.key, (n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
      gl.uniform1f(u.sim, chroma.sim / 100 * 0.4); gl.uniform1f(u.smooth_, chroma.smooth / 100 * 0.3); gl.uniform1f(u.spill, chroma.spill / 100);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

/** Indica se um clipe precisa passar pelo WebGL. */
export function needsGL(a, fx, chroma, bg) {
  if (fx.length || (chroma && chroma.on) || bg) return true;
  for (const k in a) if (a[k] && (Array.isArray(a[k]) ? a[k].some(Boolean) : true)) return true;
  return false;
}
