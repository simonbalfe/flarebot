import { Button, createKumoToastManager, Dialog, Input, Select, Sidebar, Toasty, useSidebar } from "@cloudflare/kumo";
import { CheckIcon, MagnifyingGlassIcon, MonitorIcon, PlusIcon, SignOutIcon, UsersThreeIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type BotSummary, type BotView, type ComputerStatus, type GroupSummary, isSignedIn, type McpServerSummary, type ThreadSummary } from "./api";
import { authClient } from "./auth";
import { Avatar, botMentions } from "./Avatar";
import { Composer } from "./Composer";
import { ComputerPanel, TakeOver } from "./Computer";
import { formatListTime } from "./format";
import { GroupAvatars, GroupPane } from "./Group";
import "./theme";
import { SignIn } from "./SignIn";
import { Transcript } from "./Transcript";

const busyPollMs = 800;
const idlePollMs = 3000;
const repeatErrorMs = 10_000;
const sidebarWidth = 280;
const minGroupBots = 2;
const maxGroupBots = 6;
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

function GroupRow({ group, bots, active, onOpen }: { group: GroupSummary; bots: BotSummary[]; active: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={`fb-continuous flex h-14 w-full cursor-pointer items-center gap-2.5 rounded-[20px] px-2.5 text-left text-fb-side-text ${active ? "bg-fb-active" : "hover:bg-fb-active"}`}>
      <GroupAvatars memberIds={group.memberIds} bots={bots} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="fb-body truncate font-medium">{group.name}</span>
          {group.last === "" ? null : <span className="fb-caption shrink-0 text-fb-faint">{formatListTime(group.lastAt)}</span>}
        </span>
        <span className="fb-caption mt-px block truncate text-fb-preview">{group.last}</span>
      </span>
    </button>
  );
}

function BotList({ bots, groups, currentId, currentGroupId, onOpen, onOpenGroup, onNew, onNewGroup }: { bots: BotSummary[]; groups: GroupSummary[]; currentId: string | null; currentGroupId: string | null; onOpen: (id: string) => void; onOpenGroup: (id: string) => void; onNew: () => void; onNewGroup: () => void }) {
  const [search, setSearch] = useState("");
  const { isMobile, setOpenMobile } = useSidebar();
  const term = search.toLowerCase();
  const visible = bots.filter((bot) => `${bot.name} ${bot.last}`.toLowerCase().includes(term));
  const visibleGroups = groups.filter((group) => `${group.name} ${group.last}`.toLowerCase().includes(term));
  return (
    <Sidebar className="border-0! bg-fb-sidebar!">
      <div className="flex h-full flex-col bg-fb-sidebar text-fb-side-text">
        <div className="flex h-12 shrink-0 items-center justify-between pr-2.5 pl-4">
          <span className="fb-body font-semibold">flarebot</span>
          <span className="flex items-center gap-0.5">
            <button type="button" aria-label="New group" className={iconButton} onClick={onNewGroup}><UsersThreeIcon size={14} /></button>
            <button type="button" aria-label="New Bot" className={iconButton} onClick={onNew}><PlusIcon size={14} /></button>
          </span>
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
              active={currentGroupId === null && bot.id === currentId}
              onOpen={() => {
                onOpen(bot.id);
                if (isMobile) setOpenMobile(false);
              }}
            />
          ))}
          {visibleGroups.map((group) => (
            <GroupRow
              key={group.id}
              group={group}
              bots={bots}
              active={group.id === currentGroupId}
              onOpen={() => {
                onOpenGroup(group.id);
                if (isMobile) setOpenMobile(false);
              }}
            />
          ))}
        </div>
        <div className="flex h-[50px] shrink-0 items-center gap-2 px-3.5 pt-2 pb-3.5">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fb-active text-[10px] font-medium text-fb-preview">Y</span>
          <span className="fb-callout min-w-0 flex-1 truncate">You</span>
          <button type="button" aria-label="Sign out" className={iconButton} onClick={() => void authClient.signOut().then(() => window.location.reload())}><SignOutIcon size={14} /></button>
        </div>
      </div>
    </Sidebar>
  );
}

