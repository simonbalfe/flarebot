import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { PushNotifications } from "@capacitor/push-notifications";
import { api } from "./api";

type NativePlatform = "ios" | "android";

const tokenStorageKey = "flarebot.pushToken";
const registrationTimeoutMs = 20_000;

function nativePlatform(): NativePlatform | null {
  const platform = Capacitor.getPlatform();
  return Capacitor.isNativePlatform() && (platform === "ios" || platform === "android") ? platform : null;
}

function webPushSupported(): boolean {
  return import.meta.env.PROD && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function pushSupported(): boolean {
  return nativePlatform() !== null || webPushSupported();
}

function storedToken(): string | null {
  try {
    return localStorage.getItem(tokenStorageKey);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(tokenStorageKey);
    else localStorage.setItem(tokenStorageKey, token);
  } catch {
    return;
  }
}

function keyBytes(publicKey: string): Uint8Array<ArrayBuffer> {
  const binary = atob(publicKey.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function currentWebSubscription(): Promise<PushSubscription | null> {
  if (!webPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

async function nextToken(): Promise<string> {
  const handles: Promise<PluginListenerHandle>[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Push registration timed out")), registrationTimeoutMs);
      handles.push(PushNotifications.addListener("registration", (token) => resolve(token.value)));
      handles.push(PushNotifications.addListener("registrationError", (error) => reject(new Error(error.error))));
      PushNotifications.register().catch(reject);
    });
  } finally {
    clearTimeout(timer);
    for (const handle of handles) void handle.then((listener) => listener.remove());
  }
}

async function registerDevice(platform: NativePlatform): Promise<void> {
  const token = await nextToken();
  const previous = storedToken();
  if (previous !== null && previous !== token) await api.removePushDevice(previous);
  await api.addPushDevice({ platform, token });
  storeToken(token);
}

export async function restorePush(): Promise<boolean> {
  const platform = nativePlatform();
  if (platform === null) {
    const subscription = await currentWebSubscription();
    return subscription !== null && Notification.permission === "granted";
  }
  if (storedToken() === null || (await PushNotifications.checkPermissions()).receive !== "granted") return false;
  await registerDevice(platform);
  return true;
}

export async function enablePush(): Promise<boolean> {
  const platform = nativePlatform();
  if (platform !== null) {
    if ((await PushNotifications.requestPermissions()).receive !== "granted") return false;
    await registerDevice(platform);
    return true;
  }
  if ((await Notification.requestPermission()) !== "granted") return false;
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushKey();
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api.addPushSubscription(subscription.toJSON());
  return true;
}

export async function disablePush(): Promise<void> {
  if (nativePlatform() !== null) {
    const token = storedToken();
    if (token !== null) await api.removePushDevice(token);
    storeToken(null);
    await PushNotifications.unregister();
    return;
  }
  const subscription = await currentWebSubscription();
  if (subscription === null) return;
  await api.removePushSubscription(subscription.endpoint);
  await subscription.unsubscribe();
}

export function onNotificationOpen(open: (url: URL) => void): () => void {
  if (nativePlatform() !== null) {
    const handle = PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const data: unknown = action.notification.data;
      if (typeof data !== "object" || data === null || !("url" in data) || typeof data.url !== "string") return;
      open(new URL(data.url, window.location.origin));
    });
    return () => void handle.then((listener) => listener.remove());
  }
  if (!("serviceWorker" in navigator)) return () => undefined;
  const listener = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (typeof data !== "object" || data === null || !("type" in data) || data.type !== "flarebot-open" || !("url" in data) || typeof data.url !== "string") return;
    open(new URL(data.url, window.location.origin));
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}
