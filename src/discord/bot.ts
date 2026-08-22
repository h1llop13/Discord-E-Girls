import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Interaction,
  REST,
  Routes,
  type Guild,
  type Message,
  type TextBasedChannel,
} from "discord.js";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { CODE_PATTERN, normalizeCode } from "../codes/generator.js";
import { ActivationGuardRepository } from "../db/activation-guard-repository.js";
import { OrderRepository, type OrderRecord } from "../db/order-repository.js";
import { commandDefinitions } from "./commands.js";
import { privateVoiceOverwrites } from "./permissions.js";

interface BotDependencies {
  config: AppConfig;
  pool: Pool;
}

function roomName(displayName: string): string {
  const cleanName = displayName.replaceAll(/[\r\n]/g, " ").trim() || "клиент";
  return `🔒・${cleanName}`.slice(0, 100);
}

async function sendPrivateOrTemporary(message: Message, text: string): Promise<void> {
  try {
    await message.author.send(text);
  } catch {
    if (!message.channel.isSendable()) return;
    const notice = await message.channel.send(`<@${message.author.id}> ${text} Разрешите личные сообщения от участников сервера.`);
    setTimeout(() => void notice.delete().catch(() => undefined), 15_000);
  }
}

async function sendLog(channel: TextBasedChannel, text: string): Promise<void> {
  if (channel.isSendable()) await channel.send(text);
}

export class DiscordBot {
  private readonly client: Client;
  private readonly orders: OrderRepository;
  private readonly guards: ActivationGuardRepository;

