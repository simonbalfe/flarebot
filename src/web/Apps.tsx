import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CheckIcon, MagnifyingGlassIcon, PlugsConnectedIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { AppEntry, ConnectionRequestSummary } from "./api";

const card = "fb-bubble my-1 flex flex-col gap-2 self-start bg-fb-control p-4 text-fb-text ring-1 ring-fb-action/50";
const chip = "fb-caption h-6 shrink-0 cursor-pointer rounded-full px-2.5";

export function AppIcon({ domain, name, size = 28 }: { domain: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (failed) return <span className="grid shrink-0 place-items-center rounded-lg bg-fb-active text-xs font-semibold text-fb-preview" style={style}>{name.slice(0, 1)}</span>;
  return <img alt="" src={`https://www.google.com/s2/favicons?${new URLSearchParams({ domain, sz: "64" })}`} className="shrink-0 rounded-lg bg-white object-contain p-0.5" style={style} loading="lazy" onError={() => setFailed(true)} />;
}

function AppRow({ app, categoryLabel, onAdd }: { app: AppEntry; categoryLabel: string; onAdd: (app: AppEntry, token: string) => Promise<void> }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const add = () => {
    setBusy(true);
    void onAdd(app, token).finally(() => setBusy(false));
  };
  const needsToken = app.auth === "apikey" && app.serverId === null;
  return (
    <div className="flex flex-col gap-2 border-t border-fb-line py-2">
      <div className="flex items-center gap-3">
        <AppIcon domain={app.domain} name={app.name} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{app.name}</span>
          <span className="fb-caption line-clamp-2 text-fb-preview">{categoryLabel} · {app.description}</span>
        </span>
        {app.connected ? (
          <span className="fb-caption flex shrink-0 items-center gap-1 text-fb-preview"><CheckIcon size={12} />Added</span>
        ) : !app.ready ? (
          <span className="fb-caption shrink-0 text-fb-faint" title={`Needs a registered OAuth app for ${app.name}`}>Setup</span>
        ) : needsToken ? null : (
          <Button size="sm" variant="action" className="shrink-0" disabled={busy} onClick={add}>{app.serverId === null ? (app.auth === "none" ? "Add" : "Connect") : "Sign in"}</Button>
        )}
      </div>
      {needsToken && app.ready ? (
        <form
          className="flex gap-2 pl-10"
          onSubmit={(event) => {
            event.preventDefault();
            if (token.trim() !== "") add();
          }}
        >
          <Input aria-label={`${app.name} API key`} placeholder="API key" type="password" size="sm" value={token} onChange={(event) => setToken(event.target.value)} />
          <Button type="submit" size="sm" variant="action" className="shrink-0" disabled={busy || token.trim() === ""}>Add</Button>
        </form>
      ) : null}
    </div>
  );
}

export function AppLibrary({ apps, categories, onAdd, onClose }: { apps: AppEntry[]; categories: Record<string, string>; onAdd: (app: AppEntry, token: string) => Promise<void>; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return apps.filter((app) => (category === null || app.category === category) && words.every((word) => `${app.name} ${app.description} ${app.category}`.toLowerCase().includes(word)));
  }, [apps, query, category]);
  const used = Object.keys(categories).filter((key) => apps.some((app) => app.category === key));
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-h-[min(720px,90dvh)] gap-3 p-5 sm:max-w-[640px]">
        <DialogTitle>Apps</DialogTitle>
        <div className="relative">
          <MagnifyingGlassIcon size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fb-faint" />
          <Input aria-label="Search apps" placeholder="Search" size="sm" className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]">
          <button type="button" className={`${chip} ${category === null ? "bg-fb-me text-fb-me-text" : "bg-fb-active"}`} onClick={() => setCategory(null)}>All</button>
          {used.map((key) => (
            <button key={key} type="button" className={`${chip} ${category === key ? "bg-fb-me text-fb-me-text" : "bg-fb-active"}`} onClick={() => setCategory(category === key ? null : key)}>{categories[key]}</button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto text-[13px] leading-[18px]">
          {shown.map((app) => <AppRow key={app.id} app={app} categoryLabel={categories[app.category] ?? app.category} onAdd={onAdd} />)}
          {shown.length === 0 ? <div className="fb-caption py-6 text-center text-fb-preview">No apps</div> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ConnectCard({ request, onConnect, onDismiss }: { request: ConnectionRequestSummary; onConnect: () => void; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={card}>
      <span className="fb-caption flex items-center gap-1.5 font-semibold text-fb-control-text">
        <PlugsConnectedIcon size={14} weight="fill" />
        Connect app
      </span>
      <span className="text-[15px] font-semibold leading-5">{request.name}</span>
      {request.reason === "" ? null : <span>{request.reason}</span>}
      <div className="mt-1 flex flex-wrap gap-2">
        <Button size="sm" variant="action" disabled={busy} onClick={() => { setBusy(true); onConnect(); }}>Connect</Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onDismiss}>Dismiss</Button>
      </div>
    </div>
  );
}
