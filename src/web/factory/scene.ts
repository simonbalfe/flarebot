import { DirectionalLight, Fog, HemisphereLight, type Material, Mesh, OrthographicCamera, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { type BotState, Bots } from "./bots";
import { createWorld, stationTags, type World } from "./world";

const viewWidth = 26;
const viewHeight = 17;
const cameraDistance = 60;
const maxPixelRatio = 2;
const maxFrameSeconds = 0.1;
const clickSlopPixels = 5;
const labelWidth = 104;
const labelGap = 26;
const focus = new Vector3(1.6, 1.5, 0);

export type { BotState };

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface FactoryCallbacks {
  onPick: (botId: string) => void;
  onFrame: (points: ReadonlyMap<string, ScreenPoint>) => void;
}

export class FactoryScene {
  #container: HTMLElement;
  #callbacks: FactoryCallbacks;
  #renderer: WebGLRenderer;
  #scene = new Scene();
  #camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  #controls: OrbitControls;
  #world: World;
  #bots: Bots;
  #observer: ResizeObserver;
  #raycaster = new Raycaster();
  #points = new Map<string, ScreenPoint>();
  #botIds: string[] = [];
  #working = 0;
  #alert = false;
  #motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  #now = 0;
  #pressedAt: ScreenPoint | null = null;
  #scratch = new Vector3();

  constructor(container: HTMLElement, toolColors: readonly string[], callbacks: FactoryCallbacks) {
    this.#container = container;
    this.#callbacks = callbacks;
    this.#renderer = new WebGLRenderer({ antialias: true });
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    this.#renderer.shadowMap.enabled = true;
    container.appendChild(this.#renderer.domElement);

    this.#world = createWorld(toolColors);
    this.#bots = new Bots(this.#motion);
    this.#scene.background = this.#world.background;
    this.#scene.fog = new Fog(0xffd9a0, cameraDistance + 8, cameraDistance + 75);
    this.#scene.add(this.#world.group, this.#bots.group, new HemisphereLight(0xfff4e0, 0xf6a04d, 1.9), this.#sun());

    this.#camera.position.copy(focus).add(new Vector3(1, 0.82, 1).normalize().multiplyScalar(cameraDistance));
    this.#controls = new OrbitControls(this.#camera, this.#renderer.domElement);
    this.#controls.target.copy(focus);
    this.#controls.enablePan = false;
    this.#controls.enableDamping = true;
    this.#controls.minZoom = 0.6;
    this.#controls.maxZoom = 3;
    this.#controls.minPolarAngle = 0.55;
    this.#controls.maxPolarAngle = 1.25;
    this.#controls.update();

    this.#observer = new ResizeObserver(() => this.#resize());
    this.#observer.observe(container);
    this.#resize();
    this.#renderer.domElement.addEventListener("pointerdown", this.#onPointerDown);
    this.#renderer.domElement.addEventListener("pointerup", this.#onPointerUp);
    this.#renderer.setAnimationLoop((milliseconds) => this.#frame(milliseconds / 1000));
  }

  setBots(states: BotState[]): void {
    this.#botIds = states.map((state) => state.id);
    this.#working = states.filter((state) => state.working).length;
    this.#alert = states.some((state) => state.alert);
    this.#bots.set(states, this.#now);
  }

  sendPacket(fromId: string, toId: string): void {
    this.#bots.send(fromId, toId, this.#now);
  }

  dispose(): void {
    this.#renderer.setAnimationLoop(null);
    this.#observer.disconnect();
    this.#controls.dispose();
    this.#renderer.domElement.removeEventListener("pointerdown", this.#onPointerDown);
    this.#renderer.domElement.removeEventListener("pointerup", this.#onPointerUp);
    this.#scene.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry.dispose();
      const materials: Material[] = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    });
    this.#world.background.dispose();
    for (const texture of this.#world.textures) texture.dispose();
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
  }

  #sun(): DirectionalLight {
    const sun = new DirectionalLight(0xfff1dc, 1.7);
    sun.position.set(-9, 20, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 14;
    sun.shadow.camera.bottom = -14;
    sun.shadow.camera.far = 60;
    sun.shadow.bias = -0.0005;
    return sun;
  }

  #resize(): void {
    const { clientWidth, clientHeight } = this.#container;
    if (clientWidth === 0 || clientHeight === 0) return;
    const aspect = clientWidth / clientHeight;
    const height = Math.max(viewHeight, viewWidth / aspect);
    this.#camera.left = (-height * aspect) / 2;
    this.#camera.right = (height * aspect) / 2;
    this.#camera.top = height / 2;
    this.#camera.bottom = -height / 2;
    this.#camera.updateProjectionMatrix();
    this.#renderer.setSize(clientWidth, clientHeight);
  }

  #frame(seconds: number): void {
    const delta = Math.min(maxFrameSeconds, seconds - this.#now);
    this.#now = seconds;
    this.#controls.update();
    this.#bots.update(seconds);
    this.#world.update(seconds, delta, { occupied: this.#bots.occupied(), working: this.#working, alert: this.#alert, motion: this.#motion });
    this.#renderer.render(this.#scene, this.#camera);
    this.#project();
  }

  #project(): void {
    const { clientWidth, clientHeight } = this.#container;
    const place = (key: string, position: Vector3): void => {
      const projected = this.#scratch.copy(position).project(this.#camera);
      this.#points.set(key, { x: (projected.x * 0.5 + 0.5) * clientWidth, y: (-projected.y * 0.5 + 0.5) * clientHeight });
    };
    this.#points.clear();
    for (const tag of stationTags) place(`station:${tag.key}`, tag.position);
    const anchor = new Vector3();
    for (const id of this.#botIds) if (this.#bots.labelAnchor(id, anchor)) place(`bot:${id}`, anchor);
    this.#spreadBotLabels();
    this.#callbacks.onFrame(this.#points);
  }

  #spreadBotLabels(): void {
    const overlaps = (a: ScreenPoint, b: ScreenPoint): boolean => Math.abs(a.x - b.x) < labelWidth && Math.abs(a.y - b.y) < labelGap;
    const placed: ScreenPoint[] = [];
    const lowestFirst = this.#botIds.flatMap((id) => this.#points.get(`bot:${id}`) ?? []).sort((a, b) => b.y - a.y);
    for (const point of lowestFirst) {
      let blocker = placed.find((other) => overlaps(other, point));
      while (blocker !== undefined) {
        point.y = blocker.y - labelGap;
        blocker = placed.find((other) => overlaps(other, point));
      }
      placed.push(point);
    }
  }

  #onPointerDown = (event: PointerEvent): void => {
    this.#pressedAt = { x: event.clientX, y: event.clientY };
  };

  #onPointerUp = (event: PointerEvent): void => {
    const pressedAt = this.#pressedAt;
    this.#pressedAt = null;
    if (pressedAt === null || Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > clickSlopPixels) return;
    const bounds = this.#renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
    this.#raycaster.setFromCamera(pointer, this.#camera);
    const botId = this.#bots.pick(this.#raycaster);
    if (botId !== null) this.#callbacks.onPick(botId);
  };
}
