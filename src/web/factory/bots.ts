import { CapsuleGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Object3D, type Raycaster, SphereGeometry, Vector3 } from "three";
import type { Station } from "./activity";
import { slotPosition } from "./world";

const botScale = 1.25;
const flightSpeed = 6;
const minFlightSeconds = 0.5;
const maxFlightSeconds = 1.6;
const labelHeight = 1.8;
const packetSeconds = 1.4;
const restingTurn = Math.PI / 4;

export interface BotState {
  id: string;
  main: string;
  accent: string;
  station: Station;
  alert: boolean;
  working: boolean;
}

interface Flight {
  from: Vector3;
  to: Vector3;
  startedAt: number;
  duration: number;
  height: number;
}

interface Actor {
  root: Group;
  body: Group;
  beacon: Mesh;
  paints: MeshStandardMaterial[];
  station: Station;
  slot: number;
  phase: number;
  working: boolean;
  alert: boolean;
  flight: Flight | null;
}

interface Packet {
  mesh: Mesh;
  from: Vector3;
  to: Vector3;
  startedAt: number;
}

function easeInOut(progress: number): number {
  return progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
}

export class Bots {
  readonly group = new Group();
  #actors = new Map<string, Actor>();
  #packets: Packet[] = [];
  #motion: boolean;
  #sphere = new SphereGeometry(1, 20, 14);
  #torso = new CapsuleGeometry(0.2, 0.22, 6, 14);
  #stripe = new CylinderGeometry(0.206, 0.206, 0.07, 20);
  #leg = new CylinderGeometry(0.05, 0.05, 0.16, 8);
  #shell = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
  #ink = new MeshStandardMaterial({ color: 0x3b2412, roughness: 0.9 });
  #eye = new MeshBasicMaterial({ color: 0xffffff });
  #beacon = new MeshBasicMaterial({ color: 0xff3b30 });
  #packet = new MeshBasicMaterial({ color: 0xfff1cf });

  constructor(motion: boolean) {
    this.#motion = motion;
  }

  set(states: BotState[], now: number): void {
    const ids = new Set(states.map((state) => state.id));
    for (const [id, actor] of this.#actors) {
      if (ids.has(id)) continue;
      this.group.remove(actor.root);
      for (const paint of actor.paints) paint.dispose();
      this.#actors.delete(id);
    }
    for (const state of states) {
      const actor = this.#actors.get(state.id);
      if (actor === undefined) {
        this.#spawn(state);
        continue;
      }
      actor.working = state.working;
      actor.alert = state.alert;
      if (actor.station !== state.station) this.#move(actor, state.station, now);
    }
  }

