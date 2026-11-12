import { useEffect, useMemo, useRef, useState } from "react";
import { api, type BotSummary, type BotView } from "../api";
import { botColors, palette } from "../Avatar";
import { activityOf } from "./activity";
import { FactoryScene, type ScreenPoint } from "./scene";
import { stationTags } from "./world";

const viewPollMs = 1500;

type Poll = <T>(key: string, work: () => Promise<T>) => Promise<T | undefined>;

export function FactoryView({ bots, poll, onOpen }: { bots: BotSummary[]; poll: Poll; onOpen: (id: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<FactoryScene | null>(null);
  const labels = useRef(new Map<string, HTMLElement>());
  const seenHandoffs = useRef(new Map<string, Set<string>>());
  const open = useRef(onOpen);
  open.current = onOpen;
  const [views, setViews] = useState<ReadonlyMap<string, BotView>>(new Map());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (container.current === null) return;
    const placeLabels = (points: ReadonlyMap<string, ScreenPoint>) => {
      for (const [key, label] of labels.current) {
        const point = points.get(key);
        label.style.visibility = point === undefined ? "hidden" : "visible";
        if (point !== undefined) label.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -100%)`;
      }
    };
    try {
      const created = new FactoryScene(container.current, palette.map((colors) => colors.main), { onPick: (id) => open.current(id), onFrame: placeLabels });
      scene.current = created;
      return () => {
        scene.current = null;
        created.dispose();
      };
    } catch {
      setFailed(true);
      return;
    }
  }, []);

  const busyIds = bots.filter((bot) => bot.typing).map((bot) => bot.id).join(",");
  useEffect(() => {
    const ids = busyIds === "" ? [] : busyIds.split(",");
    let cancelled = false;
    const load = async () => {
      const results = await Promise.all(ids.map((id) => poll(`factory:${id}`, () => api.bot(id))));
      if (cancelled) return;
      setViews((current) => new Map(ids.flatMap((id, index) => {
        const view = results[index] ?? current.get(id);
        return view === undefined ? [] : [[id, view]];
      })));
    };
    void load();
    const timer = setInterval(() => void load(), viewPollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [busyIds, poll]);

  const activities = useMemo(() => new Map(bots.map((bot) => [bot.id, activityOf(bot, views.get(bot.id))])), [bots, views]);

  useEffect(() => {
    scene.current?.setBots(bots.map((bot, index) => {
      const activity = activities.get(bot.id);
      return { id: bot.id, ...botColors(index), station: activity?.station ?? "home", alert: activity?.alert === true, working: bot.typing };
    }));
  }, [bots, activities]);

  useEffect(() => {
    for (const [id, view] of views) {
      const handoffs = view.items.flatMap((item) => (item.kind === "handoff" ? [item] : []));
      const seen = seenHandoffs.current.get(id);
      seenHandoffs.current.set(id, new Set(handoffs.map((item) => item.id)));
      if (seen === undefined) continue;
      for (const handoff of handoffs) {
        const target = bots.find((bot) => bot.name.toLowerCase() === handoff.to.toLowerCase());
        if (!seen.has(handoff.id) && target !== undefined) scene.current?.sendPacket(id, target.id);
      }
    }
  }, [views, bots]);

  const track = (key: string) => (label: HTMLElement | null) => {
    if (label === null) labels.current.delete(key);
    else labels.current.set(key, label);
  };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-fb-factory-sky">
      <div ref={container} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
      {failed ? <div className="fb-callout absolute inset-0 grid place-items-center text-fb-factory-ink">3D view is unavailable</div> : null}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {failed ? null : stationTags.map((tag) => (
          <span key={tag.key} ref={track(`station:${tag.key}`)} style={{ visibility: "hidden" }} className="fb-factory-tag absolute top-0 left-0 text-[10px] leading-3 font-bold tracking-[0.14em] whitespace-nowrap text-fb-factory-ink uppercase">{tag.label}</span>
        ))}
        {failed ? null : bots.map((bot, index) => {
          const activity = activities.get(bot.id);
          const alert = activity?.alert === true;
          return (
            <button
              key={bot.id}
              ref={track(`bot:${bot.id}`)}
              type="button"
              style={{ visibility: "hidden" }}
              onClick={() => onOpen(bot.id)}
              className={`fb-caption pointer-events-auto absolute top-0 left-0 flex h-6 cursor-pointer items-center gap-1.5 rounded-full px-2.5 whitespace-nowrap shadow-sm ${alert ? "bg-fb-unread text-white" : "bg-fb-pane text-fb-text"}`}
            >
              <i className="size-2 shrink-0 rounded-full" style={{ background: alert ? "#ffffff" : botColors(index).main }} />
              <span className="font-semibold">{bot.name}</span>
              {activity === undefined || activity.label === "" ? null : <span className="font-mono text-[11px] text-fb-preview">{activity.label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
