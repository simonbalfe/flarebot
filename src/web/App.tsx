import { Button, createKumoToastManager, Dialog, Input, Select, Sidebar, Toasty, useSidebar } from "@cloudflare/kumo";
import { MagnifyingGlassIcon, MonitorIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { api, type BotSummary, type BotView, type ComputerStatus } from "./api";
import { Avatar } from "./Avatar";
import { Composer } from "./Composer";
import { ComputerPanel, TakeOver } from "./Computer";
import { formatListTime } from "./format";
import "./theme";
import { Transcript } from "./Transcript";

const busyPollMs = 800;
const idlePollMs = 3000;
const doneMessage = "I'm done, continue.";
const sidebarWidth = 280;
const toasts = createKumoToastManager();
const iconButton = "grid size-7 cursor-pointer place-items-center rounded-full text-fb-preview hover:bg-fb-active hover:text-fb-text";

type Panel = "computer" | "details";

function BotRow({ bot, index, active, onOpen }: { bot: BotSummary; index: number; active: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={`fb-continuous flex h-14 w-full cursor-pointer items-center gap-2.5 rounded-[20px] px-2.5 text-left text-fb-side-text ${active ? "bg-fb-active" : "hover:bg-fb-active"}`}>
      <span className="relative shrink-0">
        <Avatar index={index} />
        {bot.needsYou ? <i className="absolute -top-0.5 -right-0.5 size-[11px] rounded-full bg-fb-unread ring-2 ring-fb-sidebar" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="fb-body truncate font-medium">{bot.name}</span>
          {bot.last === "" ? null : <span className="fb-caption shrink-0 text-fb-faint">{formatListTime(bot.lastAt)}</span>}
        </span>
        <span className="fb-caption mt-px block truncate text-fb-preview">{bot.typing ? "Typing…" : bot.last}</span>
      </span>
    </button>
  );
}

function BotList({ bots, currentId, onOpen, onNew }: { bots: BotSummary[]; currentId: string | null; onOpen: (id: string) => void; onNew: () => void }) {
  const [search, setSearch] = useState("");
  const { isMobile, setOpenMobile } = useSidebar();
  const term = search.toLowerCase();
  const visible = bots.filter((bot) => `${bot.name} ${bot.last}`.toLowerCase().includes(term));
  return (
    <Sidebar className="border-0! bg-fb-sidebar!">
      <div className="flex h-full flex-col bg-fb-sidebar text-fb-side-text">
        <div className="flex h-12 shrink-0 items-center justify-between pr-2.5 pl-4">
          <span className="fb-body font-semibold">flarebot</span>
          <button type="button" aria-label="New Bot" className={iconButton} onClick={onNew}><PlusIcon size={14} /></button>
        </div>
        <label className="fb-continuous mx-2.5 mb-2 flex h-8 shrink-0 items-center gap-1.5 rounded-[14px] bg-fb-field px-2.5 text-fb-faint">
          <MagnifyingGlassIcon size={14} />
          <input aria-label="Search chats" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} className="fb-callout min-w-0 flex-1 bg-transparent text-fb-side-text outline-none placeholder:text-fb-faint" />
        </label>
        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5">
          {visible.map((bot) => (
            <BotRow
              key={bot.id}
              bot={bot}
              index={bots.indexOf(bot)}
              active={bot.id === currentId}
              onOpen={() => {
                onOpen(bot.id);
                if (isMobile) setOpenMobile(false);
              }}
            />
          ))}
        </div>
        <div className="flex h-[50px] shrink-0 items-center gap-2 px-3.5 pt-2 pb-3.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fb-active text-[10px] font-medium text-fb-preview">SB</span>
          <span className="fb-callout min-w-0 flex-1 truncate">Simon Balfe</span>
        </div>
      </div>
    </Sidebar>
  );
}

function DetailsPanel({ view, index, models, onModel, onForget }: { view: BotView; index: number; models: string[]; onModel: (model: string) => void; onForget: (index: number) => void }) {
  const options = models.map((model) => ({ value: model, label: model.split("/")[1] ?? model }));
  return (
    <div className="flex flex-col gap-4 text-[13px] leading-[18px] tracking-[-0.08px]">
      <div className="flex flex-col items-center gap-2 py-2">
        <Avatar index={index} size={64} />
        <span className="text-[14px] font-medium">{view.profile.name}</span>
      </div>
      <Select<string> label="Model" hideLabel={false} size="sm" value={view.profile.model} items={options} onValueChange={(model) => model !== null && onModel(model)} />
      <div className="flex flex-col">
        <span className="mb-1 text-fb-preview">Memory</span>
        {view.memory.map((item, index) => (
          <div key={`${index}:${item}`} className="flex items-start justify-between gap-2 border-t border-fb-line py-1.5">
            <span>{item}</span>
            <button type="button" aria-label="Forget" className={iconButton} onClick={() => onForget(index)}><XIcon size={12} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewBot({ onCreate, onClose }: { onCreate: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  return (
    <Dialog.Root open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <Dialog size="sm" className="flex flex-col gap-4 rounded-[28px]! border-0! bg-fb-pane! p-6! [corner-shape:squircle]">
        <Dialog.Title className="fb-body font-semibold">New Bot</Dialog.Title>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() !== "") onCreate(name.trim());
          }}
        >
          <Input aria-label="Name" placeholder="Name" value={name} autoFocus onChange={(event) => setName(event.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" className="rounded-full!" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" className="rounded-full! bg-fb-me! text-fb-me-text!" disabled={name.trim() === ""}>Create</Button>
          </div>
        </form>
      </Dialog>
    </Dialog.Root>
  );
}

function Workspace() {
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [view, setView] = useState<BotView | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [computer, setComputer] = useState<ComputerStatus | null>(null);
  const [overlay, setOverlay] = useState<"take" | "new" | null>(null);

  const guard = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await work();
    } catch (error) {
      toasts.add({ title: "Something went wrong", description: error instanceof Error ? error.message : String(error), variant: "error" });
      return undefined;
    }
  }, []);

  const loadBots = useCallback(async () => {
    const result = await guard(api.bots);
    if (result === undefined) return;
    setBots(result.bots);
    setModels(result.models);
    setCurrentId((current) => current ?? result.bots[0]?.id ?? null);
  }, [guard]);

  const loadView = useCallback(async (id: string) => {
    const result = await guard(() => api.bot(id));
    if (result !== undefined) setView(result);
  }, [guard]);

  useEffect(() => {
    void loadBots();
    const timer = setInterval(() => void loadBots(), idlePollMs);
    return () => clearInterval(timer);
  }, [loadBots]);

  const busy = view?.busy === true;
  useEffect(() => {
    if (currentId === null) return;
    void loadView(currentId);
    const timer = setInterval(() => void loadView(currentId), busy ? busyPollMs : idlePollMs);
    return () => clearInterval(timer);
  }, [currentId, busy, loadView]);

  const loadComputer = useCallback(async () => {
    const result = await guard(api.computer);
    if (result !== undefined) setComputer(result);
  }, [guard]);

  useEffect(() => {
    if (panel !== "computer" && overlay !== "take") return;
    void loadComputer();
    const timer = setInterval(() => void loadComputer(), idlePollMs);
    return () => clearInterval(timer);
  }, [panel, overlay, loadComputer]);

  const shown = view?.profile.id === currentId ? view : null;
  const summary = bots.find((bot) => bot.id === currentId);

  const send = async (text: string) => {
    if (currentId === null) return;
    setPending(text);
    await guard(() => api.send(currentId, text));
    await loadView(currentId);
    setPending(null);
  };

  const togglePanel = (next: Panel) => setPanel(panel === next ? null : next);

  return (
    <Sidebar.Provider defaultOpen collapsible="offcanvas" resizable defaultWidth={sidebarWidth} minWidth={224} maxWidth={420} className="h-svh min-h-0!">
      <BotList bots={bots} currentId={currentId} onOpen={setCurrentId} onNew={() => setOverlay("new")} />
      <div className="relative flex min-w-0 flex-1 overflow-hidden bg-fb-pane">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b-[0.5px] border-fb-line px-3">
            <span className="md:hidden"><Sidebar.Trigger /></span>
            {summary === undefined ? null : (
              <button type="button" onClick={() => togglePanel("details")} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-full py-1 pr-2.5 pl-1 hover:bg-fb-active">
                <Avatar index={bots.indexOf(summary)} size={24} />
                <span className="fb-body truncate font-semibold">{summary.name}</span>
              </button>
            )}
            <button type="button" aria-label="Computer" className={`ml-auto ${iconButton} ${panel === "computer" ? "bg-fb-active text-fb-text" : ""}`} onClick={() => togglePanel("computer")}><MonitorIcon size={16} /></button>
          </header>
          {shown === null ? <div className="flex-1" /> : <Transcript view={shown} bots={bots} pending={pending} onTakeOver={() => setOverlay("take")} />}
          {summary === undefined ? null : <Composer key={summary.id} name={summary.name} busy={busy} onSend={(text) => void send(text)} onStop={() => currentId !== null && void guard(() => api.stop(currentId))} />}
        </div>
        {panel === null ? null : (
          <aside className="absolute inset-y-0 right-0 z-10 flex w-full flex-col border-l-[0.5px] border-fb-line bg-fb-pane sm:static sm:w-[360px]">
            <div className="flex h-12 shrink-0 items-center justify-between border-b-[0.5px] border-fb-line pr-2.5 pl-4">
              <span className="fb-body font-semibold">{panel === "computer" ? "Computer" : "Details"}</span>
              <button type="button" aria-label="Close" className={iconButton} onClick={() => setPanel(null)}><XIcon size={14} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {panel === "computer" ? (
                <ComputerPanel
                  status={computer}
                  onOpen={() => setOverlay("take")}
                  onStart={() => void guard(api.startComputer).then((status) => status && setComputer(status))}
                  onStop={() => void guard(api.stopComputer).then((status) => status && setComputer(status))}
                />
              ) : null}
              {panel === "details" && shown !== null ? (
                <DetailsPanel
                  view={shown}
                  index={summary === undefined ? 0 : bots.indexOf(summary)}
                  models={models}
                  onModel={(model) => currentId !== null && void guard(() => api.setModel(currentId, model)).then(() => loadView(currentId))}
                  onForget={(index) => currentId !== null && void guard(() => api.forget(currentId, index)).then(() => loadView(currentId))}
                />
              ) : null}
            </div>
          </aside>
        )}
      </div>
      {overlay === "take" && summary !== undefined ? (
        <TakeOver
          name={summary.name}
          onClose={() => setOverlay(null)}
          onDone={() => {
            setOverlay(null);
            if (shown?.takeover !== null) void send(doneMessage);
          }}
        />
      ) : null}
      {overlay === "new" ? (
        <NewBot
          onClose={() => setOverlay(null)}
          onCreate={(name) => {
            setOverlay(null);
            void guard(() => api.createBot({ name })).then((bot) => {
              if (bot === undefined) return;
              void loadBots();
              setCurrentId(bot.id);
            });
          }}
        />
      ) : null}
    </Sidebar.Provider>
  );
}

export function App() {
  return (
    <Toasty toastManager={toasts}>
      <Workspace />
    </Toasty>
  );
}
