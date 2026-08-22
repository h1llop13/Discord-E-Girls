import {
  ChannelType,
  AttachmentBuilder,
  Client,
  Events,
  GatewayIntentBits,
  type Interaction,
  REST,
  Routes,
  type Guild,
  type Message,
  type TextBasedChannel,
  type VoiceState,
} from "discord.js";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { CodeBatchService } from "../codes/code-batch-service.js";
import { codesToCsv } from "../codes/csv.js";
import { ActivationGuardRepository } from "../db/activation-guard-repository.js";
import { CodeRepository } from "../db/code-repository.js";
import { OrderRepository, type OrderRecord } from "../db/order-repository.js";
import { TimerRepository } from "../db/timer-repository.js";
import { ActivationService } from "../services/activation-service.js";
import { commandDefinitions } from "./commands.js";
import { privateVoiceOverwrites, privateVoiceRoomName } from "./permissions.js";
import { DiscordTimerManager } from "./timer-manager.js";

interface BotDependencies {
  config: AppConfig;
  pool: Pool;
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
  private readonly activations: ActivationService;
  private readonly timerManager: DiscordTimerManager;
  private readonly codeRepository: CodeRepository;
  private readonly codeBatches: CodeBatchService;

  public constructor(private readonly dependencies: BotDependencies) {
    this.orders = new OrderRepository(dependencies.pool);
    this.guards = new ActivationGuardRepository(dependencies.pool);
    this.codeRepository = new CodeRepository(dependencies.pool);
    this.codeBatches = new CodeBatchService(this.codeRepository);
    this.activations = new ActivationService(this.orders, this.guards);
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.MessageContent,
      ],
    });
    this.timerManager = new DiscordTimerManager(
      this.client,
      dependencies.config,
      this.orders,
      new TimerRepository(dependencies.pool),
    );
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
    this.timerManager.stop();
    this.client.destroy();
  }

  private bindEvents(): void {
    this.client.once(Events.ClientReady, (client) => void this.onReady(client));
    this.client.on(Events.InteractionCreate, (interaction) => {
      void this.onInteraction(interaction).catch((error: unknown) => this.reportInteractionError(interaction, error));
    });
    this.client.on(Events.MessageCreate, (message) => {
      void this.onMessage(message).catch((error: unknown) => console.error("Message handling failed:", error));
    });
    this.client.on(Events.VoiceStateUpdate, (_oldState, newState) => {
      void this.onVoiceState(newState).catch((error: unknown) => console.error("Voice state handling failed:", error));
    });
  }

  private async onReady(client: Client<true>): Promise<void> {
    try {
      const guild = await client.guilds.fetch(this.dependencies.config.DISCORD_GUILD_ID);
      await this.validateConfiguredGuild(guild);
      await this.timerManager.processDue(guild);
      await this.repairActiveOrders(guild);
      await this.timerManager.recoverPresence(guild);
      this.timerManager.start(guild);
      console.log(`Discord bot ${client.user.tag} connected to ${guild.name} (${guild.id}).`);
    } catch (error) {
      console.error("Discord startup validation failed:", error);
      this.destroy();
      process.exitCode = 1;
    }
  }

  private async onVoiceState(state: VoiceState): Promise<void> {
    await this.timerManager.handleVoiceState(state);
  }

  private async validateConfiguredGuild(guild: Guild): Promise<void> {
    const { config } = this.dependencies;
    const [commandChannel, logChannel, privateCategory] = await Promise.all([
      guild.channels.fetch(config.COMMAND_CHANNEL_ID),
      guild.channels.fetch(config.ORDER_LOG_CHANNEL_ID),
      guild.channels.fetch(config.PRIVATE_CATEGORY_ID),
    ]);
    if (commandChannel?.type !== ChannelType.GuildText) throw new Error("COMMAND_CHANNEL_ID is not a server text channel.");
    if (logChannel?.type !== ChannelType.GuildText) throw new Error("ORDER_LOG_CHANNEL_ID is not a server text channel.");
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
      await this.dependencies.pool.query("SELECT 1");
      await interaction.reply({ content: "✅ Бот подключён, база доступна, конфигурация сервера загружена.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    if (interaction.commandName === "codes") {
      const subcommand = interaction.options.getSubcommand();
      const codes = subcommand === "generate"
        ? await this.codeBatches.generate(interaction.options.getInteger("quantity", true))
        : await this.codeRepository.unusedCodes();
      const attachment = new AttachmentBuilder(Buffer.from(codesToCsv(codes), "utf8"), {
        name: subcommand === "generate" ? `new-codes-${Date.now()}.csv` : `unused-codes-${Date.now()}.csv`,
      });
      const action = subcommand === "generate" ? "создано" : "свободно";
      await interaction.editReply({ content: `Кодов ${action}: ${codes.length}. Файл виден только вам.`, files: [attachment] });
      return;
    }

    if (interaction.commandName === "order") {
      const subcommand = interaction.options.getSubcommand();
      const orderId = interaction.options.getInteger("number", true);
      if (subcommand === "extend") {
        const minutes = interaction.options.getInteger("minutes", true);
        const timer = await this.timerManager.extendOrder(guild, orderId, minutes);
        await interaction.editReply(
          timer?.closesAt
            ? `Заказ #${orderId} продлён. Новое закрытие: ${timer.closesAt.toLocaleString("ru-RU")}.`
            : `Активный запущенный заказ #${orderId} не найден.`,
        );
      } else {
        const closed = await this.timerManager.closeOrder(guild, orderId);
        await interaction.editReply(closed ? `Заказ #${orderId} закрыт.` : `Активный заказ #${orderId} не найден.`);
      }
    }
  }

  private async reportInteractionError(interaction: Interaction, error: unknown): Promise<void> {
    console.error("Interaction failed:", error);
    if (!interaction.isRepliable()) return;
    const content = "Не удалось выполнить команду. Проверьте журнал бота или повторите позже.";
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content, files: [] });
      else await interaction.reply({ content, ephemeral: true });
    } catch (replyError) {
      console.error("Could not report interaction error:", replyError);
    }
  }

  private async onMessage(message: Message): Promise<void> {
    const { config } = this.dependencies;
    if (message.author.bot || message.guildId !== config.DISCORD_GUILD_ID || message.channelId !== config.COMMAND_CHANNEL_ID) {
      return;
    }

    await message.delete().catch(() => undefined);
    const activation = await this.activations.activate(message.content, config.DISCORD_GUILD_ID, message.author.id);
    if (activation.kind === "blocked") {
      await sendPrivateOrTemporary(message, `Слишком много неверных попыток. Блокировка действует до ${activation.blockedUntil.toLocaleString("ru-RU")}.`);
      return;
    }
    if (activation.kind !== "activated") {
      const reason = activation.kind === "used"
        ? "Этот код уже использован."
        : activation.kind === "missing"
          ? "Такого кода нет."
          : "Код должен иметь формат XXXX-XXXX.";
      const suffix = activation.guard.blockedUntil
        ? ` После пяти ошибок вы заблокированы до ${activation.guard.blockedUntil.toLocaleString("ru-RU")}.`
        : ` Осталось попыток до блокировки: ${Math.max(0, 5 - activation.guard.failedAttempts)}.`;
      await sendPrivateOrTemporary(message, `${reason}${suffix}`);
      return;
    }
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

  private async ensureVoiceRoom(guild: Guild, order: OrderRecord): Promise<string> {
    if (order.voiceChannelId) {
      const existing = await guild.channels.fetch(order.voiceChannelId).catch(() => null);
      if (existing?.type === ChannelType.GuildVoice) {
        await this.timerManager.ensureWaiting(order.id);
        return existing.id;
      }
    }

    const { config } = this.dependencies;
    const buyer = await guild.members.fetch(order.buyerDiscordId);
    const botId = guild.members.me?.id;
    if (!botId) throw new Error("Bot guild member is unavailable.");
    const created = await guild.channels.create({
      name: privateVoiceRoomName(buyer.displayName),
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

    const storedChannelId = await this.orders.replaceVoiceChannel(order.id, order.voiceChannelId, created.id);
    if (storedChannelId !== created.id) {
      await created.delete("Duplicate room prevented").catch(() => undefined);
    }
    await this.timerManager.ensureWaiting(order.id);
    return storedChannelId;
  }

  private async repairActiveOrders(guild: Guild): Promise<void> {
    const orders = await this.orders.findActive(guild.id);
    for (const order of orders) {
      try {
        const buyer = await guild.members.fetch(order.buyerDiscordId);
        if (!buyer.roles.cache.has(this.dependencies.config.CLIENT_ROLE_ID)) {
          await buyer.roles.add(this.dependencies.config.CLIENT_ROLE_ID, `Restore active order #${order.id}`);
        }
        await this.ensureVoiceRoom(guild, order);
      } catch (error) {
        console.error(`Could not restore voice room for order #${order.id}:`, error);
      }
    }
  }
}