  public constructor(private readonly dependencies: BotDependencies) {
    this.orders = new OrderRepository(dependencies.pool);
    this.guards = new ActivationGuardRepository(dependencies.pool);
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
      ],
    });
    this.bindEvents();
  }

  public async start(): Promise<void> {
    const { config } = this.dependencies;
    const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(config.DISCORD_APPLICATION_ID, config.DISCORD_GUILD_ID), {
      body: commandDefinitions,
    });
    await this.client.login(config.DISCORD_TOKEN);
  }

  public destroy(): void {
    this.client.destroy();
  }

  private bindEvents(): void {
    this.client.once(Events.ClientReady, (client) => void this.onReady(client));
    this.client.on(Events.InteractionCreate, (interaction) => {
      void this.onInteraction(interaction).catch((error: unknown) => console.error("Interaction failed:", error));
    });
    this.client.on(Events.MessageCreate, (message) => {
      void this.onMessage(message).catch((error: unknown) => console.error("Message handling failed:", error));
    });
  }

  private async onReady(client: Client<true>): Promise<void> {
    try {
      const guild = await client.guilds.fetch(this.dependencies.config.DISCORD_GUILD_ID);
      await this.validateConfiguredGuild(guild);
      await this.repairMissingVoiceRooms(guild);
      console.log(`Discord bot ${client.user.tag} connected to ${guild.name} (${guild.id}).`);
    } catch (error) {
      console.error("Discord startup validation failed:", error);
      this.destroy();
      process.exitCode = 1;
    }
  }

  private async validateConfiguredGuild(guild: Guild): Promise<void> {
    const { config } = this.dependencies;
    const [commandChannel, logChannel, privateCategory] = await Promise.all([
      guild.channels.fetch(config.COMMAND_CHANNEL_ID),
      guild.channels.fetch(config.ORDER_LOG_CHANNEL_ID),
      guild.channels.fetch(config.PRIVATE_CATEGORY_ID),
    ]);
    if (!commandChannel?.isTextBased()) throw new Error("COMMAND_CHANNEL_ID is not a text channel.");
    if (!logChannel?.isTextBased()) throw new Error("ORDER_LOG_CHANNEL_ID is not a text channel.");
    if (privateCategory?.type !== ChannelType.GuildCategory) {
      throw new Error("PRIVATE_CATEGORY_ID is not a Discord category.");
    }
    const roles = await Promise.all([
      guild.roles.fetch(config.CURATOR_ROLE_ID),
      guild.roles.fetch(config.CLIENT_ROLE_ID),
      guild.roles.fetch(config.EGIRL_ROLE_ID),
    ]);
    if (roles.some((role) => role === null)) throw new Error("One or more configured Discord roles do not exist.");
  }

  private async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isChatInputCommand()) return;
    const { config } = this.dependencies;
    if (interaction.guildId !== config.DISCORD_GUILD_ID) return;

    const guild = interaction.guild;
    if (!guild) return;
    const member = await guild.members.fetch(interaction.user.id);
    if (!member.roles.cache.has(config.CURATOR_ROLE_ID)) {
      await interaction.reply({ content: "Эта команда доступна только роли 👑 Куратор.", ephemeral: true });
      return;
    }

    if (interaction.commandName === "bot-status") {
      await interaction.reply({ content: "✅ Бот подключён, база доступна, конфигурация сервера загружена.", ephemeral: true });
    }
  }

  private async onMessage(message: Message): Promise<void> {
    const { config } = this.dependencies;
    if (message.author.bot || message.guildId !== config.DISCORD_GUILD_ID || message.channelId !== config.COMMAND_CHANNEL_ID) {
      return;
    }

    await message.delete().catch(() => undefined);
    const code = normalizeCode(message.content);
    const currentGuard = await this.guards.get(config.DISCORD_GUILD_ID, message.author.id);
    if (currentGuard.blockedUntil && currentGuard.blockedUntil.getTime() > Date.now()) {
      await sendPrivateOrTemporary(message, `Слишком много неверных попыток. Блокировка действует до ${currentGuard.blockedUntil.toLocaleString("ru-RU")}.`);
      return;
    }

    if (!CODE_PATTERN.test(code)) {
      await this.rejectCode(message, "Код должен иметь формат XXXX-XXXX.");
      return;
    }

    const activation = await this.orders.activateCode(code, config.DISCORD_GUILD_ID, message.author.id);
    if (activation.kind !== "activated") {
      const reason = activation.kind === "used" ? "Этот код уже использован." : "Такого кода нет.";
      await this.rejectCode(message, reason);
      return;
    }

    await this.guards.clear(config.DISCORD_GUILD_ID, message.author.id);
    const guild = message.guild;
    if (!guild) return;
    const member = await guild.members.fetch(message.author.id);
    await member.roles.add(config.CLIENT_ROLE_ID, `Activated order #${activation.order.id}`);
    const channelId = await this.ensureVoiceRoom(guild, activation.order);
    const logChannel = await guild.channels.fetch(config.ORDER_LOG_CHANNEL_ID);
    if (logChannel?.isTextBased()) {
      await sendLog(logChannel, `✅ Заказ #${activation.order.id}: <@${message.author.id}>, приватная комната <#${channelId}> создана.`);
    }
    await sendPrivateOrTemporary(message, `Код принят. Заказ #${activation.order.id} создан, ваша комната: <#${channelId}>.`);
  }

  private async rejectCode(message: Message, reason: string): Promise<void> {
    const { config } = this.dependencies;
    const guard = await this.guards.recordFailure(config.DISCORD_GUILD_ID, message.author.id);
    const suffix = guard.blockedUntil
      ? ` После пяти ошибок вы заблокированы до ${guard.blockedUntil.toLocaleString("ru-RU")}.`
      : ` Осталось попыток до блокировки: ${Math.max(0, 5 - guard.failedAttempts)}.`;
    await sendPrivateOrTemporary(message, `${reason}${suffix}`);
  }

  private async ensureVoiceRoom(guild: Guild, order: OrderRecord): Promise<string> {
    if (order.voiceChannelId) {
      const existing = await guild.channels.fetch(order.voiceChannelId).catch(() => null);
      if (existing) return existing.id;
    }

    const { config } = this.dependencies;
    const buyer = await guild.members.fetch(order.buyerDiscordId);
    const botId = guild.members.me?.id;
    if (!botId) throw new Error("Bot guild member is unavailable.");
    const created = await guild.channels.create({
      name: roomName(buyer.displayName),
      type: ChannelType.GuildVoice,
      parent: config.PRIVATE_CATEGORY_ID,
      reason: `Private room for order #${order.id}`,
      permissionOverwrites: privateVoiceOverwrites({
        everyoneRoleId: guild.roles.everyone.id,
        buyerId: buyer.id,
        egirlRoleId: config.EGIRL_ROLE_ID,
        curatorRoleId: config.CURATOR_ROLE_ID,
        botId,
      }),
    });

    const storedChannelId = await this.orders.setVoiceChannelIfMissing(order.id, created.id);
    if (storedChannelId !== created.id) {
      await created.delete("Duplicate room prevented").catch(() => undefined);
    }
    return storedChannelId;
  }

  private async repairMissingVoiceRooms(guild: Guild): Promise<void> {
    const orders = await this.orders.findActiveWithoutVoiceChannel(guild.id);
    for (const order of orders) {
      try {
        await this.ensureVoiceRoom(guild, order);
      } catch (error) {
        console.error(`Could not restore voice room for order #${order.id}:`, error);
      }
    }
  }
}
