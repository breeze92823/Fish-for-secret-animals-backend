import assert from "assert";
import type { ColyseusTestServer } from "@colyseus/testing";

import type appConfig from "../src/app.config.js";
import { WorldState } from "../src/rooms/schema/WorldState.js";
import { __setPlayersForTest } from "../src/db.js";
import { sanitizeGame } from "../src/game.js";
import { fakePlayers, sleep } from "./fakePlayers.js";
import { testServer } from "./server.js";

// Who is loaded and stored: the join answer (`game`), identity changes mid-session (`identify`) and
// the rule that nothing is saved before the load answered or after it failed. The save format
// itself is in GameSave.test.ts.
describe("progress", () => {
  let colyseus: ColyseusTestServer<typeof appConfig>;
  before(async () => (colyseus = await testServer()));
  beforeEach(async () => await colyseus.cleanup());
  afterEach(() => __setPlayersForTest(null));

  it("creates a new account's save and never saves a guest", async () => {
    const fake = fakePlayers();
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "new1" });
    let answer: any = undefined;
    c.onMessage("game", (m: any) => (answer = m));
    fake.release();
    await sleep(150);
    assert.ok(answer, "the join is answered");
    assert.strictEqual(answer.game, null, "a new account has no save yet");
    c.send("saveGame", { money: 10 });
    await sleep(150);
    assert.strictEqual((fake.docs.get("new1") as any)?.game.money, 10);

    const guest = await colyseus.connectTo(room, { userId: "guest-abc" });
    guest.onMessage("game", () => {});
    await sleep(150);
    guest.send("saveGame", { money: 99 });
    await sleep(150);
    assert.strictEqual(fake.docs.size, 1, "a guest is never written");
    assert.strictEqual(room.state.players.get(guest.sessionId)?.signedIn, false);
  });

  it("loads the new identity when a guest signs in mid-session", async () => {
    const fake = fakePlayers([{ _id: "u2", game: sanitizeGame({ money: 42 })!, version: 1, updatedAt: new Date() }]);
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "guest-x" });
    const answers: any[] = [];
    c.onMessage("game", (m: any) => answers.push(m));
    fake.release();
    await sleep(150);
    assert.ok(!answers.some((a) => a?.game), "a guest has nothing to load");
    c.send("identify", { userId: "u2", username: "Bea" });
    await sleep(150);
    assert.strictEqual(answers[answers.length - 1]?.game?.money, 42, "the signed-in account's save arrives as a new `game`");
    assert.strictEqual(room.state.players.get(c.sessionId)?.signedIn, true);
  });

  it("keeps saving off when the save could not be read", async () => {
    const fake = fakePlayers([{ _id: "u3", game: sanitizeGame({ money: 1e9 })!, version: 1, updatedAt: new Date() }]);
    (fake as any).findOne = async () => {
      await fake.gate;
      throw new Error("down");
    };
    __setPlayersForTest(fake);
    const room = await colyseus.createRoom<WorldState>("world", {});
    const c = await colyseus.connectTo(room, { userId: "u3" });
    let failed = false;
    c.onMessage("serverError", () => (failed = true));
    fake.release();
    await sleep(150);
    assert.ok(failed);
    c.send("saveGame", { money: 0 });
    await sleep(150);
    assert.strictEqual((fake.docs.get("u3") as any).game.money, 1e9, "the unread save is never overwritten");
  });
});
