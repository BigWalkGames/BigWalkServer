import { ServerError } from "colyseus";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Checks who is joining a room, using the player's Supabase session token.
 *
 * The client sends `{ token: <supabase access token> }` in the join options. The
 * server verifies the signature and the issuer with Supabase's PUBLIC keys, so no
 * database access and no secret key is needed (a legacy project that still signs
 * with a shared secret can set SUPABASE_JWT_SECRET instead).
 *
 * Settings (environment variables):
 *   REQUIRE_AUTH=true     turn the check on. Off by default so local development and
 *                         the tests work without Supabase. Turn it on for any server
 *                         that is reachable from the internet.
 *   SUPABASE_URL          your project URL, e.g. https://abcd.supabase.co
 *   SUPABASE_JWT_SECRET   only for legacy HS256 projects
 */

export interface AuthUser {
  /** Supabase user id (the token's `sub`). */
  id: string;
  /** True for guest (anonymous) accounts. */
  anonymous: boolean;
}

const MAX_TOKEN_LENGTH = 4096;

export const authRequired = () => process.env.REQUIRE_AUTH === "true";

/** Throws at startup if auth is on but there is nothing to verify against. */
export function assertAuthConfig() {
  if (!authRequired()) return;
  if (!process.env.SUPABASE_URL) {
    throw new Error("REQUIRE_AUTH=true needs SUPABASE_URL (your Supabase project URL)");
  }
}

let keyResolver: JWTVerifyGetKey | undefined;

/** Tests use this to supply their own keys instead of fetching Supabase's. */
export function setKeyResolverForTests(resolver: JWTVerifyGetKey | undefined) {
  keyResolver = resolver;
}

function issuer() {
  return `${process.env.SUPABASE_URL!.replace(/\/+$/, "")}/auth/v1`;
}

let remoteKeys: JWTVerifyGetKey | undefined;
function resolveKeys(): JWTVerifyGetKey {
  if (keyResolver) return keyResolver;
  remoteKeys ??= createRemoteJWKSet(new URL(`${issuer()}/.well-known/jwks.json`));
  return remoteKeys;
}

/**
 * Use as a room's `onAuth`. Returns the user when the token is valid (or when auth is
 * off), and throws a 401 otherwise. The error never says WHY, so it can't be used to
 * probe the check.
 */
export async function authenticate(token: unknown): Promise<AuthUser> {
  if (!authRequired()) return { id: "local", anonymous: true };

  const reject = () => new ServerError(401, "authentication failed");
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw reject();
  }

  try {
    const secret = process.env.SUPABASE_JWT_SECRET;
    const options = { issuer: issuer(), audience: "authenticated" };
    const { payload } = secret && !keyResolver
      ? await jwtVerify(token, new TextEncoder().encode(secret), { ...options, algorithms: ["HS256"] })
      : await jwtVerify(token, resolveKeys(), { ...options, algorithms: ["ES256", "RS256"] });

    if (typeof payload.sub !== "string" || payload.sub.length === 0) throw reject();
    return { id: payload.sub, anonymous: payload.is_anonymous === true };
  } catch (error) {
    if (error instanceof ServerError) throw error;
    throw reject();
  }
}
