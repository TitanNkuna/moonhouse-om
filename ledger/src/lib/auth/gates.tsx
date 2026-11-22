import { useState, type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { signOut } from "./client";
import { useCurrentUser, useCurrentUserState } from "./use-current-user";

export const SIGN_IN_PATH = "/login";

export function SignedIn({ children }: { children: ReactNode }) {
  const { user } = useCurrentUserState();
  return user ? <>{children}</> : null;
}

/** Renders only once we KNOW the visitor is signed out. */
export function SignedOut({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  if (isPending || user) return null;
  return <>{children}</>;
}

export function RedirectToSignIn({ to = SIGN_IN_PATH }: { to?: string }) {
  return <Navigate to={to} />;
}

export function UserButton() {
  const user = useCurrentUser();
  const [signingOut, setSigningOut] = useState(false);
  if (!user) return null;
  return (
    <button
      type="button"
      disabled={signingOut}
      onClick={() => {
        setSigningOut(true);
        void signOut().catch(() => setSigningOut(false));
      }}
      className="min-h-11 rounded-full px-4 text-sm ring-1 ring-line disabled:opacity-60"
    >
      {signingOut ? "Signing out…" : "Sign out"}
    </button>
  );
}
