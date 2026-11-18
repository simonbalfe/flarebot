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

export function pushSupported(): boolean {
  return nativePlatform() !== null;
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
  if (platform === null) return false;
  if (storedToken() === null || (await PushNotifications.checkPermissions()).receive !== "granted") return false;
  await registerDevice(platform);
  return true;
}

export async function enablePush(): Promise<boolean> {
  const platform = nativePlatform();
  if (platform === null) return false;
  if ((await PushNotifications.requestPermissions()).receive !== "granted") return false;
  await registerDevice(platform);
  return true;
}

export async function disablePush(): Promise<void> {
  if (nativePlatform() === null) return;
  const token = storedToken();
  if (token !== null) await api.removePushDevice(token);
  storeToken(null);
  await PushNotifications.unregister();
}

export function onNotificationOpen(open: (url: URL) => void): () => void {
  if (nativePlatform() === null) return () => undefined;
  const handle = PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const data: unknown = action.notification.data;
    if (typeof data !== "object" || data === null || !("url" in data) || typeof data.url !== "string") return;
    open(new URL(data.url, window.location.origin));
  });
  return () => void handle.then((listener) => listener.remove());
}
