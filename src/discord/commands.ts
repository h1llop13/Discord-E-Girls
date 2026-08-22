import { SlashCommandBuilder } from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("bot-status")
    .setDescription("Проверить состояние бота (только для куратора)"),
  new SlashCommandBuilder()
    .setName("codes")
    .setDescription("Управление кодами")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("generate")
        .setDescription("Создать новую партию кодов")
        .addIntegerOption((option) =>
          option
            .setName("quantity")
            .setDescription("Количество кодов")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(1000),
        ),
    )
    .addSubcommand((subcommand) => subcommand.setName("unused").setDescription("Выгрузить свободные коды")),
  new SlashCommandBuilder()
    .setName("order")
    .setDescription("Управление заказами")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("extend")
        .setDescription("Продлить активный заказ")
        .addIntegerOption((option) =>
          option.setName("number").setDescription("Номер заказа").setRequired(true).setMinValue(1),
        )
        .addIntegerOption((option) =>
          option
            .setName("minutes")
            .setDescription("Количество минут")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(1440),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("close")
        .setDescription("Закрыть заказ досрочно")
        .addIntegerOption((option) =>
          option.setName("number").setDescription("Номер заказа").setRequired(true).setMinValue(1),
        ),
    ),
].map((command) => command.toJSON());
