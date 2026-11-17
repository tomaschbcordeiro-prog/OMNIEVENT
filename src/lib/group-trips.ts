import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { cmd, persistent, pipe } from "./community/kv";
import { CommunityError, limit } from "./community/service";
import { applyChecked, cleanContent, cleanOp, describeOps, line, TripShareError, type Op, type TripContent } from "./trip-share";

/**
 * Trips planned together, and private: only the people in a trip can see it or change it.
 *
 * - Someone starts sharing a trip; others come in with its link or its 8-character PIN and
 *   get a key of their own, which their device keeps and sends with every request. Keys are
 *   stored only as hashes. The link and the PIN can be replaced (the old ones stop working)
 *   and joining can be closed.
 * - Roles: the owner (manages people, the link and the PIN, can stop sharing), editors
 *   (change anything on the trip, can invite) and viewers (see everything, change nothing).
 * - Changes arrive as small operations on single items and are applied in turn under a short
 *   lock, so changes made at the same time on different things all stay. Each trip keeps a
 *   short history: who changed what, when.
 * - Keys: g:trip:<id> (JSON), g:code:<PIN> → id, g:inv:<token> → id, g:lock:<id>.
 */

export type Role = "owner" | "editor" | "viewer";
interface Member {
  id: string;
  name: string;
  role: Role;
  keyHash: string;
  joinedAt: string;
  seen?: string;
}
interface LogLine {
  at: string;
  by: string;
  text: string;
}
interface GroupDoc {
  id: string;
  v: number;
  content: TripContent;
  members: Member[];
  code: string;
  invite: string;
  open: boolean;
  log: LogLine[];
  createdAt: string;
  updatedAt: string;
}

/** What a member's device gets: everything about the trip, nobody's key. */
export interface GroupView {
  id: string;
  v: number;
  content: TripContent;
  members: { id: string; name: string; role: Role; seen?: string }[];
  me: string;
  role: Role;
  /** The link and PIN, for those who may invite (owner and editors). */
  code?: string;
  invite?: string;
  open: boolean;
  log: LogLine[];
  updatedAt: string;
  /** Storage isn't connected yet: shared trips may be cleared (said plainly in the app). */
  testMode?: true;
  /** Members with the trip open right now. */
  here?: string[];
}

const MAX_MEMBERS = 30;
const MAX_BYTES = 600 * 1024;
const PIN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const now = () => new Date().toISOString();
const hash = (key: string) => createHash("sha256").update(`trip:${key}`).digest("hex");
const tripKey = (id: string) => `g:trip:${id}`;
const codeKey = (code: string) => `g:code:${code}`;
const invKey = (token: string) => `g:inv:${token}`;
/** "Here now": a key per member that lives 35 seconds, renewed each time their device asks for news. */
const hereKey = (id: string, member: string) => `g:here:${id}:${member}`;

async function presence(doc: GroupDoc, me: Member): Promise<string[]> {
  const res = await pipe([["SET", hereKey(doc.id, me.id), "1", "EX", 35], ["MGET", ...doc.members.map((m) => hereKey(doc.id, m.id))]]);
  const vals = Array.isArray(res[1]) ? (res[1] as unknown[]) : [];
  return doc.members.filter((_, i) => vals[i] != null).map((m) => m.id);
}
const newPin = () => Array.from({ length: 8 }, () => PIN_ALPHABET[randomInt(PIN_ALPHABET.length)]).join("");
const newToken = () => randomBytes(18).toString("base64url");
/** "abcd-EFGH 23" → "ABCDEFGH"; anything else → "". */
export const normalPin = (raw: unknown) => {
  const s = String(raw ?? "").toUpperCase().replace(/[\s-]/g, "");
  return s.length === 8 && [...s].every((ch) => PIN_ALPHABET.includes(ch)) ? s : "";
};
const ID_RE = /^[a-f0-9]{16}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{24}$/;

const personName = (raw: unknown) => {
  const n = line(raw, 40);
  if (n.length < 1) throw new CommunityError("Say your name, so the others know who's who.");
  return n;
};

async function read(id: string): Promise<GroupDoc | null> {
  if (!ID_RE.test(id)) return null;
  const raw = await cmd<string | null>(["GET", tripKey(id)]);
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as GroupDoc;
  } catch {
    return null;
  }
}

