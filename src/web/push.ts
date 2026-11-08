import { api } from "./api";

export function pushSupported(): boolean {
  return import.meta.env.PROD && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function keyBytes(publicKey: string): Uint8Array<ArrayBuffer> {
  const binary = atob(publicKey.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function enablePush(): Promise<boolean> {
  if ((await Notification.requestPermission()) !== "granted") return false;
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushKey();
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api.addPushSubscription(subscription.toJSON());
  return true;
}

export async function disablePush(): Promise<void> {
  const subscription = await currentPushSubscription();
  if (subscription === null) return;
  await api.removePushSubscription(subscription.endpoint);
  await subscription.unsubscribe();
}

export function onNotificationOpen(open: (url: URL) => void): () => void {
  if (!("serviceWorker" in navigator)) return () => undefined;
  const listener = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (typeof data !== "object" || data === null || !("type" in data) || data.type !== "flarebot-open" || !("url" in data) || typeof data.url !== "string") return;
    open(new URL(data.url, window.location.origin));
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}
