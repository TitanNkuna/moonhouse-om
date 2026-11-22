import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Better Auth client (browser). Same-origin `/api/auth/*`, cookie session. */
export const authClient = createAuthClient({
  plugins: [usernameClient()],
});

export const authEnabled = true;

export async function signInWithUsername(name: string, password: string): Promise<void> {
  const { error } = await authClient.signIn.username({ username: name.trim(), password });
  if (error) throw new Error(error.message || "Wrong username or password");
}

export async function signOut(redirectTo = "/login"): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) throw new Error(error.message ?? "Sign-out failed");
  window.location.href = redirectTo;
}
