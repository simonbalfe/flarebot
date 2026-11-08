import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react";
import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";
import { Avatar, type MentionOption } from "./Avatar";

const roundButton = "grid size-8 shrink-0 md:size-7 cursor-pointer place-items-center rounded-full bg-fb-me text-fb-me-text disabled:cursor-default";

const mentionPattern = /(^|\s)@([^\s@]*)$/;

export function Composer({ name, busy, mentions, onSend, onStop, autoFocus = true }: { name: string; busy: boolean; mentions: MentionOption[]; onSend: (text: string) => void; onStop: () => void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState("");
  const [cursor, setCursor] = useState(0);
  const [highlighted, setHighlighted] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const query = draft.slice(0, cursor).match(mentionPattern)?.[2];
  const matches = query === undefined || dismissed ? [] : mentions.filter((mention) => mention.name.toLowerCase().startsWith(query.toLowerCase()));
  const selected = Math.min(highlighted, Math.max(matches.length - 1, 0));

  const insertMention = (mention: string) => {
    const before = draft.slice(0, cursor).replace(/@[^\s@]*$/, `@${mention} `);
    setDraft(before + draft.slice(cursor));
    setCursor(before.length);
    setHighlighted(0);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(before.length, before.length);
    });
  };

  const onMentionKey = (event: KeyboardEvent): boolean => {
    const choice = matches[selected];
    if (choice === undefined) return false;
    if (event.key === "ArrowDown") setHighlighted((selected + 1) % matches.length);
    else if (event.key === "ArrowUp") setHighlighted((selected - 1 + matches.length) % matches.length);
    else if (event.key === "Enter" || event.key === "Tab") insertMention(choice.name);
    else if (event.key === "Escape") setDismissed(true);
    else return false;
    event.preventDefault();
    return true;
  };

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
    <form onSubmit={onSubmit} className="fb-safe-bottom relative w-full px-3 pt-1 md:px-5 md:pb-4">
      {matches.length === 0 ? null : (
        <div role="listbox" aria-label="Mentions" className="fb-continuous absolute bottom-full left-5 z-20 mb-1 flex max-h-60 min-w-48 flex-col overflow-y-auto rounded-[16px] border-[0.5px] border-fb-field-line bg-fb-pane p-1 shadow-lg">
          {matches.map((mention, index) => (
            <button
              key={mention.name}
              type="button"
              role="option"
              aria-selected={index === selected}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertMention(mention.name)}
              className={`fb-callout flex cursor-pointer items-center gap-2 rounded-[12px] px-2.5 py-1.5 text-left text-fb-text ${index === selected ? "bg-fb-active" : ""}`}
            >
              {mention.index === null ? null : <Avatar index={mention.index} size={20} />}
              {mention.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-[22px] border-[0.5px] border-fb-field-line bg-fb-bot py-1.5 pr-1.5 pl-4">
        <textarea
          ref={field}
          aria-label="Message"
          placeholder={`Message ${name}`}
          value={draft}
          rows={1}
          autoFocus={autoFocus}
          onChange={(event) => {
            setDraft(event.target.value);
            setCursor(event.target.selectionStart);
            setHighlighted(0);
            setDismissed(false);
          }}
          onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            if (onMentionKey(event)) return;
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
