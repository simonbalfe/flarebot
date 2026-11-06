import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { requireAccess } from "./auth";
import { type AppEnv, computerName, models, userName } from "./env";

export { Bot } from "./bot";
export { Computer } from "./computer";
export { User } from "./user";

const newBotBody = z.object({
  name: z.string().trim().min(1).max(60),
});
const messageBody = z.object({ text: z.string().trim().min(1).max(20_000) });
const modelBody = z.object({ model: z.enum(models) });
const cookiesBody = z.object({ cookies: z.array(z.record(z.string(), z.unknown())).max(50_000) });
const vncPrefix = "/api/computer/vnc";

const app = new Hono<AppEnv>();

app.onError((error, c) => {
  if (error instanceof HTTPException) return c.json({ error: error.message }, error.status);
  if (error instanceof z.ZodError) return c.json({ error: error.issues.map((issue) => issue.message).join("; ") }, 400);
  console.error(error);
  return c.json({ error: "Internal error" }, 500);
});

app.use("/api/*", requireAccess);

const user = (env: Env) => env.USER.getByName(userName);
const computer = (env: Env) => env.COMPUTER.getByName(computerName);

async function ownedBot(env: Env, id: string) {
  if (!(await user(env).has(id))) throw new HTTPException(404, { message: "Bot not found" });
  return env.BOT.getByName(id);
}

app.get("/api/bots", async (c) => c.json({ bots: await user(c.env).list(), models }));

app.post("/api/bots", async (c) => {
  const body = newBotBody.parse(await c.req.json());
  return c.json(await user(c.env).create(body), 201);
});

app.get("/api/bots/:id", async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  return c.json(await bot.view());
});

app.post("/api/bots/:id/messages", async (c) => {
  const body = messageBody.parse(await c.req.json());
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.send(body.text);
  return c.body(null, 202);
});

app.post("/api/bots/:id/stop", async (c) => {
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.stop();
  return c.body(null, 204);
});

app.put("/api/bots/:id/model", async (c) => {
  const body = modelBody.parse(await c.req.json());
  const id = c.req.param("id");
  const bot = await ownedBot(c.env, id);
  await bot.setModel(body.model);
  await user(c.env).updateBot(id, { model: body.model });
  return c.body(null, 204);
});

app.delete("/api/bots/:id/memory/:index", async (c) => {
  const index = z.coerce.number().int().min(0).parse(c.req.param("index"));
  const bot = await ownedBot(c.env, c.req.param("id"));
  await bot.forget(index);
  return c.body(null, 204);
});

app.get("/api/computer", async (c) => c.json(await computer(c.env).status()));

app.post("/api/computer/start", async (c) => c.json(await computer(c.env).start()));

app.post("/api/computer/stop", async (c) => c.json(await computer(c.env).stop()));

app.post("/api/computer/reset", async (c) => c.json(await computer(c.env).reset()));

app.post("/api/computer/cookies", async (c) => {
  const body = cookiesBody.parse(await c.req.json());
  return c.json(await computer(c.env).importCookies(body.cookies));
});

app.all(`${vncPrefix}/*`, async (c) => {
  const url = new URL(c.req.url);
  url.pathname = url.pathname.slice(vncPrefix.length);
  return computer(c.env).fetch(new Request(url, c.req.raw));
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
