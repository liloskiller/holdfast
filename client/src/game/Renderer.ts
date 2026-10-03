// Three.js renderer, cameras, resize handling, quality tiers and dynamic resolution.

import * as THREE from 'three';
import { isTouchDevice, settings, type Quality } from '../settings';

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly vmScene = new THREE.Scene();
  readonly vmCamera: THREE.PerspectiveCamera;
  private quality: Quality;
  private baseRatio = 1;
  private scale = 1;
  private slowFor = 0;
  private fastFor = 0;
  private width = 1;
  private height = 1;
  fovBase = 80;
  fovCurrent = 80;
  readonly touch = isTouchDevice();
  adaptive = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.quality = settings.quality;
    this.gl = new THREE.WebGLRenderer({
      canvas,
      antialias: !this.touch && this.quality === 'high',
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    // Mobile browsers can drop the GL context in the background. Allow the browser to restore it.
    canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    this.gl.autoClear = false;
    this.gl.setClearColor(0x9db8c9, 1);

    this.camera = new THREE.PerspectiveCamera(80, 1, 0.05, 160);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.vmScene.add(this.vmCamera);

    this.scene.background = new THREE.Color(0x9db8c9);
    this.scene.fog = new THREE.Fog(0x9db8c9, 38, 105);

    this.applyQuality();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 150));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.resize());
  }

  applyQuality(): void {
    this.quality = settings.quality;
    const dpr = window.devicePixelRatio || 1;
    switch (this.quality) {
      case 'low':
        this.baseRatio = Math.min(dpr, 1) * 0.85;
        this.scene.fog = new THREE.Fog(0x9db8c9, 25, 70);
        this.camera.far = 80;
        break;
      case 'medium':
        this.baseRatio = Math.min(dpr, this.touch ? 1.5 : 1.75);
        this.scene.fog = new THREE.Fog(0x9db8c9, 32, 90);
        this.camera.far = 110;
        break;
      default:
        this.baseRatio = Math.min(dpr, this.touch ? 1.5 : 2);
        this.scene.fog = new THREE.Fog(0x9db8c9, 40, 110);
        this.camera.far = 160;
        break;
    }
    this.camera.updateProjectionMatrix();
    this.gl.setPixelRatio(this.baseRatio * this.scale);
    this.resize();
  }

  resize(): void {
    const vv = window.visualViewport;
    const w = Math.max(1, Math.floor(vv ? vv.width : window.innerWidth));
    const h = Math.max(1, Math.floor(vv ? vv.height : window.innerHeight));
    this.width = w;
    this.height = h;
    this.gl.setPixelRatio(this.baseRatio * this.scale);
    this.gl.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  }

  /** Remove everything from both scenes (used when a new game starts). */
  resetScene(): void {
    this.scene.clear();
    this.vmScene.clear();
    this.scene.add(this.camera);
    this.vmScene.add(this.vmCamera);
  }

  get aspect(): number {
    return this.width / this.height;
  }

  /** Vertical field of view for a horizontal one at the current aspect ratio. */
  verticalFov(horizontalDeg: number): number {
    const h = (horizontalDeg * Math.PI) / 360;
    return (2 * Math.atan(Math.tan(h) / Math.max(1, this.aspect > 1 ? Math.min(this.aspect, 2.4) : this.aspect))) * (180 / Math.PI);
  }

  /** Set the vertical field of view in degrees. */
  setFov(fov: number): void {
    if (Math.abs(fov - this.fovCurrent) < 0.01) return;
    this.fovCurrent = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Dynamic resolution: drop the render scale when frames take too long. */
  adapt(frameMs: number, dt: number): void {
    if (!this.adaptive) return;
    if (frameMs > 24) {
      this.slowFor += dt;
      this.fastFor = 0;
      if (this.slowFor > 1.5 && this.scale > 0.55) {
        this.scale = Math.max(0.55, this.scale - 0.1);
        this.slowFor = 0;
        this.gl.setPixelRatio(this.baseRatio * this.scale);
        this.gl.setSize(this.width, this.height, false);
      }
    } else if (frameMs < 13) {
      this.fastFor += dt;
      this.slowFor = 0;
      if (this.fastFor > 6 && this.scale < 1) {
        this.scale = Math.min(1, this.scale + 0.1);
        this.fastFor = 0;
        this.gl.setPixelRatio(this.baseRatio * this.scale);
        this.gl.setSize(this.width, this.height, false);
      }
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
  }

  get renderScale(): number {
    return this.scale;
  }

  render(showViewmodel: boolean): void {
    this.gl.info.autoReset = false;
    this.gl.info.reset();
    this.gl.clear();
    this.gl.render(this.scene, this.camera);
    if (showViewmodel) {
      this.gl.clearDepth();
      this.gl.render(this.vmScene, this.vmCamera);
    }
  }

  info(): { calls: number; triangles: number; geometries: number; textures: number } {
    const i = this.gl.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures };
  }
}