async function write(doc: GroupDoc) {
  const body = JSON.stringify(doc);
  if (body.length > MAX_BYTES) throw new CommunityError("This trip has grown too big to save. Take out a few things you no longer need.", 413);
  await cmd(["SET", tripKey(doc.id), body]);
}

/** Runs `fn` on the trip with nobody else changing it meanwhile. */
async function locked<T>(id: string, fn: (doc: GroupDoc) => Promise<T>): Promise<T> {
  const lock = `g:lock:${id}`;
  for (let i = 0; i < 25; i++) {
    if ((await cmd(["SET", lock, "1", "NX", "EX", 5])) === "OK") {
      try {
        const doc = await read(id);
        if (!doc) throw new CommunityError("This trip isn't shared any more.", 404);
        return await fn(doc);
      } finally {
        await cmd(["DEL", lock]);
      }
    }
    await new Promise((r) => setTimeout(r, 60 + i * 20));
  }
  throw new CommunityError("Others are changing this trip right now. Try again in a moment.", 409);
}

function memberFor(doc: GroupDoc, key: unknown): Member {
  if (typeof key !== "string" || key.length < 20) throw new CommunityError("You're not in this trip.", 403);
  const h = hash(key);
  const m = doc.members.find((x) => x.keyHash === h);
  if (!m) throw new CommunityError("You're not in this trip (any more).", 403);
  return m;
}

function view(doc: GroupDoc, me: Member): GroupView {
  const invites = me.role !== "viewer";
  return {
    id: doc.id,
    v: doc.v,
    content: { ...doc.content, messages: doc.content.messages ?? [] },
    members: doc.members.map(({ id, name, role, seen }) => ({ id, name, role, ...(seen ? { seen } : {}) })),
    me: me.id,
    role: me.role,
    ...(invites ? { code: doc.code, invite: doc.invite } : {}),
    open: doc.open,
    log: doc.log.slice(-40),
    updatedAt: doc.updatedAt,
    ...(persistent ? {} : { testMode: true as const }),
  };
}

const logLine = (doc: GroupDoc, by: string, text: string) => {
  doc.log = [...doc.log, { at: now(), by, text }].slice(-60);
};

/** The traveller for a member (added when they join, so costs can be split with them). */
function addTraveller(c: TripContent, m: Member): TripContent {
  if (c.travellers.some((t) => t.member === m.id)) return c;
  // Someone already listed under the same name becomes them (the owner listed "Ana" before she joined).
  const same = c.travellers.find((t) => !t.member && t.name.toLowerCase() === m.name.toLowerCase());
  if (same) return { ...c, travellers: c.travellers.map((t) => (t === same ? { ...t, member: m.id } : t)) };
  return { ...c, travellers: [...c.travellers, { id: `m${m.id}`, name: m.name, member: m.id }] };
}

const wrap = (err: unknown): never => {
  if (err instanceof TripShareError) throw new CommunityError(err.message);
  throw err;
};

// ---------------------------------------------------------------- the actions

/** Starts planning a trip together: the trip as it is, and its first member (the owner). */
export async function createGroup(rawContent: unknown, rawName: unknown, ip: string) {
  await limit(`gt-new:${ip}`, 20, 3600);
  const name = personName(rawName);
  let content: TripContent;
  try {
    content = cleanContent(rawContent);
  } catch (err) {
    return wrap(err);
  }
  const key = randomBytes(24).toString("base64url");
  const owner: Member = { id: randomBytes(5).toString("hex"), name, role: "owner", keyHash: hash(key), joinedAt: now(), seen: now() };
  const doc: GroupDoc = {
    id: randomBytes(8).toString("hex"),
    v: 1,
    content: addTraveller(content, owner),
    members: [owner],
    code: newPin(),
    invite: newToken(),
    open: true,
    log: [],
    createdAt: now(),
    updatedAt: now(),
  };
  logLine(doc, owner.name, "started planning together");
  await write(doc);
  await pipe([["SET", codeKey(doc.code), doc.id], ["SET", invKey(doc.invite), doc.id]]);
  return { key, view: view(doc, owner) };
}

/** The trip for one of its members; `since` answers "nothing new" without the whole trip. */
export async function readGroup(id: string, key: unknown, since?: number): Promise<GroupView | { same: true; v: number; here: string[] }> {
  const doc = await read(id);
  if (!doc) throw new CommunityError("This trip isn't shared any more.", 404);
  const me = memberFor(doc, key);
  const here = await presence(doc, me);
  if (since === doc.v) return { same: true, v: doc.v, here };
  return { ...view(doc, me), here };
}

