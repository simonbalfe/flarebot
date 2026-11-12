import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TorusGeometry,
  Vector3,
} from "three";
import type { Station } from "./activity";

const platformWidth = 12;
const platformDepth = 10;
const cloudCount = 24;
const beltCrateCount = 5;
const beltStart = 1.5;
const beltLength = 9.7;
const beltSpeed = 1.3;

export interface SlotLayout {
  anchor: readonly [number, number];
  step: readonly [number, number];
  row: readonly [number, number];
  perRow: number;
}

export const slotLayouts: Record<Station, SlotLayout> = {
  home: { anchor: [6.5, 6.6], step: [1.1, 0], row: [0, 1.1], perRow: 3 },
  model: { anchor: [3.6, 1.4], step: [0.95, 0], row: [0, 1], perRow: 3 },
  computer: { anchor: [6.9, 3.75], step: [0.95, 0], row: [0, 1.9], perRow: 4 },
  mac: { anchor: [15.1, 5.5], step: [0.85, 0], row: [0, -0.95], perRow: 3 },
  artifacts: { anchor: [3.7, 5.7], step: [0, 0.95], row: [0.9, 0], perRow: 3 },
  toolbox: { anchor: [11.1, 9.3], step: [-0.95, 0], row: [-2.85, 0], perRow: 3 },
  mcp: { anchor: [11.2, 1.8], step: [0, 0.85], row: [-0.9, 0], perRow: 3 },
  you: { anchor: [5.2, 8.95], step: [-0.95, 0], row: [0, -0.95], perRow: 3 },
};

export const stationTags: { key: Station; label: string; position: Vector3 }[] = [
  { key: "model", label: "Model", position: floor(1.6, 1.6, 5.9) },
  { key: "computer", label: "Computer", position: floor(8.3, 1.9, 3.0) },
  { key: "artifacts", label: "Artifacts", position: floor(1.6, 6.3, 2.6) },
  { key: "toolbox", label: "Toolbox", position: floor(10.7, 7.5, 2.7) },
  { key: "mcp", label: "MCP", position: floor(11.2, 0.8, 3.6) },
  { key: "mac", label: "Mac", position: floor(16.45, 4.3, 1.4) },
  { key: "you", label: "You", position: floor(5.2, 9.9, 0.1) },
];

export interface WorldState {
  occupied: ReadonlySet<Station>;
  working: number;
  alert: boolean;
  motion: boolean;
}

export interface World {
  group: Group;
  background: Texture;
  textures: Texture[];
  update: (time: number, delta: number, state: WorldState) => void;
}

function floor(x: number, y: number, height = 0): Vector3 {
  return new Vector3(x - platformWidth / 2, height, y - platformDepth / 2);
}

export function slotPosition(station: Station, slot: number): Vector3 {
  const layout = slotLayouts[station];
  const column = slot % layout.perRow;
  const row = Math.floor(slot / layout.perRow);
  return floor(layout.anchor[0] + layout.step[0] * column + layout.row[0] * row, layout.anchor[1] + layout.step[1] * column + layout.row[1] * row);
}

function paint(color: number, emissive = 0x000000, emissiveIntensity = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, emissive, emissiveIntensity });
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("2D canvas is unavailable");
  draw(context);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

function skyTexture(): CanvasTexture {
  return canvasTexture(512, 512, (context) => {
    const sky = context.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, "#ec5f0c");
    sky.addColorStop(0.32, "#f6821f");
    sky.addColorStop(0.62, "#fbad41");
    sky.addColorStop(0.86, "#ffd9a0");
    sky.addColorStop(1, "#fff1dc");
    context.fillStyle = sky;
    context.fillRect(0, 0, 512, 512);
    const sun = context.createRadialGradient(256, 130, 0, 256, 130, 260);
    sun.addColorStop(0, "rgba(255, 255, 255, 0.9)");
    sun.addColorStop(0.3, "rgba(255, 241, 207, 0.5)");
    sun.addColorStop(1, "rgba(255, 224, 168, 0)");
    context.fillStyle = sun;
    context.fillRect(0, 0, 512, 512);
  });
}

function terminalTexture(): CanvasTexture {
  return canvasTexture(256, 200, (context) => {
    context.fillStyle = "#2a170a";
    context.fillRect(0, 0, 256, 200);
    const lines: [number, string][] = [
      [150, "#fbad41"],
      [96, "#7be0c3"],
      [190, "#ffffff"],
      [70, "#7be0c3"],
      [130, "#fbad41"],
      [44, "#ffffff"],
    ];
    lines.forEach(([width, color], index) => {
      context.fillStyle = color;
      context.fillRect(22, 26 + index * 27, width, 9);
    });
  });
}

