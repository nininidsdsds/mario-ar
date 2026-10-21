// Física del personaje (sin cámara ni pantalla): se puede probar en Node.
// Todo va en centímetros sobre el pizarrón: x → derecha, y → abajo.
// El personaje se ubica por el centro de sus pies (x, y); su caja va de (x - ancho/2, y - alto) a (x + ancho/2, y).
// El nivel es una máscara de "píxeles finos" (la misma cuadrícula del mapa): 1 = sólido, 0 = aire.
(function (root) {
  'use strict';

  const DEFAULTS = {
    charW: 1.3, charH: 1.8,          // tamaño del personaje (cm)
    runSpeed: 10,                    // velocidad máxima al correr (cm/s)
    groundAccel: 100, airAccel: 70,  // aceleración (cm/s²)
    groundFriction: 140, airFriction: 20,
    gravity: 130,                    // cm/s²
    jumpHeight: 4.4,                 // altura del salto (cm), alrededor de 2 bloques
    maxFall: 70,                     // velocidad máxima de caída (cm/s)
    coyote: 0.09,                    // segundos que aún puedes saltar después de salir de un borde
    buffer: 0.12,                    // segundos que se "recuerda" un toque de salto antes de aterrizar
    stepUp: 0.4,                     // desniveles de hasta 0.4 cm se suben solos (tapa el ruido del mapa)
    fallMargin: 5,                   // cm bajo el bloque más bajo para dar por perdido al personaje
    sideMargin: 15,                  // cm a los lados del nivel antes de dar por perdido al personaje
    respawnDelay: 0.7                // segundos antes de reaparecer
  };

  const DT = 1 / 120;      // paso fijo de la simulación
  const STEP = 0.05;       // cm: el movimiento se hace en pasitos para no atravesar paredes

  // Máscara de sólidos a partir del mapa. solidClasses = índices de tipo que se pisan.
  function buildMask(board, solidClasses) {
    const lut = new Uint8Array(256);
    solidClasses.forEach(c => { lut[c] = 1; });
    const m = new Uint8Array(board.cls.length);
    for (let i = 0; i < m.length; i++) m[i] = lut[board.cls[i]];
    return m;
  }

  function solidAt(w, ix, iy) {
    if (ix < -w.nx || ix > w.nx || iy < -w.nx || iy > w.nx) return false;
    return w.mask[(iy + w.nx) * w.W + (ix + w.nx)] === 1;
  }

  // ¿La caja del personaje, puesta con los pies en (x, y), toca algún sólido?
  function overlaps(w, x, y) {
    const f = w.fine, hw = w.p.charW / 2;
    const ix0 = Math.floor((x - hw) / f + 0.5);
    const ix1 = Math.floor((x + hw - 1e-6) / f + 0.5);
    const iy0 = Math.floor((y - w.p.charH) / f + 0.5);
    const iy1 = Math.floor((y - 1e-6) / f + 0.5);
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) if (solidAt(w, ix, iy)) return true;
    }
    return false;
  }

  // Límites del nivel (hasta dónde llegan los sólidos). null si no hay ninguno.
  function computeLimits(mask, fine, nx, p) {
    const W = 2 * nx + 1;
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
    for (let iy = -nx; iy <= nx; iy++) {
      for (let ix = -nx; ix <= nx; ix++) {
        if (mask[(iy + nx) * W + (ix + nx)] === 1) {
          n++;
          if (ix < minX) minX = ix;
          if (ix > maxX) maxX = ix;
          if (iy > maxY) maxY = iy;
        }
      }
    }
    if (!n) return null;
    return {
      minX: (minX - 0.5) * fine - p.sideMargin,
      maxX: (maxX + 0.5) * fine + p.sideMargin,
      maxY: (maxY + 0.5) * fine + p.fallMargin
    };
  }

  // Cambia el mapa de sólidos de un mundo ya creado (cuando la cámara ve algo nuevo). false si no hay sólidos.
  function setMask(w, mask) {
    const lim = computeLimits(mask, w.fine, w.nx, w.p);
    if (!lim) return false;
    w.mask = mask; w.limits = lim;
    return true;
  }

  // Crea el mundo. spawn = {x, y} (pies) donde aparece el personaje. Devuelve null si no hay ningún sólido.
  function createWorld(mask, fine, nx, spawn, opts) {
    const p = Object.assign({}, DEFAULTS, opts || {});
    const W = 2 * nx + 1;
    const limits = computeLimits(mask, fine, nx, p);
    if (!limits) return null;
    const w = {
      mask, fine, nx, W, p,
      v0: Math.sqrt(2 * p.gravity * p.jumpHeight),
      limits,
      spawn: { x: spawn.x, y: spawn.y },
      x: 0, y: 0, vx: 0, vy: 0, onGround: false, facing: 1,
      coyoteT: 0, bufferT: 0, prevJump: false,
      deadT: 0, deaths: 0, jumps: 0, blink: 0, acc: 0, time: 0, lastEvent: null
    };
    respawn(w, true);
    return w;
  }

  function respawn(w, first) {
    w.x = w.spawn.x; w.y = w.spawn.y;
    w.vx = 0; w.vy = 0; w.onGround = false; w.coyoteT = 0; w.bufferT = 0; w.deadT = 0;
    // si hay algo encima del bloque de inicio, sube hasta encontrar espacio libre
    for (let i = 0; i < 40 && overlaps(w, w.x, w.y); i++) w.y -= 0.25;
    w.blink = first ? 0 : 0.6;
  }

  function moveX(w, dx) {
    const n = Math.ceil(Math.abs(dx) / STEP);
    if (!n) return;
    const sx = dx / n;
    for (let i = 0; i < n; i++) {
      if (!overlaps(w, w.x + sx, w.y)) { w.x += sx; continue; }
      // ¿es un escalón pequeño? entonces se sube solo
      let stepped = false;
      if (w.onGround) {
        for (let up = STEP; up <= w.p.stepUp + 1e-9; up += STEP) {
          if (!overlaps(w, w.x + sx, w.y - up)) { w.x += sx; w.y -= up; stepped = true; break; }
        }
      }
      if (!stepped) { w.vx = 0; return; }
    }
  }

  function moveY(w, dy) {
    const n = Math.ceil(Math.abs(dy) / STEP);
    if (!n) return;
    const sy = dy / n;
    for (let i = 0; i < n; i++) {
      if (!overlaps(w, w.x, w.y + sy)) { w.y += sy; continue; }
      w.vy = 0;      // golpeó el piso o el techo
      return;
    }
  }

  function stepOnce(w, input, dt) {
    const p = w.p;
    w.time += dt;
    if (w.blink > 0) w.blink -= dt;

    if (w.deadT > 0) {
      w.deadT -= dt;
      if (w.deadT <= 0) respawn(w);
      w.prevJump = !!input.jump;
      return;
    }

    // por si algo lo dejó metido en un sólido: súbelo
    for (let i = 0; i < 30 && overlaps(w, w.x, w.y); i++) w.y -= 0.1;

    // salto: el toque se recuerda un instante
    if (input.jump && !w.prevJump) w.bufferT = p.buffer;
    w.prevJump = !!input.jump;
    if (w.bufferT > 0) w.bufferT -= dt;

    // horizontal
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir) w.facing = dir;
    if (dir) {
      const a = (w.onGround ? p.groundAccel : p.airAccel) * dt;
      w.vx += Math.max(-a, Math.min(a, dir * p.runSpeed - w.vx));
    } else {
      const f = (w.onGround ? p.groundFriction : p.airFriction) * dt;
      if (Math.abs(w.vx) <= f) w.vx = 0; else w.vx -= Math.sign(w.vx) * f;
    }

    // tiempo "coyote": un instante de gracia al salir de un borde
    if (w.onGround) w.coyoteT = p.coyote; else if (w.coyoteT > 0) w.coyoteT -= dt;

    // saltar
    if (w.bufferT > 0 && w.coyoteT > 0) {
      w.vy = -w.v0; w.onGround = false; w.coyoteT = 0; w.bufferT = 0; w.jumps++;
    }

    // gravedad y movimiento
    w.vy = Math.min(w.vy + p.gravity * dt, p.maxFall);
    moveX(w, w.vx * dt);
    moveY(w, w.vy * dt);
    w.onGround = w.vy >= 0 && overlaps(w, w.x, w.y + 0.06);

    // ¿se salió del nivel (caída)?
    if (w.y > w.limits.maxY || w.x < w.limits.minX || w.x > w.limits.maxX) {
      w.deaths++; w.deadT = p.respawnDelay; w.lastEvent = 'fall';
    }
  }

  // Avanza el juego "dt" segundos reales. input = {left, right, jump} (true/false).
  function update(w, input, dt) {
    w.acc += Math.max(0, Math.min(dt, 0.1));
    let guard = 0;
    while (w.acc >= DT && guard++ < 14) { w.acc -= DT; stepOnce(w, input, DT); }
  }

  const Physics = { DEFAULTS, DT, buildMask, createWorld, setMask, update, respawn, overlaps, solidAt };

  if (typeof module !== 'undefined' && module.exports) module.exports = Physics;
  else root.Physics = Physics;
})(typeof self !== 'undefined' ? self : this);
