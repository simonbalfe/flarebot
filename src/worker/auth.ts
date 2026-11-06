import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AppEnv } from "./env";

const keySets = new Map<string, JWTVerifyGetKey>();

function teamKeys(teamDomain: string): JWTVerifyGetKey {
  let keys = keySets.get(teamDomain);
  if (keys === undefined) {
    keys = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    keySets.set(teamDomain, keys);
  }
  return keys;
}

export const requireAccess = createMiddleware<AppEnv>(async (c, next) => {
  if (c.env.FLAREBOT_LOCAL_DEV === "1") {
    await next();
    return;
  }
  const teamDomain: string = c.env.ACCESS_TEAM_DOMAIN;
  const audience: string = c.env.ACCESS_AUD;
  if (teamDomain === "" || audience === "") {
    throw new HTTPException(503, { message: "Cloudflare Access is not configured" });
  }
  const token = c.req.header("cf-access-jwt-assertion") ?? "";
  try {
    await jwtVerify(token, teamKeys(teamDomain), { issuer: `https://${teamDomain}`, audience });
  } catch {
    throw new HTTPException(401, { message: "Invalid Cloudflare Access token" });
  }
  await next();
});