export function createWorld(toolColors: readonly string[]): World {
  const group = new Group();
  const box = new BoxGeometry(1, 1, 1);
  const sphere = new SphereGeometry(1, 20, 14);

  const cream = paint(0xfff6ea);
  const white = paint(0xffffff);
  const side = paint(0xf08a2e);
  const orange = paint(0xf6821f);
  const amber = paint(0xfbad41);
  const dark = paint(0x4a3220);
  const silver = paint(0xd1d1d6);
  const recess = paint(0xd9c3a8);
  const tower = paint(0xf6821f, 0xf6821f, 0.3);
  const glow = paint(0xfff1cf, 0xffc27a, 0.9);
  const slabFaces = [side, side, cream, side, side, side];

  const slab = (parent: Object3D, material: Material | Material[], x: number, y: number, z: number, width: number, depth: number, height: number): Mesh => {
    const mesh = new Mesh(box, material);
    mesh.scale.set(width, height, depth);
    mesh.position.copy(floor(x + width / 2, y + depth / 2, z + height / 2));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  const ring = (radius: number, tube: number, material: Material, position: Vector3): Mesh => {
    const mesh = new Mesh(new TorusGeometry(radius, tube, 10, 56), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.copy(position);
    group.add(mesh);
    return mesh;
  };

  slab(group, slabFaces, 0, 0, -1, platformWidth, platformDepth, 1).castShadow = false;
  slab(group, glow, -0.03, -0.03, -0.62, platformWidth + 0.06, platformDepth + 0.06, 0.16).castShadow = false;

  const gridPoints: number[] = [];
  for (let x = 1; x < platformWidth; x++) gridPoints.push(...floor(x, 0, 0.006).toArray(), ...floor(x, platformDepth, 0.006).toArray());
  for (let y = 1; y < platformDepth; y++) gridPoints.push(...floor(0, y, 0.006).toArray(), ...floor(platformWidth, y, 0.006).toArray());
  const gridGeometry = new BufferGeometry();
  gridGeometry.setAttribute("position", new Float32BufferAttribute(gridPoints, 3));
  group.add(new LineSegments(gridGeometry, new LineBasicMaterial({ color: 0xf6821f, transparent: true, opacity: 0.16 })));

  slab(group, dark, 1.4, 4.5, 0, 9.9, 0.6, 0.05);
  slab(group, dark, 4.9, 5.1, 0, 0.6, 3.0, 0.05);
  slab(group, amber, 1.4, 4.46, 0, 9.9, 0.04, 0.1);
  slab(group, amber, 1.4, 5.1, 0, 3.5, 0.04, 0.1);
  slab(group, amber, 5.5, 5.1, 0, 5.8, 0.04, 0.1);
  const crates = Array.from({ length: beltCrateCount }, (_, index) => slab(group, index % 2 === 0 ? white : amber, 0, 0, 0, 0.38, 0.38, 0.3));
  slab(group, white, 4.99, 6.4, 0.05, 0.38, 0.38, 0.3);

  slab(group, white, 0.5, 0.5, 0, 2.2, 2.2, 0.4);
  slab(group, tower, 0.9, 0.9, 0.4, 1.4, 1.4, 3.6);
  for (const level of [1.0, 1.7, 2.4, 3.1]) slab(group, glow, 0.88, 0.88, level, 1.44, 1.44, 0.3);
  slab(group, white, 0.7, 0.7, 4.0, 1.8, 1.8, 0.3);
  const haloHeight = 5.0;
  const halo = ring(1.15, 0.07, new MeshBasicMaterial({ color: 0xffffff }), floor(1.6, 1.6, haloHeight));

  const mast = new Mesh(new CylinderGeometry(0.09, 0.09, 2.6, 12), dark);
  mast.position.copy(floor(11.2, 0.8, 1.3));
  mast.castShadow = true;
  group.add(mast);
  const orb = new Mesh(sphere, new MeshBasicMaterial({ color: 0xf6821f }));
  orb.scale.setScalar(0.2);
  orb.position.copy(floor(11.2, 0.8, 2.75));
  group.add(orb);
  const signals = [0.45, 0.8].map((radius) => {
    const material = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    return { material, mesh: ring(radius, 0.025, material, floor(11.2, 0.8, 2.75)) };
  });

  slab(group, dark, 6.3, 0.7, 0, 4.0, 2.4, 0.3);
  slab(group, white, 6.5, 0.9, 0.3, 3.6, 2, 2.2);
  for (const level of [1.2, 1.5, 1.8]) slab(group, recess, 6.8, 2.9, level, 1.0, 0.02, 0.1);
  slab(group, amber, 10.1, 1.3, 0.3, 0.02, 1.2, 1.6);
  slab(group, orange, 9.2, 1.1, 2.5, 0.5, 0.5, 1.0);
  const terminal = terminalTexture();
  const screen = new Mesh(new PlaneGeometry(1.7, 1.35), new MeshBasicMaterial({ map: terminal }));
  screen.position.copy(floor(8.95, 2.915, 1.525));
  group.add(screen);
  const puffs = [0, 1, 2].map(() => {
    const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffe2c0, emissiveIntensity: 0.35, transparent: true });
    const mesh = new Mesh(sphere, material);
    mesh.visible = false;
    group.add(mesh);
    return { material, mesh };
  });

  slab(group, dark, 0.7, 5.3, 0, 2.4, 2.8, 0.2);
  slab(group, amber, 0.9, 5.5, 0.2, 1.2, 1.2, 1.1);
  slab(group, white, 1.0, 5.6, 1.3, 0.9, 0.9, 0.7);
  slab(group, white, 2.1, 5.9, 0.2, 0.8, 0.8, 0.7);
  slab(group, amber, 1.0, 6.8, 0.2, 1.1, 1.1, 0.9);

  slab(group, white, 9.8, 6.4, 0, 1.8, 2.2, 2.2);
  [0.3, 0.95, 1.6].forEach((level, row) => {
    slab(group, recess, 9.95, 8.6, level, 1.5, 0.02, 0.48);
    for (let cell = 0; cell < 4; cell++) {
      const color = toolColors[(row * 2 + cell) % toolColors.length] ?? "#f6821f";
      slab(group, new MeshStandardMaterial({ color, roughness: 0.85 }), 10.03 + cell * 0.36, 8.6, level + 0.04, 0.26, 0.08, 0.32);
    }
  });

  slab(group, white, 11.3, 4.0, 0, 0.5, 0.35, 2.4);
  slab(group, white, 11.3, 5.3, 0, 0.5, 0.35, 2.4);
  slab(group, orange, 11.2, 3.9, 2.4, 0.7, 1.85, 0.35);
  const portalMaterial = new MeshBasicMaterial({ color: 0xfff1cf, transparent: true, opacity: 0.4, side: DoubleSide, depthWrite: false });
  const portal = new Mesh(new PlaneGeometry(0.95, 2.4), portalMaterial);
  portal.rotation.y = Math.PI / 2;
  portal.position.copy(floor(11.55, 4.825, 1.2));
  group.add(portal);
  const bridge = slab(group, new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2b8, emissiveIntensity: 0.6, transparent: true, opacity: 0.75 }), 11.8, 4.4, -0.05, 2.7, 0.8, 0.06);
  bridge.castShadow = false;

  slab(group, slabFaces, 14.5, 3.6, -0.5, 2.6, 2.6, 0.5).castShadow = false;
  slab(group, silver, 15.9, 4.0, 0, 1.1, 0.8, 0.06);
  slab(group, silver, 15.9, 4.0, 0.06, 1.1, 0.05, 0.75);
  const macScreen = new Mesh(new PlaneGeometry(1.0, 0.63), new MeshBasicMaterial({ color: 0x2a170a }));
  macScreen.position.copy(floor(16.45, 4.06, 0.435));
  group.add(macScreen);

  const pad = new Mesh(new CylinderGeometry(1, 1, 0.06, 48), white);
  pad.position.copy(floor(5.2, 8.95, 0.03));
  pad.receiveShadow = true;
  group.add(pad);
  const padCore = new Mesh(new CylinderGeometry(0.6, 0.6, 0.07, 40), new MeshStandardMaterial({ color: 0xfbad41, roughness: 0.85, transparent: true, opacity: 0.45 }));
  padCore.position.copy(floor(5.2, 8.95, 0.035));
  group.add(padCore);
  ring(1.0, 0.05, orange, floor(5.2, 8.95, 0.07));
  const alertMaterial = new MeshBasicMaterial({ color: 0xff3b30, transparent: true });
  const alertRing = ring(1.2, 0.045, alertMaterial, floor(5.2, 8.95, 0.09));
  alertRing.visible = false;

  const cloudMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffe2c0, emissiveIntensity: 0.35 });
  const blobs: [number, number, number, number][] = [
    [0, 0, 0, 1.3],
    [-1.5, -0.3, 0.2, 0.9],
    [1.5, -0.25, -0.1, 1.0],
    [-2.6, -0.7, 0, 0.6],
    [2.7, -0.65, 0.1, 0.65],
    [0.6, 0.7, -0.2, 0.8],
    [-0.7, 0.4, 0.3, 0.75],
    [0.2, -0.2, 0.9, 0.9],
    [-0.4, -0.3, -0.9, 0.85],
  ];
  const random = seededRandom(7);
  const drifting: { cloud: Group; base: Vector3; phase: number }[] = [];
  const cloud = (position: Vector3, scale: number): void => {
    const puffGroup = new Group();
    for (const [x, y, z, radius] of blobs) {
      const blob = new Mesh(sphere, cloudMaterial);
      blob.position.set(x, y, z);
      blob.scale.setScalar(radius);
      puffGroup.add(blob);
    }
    puffGroup.position.copy(position);
    puffGroup.scale.set(scale, scale * 0.75, scale);
    puffGroup.rotation.y = random() * Math.PI;
    group.add(puffGroup);
    drifting.push({ cloud: puffGroup, base: position.clone(), phase: random() * Math.PI * 2 });
  };
  for (let index = 0; index < cloudCount; index++) {
    const angle = (index / cloudCount) * Math.PI * 2 + random() * 0.2;
    const radius = 15 + random() * 20;
    const ceiling = Math.min(5, radius * 0.45 - 6.5);
    cloud(new Vector3(Math.cos(angle) * radius, -9 + random() * (ceiling + 9), Math.sin(angle) * radius), 0.8 + random() * 1.4);
  }
  for (let index = 0; index < 8; index++) {
    const angle = (index / 8) * Math.PI * 2 + random() * 0.4;
    const radius = 4 + random() * 4.5;
    cloud(new Vector3(Math.cos(angle) * radius, -3.6 - random() * 1.2, Math.sin(angle) * radius * 0.85), 1.3 + random() * 0.5);
  }
  cloud(floor(15.8, 4.9, -2.9), 0.85);

  const haze = paint(0xfccb93);
  const island = (center: Vector3): void => {
    const far = new Group();
    slab(far, haze, 0, 0, -1, platformWidth, platformDepth, 1);
    slab(far, haze, 2, 2, 0, 2, 2, 4);
    slab(far, haze, 7, 3, 0, 3, 3, 2);
    far.traverse((child) => {
      child.castShadow = false;
      child.receiveShadow = false;
    });
    far.position.copy(center);
    far.scale.setScalar(0.45);
    group.add(far);
  };
  island(new Vector3(-30, 1, -14));
  island(new Vector3(-12, 5, -36));
  island(new Vector3(26, -6, -30));
  island(new Vector3(-34, -8, 22));

  let beltPhase = 0;
  let beltPace = 0;

  const update = (time: number, delta: number, state: WorldState): void => {
    const pulse = (time * 0.8) % 1;

    halo.position.y = haloHeight + (state.motion ? Math.sin(time * 1.5) * 0.12 : 0);
    halo.scale.setScalar(state.motion && state.occupied.has("model") ? 1 + Math.sin(time * 6) * 0.06 : 1);

    signals.forEach((signal, index) => {
      const active = state.motion && state.occupied.has("mcp");
      const spread = (pulse + index * 0.5) % 1;
      signal.mesh.scale.setScalar(active ? 1 + spread * 0.9 : 1);
      signal.material.opacity = active ? 1 - spread : 0.85;
    });

    const steaming = state.motion && state.occupied.has("computer");
    puffs.forEach((puff, index) => {
      puff.mesh.visible = steaming;
      if (!steaming) return;
      const rise = (time * 0.35 + index / puffs.length) % 1;
      puff.mesh.position.copy(floor(9.45 + rise * 0.5, 1.35, 3.6 + rise * 2.2));
      puff.mesh.scale.setScalar(0.15 + rise * 0.32);
      puff.material.opacity = 0.9 * (1 - rise);
    });

    portalMaterial.opacity = state.motion && state.occupied.has("mac") ? 0.45 + Math.sin(time * 5) * 0.25 : 0.4;

    alertRing.visible = state.alert;
    alertRing.scale.setScalar(state.motion ? 1 + pulse * 0.3 : 1);
    alertMaterial.opacity = state.motion ? 1 - pulse : 1;

    const targetPace = state.motion && state.working > 0 ? beltSpeed : 0;
    beltPace += (targetPace - beltPace) * Math.min(1, delta * 3);
    beltPhase = (beltPhase + (beltPace * delta) / beltLength) % 1;
    crates.forEach((crate, index) => {
      const travelled = (beltPhase + index / crates.length) % 1;
      const fade = Math.max(0.001, Math.min(1, travelled * 12, (1 - travelled) * 12));
      crate.position.copy(floor(beltStart + travelled * beltLength, 4.8, 0.05 + 0.15 * fade));
      crate.scale.set(0.38 * fade, 0.3 * fade, 0.38 * fade);
    });

    if (state.motion) for (const { cloud: drifter, base, phase } of drifting) drifter.position.x = base.x + Math.sin(time * 0.07 + phase) * 1.4;
  };

  return { group, background: skyTexture(), textures: [terminal], update };
}
