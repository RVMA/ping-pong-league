import { describe, expect, it } from 'vitest';
import { makeRng } from '../../src/bot.ts';
import { makeConfig } from '../../src/config.ts';
import type { BallState } from '../../src/physics.ts';
import {
  type C2S,
  decodeC2S,
  decodeS2C,
  encode,
  exitFromWire,
  exitToWire,
  type HitInput,
  hitFromWire,
  hitToWire,
  keysToMask,
  maskToKeys,
  PROTOCOL_VERSION,
  type S2C,
} from '../../src/net/protocol.ts';

const cfg = makeConfig();
const hitWire = { t: 812.125, x: -123.456, z: 1601.5, vx: 2.5, q: 1, b: 0 as const, sv: [120.5, 300, 0], sx: -120.25, sz: 1600 };

const roomMsg: S2C = {
  k: 'room',
  code: 'QZXK',
  md: 'standard',
  ph: 'match',
  pl: [
    { nm: 'Ana', c: 1, r: 1, rt: 0 },
    { nm: 'Leo', c: 0, r: 0, rt: 1 },
  ],
  gw: [1, 0],
  dl: 2500,
  dk: 'count',
};

const c2s: C2S[] = [
  { k: 'hello', v: PROTOCOL_VERSION, h: '0a1b2c3d', r: 'player', nm: 'Ana', p: 100, bp: 100, j: 0.1, sp: 0, d: 'medium', s: 7, o: 0 },
  { k: 'hello', v: PROTOCOL_VERSION, h: '0a1b2c3d', r: 'bot', nm: 'Bot', tk: 'abcd1234-ef56', p: 150, bp: 150, j: 0, sp: 0.2, d: 'hard', s: 3, o: -20 },
  { k: 'hello', v: PROTOCOL_VERSION, h: '0a1b2c3d', r: 'player', nm: '', p: 0, bp: 0, j: 0, sp: 0, d: 'medium', s: 3, o: 0, fs: 1 },
  { k: 'rdy', on: 1 },
  { k: 'rt', on: 0 },
  { k: 'leave' },
  { k: 'p', n: 3, r: 1234, x: -123, z: 1650 },
  { k: 'p', n: 0, r: -1, x: 0, z: 1700 },
  { k: 'toss', n: 4, x: 12.345, z: 1600, a: 0 },
  { k: 'hit', n: 4, f: 2, ...hitWire },
  { k: 'hit', n: 4, f: 1, t: 400, x: 0, z: 1600, vx: 0, q: 0, b: 1, sv: [] },
  { k: 'wf', n: 4, f: 2, t: 650.5 },
  { k: 'end', n: 4, f: 3 },
  { k: 'ping', i: 12, t: 123456.789, a: 98.4 },
  { k: 'again' },
];

const s2c: S2C[] = [
  { k: 'welcome', v: PROTOCOL_VERSION, side: 0, room: 'QZXK', tk: 'a1b2c3d4-e5f6', md: 'standard' },
  { k: 'welcome', v: PROTOCOL_VERSION, side: 1, room: 'b-12', tk: 'a1b2c3d4-e5f6', md: 'bot' },
  { k: 'err', m: 'config', d: 'hash distinto' },
  { k: 'start', fs: 0, n: 0, wu: 0, g: 0, sc: [0, 0], ns: 0 },
  { k: 'start', fs: 1, n: 37, wu: 1, g: 2, sc: [7, 9], ns: 1 },
  roomMsg,
  { k: 'room', code: 'QZXK', md: 'quick', ph: 'waiting', pl: [null, null], gw: [0, 0], dl: -1, dk: '' },
  { k: 'mend', w: 0, why: 'score', gw: [2, 1], st: [{ pf: 62, ms: 4, ne: 3, pts: 41 }, { pf: 48, ms: 9, ne: 5, pts: 35 }], rj: [0, 1] },
  { k: 'p', n: 3, r: 1234, x: -123, z: -1650 },
  { k: 'toss', n: 4, x: 12.345, z: -1600, a: 1 },
  { k: 'fl', n: 4, f: 3, p: 1, j: 95, h: hitWire, s: [0.1 + 0.2, 0.9, -1.2, 3.25, 1e-9, -7.75, 100.5, -3, 0] },
  { k: 'wf', n: 4, f: 2, t: 650.5, p: 1 },
  { k: 'pt', n: 4, f: 3, i: 120, w: 0, r: 'MISSED', sc: [5, 3], ns: 1, go: -1 },
  { k: 'pt', n: 5, f: 2, i: 80, w: -1, r: 'LET', sc: [5, 3], ns: 1, go: -1 },
  { k: 'pong', i: 12, t: 123456.789 },
  { k: 'pings', a: [101.2, -1] },
  { k: 'bye', m: 'el rival se desconectó' },
];

