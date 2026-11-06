const debugUrl = "http://127.0.0.1:9222";

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function connectToPage() {
  const targets = await (await fetch(`${debugUrl}/json/list`)).json();
  const page = targets.find((target) => target.type === "page");
  if (page === undefined) throw new Error("Chromium has no open page");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to Chromium")), { once: true });
  });
  return socket;
}

function createClient(socket) {
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  return (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
}

const cookies = await readInput();
const socket = await connectToPage();
const send = createClient(socket);
let imported = 0;
for (const cookie of cookies) {
  const response = await send("Network.setCookie", cookie);
  if (response.result?.success === true) imported += 1;
}
const all = await send("Network.getAllCookies", {});
socket.close();
console.log(JSON.stringify({ received: cookies.length, imported, total: all.result?.cookies?.length ?? 0 }));
