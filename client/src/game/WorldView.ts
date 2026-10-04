// Builds meshes from the shared World: merged static geometry, one InstancedMesh per cell material,
// animated doors, barricades and the objective marker. Destruction updates single instances.

import * as THREE from 'three';
import { CELL, FLOOR_H, MaterialId, SIEGE, TILE, Skin, Vox, type Opening, type World } from '@holdfast/shared';
import { basicMat, disposeTree, faceShade, hash, makeWorldTexture, shadedBox } from './geo';

const SKIN_COLOR: Record<number, number> = {
  [Skin.CONCRETE]: 0x5d626a,
  [Skin.SLAB]: 0xb9a68a,
  [Skin.ROOF]: 0x585d64,
  [Skin.FENCE]: 0x6b727a,
  [Skin.FURNITURE]: 0x7c5c3e,
  [Skin.TALL]: 0x5d4f46,
};

const CELL_COLOR: Record<number, number> = {
  [MaterialId.WOOD]: 0x9a7448,
  [MaterialId.PLASTER]: 0xddd6c6,
  [MaterialId.BRICK]: 0xa8503b,
  [MaterialId.GLASS]: 0x9fd8ea,
  [MaterialId.FLOOR_WOOD]: 0xa87a40,
  [MaterialId.METAL]: 0x707c88,
};

/** Reinforceable wall panels get a mustard tint so players can spot them. */
const PANEL_COLOR = 0xcaa75a;

interface CellSlot {
  mesh: THREE.InstancedMesh;
  index: number;
}

interface DoorView {
  op: Opening;
  pivot: THREE.Group;
  panel: THREE.Mesh;
  target: number;
  angle: number;
  /** First instance of this opening's planks in the shared plank mesh. */
  plankBase: number;
}

export class WorldView {
  readonly group = new THREE.Group();
  private statics: THREE.Mesh | null = null;
  private worldTex = makeWorldTexture();
  private cellMeshes = new Map<number, THREE.InstancedMesh>();
  private metal!: THREE.InstancedMesh;
  private slots: (CellSlot | null)[] = [];
  private metalSlot: Int32Array = new Int32Array(0);
  private doors: DoorView[] = [];
  private plankMesh: THREE.InstancedMesh | null = null;
  private tmpM = new THREE.Matrix4();
  private tmpC = new THREE.Color();
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();
  private zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  private objective: THREE.Mesh | null = null;
  private objMat = new THREE.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  private objEdges: THREE.LineSegments | null = null;
  private dirty = new Set<THREE.InstancedMesh>();
  private prevAlive: Uint8Array = new Uint8Array(0);
  onDebris: ((x: number, y: number, z: number, mat: number) => void) | null = null;
  private time = 0;

  constructor(private world: World, private scene: THREE.Scene) {
    this.scene.add(this.group);
    this.world.onCell = (id): void => this.cellChanged(id);
    this.world.onOpening = (id): void => this.openingChanged(id);
    this.buildAll();
  }

  dispose(): void {
    this.world.onCell = null;
    this.world.onOpening = null;
    this.scene.remove(this.group);
    disposeTree(this.group);
    this.worldTex.dispose();
    this.objMat.dispose();
  }

  /**
   * Re-sync every cell, door and barricade with the world state (new round). The static geometry
   * never changes, so it is kept; this avoids rebuilding and leaking meshes every round.
   */
  refresh(): void {
    this.prevAlive = Uint8Array.from(this.world.cellAlive);
    for (let id = 0; id < this.world.cellCount; id++) this.applyCell(id);
    for (const d of this.doors) {
      d.angle = 0;
      if (d.pivot) d.pivot.rotation.y = 0;
    }
    for (const op of this.world.openings) this.openingChanged(op.id);
    for (const d of this.doors) {
      if (d.pivot) d.pivot.rotation.y = d.angle = d.target;
    }
  }

  /** Build everything from the current world state (join). */
  buildAll(): void {
    disposeTree(this.group);
    this.group.clear();
    this.doors = [];
    this.plankMesh = null;
    this.cellMeshes.clear();
    this.buildGround();
    this.buildStatic();
    this.buildCells();
    this.buildOpenings();
    this.buildObjective();
  }

