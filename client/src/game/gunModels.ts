// Procedural gun models built from boxes and cylinders. The origin is the grip, the barrel points to -Z.
// Used for the first person viewmodel and (scaled) for the other players' hands.

import * as THREE from 'three';
import type { WeaponDef } from '@holdfast/shared';
import { box, cyl } from './geo';

export interface GunModel {
  group: THREE.Group;
  /** Muzzle position in the model's local space (flash and tracer start). */
  muzzle: THREE.Vector3;
  /** Ejection port in local space. */
  eject: THREE.Vector3;
  /** Height of the sight line above the origin, used to line the sights up with the screen center when aiming. */
  sightY: number;
  /** Where the left hand holds the weapon (local space). */
  leftHand: THREE.Vector3;
  /** Parts that animate. */
  mag?: THREE.Object3D;
  slide?: THREE.Object3D;
  pump?: THREE.Object3D;
  cylinder?: THREE.Object3D;
  /** How far the slide / bolt / pump travels, in meters. */
  travel: number;
  suppressed: boolean;
}

function tint(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return (r << 16) | (g << 8) | b;
}

const BLACK = 0x15171a;
const STEEL = 0x6b7178;
const WOOD = 0x6d4f33;

function pistolFrame(g: THREE.Group, body: number): { slide: THREE.Mesh } {
  g.add(box(0.03, 0.045, 0.13, tint(body, 0.8), 0, 0.0, -0.04));
  g.add(box(0.032, 0.095, 0.045, tint(body, 0.7), 0, -0.065, 0.025)); // grip
  g.add(box(0.008, 0.03, 0.02, BLACK, 0, -0.03, -0.04)); // trigger guard
  const slide = box(0.033, 0.04, 0.2, body, 0, 0.038, -0.07);
  g.add(slide);
  return { slide };
}