  send(fromId: string, toId: string, now: number): void {
    const from = this.#actors.get(fromId);
    const to = this.#actors.get(toId);
    if (!this.#motion || from === undefined || to === undefined) return;
    const mesh = new Mesh(this.#sphere, this.#packet);
    mesh.scale.setScalar(0.16);
    this.group.add(mesh);
    this.#packets.push({ mesh, from: this.#headOf(from), to: this.#headOf(to), startedAt: now });
  }

  update(now: number): void {
    for (const actor of this.#actors.values()) {
      this.#fly(actor, now);
      const pace = actor.working ? 7 : 1.6;
      const lift = actor.working ? 0.05 : 0.03;
      actor.body.position.y = this.#motion && actor.flight === null ? Math.sin(now * pace + actor.phase) * lift + lift : 0;
      actor.beacon.visible = actor.alert;
      actor.beacon.scale.setScalar(this.#motion ? 0.09 + Math.abs(Math.sin(now * 4)) * 0.05 : 0.11);
    }
    this.#packets = this.#packets.filter((packet) => {
      const progress = (now - packet.startedAt) / packetSeconds;
      if (progress >= 1) {
        this.group.remove(packet.mesh);
        return false;
      }
      packet.mesh.position.lerpVectors(packet.from, packet.to, easeInOut(progress));
      packet.mesh.position.y += Math.sin(progress * Math.PI) * 2.2;
      return true;
    });
  }

  labelAnchor(id: string, target: Vector3): boolean {
    const actor = this.#actors.get(id);
    if (actor === undefined) return false;
    target.copy(actor.root.position);
    target.y += labelHeight;
    return true;
  }

  occupied(): Set<Station> {
    return new Set([...this.#actors.values()].filter((actor) => actor.flight === null).map((actor) => actor.station));
  }

  pick(raycaster: Raycaster): string | null {
    let hit: Object3D | null = raycaster.intersectObjects([...this.#actors.values()].map((actor) => actor.root), true)[0]?.object ?? null;
    while (hit !== null) {
      for (const [id, actor] of this.#actors) if (actor.root === hit) return id;
      hit = hit.parent;
    }
    return null;
  }

  #spawn(state: BotState): void {
    const root = new Group();
    const body = new Group();
    body.scale.setScalar(botScale);
    root.add(body);
    const mainPaint = new MeshStandardMaterial({ color: state.main, roughness: 0.6 });
    const accentPaint = new MeshStandardMaterial({ color: state.accent, roughness: 0.6 });

    const part = (geometry: Mesh["geometry"], material: Mesh["material"], position: [number, number, number], scale: [number, number, number] = [1, 1, 1]): Mesh => {
      const mesh = new Mesh(geometry, material);
      mesh.position.set(...position);
      mesh.scale.set(...scale);
      mesh.castShadow = true;
      body.add(mesh);
      return mesh;
    };
    part(this.#leg, this.#ink, [-0.08, 0.08, 0]);
    part(this.#leg, this.#ink, [0.08, 0.08, 0]);
    part(this.#torso, this.#shell, [0, 0.44, 0]);
    part(this.#stripe, mainPaint, [0, 0.44, 0]);
    part(this.#sphere, mainPaint, [0.04, 0.74, 0], [0.34, 0.14, 0.2]);
    part(this.#sphere, mainPaint, [-0.13, 0.8, 0], [0.19, 0.19, 0.19]);
    part(this.#sphere, mainPaint, [0.04, 0.88, 0], [0.26, 0.26, 0.24]);
    part(this.#sphere, accentPaint, [0.27, 0.79, 0], [0.16, 0.16, 0.16]);
    part(this.#sphere, this.#eye, [-0.04, 0.84, 0.2], [0.045, 0.045, 0.045]).castShadow = false;
    part(this.#sphere, this.#eye, [0.12, 0.84, 0.22], [0.045, 0.045, 0.045]).castShadow = false;
    const beacon = part(this.#sphere, this.#beacon, [0.04, 1.3, 0]);
    beacon.castShadow = false;
    beacon.visible = false;

    const slot = this.#freeSlot(state.station);
    root.position.copy(slotPosition(state.station, slot));
    root.rotation.y = restingTurn;
    this.group.add(root);
    this.#actors.set(state.id, { root, body, beacon, paints: [mainPaint, accentPaint], station: state.station, slot, phase: this.#actors.size * 1.7, working: state.working, alert: state.alert, flight: null });
  }

  #move(actor: Actor, station: Station, now: number): void {
    actor.slot = this.#freeSlot(station);
    actor.station = station;
    const to = slotPosition(station, actor.slot);
    if (!this.#motion) {
      actor.root.position.copy(to);
      return;
    }
    const from = actor.root.position.clone();
    const distance = from.distanceTo(to);
    actor.flight = {
      from,
      to,
      startedAt: now,
      duration: Math.min(maxFlightSeconds, Math.max(minFlightSeconds, distance / flightSpeed)),
      height: Math.min(3.2, Math.max(0.8, distance * 0.35)),
    };
    actor.root.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
  }

  #fly(actor: Actor, now: number): void {
    const flight = actor.flight;
    if (flight === null) return;
    const progress = (now - flight.startedAt) / flight.duration;
    if (progress >= 1) {
      actor.root.position.copy(flight.to);
      actor.root.rotation.y = restingTurn;
      actor.flight = null;
      return;
    }
    actor.root.position.lerpVectors(flight.from, flight.to, easeInOut(progress));
    actor.root.position.y += Math.sin(progress * Math.PI) * flight.height;
  }

  #freeSlot(station: Station): number {
    const taken = new Set([...this.#actors.values()].filter((actor) => actor.station === station).map((actor) => actor.slot));
    let slot = 0;
    while (taken.has(slot)) slot++;
    return slot;
  }

  #headOf(actor: Actor): Vector3 {
    return actor.root.position.clone().setY(actor.root.position.y + 1.2);
  }
}