function McpSection({ servers, enabled, onToggle, onAdd, onRemove }: { servers: McpServerSummary[]; enabled: string[]; onToggle: (id: string) => void; onAdd: (input: { name: string; url: string; token: string }) => Promise<boolean>; onRemove: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", url: "", token: "" });
  const submit = async () => {
    setBusy(true);
    const added = await onAdd({ name: form.name.trim(), url: form.url.trim(), token: form.token.trim() });
    setBusy(false);
    if (!added) return;
    setForm({ name: "", url: "", token: "" });
    setAdding(false);
  };
  return (
    <div className="flex flex-col">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-fb-preview">MCP servers</span>
        <button type="button" aria-label="Add MCP server" className={iconButton} onClick={() => setAdding(!adding)}><PlusIcon size={12} /></button>
      </div>
      {servers.map((server) => (
        <div key={server.id} className="flex items-center justify-between gap-2 border-t border-fb-line py-1.5">
          <button type="button" aria-pressed={enabled.includes(server.id)} onClick={() => onToggle(server.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
            <span className={`grid size-4 shrink-0 place-items-center rounded border ${enabled.includes(server.id) ? "border-fb-me bg-fb-me text-fb-me-text" : "border-fb-line"}`}>
              {enabled.includes(server.id) ? <CheckIcon size={10} /> : null}
            </span>
            <span className="min-w-0 truncate">{server.name}</span>
          </button>
          <button type="button" aria-label={`Remove ${server.name}`} className={iconButton} onClick={() => onRemove(server.id)}><XIcon size={12} /></button>
        </div>
      ))}
      {adding ? (
        <form
          className="flex flex-col gap-2 border-t border-fb-line pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input aria-label="Name" placeholder="Name" size="sm" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Input aria-label="URL" placeholder="https://…/mcp" size="sm" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} />
          <Input aria-label="Token" placeholder="Token" type="password" size="sm" value={form.token} onChange={(event) => setForm({ ...form, token: event.target.value })} />
          <Button type="submit" size="sm" className="w-fit rounded-full! bg-fb-me! text-fb-me-text!" disabled={busy || form.name.trim() === "" || form.url.trim() === ""}>{busy ? "Connecting…" : "Add"}</Button>
        </form>
      ) : null}
    </div>
  );
}

function DetailsPanel({ view, index, models, mcpServers, onModel, onRole, onForget, onToggleMcp, onAddMcp, onRemoveMcp }: { view: BotView; index: number; models: string[]; mcpServers: McpServerSummary[]; onModel: (model: string) => void; onRole: (role: string) => void; onForget: (index: number) => void; onToggleMcp: (id: string) => void; onAddMcp: (input: { name: string; url: string; token: string }) => Promise<boolean>; onRemoveMcp: (id: string) => void }) {
  const options = models.map((model) => ({ value: model, label: model.split("/")[1] ?? model }));
  const [role, setRole] = useState(view.profile.role);
  const saveRole = () => {
    if (role.trim() !== view.profile.role) onRole(role.trim());
  };
  return (
    <div className="flex flex-col gap-4 text-[13px] leading-[18px] tracking-[-0.08px]">
      <div className="flex flex-col items-center gap-2 py-2">
        <Avatar index={index} size={64} />
        <span className="text-[14px] font-medium">{view.profile.name}</span>
      </div>
      <Input
        label="Role"
        size="sm"
        value={role}
        onChange={(event) => setRole(event.target.value)}
        onBlur={saveRole}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <Select<string> label="Model" hideLabel={false} size="sm" value={view.profile.model} items={options} onValueChange={(model) => model !== null && onModel(model)} />
      <div className="flex flex-col gap-0.5">
        <span className="text-fb-preview">Folder</span>
        <span className="font-mono text-xs [overflow-wrap:anywhere]">{view.workspace.path}</span>
        <span className="text-fb-preview">Artifacts repo</span>
        <span className="font-mono text-xs [overflow-wrap:anywhere]">{view.workspace.repo}</span>
      </div>
      <McpSection servers={mcpServers} enabled={view.mcpServers.map((server) => server.id)} onToggle={onToggleMcp} onAdd={onAddMcp} onRemove={onRemoveMcp} />
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

function viewKeyOf(botId: string, threadId: string | null): string {
  return `${botId}:${threadId ?? "main"}`;
}

function ThreadBar({ threads, current, onOpen, onNew, onClose }: { threads: ThreadSummary[]; current: string | null; onOpen: (id: string | null) => void; onNew: () => void; onClose: (id: string) => void }) {
  const tab = "fb-callout flex h-7 max-w-[220px] shrink-0 cursor-pointer items-center gap-1 rounded-full px-3";
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b-[0.5px] border-fb-line px-3 [scrollbar-width:none]">
      <button type="button" className={`${tab} ${current === null ? "bg-fb-active font-medium text-fb-text" : "text-fb-preview hover:bg-fb-active"}`} onClick={() => onOpen(null)}>Main</button>
      {threads.map((thread) => (
        <span key={thread.id} className={`${tab} pr-1 ${current === thread.id ? "bg-fb-active font-medium text-fb-text" : "text-fb-preview hover:bg-fb-active"}`}>
          <button type="button" className="min-w-0 cursor-pointer truncate" onClick={() => onOpen(thread.id)}>{thread.title === "" ? "New thread" : thread.title}</button>
          <button type="button" aria-label="Close thread" className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-fb-line" onClick={() => onClose(thread.id)}><XIcon size={10} /></button>
        </span>
      ))}
      <button type="button" aria-label="Start thread" className={iconButton} onClick={onNew}><PlusIcon size={14} /></button>
    </div>
  );
}

function NewBot({ onCreate, onClose }: { onCreate: (input: { name: string; role: string }) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  return (
    <Dialog.Root open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <Dialog size="sm" className="flex flex-col gap-4 rounded-[28px]! border-0! bg-fb-pane! p-6! [corner-shape:squircle]">
        <Dialog.Title className="fb-body font-semibold">New Bot</Dialog.Title>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() !== "") onCreate({ name: name.trim(), role: role.trim() });
          }}
        >
          <Input aria-label="Name" placeholder="Name" value={name} autoFocus onChange={(event) => setName(event.target.value)} />
          <Input aria-label="Role" placeholder="Role" value={role} onChange={(event) => setRole(event.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" className="rounded-full!" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" className="rounded-full! bg-fb-me! text-fb-me-text!" disabled={name.trim() === ""}>Create</Button>
          </div>
        </form>
      </Dialog>
    </Dialog.Root>
  );
}

function NewGroup({ bots, onCreate, onClose }: { bots: BotSummary[]; onCreate: (input: { name: string; botIds: string[] }) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const valid = selected.length >= minGroupBots && selected.length <= maxGroupBots;
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((candidate) => candidate !== id) : [...selected, id]);
  return (
    <Dialog.Root open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <Dialog size="sm" className="flex flex-col gap-4 rounded-[28px]! border-0! bg-fb-pane! p-6! [corner-shape:squircle]">
        <Dialog.Title className="fb-body font-semibold">New group</Dialog.Title>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) onCreate({ name: name.trim(), botIds: selected });
          }}
        >
          <Input aria-label="Name" placeholder="Name" value={name} autoFocus onChange={(event) => setName(event.target.value)} />
          <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
            {bots.map((bot, index) => (
              <button
                key={bot.id}
                type="button"
                aria-pressed={selected.includes(bot.id)}
                onClick={() => toggle(bot.id)}
                className={`fb-callout flex cursor-pointer items-center gap-2.5 rounded-[14px] px-2 py-1.5 text-left text-fb-text ${selected.includes(bot.id) ? "bg-fb-active" : "hover:bg-fb-active"}`}
              >
                <Avatar index={index} size={24} />
                <span className="min-w-0 flex-1 truncate">{bot.name}</span>
                {selected.includes(bot.id) ? <CheckIcon size={14} /> : null}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" className="rounded-full!" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" className="rounded-full! bg-fb-me! text-fb-me-text!" disabled={!valid}>Create</Button>
          </div>
        </form>
      </Dialog>
    </Dialog.Root>
  );
}

function Workspace() {
  const [bots, setBots] = useState<BotSummary[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentGroupId, setCurrentGroupId] = useState<string | null>(null);
  const [view, setView] = useState<BotView | null>(null);
  const [viewKey, setViewKey] = useState("");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [computer, setComputer] = useState<ComputerStatus | null>(null);
  const [overlay, setOverlay] = useState<"take" | "new" | "group" | null>(null);

  const lastError = useRef({ message: "", at: 0 });
  const showError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const now = Date.now();
    if (message === lastError.current.message && now - lastError.current.at < repeatErrorMs) return;
    lastError.current = { message, at: now };
    toasts.add({ title: "Something went wrong", description: message, variant: "error" });
  }, []);

  const guard = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await work();
    } catch (error) {
      showError(error);
      return undefined;
    }
  }, [showError]);

  const loadBots = useCallback(async () => {
    const result = await guard(api.bots);
    if (result === undefined) return;
    setBots(result.bots);
    setGroups(result.groups);
    setModels(result.models);
    setCurrentId((current) => current ?? result.bots[0]?.id ?? null);
  }, [guard]);

  const loadView = useCallback(async (id: string, thread: string | null) => {
    const result = await guard(() => (thread === null ? api.bot(id) : api.thread(id, thread)));
    if (result === undefined) return;
    setView(result);
    setViewKey(viewKeyOf(id, thread));
  }, [guard]);

  useEffect(() => {
    void loadBots();
    const timer = setInterval(() => void loadBots(), idlePollMs);
    return () => clearInterval(timer);
  }, [loadBots]);

  const busy = view?.busy === true;
  useEffect(() => {
    if (currentId === null) return;
    void loadView(currentId, threadId);
    const timer = setInterval(() => void loadView(currentId, threadId), busy ? busyPollMs : idlePollMs);
    return () => clearInterval(timer);
  }, [currentId, threadId, busy, loadView]);

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

  const loadMcp = useCallback(async () => {
    const result = await guard(api.mcpServers);
    if (result !== undefined) setMcpServers(result.servers);
  }, [guard]);

  useEffect(() => {
    if (panel === "details") void loadMcp();
  }, [panel, loadMcp]);

  const toggleMcp = async (current: BotView | null, serverId: string) => {
    if (currentId === null || current === null) return;
    const enabled = current.mcpServers.map((server) => server.id);
    const next = enabled.includes(serverId) ? enabled.filter((id) => id !== serverId) : [...enabled, serverId];
    await guard(() => api.setBotMcp(currentId, next));
    await loadView(currentId, threadId);
  };

  const addMcp = async (input: { name: string; url: string; token: string }): Promise<boolean> => {
    const added = await guard(() => api.addMcpServer(input));
    if (added === undefined) return false;
    toasts.add({ title: `${added.server.name} connected`, description: `${added.tools} tools` });
    await loadMcp();
    return true;
  };

  const shown = currentId !== null && viewKey === viewKeyOf(currentId, threadId) ? view : null;
  const summary = bots.find((bot) => bot.id === currentId);
  const currentGroup = groups.find((group) => group.id === currentGroupId);
  const openBot = (id: string) => {
    setCurrentGroupId(null);
    setThreadId(null);
    setCurrentId(id);
  };
  const newThread = async () => {
    if (currentId === null) return;
    const thread = await guard(() => api.startThread(currentId));
    if (thread !== undefined) setThreadId(thread.id);
  };
  const closeThread = async (id: string) => {
    if (currentId === null) return;
    await guard(() => api.closeThread(currentId, id));
    if (threadId === id) setThreadId(null);
    await loadView(currentId, threadId === id ? null : threadId);
  };
  const openGroup = (id: string) => {
    setCurrentGroupId(id);
    setPanel((current) => (current === "details" ? null : current));
  };
  const openComputer = () => {
    setOverlay("take");
    if (currentGroupId === null && currentId !== null) void guard(() => api.showTab(currentId));
  };

  const send = async (text: string) => {
    if (currentId === null) return;
    setPending(text);
    await guard(() => (threadId === null ? api.send(currentId, text) : api.sendThread(currentId, threadId, text)));
    await loadView(currentId, threadId);
    setPending(null);
  };

  const togglePanel = (next: Panel) => setPanel(panel === next ? null : next);

  return (
    <Sidebar.Provider defaultOpen collapsible="offcanvas" resizable defaultWidth={sidebarWidth} minWidth={224} maxWidth={420} className="h-svh min-h-0!">
      <BotList bots={bots} groups={groups} currentId={currentId} currentGroupId={currentGroupId} onOpen={openBot} onOpenGroup={openGroup} onNew={() => setOverlay("new")} onNewGroup={() => setOverlay("group")} />
      <div className="relative flex min-w-0 flex-1 overflow-hidden bg-fb-pane">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b-[0.5px] border-fb-line px-3">
            <span className="md:hidden"><Sidebar.Trigger /></span>
            {currentGroup === undefined ? null : (
              <div className="flex min-w-0 items-center gap-2 py-1 pr-2.5 pl-1">
                <GroupAvatars memberIds={currentGroup.memberIds} bots={bots} />
                <span className="fb-body truncate font-semibold">{currentGroup.name}</span>
              </div>
            )}
            {summary === undefined || currentGroup !== undefined ? null : (
              <button type="button" onClick={() => togglePanel("details")} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-full py-1 pr-2.5 pl-1 hover:bg-fb-active">
                <Avatar index={bots.indexOf(summary)} size={24} />
                <span className="fb-body truncate font-semibold">{summary.name}</span>
              </button>
            )}
            <button type="button" aria-label="Computer" className={`ml-auto ${iconButton} ${panel === "computer" ? "bg-fb-active text-fb-text" : ""}`} onClick={() => togglePanel("computer")}><MonitorIcon size={16} /></button>
          </header>
          {currentGroup === undefined ? (
            <>
              {summary === undefined ? null : (
                <ThreadBar threads={shown?.threads ?? view?.threads ?? []} current={threadId} onOpen={setThreadId} onNew={() => void newThread()} onClose={(id) => void closeThread(id)} />
              )}
              {shown === null ? <div className="flex-1" /> : <Transcript view={shown} bots={bots} pending={pending} onTakeOver={openComputer} />}
              {summary === undefined ? null : (
                <Composer
                  key={`${summary.id}:${threadId ?? "main"}`}
                  name={summary.name}
                  busy={busy}
                  mentions={botMentions(bots).filter((mention) => mention.name !== summary.name)}
                  onSend={(text) => void send(text)}
                  onStop={() => currentId !== null && void guard(() => (threadId === null ? api.stop(currentId) : api.stopThread(currentId, threadId)))}
                />
              )}
            </>
          ) : (
            <GroupPane group={currentGroup} bots={bots} onError={showError} />
          )}
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
                  onOpen={openComputer}
                  onStart={() => void guard(api.startComputer).then((status) => status && setComputer(status))}
                  onStop={() => void guard(api.stopComputer).then((status) => status && setComputer(status))}
                />
              ) : null}
              {panel === "details" && shown !== null ? (
                <DetailsPanel
                  key={shown.profile.id}
                  view={shown}
                  index={summary === undefined ? 0 : bots.indexOf(summary)}
                  models={models}
                  onModel={(model) => currentId !== null && void guard(() => api.setModel(currentId, model)).then(() => loadView(currentId, threadId))}
                  onRole={(role) => currentId !== null && void guard(() => api.setRole(currentId, role)).then(() => Promise.all([loadView(currentId, threadId), loadBots()]))}
                  onForget={(index) => currentId !== null && void guard(() => api.forget(currentId, index)).then(() => loadView(currentId, threadId))}
                  mcpServers={mcpServers}
                  onToggleMcp={(serverId) => void toggleMcp(shown, serverId)}
                  onAddMcp={addMcp}
                  onRemoveMcp={(serverId) => void guard(() => api.removeMcpServer(serverId)).then(() => Promise.all([loadMcp(), currentId !== null ? loadView(currentId, threadId) : undefined]))}
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
            if (shown?.takeover !== null && currentId !== null) void guard(() => api.finishTakeover(currentId)).then(() => loadView(currentId, threadId));
          }}
        />
      ) : null}
      {overlay === "new" ? (
        <NewBot
          onClose={() => setOverlay(null)}
          onCreate={(input) => {
            setOverlay(null);
            void guard(() => api.createBot(input)).then((bot) => {
              if (bot === undefined) return;
              void loadBots();
              openBot(bot.id);
            });
          }}
        />
      ) : null}
      {overlay === "group" ? (
        <NewGroup
          bots={bots}
          onClose={() => setOverlay(null)}
          onCreate={(input) => {
            setOverlay(null);
            void guard(() => api.createGroup(input)).then((group) => {
              if (group === undefined) return;
              void loadBots();
              setCurrentGroupId(group.id);
            });
          }}
        />
      ) : null}
    </Sidebar.Provider>
  );
}

export function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    void isSignedIn().then(setSignedIn);
  }, []);

  if (signedIn === null) return <div className="h-svh bg-fb-pane" />;
  if (!signedIn) return <SignIn />;
  return (
    <Toasty toastManager={toasts}>
      <Workspace />
    </Toasty>
  );
}
