import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { signInWithUsername } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getSetupState, setupManager } from "@/lib/ledger.functions";

export const Route = createFileRoute("/login")({ component: Login });

type Setup = Awaited<ReturnType<typeof getSetupState>>;

function Login() {
  const navigate = useNavigate();
  const { user } = useCurrentUserState();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [appName, setAppName] = useState("");

  useEffect(() => {
    getSetupState()
      .then(setSetup)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    if (user) void navigate({ to: "/" });
  }, [user, navigate]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (setup?.needsSetup) {
        await setupManager({
          data: {
            name,
            username,
            password,
            businessName: businessName || "MoonHouse",
            appName: appName || "OM Ledger",
          },
        });
      }
      await signInWithUsername(username, password);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setBusy(false);
    }
  }

  if (!setup) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-muted">
        {error || "Loading…"}
      </main>
    );
  }

  const first = setup.needsSetup;
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <p className="text-sm font-medium tracking-wide text-brand uppercase">{setup.appName}</p>
        <h1 className="font-display text-4xl leading-tight">
          {first ? "Set up your business" : setup.businessName}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {first
            ? "Create the manager login. You will add staff and drivers from the Team tab afterwards."
            : "Sign in with the username and password your manager gave you."}
        </p>
        <div className="mt-6 grid gap-3">
          {first && (
            <>
              <Input label="Business name" value={businessName} onChange={setBusinessName} placeholder="MoonHouse" />
              <Input label="App name" value={appName} onChange={setAppName} placeholder="OM Ledger" />
              <Input label="Your name" value={name} onChange={setName} required />
            </>
          )}
          <Input label="Username" value={username} onChange={setUsername} required autoComplete="username" />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            required
            autoComplete={first ? "new-password" : "current-password"}
            hint={first ? "At least 8 characters" : undefined}
          />
        </div>
        {error && <p className="mt-3 rounded-xl bg-card px-4 py-3 text-sm text-danger ring-1 ring-line">{error}</p>}
        <button
          disabled={busy}
          className="mt-5 min-h-12 w-full rounded-xl bg-ink font-medium text-paper disabled:opacity-60"
        >
          {busy ? "Please wait…" : first ? "Create manager account" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

function Input(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  hint?: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      {props.label}
      <input
        type={props.type ?? "text"}
        required={props.required}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete}
        autoCapitalize="none"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="min-h-11 rounded-xl bg-card px-3 ring-1 ring-line outline-none focus:ring-2 focus:ring-brand"
      />
      {props.hint && <span className="text-xs text-muted">{props.hint}</span>}
    </label>
  );
}
