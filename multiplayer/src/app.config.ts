import {
  defineServer,
  defineRoom,
  monitor,
  playground,
  createRouter,
  createEndpoint,
  basicAuth,
} from "colyseus";
import { QuickMatchRoom } from "./rooms/QuickMatchRoom.js";
import { CustomGameRoom } from "./rooms/CustomGameRoom.js";
import { allowLookup, codeStatus } from "./rooms/roomCodes.js";
import { assertAuthConfig, authRequired } from "./auth.js";
import { setResultSink } from "./results.js";
import { supabaseResultSink } from "./supabaseResultSink.js";

// Refuse to start with auth turned on but not configured (fail closed).
assertAuthConfig();

// Save finished matches to Supabase. Needs real account ids, so only when auth is on.
if (authRequired() && process.env.SUPABASE_SECRET_KEY) {
  setResultSink(supabaseResultSink(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY));
} else if (authRequired()) {
  console.warn("SUPABASE_SECRET_KEY is not set: finished matches are only logged, not saved");
}

/**
 * Import your Room files
 */
import { MyRoom } from "./rooms/MyRoom.js";

const server = defineServer({

  /**
   * Define your room handlers:
   */
  rooms: {
    my_room: defineRoom(MyRoom),
    quick_match: defineRoom(QuickMatchRoom),
    custom_game: defineRoom(CustomGameRoom),
  },

  /**
   * Experimental: Define API routes. Built-in integration with the "playground" and SDK.
   *
   * Usage from SDK:
   *   client.http.get("/api/hello").then((response) => {})
   *
   */
  routes: createRouter({
    // P27: tells the Join Room screen what is wrong with a code before it tries to join.
    // Answers: open | full | expired | invalid | rate_limited. Rate limited so codes can't be guessed fast.
    room_code_status: createEndpoint("/api/room-code/status", { method: "GET" }, async (ctx) => {
      const forwarded = ctx.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      const key = process.env.TRUST_PROXY === "true" && forwarded ? forwarded : "shared";
      if (!allowLookup(key)) return { status: "rate_limited" };
      return { status: await codeStatus(ctx.query?.code) };
    }),
    api_hello: createEndpoint("/api/hello", { method: "GET" }, async (ctx) => {
      return { message: "Hello World" };
    }),
  }),

  /**
   * Bind your custom express routes here:
   * Read more: https://expressjs.com/en/starter/basic-routing.html
   */
  express: (app) => {

    app.get("/hi", (req, res) => {
      res.send("It's time to kick ass and chew bubblegum!");
    });

    /**
     * Use @colyseus/monitor
     * If you expose it in production, make sure to protect it with a password:
     * https://docs.colyseus.io/tools/monitoring#password-protection
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/monitor", monitor());
    } else if (process.env.MONITOR_USER && process.env.MONITOR_PASSWORD) {
      const guard = basicAuth({
        users: { [process.env.MONITOR_USER]: process.env.MONITOR_PASSWORD },
      });
      app.use("/monitor", monitor({ use: [guard] }));
    }

    /**
     * Use @colyseus/playground
     * (It is not recommended to expose this route in a production environment)
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/", playground());
    }
  }
});

export default server;

