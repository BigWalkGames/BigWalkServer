import { boot, type ColyseusTestServer } from "@colyseus/testing";
import appConfig from "../../src/app.config.js";

/**
 * One test server for the whole run. Booting a second server from the same app config in the
 * same process fails, so every test file shares this one. `--exit` closes it when the run ends.
 */
let booted: Promise<ColyseusTestServer<typeof appConfig>> | undefined;

export function sharedServer() {
  booted ??= boot(appConfig);
  return booted;
}
