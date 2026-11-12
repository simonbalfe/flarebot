import type { CapacitorConfig } from "@capacitor/cli";

const appUrl = process.env.FLAREBOT_APP_URL;

const config: CapacitorConfig = {
  appId: "com.flarebot.app",
  appName: "Flarebot",
  webDir: "dist/client",
  ...(appUrl ? { server: { url: appUrl } } : {}),
  plugins: {
    PushNotifications: {
      presentationOptions: ["badge", "sound", "banner", "list"],
    },
  },
};

export default config;
