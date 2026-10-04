// Shared geometry helpers: unlit, flat shaded boxes with baked per face shading and tiny procedural textures.

import * as THREE from 'three';

/** Brightness per face direction, baked into vertex colors since the scene is unlit. */
export function faceShade(nx: number, ny: number, nz: number): number {
  if (ny > 0.5) return 1.0;
  if (ny < -0.5) return 0.52;
  if (nx > 0.5) return 0.82;
  if (nx < -0.5) return 0.7;
  if (nz > 0.5) return 0.9;
  return 0.62;
}

const cache = new Map<string, THREE.BoxGeometry>();

/** A box with baked face shading. Vertex colors are white * shade so materials/instances tint it. */
export function shadedBox(w: number, h: number, d: number, color = 0xffffff): THREE.BoxGeometry {
  const key = `${w}|${h}|${d}|${color}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const g = new THREE.BoxGeometry(w, h, d);
  const n = g.getAttribute('normal');
  const colors = new Float32Array(n.count * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n.count; i++) {
    const s = faceShade(n.getX(i), n.getY(i), n.getZ(i));
    colors[i * 3] = c.r * s;
    colors[i * 3 + 1] = c.g * s;
    colors[i * 3 + 2] = c.b * s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.userData['shared'] = true;
  cache.set(key, g);
  return g;
}

const matCache = new Map<number, THREE.MeshBasicMaterial>();

export function basicMat(color = 0xffffff, opts: { transparent?: boolean; opacity?: number; depthTest?: boolean; depthWrite?: boolean; side?: THREE.Side } = {}): THREE.MeshBasicMaterial {
  const plain = !opts.transparent && opts.depthTest === undefined && opts.depthWrite === undefined && opts.side === undefined;
  if (plain) {
    const hit = matCache.get(color);
    if (hit) return hit;
  }
  const m = new THREE.MeshBasicMaterial({
    color,
    vertexColors: true,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    depthTest: opts.depthTest ?? true,
    depthWrite: opts.depthWrite ?? true,
    side: opts.side ?? THREE.FrontSide,
  });
  if (plain) {
    m.userData['shared'] = true;
    matCache.set(color, m);
  }
  return m;
}

const cylCache = new Map<string, THREE.CylinderGeometry>();

/** A cylinder along the Z axis with baked face shading (like shadedBox). */
export function shadedCylinder(radiusTop: number, radiusBottom: number, length: number, segments = 10): THREE.CylinderGeometry {
  const key = `${radiusTop}|${radiusBottom}|${length}|${segments}`;
  const hit = cylCache.get(key);
  if (hit) return hit;
  const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, segments, 1);
  g.rotateX(Math.PI / 2);
  const n = g.getAttribute('normal');
  const colors = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const sh = faceShade(n.getX(i), n.getY(i), n.getZ(i));
    colors[i * 3] = sh;
    colors[i * 3 + 1] = sh;
    colors[i * 3 + 2] = sh;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.userData['shared'] = true;
  cylCache.set(key, g);
  return g;
}

/** A cylinder mesh along Z: radius, length, flat color, position. A different bottom radius makes a cone. */
export function cyl(radius: number, length: number, color: number, x = 0, y = 0, z = 0, radiusBottom = radius, segments = 10): THREE.Mesh {
  const m = new THREE.Mesh(shadedCylinder(radius, radiusBottom, length, segments), basicMat(color));
  m.position.set(x, y, z);
  return m;
}

/** A mesh made of a shaded box and a flat color. */
export function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(shadedBox(w, h, d), basicMat(color));
  m.position.set(x, y, z);
  return m;
}

/** Subtle tiled noise texture used on the static world so large flat surfaces read as surfaces. */
export function makeWorldTexture(): THREE.CanvasTexture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, size, size);
    let seed = 1337;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 260; i++) {
      const v = 226 + Math.floor(rnd() * 30);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(Math.floor(rnd() * size), Math.floor(rnd() * size), 2, 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    g.lineWidth = 2;
    g.strokeRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

export function hash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Dispose geometries, materials and textures under an object, except the shared cached ones. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData['shared']) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    for (const x of Array.isArray(mat) ? mat : [mat]) {
      if (x.userData['shared']) continue;
      const tex = (x as THREE.MeshBasicMaterial).map;
      if (tex) tex.dispose();
      x.dispose();
    }
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
}
