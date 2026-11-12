import { z } from "zod";

export const pushSubscriptionSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]+=*$/).max(200),
    auth: z.string().regex(/^[A-Za-z0-9_-]+=*$/).max(100),
  }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export interface VapidKeys {
  publicKey: string;
  privateJwk: JsonWebKey;
}

export interface PushMessage {
  title: string;
  body: string;
  tag: string;
  url: string;
}

export type PushOutcome = "sent" | "gone" | "failed";

const encoder = new TextEncoder();
const recordSize = 4096;
const ttlSeconds = 24 * 60 * 60;
const jwtLifetimeSeconds = 12 * 60 * 60;
const maxBodyChars = 180;

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/").replace(/=+$/, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, data));
}

export async function createVapidKeys(): Promise<VapidKeys> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicRaw = await crypto.subtle.exportKey("raw", pair.publicKey);
  if (!(publicRaw instanceof ArrayBuffer)) throw new Error("Unexpected public key format");
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (privateJwk instanceof ArrayBuffer) throw new Error("Unexpected private key format");
  return { publicKey: base64Url(new Uint8Array(publicRaw)), privateJwk };
}

async function vapidAuthorization(keys: VapidKeys, endpoint: string, subject: string): Promise<string> {
  const header = base64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = base64Url(encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + jwtLifetimeSeconds, sub: subject })));
  const signingKey = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, encoder.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${base64Url(new Uint8Array(signature))}, k=${keys.publicKey}`;
}

async function encryptPayload(subscription: PushSubscriptionInput, payload: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const clientPublic = fromBase64Url(subscription.keys.p256dh);
  const authSecret = fromBase64Url(subscription.keys.auth);
  const clientKey = await crypto.subtle.importKey("raw", clientPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localRaw = await crypto.subtle.exportKey("raw", local.publicKey);
  if (!(localRaw instanceof ArrayBuffer)) throw new Error("Unexpected public key format");
  const localPublic = new Uint8Array(localRaw);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientKey }, local.privateKey, 256));

  const keyPrk = await hmac(authSecret, sharedSecret);
  const inputKey = await hmac(keyPrk, concat(encoder.encode("WebPush: info\0"), clientPublic, localPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, inputKey);
  const contentKey = (await hmac(prk, concat(encoder.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(encoder.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const aesKey = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  const cipherText = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, concat(payload, new Uint8Array([2]))));
  const recordHeader = new Uint8Array(21);
  recordHeader.set(salt, 0);
  new DataView(recordHeader.buffer).setUint32(16, recordSize);
  recordHeader[20] = localPublic.length;
  return concat(recordHeader, localPublic, cipherText);
}

export function pushBody(text: string): string {
  const flat = text.replaceAll("**", "").replace(/\s+/g, " ").trim();
  return flat.length > maxBodyChars ? `${flat.slice(0, maxBodyChars - 1)}…` : flat;
}

export async function sendPush(keys: VapidKeys, subject: string, subscription: PushSubscriptionInput, message: PushMessage): Promise<PushOutcome> {
  const body = await encryptPayload(subscription, encoder.encode(JSON.stringify(message)));
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidAuthorization(keys, subscription.endpoint, subject),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(ttlSeconds),
      urgency: "normal",
      topic: message.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32),
    },
    body,
  });
  if (response.ok) return "sent";
  if (response.status === 404 || response.status === 410) return "gone";
  console.error(JSON.stringify({ event: "push_failed", status: response.status, host: new URL(subscription.endpoint).host, error: (await response.text()).slice(0, 200) }));
  return "failed";
}
