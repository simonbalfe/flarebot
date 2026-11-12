import { z } from "zod";
import { base64Url, type PushMessage, type PushOutcome } from "./push";

export const pushDeviceSchema = z.object({
  platform: z.enum(["ios", "android"]),
  token: z.string().regex(/^[A-Za-z0-9_:.-]+$/).max(4096),
});

export type PushDevice = z.infer<typeof pushDeviceSchema>;

const appId = "com.flarebot.app";
const apnsHosts = ["https://api.push.apple.com", "https://api.sandbox.push.apple.com"];
const apnsTokenLifetimeMs = 50 * 60 * 1000;
const fcmScope = "https://www.googleapis.com/auth/firebase.messaging";
const googleTokenUrl = "https://oauth2.googleapis.com/token";
const encoder = new TextEncoder();

const serviceAccountSchema = z.object({
  project_id: z.string(),
  client_email: z.string(),
  private_key: z.string(),
});

const googleTokenSchema = z.object({ access_token: z.string(), expires_in: z.number() });
const apnsErrorSchema = z.object({ reason: z.string() });
const fcmErrorSchema = z.object({ error: z.object({ status: z.string().optional(), details: z.array(z.object({ errorCode: z.string().optional() })).optional() }) });

interface CachedToken {
  key: string;
  value: string;
  expiresAt: number;
}

let apnsToken: CachedToken | null = null;
let fcmToken: CachedToken | null = null;

function pemBytes(pem: string): Uint8Array<ArrayBuffer> {
  const binary = atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function unconfigured(platform: PushDevice["platform"]): PushOutcome {
  console.error(JSON.stringify({ event: "push_unconfigured", platform }));
  return "failed";
}

function jsonPart(value: object): string {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

async function signJwt(header: object, claims: object, key: CryptoKey, algorithm: AlgorithmIdentifier | EcdsaParams): Promise<string> {
  const unsigned = `${jsonPart(header)}.${jsonPart(claims)}`;
  const signature = await crypto.subtle.sign(algorithm, key, encoder.encode(unsigned));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

async function apnsAuthorization(keyP8: string, keyId: string, teamId: string): Promise<string> {
  const cacheKey = `${keyId}:${teamId}`;
  if (apnsToken !== null && apnsToken.key === cacheKey && apnsToken.expiresAt > Date.now()) return apnsToken.value;
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(keyP8), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const value = await signJwt({ alg: "ES256", kid: keyId }, { iss: teamId, iat: Math.floor(Date.now() / 1000) }, key, { name: "ECDSA", hash: "SHA-256" });
  apnsToken = { key: cacheKey, value, expiresAt: Date.now() + apnsTokenLifetimeMs };
  return value;
}

async function sendApns(env: Env, token: string, message: PushMessage): Promise<PushOutcome> {
  const { APNS_KEY_P8: keyP8, APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId } = env;
  if (!keyP8 || !keyId || !teamId) return unconfigured("ios");
  const authorization = await apnsAuthorization(keyP8, keyId, teamId);
  const body = JSON.stringify({ aps: { alert: { title: message.title, body: message.body }, sound: "default", "thread-id": message.tag }, url: message.url });
  for (const host of apnsHosts) {
    const response = await fetch(`${host}/3/device/${token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${authorization}`,
        "apns-topic": appId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-collapse-id": message.tag.slice(0, 64),
        "content-type": "application/json",
      },
      body,
    });
    if (response.ok) return "sent";
    if (response.status === 410) return "gone";
    const reason = apnsErrorSchema.safeParse(await response.json().catch(() => null)).data?.reason ?? "";
    if (reason === "BadDeviceToken") continue;
    console.error(JSON.stringify({ event: "push_failed", platform: "ios", status: response.status, reason }));
    return "failed";
  }
  return "gone";
}

async function fcmAccessToken(account: z.infer<typeof serviceAccountSchema>): Promise<string> {
  if (fcmToken !== null && fcmToken.key === account.client_email && fcmToken.expiresAt > Date.now()) return fcmToken.value;
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(account.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt({ alg: "RS256", typ: "JWT" }, { iss: account.client_email, scope: fcmScope, aud: googleTokenUrl, iat: now, exp: now + 3600 }, key, { name: "RSASSA-PKCS1-v1_5" });
  const response = await fetch(googleTokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!response.ok) throw new Error(`Google token request answered ${response.status}`);
  const token = googleTokenSchema.parse(await response.json());
  fcmToken = { key: account.client_email, value: token.access_token, expiresAt: Date.now() + (token.expires_in - 60) * 1000 };
  return token.access_token;
}

async function sendFcm(env: Env, token: string, message: PushMessage): Promise<PushOutcome> {
  if (!env.FCM_SERVICE_ACCOUNT) return unconfigured("android");
  const account = serviceAccountSchema.parse(JSON.parse(env.FCM_SERVICE_ACCOUNT));
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${await fcmAccessToken(account)}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: message.title, body: message.body },
        data: { url: message.url, tag: message.tag },
        android: { priority: "HIGH", notification: { tag: message.tag } },
      },
    }),
  });
  if (response.ok) return "sent";
  const error = fcmErrorSchema.safeParse(await response.json().catch(() => null)).data?.error;
  const codes = [error?.status, ...(error?.details ?? []).map((detail) => detail.errorCode)];
  if (response.status === 404 || codes.includes("UNREGISTERED")) return "gone";
  console.error(JSON.stringify({ event: "push_failed", platform: "android", status: response.status, codes }));
  return "failed";
}

export function sendDevicePush(env: Env, device: PushDevice, message: PushMessage): Promise<PushOutcome> {
  return device.platform === "ios" ? sendApns(env, device.token, message) : sendFcm(env, device.token, message);
}
