import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { renderSignInEmail } from "./emails";
import type { AppEnv } from "./env";

const codeLifetimeSeconds = 10 * 60;
const sessionLifetimeSeconds = 30 * 24 * 60 * 60;

function isAllowed(env: Env, email: string): boolean {
  const allowed = (env.FLAREBOT_ALLOWED_EMAILS ?? "").split(",").map((address) => address.trim().toLowerCase());
  return allowed.includes(email.trim().toLowerCase());
}

export function createAuth(env: Env) {
  return betterAuth({
    baseURL: env.FLAREBOT_APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: env.AUTH_DB,
    telemetry: { enabled: false },
    rateLimit: { enabled: true, storage: "database" },
    session: { expiresIn: sessionLifetimeSeconds },
    advanced: { ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!isAllowed(env, user.email)) return false;
            return { data: user };
          },
        },
      },
    },
    plugins: [
      emailOTP({
        expiresIn: codeLifetimeSeconds,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp, type }) => {
          if (type !== "sign-in" || !isAllowed(env, email)) return;
          await env.EMAIL.send({
            to: email,
            from: { email: env.FLAREBOT_MAIL_FROM, name: "flarebot" },
            subject: `${otp} is your flarebot code`,
            ...(await renderSignInEmail({ code: otp, logoUrl: `${env.FLAREBOT_APP_URL}/flare-logo.png`, expiresInMinutes: codeLifetimeSeconds / 60 })),
          });
        },
      }),
    ],
  });
}

async function holdsApiKey(env: Env, authorization: string | undefined): Promise<boolean> {
  const expected = env.FLAREBOT_API_KEY ?? "";
  const given = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
  if (expected === "" || given === "") return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([crypto.subtle.digest("SHA-256", encoder.encode(given)), crypto.subtle.digest("SHA-256", encoder.encode(expected))]);
  const expectedDigest = new Uint8Array(right);
  return new Uint8Array(left).reduce((difference, byte, index) => difference | (byte ^ (expectedDigest[index] ?? 0)), 0) === 0;
}

export const requireApp = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get("apiKey") === true) throw new HTTPException(403, { message: "This action is only available in the app" });
  await next();
});

export const requireSession = createMiddleware<AppEnv>(async (c, next) => {
  if (await holdsApiKey(c.env, c.req.header("authorization"))) {
    c.set("apiKey", true);
    await next();
    return;
  }
  if (c.env.FLAREBOT_LOCAL_DEV === "1") {
    await next();
    return;
  }
  const session = await createAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (session === null || !isAllowed(c.env, session.user.email)) {
    throw new HTTPException(401, { message: "Sign in required" });
  }
  await next();
});
