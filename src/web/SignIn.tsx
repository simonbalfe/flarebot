import { Button, Input } from "@cloudflare/kumo";
import { useState } from "react";
import { authClient } from "./auth";
import { Avatar } from "./Avatar";

type Step = { kind: "email"; error: string | null } | { kind: "sending" } | { kind: "code"; error: string | null } | { kind: "verifying" };

const codeLength = 6;
const primaryButton = "w-full justify-center! rounded-full! bg-fb-me! text-fb-me-text! disabled:bg-fb-me! disabled:text-fb-me-text! disabled:opacity-60!";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>({ kind: "email", error: null });

  const sendCode = async () => {
    setStep({ kind: "sending" });
    const { error } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: "sign-in" });
    setCode("");
    setStep(error === null ? { kind: "code", error: null } : { kind: "email", error: "Couldn't send the code" });
  };

  const verify = async (value: string) => {
    setStep({ kind: "verifying" });
    const { error } = await authClient.signIn.emailOtp({ email: email.trim(), otp: value });
    if (error === null) {
      window.location.reload();
      return;
    }
    setCode("");
    setStep({ kind: "code", error: "Wrong or expired code" });
  };

  const onCode = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, codeLength);
    setCode(digits);
    if (digits.length === codeLength) void verify(digits);
  };

  const onCodeStep = step.kind === "code" || step.kind === "verifying";

  return (
    <main className="fb-screen grid place-items-center bg-fb-pane px-6 text-fb-text">
      <div className="flex w-full max-w-[320px] flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <Avatar index={0} size={56} />
          <h1 className="fb-body font-semibold">{onCodeStep ? "Enter your code" : "flarebot"}</h1>
          {onCodeStep ? <p className="fb-callout text-fb-preview">{email.trim()}</p> : null}
        </div>
        {onCodeStep ? (
          <form
            className="flex w-full flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.length === codeLength) void verify(code);
            }}
          >
            <Input
              aria-label="Code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              autoFocus
              value={code}
              disabled={step.kind === "verifying"}
              onChange={(event) => onCode(event.target.value)}
              className="w-full rounded-full! px-4! text-center! font-mono! tracking-[0.4em]!"
            />
            <Button type="submit" className={primaryButton} disabled={step.kind === "verifying" || code.length !== codeLength}>{step.kind === "verifying" ? "Signing in…" : "Sign in"}</Button>
            {step.kind === "code" && step.error !== null ? <p role="alert" className="fb-caption text-center text-fb-preview">{step.error}</p> : null}
            <button type="button" className="fb-callout cursor-pointer text-fb-preview" onClick={() => setStep({ kind: "email", error: null })}>Use a different email</button>
          </form>
        ) : (
          <form
            className="flex w-full flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void sendCode();
            }}
          >
            <Input aria-label="Email" type="email" placeholder="Email" autoComplete="email" required autoFocus value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-full! px-4!" />
            <Button type="submit" className={primaryButton} disabled={step.kind === "sending"}>{step.kind === "sending" ? "Sending…" : "Send code"}</Button>
            {step.kind === "email" && step.error !== null ? <p role="alert" className="fb-caption text-center text-fb-preview">{step.error}</p> : null}
          </form>
        )}
      </div>
    </main>
  );
}
