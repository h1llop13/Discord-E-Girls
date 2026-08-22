import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";
import { privateVoiceOverwrites } from "../src/discord/permissions.js";

describe("private voice permissions", () => {
  const overwrites = privateVoiceOverwrites({
    everyoneRoleId: "everyone",
    buyerId: "buyer",
    egirlRoleId: "egirl",
    curatorRoleId: "curator",
    botId: "bot",
  });

  it("hides the room and denies invites to everyone by default", () => {
    expect(overwrites[0]).toMatchObject({ id: "everyone" });
    expect(overwrites[0] && "deny" in overwrites[0] ? overwrites[0].deny : []).toContain(
      PermissionFlagsBits.CreateInstantInvite,
    );
  });

  it.each(["buyer", "egirl", "curator"])("lets %s view and connect", (id) => {
    const overwrite = overwrites.find((value) => "id" in value && value.id === id);
    expect(overwrite && "allow" in overwrite ? overwrite.allow : []).toEqual(
      expect.arrayContaining([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]),
    );
  });

  it("lets the bot manage the room", () => {
    const overwrite = overwrites.find((value) => "id" in value && value.id === "bot");
    expect(overwrite && "allow" in overwrite ? overwrite.allow : []).toContain(PermissionFlagsBits.ManageChannels);
  });
});
