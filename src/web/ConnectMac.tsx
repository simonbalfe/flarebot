import { Button } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { api, type MacStatus } from "./api";
import { Avatar } from "./Avatar";

type Phase = { kind: "loading" } | { kind: "ready"; name: string; userCode: string } | { kind: "connecting" } | { kind: "connected"; name: string } | { kind: "expired" } | { kind: "failed"; message: string };

function phaseFor(status: MacStatus, userCode: string): Phase {
  if (status.pendingLink !== null && status.pendingLink.userCode === userCode) return { kind: "ready", name: status.pendingLink.name, userCode };
  return { kind: "expired" };
}

export function ConnectMac() {
  const userCode = (new URLSearchParams(window.location.search).get("code") ?? "").toUpperCase();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    api
      .mac()
      .then((status) => setPhase(phaseFor(status, userCode)))
      .catch((error: unknown) => setPhase({ kind: "failed", message: error instanceof Error ? error.message : String(error) }));
  }, [userCode]);

  const connect = async (name: string) => {
    setPhase({ kind: "connecting" });
    try {
      await api.approveMacLink(userCode);
      setPhase({ kind: "connected", name });
    } catch (error) {
      setPhase({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const title = phase.kind === "connected" ? `${phase.name} is connected` : phase.kind === "ready" ? `Connect ${phase.name}` : phase.kind === "expired" ? "This link has expired" : "Connect a Mac";

  return (
    <main className="grid h-svh place-items-center bg-fb-pane px-4 text-fb-text">
      <div className="flex w-full max-w-[320px] flex-col items-center gap-6 text-center">
        <div className="flex flex-col items-center gap-3">
          <Avatar index={0} size={56} />
          <h1 className="fb-body font-semibold">{title}</h1>
          {phase.kind === "ready" ? <span className="font-mono text-[22px] tracking-[0.2em]">{phase.userCode}</span> : null}
          {phase.kind === "failed" ? <span className="fb-caption text-red-500">{phase.message}</span> : null}
        </div>
        {phase.kind === "ready" ? (
          <Button type="button" className="w-full justify-center! rounded-full! bg-fb-me! text-fb-me-text!" onClick={() => void connect(phase.name)}>Connect</Button>
        ) : null}
        {phase.kind === "connecting" ? <Button type="button" className="w-full justify-center! rounded-full!" disabled>Connecting…</Button> : null}
        {phase.kind === "connected" || phase.kind === "expired" ? (
          <Button type="button" variant="secondary" className="w-full justify-center! rounded-full!" onClick={() => window.location.assign("/")}>Open flarebot</Button>
        ) : null}
      </div>
    </main>
  );
}
