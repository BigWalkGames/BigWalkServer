import assert from "assert";
import { SignJWT, generateKeyPair } from "jose";

type KeyLike = CryptoKey;
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { sharedServer } from "./helpers/server.js";
import { assertAuthConfig, authenticate, setKeyResolverForTests } from "../src/auth.js";

/**
 * Token check (P26): with REQUIRE_AUTH=true a player needs a valid Supabase token to join.
 * The tests sign tokens with their own key pair, so no Supabase project is involved.
 */

const URL_ = "https://example.supabase.co";
const ISSUER = `${URL_}/auth/v1`;

describe("Authentication", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  let privateKey: KeyLike;
  let otherKey: KeyLike;

  const token = (opts: { key?: KeyLike; issuer?: string; audience?: string; expires?: string; sub?: string | null; anon?: boolean } = {}) => {
    const jwt = new SignJWT({ is_anonymous: opts.anon ?? false })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer(opts.issuer ?? ISSUER)
      .setAudience(opts.audience ?? "authenticated")
      .setIssuedAt()
      .setExpirationTime(opts.expires ?? "1h");
    if (opts.sub !== null) jwt.setSubject(opts.sub ?? "user-1");
    return jwt.sign(opts.key ?? privateKey);
  };

  before(async () => {
    const pair = await generateKeyPair("ES256");
    privateKey = pair.privateKey;
    otherKey = (await generateKeyPair("ES256")).privateKey;
    setKeyResolverForTests((async () => pair.publicKey) as any);
    colyseus = await sharedServer();
  });
  after(() => setKeyResolverForTests(undefined));
  beforeEach(async () => {
    process.env.REQUIRE_AUTH = "true";
    process.env.SUPABASE_URL = URL_;
    await colyseus.cleanup();
  });
  afterEach(() => {
    delete process.env.REQUIRE_AUTH;
    delete process.env.SUPABASE_URL;
  });

  it("lets everyone in when the check is off (local development)", async () => {
    delete process.env.REQUIRE_AUTH;
    assert.deepStrictEqual(await authenticate(undefined), { id: "local", anonymous: true });
  });

  it("accepts a valid token and reports guest accounts", async () => {
    assert.deepStrictEqual(await authenticate(await token()), { id: "user-1", anonymous: false });
    assert.deepStrictEqual(await authenticate(await token({ anon: true, sub: "guest-9" })), { id: "guest-9", anonymous: true });
  });

  it("rejects missing, malformed, forged, expired and wrongly-issued tokens", async () => {
    const bad: unknown[] = [
      undefined,
      "",
      "not a token",
      12345,
      "x".repeat(5000),
      await token({ key: otherKey }),                 // signed by someone else
      await token({ expires: "-1h" }),                // expired
      await token({ issuer: "https://evil.example/auth/v1" }),
      await token({ audience: "anon" }),
      await token({ sub: null }),                     // no user id
    ];
    for (const value of bad) {
      await assert.rejects(() => authenticate(value), (error: any) => error.code === 401 && error.message === "authentication failed");
    }
  });

  it("refuses to start with the check on but no Supabase URL", () => {
    delete process.env.SUPABASE_URL;
    assert.throws(() => assertAuthConfig(), /SUPABASE_URL/);
  });

  it("only lets players with a valid token into a room", async () => {
    await assert.rejects(() => colyseus.sdk.joinOrCreate("quick_match"), "no token");
    await assert.rejects(() => colyseus.sdk.joinOrCreate("quick_match", { token: "garbage" }), "bad token");
    const forged = await token({ key: otherKey });
    await assert.rejects(() => colyseus.sdk.create("custom_game", { token: forged }), "forged token");

    const room = await colyseus.sdk.create("custom_game", { token: await token() });
    assert.strictEqual(room.roomId.length, 5);
    const friend = await colyseus.sdk.joinById(room.roomId, { token: await token({ sub: "user-2" }) });
    assert.ok(friend.sessionId);
    await assert.rejects(() => colyseus.sdk.joinById(room.roomId), "friend without a token");
  });
});
