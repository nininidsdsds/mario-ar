// Lógica pura (sin cámara ni pantalla): geometría del pizarrón y reconocimiento por color.
// Se usa desde index.html y también se puede probar en Node.
//
// IDEA: el bloque de inicio (con su marcador) fija un sistema de coordenadas EN CENTÍMETROS:
//   origen = centro del marcador, x hacia la derecha, y hacia abajo.
// El pizarrón se divide en "píxeles finos" de FINE_CM (p. ej. 0.25 cm). Cada uno se clasifica por color.
// Así no importa si los bloques miden 2, 2.3 o 2.5 cm, ni si están alineados.
(function (root) {
  'use strict';

  // ---------- Álgebra básica ----------

  function solveLinear(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      }
      if (Math.abs(M[piv][col]) < 1e-12) return null;
      const tmp = M[col]; M[col] = M[piv]; M[piv] = tmp;
      for (let r = col + 1; r < n; r++) {
        const f = M[r][col] / M[col][col];
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = M[i][n];
      for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
      x[i] = s / M[i][i];
    }
    return x;
  }

  // Homografía (9 números) que lleva 4 puntos "src" a 4 puntos "dst".
  function homography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const x = src[i].x, y = src[i].y, X = dst[i].x, Y = dst[i].y;
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
    }
    const h = solveLinear(A, b);
    return h ? h.concat([1]) : null;
  }

  function applyH(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
  }

  function invert3(m) {
    const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) return null;
    const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
    const G = b * f - c * e, H2 = -(a * f - c * d), I = a * e - b * d;
    return [A / det, D / det, G / det, B / det, E / det, H2 / det, C / det, F / det, I / det];
  }

  // ---------- Coordenadas del pizarrón (cm) ----------
  // H lleva el cuadrado unitario del marcador (0,0)-(1,1) a la imagen. markerCm = lado real del marcador.

  function boardToImage(H, markerCm, xcm, ycm) {
    return applyH(H, 0.5 + xcm / markerCm, 0.5 + ycm / markerCm);
  }

  function imageToBoard(Hinv, markerCm, x, y) {
    const uv = applyH(Hinv, x, y);
    return { x: (uv.x - 0.5) * markerCm, y: (uv.y - 0.5) * markerCm };
  }

  // 3x3 puntos separados "spacingCm" alrededor de (xcm, ycm): para tomar una muestra de color al tocar.
  function patchPoints(H, markerCm, xcm, ycm, spacingCm) {
    const pts = [];
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) pts.push(boardToImage(H, markerCm, xcm + i * spacingCm, ycm + j * spacingCm));
    }
    return pts;
  }

  // ---------- Color ----------

  // Promedio RGB de los puntos dados (cada uno promediado con sus 8 vecinos). null si alguno cae fuera.
  function meanColor(data, w, h, pts) {
    let r = 0, g = 0, b = 0, n = 0;
    for (const p of pts) {
      const x = Math.round(p.x), y = Math.round(p.y);
      if (!(x >= 1 && x < w - 1 && y >= 1 && y < h - 1)) return null;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = ((y + dy) * w + (x + dx)) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
    }
    return n ? [r / n, g / n, b / n] : null;
  }

  function rgbToLab(r, g, b) {
    const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const R = lin(r), G = lin(g), B = lin(b);
    const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
    const Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
    const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
    const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = f(X), fy = f(Y), fz = f(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  // La luminosidad pesa menos que el tono: tolera mejor los cambios de luz.
  const LAB_W = [0.6, 1, 1];

  function labDistance(p, q) {
    const dl = LAB_W[0] * (p[0] - q[0]);
    const da = LAB_W[1] * (p[1] - q[1]);
    const db = LAB_W[2] * (p[2] - q[2]);
    return Math.sqrt(dl * dl + da * da + db * db);
  }

  // Muestra más cercana. samples = [{cls, lab}]. cls = null si está más lejos que maxDist de todas.
  function classify(lab, samples, maxDist) {
    let best = null, bestD = Infinity;
    for (const s of samples) {
      const d = labDistance(lab, s.lab);
      if (d < bestD) { bestD = d; best = s.cls; }
    }
    if (best === null || bestD > maxDist) return { cls: null, dist: bestD };
    return { cls: best, dist: bestD };
  }

  // Tabla de consulta rápida: cada color RGB (a 5 bits por canal) → índice de tipo (255 = desconocido).
  // Se reconstruye solo cuando cambia la calibración.
  function buildLUT(samples, classIndex, maxDist) {
    const lut = new Uint8Array(32768).fill(255);
    if (!samples.length) return lut;
    for (let r = 0; r < 32; r++) {
      for (let g = 0; g < 32; g++) {
        for (let b = 0; b < 32; b++) {
          const res = classify(rgbToLab(r * 8 + 4, g * 8 + 4, b * 8 + 4), samples, maxDist);
          lut[(r << 10) | (g << 5) | b] = res.cls === null ? 255 : classIndex[res.cls];
        }
      }
    }
    return lut;
  }

  function lutClass(lut, r, g, b) {
    return lut[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
  }

  // ---------- Mapa del pizarrón ----------

  const START = 250, GOAL = 251;   // valores especiales dentro del mapa

  function createBoard(halfCm, fineCm, nClasses, emptyIdx) {
    const nx = Math.round(halfCm / fineCm);
    const W = 2 * nx + 1;
    const nc = nClasses + 1;       // +1 = "desconocido" (índice nClasses)
    return {
      fine: fineCm, nx, W, nc, nClasses, emptyIdx,
      cls: new Uint8Array(W * W).fill(emptyIdx),
      scores: new Float32Array(W * W * nc),
      t1: new Uint8Array(W * W).fill(emptyIdx),
      t2: new Uint8Array(W * W).fill(emptyIdx),
      vis: new Uint32Array(W * W),
      stamp: 0, bbox: null
    };
  }

  const bIdx = (b, ix, iy) => (iy + b.nx) * b.W + (ix + b.nx);

  // Analiza un cuadro: clasifica los píxeles finos visibles, acumula votos en el tiempo,
  // rellena contornos oscuros y limpia ruido. opts: {decay, fillMin}.
  // Devuelve el recuadro (en píxeles finos) que se actualizó, o null.
  function updateBoard(board, img, w, h, H, Hinv, markerCm, lut, opts) {
    const f = board.fine, nx = board.nx, nc = board.nc, nCls = board.nClasses, emptyIdx = board.emptyIdx;
    const decay = (opts && opts.decay) || 0.6;
    const fillMin = (opts && opts.fillMin) || 6;

    // 1) Qué parte del pizarrón se ve (esquinas de la imagen → cm → píxeles finos)
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    const corners = [[0, 0], [w, 0], [w, h], [0, h]];
    for (const c of corners) {
      const p = imageToBoard(Hinv, markerCm, c[0], c[1]);
      if (!isFinite(p.x) || !isFinite(p.y)) return null;
      minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
      miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
    }
    const ix0 = Math.max(-nx, Math.floor(minx / f)), ix1 = Math.min(nx, Math.ceil(maxx / f));
    const iy0 = Math.max(-nx, Math.floor(miny / f)), iy1 = Math.min(nx, Math.ceil(maxy / f));
    if (ix0 > ix1 || iy0 > iy1) return null;

    board.stamp = (board.stamp + 1) >>> 0;
    const stamp = board.stamp;
    const d = img.data, sc = board.scores, t1 = board.t1, t2 = board.t2, vis = board.vis;
    const H0 = H[0], H1 = H[1], H2 = H[2], H3 = H[3], H4 = H[4], H5 = H[5], H6 = H[6], H7 = H[7], H8 = H[8];

    // 2) Color de cada píxel fino visible → tipo → voto
    for (let iy = iy0; iy <= iy1; iy++) {
      const v = 0.5 + (iy * f) / markerCm;
      for (let ix = ix0; ix <= ix1; ix++) {
        const u = 0.5 + (ix * f) / markerCm;
        const ww = H6 * u + H7 * v + H8;
        const px = Math.round((H0 * u + H1 * v + H2) / ww);
        const py = Math.round((H3 * u + H4 * v + H5) / ww);
        if (!(px >= 1 && px < w - 1 && py >= 1 && py < h - 1)) continue;
        let r = 0, g = 0, b = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const i = ((py + dy) * w + (px + dx)) * 4;
            r += d[i]; g += d[i + 1]; b += d[i + 2];
          }
        }
        let c = lutClass(lut, r / 9, g / 9, b / 9);
        if (c === 255) c = nCls;                       // desconocido
        const idx = (iy + nx) * board.W + (ix + nx);
        const base = idx * nc;
        let best = 0, bv = -1;
        for (let k = 0; k < nc; k++) {
          sc[base + k] *= decay;
          if (k === c) sc[base + k] += 1;
          if (sc[base + k] > bv) { bv = sc[base + k]; best = k; }
        }
        t1[idx] = best;
        vis[idx] = stamp;
      }
    }

    // 3) Los "desconocidos" (contornos oscuros, detalles) toman el tipo de los bloques vecinos
    const cnt = new Uint16Array(nCls);
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const idx = (iy + nx) * board.W + (ix + nx);
        if (vis[idx] !== stamp) continue;
        let val = t1[idx];
        if (val === nCls) {
          cnt.fill(0);
          for (let dy = -2; dy <= 2; dy++) {
            const yy = iy + dy; if (yy < -nx || yy > nx) continue;
            for (let dx = -2; dx <= 2; dx++) {
              const xx = ix + dx; if (xx < -nx || xx > nx) continue;
              const q = t1[(yy + nx) * board.W + (xx + nx)];
              if (q < nCls && q !== emptyIdx) cnt[q]++;
            }
          }
          let top = emptyIdx, tc = 0;
          for (let k = 0; k < nCls; k++) if (cnt[k] > tc) { tc = cnt[k]; top = k; }
          val = tc >= fillMin ? top : emptyIdx;
        }
        t2[idx] = val;
      }
    }

    // 4) Filtro de mayoría 3x3 contra el ruido (en empate se queda el valor actual)
    const c2 = new Uint8Array(nCls);
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const idx = (iy + nx) * board.W + (ix + nx);
        if (vis[idx] !== stamp) continue;
        c2.fill(0);
        for (let dy = -1; dy <= 1; dy++) {
          const yy = Math.max(-nx, Math.min(nx, iy + dy));
          for (let dx = -1; dx <= 1; dx++) {
            const xx = Math.max(-nx, Math.min(nx, ix + dx));
            c2[t2[(yy + nx) * board.W + (xx + nx)]]++;
          }
        }
        let best = t2[idx], bc = c2[best];
        for (let k = 0; k < nCls; k++) if (c2[k] > bc) { bc = c2[k]; best = k; }
        board.cls[idx] = best;
      }
    }

    board.bbox = { ix0, ix1, iy0, iy1 };
    return board.bbox;
  }

  // Fuerza un rectángulo (centro y tamaño en cm) a un valor: bloque de inicio, meta, enemigos con marcador.
  function stampRect(board, xcm, ycm, wcm, hcm, value) {
    const f = board.fine, nx = board.nx;
    const ix0 = Math.max(-nx, Math.ceil((xcm - wcm / 2) / f)), ix1 = Math.min(nx, Math.floor((xcm + wcm / 2) / f));
    const iy0 = Math.max(-nx, Math.ceil((ycm - hcm / 2) / f)), iy1 = Math.min(nx, Math.floor((ycm + hcm / 2) / f));
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) board.cls[bIdx(board, ix, iy)] = value;
    }
  }

  // Convierte la zona visible del mapa en pocos rectángulos (para dibujar). Coordenadas en píxeles finos.
  function extractRects(board) {
    const bb = board.bbox;
    if (!bb) return [];
    const rects = [];
    let open = new Map();
    for (let iy = bb.iy0; iy <= bb.iy1; iy++) {
      const next = new Map();
      let ix = bb.ix0;
      while (ix <= bb.ix1) {
        const v = board.cls[bIdx(board, ix, iy)];
        if (v === board.emptyIdx) { ix++; continue; }
        let e = ix;
        while (e + 1 <= bb.ix1 && board.cls[bIdx(board, e + 1, iy)] === v) e++;
        const key = ix + ':' + e + ':' + v;
        const prev = open.get(key);
        if (prev) { prev.iy1 = iy; next.set(key, prev); }
        else { const r = { ix0: ix, ix1: e, iy0: iy, iy1: iy, cls: v }; rects.push(r); next.set(key, r); }
        ix = e + 1;
      }
      open = next;
    }
    return rects;
  }

  const Core = {
    solveLinear, homography, applyH, invert3,
    boardToImage, imageToBoard, patchPoints,
    meanColor, rgbToLab, labDistance, classify, buildLUT, lutClass,
    START, GOAL, createBoard, bIdx, updateBoard, stampRect, extractRects
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof self !== 'undefined' ? self : this);
