import { MongoClient, type Collection } from "mongodb";

import { LEADERBOARD_STATS } from "./constants.js";
import type { GameSave } from "./game.js";

// Bloxity Legion hosting injects MONGODB_URI per game+channel -- an isolated database with
// scoped credentials. A local `npm start` normally has no Mongo reachable, so a missing or
// unreachable URI must degrade to "no persistence" rather than crash the room.

// A player's document. The game's whole progress is the `game` field (game.ts, written by the
// `saveGame` message); the client keeps nothing in the browser, so this document is the only save.
// The rest is what the server itself owns or copies out of the save. Documents saved by earlier
// versions of the server may carry other fields; they are simply never read.
export interface PlayerDoc {
  _id: string; // Bloxity user id -- see WorldRoom.ts (guests are never saved)
  username?: string; // display name as of the last save
  game?: GameSave; // Fish for Secret Animals' whole progress (game.ts), written by `saveGame`
  bestOdds?: number; // plaza board stats, copied out of `game` by saveGame (indexed: leaderboard.ts)
  catches?: number;
  income?: number;
  lastSeen?: number; // epoch ms of the last activity (stampLastSeen)
  invites?: number; // friends who joined from this player's invite link (each gives an income boost, see credit in WorldRoom)
  invitedBy?: string; // the account whose invite link brought this player (set once, on their first visit)
  // Spin wheel (spin.ts): written only by the server's `spin` handler, never by saveGame.
  spins?: number; // spins ready to use
  spinAt?: number; // epoch ms the next free spin arrives
  // Daily Reward (daily.ts): written by the server only, never by saveGame.
  dailyDay?: number; // days unlocked this cycle
  dailyLast?: number; // UTC day index of the last unlock
  dailyClaimed?: number[]; // claimed day indexes this cycle
  version: number;
  updatedAt: Date;
}

let client: MongoClient | null = null;
let players: Collection<PlayerDoc> | null = null;

export async function connectDb(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("[db] MONGODB_URI not set -- player progress will not persist");
    return;
  }
  try {
    client = new MongoClient(uri);
    await client.connect();
    // No dbName passed to .db() -- the injected URI already points at this game+channel's database.
    players = client.db().collection<PlayerDoc>("players");
    console.log("[db] connected to MongoDB");
    // The leaderboards sort and count by these (leaderboard.ts).
    for (const stat of LEADERBOARD_STATS) {
      players.createIndex({ [stat]: -1 }).catch((err) => console.warn(`[db] index on ${stat} failed`, err));
    }
  } catch (err) {
    console.warn("[db] connect failed -- player progress will not persist:", err);
    client = null;
    players = null;
  }
}

// Null whenever Mongo is unset/unreachable -- every caller must treat that as "skip persistence".
export function getPlayers(): Collection<PlayerDoc> | null {
  return players;
}

// Test-only seam: exercise the save/load logic against an in-memory fake collection.
export function __setPlayersForTest(fake: Collection<PlayerDoc> | null): void {
  players = fake;
}
