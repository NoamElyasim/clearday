// Live glass: the desktop behind the window, captured by the native helper
// (see src/main/mac-capture.mjs) and refracted through a WebGL shader.
//
// Ported from the token widget's initGlass() so the two apps share one
// material. What changed: the pane is the whole (resizable) window, the
// sheen is measured in pixels so it stays a top-edge highlight on a tall pane,
// and two terms were added for ClearDay's themes —
//   uSmoke  darkens the pane in dark mode, so a board full of white text reads
//   uMode   1 = light: milkier tint, lifted over dark backdrops for dark text,
//           and none of the widget's darkening scrim (that was for white text)
// Both, and the tint, are read from theme.css (--glass-*).

const VS = `#version 300 es
  in vec2 aPos;
  out vec2 vUv;
  void main() {
    vUv = vec2(aPos.x * 0.5 + 0.5, 1.0 - (aPos.y * 0.5 + 0.5));
    gl_Position = vec4(aPos, 0.0, 1.0);
  }
`;

const FS = `#version 300 es
  precision mediump float;
  in vec2 vUv;
  out vec4 fragColor;
  uniform sampler2D uVideo;
  uniform vec2 uCropOrigin;
  uniform vec2 uCropSize;
  uniform vec2 uSizePx;
  uniform float uRadiusPx;
  uniform float uBevelPx;
  uniform float uBulge;
  uniform float uAberration;
  uniform float uBlurPx;
  uniform float uTint;
  uniform float uBloom;
  uniform float uTexPerPx;     // texture texels per canvas pixel
  uniform float uDpr;
  uniform float uMode;         // 0 dark, 1 light
  uniform float uSmoke;

  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  // The helper's frames are BGRA.
  vec3 samp(vec2 uv, float lod) {
    return textureLod(uVideo, uv, lod).bgr;
  }

  // 13-tap disc blur (centre + two hex rings), each tap reading the mip level
  // whose texels are as wide as the gap between taps, so sharp text behind the
  // glass blurs instead of showing a grid of ghost copies.
  vec3 frost(vec2 uv, vec2 texel, float rad) {
    float lod = log2(max(1.0, rad * 0.5 * uTexPerPx));
    vec3 sum = samp(uv, lod) * 1.5;
    float total = 1.5;
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0471975512;               // 2pi / 6
      vec2 outer = vec2(cos(a), sin(a));
      vec2 inner = vec2(cos(a + 0.5235987756), sin(a + 0.5235987756));
      sum += samp(uv + outer * rad * texel, lod);
      sum += samp(uv + inner * rad * 0.5 * texel, lod);
      total += 2.0;
    }
    return sum / total;
  }

  void main() {
    vec2 p = (vUv - 0.5) * uSizePx;
    vec2 halfSize = uSizePx * 0.5;
    float rad = min(uRadiusPx, min(halfSize.x, halfSize.y));
    float d = sdRoundBox(p, halfSize, rad);
    if (d > 0.5) discard;
    float edgeAA = smoothstep(0.5, -1.5, d);

    vec2 texel = uCropSize / uSizePx;
    vec2 uvBase = uCropOrigin + vUv * uCropSize;

    // A flat pane with a bevelled rim: the interior passes the scene straight
    // through, only frosted, and all the refraction lives in the rim.
    float t = 1.0 - clamp(-d / uBevelPx, 0.0, 1.0);   // 1 at rim, 0 at bevel base
    float slope = t / sqrt(max(1.0 - t * t, 0.015));
    float mag = min(slope, 3.0) * uBulge;

    float e = 1.0;
    vec2 nrm = normalize(vec2(
      sdRoundBox(p + vec2(e, 0.0), halfSize, rad) - sdRoundBox(p - vec2(e, 0.0), halfSize, rad),
      sdRoundBox(p + vec2(0.0, e), halfSize, rad) - sdRoundBox(p - vec2(0.0, e), halfSize, rad)
    ) + vec2(1e-6));

    vec2 off = nrm * mag * texel;
    float blur = uBlurPx * (1.0 - 0.45 * t);          // rim stays crisper than the pane

    vec3 col = vec3(
      frost(uvBase + off * (1.0 + uAberration), texel, blur).r,
      frost(uvBase + off, texel, blur).g,
      frost(uvBase + off * (1.0 - uAberration), texel, blur).b
    );

    vec3 wide = frost(uvBase + off, texel, uBlurPx * 5.0);
    float wideLuma = dot(wide, vec3(0.299, 0.587, 0.114));

    // Fades the additive terms out over a bright backdrop, where they would
    // stack past 1.0 and clip to a white blob.
    float hot = smoothstep(0.58, 0.92, wideLuma);
    // Its mirror for light mode: a dark backdrop under dark text.
    float cold = 1.0 - smoothstep(0.22, 0.62, wideLuma);

    // Light bleed: bright things behind the glass bloom out into it.
    float bright = max(wideLuma - 0.55, 0.0);
    col += wide * bright * uBloom * (1.0 - hot);

    col = mix(col, vec3(1.0), uTint);
    col *= mix(1.04, 0.94, hot);
    col = mix(col, vec3(0.055, 0.055, 0.07), uSmoke * (1.0 - 0.35 * hot));
    col = mix(col, vec3(0.97), uMode * cold * 0.42);

    // Rim light: bright inner line along the top edge, softer along the bottom.
    float rimFade = t * t;
    float rimGain = 1.0 - 0.8 * hot;
    col += rimFade * clamp(-nrm.y, 0.0, 1.0) * 0.30 * rimGain;
    col += rimFade * clamp(nrm.y, 0.0, 1.0) * 0.13 * rimGain;
    // A white rim is invisible against white; a dark one takes over.
    col -= rimFade * hot * 0.16;

    // Sheen: a soft highlight just under the top edge. Measured in pixels —
    // the widget's was a fraction of its 34px height, which on a tall pane
    // would have become a wide bright band.
    float yPx = vUv.y * uSizePx.y / uDpr;
    float sheen = pow(clamp(1.0 - abs(yPx - 6.0) / 18.0, 0.0, 1.0), 3.0) * 0.15;
    col += sheen * (1.0 - 0.75 * hot);

    // Legibility scrim for white text over a white backdrop (dark mode only).
    col = mix(col, col * 0.70, hot * (1.0 - uMode));

    fragColor = vec4(clamp(col, 0.0, 1.0), edgeAA);
  }
`;

