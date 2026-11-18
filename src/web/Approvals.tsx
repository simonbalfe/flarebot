import { Button, Input } from "@cloudflare/kumo";
import { CheckIcon, KeyIcon, ShieldCheckIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { ActionEntry, ApprovalSummary, SecretRequestSummary, SecretSummary } from "./api";
import { formatListTime } from "./format";

const card = "fb-bubble my-1 flex flex-col gap-2 self-start bg-fb-control p-4 text-fb-text ring-1 ring-fb-action/50";
const cardLabel = "fb-caption flex items-center gap-1.5 font-semibold text-fb-control-text";
const primary = "rounded-full! bg-fb-action! font-semibold! text-fb-action-text!";
const secondary = "rounded-full!";
const iconButton = "grid size-9 cursor-pointer place-items-center rounded-full text-fb-preview hover:bg-fb-active hover:text-fb-text md:size-7";

export type Decision = "once" | "always" | "deny";

export function ApprovalCard({ approval, onDecide }: { approval: ApprovalSummary; onDecide: (decision: Decision) => void }) {
  const [busy, setBusy] = useState(false);
  const decide = (decision: Decision) => {
    setBusy(true);
    onDecide(decision);
  };
  return (
    <div className={card}>
      <span className={cardLabel}>
        <ShieldCheckIcon size={14} weight="fill" />
        Needs approval
      </span>
      <span className="text-[15px] font-semibold leading-5 [overflow-wrap:anywhere]">{approval.title}</span>
      {approval.detail === "" ? null : <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-fb-preview [overflow-wrap:anywhere]">{approval.detail}</pre>}
      <div className="mt-1 flex flex-wrap gap-2">
        <Button size="sm" className={primary} disabled={busy} onClick={() => decide("once")}>{approval.kind === "secret" ? "Allow" : "Allow once"}</Button>
        {approval.canAlways ? <Button size="sm" variant="secondary" className={secondary} disabled={busy} onClick={() => decide("always")}>Always allow</Button> : null}
        <Button size="sm" variant="secondary" className={secondary} disabled={busy} onClick={() => decide("deny")}>Deny</Button>
      </div>
    </div>
  );
}

export function SecretCard({ request, onSubmit, onDismiss }: { request: SecretRequestSummary; onSubmit: (value: string) => Promise<boolean>; onDismiss: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className={card}
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        if (value === "") return;
        setBusy(true);
        void onSubmit(value).then((saved) => {
          setBusy(false);
          if (saved) setValue("");
        });
      }}
    >
      <span className={cardLabel}>
        <KeyIcon size={14} weight="fill" />
        Secure Form
      </span>
      <span className="text-[15px] font-semibold leading-5">{request.site}</span>
      <span>{request.purpose}</span>
      <Input aria-label={request.name} label={request.name} type="password" autoComplete="new-password" size="sm" value={value} onChange={(event) => setValue(event.target.value)} />
      <div className="mt-1 flex flex-wrap gap-2">
        <Button type="submit" size="sm" className={primary} disabled={busy || value === ""}>Save</Button>
        <Button type="button" size="sm" variant="secondary" className={secondary} disabled={busy} onClick={onDismiss}>Dismiss</Button>
      </div>
    </form>
  );
}

function Check({ on }: { on: boolean }) {
  return <span className={`grid size-4 shrink-0 place-items-center rounded border ${on ? "border-fb-me bg-fb-me text-fb-me-text" : "border-fb-line"}`}>{on ? <CheckIcon size={10} /> : null}</span>;
}

export function TrustSection({ askFirst, alwaysAllow, onAskFirst, onForgetRule }: { askFirst: boolean; alwaysAllow: string[]; onAskFirst: () => void; onForgetRule: (rule: string) => void }) {
  return (
    <div className="flex flex-col">
      <span className="mb-1 text-fb-preview">Approvals</span>
      <button type="button" aria-pressed={askFirst} onClick={onAskFirst} className="flex cursor-pointer items-center gap-2 border-t border-fb-line py-1.5 text-left">
        <Check on={askFirst} />
        <span>Ask first</span>
      </button>
      {alwaysAllow.map((rule) => (
        <div key={rule} className="flex items-center justify-between gap-2 border-t border-fb-line py-1.5">
          <span className="min-w-0 truncate font-mono text-xs">{rule}</span>
          <button type="button" aria-label={`Stop always allowing ${rule}`} className={iconButton} onClick={() => onForgetRule(rule)}><XIcon size={12} /></button>
        </div>
      ))}
    </div>
  );
}

export function SecretsSection({ secrets, botId, onToggle, onDelete }: { secrets: SecretSummary[]; botId: string; onToggle: (secret: SecretSummary) => void; onDelete: (secret: SecretSummary) => void }) {
  if (secrets.length === 0) return null;
  return (
    <div className="flex flex-col">
      <span className="mb-1 text-fb-preview">Secrets</span>
      {secrets.map((secret) => (
        <div key={secret.name} className="flex items-center justify-between gap-2 border-t border-fb-line py-1.5">
          <button type="button" aria-pressed={secret.botIds.includes(botId)} onClick={() => onToggle(secret)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
            <Check on={secret.botIds.includes(botId)} />
            <span className="min-w-0 truncate font-mono text-xs">{secret.name}</span>
          </button>
          <button type="button" aria-label={`Delete ${secret.name}`} className={iconButton} onClick={() => onDelete(secret)}><XIcon size={12} /></button>
        </div>
      ))}
    </div>
  );
}

export function ActivitySection({ actions }: { actions: ActionEntry[] }) {
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="mb-1 w-fit cursor-pointer text-fb-preview hover:text-fb-text">Activity</button>
      {open
        ? actions.map((action) => (
            <div key={action.id} className="flex flex-col border-t border-fb-line py-1.5">
              <span className="[overflow-wrap:anywhere]">{action.summary}</span>
              <span className="fb-caption text-fb-preview">{formatListTime(action.at)} · {action.kind} · {action.outcome}</span>
            </div>
          ))
        : null}
    </div>
  );
}
