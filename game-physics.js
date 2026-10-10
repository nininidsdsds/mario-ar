// Física del personaje (sin cámara ni pantalla). Todo en centímetros del pizarrón:
// origen = centro del marcador de inicio, x a la derecha, y hacia ABAJO.
// Usa el mapa de Core.createBoard (board.cls) como "suelo": cada píxel fino es sólido, peligro, meta o vacío.
(function (root) {
  'use strict';

  const P = {
    W: 1.2, H: 1.6,            // tamaño del personaje (cm)
    SPEED: 8,                  // velocidad al correr (cm/s)
    ACCEL: 70, AIR_ACCEL: 45, FRICTION: 90,
    GRAVITY: 80,               // cm/s²
    JUMP_V: 24,                // salto ≈ 3.6 cm de alto: pasa sobre un bloque de 2 cm
    MAX_FALL: 45,
    CUT: 0.45,                 // al soltar el botón el salto se corta
    COYOTE: 0.1, BUFFER: 0.12, // margen para saltar justo al borde / justo antes de aterrizar
    STEP_UP: 0.6,              // sube solo desniveles pequeños (bloques imanados no perfectamente alineados)
    EPS: 1e-4
  };

  function makeLut(list) {
    const lut = new Uint8Array(256);
    (list || []).forEach(i => { lut[i] = 1; });
    return lut;
  }

  function createWorld(board, cfg) {
    const f = board.fine;
    let maxIy = 0;
    for (let iy = -board.nx; iy <= board.nx; iy++) {
      for (let ix = -board.nx; ix <= board.nx; ix++) {
        if (board.cls[(iy + board.nx) * board.W + (ix + board.nx)] !== board.emptyIdx && iy > maxIy) maxIy = iy;
      }
    }
    // Despeja la zona de aparición (encima del bloque de inicio): si la cámara ensució ahí el mapa,
    // el personaje quedaría atrapado dentro de un "sólido" falso.
    const iyTop = Math.ceil((-cfg.startCm / 2) / f);          // fila superior del bloque de inicio
    const goalVal = (cfg.goal && cfg.goal[0] !== undefined) ? cfg.goal[0] : -1;
    const cx = Math.ceil(1.0 / f), cy = Math.ceil(5.0 / f);
    for (let iy = iyTop - cy; iy < iyTop; iy++) {
      for (let ix = -cx; ix <= cx; ix++) {
        const k = (iy + board.nx) * board.W + (ix + board.nx);
        if (board.cls[k] !== goalVal) board.cls[k] = board.emptyIdx;
      }
    }
    const w = {
      w: P.W, h: P.H,
      solid: makeLut(cfg.solid), hazard: makeLut(cfg.hazard), goal: makeLut(cfg.goal),
      spawnX: 0, spawnY: (iyTop - 0.5) * f - 0.01,
      fallY: maxIy * f + 12,
      x: 0, y: 0, vx: 0, vy: 0, face: 1, onGround: false,
      coyote: 0, buffer: 0, prevJump: false,
      dead: false, won: false, endT: 0, stuck: 0
    };
    respawn(w);
    return w;
  }

  function respawn(w) {
    w.x = w.spawnX; w.y = w.spawnY; w.vx = 0; w.vy = 0; w.face = 1;
    w.onGround = false; w.coyote = 0; w.buffer = 0; w.prevJump = false;
    w.dead = false; w.won = false; w.endT = 0;
  }

  // ¿La caja del personaje en (x, y=pies) toca alguna celda de esa tabla?
  function hit(w, b, x, y, lut, s) {
    const f = b.fine, nx = b.nx;
    const l = x - w.w / 2 + s, r = x + w.w / 2 - s, t = y - w.h + s, bt = y - s;
    const i0 = Math.floor(l / f - 0.5) + 1, i1 = Math.ceil(r / f + 0.5) - 1;
    const j0 = Math.floor(t / f - 0.5) + 1, j1 = Math.ceil(bt / f + 0.5) - 1;
    for (let j = j0; j <= j1; j++) {
      if (j < -nx || j > nx) continue;
      for (let i = i0; i <= i1; i++) {
        if (i < -nx || i > nx) continue;
        if (lut[b.cls[(j + nx) * b.W + (i + nx)]]) return true;
      }
    }
    return false;
  }

  function moveX(w, b, d) {
    const n = Math.max(1, Math.ceil(Math.abs(d) / 0.1)), s = d / n;
    for (let k = 0; k < n; k++) {
      if (!hit(w, b, w.x + s, w.y, w.solid, P.EPS)) { w.x += s; continue; }
      if (w.onGround) {
        let ok = false;
        for (let u = 0.1; u <= P.STEP_UP + 1e-9; u += 0.1) {
          if (!hit(w, b, w.x + s, w.y - u, w.solid, P.EPS)) { w.x += s; w.y -= u; ok = true; break; }
        }
        if (ok) continue;
      }
      let lo = 0, hi = s;
      for (let i = 0; i < 6; i++) {
        const m = (lo + hi) / 2;
        if (hit(w, b, w.x + m, w.y, w.solid, P.EPS)) hi = m; else lo = m;
      }
      w.x += lo; w.vx = 0;
      return;
    }
  }

  // devuelve true si chocó
  function moveY(w, b, d) {
    const n = Math.max(1, Math.ceil(Math.abs(d) / 0.1)), s = d / n;
    for (let k = 0; k < n; k++) {
      if (!hit(w, b, w.x, w.y + s, w.solid, P.EPS)) { w.y += s; continue; }
      let lo = 0, hi = s;
      for (let i = 0; i < 6; i++) {
        const m = (lo + hi) / 2;
        if (hit(w, b, w.x, w.y + m, w.solid, P.EPS)) hi = m; else lo = m;
      }
      w.y += lo;
      return true;
    }
    return false;
  }

  function approach(v, target, delta) {
    if (v < target) return Math.min(target, v + delta);
    return Math.max(target, v - delta);
  }

  function step(w, b, input, dt) {
    if (w.dead || w.won) { w.endT += dt; return; }

    w.stuck = 0;
    if (hit(w, b, w.x, w.y, w.solid, P.EPS)) {
      w.stuck = 1;
      for (let u = 0.1; u <= 3.0; u += 0.1) {
        if (!hit(w, b, w.x, w.y - u, w.solid, P.EPS)) { w.y -= u; w.vy = 0; w.stuck = 2; break; }
      }
    }

    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir) {
      w.face = dir;
      w.vx = approach(w.vx, dir * P.SPEED, (w.onGround ? P.ACCEL : P.AIR_ACCEL) * dt);
    } else {
      w.vx = approach(w.vx, 0, (w.onGround ? P.FRICTION : 20) * dt);
    }

    w.coyote = w.onGround ? P.COYOTE : w.coyote - dt;
    if (input.jump && !w.prevJump) w.buffer = P.BUFFER; else w.buffer -= dt;
    w.prevJump = !!input.jump;
    if (w.buffer > 0 && w.coyote > 0) { w.vy = -P.JUMP_V; w.buffer = 0; w.coyote = 0; w.onGround = false; }
    if (!input.jump && w.vy < -P.JUMP_V * P.CUT) w.vy = -P.JUMP_V * P.CUT;

    w.vy = Math.min(P.MAX_FALL, w.vy + P.GRAVITY * dt);

    moveX(w, b, w.vx * dt);
    const wasFalling = w.vy > 0;
    w.onGround = false;
    if (moveY(w, b, w.vy * dt)) {
      if (wasFalling) w.onGround = true;
      w.vy = 0;
    }

    if (hit(w, b, w.x, w.y, w.hazard, 0.2) || w.y > w.fallY) { w.dead = true; w.endT = 0; }
    else if (hit(w, b, w.x, w.y, w.goal, 0.1)) { w.won = true; w.endT = 0; }
  }

  const Physics = Object.assign({ createWorld, respawn, step }, { W: P.W, H: P.H, params: P });

  if (typeof module !== 'undefined' && module.exports) module.exports = Physics;
  else root.Physics = Physics;
})(typeof self !== 'undefined' ? self : this);