export async function initGlass(paneEl, canvas) {
  const api = window.clearday.glass;
  const setState = (live) => {
    paneEl.classList.toggle('no-glass', !live);
    api.setState(live ? 'live' : 'fallback');
  };
  setState(false);

  if ((await api.mode()) !== 'native') return;
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false });
  if (!gl) return;

  let dpr = window.devicePixelRatio || 1;
  function sizeCanvas(scaleFactor) {
    dpr = scaleFactor || window.devicePixelRatio || 1;
    const w = Math.round(paneEl.clientWidth * dpr);
    const h = Math.round(paneEl.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  sizeCanvas(dpr);

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh));
    return sh;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(prog));
    return;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  for (const n of ['uVideo', 'uCropOrigin', 'uCropSize', 'uSizePx', 'uRadiusPx', 'uBevelPx', 'uBulge',
    'uAberration', 'uBlurPx', 'uTint', 'uBloom', 'uTexPerPx', 'uDpr', 'uMode', 'uSmoke']) {
    U[n] = gl.getUniformLocation(prog, n);
  }

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // ── Theme tuning from theme.css, re-read when the appearance flips ──
  let look = null;
  function readLook() {
    const cs = getComputedStyle(document.documentElement);
    const num = (name, dflt) => {
      const v = parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(v) ? v : dflt;
    };
    look = {
      mode: num('--glass-mode', 0),
      tint: num('--glass-tint', 0.32),
      smoke: num('--glass-smoke', 0),
      radius: num('--radius-window', 20),
    };
    look.key = `${look.mode}|${look.tint}|${look.smoke}|${look.radius}`;
  }
  readLook();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => readLook());

  // ── Frames ──
  let tile = null;   // { rect, width, height, scale }
  let tileSeq = 0;
  let drawnKey = '';
  api.onFrame((f) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, f.width, f.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, f.pixels);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    tile = { rect: f.rect, width: f.width, height: f.height, scale: f.width / f.rect.width };
    tileSeq++;
    if (!live) { live = true; setState(true); }
  });
  let live = false;

  // ── Window position, live while dragging ──
  // During a drag macOS reports the window's position only ~10 times a second,
  // so the backdrop would trail the window and stutter. The window moves
  // rigidly with the pointer, so mid-drag its position is pointer − grab
  // offset instead (the widget's liveWindow, polled only while it matters).
  let bounds = null;     // { x, y, width, height } as last reported
  let scaleFactor = dpr;
  let pointer = null;
  let grab = null;
  let reported = null, reportedAt = 0, pointerMovedAt = 0;
  let pollUntil = 0;
  let pending = false;
  let liveVel = { x: 0, y: 0 }, lastLive = null;
  const MOTION_LEAD_MS = 16;

  function applyPayload(p) {
    if (!p) return;
    bounds = p.bounds;
    if (p.scaleFactor !== scaleFactor) { scaleFactor = p.scaleFactor; sizeCanvas(scaleFactor); }
    pollUntil = Math.max(pollUntil, performance.now() + 300);
  }
  api.onBounds(applyPayload);
  applyPayload(await api.getBounds());

  api.onDragStart((p) => {
    if (!p || !p.cursor || !p.win) return;
    grab = { x: p.cursor.x - p.win.x, y: p.cursor.y - p.win.y };
    reportedAt = performance.now();
    pollUntil = performance.now() + 1000;
  });

  function liveWindow() {
    if (grab && pointer) return { x: pointer.x - grab.x, y: pointer.y - grab.y };
    return reported || bounds;
  }

  function noteLive(p) {
    const t = performance.now();
    if (!pointer || pointer.x !== p.cursor.x || pointer.y !== p.cursor.y) pointerMovedAt = t;
    pointer = p.cursor;
    if (p.win) {
      if (!reported || reported.x !== p.win.x || reported.y !== p.win.y) reportedAt = t;
      reported = { x: p.win.x, y: p.win.y };
    }
    if (grab && reported) {
      // Released: the pointer moves on but the window stays put.
      const est = liveWindow();
      const off = Math.hypot(est.x - reported.x, est.y - reported.y);
      if ((off > 6 && t - reportedAt > 140) || off > 240) grab = null;
      else if (t - reportedAt > 120 && t - pointerMovedAt > 120) {
        grab = { x: pointer.x - reported.x, y: pointer.y - reported.y };
      }
      pollUntil = t + 300;
    }
    const now = liveWindow();
    if (grab && lastLive && t - lastLive.t > 0 && t - lastLive.t < 100) {
      liveVel.x = liveVel.x * 0.5 + ((now.x - lastLive.x) / (t - lastLive.t)) * 0.5;
      liveVel.y = liveVel.y * 0.5 + ((now.y - lastLive.y) / (t - lastLive.t)) * 0.5;
    } else if (!grab) {
      liveVel = { x: 0, y: 0 };
    }
    lastLive = { x: now.x, y: now.y, t };
  }

  function poll() {
    if (pending || performance.now() > pollUntil) {
      if (!grab) reported = null;
      return;
    }
    pending = true;
    api.livePosition().then(noteLive).catch(() => {}).finally(() => { pending = false; });
  }

  function render() {
    requestAnimationFrame(render);
    poll();
    if (!bounds || !tile) return;
    const base = liveWindow();
    const at = { x: base.x + liveVel.x * MOTION_LEAD_MS, y: base.y + liveVel.y * MOTION_LEAD_MS };

    sizeCanvas(tile.scale);
    const key = `${tileSeq}|${at.x},${at.y}|${canvas.width}x${canvas.height}|${look.key}`;
    if (key === drawnKey) return;
    drawnKey = key;

    const S = tile.rect;
    const r = paneEl.getBoundingClientRect();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.useProgram(prog);
    gl.uniform1i(U.uVideo, 0);
    gl.uniform1f(U.uTexPerPx, (tile.width * (r.width / S.width)) / canvas.width);
    gl.uniform2f(U.uCropOrigin, (at.x + r.left - S.x) / S.width, (at.y + r.top - S.y) / S.height);
    gl.uniform2f(U.uCropSize, r.width / S.width, r.height / S.height);
    gl.uniform2f(U.uSizePx, canvas.width, canvas.height);
    gl.uniform1f(U.uRadiusPx, look.radius * dpr);
    gl.uniform1f(U.uDpr, dpr);
    // The widget's tuning, unchanged.
    gl.uniform1f(U.uBevelPx, 11.0 * dpr);
    gl.uniform1f(U.uBulge, 8.0 * dpr);
    gl.uniform1f(U.uAberration, 0.40);
    gl.uniform1f(U.uBlurPx, 4.0 * dpr);
    gl.uniform1f(U.uBloom, 1.15);
    gl.uniform1f(U.uTint, look.tint);
    gl.uniform1f(U.uSmoke, look.smoke);
    gl.uniform1f(U.uMode, look.mode);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  requestAnimationFrame(render);
}
