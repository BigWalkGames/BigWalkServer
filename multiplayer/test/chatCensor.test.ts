import assert from "node:assert";
import { cleanChatText } from "../src/chat/censor.js";

const clean = (text: unknown, max = 80) => cleanChatText(text, max);

describe("chat censoring (P43)", () => {
  it("leaves friendly text alone", () => {
    for (const ok of ["good game", "nice shot, gg!", "3 2 1 go!", "i have 2 cats", "Scunthorpe is nice", "pass the assassin", "see you in 5 minutes"]) {
      assert.strictEqual(clean(ok), ok);
    }
  });

  it("replaces swear words with asterisks of the same length", () => {
    assert.strictEqual(clean("you suck, fuck off"), "you suck, **** off");
    assert.strictEqual(clean("SHIT"), "****");
    assert.strictEqual(clean("b!tch"), "*****");
  });

  it("catches look-alike characters, stretched letters and full-width letters", () => {
    assert.strictEqual(clean("sh1t"), "****");
    assert.strictEqual(clean("fuuuck"), "****");
    assert.strictEqual(clean("ｆｕｃｋ"), "****");
  });

  it("catches letters spread out with spaces or dots, and hidden characters", () => {
    assert.strictEqual(clean("f u c k"), "*******");
    assert.strictEqual(clean("f.u.c.k you"), "******* you");
    assert.strictEqual(clean("fu\u200Bck"), "****");
  });

  it("also hides mild swearing and wishing harm on someone, whole words only", () => {
    assert.strictEqual(clean("what the hell"), "what the ****");
    assert.strictEqual(clean("damn"), "****");
    assert.strictEqual(clean("kill yourself"), "*************");
    assert.strictEqual(clean("KYS"), "***");
    assert.strictEqual(clean("hello shell"), "hello shell");
  });

  it("hides short-form swearing and the names of other apps", () => {
    assert.strictEqual(clean("wtf"), "***");
    assert.strictEqual(clean("STFU"), "****");
    assert.strictEqual(clean("add me on snap"), "add me on ****");
    assert.strictEqual(clean("my discord is cool"), "my ******* is cool");
    assert.strictEqual(clean("snapshot"), "snapshot");
  });

  it("hides web addresses, emails and phone-number-like digits", () => {
    assert.strictEqual(clean("visit www.evil.com now"), "visit ************ now");
    assert.strictEqual(clean("https://discord.gg/abc"), "**********************");
    assert.strictEqual(clean("me@mail.com"), "***********");
    assert.strictEqual(clean("call me 555 123 4567"), "call me ************");
    assert.strictEqual(clean("5551234567"), "**********");
  });

  it("returns null when there is nothing to send", () => {
    for (const nothing of ["", "   ", "\u200B\u200B", 12, null, undefined, {}, []]) assert.strictEqual(clean(nothing), null);
  });

  it("trims, squeezes spaces and cuts to the length limit", () => {
    assert.strictEqual(clean("  a   b  "), "a b");
    assert.strictEqual(clean("x".repeat(200))?.length, 80);
    assert.strictEqual(clean("x".repeat(200), 20)?.length, 20);
  });
});
