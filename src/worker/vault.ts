export interface SealedSecret {
  name: string;
  botIds: string[];
  createdAt: number;
  iv: string;
  data: string;
}

export interface SecretSummary {
  name: string;
  botIds: string[];
  createdAt: number;
}

const localDevSecret = "flarebot-local-dev-vault";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function bytesOf(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function vaultKey(env: Env): Promise<CryptoKey> {
  const root = env.BETTER_AUTH_SECRET || (env.FLAREBOT_LOCAL_DEV === "1" ? localDevSecret : "");
  if (root === "") throw new Error("The vault has no key");
  const material = await crypto.subtle.importKey("raw", encoder.encode(root), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: encoder.encode("flarebot-vault"), info: encoder.encode("aes-256-gcm v1") }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function seal(env: Env, name: string, value: string): Promise<Pick<SealedSecret, "iv" | "data">> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(name) }, await vaultKey(env), encoder.encode(value));
  return { iv: base64(iv), data: base64(new Uint8Array(data)) };
}

export async function unseal(env: Env, secret: SealedSecret): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytesOf(secret.iv), additionalData: encoder.encode(secret.name) }, await vaultKey(env), bytesOf(secret.data));
  return decoder.decode(plain);
}

export function secretSummary(secret: SealedSecret): SecretSummary {
  return { name: secret.name, botIds: secret.botIds, createdAt: secret.createdAt };
}
