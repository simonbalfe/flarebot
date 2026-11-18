import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationLabel, ConfirmationTitle } from "@/components/ai-elements/confirmation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckIcon, KeyIcon, ShieldCheckIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { ActionEntry, ApprovalSummary, SecretRequestSummary, SecretSummary } from "./api";
import { formatListTime } from "./format";

const iconButton = "grid size-9 cursor-pointer place-items-center rounded-full text-fb-preview hover:bg-fb-active hover:text-fb-text md:size-7";

export type Decision = "once" | "always" | "deny";

export function ApprovalCard({ approval, onDecide }: { approval: ApprovalSummary; onDecide: (decision: Decision) => void }) {
  const [busy, setBusy] = useState(false);
  const decide = (decision: Decision) => {
    setBusy(true);
    onDecide(decision);
  };
  return (
    <Confirmation>
      <ConfirmationLabel icon={<ShieldCheckIcon size={14} weight="fill" />}>Needs approval</ConfirmationLabel>
      <ConfirmationTitle>{approval.title}</ConfirmationTitle>
      {approval.detail === "" ? null : <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-fb-preview [overflow-wrap:anywhere]">{approval.detail}</pre>}
      <ConfirmationActions>
        <ConfirmationAction variant="action" disabled={busy} onClick={() => decide("once")}>{approval.kind === "secret" ? "Allow" : "Allow once"}</ConfirmationAction>
        {approval.canAlways ? <ConfirmationAction variant="secondary" disabled={busy} onClick={() => decide("always")}>Always allow</ConfirmationAction> : null}
        <ConfirmationAction variant="secondary" disabled={busy} onClick={() => decide("deny")}>Deny</ConfirmationAction>
      </ConfirmationActions>
    </Confirmation>
  );
}

export function SecretCard({ request, onSubmit, onDismiss }: { request: SecretRequestSummary; onSubmit: (value: string) => Promise<boolean>; onDismiss: () => void }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Confirmation>
      <form
        className="flex flex-col gap-2"
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
        <ConfirmationLabel icon={<KeyIcon size={14} weight="fill" />}>Secure Form</ConfirmationLabel>
        <ConfirmationTitle>{request.site}</ConfirmationTitle>
        <span>{request.purpose}</span>
        <Label className="flex flex-col items-start gap-1.5">
          <span className="fb-caption font-medium">{request.name}</span>
          <Input type="password" autoComplete="new-password" size="sm" value={value} onChange={(event) => setValue(event.target.value)} />
        </Label>
        <ConfirmationActions>
          <ConfirmationAction type="submit" variant="action" disabled={busy || value === ""}>Save</ConfirmationAction>
          <ConfirmationAction variant="secondary" disabled={busy} onClick={onDismiss}>Dismiss</ConfirmationAction>
        </ConfirmationActions>
      </form>
    </Confirmation>
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