describe('protocolo: ida y vuelta', () => {
  it('cada mensaje del cliente se decodifica igual que se envió', () => {
    for (const m of c2s) expect(decodeC2S(encode(m))).toEqual(m);
  });
  it('cada mensaje del servidor se decodifica igual que se envió', () => {
    for (const m of s2c) expect(decodeS2C(encode(m))).toEqual(m);
  });
  it('la raqueta a 30 Hz es compacta (≤ 26 bytes)', () => {
    expect(encode({ k: 'p', n: 120, r: 59999, x: -1299, z: -2699 }).length).toBeLessThanOrEqual(26);
  });
});

describe('evento de golpe cuantizado', () => {
  const raw: HitInput = {
    t: 812.1234567,
    pad: { x: -0.1234567891, z: 1.60123456 },
    swingVx: 2.512345678,
    keys: { topspin: true, smash: true },
    block: false,
    speeds: [0.12345, 1.5, 0.000001],
    ref: { x: -0.12, z: 1.6000004 },
  };
  it('queda a menos de medio micrómetro y medio microsegundo del original', () => {
    const q = hitFromWire(hitToWire(raw, cfg));
    expect(Math.abs(q.t - raw.t)).toBeLessThanOrEqual(0.0005);
    expect(Math.abs(q.pad.x - raw.pad.x)).toBeLessThanOrEqual(5e-7);
    expect(Math.abs(q.pad.z - raw.pad.z)).toBeLessThanOrEqual(5e-7);
    expect(Math.abs(q.speeds[0] - raw.speeds[0])).toBeLessThanOrEqual(5e-5);
    expect(Math.abs(q.swingVx - raw.swingVx)).toBeLessThanOrEqual(5e-5);
    expect(q.keys).toEqual({ topspin: true, smash: true });
    expect(q.ref).not.toBeNull();
  });
  it('es idempotente y sobrevive al JSON sin cambiar un bit (lo que predice el cliente = lo que evalúa el servidor)', () => {
    const w = hitToWire(raw, cfg);
    expect(hitToWire(hitFromWire(w), cfg)).toEqual(w);
    const viaJson = decodeC2S(encode({ k: 'hit', n: 1, f: 1, ...w }));
    expect(viaJson && viaJson.k === 'hit' && hitFromWire(viaJson)).toEqual(hitFromWire(w));
  });
  it('sin muestras de raqueta no hay referencia', () => {
    const w = hitToWire({ ...raw, speeds: [], ref: null }, cfg);
    expect(w.sv).toEqual([]);
    expect(w.sx).toBeUndefined();
    expect(hitFromWire(w).ref).toBeNull();
  });
  it('teclas ↔ máscara', () => {
    expect(keysToMask({})).toBe(0);
    expect(keysToMask({ topspin: true, slice: true, smash: true })).toBe(7);
    expect(maskToKeys(2)).toEqual({ slice: true });
    expect(maskToKeys(0)).toEqual({});
  });
});

describe('estado de salida oficial', () => {
  it('sobrevive al JSON bit a bit (también el cero negativo, que se normaliza)', () => {
    const b: BallState = { pos: { x: 0.1 + 0.2, y: 0.9200000000000002, z: -1.37 }, vel: { x: -0, y: 2.0000000000000004, z: -7.123456789012345 }, spin: { x: 123.456, y: -0, z: 1e-300 } };
    const wire = exitToWire(b);
    const back = exitFromWire(JSON.parse(JSON.stringify(wire)));
    expect(back).toEqual(exitFromWire(wire));
    expect(Object.is(back.pos.x, b.pos.x)).toBe(true);
    expect(Object.is(back.vel.z, b.vel.z)).toBe(true);
    expect(Object.is(back.vel.x, 0)).toBe(true);
  });
});