/** Changes from a member's device, applied in turn. */
export async function changeGroup(id: string, key: unknown, rawOps: unknown): Promise<GroupView> {
  if (!Array.isArray(rawOps) || rawOps.length === 0) throw new CommunityError("Nothing to change.");
  if (rawOps.length > 300) throw new CommunityError("Too many changes at once.");
  let ops: Op[];
  try {
    ops = rawOps.map(cleanOp);
  } catch (err) {
    return wrap(err);
  }
  return locked(id, async (doc) => {
    const me = memberFor(doc, key);
    const chatOnly = ops.every((op) => op.t !== "set" && op.c === "messages");
    // Viewers can't change the trip, but they can talk in its chat.
    if (me.role === "viewer" && !chatOnly) throw new CommunityError("You can see this trip but not change it. Ask its owner to make you an editor.", 403);
    // Messages are signed by the server: whoever sends one is its author, and only they change it.
    ops = ops.flatMap((op): Op[] => {
      if (op.t === "set" || op.c !== "messages") return [op];
      if (op.t === "order") return [];
      const was = doc.content.messages?.find((m) => m.id === (op.t === "put" ? op.item.id : op.id));
      if (op.t === "del") {
        if (was && was.by !== me.id && me.role !== "owner") throw new CommunityError("You can only remove your own messages.", 403);
        return [op];
      }
      if (was && was.by !== me.id) throw new CommunityError("You can only change your own messages.", 403);
      return [{ ...op, item: { ...op.item, by: me.id, name: me.name, at: was?.at ?? now() } }];
    });
    const before = doc.content;
    try {
      doc.content = applyChecked({ ...doc.content, messages: doc.content.messages ?? [] }, ops);
    } catch (err) {
      wrap(err);
    }
    // The chat keeps its last 300 messages.
    if (doc.content.messages.length > 300) doc.content = { ...doc.content, messages: doc.content.messages.slice(-300) };
    doc.v += 1;
    doc.updatedAt = now();
    me.seen = now();
    const said = describeOps(ops, before);
    if (said.length) logLine(doc, me.name, said.join(", "));
    await write(doc);
    return view(doc, me);
  });
}

/** What someone with the link or the PIN sees before joining: the trip's name and who's in it. */
export async function peekGroup(by: { invite?: unknown; code?: unknown }, ip: string) {
  const id = await idFor(by, ip);
  const doc = id ? await read(id) : null;
  if (!doc || !doc.open) throw new CommunityError(doc ? "Joining this trip is closed. Ask its owner to open it again." : "That link or PIN doesn't lead to a trip. Check it, or ask for a new one.", 404);
  const owner = doc.members.find((m) => m.role === "owner");
  return { id: doc.id, name: doc.content.name, emoji: doc.content.emoji ?? "✈️", start: doc.content.start, end: doc.content.end, cities: doc.content.stops.map((s) => s.name).slice(0, 8), people: doc.members.length, by: owner?.name ?? "" };
}

async function idFor(by: { invite?: unknown; code?: unknown }, ip: string): Promise<string | undefined> {
  // Each guess counts: a PIN can't be found by trying them all.
  await limit(`gt-join:${ip}`, 15, 600);
  if (typeof by.invite === "string" && TOKEN_RE.test(by.invite)) {
    const id = await cmd<string | null>(["GET", invKey(by.invite)]);
    return typeof id === "string" ? id : undefined;
  }
  const pin = normalPin(by.code);
  if (!pin) throw new CommunityError("A PIN has 8 letters and numbers, like K7QM-2XPA.");
  const id = await cmd<string | null>(["GET", codeKey(pin)]);
  return typeof id === "string" ? id : undefined;
}

/** Comes into a trip with its link or PIN: a key of their own, as an editor. */
export async function joinGroup(by: { invite?: unknown; code?: unknown }, rawName: unknown, ip: string) {
  const name = personName(rawName);
  const id = await idFor(by, ip);
  if (!id) throw new CommunityError("That link or PIN doesn't lead to a trip. Check it, or ask for a new one.", 404);
  return locked(id, async (doc) => {
    if (!doc.open) throw new CommunityError("Joining this trip is closed. Ask its owner to open it again.", 403);
    if (doc.members.length >= MAX_MEMBERS) throw new CommunityError(`A trip can have up to ${MAX_MEMBERS} people.`);
    const key = randomBytes(24).toString("base64url");
    const m: Member = { id: randomBytes(5).toString("hex"), name, role: "editor", keyHash: hash(key), joinedAt: now(), seen: now() };
    doc.members.push(m);
    doc.content = addTraveller(doc.content, m);
    doc.v += 1;
    doc.updatedAt = now();
    logLine(doc, m.name, "joined the trip");
    await write(doc);
    return { key, view: view(doc, m) };
  });
}

