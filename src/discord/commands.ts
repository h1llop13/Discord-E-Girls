import { SlashCommandBuilder } from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("bot-status")
    .setDescription("Проверить состояние бота (только для куратора)"),
].map((command) => command.toJSON());
