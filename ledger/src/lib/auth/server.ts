/**
 * Better Auth for this app (server-only): username + password, stored in the
 * app's own database (Neon when DATABASE_URL is set, embedded PGLite otherwise).
 *
 * Public sign-up is OFF. Accounts are created only by:
 *   - the one-time first-run setup (becomes the manager), or
 *   - the manager, from the Team tab (see ledger.functions.ts).
 *
 * Env (set these on Vercel): DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL.
 * NEVER import this from client code — use `@/lib/auth/client`.
 */
import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { ensureDbReady, getPglite } from "../db";
import { pgliteDialect } from "./pglite-dialect";

void ensureDbReady();

const env = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
};

// Dev-only secret that survives HMR; production must set BETTER_AUTH_SECRET.
const globalRef = globalThis as typeof globalThis & { __authDevSecret__?: string };
function devSecret(): string {
  globalRef.__authDevSecret__ ??= randomBytes(32).toString("hex");
  return globalRef.__authDevSecret__;
}

const vercelUrl = env("VERCEL_PROJECT_PRODUCTION_URL") ?? env("VERCEL_URL");
const explicitBaseURL =
  env("BETTER_AUTH_URL") ?? (vercelUrl ? `https://${vercelUrl}` : undefined);

const LOCAL_ORIGINS = ["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080"];

const baseURL = explicitBaseURL ?? {
  allowedHosts: ["localhost", "127.0.0.1", "[::1]"],
  protocol: "auto" as const,
  fallback: "http://localhost:8080",
};

const trustedOrigins: string[] = [
  ...(explicitBaseURL ? [explicitBaseURL] : []),
  ...(vercelUrl ? [`https://${vercelUrl}`] : []),
  ...(env("VERCEL_URL") ? [`https://${env("VERCEL_URL")}`] : []),
  ...LOCAL_ORIGINS,
];

const databaseUrl = env("DATABASE_URL");
const database = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : { dialect: pgliteDialect(() => getPglite()), type: "postgres" as const };

export const authConfigured = true;

export const auth = betterAuth({
  baseURL,
  secret: env("BETTER_AUTH_SECRET") ?? (process.env.NODE_ENV === "production" ? undefined : devSecret()),
  database,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  session: { cookieCache: { enabled: true, maxAge: 300 } },
  plugins: [
    username({
      minUsernameLength: 3,
      maxUsernameLength: 30,
    }),
    tanstackStartCookies(),
  ],
});

/** Synthetic address: Better Auth needs an email, staff only ever type a username. */
export function emailForUsername(name: string): string {
  return `${name.toLowerCase()}@users.invalid`;
}