  // -------------------------------------------------------------------------

  private buildGround(): void {
    const { nx, nz } = this.world;
    const w = nx * TILE;
    const d = nz * TILE;
    // grass / dirt yard
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(w + 200, d + 200), new THREE.MeshBasicMaterial({ color: 0x66724f }));
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(w / 2, -0.01, d / 2);
    this.group.add(yard);
    // paved area inside the fence
    const paved = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0x7c8084, map: this.worldTex }));
    (paved.material as THREE.MeshBasicMaterial).map?.repeat.set(w, d);
    paved.rotation.x = -Math.PI / 2;
    paved.position.set(w / 2, 0.0, d / 2);
    this.group.add(paved);
    // interior floor of the ground level
    const b = this.world.map.building;
    const bw = (b.x1 - b.x0) * TILE;
    const bd = (b.z1 - b.z0) * TILE;
    const tex = this.worldTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(bw, bd);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(bw, bd), new THREE.MeshBasicMaterial({ color: 0xc2b293, map: tex }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((b.x0 * TILE) + bw / 2, 0.004, (b.z0 * TILE) + bd / 2);
    this.group.add(floor);
  }

  private buildStatic(): void {
    const w = this.world;
    const { nx, nz, ny } = w;
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const color = new THREE.Color();
    const isStatic = (x: number, l: number, z: number): boolean => {
      if (x < 0 || z < 0 || l < 0 || x >= nx || z >= nz || l >= ny) return false;
      return w.vox[(l * nz + z) * nx + x] === Vox.STATIC;
    };

    const faces: [number, number, number, number[][]][] = [
      // normal, then 4 corner offsets (CCW seen from outside)
      [1, 0, 0, [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]]],
      [-1, 0, 0, [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
      [0, 1, 0, [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
      [0, -1, 0, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
      [0, 0, 1, [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
      [0, 0, -1, [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
    ];

    let vcount = 0;
    for (let l = 0; l < ny; l++) {
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          if (w.vox[(l * nz + z) * nx + x] !== Vox.STATIC) continue;
          const skin = w.skin[(l * nz + z) * nx + x] as number;
          let base = SKIN_COLOR[skin] ?? 0x888888;
          if (skin === Skin.FURNITURE) {
            base = [0x7c5c3e, 0x5f6f7a, 0x8a4f4a, 0x6b7a54][Math.floor(hash(x >> 2, z >> 2, 7) * 4)] ?? base;
          }
          const jitter = 0.94 + hash(x, l, z) * 0.1;
          for (const [fx, fy, fz, corners] of faces) {
            if (isStatic(x + fx, l + fy, z + fz)) continue;
            if (l === 0 && fy < 0) continue;
            const shade = faceShade(fx, fy, fz) * jitter;
            color.setHex(base);
            for (const c of corners) {
              const cx = (x + (c[0] as number)) * TILE;
              const cy = (l + (c[1] as number)) * CELL;
              const cz = (z + (c[2] as number)) * TILE;
              pos.push(cx, cy, cz);
              nor.push(fx, fy, fz);
              col.push(color.r * shade, color.g * shade, color.b * shade);
              if (fy !== 0) uv.push(cx * 0.5, cz * 0.5);
              else if (fx !== 0) uv.push(cz * 0.5, cy * 0.5);
              else uv.push(cx * 0.5, cy * 0.5);
            }
            idx.push(vcount, vcount + 1, vcount + 2, vcount, vcount + 2, vcount + 3);
            vcount += 4;
          }
        }
      }
    }

    // stair steps
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const top = w.stairTop[z * nx + x] as number;
        if (top <= 0) continue;
        const base = w.stairBase[z * nx + x] as number;
        color.setHex(0x8b6e4e);
        for (const [fx, fy, fz, corners] of faces) {
          // only draw faces that can be seen: top and sides
          if (fy < 0) continue;
          const shade = faceShade(fx, fy, fz);
          for (const c of corners) {
            const cx = (x + (c[0] as number)) * TILE;
            const cy = (c[1] as number) ? top : base;
            const cz = (z + (c[2] as number)) * TILE;
            pos.push(cx, cy, cz);
            nor.push(fx, fy, fz);
            col.push(color.r * shade, color.g * shade, color.b * shade);
            uv.push(cx * 0.5, cz * 0.5);
          }
          idx.push(vcount, vcount + 1, vcount + 2, vcount, vcount + 2, vcount + 3);
          vcount += 4;
        }
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(vcount > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, map: this.worldTex }));
    mesh.matrixAutoUpdate = false;
    this.statics = mesh;
    this.group.add(mesh);
  }

  private cellMatrix(id: number, alive: boolean): THREE.Matrix4 {
    if (!alive) return this.zeroM;
    const c = { x: 0, y: 0, z: 0 };
    this.world.cellCenter(id, c);
    return this.tmpM.makeTranslation(c.x, c.y, c.z);
  }

  private buildCells(): void {
    const w = this.world;
    const counts = new Map<number, number>();
    for (let i = 0; i < w.cellCount; i++) {
      const m = w.cellMat[i] as number;
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    const geo = shadedBox(TILE, CELL, TILE);
    const mats: Record<number, THREE.MeshBasicMaterial> = {
      [MaterialId.WOOD]: new THREE.MeshBasicMaterial({ vertexColors: true }),
      [MaterialId.PLASTER]: new THREE.MeshBasicMaterial({ vertexColors: true }),
      [MaterialId.BRICK]: new THREE.MeshBasicMaterial({ vertexColors: true }),
      [MaterialId.FLOOR_WOOD]: new THREE.MeshBasicMaterial({ vertexColors: true }),
      [MaterialId.GLASS]: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.38, depthWrite: false }),
    };
    this.cellMeshes.clear();
    const next = new Map<number, number>();
    for (const [mat, count] of counts) {
      const m = mats[mat] ?? mats[MaterialId.PLASTER]!;
      const mesh = new THREE.InstancedMesh(geo, m, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      if (mat === MaterialId.GLASS) mesh.renderOrder = 2;
      this.cellMeshes.set(mat, mesh);
      this.group.add(mesh);
      next.set(mat, 0);
    }
    // metal (reinforced) pool: one slot for every cell that belongs to a panel
    let panelCells = 0;
    for (const p of w.panels) panelCells += p.cellIds.length;
    this.metal = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }), Math.max(1, panelCells));
    this.metal.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.metal.frustumCulled = false;
    this.group.add(this.metal);
    this.metalSlot = new Int32Array(w.cellCount).fill(-1);
    let mi = 0;
    for (const p of w.panels) for (const cid of p.cellIds) this.metalSlot[cid] = mi++;
    for (let i = 0; i < this.metal.count; i++) this.metal.setMatrixAt(i, this.zeroM);

    this.slots = new Array(w.cellCount).fill(null);
    this.prevAlive = Uint8Array.from(w.cellAlive);
    for (let id = 0; id < w.cellCount; id++) {
      const mat = w.cellMat[id] as number;
      const mesh = this.cellMeshes.get(mat);
      if (!mesh) continue;
      const index = next.get(mat) as number;
      next.set(mat, index + 1);
      this.slots[id] = { mesh, index };
      this.applyCell(id);
    }
    for (const mesh of this.cellMeshes.values()) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.metal.instanceMatrix.needsUpdate = true;
    if (this.metal.instanceColor) this.metal.instanceColor.needsUpdate = true;
  }

  /** Write the instance (matrix + color) for a cell from the world state. */
  private applyCell(id: number): void {
    const w = this.world;
    const slot = this.slots[id];
    if (!slot) return;
    const alive = w.cellAlive[id] === 1;
    const reinforced = w.cellReinf[id] === 1 && alive;
    const mat = w.cellMat[id] as number;
    const base = (w.cellPanel[id] as number) >= 0 ? PANEL_COLOR : (CELL_COLOR[mat] ?? 0xcccccc);
    const ratio = Math.max(0, Math.min(1, (w.cellHp[id] as number) / (w.cellMaxHp[id] as number)));
    const tint = 0.5 + 0.5 * ratio;

    // normal slot
    slot.mesh.setMatrixAt(slot.index, reinforced ? this.zeroM : this.cellMatrix(id, alive));
    this.tmpC.setHex(base).multiplyScalar(tint);
    slot.mesh.setColorAt(slot.index, this.tmpC);
    this.dirty.add(slot.mesh);

    // metal slot
    const ms = this.metalSlot[id] as number;
    if (ms >= 0) {
      this.metal.setMatrixAt(ms, reinforced ? this.cellMatrix(id, true) : this.zeroM);
      this.tmpC.setHex(CELL_COLOR[MaterialId.METAL] as number).multiplyScalar(0.92 + 0.08 * (id % 3));
      this.metal.setColorAt(ms, this.tmpC);
      this.dirty.add(this.metal);
    }
  }

  private cellChanged(id: number): void {
    const wasAlive = this.prevAlive[id] === 1;
    this.applyCell(id);
    const nowAlive = this.world.cellAlive[id] === 1;
    this.prevAlive[id] = nowAlive ? 1 : 0;
    if (wasAlive && !nowAlive && this.onDebris) {
      const c = { x: 0, y: 0, z: 0 };
      this.world.cellCenter(id, c);
      this.onDebris(c.x, c.y, c.z, this.world.cellMat[id] as number);
    }
  }

  // -------------------------------------------------------------------------

  private buildOpenings(): void {
    let plankTotal = 0;
    for (const op of this.world.openings) {
      const b = op.box;
      const span = op.alongX ? b.maxX - b.minX : b.maxZ - b.minZ;
      const view: Partial<DoorView> = { op, target: 0, angle: 0 };

      if (op.kind === 'door') {
        const pivot = new THREE.Group();
        const panelGeo = op.alongX ? shadedBox(span - 0.03, 2.0, 0.12) : shadedBox(0.12, 2.0, span - 0.03);
        const panel = new THREE.Mesh(panelGeo, new THREE.MeshBasicMaterial({ color: 0x5e4026, vertexColors: true }));
        if (op.alongX) {
          pivot.position.set(b.minX + 0.015, b.minY, op.cz);
          panel.position.set((span - 0.03) / 2, 1.0, 0);
        } else {
          pivot.position.set(op.cx, b.minY, b.minZ + 0.015);
          panel.position.set(0, 1.0, (span - 0.03) / 2);
        }
        // handle
        const handle = new THREE.Mesh(shadedBox(0.07, 0.07, 0.07), basicMat(0xd0c070));
        handle.position.set(op.alongX ? span - 0.18 : 0.08, 1.0, op.alongX ? 0.08 : span - 0.18);
        panel.add(handle);
        pivot.add(panel);
        this.group.add(pivot);
        view.pivot = pivot;
        view.panel = panel;
      }

      view.plankBase = plankTotal;
      plankTotal += op.plankCols * op.plankRows;
      this.doors.push(view as DoorView);
    }
    // every barricade plank in the building is one instance of a single mesh
    const mesh = new THREE.InstancedMesh(shadedBox(1, 1, 1), new THREE.MeshBasicMaterial({ vertexColors: true }), Math.max(1, plankTotal));
    mesh.frustumCulled = false;
    for (let i = 0; i < plankTotal; i++) mesh.setMatrixAt(i, this.zeroM);
    mesh.setColorAt(0, this.tmpC.setHex(0xffffff));
    this.plankMesh = mesh;
    this.group.add(mesh);
    for (const op of this.world.openings) this.openingChanged(op.id);
  }

  private openingChanged(id: number): void {
    const d = this.doors[id];
    if (!d) return;
    const op = d.op;
    if (d.pivot) {
      d.pivot.visible = !op.destroyed;
      d.target = op.open ? (op.alongX ? -1.55 : 1.55) : 0;
    }
    this.updatePlanks(d);
  }

  /** Put every plank of one opening in place (or hide it), tinted darker the more it is beaten up. */
  private updatePlanks(d: DoorView): void {
    const mesh = this.plankMesh;
    if (!mesh) return;
    const op = d.op;
    const w = 0.25;
    const total = op.plankCols * op.plankRows;
    const b = op.box;
    const q = this.tmpQ;
    const m = this.tmpM;
    for (let k = 0; k < total; k++) {
      const i = d.plankBase + k;
      const hp = op.planks[k] ?? 0;
      if (hp <= 0) {
        mesh.setMatrixAt(i, this.zeroM);
        continue;
      }
      const col = k % op.plankCols;
      const row = Math.floor(k / op.plankCols);
      const h = ((k * 2654435761 + op.id * 40503) >>> 0) / 4294967296;
      const along = (op.alongX ? b.minX : b.minZ) + (col + 0.5) * w;
      const y = b.minY + (row + 0.5) * w;
      // a slight tilt and a small shift per plank so the barricade looks nailed up by hand
      this.tmpE.set(0, 0, (h - 0.5) * 0.12);
      q.setFromEuler(this.tmpE);
      this.tmpV.set(op.alongX ? along : op.cx, y, op.alongX ? op.cz : along);
      this.tmpS.set(op.alongX ? w * 0.93 : 0.14, w * 0.82, op.alongX ? 0.14 : w * 0.93);
      if (!op.alongX) {
        this.tmpE.set((h - 0.5) * 0.12, 0, 0);
        q.setFromEuler(this.tmpE);
      }
      m.compose(this.tmpV, q, this.tmpS);
      mesh.setMatrixAt(i, m);
      const ratio = Math.min(1, hp / SIEGE.plankHp);
      this.tmpC.setHex(0xc89c5c).multiplyScalar((0.5 + 0.5 * ratio) * (0.88 + 0.24 * h));
      mesh.setColorAt(i, this.tmpC);
    }
    this.dirty.add(mesh);
  }

  private buildObjective(): void {
    this.objective = null;
    this.objEdges = null;
  }

  /** Show the objective site marker (index into map.objectives) or hide with -1. */
  setObjective(idx: number): void {
    if (this.objective) this.group.remove(this.objective);
    if (this.objEdges) this.group.remove(this.objEdges);
    this.objective = null;
    this.objEdges = null;
    const site = this.world.map.objectives[idx];
    if (!site) return;
    const w = site.maxX - site.minX;
    const d = site.maxZ - site.minZ;
    const h = 2.4;
    const geo = new THREE.BoxGeometry(w, h, d);
    this.objective = new THREE.Mesh(geo, this.objMat);
    this.objective.position.set(site.minX + w / 2, site.y + h / 2, site.minZ + d / 2);
    this.objective.renderOrder = 3;
    this.group.add(this.objective);
    this.objEdges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffd23c }));
    this.objEdges.position.copy(this.objective.position);
    this.group.add(this.objEdges);
  }

  update(dt: number): void {
    this.time += dt;
    for (const d of this.dirty) {
      d.instanceMatrix.needsUpdate = true;
      if (d.instanceColor) d.instanceColor.needsUpdate = true;
    }
    this.dirty.clear();
    for (const d of this.doors) {
      if (!d.pivot) continue;
      const diff = d.target - d.angle;
      if (Math.abs(diff) > 0.001) {
        const step = Math.sign(diff) * Math.min(Math.abs(diff), dt * 6);
        d.angle += step;
        d.pivot.rotation.y = d.angle;
      }
    }
    if (this.objective) this.objMat.opacity = 0.16 + 0.08 * Math.sin(this.time * 3);
  }

  /** Center and size, for the lobby orbit camera. */
  bounds(): { cx: number; cz: number; radius: number } {
    const b = this.world.map.building;
    return {
      cx: ((b.x0 + b.x1) / 2) * TILE,
      cz: ((b.z0 + b.z1) / 2) * TILE,
      radius: Math.hypot((b.x1 - b.x0) * TILE, (b.z1 - b.z0) * TILE) / 2,
    };
  }

  get floorHeight(): number {
    return FLOOR_H;
  }

  get staticMesh(): THREE.Mesh | null {
    return this.statics;
  }
}