export type ManageAction =
  | { do: "role"; member: string; role: Role }
  | { do: "remove"; member: string }
  | { do: "leave" }
  | { do: "rename"; name: string }
  | { do: "new-pin" }
  | { do: "open"; open: boolean };

/** Managing the people, the link and the PIN. */
export async function manageGroup(id: string, key: unknown, raw: Record<string, unknown>): Promise<GroupView | { left: true }> {
  return locked(id, async (doc) => {
    const me = memberFor(doc, key);
    const owner = me.role === "owner";
    const target = typeof raw.member === "string" ? doc.members.find((m) => m.id === raw.member) : undefined;
    switch (raw.do) {
      case "role": {
        if (!owner) throw new CommunityError("Only the trip's owner can change who does what.", 403);
        if (!target || target.id === me.id) throw new CommunityError("That person isn't in the trip.");
        const role = raw.role;
        if (role === "owner") {
          // Handing the trip over: the old owner stays, as an editor.
          target.role = "owner";
          me.role = "editor";
          logLine(doc, me.name, `made ${target.name} the trip's owner`);
        } else if (role === "editor" || role === "viewer") {
          target.role = role;
          logLine(doc, me.name, `made ${target.name} ${role === "editor" ? "an editor" : "a viewer"}`);
        } else throw new CommunityError("Unknown role.");
        break;
      }
      case "remove": {
        if (!owner) throw new CommunityError("Only the trip's owner can take people out.", 403);
        if (!target || target.id === me.id) throw new CommunityError("That person isn't in the trip.");
        doc.members = doc.members.filter((m) => m !== target);
        logLine(doc, me.name, `took ${target.name} out of the trip`);
        break;
      }
      case "leave": {
        if (owner && doc.members.length > 1) throw new CommunityError("Make someone else the owner before you leave, or stop sharing the trip.");
        doc.members = doc.members.filter((m) => m !== me);
        if (!doc.members.length) {
          await pipe([["DEL", tripKey(doc.id)], ["DEL", codeKey(doc.code)], ["DEL", invKey(doc.invite)]]);
          return { left: true as const };
        }
        logLine(doc, me.name, "left the trip");
        doc.v += 1;
        doc.updatedAt = now();
        await write(doc);
        return { left: true as const };
      }
      case "rename": {
        const name = personName(raw.name);
        doc.content = { ...doc.content, travellers: doc.content.travellers.map((t) => (t.member === me.id ? { ...t, name } : t)) };
        me.name = name;
        break;
      }
      case "new-pin": {
        if (me.role === "viewer") throw new CommunityError("Only the owner and editors can invite people.", 403);
        await pipe([["DEL", codeKey(doc.code)], ["DEL", invKey(doc.invite)]]);
        doc.code = newPin();
        doc.invite = newToken();
        await pipe([["SET", codeKey(doc.code), doc.id], ["SET", invKey(doc.invite), doc.id]]);
        logLine(doc, me.name, "made a new link and PIN (the old ones stopped working)");
        break;
      }
      case "open": {
        if (!owner) throw new CommunityError("Only the trip's owner can open or close joining.", 403);
        doc.open = raw.open === true;
        logLine(doc, me.name, doc.open ? "opened joining" : "closed joining");
        break;
      }
      default:
        throw new CommunityError("Unknown action.");
    }
    doc.v += 1;
    doc.updatedAt = now();
    await write(doc);
    return view(doc, me);
  });
}

/** Stops sharing: the trip leaves the server; every device keeps its own copy, unshared. */
export async function deleteGroup(id: string, key: unknown) {
  return locked(id, async (doc) => {
    const me = memberFor(doc, key);
    if (me.role !== "owner") throw new CommunityError("Only the trip's owner can stop sharing it.", 403);
    await pipe([["DEL", tripKey(doc.id)], ["DEL", codeKey(doc.code)], ["DEL", invKey(doc.invite)]]);
    return { ok: true };
  });
}
