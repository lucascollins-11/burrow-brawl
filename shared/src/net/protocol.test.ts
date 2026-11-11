import { describe, expect, it } from "vitest";
import { CodecError, decode, encode } from "./codec";
import {
  PROTOCOL_VERSION,
  cleanText,
  normalizeRoomCode,
  parseClientMessage,
  validNickname,
  validateSettingsPatch,
} from "./protocol";

describe("codec", () => {
  it("round-trips messages as text and bytes", () => {
    const msg = { t: "ping", seq: 3, clientTime: 42 };
    const s = encode(msg);
    expect(decode(s)).toEqual(msg);
    expect(decode(new TextEncoder().encode(s))).toEqual(msg);
    expect(decode(new TextEncoder().encode(s).buffer)).toEqual(msg);
  });

  it("throws CodecError on bad input", () => {
    expect(() => decode("{nope")).toThrow(CodecError);
    expect(() => decode(new Uint8Array([0xff, 0xfe]))).toThrow(CodecError);
  });
});

describe("parseClientMessage", () => {
  it("accepts valid messages", () => {
    expect(
      parseClientMessage({ t: "hello", token: "abc", protocolVersion: PROTOCOL_VERSION }).ok,
    ).toBe(true);
    expect(parseClientMessage({ t: "room.join", seq: 1, code: "abcde" }).ok).toBe(true);
    expect(
      parseClientMessage({ t: "hello", token: "abc", protocolVersion: 1, view: true }).ok,
    ).toBe(true);
    expect(parseClientMessage({ t: "lobby.setTeam", teamId: null }).ok).toBe(true);
    expect(parseClientMessage({ t: "lobby.setSettings", patch: { turnSeconds: 30 } }).ok).toBe(
      true,
    );
  });

  it("rejects unknown types, extra fields and bad values", () => {
    expect(parseClientMessage(null).ok).toBe(false);
    expect(parseClientMessage([]).ok).toBe(false);
    expect(parseClientMessage({ t: "toString" }).ok).toBe(false);
    expect(parseClientMessage({ t: "__proto__" }).ok).toBe(false);
    expect(parseClientMessage({ t: "nope" }).ok).toBe(false);
    expect(parseClientMessage({ t: "room.create", admin: true }).ok).toBe(false);
    expect(parseClientMessage({ t: "room.create", seq: -1 }).ok).toBe(false);
    expect(parseClientMessage({ t: "hello", token: "", protocolVersion: 1 }).ok).toBe(false);
    expect(parseClientMessage({ t: "lobby.ready", ready: "yes" }).ok).toBe(false);
    expect(parseClientMessage({ t: "hello", token: "a", protocolVersion: 1, view: false }).ok).toBe(
      false,
    );
    expect(parseClientMessage({ t: "ping", clientTime: Infinity }).ok).toBe(false);
  });

  it("validates and cleans team patches", () => {
    const r = parseClientMessage({
      t: "lobby.editTeam",
      teamId: "t1",
      patch: { name: "  Dirt\u0000 Diggers ", hatStyle: "chef", critterNames: ["A", "B"] },
    });
    expect(r).toEqual({
      ok: true,
      value: {
        t: "lobby.editTeam",
        teamId: "t1",
        patch: { name: "Dirt Diggers", hatStyle: "chef", critterNames: ["A", "B"] },
      },
    });
    expect(
      parseClientMessage({ t: "lobby.editTeam", teamId: "t1", patch: { hatColor: "#000000" } }).ok,
    ).toBe(false);
    expect(
      parseClientMessage({ t: "lobby.editTeam", teamId: "t1", patch: { controllerId: "x" } }).ok,
    ).toBe(false);
    expect(
      parseClientMessage({
        t: "lobby.editTeam",
        teamId: "t1",
        patch: { critterNames: ["a", "b", "c", "d", "e"] },
      }).ok,
    ).toBe(false);
  });

  it("checks settings ranges", () => {
    expect(validateSettingsPatch({ turnSeconds: 14 }).ok).toBe(false);
    expect(validateSettingsPatch({ turnSeconds: 90 }).ok).toBe(true);
    expect(validateSettingsPatch({ crateChance: 1.5 }).ok).toBe(false);
    expect(validateSettingsPatch({ mapId: "../etc" }).ok).toBe(false);
    expect(validateSettingsPatch({ hasOwnProperty: 1 }).ok).toBe(false);
  });
});

describe("text helpers", () => {
  it("normalizes room codes", () => {
    expect(normalizeRoomCode(" k7qx2 ")).toBe("K7QX2");
    expect(normalizeRoomCode("K7QX0")).toBeNull(); // 0 is not in the alphabet
    expect(normalizeRoomCode("K7QX")).toBeNull();
    expect(normalizeRoomCode(12345)).toBeNull();
  });

  it("validates nicknames", () => {
    expect(validNickname("  Pip  ")).toBe("Pip");
    expect(validNickname("P")).toBeNull();
    expect(validNickname("x".repeat(17))).toBeNull();
    expect(validNickname("‮evil‬")).toBe("evil");
    expect(validNickname(42)).toBeNull();
  });

  it("strips control and bidi characters", () => {
    expect(cleanText("a\u0007b​c\n\nd")).toBe("abc d");
  });
});
