import { useMemo } from "react";
import { authClient } from "./client";

export type AppUser = {
  id: string;
  displayName: string | null;
  username: string | null;
};

export type CurrentUserState = { user: AppUser | null; isPending: boolean };

/** `user` is null both while loading and when signed out — check `isPending`. */
export function useCurrentUserState(): CurrentUserState {
  const { data, isPending } = authClient.useSession();
  const u = data?.user as { id: string; name?: string; username?: string | null } | undefined;
  const id = u?.id;
  const displayName = u?.name ?? null;
  const username = u?.username ?? null;
  const user = useMemo<AppUser | null>(
    () => (id ? { id, displayName, username } : null),
    [id, displayName, username],
  );
  return useMemo(() => ({ user, isPending }), [user, isPending]);
}

export function useCurrentUser(): AppUser | null {
  return useCurrentUserState().user;
}
