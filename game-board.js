// Modo pizarrón (sin cámara ni pantalla): se puede probar en Node.
//
// IDEA: 4 marcadores pegados en las esquinas del pizarrón fijan las coordenadas en cm (no dependen de dónde
// pongas el bloque de inicio). Con los bloques quitados se guarda una "foto de referencia" del fondo; después,
// un bloque es todo lo que CAMBIA respecto a esa foto. Así da igual que el fondo sea de muchos colores.
(function (root) {
  'use strict';
  const Core = (typeof require === 'function' && typeof module !== 'undefined' && module.exports)
    ? require('./game-core.js') : root.Core;

  // ---------- Geometría ----------

  function mul3(A, B) {
    const C = new Array(9);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += A[r * 3 + k] * B[k * 3 + c];
        C[r * 3 + c] = s;
      }
    }
    return C;
  }

  // ¿Los 4 puntos (arriba-izq, arriba-der, abajo-der, abajo-izq) forman un cuadrilátero convexo?
  function isConvexQuad(p) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i + 1) % 4], c = p[(i + 2) % 4];
      const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (Math.abs(cr) < 1e-6) return false;
      const s = cr > 0 ? 1 : -1;
      if (sign && s !== sign) return false;
      sign = s;
    }
    return true;
  }

  // centers = [TL, TR, BR, BL] en píxeles de imagen (centro de cada marcador de esquina).
  // wCm, hCm = distancia entre centros de marcadores (horizontal y vertical). Origen = centro del pizarrón.
  // Devuelve {Hb, H, Hinv}: Hb lleva cm → imagen; H es lo mismo en la convención del resto de la app
  // (cuadrado unitario con markerCm = 1), para poder reutilizar Core.boardToImage(H, 1, x, y).
  function boardHomography(centers, wCm, hCm) {
    if (!centers || centers.length !== 4 || centers.some(c => !c)) return null;
    if (!isConvexQuad(centers)) return null;
    const src = [{ x: -wCm / 2, y: -hCm / 2 }, { x: wCm / 2, y: -hCm / 2 }, { x: wCm / 2, y: hCm / 2 }, { x: -wCm / 2, y: hCm / 2 }];
    const Hb = Core.homography(src, centers);
    if (!Hb) return null;
    const H = mul3(Hb, [1, 0, -0.5, 0, 1, -0.5, 0, 0, 1]);
    const Hinv = Core.invert3(H);
    if (!Hinv) return null;
    return { Hb, H, Hinv };
  }

  // ---------- Color ----------

  function labInto(out, o, r, g, b) {
    let R = r / 255, G = g / 255, B = b / 255;
    R = R <= 0.04045 ? R / 12.92 : Math.pow((R + 0.055) / 1.055, 2.4);
    G = G <= 0.04045 ? G / 12.92 : Math.pow((G + 0.055) / 1.055, 2.4);
    B = B <= 0.04045 ? B / 12.92 : Math.pow((B + 0.055) / 1.055, 2.4);
    const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
    const Y = 0.2126729 * R + 0.7151522 * G + 0.0721750 * B;
    const Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
    const fx = X > 0.008856 ? Math.cbrt(X) : 7.787 * X + 16 / 116;
    const fy = Y > 0.008856 ? Math.cbrt(Y) : 7.787 * Y + 16 / 116;
    const fz = Z > 0.008856 ? Math.cbrt(Z) : 7.787 * Z + 16 / 116;
    out[o] = 116 * fy - 16; out[o + 1] = 500 * (fx - fy); out[o + 2] = 200 * (fy - fz);
  }

  // ---------- Foto de referencia ----------
  // Se guarda por "píxel fino" (los mismos del mapa), en toda la zona del pizarrón + un margen.

  function createReference(board, wCm, hCm, marginCm) {
    const f = board.fine, nx = board.nx, W = board.W;
    const hx = Math.min(nx, Math.round((wCm / 2 + marginCm) / f));
    const hy = Math.min(nx, Math.round((hCm / 2 + marginCm) / f));
    return {
      fine: f, nx, W, ix0: -hx, ix1: hx, iy0: -hy, iy1: hy,
      sum: new Float32Array(W * W * 3), count: new Uint16Array(W * W),
      rgb: new Uint8Array(W * W * 3), lab: new Float32Array(W * W * 3), valid: new Uint8Array(W * W),
      frames: 0, ready: false, scr: null
    };
  }

  // Suma un cuadro de cámara a la referencia (se promedian varios para quitar ruido).
  function accumulate(ref, img, w, h, H) {
    const d = img.data, f = ref.fine, nx = ref.nx, Wd = ref.W;
    const H0 = H[0], H1 = H[1], H2 = H[2], H3 = H[3], H4 = H[4], H5 = H[5], H6 = H[6], H7 = H[7], H8 = H[8];
    let used = 0;
    for (let iy = ref.iy0; iy <= ref.iy1; iy++) {
      const v = 0.5 + iy * f;
      for (let ix = ref.ix0; ix <= ref.ix1; ix++) {
        const u = 0.5 + ix * f;
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
        const idx = (iy + nx) * Wd + (ix + nx);
        ref.sum[idx * 3] += r / 9; ref.sum[idx * 3 + 1] += g / 9; ref.sum[idx * 3 + 2] += b / 9;
        ref.count[idx]++;
        used++;
      }
    }
    ref.frames++;
    return used;
  }

  // Promedia lo acumulado y deja la referencia lista. Devuelve cuántos píxeles finos quedaron válidos.
  function finalizeReference(ref) {
    const need = Math.max(1, Math.floor(ref.frames * 0.5));
    const tmp = new Float32Array(3);
    let valid = 0;
    ref.valid.fill(0);
    for (let iy = ref.iy0; iy <= ref.iy1; iy++) {
      for (let ix = ref.ix0; ix <= ref.ix1; ix++) {
        const idx = (iy + ref.nx) * ref.W + (ix + ref.nx);
        const n = ref.count[idx];
        if (n < need) continue;
        const r = ref.sum[idx * 3] / n, g = ref.sum[idx * 3 + 1] / n, b = ref.sum[idx * 3 + 2] / n;
        ref.rgb[idx * 3] = r; ref.rgb[idx * 3 + 1] = g; ref.rgb[idx * 3 + 2] = b;
        labInto(tmp, 0, r, g, b);
        ref.lab[idx * 3] = tmp[0]; ref.lab[idx * 3 + 1] = tmp[1]; ref.lab[idx * 3 + 2] = tmp[2];
        ref.valid[idx] = 1; valid++;
      }
    }
    ref.ready = valid > 0;
    return valid;
  }

  function resetAccumulation(ref) { ref.sum.fill(0); ref.count.fill(0); ref.frames = 0; ref.ready = false; }

  // ---------- Diferencia contra la referencia → mapa de bloques ----------

  function median(arr, n) {
    const a = arr.subarray(0, n);
    a.sort();
    return n & 1 ? a[(n - 1) >> 1] : 0.5 * (a[n / 2 - 1] + a[n / 2]);
  }

  // Actualiza board.cls dentro de la zona de la referencia: solidIdx donde hay bloque, emptyIdx donde no.
  // opts: thr (umbral de diferencia), decay (memoria temporal 0..1), wL (peso de la luz), coarseCm, solidIdx.
  function updateDiff(board, ref, img, w, h, H, opts) {
    opts = opts || {};
    const thr = opts.thr || 14, decay = opts.decay == null ? 0.6 : opts.decay, wL = opts.wL || 0.5;
    const solidIdx = opts.solidIdx, emptyIdx = board.emptyIdx, nc = board.nc;
    const f = ref.fine, nx = ref.nx, Wd = ref.W, d = img.data;
    const x0 = ref.ix0, y0 = ref.iy0, RW = ref.ix1 - ref.ix0 + 1, RH = ref.iy1 - ref.iy0 + 1;
    if (!ref.scr || ref.scr.RW !== RW || ref.scr.RH !== RH) {
      ref.scr = { RW, RH, dl: new Float32Array(RW * RH * 3), vis: new Uint8Array(RW * RH), occ: new Uint8Array(RW * RH) };
    }
    const S = ref.scr, tmp = new Float32Array(3);
    S.vis.fill(0);
    const H0 = H[0], H1 = H[1], H2 = H[2], H3 = H[3], H4 = H[4], H5 = H[5], H6 = H[6], H7 = H[7], H8 = H[8];

    // 1) Diferencia de color (Lab) entre lo que se ve ahora y la referencia
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity, nvis = 0;
    for (let iy = ref.iy0; iy <= ref.iy1; iy++) {
      const v = 0.5 + iy * f;
      for (let ix = ref.ix0; ix <= ref.ix1; ix++) {
        const gidx = (iy + nx) * Wd + (ix + nx);
        if (!ref.valid[gidx]) continue;
        const u = 0.5 + ix * f;
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
        labInto(tmp, 0, r / 9, g / 9, b / 9);
        const k = (iy - y0) * RW + (ix - x0);
        S.dl[k * 3] = tmp[0] - ref.lab[gidx * 3];
        S.dl[k * 3 + 1] = tmp[1] - ref.lab[gidx * 3 + 1];
        S.dl[k * 3 + 2] = tmp[2] - ref.lab[gidx * 3 + 2];
        S.vis[k] = 1; nvis++;
        if (ix < minx) minx = ix; if (ix > maxx) maxx = ix;
        if (iy < miny) miny = iy; if (iy > maxy) maxy = iy;
      }
    }
    if (nvis < 50) return null;

    // 2) Compensación de luz: la mayor parte del pizarrón es fondo, así que la mediana de la diferencia
    //    en cada zona de ~6 cm es "cuánto cambió la luz" ahí. Se resta (interpolada) de todos los píxeles.
    const gl = new Float32Array(nvis), ga = new Float32Array(nvis), gb = new Float32Array(nvis);
    let gn = 0;
    for (let k = 0; k < RW * RH; k += 3) {
      if (!S.vis[k]) continue;
      gl[gn] = S.dl[k * 3]; ga[gn] = S.dl[k * 3 + 1]; gb[gn] = S.dl[k * 3 + 2]; gn++;
    }
    const gmed = [median(gl, gn), median(ga, gn), median(gb, gn)];
    const CS = Math.max(4, Math.round((opts.coarseCm || 6) / f));
    const cw = Math.ceil(RW / CS), ch = Math.ceil(RH / CS);
    const co = new Float32Array(cw * ch * 3);
    const tl = new Float32Array(CS * CS), ta = new Float32Array(CS * CS), tb = new Float32Array(CS * CS);
    for (let cy = 0; cy < ch; cy++) {
      for (let cx = 0; cx < cw; cx++) {
        let n = 0;
        for (let yy = cy * CS; yy < Math.min(RH, (cy + 1) * CS); yy += 2) {
          for (let xx = cx * CS; xx < Math.min(RW, (cx + 1) * CS); xx += 2) {
            const k = yy * RW + xx;
            if (!S.vis[k]) continue;
            tl[n] = S.dl[k * 3]; ta[n] = S.dl[k * 3 + 1]; tb[n] = S.dl[k * 3 + 2]; n++;
          }
        }
        const o = (cy * cw + cx) * 3;
        if (n >= 24) { co[o] = median(tl, n); co[o + 1] = median(ta, n); co[o + 2] = median(tb, n); }
        else { co[o] = gmed[0]; co[o + 1] = gmed[1]; co[o + 2] = gmed[2]; }
      }
    }

    // 3) ¿Cambió lo suficiente? → memoria temporal → filtro de mayoría
    const cl = (v, a, b) => (v < a ? a : v > b ? b : v);
    for (let iy = ref.iy0; iy <= ref.iy1; iy++) {
      for (let ix = ref.ix0; ix <= ref.ix1; ix++) {
        const k = (iy - y0) * RW + (ix - x0);
        if (!S.vis[k]) continue;
        const fx = (ix - x0 + 0.5) / CS - 0.5, fy = (iy - y0 + 0.5) / CS - 0.5;
        const gx0 = Math.floor(fx), gy0 = Math.floor(fy), tx = fx - gx0, ty = fy - gy0;
        const ax = cl(gx0, 0, cw - 1), bx = cl(gx0 + 1, 0, cw - 1), ay = cl(gy0, 0, ch - 1), by = cl(gy0 + 1, 0, ch - 1);
        let rL = S.dl[k * 3], rA = S.dl[k * 3 + 1], rB = S.dl[k * 3 + 2];
        for (let c = 0; c < 3; c++) {
          const v00 = co[(ay * cw + ax) * 3 + c], v10 = co[(ay * cw + bx) * 3 + c];
          const v01 = co[(by * cw + ax) * 3 + c], v11 = co[(by * cw + bx) * 3 + c];
          const off = (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
          if (c === 0) rL -= off; else if (c === 1) rA -= off; else rB -= off;
        }
        const de = Math.sqrt((wL * rL) * (wL * rL) + rA * rA + rB * rB);
        const gidx = (iy + nx) * Wd + (ix + nx);
        const bi = gidx * nc;
        board.scores[bi] = board.scores[bi] * decay + (de > thr ? 1 - decay : 0);
        S.occ[k] = board.scores[bi] > 0.5 ? 1 : 0;
      }
    }
    // Filtro de mayoría: borra líneas finas falsas (bordes del dibujo del fondo que quedaron corridos un poco)
    // y deja los bloques con sus bordes rectos. Ventana de (2·FR+1)² y se exige un poco más de la mitad.
    const FR = opts.filterR == null ? 2 : opts.filterR, FMIN = Math.ceil(0.52 * (2 * FR + 1) * (2 * FR + 1));
    for (let iy = ref.iy0; iy <= ref.iy1; iy++) {
      for (let ix = ref.ix0; ix <= ref.ix1; ix++) {
        const k = (iy - y0) * RW + (ix - x0);
        if (!S.vis[k]) continue;
        const own = S.occ[k];
        let cnt = 0;
        for (let dy = -FR; dy <= FR; dy++) {
          const yy = iy + dy - y0;
          for (let dx = -FR; dx <= FR; dx++) {
            const xx = ix + dx - x0;
            if (xx < 0 || xx >= RW || yy < 0 || yy >= RH) { cnt += own; continue; }
            const kk = yy * RW + xx;
            cnt += S.vis[kk] ? S.occ[kk] : own;
          }
        }
        board.cls[(iy + nx) * Wd + (ix + nx)] = cnt >= FMIN ? solidIdx : emptyIdx;
      }
    }
    board.bbox = { ix0: minx, ix1: maxx, iy0: miny, iy1: maxy };
    return board.bbox;
  }

  // ---------- Guardar / cargar la referencia (para no repetir la foto cada vez) ----------

  function toBase64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromBase64(str) {
    const s = atob(str), u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }

  function referenceToJSON(ref) {
    const RW = ref.ix1 - ref.ix0 + 1, RH = ref.iy1 - ref.iy0 + 1;
    const rgb = new Uint8Array(RW * RH * 3), val = new Uint8Array(RW * RH);
    for (let iy = ref.iy0; iy <= ref.iy1; iy++) {
      for (let ix = ref.ix0; ix <= ref.ix1; ix++) {
        const g = (iy + ref.nx) * ref.W + (ix + ref.nx), k = (iy - ref.iy0) * RW + (ix - ref.ix0);
        val[k] = ref.valid[g];
        rgb[k * 3] = ref.rgb[g * 3]; rgb[k * 3 + 1] = ref.rgb[g * 3 + 1]; rgb[k * 3 + 2] = ref.rgb[g * 3 + 2];
      }
    }
    return { v: 1, fine: ref.fine, nx: ref.nx, ix0: ref.ix0, ix1: ref.ix1, iy0: ref.iy0, iy1: ref.iy1, frames: ref.frames,
      rgb: toBase64(rgb), valid: toBase64(val) };
  }

  // Devuelve la referencia o null si no coincide con el mapa actual.
  function referenceFromJSON(o, board) {
    try {
      if (!o || o.v !== 1 || o.fine !== board.fine || o.nx !== board.nx) return null;
      const RW = o.ix1 - o.ix0 + 1, RH = o.iy1 - o.iy0 + 1;
      const rgb = fromBase64(o.rgb), val = fromBase64(o.valid);
      if (rgb.length !== RW * RH * 3 || val.length !== RW * RH) return null;
      const ref = createReference(board, 1, 1, 0);
      ref.ix0 = o.ix0; ref.ix1 = o.ix1; ref.iy0 = o.iy0; ref.iy1 = o.iy1; ref.frames = o.frames || 1;
      const tmp = new Float32Array(3);
      let n = 0;
      for (let iy = o.iy0; iy <= o.iy1; iy++) {
        for (let ix = o.ix0; ix <= o.ix1; ix++) {
          const g = (iy + board.nx) * board.W + (ix + board.nx), k = (iy - o.iy0) * RW + (ix - o.ix0);
          if (!val[k]) continue;
          ref.valid[g] = 1; n++;
          ref.rgb[g * 3] = rgb[k * 3]; ref.rgb[g * 3 + 1] = rgb[k * 3 + 1]; ref.rgb[g * 3 + 2] = rgb[k * 3 + 2];
          labInto(tmp, 0, rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2]);
          ref.lab[g * 3] = tmp[0]; ref.lab[g * 3 + 1] = tmp[1]; ref.lab[g * 3 + 2] = tmp[2];
        }
      }
      ref.ready = n > 0;
      return ref.ready ? ref : null;
    } catch (e) { return null; }
  }

  const BoardMode = {
    mul3, isConvexQuad, boardHomography,
    createReference, accumulate, finalizeReference, resetAccumulation,
    updateDiff, referenceToJSON, referenceFromJSON
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = BoardMode;
  else root.BoardMode = BoardMode;
})(typeof self !== 'undefined' ? self : this);
