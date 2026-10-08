// Configuración compartida entre markers.html e index.html.
// Si cambias algo aquí, cambia en ambas páginas a la vez (es el mismo archivo).

// Diccionario de marcadores: 4x4 = cuadrícula de 4x4 bits (6x6 con el borde negro).
const DICTIONARY_NAME = 'ARUCO_4X4_1000';

// Solo estos bloques llevan marcador (para no tapar el diseño de los demás).
// Los bloques normales se reconocen por color (ver calibración en index.html).
const START_ID = 0;   // bloque de inicio: es el "ancla" que define la cuadrícula
const GOAL_ID = 1;    // meta
const BLOCKS = {
  0: 'Inicio (personaje)',
  1: 'Meta',
  4: 'Enemigo A',
  5: 'Enemigo B'
};

// Enemigos con marcador: matan al contacto.
const ENEMY_IDS = [4, 5];

// Tamaño real de una casilla (tus cubos).
const BLOCK_CM = 2;

// Tipos de casilla que la cámara aprende por color.
const CLASSES = {
  solid:    { label: 'Sólido',   color: '#ff9f0a' },  // ladrillos, madera, tierra
  cloud:    { label: 'Nube',     color: '#64d2ff' },
  question: { label: 'Bloque ?', color: '#ffd60a' },
  hazard:   { label: 'Peligro',  color: '#ff453a' },  // bolas de fuego, enemigos
  empty:    { label: 'Fondo',    color: '#8e8e93' }   // lo que hay detrás: vacío
};

// Si la flecha verde del bloque de inicio no apunta hacia ABAJO del pizarrón
// (con el bloque colocado derecho), cambia este número a 1, 2 o 3.
const CORNER_SHIFT = 0;
