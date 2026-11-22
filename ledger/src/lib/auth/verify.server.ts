import { getRequest } from "@tanstack/react-start/server";
import { auth } from "./server";

/** Thrown when the caller has no valid session. Message is a stable contract. */
export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

export type VerifiedUser = { id: string; username: string | null };

/** Resolve the signed-in user from the request cookie, or null. */
export async function getSessionUser(): Promise<VerifiedUser | null> {
  const request = getRequest();
  if (!request) return null;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;
  const u = session.user as { id: string; username?: string | null };
  return { id: u.id, username: u.username ?? null };
}

export async function requireUserId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  return user.id;
}
