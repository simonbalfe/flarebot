import { CopyIcon, LightningIcon, PauseIcon, PlayIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { RoutineSummary } from "./api";
import { formatListTime } from "./format";

const iconButton = "grid size-9 cursor-pointer place-items-center rounded-full text-fb-preview hover:bg-fb-active hover:text-fb-text md:size-7";
const statusColor = { running: "bg-fb-action", succeeded: "bg-green-500", failed: "bg-fb-danger", skipped: "bg-fb-faint" } as const;

function nextLabel(routine: RoutineSummary): string {
  if (routine.paused) return "Paused";
  if (routine.nextAt === null) return "Done";
  return formatListTime(routine.nextAt);
}

function RoutineRow({ routine, onRun, onPause, onDelete, onCopyHook }: { routine: RoutineSummary; onRun: () => void; onPause: () => void; onDelete: () => void; onCopyHook: () => void }) {
  const [open, setOpen] = useState(false);
  const last = routine.runs[0];
  return (
    <div className="flex flex-col border-t border-fb-line py-1.5">
      <div className="flex items-center justify-between gap-1">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
          <span aria-label={last?.status ?? "Never run"} className={`size-1.5 shrink-0 rounded-full ${last === undefined ? "bg-fb-line" : statusColor[last.status]}`} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{routine.title}</span>
            <span className="fb-caption truncate text-fb-preview">{routine.scheduleText} · {nextLabel(routine)}</span>
          </span>
        </button>
        <button type="button" aria-label={`Run ${routine.title} now`} className={iconButton} onClick={onRun}><LightningIcon size={12} /></button>
        <button type="button" aria-label={routine.paused ? `Resume ${routine.title}` : `Pause ${routine.title}`} className={iconButton} onClick={onPause}>{routine.paused ? <PlayIcon size={12} /> : <PauseIcon size={12} />}</button>
        <button type="button" aria-label={`Delete ${routine.title}`} className={iconButton} onClick={onDelete}><XIcon size={12} /></button>
      </div>
      {open ? (
        <div className="flex flex-col gap-1.5 pt-1.5 pl-3.5">
          <span className="whitespace-pre-wrap text-fb-preview [overflow-wrap:anywhere]">{routine.prompt}</span>
          <span className="fb-caption font-mono text-fb-preview">{routine.schedule.kind === "cron" ? routine.schedule.cron : new Date(routine.schedule.at).toLocaleString()} · {routine.timezone}</span>
          <button type="button" onClick={onCopyHook} className="fb-caption flex w-fit cursor-pointer items-center gap-1 text-fb-preview hover:text-fb-text">
            <CopyIcon size={12} />
            Webhook
          </button>
          {routine.runs.map((run) => (
            <span key={run.id} className="fb-caption flex items-center gap-1.5 text-fb-preview" title={run.error ?? undefined}>
              <span className={`size-1.5 shrink-0 rounded-full ${statusColor[run.status]}`} />
              {formatListTime(run.at)} · {run.trigger} · {run.status}{run.error === null ? "" : ` · ${run.error}`}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RoutinesSection({ routines, onRun, onPause, onDelete, onCopyHook }: { routines: RoutineSummary[]; onRun: (id: string) => void; onPause: (routine: RoutineSummary) => void; onDelete: (routine: RoutineSummary) => void; onCopyHook: (routine: RoutineSummary) => void }) {
  if (routines.length === 0) return null;
  return (
    <div className="flex flex-col">
      <span className="mb-1 text-fb-preview">Routines</span>
      {routines.map((routine) => (
        <RoutineRow key={routine.id} routine={routine} onRun={() => onRun(routine.id)} onPause={() => onPause(routine)} onDelete={() => onDelete(routine)} onCopyHook={() => onCopyHook(routine)} />
      ))}
    </div>
  );
}
