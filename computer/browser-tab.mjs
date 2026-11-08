const debugUrl = "http://127.0.0.1:9222";
const callTimeoutMs = 20_000;
const loadTimeoutMs = 15_000;
const loadPollMs = 250;
const settleMs = 600;
const screenshotQuality = 70;
const modifierBits = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, super: 4, shift: 8 };
const namedKeys = {
  return: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  escape: { key: "Escape", code: "Escape", keyCode: 27 },
  esc: { key: "Escape", code: "Escape", keyCode: 27 },
  backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  delete: { key: "Delete", code: "Delete", keyCode: 46 },
  up: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  down: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  left: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  arrowup: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  arrowdown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  arrowleft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  arrowright: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  pageup: { key: "PageUp", code: "PageUp", keyCode: 33 },
  page_up: { key: "PageUp", code: "PageUp", keyCode: 33 },
  pagedown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  page_down: { key: "PageDown", code: "PageDown", keyCode: 34 },
  home: { key: "Home", code: "Home", keyCode: 36 },
  end: { key: "End", code: "End", keyCode: 35 },
  space: { key: " ", code: "Space", keyCode: 32, text: " " },
};

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to Chromium")), { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (waiter === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
    else waiter.resolve(message.result);
  });
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, callTimeoutMs);
      pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.send(JSON.stringify(sessionId === undefined ? { id, method, params } : { id, method, params, sessionId }));
    });
  return { call, close: () => socket.close() };
}

async function ensureTab(cdp, targetId) {
  const { targetInfos } = await cdp.call("Target.getTargets");
  if (targetInfos.some((target) => target.targetId === targetId && target.type === "page")) return targetId;
  const created = await cdp.call("Target.createTarget", { url: "about:blank", newWindow: true });
  const { windowId } = await cdp.call("Browser.getWindowForTarget", { targetId: created.targetId });
  await cdp.call("Browser.setWindowBounds", { windowId, bounds: { windowState: "maximized" } });
  return created.targetId;
}

function keyEvents(spec) {
  const parts = spec.split("+").map((part) => part.trim()).filter((part) => part !== "");
  const name = parts.pop();
  if (name === undefined) throw new Error(`Unknown key: ${spec}`);
  let modifiers = 0;
  for (const part of parts) {
    const bit = modifierBits[part.toLowerCase()];
    if (bit === undefined) throw new Error(`Unknown modifier: ${part}`);
    modifiers |= bit;
  }
  const named = namedKeys[name.toLowerCase()];
  const single = name.length === 1 ? name : undefined;
  if (named === undefined && single === undefined) throw new Error(`Unknown key: ${name}`);
  const upper = single?.toUpperCase();
  const key = named ?? {
    key: single,
    code: /[a-z]/i.test(single) ? `Key${upper}` : /[0-9]/.test(single) ? `Digit${single}` : "",
    keyCode: upper.charCodeAt(0),
    text: single,
  };
  const typesText = key.text !== undefined && (modifiers & ~modifierBits.shift) === 0;
  const base = { modifiers, key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.keyCode };
  return [
    typesText ? { ...base, type: "keyDown", text: key.text, unmodifiedText: key.text } : { ...base, type: "rawKeyDown" },
    { ...base, type: "keyUp" },
  ];
}

async function waitForLoad(page) {
  const deadline = Date.now() + loadTimeoutMs;
  while (Date.now() < deadline) {
    const { result } = await page("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
    if (result.value === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, loadPollMs));
  }
}

async function settle(page) {
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  await waitForLoad(page);
}

async function perform(page, action) {
  switch (action.type) {
    case "show":
      return {};
    case "navigate": {
      const navigation = await page("Page.navigate", { url: action.url });
      if (navigation.errorText !== undefined) throw new Error(`Could not open ${action.url}: ${navigation.errorText}`);
      await waitForLoad(page);
      return {};
    }
    case "screenshot": {
      const { data } = await page("Page.captureScreenshot", { format: "jpeg", quality: screenshotQuality });
      return { image: data };
    }
    case "click":
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await page("Input.dispatchMouseEvent", { type, x: action.x, y: action.y, button: "left", clickCount: type === "mouseMoved" ? 0 : 1 });
      }
      await settle(page);
      return {};
    case "type":
      await page("Input.insertText", { text: action.text });
      return {};
    case "key":
      for (const event of keyEvents(action.key)) await page("Input.dispatchKeyEvent", event);
      await settle(page);
      return {};
    case "scroll":
      await page("Input.dispatchMouseEvent", { type: "mouseWheel", x: action.x, y: action.y, deltaX: 0, deltaY: action.deltaY });
      return {};
    default:
      throw new Error(`Unknown action: ${action.type}`);
  }
}

const request = await readInput();
const version = await (await fetch(`${debugUrl}/json/version`)).json();
const cdp = await connect(version.webSocketDebuggerUrl);
const targetId = await ensureTab(cdp, request.targetId);
await cdp.call("Target.activateTarget", { targetId });
const { sessionId } = await cdp.call("Target.attachToTarget", { targetId, flatten: true });
const page = (method, params) => cdp.call(method, params, sessionId);
const result = await perform(page, request.action);
const { result: info } = await page("Runtime.evaluate", { expression: "JSON.stringify({ url: location.href, title: document.title })", returnByValue: true });
console.log(JSON.stringify({ targetId, ...result, page: JSON.parse(info.value) }));
cdp.close();
process.exit(0);
