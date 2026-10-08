// Configuración compartida entre markers.html e index.html.
// Si cambias algo aquí, cambia en ambas páginas a la vez (es el mismo archivo).

// Diccionario de marcadores: 4x4 = cuadrícula de 4x4 bits (6x6 con el borde negro).
const DICTIONARY_NAME = 'ARUCO_4X4_1000';

// Qué significa cada ID. Agrega los que necesites.
const BLOCKS = {
  0: 'Inicio (personaje)',
  1: 'Suelo',
  2: 'Ladrillo',
  3: 'Signo ?',
  4: 'Goomba (enemigo)',
  5: 'Koopa (enemigo)',
  6: 'Tubería',
  7: 'Meta'
};

// Cuáles IDs son enemigos (matan al contacto) y cuáles son sólidos (se puede pisar).
const ENEMY_IDS = [4, 5];
const SOLID_IDS = [1, 2, 3, 6];