export function buildGun(def: WeaponDef): GunModel {
  const g = new THREE.Group();
  const c = def.color;
  const dark = tint(c, 0.7);
  const light = tint(c, 1.25);
  let muzzleZ = -def.length;
  let sightY = 0.07;
  let travel = 0.04;
  const eject = new THREE.Vector3(0.03, 0.04, -0.1);
  const leftHand = new THREE.Vector3(0, -0.04, -0.3);
  let mag: THREE.Object3D | undefined;
  let slide: THREE.Object3D | undefined;
  let pump: THREE.Object3D | undefined;
  let cylinder: THREE.Object3D | undefined;

  switch (def.kind) {
    case 'rifle': {
      // receiver, handguard, barrel with a brake, stock and a curved magazine
      g.add(box(0.045, 0.07, 0.17, dark, 0, 0, -0.03));
      g.add(box(0.034, 0.1, 0.04, dark, 0, -0.07, 0.03)); // grip
      const upper = box(0.05, 0.055, 0.3, c, 0, 0.045, -0.15);
      g.add(upper);
      g.add(box(0.058, 0.058, 0.22, light, 0, 0.03, -0.38)); // handguard
      g.add(cyl(0.011, 0.2, BLACK, 0, 0.035, -0.59));
      g.add(cyl(0.017, 0.045, BLACK, 0, 0.035, -0.69));
      g.add(box(0.04, 0.07, 0.2, dark, 0, -0.01, 0.2)); // stock
      g.add(box(0.044, 0.09, 0.025, BLACK, 0, -0.01, 0.31)); // butt pad
      g.add(box(0.016, 0.02, 0.1, BLACK, 0, 0.082, -0.18)); // top rail
      g.add(box(0.012, 0.03, 0.012, BLACK, 0, 0.1, -0.62)); // front sight
      g.add(box(0.03, 0.03, 0.012, BLACK, 0, 0.098, -0.06)); // rear sight
      const m = new THREE.Group();
      m.position.set(0, -0.07, -0.12);
      m.add(box(0.036, 0.12, 0.055, 0x24272c, 0, -0.03, 0));
      m.add(box(0.036, 0.04, 0.05, 0x24272c, 0, -0.1, 0.02));
      g.add(m);
      mag = m;
      const bolt = box(0.02, 0.02, 0.035, STEEL, 0.032, 0.05, -0.1);
      g.add(bolt);
      slide = bolt;
      muzzleZ = -0.72;
      sightY = 0.105;
      eject.set(0.04, 0.05, -0.1);
      leftHand.set(0, -0.015, -0.4);
      travel = 0.045;
      break;
    }
    case 'smg': {
      g.add(box(0.045, 0.07, 0.17, dark, 0, 0, -0.02));
      g.add(box(0.034, 0.1, 0.04, dark, 0, -0.07, 0.035));
      g.add(box(0.05, 0.058, 0.26, c, 0, 0.042, -0.13));
      g.add(box(0.054, 0.05, 0.1, light, 0, 0.03, -0.3)); // short shroud
      g.add(box(0.025, 0.07, 0.03, BLACK, 0, -0.07, -0.3)); // vertical foregrip
      g.add(cyl(0.011, 0.1, BLACK, 0, 0.035, -0.4));
      g.add(box(0.012, 0.035, 0.18, STEEL, 0, 0.02, 0.17)); // folded wire stock
      g.add(box(0.03, 0.04, 0.012, BLACK, 0, 0.0, 0.26));
      g.add(box(0.012, 0.025, 0.012, BLACK, 0, 0.088, -0.38));
      g.add(box(0.026, 0.026, 0.012, BLACK, 0, 0.088, -0.06));
      const m = new THREE.Group();
      m.position.set(0, -0.07, -0.08);
      m.add(box(0.034, 0.14, 0.045, 0x24272c, 0, -0.05, 0));
      g.add(m);
      mag = m;
      const bolt = box(0.02, 0.02, 0.035, STEEL, 0.032, 0.05, -0.08);
      g.add(bolt);
      slide = bolt;
      muzzleZ = -0.45;
      sightY = 0.09;
      eject.set(0.04, 0.05, -0.08);
      leftHand.set(0, -0.06, -0.3);
      travel = 0.035;
      if (def.suppressed) {
        g.add(cyl(0.021, 0.24, 0x1b1d20, 0, 0.035, -0.54));
        g.add(cyl(0.024, 0.02, STEEL, 0, 0.035, -0.425));
        muzzleZ = -0.68;
      }
      break;
    }
    case 'shotgun': {
      g.add(box(0.045, 0.075, 0.16, dark, 0, 0, -0.03));
      g.add(box(0.034, 0.09, 0.04, tint(WOOD, 0.9), 0, -0.07, 0.03));
      g.add(box(0.05, 0.06, 0.12, c, 0, 0.03, -0.1)); // receiver
      g.add(cyl(0.017, 0.5, BLACK, 0, 0.04, -0.4)); // barrel
      g.add(cyl(0.014, 0.4, 0x24272c, 0, -0.005, -0.37)); // tube magazine
      g.add(cyl(0.02, 0.02, BLACK, 0, 0.04, -0.66)); // muzzle
      g.add(box(0.042, 0.08, 0.2, tint(WOOD, 1.0), 0, -0.01, 0.2)); // stock
      g.add(box(0.044, 0.09, 0.025, BLACK, 0, -0.01, 0.31));
      g.add(box(0.012, 0.03, 0.012, BLACK, 0, 0.073, -0.64));
      const p = box(0.052, 0.05, 0.16, tint(WOOD, 0.85), 0, -0.005, -0.37); // pump forend
      g.add(p);
      pump = p;
      muzzleZ = -0.68;
      sightY = 0.085;
      eject.set(0.035, 0.04, -0.1);
      leftHand.set(0, -0.005, -0.37);
      travel = 0.1;
      break;
    }
    case 'dmr': {
      g.add(box(0.045, 0.07, 0.17, dark, 0, 0, -0.03));
      g.add(box(0.034, 0.1, 0.04, dark, 0, -0.07, 0.03));
      g.add(box(0.05, 0.055, 0.34, c, 0, 0.045, -0.17));
      g.add(box(0.052, 0.05, 0.3, light, 0, 0.03, -0.46));
      g.add(cyl(0.012, 0.26, BLACK, 0, 0.035, -0.74));
      g.add(cyl(0.016, 0.05, BLACK, 0, 0.035, -0.88));
      g.add(box(0.04, 0.08, 0.26, tint(c, 0.85), 0, -0.005, 0.22)); // stock with a cheek riser
      g.add(box(0.034, 0.03, 0.12, tint(c, 0.85), 0, 0.045, 0.17));
      g.add(box(0.044, 0.09, 0.025, BLACK, 0, -0.01, 0.35));
      // scope: tube, two rings and glass
      g.add(cyl(0.022, 0.2, 0x1d2024, 0, 0.12, -0.14));
      g.add(cyl(0.03, 0.05, 0x1d2024, 0, 0.12, -0.25));
      g.add(cyl(0.026, 0.045, 0x1d2024, 0, 0.12, -0.03));
      g.add(box(0.012, 0.04, 0.02, BLACK, 0, 0.085, -0.08));
      g.add(box(0.012, 0.04, 0.02, BLACK, 0, 0.085, -0.2));
      const glass = box(0.03, 0.03, 0.004, 0x66d8ff, 0, 0.12, -0.277);
      g.add(glass);
      const m = new THREE.Group();
      m.position.set(0, -0.07, -0.1);
      m.add(box(0.034, 0.11, 0.05, 0x24272c, 0, -0.03, 0));
      g.add(m);
      mag = m;
      const bolt = box(0.02, 0.02, 0.04, STEEL, 0.032, 0.05, -0.1);
      g.add(bolt);
      slide = bolt;
      muzzleZ = -0.9;
      sightY = 0.12;
      eject.set(0.04, 0.05, -0.1);
      leftHand.set(0, -0.015, -0.5);
      travel = 0.05;
      break;
    }
    case 'lmg': {
      g.add(box(0.055, 0.08, 0.22, dark, 0, 0, -0.04));
      g.add(box(0.036, 0.1, 0.04, dark, 0, -0.075, 0.04));
      g.add(box(0.06, 0.07, 0.34, c, 0, 0.05, -0.2));
      g.add(box(0.07, 0.07, 0.2, light, 0, 0.035, -0.46)); // heat shroud
      g.add(cyl(0.014, 0.2, BLACK, 0, 0.04, -0.68));
      g.add(cyl(0.022, 0.05, BLACK, 0, 0.04, -0.78));
      g.add(box(0.045, 0.08, 0.22, dark, 0, -0.01, 0.22));
      g.add(box(0.05, 0.1, 0.025, BLACK, 0, -0.01, 0.34));
      g.add(box(0.012, 0.05, 0.12, BLACK, 0, 0.115, -0.2)); // carry handle
      g.add(box(0.012, 0.012, 0.12, BLACK, 0, 0.14, -0.2));
      // folded bipod
      g.add(box(0.012, 0.012, 0.18, STEEL, 0.03, -0.03, -0.5));
      g.add(box(0.012, 0.012, 0.18, STEEL, -0.03, -0.03, -0.5));
      // belt box
      const m = new THREE.Group();
      m.position.set(0, -0.08, -0.1);
      m.add(box(0.07, 0.11, 0.1, 0x3b4033, 0, -0.06, 0));
      m.add(box(0.03, 0.02, 0.04, 0xc9a24a, 0.045, -0.03, 0));
      g.add(m);
      mag = m;
      const bolt = box(0.024, 0.024, 0.04, STEEL, 0.04, 0.06, -0.12);
      g.add(bolt);
      slide = bolt;
      muzzleZ = -0.8;
      sightY = 0.14;
      eject.set(0.045, 0.05, -0.12);
      leftHand.set(0, -0.015, -0.5);
      travel = 0.045;
      break;
    }
    case 'pistol': {
      const f = pistolFrame(g, c);
      slide = f.slide;
      const m = new THREE.Group();
      m.position.set(0, -0.075, 0.025);
      m.add(box(0.026, 0.07, 0.036, 0x24272c, 0, -0.01, 0));
      g.add(m);
      mag = m;
      g.add(box(0.008, 0.014, 0.01, BLACK, 0, 0.065, -0.16)); // front sight
      g.add(box(0.02, 0.014, 0.01, BLACK, 0, 0.065, 0.02)); // rear sight
      muzzleZ = -0.18;
      sightY = 0.07;
      eject.set(0.02, 0.045, -0.06);
      leftHand.set(0.0, -0.06, 0.025);
      travel = 0.05;
      break;
    }
    case 'revolver': {
      g.add(box(0.032, 0.06, 0.11, c, 0, 0.0, -0.04));
      g.add(box(0.034, 0.1, 0.045, tint(WOOD, 0.9), 0, -0.07, 0.035)); // wooden grip
      g.add(cyl(0.013, 0.2, BLACK, 0, 0.03, -0.2)); // heavy barrel
      g.add(box(0.02, 0.012, 0.18, tint(c, 1.2), 0, 0.058, -0.2)); // rib
      g.add(box(0.008, 0.02, 0.01, BLACK, 0, 0.075, -0.3));
      g.add(box(0.012, 0.02, 0.01, BLACK, 0, 0.07, 0.02));
      const drum = cyl(0.03, 0.07, 0x4a4f55, 0, 0.012, -0.02, 0.03, 6);
      g.add(drum);
      cylinder = drum;
      const hammer = box(0.01, 0.03, 0.02, BLACK, 0, 0.05, 0.05);
      g.add(hammer);
      slide = hammer;
      muzzleZ = -0.32;
      sightY = 0.08;
      eject.set(0.02, 0.01, -0.02);
      leftHand.set(0.0, -0.06, 0.03);
      travel = 0.02;
      break;
    }
    default:
      g.add(box(0.05, 0.085, def.length, c, 0, 0, -def.length / 2));
      break;
  }

  return {
    group: g,
    muzzle: new THREE.Vector3(0, def.kind === 'pistol' ? 0.038 : def.kind === 'revolver' ? 0.03 : 0.035, muzzleZ),
    eject,
    sightY,
    leftHand,
    ...(mag ? { mag } : {}),
    ...(slide ? { slide } : {}),
    ...(pump ? { pump } : {}),
    ...(cylinder ? { cylinder } : {}),
    travel,
    suppressed: def.suppressed,
  };
}
