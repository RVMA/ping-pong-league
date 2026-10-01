import * as shared from '@ppp/shared';
import './style.css';
import { Game } from './game/game.ts';
import { readSettings } from './game/settings.ts';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;
const game = new Game(canvas, hud, readSettings());

// Ganchos de depuración para playtest y pruebas automáticas (Playwright). No afectan al juego.
declare global {
  interface Window {
    __ppp?: Game;
    __pppShared?: typeof shared;
  }
}
window.__ppp = game;
window.__pppShared = shared;
