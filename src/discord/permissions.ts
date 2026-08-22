import { PermissionFlagsBits, type OverwriteResolvable } from "discord.js";

export interface VoiceRoomPrincipals {
  everyoneRoleId: string;
  buyerId: string;
  egirlRoleId: string;
  curatorRoleId: string;
  botId: string;
}

export function privateVoiceOverwrites(principals: VoiceRoomPrincipals): OverwriteResolvable[] {
  const participantAllows = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
  ];

  return [
    {
      id: principals.everyoneRoleId,
      deny: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.CreateInstantInvite,
      ],
    },
    { id: principals.buyerId, allow: participantAllows },
    { id: principals.egirlRoleId, allow: participantAllows },
    { id: principals.curatorRoleId, allow: participantAllows },
    {
      id: principals.botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.MoveMembers,
      ],
    },
  ];
}
