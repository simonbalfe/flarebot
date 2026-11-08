import { Button, Input } from "@cloudflare/kumo";
import { useState } from "react";
import { authClient } from "./auth";
import { Avatar } from "./Avatar";

type Status = "idle" | "sending" | "sent" | "failed" | "badLink";

function initialStatus(): Status {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("error")) return "idle";
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  window.history.replaceState(null, "", url);
  return "badLink";
}

export function SignIn() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(initialStatus);

  const submit = async () => {
    setStatus("sending");
    const returnTo = `${window.location.pathname}${window.location.search}`;
    const { error } = await authClient.signIn.magicLink({ email: email.trim(), callbackURL: returnTo, errorCallbackURL: returnTo });
    setStatus(error === null ? "sent" : "failed");
  };

  return (
    <main className="grid h-svh place-items-center bg-fb-pane px-4 text-fb-text">
      <div className="flex w-full max-w-[320px] flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3">
          <Avatar index={0} size={56} />
          <h1 className="fb-body font-semibold">{status === "sent" ? "Check your email" : "flarebot"}</h1>
        </div>
        {status === "sent" ? null : (
          <form
            className="flex w-full flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Input aria-label="Email" type="email" placeholder="Email" autoComplete="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-full! px-4!" />
            <Button type="submit" className="w-full justify-center! rounded-full! bg-fb-me! text-fb-me-text! disabled:bg-fb-me! disabled:text-fb-me-text! disabled:opacity-100!" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Send link"}</Button>
            {status === "failed" ? <p role="alert" className="fb-caption text-center text-fb-preview">Couldn't send the link</p> : null}
            {status === "badLink" ? <p role="alert" className="fb-caption text-center text-fb-preview">Link expired or already used</p> : null}
          </form>
        )}
      </div>
    </main>
  );
}
