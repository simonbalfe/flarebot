import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { type SyntheticEvent, useState } from "react";
import { type ComputerStatus, screenUrl } from "./api";
import { useIsMobile } from "./mobile";

function Screen({ title, viewOnly, showControls = false }: { title: string; viewOnly: boolean; showControls?: boolean }) {
  const hideControls = (event: SyntheticEvent<HTMLIFrameElement>) => {
    const page = event.currentTarget.contentDocument;
    if (page === null || showControls) return;
    const style = page.createElement("style");
    style.textContent = "#noVNC_control_bar_anchor{display:none!important}";
    page.head.appendChild(style);
  };
  return <iframe title={title} src={screenUrl(viewOnly)} onLoad={hideControls} className={`absolute inset-0 size-full border-0 ${viewOnly ? "pointer-events-none" : ""}`} />;
}

export function ComputerPanel({ status, onOpen, onStart, onStop }: { status: ComputerStatus | null; onOpen: () => void; onStart: () => void; onStop: () => void }) {
  const running = status?.running === true;
  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[16/10] overflow-hidden rounded-[18px] bg-fb-sidebar">
        {running ? (
          <button type="button" aria-label="Open computer" onClick={onOpen} className="absolute inset-0 cursor-pointer"><Screen title="Computer preview" viewOnly /></button>
        ) : (
          <div className="absolute inset-0 grid place-items-center"><Button size="sm" onClick={onStart}>Start</Button></div>
        )}
      </div>
      <div className="fb-callout flex items-center justify-between">
        <span className="text-fb-preview">{running ? "Running" : "Sleeping"}</span>
        {running ? <Button size="sm" variant="secondary" onClick={onStop}>Stop</Button> : null}
      </div>
    </div>
  );
}

export function TakeOver({ name, onDone, onClose }: { name: string; onDone: () => void; onClose: () => void }) {
  const [mine, setMine] = useState(false);
  const mobile = useIsMobile();
  const bar = (
    <div className={`flex items-center justify-between gap-2 rounded-full py-1 pr-1 pl-3.5 ${mine ? "bg-fb-control text-fb-control-text" : "bg-fb-bot text-fb-preview"}`}>
      <DialogTitle className="fb-callout truncate font-medium">{mine ? "You're in control" : `${name} is in control`}</DialogTitle>
      {mine ? (
        <Button size="xs" className="shrink-0" onClick={onDone}>{mobile ? "Done" : "I'm done, continue"}</Button>
      ) : (
        <div className="flex shrink-0 gap-1.5">
          <Button size="xs" onClick={() => setMine(true)}>Take over</Button>
          <Button size="xs" variant="secondary" onClick={onClose}>Close</Button>
        </div>
      )}
    </div>
  );
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !mine) onClose(); }}>
      {mobile ? (
        <DialogContent aria-describedby={undefined} className="fb-sheet fb-safe-top inset-0 h-full w-full max-w-none translate-none gap-2 rounded-none p-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] shadow-none data-open:zoom-in-100 sm:max-w-none">
          {bar}
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-[16px] bg-fb-sidebar">
            <Screen key={String(mine)} title="Computer" viewOnly={!mine} showControls={mine} />
          </div>
        </DialogContent>
      ) : (
        <DialogContent aria-describedby={undefined} className="w-[calc(100vw-2rem)] max-w-[960px] gap-2 p-2.5 sm:max-w-[960px]">
          {bar}
          <div className="relative aspect-[16/10] overflow-hidden rounded-[20px] bg-fb-sidebar">
            <Screen key={String(mine)} title="Computer" viewOnly={!mine} />
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
