import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";

const roundButton = "grid size-7 shrink-0 cursor-pointer place-items-center rounded-full bg-fb-me text-fb-me-text disabled:cursor-default";

export function Composer({ name, busy, onSend, onStop }: { name: string; busy: boolean; onSend: (text: string) => void; onStop: () => void }) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const text = draft.trim();
    if (text === "") return;
    setDraft("");
    onSend(text);
  };
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit();
  };
  return (
    <form onSubmit={onSubmit} className="w-full px-5 pb-4 pt-1">
      <div className="flex items-end gap-2 rounded-[22px] border-[0.5px] border-fb-field-line bg-fb-bot py-1.5 pr-1.5 pl-4">
        <textarea
          aria-label="Message"
          placeholder={`Message ${name}`}
          value={draft}
          rows={1}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          className="fb-body field-sizing-content max-h-40 min-h-7 flex-1 resize-none bg-transparent py-1 text-fb-text outline-none placeholder:text-fb-faint"
        />
        {busy && draft.trim() === "" ? (
          <button type="button" aria-label="Stop" className={roundButton} onClick={onStop}><StopIcon size={12} weight="fill" /></button>
        ) : (
          <button type="submit" aria-label="Send" disabled={draft.trim() === ""} className={roundButton}><ArrowUpIcon size={14} weight="bold" /></button>
        )}
      </div>
    </form>
  );
}
