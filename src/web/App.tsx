import { keepPreviousData, type QueryKey, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";
import { SquaresFourIcon, BellIcon, BellSlashIcon, CaretLeftIcon, CaretRightIcon, CheckIcon, CopyIcon, LockSimpleIcon, MagnifyingGlassIcon, MonitorIcon, PlusIcon, SignOutIcon, UploadSimpleIcon, UsersThreeIcon, XIcon } from "@phosphor-icons/react";
import { type CSSProperties, lazy, type ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { api, type AppEntry, type BotSummary, type BotView, type CliSummary, type GroupSummary, type MacStatus, type McpServerSummary, type OwnSkill, type PickerOption, type PoolKind, type ThreadSummary } from "./api";
import { authClient } from "./auth";
import { Avatar, botMentions } from "./Avatar";
import { Composer } from "./Composer";
import { useIsMobile } from "./mobile";
import { ComputerPanel, TakeOver } from "./Computer";
import { formatListTime } from "./format";
import { GroupAvatars, GroupPane } from "./Group";
import { disablePush, enablePush, onNotificationOpen, pushSupported, restorePush } from "./push";
import "./theme";
import { ActivitySection, SecretsSection, TrustSection } from "./Approvals";
import { AppLibrary } from "./Apps";
import { categoryLabels } from "../worker/catalog";
import { appsQuery, botsQuery, clisQuery, computerQuery, keys, macQuery, mcpQuery, ownSkillsQuery, secretsQuery, showError, skillsQuery, viewQuery } from "./queries";
import { RoutinesSection } from "./Routines";
import type { WorkspaceSearch } from "./router";
import { Transcript } from "./Transcript";

const sidebarWidth = 280;
const minGroupBots = 2;
const maxGroupBots = 6;
const minSidebarWidth = 224;
const maxSidebarWidth = 420;
const iconButton = "grid size-9 cursor-pointer place-items-center rounded-full text-fb-preview hover:bg-fb-active hover:text-fb-text md:size-7";
const longPressMs = 450;
const viewTab = "h-6 cursor-pointer rounded-full px-2.5";
const FactoryView = lazy(() => import("./factory/FactoryView").then((module) => ({ default: module.FactoryView })));

type Panel = "computer" | "details";

type RowAction = { label: string; danger?: boolean; onSelect: () => void };

function RowMenu({ actions, className = "", children }: { actions: RowAction[]; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pressTimer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const cancelPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
    >
      <DropdownMenuTrigger
        asChild
        onContextMenu={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
        onTouchStart={() => {
          longPressed.current = false;
          cancelPress();
          pressTimer.current = window.setTimeout(() => {
            longPressed.current = true;
            navigator.vibrate?.(10);
            setOpen(true);
          }, longPressMs);
        }}
        onTouchMove={cancelPress}
        onTouchEnd={cancelPress}
        onClickCapture={(event) => {
          if (!longPressed.current) return;
          longPressed.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <div className={`fb-no-callout ${className}`}>{children}</div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {actions.map((action) => (
          <DropdownMenuItem key={action.label} variant={action.danger === true ? "destructive" : "default"} onSelect={action.onSelect}>{action.label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const rowClass = "fb-continuous flex h-[68px] w-full cursor-pointer items-center gap-3 rounded-[20px] px-2.5 text-left text-fb-side-text active:bg-fb-active md:h-14 md:gap-2.5";

function BotRow({ bot, index, active, onOpen }: { bot: BotSummary; index: number; active: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={`${rowClass} ${active ? "bg-fb-active" : "md:hover:bg-fb-active"}`}>
      <span className="relative shrink-0 scale-125 md:scale-100">
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
    <button type="button" onClick={onOpen} className={`${rowClass} ${active ? "bg-fb-active" : "md:hover:bg-fb-active"}`}>
      <span className="shrink-0 scale-125 md:scale-100"><GroupAvatars memberIds={group.memberIds} bots={bots} /></span>
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

function PushToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!pushSupported()) return;
    void restorePush().then(setEnabled, () => setEnabled(false));
  }, []);
  if (enabled === null) return null;
  const toggle = async () => {
    try {
      if (enabled) {
        await disablePush();
        setEnabled(false);
        return;
      }
      if (await enablePush()) setEnabled(true);
      else toast.error("Notifications are blocked");
    } catch (error) {
      toast.error("Something went wrong", { description: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <button type="button" aria-label={enabled ? "Turn off notifications" : "Turn on notifications"} aria-pressed={enabled} className={iconButton} onClick={() => void toggle()}>
      {enabled ? <BellIcon size={14} /> : <BellSlashIcon size={14} />}
    </button>
  );
}

type ChatListProps = { bots: BotSummary[]; groups: GroupSummary[]; currentId: string | null; currentGroupId: string | null; onOpen: (id: string) => void; onOpenGroup: (id: string) => void; onNew: () => void; onNewGroup: () => void; onEditBot: (bot: BotSummary) => void; onDeleteBot: (bot: BotSummary) => void; onRenameGroup: (group: GroupSummary) => void; onDeleteGroup: (group: GroupSummary) => void };

function ChatList({ bots, groups, currentId, currentGroupId, onOpen, onOpenGroup, onNew, onNewGroup, onEditBot, onDeleteBot, onRenameGroup, onDeleteGroup, mobile }: ChatListProps & { mobile: boolean }) {
  const [search, setSearch] = useState("");
  const term = search.toLowerCase();
  const visible = bots.filter((bot) => `${bot.name} ${bot.last}`.toLowerCase().includes(term));
  const visibleGroups = groups.filter((group) => `${group.name} ${group.last}`.toLowerCase().includes(term));
  return (
    <div className={`flex h-full flex-col bg-fb-sidebar text-fb-side-text ${mobile ? "fb-safe-top" : ""}`}>
      <div className="flex h-12 shrink-0 items-center justify-between pr-2.5 pl-4">
        {mobile ? <span /> : <span className="fb-body font-semibold">flarebot</span>}
        <span className="flex items-center gap-0.5">
          <button type="button" aria-label="New group" className={iconButton} onClick={onNewGroup}><UsersThreeIcon size={mobile ? 20 : 14} /></button>
          <button type="button" aria-label="New Bot" className={iconButton} onClick={onNew}><PlusIcon size={mobile ? 20 : 14} /></button>
        </span>
      </div>
      {mobile ? <h1 className="shrink-0 px-4 pb-2 text-[30px] leading-9 font-bold tracking-[-0.5px]">flarebot</h1> : null}
      <label className={`fb-continuous mx-2.5 mb-2 flex shrink-0 items-center gap-1.5 bg-fb-field px-2.5 text-fb-faint ${mobile ? "mx-4 h-9 rounded-[12px]" : "h-8 rounded-[14px]"}`}>
        <MagnifyingGlassIcon size={mobile ? 16 : 14} />
        <input aria-label="Search chats" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} className="fb-callout min-w-0 flex-1 bg-transparent text-fb-side-text outline-none placeholder:text-fb-faint" />
      </label>
      <div className={`flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain ${mobile ? "px-2" : "px-2.5"}`}>
        {visible.map((bot) => (
          <RowMenu key={bot.id} actions={[{ label: "Edit", onSelect: () => onEditBot(bot) }, { label: "Delete", danger: true, onSelect: () => onDeleteBot(bot) }]}>
            <BotRow bot={bot} index={bots.indexOf(bot)} active={!mobile && currentGroupId === null && bot.id === currentId} onOpen={() => onOpen(bot.id)} />
          </RowMenu>
        ))}
        {visibleGroups.map((group) => (
          <RowMenu key={group.id} actions={[{ label: "Rename", onSelect: () => onRenameGroup(group) }, { label: "Delete", danger: true, onSelect: () => onDeleteGroup(group) }]}>
            <GroupRow group={group} bots={bots} active={!mobile && group.id === currentGroupId} onOpen={() => onOpenGroup(group.id)} />
          </RowMenu>
        ))}
      </div>
      <div className={`flex shrink-0 items-center gap-2 px-3.5 pt-2 ${mobile ? "fb-safe-bottom" : "h-[50px] pb-3.5"}`}>
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fb-active text-[10px] font-medium text-fb-preview">Y</span>
        <span className="fb-callout min-w-0 flex-1 truncate">You</span>
        <PushToggle />
        <button type="button" aria-label="Sign out" className={iconButton} onClick={() => void authClient.signOut().then(() => window.location.reload())}><SignOutIcon size={14} /></button>
      </div>
    </div>
  );
}

function BotList({ onResize, onResizing, ...props }: ChatListProps & { onResize: (width: number) => void; onResizing: (resizing: boolean) => void }) {
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    onResizing(true);
    const move = (moveEvent: PointerEvent) => onResize(Math.min(maxSidebarWidth, Math.max(minSidebarWidth, moveEvent.clientX)));
    const stop = () => {
      onResizing(false);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };
  return (
    <Sidebar collapsible="offcanvas" className="border-0">
      <ChatList {...props} mobile={false} />
      <div role="separator" aria-orientation="vertical" aria-label="Resize sidebar" onPointerDown={startResize} className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize" />
    </Sidebar>
  );
}

function McpSection({ servers, enabled, onToggle, onAdd, onRemove, onConnect, onLibrary }: { servers: McpServerSummary[]; enabled: string[]; onToggle: (id: string) => void; onAdd: (input: { name: string; url: string; token: string }) => Promise<boolean>; onRemove: (id: string) => void; onConnect: (server: McpServerSummary) => void; onLibrary: () => void }) {
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
        <span className="text-fb-preview">Apps</span>
        <span className="flex">
          <button type="button" aria-label="App library" className={iconButton} onClick={onLibrary}><SquaresFourIcon size={12} /></button>
          <button type="button" aria-label="Add MCP server" className={iconButton} onClick={() => setAdding(!adding)}><PlusIcon size={12} /></button>
        </span>
      </div>
      {servers.map((server) => (
        <div key={server.id} className="flex items-center justify-between gap-2 border-t border-fb-line py-1.5">
          <button type="button" aria-pressed={enabled.includes(server.id)} onClick={() => onToggle(server.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
            <span className={`grid size-4 shrink-0 place-items-center rounded border ${enabled.includes(server.id) ? "border-fb-me bg-fb-me text-fb-me-text" : "border-fb-line"}`}>
              {enabled.includes(server.id) ? <CheckIcon size={10} /> : null}
            </span>
            <span className="min-w-0 truncate">{server.name}</span>
          </button>
          {server.auth === "oauth" && !server.hasToken ? <Button type="button" size="sm" className="w-fit" onClick={() => onConnect(server)}>Connect</Button> : null}
          {server.builtIn ? null : <button type="button" aria-label={`Remove ${server.name}`} className={iconButton} onClick={() => onRemove(server.id)}><XIcon size={12} /></button>}
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
          <Button type="submit" size="sm" className="w-fit" disabled={busy || form.name.trim() === "" || form.url.trim() === ""}>{busy ? "Connecting…" : "Add"}</Button>
        </form>
      ) : null}
    </div>
  );
}

function cliNameFrom(fileName: string): string {
  return fileName.toLowerCase().replace(/\.(exe|bin)$/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 40);
}

const fileInput = "text-xs file:mr-2 file:cursor-pointer file:rounded-full file:border-0 file:bg-fb-active file:px-2.5 file:py-1";

function macInstallCommand(): string {
  return `curl -fsSL ${window.location.origin}/mac/install.sh | sh`;
}

function MacSection({ status, enabled, onToggle, onApprove, onUnpair }: { status: MacStatus | null; enabled: boolean; onToggle: () => void; onApprove: (userCode: string) => void; onUnpair: () => void }) {
  const [showInstall, setShowInstall] = useState(false);
  const installCommand = macInstallCommand();
  return (
    <div className="flex flex-col">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-fb-preview">
          Mac
          {status?.paired === true ? <span aria-label={status.connected ? "Online" : "Offline"} className={`size-1.5 rounded-full ${status.connected ? "bg-green-500" : "bg-fb-faint"}`} /> : null}
          {status?.name != null ? <span className="truncate">{status.name}</span> : null}
        </span>
        {status?.paired === true ? (
          <button type="button" aria-label="Unpair Mac" className={iconButton} onClick={onUnpair}><XIcon size={12} /></button>
        ) : (
          <button type="button" aria-label="Connect a Mac" className={iconButton} onClick={() => setShowInstall(!showInstall)}><PlusIcon size={12} /></button>
        )}
      </div>
      {status?.paired === true ? (
        <>
          <button type="button" aria-pressed={enabled} onClick={onToggle} className="flex cursor-pointer items-center gap-2 border-t border-fb-line py-1.5 text-left">
            <span className={`grid size-4 shrink-0 place-items-center rounded border ${enabled ? "border-fb-me bg-fb-me text-fb-me-text" : "border-fb-line"}`}>{enabled ? <CheckIcon size={10} /> : null}</span>
            <span>Access</span>
          </button>
          {status.roots.map((root) => (
            <span key={root} className="border-t border-fb-line py-1.5 font-mono text-xs [overflow-wrap:anywhere]">{root}</span>
          ))}
        </>
      ) : null}
      {status?.pendingLink != null ? (
        <div className="flex items-center justify-between gap-2 border-t border-fb-line py-1.5">
          <span className="min-w-0 truncate">{status.pendingLink.name} · <span className="font-mono text-xs">{status.pendingLink.userCode}</span></span>
          <Button type="button" size="sm" className="w-fit" onClick={() => status.pendingLink !== null && onApprove(status.pendingLink.userCode)}>Connect</Button>
        </div>
      ) : null}
      {showInstall && status?.paired !== true ? (
        <div className="flex items-start gap-2 border-t border-fb-line pt-2">
          <code className="min-w-0 flex-1 font-mono text-xs [overflow-wrap:anywhere]">{installCommand}</code>
          <button type="button" aria-label="Copy" className={iconButton} onClick={() => void navigator.clipboard.writeText(installCommand)}><CopyIcon size={12} /></button>
        </div>
      ) : null}
    </div>
  );
}

function OwnSkillRows({ skills, onPublish }: { skills: OwnSkill[]; onPublish: (name: string) => void }) {
  return skills.map((skill) => (
    <div key={skill.name} className="flex items-center justify-between gap-2 border-t border-fb-line py-1.5" title={skill.description}>
      <span className="flex min-w-0 flex-1 items-center gap-2 text-fb-preview">
        <LockSimpleIcon size={14} className="shrink-0" />
        <span className="min-w-0 truncate font-mono text-xs">{skill.name}</span>
      </span>
      <button type="button" aria-label={`Publish ${skill.name}`} className={iconButton} onClick={() => onPublish(skill.name)}><UploadSimpleIcon size={12} /></button>
    </div>
  ));
}

function PoolSection({ title, items, enabled, onToggle, onRemove, form, children }: { title: string; items: CliSummary[]; enabled: string[]; onToggle: (name: string) => void; onRemove: (name: string) => void; form: (close: () => void) => ReactNode; children?: ReactNode }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-fb-preview">{title}</span>
        <button type="button" aria-label={`Add to ${title}`} className={iconButton} onClick={() => setAdding(!adding)}><PlusIcon size={12} /></button>
      </div>
      {items.map((item) => (
        <div key={item.name} className="flex items-center justify-between gap-2 border-t border-fb-line py-1.5">
          <button type="button" aria-pressed={enabled.includes(item.name)} title={item.description} onClick={() => onToggle(item.name)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
            <span className={`grid size-4 shrink-0 place-items-center rounded border ${enabled.includes(item.name) ? "border-fb-me bg-fb-me text-fb-me-text" : "border-fb-line"}`}>
              {enabled.includes(item.name) ? <CheckIcon size={10} /> : null}
            </span>
            <span className="min-w-0 truncate font-mono text-xs">{item.name}</span>
          </button>
          <button type="button" aria-label={`Remove ${item.name}`} className={iconButton} onClick={() => onRemove(item.name)}><XIcon size={12} /></button>
        </div>
      ))}
      {children}
      {adding ? <div className="border-t border-fb-line pt-2">{form(() => setAdding(false))}</div> : null}
    </div>
  );
}

function CliForm({ onAdd, onDone }: { onAdd: (input: { name: string; description: string; file: File }) => Promise<boolean>; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ name: string; description: string; file: File | null }>({ name: "", description: "", file: null });
  const submit = async () => {
    if (form.file === null) return;
    setBusy(true);
    const added = await onAdd({ name: form.name.trim(), description: form.description.trim(), file: form.file });
    setBusy(false);
    if (added) onDone();
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <input
        aria-label="File"
        type="file"
        className={fileInput}
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          setForm({ ...form, file, name: form.name === "" && file !== null ? cliNameFrom(file.name) : form.name });
        }}
      />
      <Input aria-label="Name" placeholder="Name" size="sm" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      <Input aria-label="Description" placeholder="Description" size="sm" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
      <Button type="submit" size="sm" className="w-fit" disabled={busy || form.file === null || form.name.trim() === ""}>{busy ? "Uploading…" : "Add"}</Button>
    </form>
  );
}

function SkillForm({ onAdd, onDone }: { onAdd: (file: File) => Promise<boolean>; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const submit = async () => {
    if (file === null) return;
    setBusy(true);
    const added = await onAdd(file);
    setBusy(false);
    if (added) onDone();
  };
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <input aria-label="SKILL.md or .tar.gz" type="file" accept=".md,.gz,.tgz" className={fileInput} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      <Button type="submit" size="sm" className="w-fit" disabled={busy || file === null}>{busy ? "Uploading…" : "Add"}</Button>
    </form>
  );
}

const fieldLabel = "flex flex-col items-stretch gap-1.5";
const fieldName = "fb-caption font-medium";

function Picker({ label, value, options, onChange }: { label: string; value: string; options: PickerOption[]; onChange: (value: string) => void }) {
  return (
    <div className={fieldLabel}>
      <span className={fieldName}>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DetailsPanel({ view, index, models, efforts, mcpServers, onModel, onEffort, onClear, onRole, onForget, onToggleMcp, onAddMcp, onRemoveMcp, onConnectServer, onLibrary, children }: { view: BotView; index: number; models: PickerOption[]; efforts: PickerOption[]; mcpServers: McpServerSummary[]; onModel: (model: string) => void; onEffort: (effort: string) => void; onClear: () => void; onRole: (role: string) => void; onForget: (index: number) => void; onToggleMcp: (id: string) => void; onAddMcp: (input: { name: string; url: string; token: string }) => Promise<boolean>; onRemoveMcp: (id: string) => void; onConnectServer: (server: McpServerSummary) => void; onLibrary: () => void; children: ReactNode }) {
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
      <Label className={fieldLabel}>
        <span className={fieldName}>Role</span>
        <Input
          size="sm"
          value={role}
          onChange={(event) => setRole(event.target.value)}
          onBlur={saveRole}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </Label>
      <div className="grid grid-cols-2 gap-2">
        <Picker label="Model" value={view.profile.model} options={models} onChange={onModel} />
        <Picker label="Effort" value={view.profile.effort} options={efforts} onChange={onEffort} />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-fb-preview">Folder</span>
        <span className="font-mono text-xs [overflow-wrap:anywhere]">{view.workspace.path}</span>
        <span className="text-fb-preview">Artifacts repo</span>
        <span className="font-mono text-xs [overflow-wrap:anywhere]">{view.workspace.repo}</span>
      </div>
      <McpSection servers={mcpServers} enabled={view.mcpServers.map((server) => server.id)} onToggle={onToggleMcp} onAdd={onAddMcp} onRemove={onRemoveMcp} onConnect={onConnectServer} onLibrary={onLibrary} />
      {children}
      <div className="flex flex-col">
        <span className="mb-1 text-fb-preview">Memory</span>
        {view.memory.map((item, index) => (
          <div key={`${index}:${item}`} className="flex items-start justify-between gap-2 border-t border-fb-line py-1.5">
            <span>{item}</span>
            <button type="button" aria-label="Forget" className={iconButton} onClick={() => onForget(index)}><XIcon size={12} /></button>
          </div>
        ))}
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={onClear}>Clear chat</Button>
    </div>
  );
}

function viewKeyOf(botId: string, threadId: string | null): string {
  return `${botId}:${threadId ?? "main"}`;
}

interface PendingMessage {
  key: string;
  viewKey: string;
  text: string;
  baseline: number;
}

function sentCount(view: BotView, text: string): number {
  return view.items.filter((item) => item.kind === "user" && item.text === text).length;
}

function ThreadBar({ threads, projects, current, onOpen, onNew, onRename, onClose }: { threads: ThreadSummary[]; projects: string[]; current: string | null; onOpen: (id: string | null) => void; onNew: (project: string | null) => void; onRename: (thread: ThreadSummary) => void; onClose: (id: string) => void }) {
  const tab = "fb-callout flex h-7 max-w-[220px] shrink-0 cursor-pointer items-center gap-1 rounded-full px-3";
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b-[0.5px] border-fb-line px-3 [scrollbar-width:none]">
      <button type="button" className={`${tab} ${current === null ? "bg-fb-active font-medium text-fb-text" : "text-fb-preview hover:bg-fb-active"}`} onClick={() => onOpen(null)}>Main</button>
      {threads.map((thread) => (
        <RowMenu key={thread.id} className="shrink-0" actions={[{ label: "Rename", onSelect: () => onRename(thread) }]}>
          <span className={`${tab} pr-1 ${current === thread.id ? "bg-fb-active font-medium text-fb-text" : "text-fb-preview hover:bg-fb-active"}`}>
            {thread.project === null ? null : <span className="fb-caption shrink-0 rounded-full bg-fb-field px-1.5 text-fb-preview">{thread.project}</span>}
            <button type="button" className="min-w-0 cursor-pointer truncate" onClick={() => onOpen(thread.id)} onDoubleClick={() => onRename(thread)}>{thread.title === "" ? "New thread" : thread.title}</button>
            <button type="button" aria-label="Close thread" className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-fb-line" onClick={() => onClose(thread.id)}><XIcon size={10} /></button>
          </span>
        </RowMenu>
      ))}
      {projects.length === 0 ? (
        <button type="button" aria-label="Start thread" className={iconButton} onClick={() => onNew(null)}><PlusIcon size={14} /></button>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Start thread" className={iconButton}><PlusIcon size={14} /></DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => onNew(null)}>Own folder</DropdownMenuItem>
            <DropdownMenuSeparator />
            {projects.map((project) => (
              <DropdownMenuItem key={project} onSelect={() => onNew(project)}>{project}</DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

type Confirmation = { title: string; action: string; run: () => void };

function ConfirmDialog({ confirmation, onClose }: { confirmation: Confirmation; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>{confirmation.title}</DialogTitle>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => {
              onClose();
              confirmation.run();
            }}
          >
            {confirmation.action}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BotDialog({ title, submitLabel, initial, withRole, onSubmit, onClose }: { title: string; submitLabel: string; initial: { name: string; role: string }; withRole: boolean; onSubmit: (input: { name: string; role: string }) => void; onClose: () => void }) {
  const [name, setName] = useState(initial.name);
  const [role, setRole] = useState(initial.role);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>{title}</DialogTitle>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() !== "") onSubmit({ name: name.trim(), role: role.trim() });
          }}
        >
          <Input aria-label="Name" placeholder="Name" value={name} autoFocus onChange={(event) => setName(event.target.value)} />
          {withRole ? <Input aria-label="Role" placeholder="Role" value={role} onChange={(event) => setRole(event.target.value)} /> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={name.trim() === ""}>{submitLabel}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewGroup({ bots, onCreate, onClose }: { bots: BotSummary[]; onCreate: (input: { name: string; botIds: string[] }) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const valid = selected.length >= minGroupBots && selected.length <= maxGroupBots;
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((candidate) => candidate !== id) : [...selected, id]);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>New group</DialogTitle>
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
            <Button type="button" size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={!valid}>Create</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function Workspace() {
  const search = useSearch({ from: "/" });
  const navigate = useNavigate();
  const router = useRouter();
  const queries = useQueryClient();
  const mobile = useIsMobile();
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [overlay, setOverlay] = useState<"take" | "new" | "group" | null>(null);
  const [editingBot, setEditingBot] = useState<BotSummary | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<GroupSummary | null>(null);
  const [renamingThread, setRenamingThread] = useState<ThreadSummary | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [sidebarWidthPx, setSidebarWidthPx] = useState(sidebarWidth);
  const [resizingSidebar, setResizingSidebar] = useState(false);

  const go = (patch: Partial<WorkspaceSearch>, replace = false) => navigate({ to: "/", search: (previous) => ({ ...previous, ...patch }), replace });
  const back = (fallback: Partial<WorkspaceSearch>) => {
    if (router.history.canGoBack()) router.history.back();
    else void go(fallback, true);
  };

  const botsResult = useQuery(botsQuery);
  const bots = botsResult.data?.bots ?? [];
  const groups = botsResult.data?.groups ?? [];
  const models = botsResult.data?.models ?? [];
  const efforts = botsResult.data?.efforts ?? [];
  const projects = botsResult.data?.projects ?? [];
  const requestedBot = search.bot !== undefined && (botsResult.data === undefined || bots.some((bot) => bot.id === search.bot)) ? search.bot : undefined;
  const currentId = requestedBot ?? bots[0]?.id ?? null;
  const currentGroupId = search.group ?? null;
  const threadId = search.thread ?? null;
  const panel: Panel | null = search.panel ?? null;
  const factory = search.view === "3d";
  const mobileChat = search.bot !== undefined || search.group !== undefined;

  const viewResult = useQuery({ ...viewQuery(currentId ?? "", threadId), enabled: currentId !== null, placeholderData: keepPreviousData });
  const view = viewResult.data ?? null;
  const shown = viewResult.isPlaceholderData ? null : view;
  const busy = shown?.busy === true;

  const details = panel === "details";
  const computer = useQuery({ ...computerQuery, enabled: panel === "computer" || overlay === "take" }).data ?? null;
  const macStatus = useQuery({ ...macQuery, enabled: details }).data ?? null;
  const mcpServers = useQuery({ ...mcpQuery, enabled: details }).data?.servers ?? [];
  const clis = useQuery({ ...clisQuery, enabled: details }).data?.clis ?? [];
  const skills = useQuery({ ...skillsQuery, enabled: details }).data?.skills ?? [];
  const secrets = useQuery({ ...secretsQuery, enabled: details }).data?.secrets ?? [];
  const ownSkills = useQuery({ ...ownSkillsQuery(currentId ?? ""), enabled: details && currentId !== null }).data?.skills ?? [];
  const appsResult = useQuery({ ...appsQuery, enabled: libraryOpen });
  const library = libraryOpen ? (appsResult.data?.apps ?? null) : null;

  const refresh = (...queryKeys: QueryKey[]) => Promise.all(queryKeys.map((queryKey) => queries.invalidateQueries({ queryKey })));
  const loadBots = () => refresh(keys.bots);
  const loadView = (id: string, thread: string | null) => refresh(keys.view(id, thread));
  const loadMcp = () => refresh(keys.mcp);
  const loadPool = () => refresh(keys.clis, keys.skills);
  const loadMac = () => refresh(keys.mac);
  const loadOwnSkills = (id: string) => refresh(keys.ownSkills(id));
  const loadSecrets = () => refresh(keys.secrets);

  const mobileRef = useRef(mobile);
  mobileRef.current = mobile;
  useEffect(() => {
    if (!mobileRef.current || router.history.canGoBack()) return;
    const { bot, group, thread } = search;
    if (bot === undefined && group === undefined) return;
    void navigate({ to: "/", search: {}, replace: true }).then(() => navigate({ to: "/", search: { bot, group, thread } }));
  }, [navigate, router]);

  useEffect(() => {
    const { connected, connectError } = search;
    if (connected === undefined && connectError === undefined) return;
    if (connected !== undefined) toast(`${connected} connected`);
    if (connectError !== undefined) toast.error("Sign-in failed", { description: connectError });
    void navigate({ to: "/", search: (previous) => ({ ...previous, connected: undefined, connectError: undefined }), replace: true });
  }, [search, navigate]);

  useEffect(
    () =>
      onNotificationOpen((url) => {
        const target = { bot: url.searchParams.get("bot") ?? undefined, group: url.searchParams.get("group") ?? undefined, thread: url.searchParams.get("thread") ?? undefined };
        if (target.bot === undefined && target.group === undefined) return;
        if (mobileRef.current) void navigate({ to: "/", search: {}, replace: true }).then(() => navigate({ to: "/", search: target }));
        else void navigate({ to: "/", search: target });
      }),
    [navigate],
  );

  const guard = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await work();
    } catch (error) {
      showError(error);
      return undefined;
    }
  }, []);

  const togglePoolItem = async (current: BotView | null, kind: PoolKind, name: string) => {
    if (currentId === null || current === null) return;
    const enabled = current[kind].map((item) => item.name);
    const next = enabled.includes(name) ? enabled.filter((candidate) => candidate !== name) : [...enabled, name];
    await guard(() => api.setBotPool(currentId, kind, next));
    await loadView(currentId, threadId);
  };

  const addToPool = async (work: () => Promise<{ name: string }>): Promise<boolean> => {
    const added = await guard(work);
    if (added === undefined) return false;
    toast(`${added.name} added`);
    await loadPool();
    return true;
  };

  const removeFromPool = (kind: PoolKind, name: string) => {
    setConfirmation({
      title: `Remove ${name} for every Bot?`,
      action: "Remove",
      run: () => void guard(() => api.removePoolItem(kind, name)).then(() => Promise.all([loadPool(), currentId !== null ? loadView(currentId, threadId) : undefined])),
    });
  };

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
    toast(`${added.server.name} connected`, { description: `${added.tools} tools` });
    await loadMcp();
    return true;
  };

  const openLibrary = () => {
    setLibraryOpen(true);
    return refresh(keys.apps);
  };

  const addApp = async (entry: AppEntry, token: string) => {
    const serverId = entry.serverId ?? (await guard(() => api.addApp(entry.id, token)))?.server.id;
    if (serverId === undefined) return;
    if (entry.auth === "none" || entry.auth === "apikey") {
      toast(`${entry.name} added`);
      await Promise.all([loadMcp(), openLibrary()]);
      return;
    }
    const started = await guard(() => api.connectServer(serverId));
    if (started === undefined) {
      await Promise.all([loadMcp(), openLibrary()]);
      return;
    }
    window.location.href = started.url;
  };

  const summary = bots.find((bot) => bot.id === currentId);
  const currentGroup = groups.find((group) => group.id === currentGroupId);
  const openBot = (id: string) => void go({ bot: id, group: undefined, thread: undefined, view: undefined });
  const newThread = async (project: string | null) => {
    if (currentId === null) return;
    const thread = await guard(() => api.startThread(currentId, project));
    if (thread !== undefined) void go({ thread: thread.id });
  };
  const closeThread = async (id: string) => {
    if (currentId === null) return;
    await guard(() => api.closeThread(currentId, id));
    if (threadId === id) void go({ thread: undefined }, true);
    await loadView(currentId, threadId === id ? null : threadId);
  };
  const deleteBot = async (bot: BotSummary) => {
    await guard(() => api.deleteBot(bot.id));
    if (currentId === bot.id) void go({ bot: undefined, thread: undefined, panel: undefined }, true);
    await loadBots();
  };
  const deleteGroup = async (group: GroupSummary) => {
    await guard(() => api.deleteGroup(group.id));
    if (currentGroupId === group.id) void go({ group: undefined }, true);
    await loadBots();
  };
  const openGroup = (id: string) => void go({ group: id, view: undefined, panel: panel === "details" ? undefined : (panel ?? undefined) });
  const openComputer = () => {
    setOverlay("take");
    if (currentGroupId === null && currentId !== null) void guard(() => api.showTab(currentId));
  };

  const send = async (text: string): Promise<boolean> => {
    if (currentId === null) return false;
    const message: PendingMessage = { key: crypto.randomUUID(), viewKey: viewKeyOf(currentId, threadId), text, baseline: shown === null ? 0 : sentCount(shown, text) };
    setPending((current) => [...current, message]);
    const sent = await guard(async () => {
      await (threadId === null ? api.send(currentId, text) : api.sendThread(currentId, threadId, text));
      return true;
    });
    if (sent === true) await loadView(currentId, threadId);
    setPending((current) => current.filter((item) => item.key !== message.key));
    return sent === true;
  };
  const shownPending = shown === null || currentId === null ? [] : pending.filter((item) => item.viewKey === viewKeyOf(currentId, threadId) && sentCount(shown, item.text) <= item.baseline);

  const closePanel = () => {
    if (mobile) back({ panel: undefined });
    else void go({ panel: undefined }, true);
  };
  const togglePanel = (next: Panel) => {
    if (panel === next) {
      closePanel();
      return;
    }
    void go({ panel: next }, !mobile || panel !== null);
  };
  const setFactory = (on: boolean) => void go({ view: on ? "3d" : undefined }, true);

  const listProps: ChatListProps = {
    bots,
    groups,
    currentId,
    currentGroupId,
    onOpen: openBot,
    onOpenGroup: openGroup,
    onNew: () => setOverlay("new"),
    onNewGroup: () => setOverlay("group"),
    onEditBot: setEditingBot,
    onDeleteBot: (bot) => setConfirmation({ title: `Delete ${bot.name}?`, action: "Delete", run: () => void deleteBot(bot) }),
    onRenameGroup: setRenamingGroup,
    onDeleteGroup: (group) => setConfirmation({ title: `Delete ${group.name}?`, action: "Delete", run: () => void deleteGroup(group) }),
  };

  const mobileHeader = (
    <header className="fb-safe-top shrink-0 border-b-[0.5px] border-fb-line bg-fb-pane/90 backdrop-blur-xl">
      <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center px-1.5">
        <button type="button" aria-label="Back" onClick={() => back({ bot: undefined, group: undefined, thread: undefined, panel: undefined })} className="flex size-11 cursor-pointer items-center justify-center justify-self-start rounded-full text-fb-text active:bg-fb-active">
          <CaretLeftIcon size={24} weight="bold" />
        </button>
        {currentGroup !== undefined ? (
          <div className="flex min-w-0 flex-col items-center gap-0.5">
            <GroupAvatars memberIds={currentGroup.memberIds} bots={bots} />
            <span className="fb-caption max-w-[50vw] truncate font-medium">{currentGroup.name}</span>
          </div>
        ) : summary === undefined ? (
          <span />
        ) : (
          <button type="button" onClick={() => togglePanel("details")} className="flex min-w-0 cursor-pointer flex-col items-center gap-0.5 rounded-xl px-2 py-0.5 active:bg-fb-active">
            <Avatar index={bots.indexOf(summary)} size={30} />
            <span className="fb-caption flex max-w-[50vw] items-center gap-0.5 font-medium">
              <span className="truncate">{summary.name}</span>
              <CaretRightIcon size={9} weight="bold" className="shrink-0 text-fb-faint" />
            </span>
          </button>
        )}
        <button type="button" aria-label="Computer" className={`justify-self-end ${iconButton} ${panel === "computer" ? "bg-fb-active text-fb-text" : ""}`} onClick={() => togglePanel("computer")}><MonitorIcon size={20} /></button>
      </div>
    </header>
  );

  const desktopHeader = (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b-[0.5px] border-fb-line px-3">
      {factory || currentGroup === undefined ? null : (
        <div className="flex min-w-0 items-center gap-2 py-1 pr-2.5 pl-1">
          <GroupAvatars memberIds={currentGroup.memberIds} bots={bots} />
          <span className="fb-body truncate font-semibold">{currentGroup.name}</span>
        </div>
      )}
      {factory || summary === undefined || currentGroup !== undefined ? null : (
        <button type="button" onClick={() => togglePanel("details")} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-full py-1 pr-2.5 pl-1 hover:bg-fb-active">
          <Avatar index={bots.indexOf(summary)} size={24} />
          <span className="fb-body truncate font-semibold">{summary.name}</span>
        </button>
      )}
      <div role="group" aria-label="View" className="fb-caption ml-auto flex h-7 shrink-0 items-center rounded-full bg-fb-field p-0.5 font-medium">
        <button type="button" aria-pressed={!factory} className={`${viewTab} ${factory ? "text-fb-preview" : "bg-fb-me text-fb-me-text"}`} onClick={() => setFactory(false)}>Chats</button>
        <button type="button" aria-pressed={factory} className={`${viewTab} ${factory ? "bg-fb-me text-fb-me-text" : "text-fb-preview"}`} onClick={() => setFactory(true)}>3D</button>
      </div>
      <button type="button" aria-label="Computer" className={`${iconButton} ${panel === "computer" ? "bg-fb-active text-fb-text" : ""}`} onClick={() => togglePanel("computer")}><MonitorIcon size={16} /></button>
    </header>
  );

  const chatBody =
    currentGroup === undefined ? (
      <>
        {summary === undefined ? null : (
          <ThreadBar threads={shown?.threads ?? view?.threads ?? []} projects={projects} current={threadId} onOpen={(id) => void go({ thread: id ?? undefined })} onNew={(project) => void newThread(project)} onRename={setRenamingThread} onClose={(id) => void closeThread(id)} />
        )}
        {shown === null ? <div className="flex-1" /> : <Transcript
          view={shown}
          bots={bots}
          pending={shownPending}
          onTakeOver={openComputer}
          cards={{
            onDecide: (approvalId, decision) => currentId !== null && void guard(() => api.decideApproval(currentId, approvalId, decision)).then(() => loadView(currentId, threadId)),
            onSubmitSecret: async (requestId, value) => {
              if (currentId === null) return false;
              const saved = await guard(() => api.submitSecret(currentId, requestId, value).then(() => true));
              await Promise.all([loadView(currentId, threadId), loadSecrets()]);
              return saved === true;
            },
            onDismissSecret: (requestId) => currentId !== null && void guard(() => api.dismissSecret(currentId, requestId)).then(() => loadView(currentId, threadId)),
            onConnect: (serverId, requestId) => currentId !== null && void guard(() => api.connectServer(serverId, { botId: currentId, requestId })).then((result) => { if (result !== undefined) window.location.href = result.url; }),
            onDismissConnection: (requestId) => currentId !== null && void guard(() => api.dismissConnection(currentId, requestId)).then(() => loadView(currentId, threadId)),
          }}
        />}
        {summary === undefined ? null : (
          <Composer
            key={`${summary.id}:${threadId ?? "main"}`}
            name={summary.name}
            busy={busy}
            autoFocus={!mobile}
            mentions={botMentions(bots).filter((mention) => mention.name !== summary.name)}
            onSend={send}
            onStop={() => currentId !== null && void guard(() => (threadId === null ? api.stop(currentId) : api.stopThread(currentId, threadId)))}
          />
        )}
      </>
    ) : (
      <GroupPane group={currentGroup} bots={bots} />
    );

  const panelView =
    panel === null ? null : (
          <aside className={mobile ? "fb-sheet fb-safe-top fixed inset-0 z-30 flex flex-col bg-fb-pane" : "flex w-[360px] shrink-0 flex-col border-l-[0.5px] border-fb-line bg-fb-pane"}>
            {mobile ? (
              <div className="grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b-[0.5px] border-fb-line px-4">
                <span />
                <span className="fb-body font-semibold">{panel === "computer" ? "Computer" : "Details"}</span>
                <button type="button" className="fb-body cursor-pointer justify-self-end font-semibold text-fb-action" onClick={closePanel}>Done</button>
              </div>
            ) : (
              <div className="flex h-12 shrink-0 items-center justify-between border-b-[0.5px] border-fb-line pr-2.5 pl-4">
                <span className="fb-body font-semibold">{panel === "computer" ? "Computer" : "Details"}</span>
                <button type="button" aria-label="Close" className={iconButton} onClick={closePanel}><XIcon size={14} /></button>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {panel === "computer" ? (
                <ComputerPanel
                  status={computer}
                  onOpen={openComputer}
                  onStart={() => void guard(api.startComputer).then((status) => status && queries.setQueryData(keys.computer, status))}
                  onStop={() => void guard(api.stopComputer).then((status) => status && queries.setQueryData(keys.computer, status))}
                />
              ) : null}
              {panel === "details" && shown !== null ? (
                <DetailsPanel
                  key={shown.profile.id}
                  view={shown}
                  index={summary === undefined ? 0 : bots.indexOf(summary)}
                  models={models}
                  efforts={efforts}
                  onModel={(model) => currentId !== null && void guard(() => api.setModel(currentId, model)).then(() => loadView(currentId, threadId))}
                  onEffort={(effort) => currentId !== null && void guard(() => api.setEffort(currentId, effort)).then(() => loadView(currentId, threadId))}
                  onClear={() => currentId !== null && setConfirmation({ title: `Clear ${shown.profile.name}'s main chat?`, action: "Clear", run: () => void guard(() => api.clearMain(currentId)).then(() => Promise.all([loadView(currentId, threadId), loadBots()])) })}
                  onRole={(role) => currentId !== null && void guard(() => api.setRole(currentId, role)).then(() => Promise.all([loadView(currentId, threadId), loadBots()]))}
                  onForget={(index) => currentId !== null && void guard(() => api.forget(currentId, index)).then(() => loadView(currentId, threadId))}
                  mcpServers={mcpServers}
                  onToggleMcp={(serverId) => void toggleMcp(shown, serverId)}
                  onAddMcp={addMcp}
                  onConnectServer={(server) => void guard(server.builtIn ? api.connectCodemode : () => api.connectServer(server.id)).then((result) => { if (result !== undefined) window.location.href = result.url; })}
                  onLibrary={() => void openLibrary()}
                  onRemoveMcp={(serverId) => void guard(() => api.removeMcpServer(serverId)).then(() => Promise.all([loadMcp(), currentId !== null ? loadView(currentId, threadId) : undefined]))}
                >
                  <RoutinesSection
                    routines={shown.routines}
                    onRun={(routineId) => currentId !== null && void guard(() => api.runRoutine(currentId, routineId)).then((result) => {
                      if (result !== undefined) toast(`${result.routine.title} started`);
                      return loadView(currentId, threadId);
                    })}
                    onPause={(routine) => currentId !== null && void guard(() => api.updateRoutine(currentId, routine.id, { paused: !routine.paused })).then(() => loadView(currentId, threadId))}
                    onDelete={(routine) => currentId !== null && setConfirmation({ title: `Delete ${routine.title}?`, action: "Delete", run: () => void guard(() => api.deleteRoutine(currentId, routine.id)).then(() => loadView(currentId, threadId)) })}
                    onCopyHook={(routine) => void navigator.clipboard.writeText(`${window.location.origin}${routine.hookPath}`).then(() => toast("Webhook copied"))}
                  />
                  <TrustSection
                    askFirst={shown.askFirst}
                    alwaysAllow={shown.alwaysAllow}
                    onAskFirst={() => currentId !== null && void guard(() => api.setAskFirst(currentId, !shown.askFirst)).then(() => loadView(currentId, threadId))}
                    onForgetRule={(rule) => currentId !== null && void guard(() => api.forgetRule(currentId, rule)).then(() => loadView(currentId, threadId))}
                  />
                  <SecretsSection
                    secrets={secrets}
                    botId={shown.profile.id}
                    onToggle={(secret) => currentId !== null && void guard(() => api.setSecretAccess(secret.name, currentId, !secret.botIds.includes(currentId))).then(() => Promise.all([loadSecrets(), loadView(currentId, threadId)]))}
                    onDelete={(secret) => setConfirmation({ title: `Delete ${secret.name} for every Bot?`, action: "Delete", run: () => void guard(() => api.deleteSecret(secret.name)).then(() => loadSecrets()) })}
                  />
                  <PoolSection
                    title="CLIs"
                    items={clis}
                    enabled={shown.clis.map((cli) => cli.name)}
                    onToggle={(name) => void togglePoolItem(shown, "clis", name)}
                    onRemove={(name) => removeFromPool("clis", name)}
                    form={(close) => <CliForm onDone={close} onAdd={(input) => addToPool(() => api.addCli(input.name, input.description, input.file))} />}
                  />
                  <PoolSection
                    title="Skills"
                    items={skills}
                    enabled={shown.skills.map((skill) => skill.name)}
                    onToggle={(name) => void togglePoolItem(shown, "skills", name)}
                    onRemove={(name) => removeFromPool("skills", name)}
                    form={(close) => <SkillForm onDone={close} onAdd={(file) => addToPool(() => api.addSkill(file))} />}
                  >
                    <OwnSkillRows
                      skills={ownSkills.filter((skill) => !skills.some((shared) => shared.name === skill.name))}
                      onPublish={(name) => currentId !== null && void addToPool(() => api.publishOwnSkill(currentId, name)).then(async (done) => {
                        if (done) await Promise.all([loadView(currentId, threadId), loadOwnSkills(currentId)]);
                      })}
                    />
                  </PoolSection>
                  <MacSection
                    status={macStatus}
                    enabled={shown.macAccess}
                    onToggle={() => currentId !== null && void guard(() => api.setBotMac(currentId, !shown.macAccess)).then(() => loadView(currentId, threadId))}
                    onApprove={(userCode) => void guard(() => api.approveMacLink(userCode)).then(() => loadMac())}
                    onUnpair={() => setConfirmation({ title: "Unpair this Mac?", action: "Unpair", run: () => void guard(api.unpairMac).then(() => loadMac()) })}
                  />
                  <ActivitySection actions={shown.actions} />
                </DetailsPanel>
              ) : null}
            </div>
          </aside>
        );

  const overlays = (
    <>
      {library === null ? null : <AppLibrary apps={library} categories={categoryLabels} onAdd={addApp} onClose={() => setLibraryOpen(false)} />}
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
        <BotDialog
          title="New Bot"
          submitLabel="Create"
          initial={{ name: "", role: "" }}
          withRole
          onClose={() => setOverlay(null)}
          onSubmit={(input) => {
            setOverlay(null);
            void guard(() => api.createBot(input)).then((bot) => {
              if (bot === undefined) return;
              void loadBots();
              openBot(bot.id);
            });
          }}
        />
      ) : null}
      {editingBot === null ? null : (
        <BotDialog
          title="Edit Bot"
          submitLabel="Save"
          initial={{ name: editingBot.name, role: editingBot.role }}
          withRole
          onClose={() => setEditingBot(null)}
          onSubmit={(input) => {
            const id = editingBot.id;
            setEditingBot(null);
            void guard(() => api.updateBot(id, input)).then(() => Promise.all([loadBots(), currentId === id ? loadView(id, threadId) : undefined]));
          }}
        />
      )}
      {renamingGroup === null ? null : (
        <BotDialog
          title="Rename group"
          submitLabel="Save"
          initial={{ name: renamingGroup.name, role: "" }}
          withRole={false}
          onClose={() => setRenamingGroup(null)}
          onSubmit={(input) => {
            const id = renamingGroup.id;
            setRenamingGroup(null);
            void guard(() => api.renameGroup(id, input.name)).then(() => loadBots());
          }}
        />
      )}
      {renamingThread === null ? null : (
        <BotDialog
          title="Rename thread"
          submitLabel="Save"
          initial={{ name: renamingThread.title, role: "" }}
          withRole={false}
          onClose={() => setRenamingThread(null)}
          onSubmit={(input) => {
            const id = renamingThread.id;
            setRenamingThread(null);
            if (currentId !== null) void guard(() => api.renameThread(currentId, id, input.name)).then(() => loadView(currentId, threadId));
          }}
        />
      )}
      {confirmation === null ? null : <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)} />}
      {overlay === "group" ? (
        <NewGroup
          bots={bots}
          onClose={() => setOverlay(null)}
          onCreate={(input) => {
            setOverlay(null);
            void guard(() => api.createGroup(input)).then((group) => {
              if (group === undefined) return;
              void loadBots();
              void go({ group: group.id });
            });
          }}
        />
      ) : null}
    </>
  );

  if (mobile) {
    return (
      <div className="fb-screen relative overflow-hidden bg-fb-pane">
        {mobileChat ? (
          <div key="chat" className="fb-push flex h-full min-w-0 flex-col bg-fb-pane">
            {mobileHeader}
            {chatBody}
          </div>
        ) : (
          <ChatList key="list" {...listProps} mobile />
        )}
        {panelView}
        {overlays}
      </div>
    );
  }

  return (
    <SidebarProvider
      defaultOpen
      style={{ "--sidebar-width": `${sidebarWidthPx}px` } as CSSProperties}
      className={`h-svh min-h-0 ${resizingSidebar ? "select-none [&_[data-slot=sidebar-container]]:transition-none [&_[data-slot=sidebar-gap]]:transition-none" : ""}`}
    >
      <BotList {...listProps} onResize={setSidebarWidthPx} onResizing={setResizingSidebar} />
      <div className="relative flex min-w-0 flex-1 overflow-hidden bg-fb-pane">
        <div className="flex min-w-0 flex-1 flex-col">
          {desktopHeader}
          {factory ? (
            <Suspense fallback={<div className="flex-1 bg-fb-factory-sky" />}>
              <FactoryView bots={bots} onOpen={openBot} />
            </Suspense>
          ) : chatBody}
        </div>
        {panelView}
      </div>
      {overlays}
    </SidebarProvider>
  );
}
