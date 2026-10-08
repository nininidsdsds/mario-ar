// Lógica pura (sin cámara ni pantalla): geometría de la cuadrícula y clasificación por color.
// Se usa desde index.html y también se puede probar en Node.
(function (root) {
  'use strict';

  // ---------- Álgebra básica ----------

  // Resuelve A·x = b (eliminación de Gauss con pivote parcial).
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

  // Homografía (3x3, devuelta como 9 números) que lleva 4 puntos "src" a 4 puntos "dst".
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

  // ---------- Cuadrícula ----------
  // Coordenadas del tablero: el marcador de inicio ocupa el cuadrado (0,0)-(1,1).
  // k = tamaño de una casilla medido en "lados de marcador" (= BLOCK_CM / MARKER_CM).
  // La casilla (cx, cy) tiene su centro en (0.5 + cx·k, 0.5 + cy·k). El bloque de inicio es la (0,0).
  // cy crece hacia abajo.

  function cellPoint(H, cx, cy, k, du, dv) {
    return applyH(H, 0.5 + (cx + du) * k, 0.5 + (cy + dv) * k);
  }

  function cellCorners(H, cx, cy, k) {
    return [
      cellPoint(H, cx, cy, k, -0.5, -0.5),
      cellPoint(H, cx, cy, k, 0.5, -0.5),
      cellPoint(H, cx, cy, k, 0.5, 0.5),
      cellPoint(H, cx, cy, k, -0.5, 0.5)
    ];
  }

  // 3x3 puntos repartidos en la zona central de la casilla (inner = fracción de la casilla que se usa).
  function cellSamplePoints(H, cx, cy, k, inner) {
    const pts = [];
    const o = inner / 2;
    const offs = [-o, 0, o];
    for (const dv of offs) for (const du of offs) pts.push(cellPoint(H, cx, cy, k, du, dv));
    return pts;
  }

  // Dada una posición en la imagen, devuelve qué casilla es.
  function pointToCell(Hinv, x, y, k) {
    const uv = applyH(Hinv, x, y);
    return { cx: Math.round((uv.x - 0.5) / k), cy: Math.round((uv.y - 0.5) / k) };
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

  // Muestra más cercana. samples = [{cls, lab}]. Devuelve {cls, dist}; cls = null si está muy lejos de todo.
  function classify(lab, samples, maxDist) {
    let best = null, bestD = Infinity;
    for (const s of samples) {
      const d = labDistance(lab, s.lab);
      if (d < bestD) { bestD = d; best = s.cls; }
    }
    if (best === null || bestD > maxDist) return { cls: null, dist: bestD };
    return { cls: best, dist: bestD };
  }

  const Core = {
    solveLinear, homography, applyH, invert3,
    cellPoint, cellCorners, cellSamplePoints, pointToCell,
    meanColor, rgbToLab, labDistance, classify
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(typeof self !== 'undefined' ? self : this);