describe('mensajes malformados: se descartan, nunca lanzan', () => {
  const bad = [
    'no es json',
    '',
    'null',
    '[]',
    '[1,2,3]',
    '{"k":"nada"}',
    '{"k":"end","n":"4","f":3}',
    '{"k":"end","n":4,"f":1.5}',
    '{"k":"end","n":4}',
    '{"k":"wf","n":4,"f":2,"t":1e400}',
    `{"k":"hit","n":1,"f":1,"t":10,"x":0,"z":1600,"vx":0,"q":8,"b":0,"sv":[]}`,
    `{"k":"hit","n":1,"f":1,"t":10,"x":0,"z":1600,"vx":0,"q":0,"b":0,"sv":[${Array(65).fill(1).join(',')}],"sx":0,"sz":0}`,
    `{"k":"hit","n":1,"f":1,"t":10,"x":99999,"z":1600,"vx":0,"q":0,"b":0,"sv":[]}`,
    `{"k":"hit","n":1,"f":1,"t":10,"x":0,"z":1600,"vx":0,"q":0,"b":0,"sv":[1]}`,
    '{"k":"hello","v":"1","h":"0a1b2c3d","r":"player","nm":"A","p":0,"bp":0,"j":0,"sp":0,"d":"medium","s":1,"o":0}',
    '{"k":"hello","v":1,"h":"zz","r":"player","nm":"A","p":0,"bp":0,"j":0,"sp":0,"d":"medium","s":1,"o":0}',
    '{"k":"hello","v":1,"h":"0a1b2c3d","r":"admin","nm":"A","p":0,"bp":0,"j":0,"sp":0,"d":"medium","s":1,"o":0}',
    '{"k":"hello","v":1,"h":"0a1b2c3d","r":"player","nm":"A","p":0,"bp":0,"j":0,"sp":0,"d":"medium","s":1,"o":0,"fs":2}',
    `{"k":"hello","v":2,"h":"0a1b2c3d","r":"player","nm":"A","p":0,"bp":0,"j":0,"sp":-0.1,"d":"medium","s":1,"o":0}`,
    `{"k":"hello","v":2,"h":"0a1b2c3d","r":"player","nm":"A","tk":"${'x'.repeat(200)}","p":0,"bp":0,"j":0,"sp":0,"d":"medium","s":1,"o":0}`,
    '{"k":"rdy","on":2}',
    '[1,2,3,"4"]',
    '[1.5,2,3,4]',
  ];
  it('rechaza cada caso del cliente', () => {
    for (const t of bad) expect(decodeC2S(t), t).toBeNull();
  });
  it('rechaza mensajes nuevos inválidos del servidor', () => {
    const room = { k: 'room', code: 'QZXK', md: 'standard', ph: 'match', pl: [null, null], gw: [0, 0], dl: -1, dk: '' };
    expect(decodeS2C(JSON.stringify(room))).not.toBeNull();
    for (const bad of [{ ph: 'dormida' }, { gw: [0, 0, 1] }, { md: 'huge' }, { dk: 'x' }, { code: '' }, { pl: [null] }, { pl: [{ nm: 'a', c: 1, r: 1 }, null] }]) expect(decodeS2C(JSON.stringify({ ...room, ...bad })), JSON.stringify(bad)).toBeNull();
    expect(decodeS2C('{"k":"room","code":"QZXK","md":"standard","ph":"match","pl":[null,null],"gw":[0,0],"dl":1e400,"dk":""}')).toBeNull();
    expect(decodeS2C('{"k":"mend","w":0,"why":"score","gw":[2,1],"rj":[0,0]}')).toBeNull();
    expect(decodeS2C('{"k":"start","fs":0}')).toBeNull();
    expect(decodeS2C('{"k":"welcome","v":2,"side":0,"room":"QZXK","tk":"short","md":"standard"}')).toBeNull();
  });
  it('encode de un room típico ≤ 160 bytes y de un start ≤ 80', () => {
    expect(encode(roomMsg).length).toBeLessThanOrEqual(160);
    expect(encode({ k: 'start', fs: 1, n: 123456, wu: 0, g: 2, sc: [10, 11], ns: 1 }).length).toBeLessThanOrEqual(80);
  });
  it('rechaza estados de salida incompletos o no finitos del servidor', () => {
    expect(decodeS2C('{"k":"fl","n":1,"f":1,"p":0,"j":3,"h":{"t":1,"x":0,"z":0,"vx":0,"q":0,"b":0,"sv":[]},"s":[1,2,3,4,5,6,7,8]}')).toBeNull();
    expect(decodeS2C('{"k":"fl","n":1,"f":1,"p":0,"j":3,"h":{"t":1,"x":0,"z":0,"vx":0,"q":0,"b":0,"sv":[]},"s":[1,2,3,4,5,6,7,8,1e400]}')).toBeNull();
    expect(decodeS2C('{"k":"pt","n":1,"f":1,"i":3,"w":2,"r":"NET","sc":[1,1],"ns":0,"go":-1}')).toBeNull();
    expect(decodeS2C('{"k":"pt","n":1,"f":1,"i":3,"w":0,"r":"CHEAT","sc":[1,1],"ns":0,"go":-1}')).toBeNull();
  });
  it('fuzz: 2 000 mutaciones de mensajes válidos no lanzan', () => {
    const rng = makeRng(1);
    const valid = [...c2s, ...s2c].map(encode);
    const chars = '{}[]",:-.0123456789eaknpfrtz ';
    for (let i = 0; i < 2000; i++) {
      const base = valid[Math.floor(rng() * valid.length)];
      let s = base;
      const edits = 1 + Math.floor(rng() * 4);
      for (let e = 0; e < edits; e++) {
        const pos = Math.floor(rng() * (s.length + 1));
        const r = rng();
        if (r < 0.4) s = s.slice(0, pos) + s.slice(pos + 1);
        else if (r < 0.8) s = s.slice(0, pos) + chars[Math.floor(rng() * chars.length)] + s.slice(pos);
        else s = s.slice(0, pos);
      }
      expect(() => decodeC2S(s)).not.toThrow();
      expect(() => decodeS2C(s)).not.toThrow();
    }
  });
});
