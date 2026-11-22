import { createMiddleware } from "@tanstack/react-start";

/**
 * Auth middleware for server functions: resolves the verified user id from the
 * session cookie. Never trust a client-sent id.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  // Dynamic imports keep `*.server` modules out of the browser bundle.
  const { assertSameSiteRequest } = await import("./isolation.server");
  const { requireUserId } = await import("./verify.server");
  assertSameSiteRequest();
  const userId = await requireUserId();
  return next({ context: { userId } });
});
