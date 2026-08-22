import {
  ChannelType,
  type Client,
  type Guild,
  type VoiceState,
} from "discord.js";
import type { AppConfig } from "../config.js";
import { OrderRepository, type OrderRecord } from "../db/order-repository.js";
import { TimerRepository, type OrderTimerRecord } from "../db/timer-repository.js";
import { dueAction } from "../timers/due-action.js";
import { timerPolicy, type TimerPolicy } from "../timers/policy.js";

export class DiscordTimerManager {
  private readonly policy: TimerPolicy;
  private interval: NodeJS.Timeout | null = null;

  public constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
    private readonly orders: OrderRepository,
    private readonly timers: TimerRepository,
  ) {
    this.policy = timerPolicy(config.TEST_MODE);
  }

  public stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  public start(guild: Guild): void {
    this.stop();
    this.interval = setInterval(() => {
      void this.processDue(guild).catch((error: unknown) => console.error("Timer processing failed:", error));
    }, this.policy.pollMilliseconds);
  }

  public async ensureWaiting(orderId: number): Promise<void> {
    const expiresAt = new Date(Date.now() + this.policy.waitingMilliseconds);
    await this.timers.ensureWaiting(orderId, expiresAt);
  }

  public async handleVoiceState(state: VoiceState): Promise<void> {
    if (state.guild.id !== this.config.DISCORD_GUILD_ID || !state.channelId || state.member?.user.bot) return;
    const order = await this.orders.findByVoiceChannel(state.channelId);
    if (!order || !state.channel) return;
    await this.evaluatePresence(order, state.channel.members);
  }

  public async recoverPresence(guild: Guild): Promise<void> {
    const activeTimers = await this.timers.findActive(guild.id);
    for (const timer of activeTimers) {
      const channel = await guild.channels.fetch(timer.voiceChannelId).catch(() => null);
      if (channel?.type === ChannelType.GuildVoice) {
        await this.evaluatePresence(this.timerAsOrder(timer), channel.members);
      }
    }
  }

  public async processDue(guild: Guild): Promise<void> {
    const now = new Date();
    const activeTimers = await this.timers.findActive(guild.id);
    for (const timer of activeTimers) {
      const action = dueAction(timer, now);
      if (action === "expire_waiting") {
        await this.orders.finalize(timer.orderId, "not_started");
        await this.log(guild, `⌛ Заказ #${timer.orderId} не начался вовремя и закрыт.`);
      } else if (action === "warn") {
        await this.warnParticipants(timer);
        await this.timers.markWarningSent(timer.orderId, now);
        await this.log(guild, `⚠️ Для заказа #${timer.orderId} отправлено предупреждение.`);
      } else if (action === "lock") {
        await this.lockEntry(guild, timer);
        await this.timers.markEntryLocked(timer.orderId, now);
        await this.log(guild, `🔒 Вход в комнату заказа #${timer.orderId} закрыт.`);
      } else if (action === "complete") {
        await this.orders.finalize(timer.orderId, "completed");
        await this.log(guild, `✅ Время заказа #${timer.orderId} завершено.`);
      }
    }
    await this.cleanupFinalized(guild);
  }

  public async extendOrder(guild: Guild, orderId: number, minutes: number): Promise<OrderTimerRecord | null> {
    const order = await this.orders.findById(orderId);
    if (!order || order.guildId !== guild.id || order.status !== "active") return null;
    const extended = await this.timers.extend(orderId, minutes);
    if (!extended) return null;
    if (extended.wasLocked) {
      const channel = await guild.channels.fetch(extended.timer.voiceChannelId).catch(() => null);
      if (channel?.type === ChannelType.GuildVoice) {
        await Promise.all([
          channel.permissionOverwrites.edit(extended.timer.buyerDiscordId, { Connect: true }),
          channel.permissionOverwrites.edit(this.config.EGIRL_ROLE_ID, { Connect: true }),
        ]);
      }
    }
    await this.log(guild, `➕ Заказ #${orderId} продлён на ${minutes} мин.`);
    return extended.timer;
  }

  public async closeOrder(guild: Guild, orderId: number): Promise<boolean> {
    const order = await this.orders.findById(orderId);
    if (!order || order.guildId !== guild.id || order.status !== "active") return false;
    await this.orders.finalize(orderId, "closed");
    await this.cleanupFinalized(guild);
    await this.log(guild, `🛑 Заказ #${orderId} досрочно закрыт куратором.`);
    return true;
  }

  private async evaluatePresence(order: OrderRecord, members: ReadonlyMap<string, import("discord.js").GuildMember>): Promise<void> {
    const people = [...members.values()].filter((member) => !member.user.bot);
    const girls = people.filter((member) => member.roles.cache.has(this.config.EGIRL_ROLE_ID));
    for (const girl of girls) await this.timers.addParticipant(order.id, girl.id);
    const buyerPresent = people.some((member) => member.id === order.buyerDiscordId);
    if (!buyerPresent || girls.length === 0) return;

    const started = await this.timers.startIfWaiting(order.id, new Date(), this.policy);
    if (started) {
      const guild = members.values().next().value?.guild;
      if (guild) await this.log(guild, `▶️ Таймер заказа #${order.id} запущен.`);
    }
  }

  private async warnParticipants(timer: OrderTimerRecord): Promise<void> {
    const userIds = new Set([timer.buyerDiscordId, ...(await this.timers.participantIds(timer.orderId))]);
    const minutes = Math.max(1, Math.round(this.policy.warningBeforeMilliseconds / 60_000));
    for (const userId of userIds) {
      const user = await this.client.users.fetch(userId).catch(() => null);
      if (user) await user.send(`До закрытия комнаты заказа #${timer.orderId} осталось ${minutes} мин.`).catch(() => undefined);
    }
  }

  private async lockEntry(guild: Guild, timer: OrderTimerRecord): Promise<void> {
    const channel = await guild.channels.fetch(timer.voiceChannelId).catch(() => null);
    if (channel?.type !== ChannelType.GuildVoice) return;
    await Promise.all([
      channel.permissionOverwrites.edit(timer.buyerDiscordId, { Connect: false }),
      channel.permissionOverwrites.edit(this.config.EGIRL_ROLE_ID, { Connect: false }),
    ]);
  }

  private async cleanupFinalized(guild: Guild): Promise<void> {
    const orders = await this.orders.pendingCleanup(guild.id);
    for (const order of orders) {
      if (order.voiceChannelId) {
        const channel = await guild.channels.fetch(order.voiceChannelId).catch(() => null);
        if (channel) await channel.delete(`Order #${order.id} finished`).catch(() => undefined);
      }
      if (!(await this.orders.buyerHasActiveOrders(guild.id, order.buyerDiscordId))) {
        const buyer = await guild.members.fetch(order.buyerDiscordId).catch(() => null);
        if (buyer?.roles.cache.has(this.config.CLIENT_ROLE_ID)) {
          await buyer.roles.remove(this.config.CLIENT_ROLE_ID, `Order #${order.id} finished`);
        }
      }
      await this.orders.clearVoiceChannel(order.id);
    }
  }

  private async log(guild: Guild, message: string): Promise<void> {
    const channel = await guild.channels.fetch(this.config.ORDER_LOG_CHANNEL_ID).catch(() => null);
    if (channel?.isTextBased() && channel.isSendable()) {
      await channel.send(message);
    }
  }

  private timerAsOrder(timer: OrderTimerRecord): OrderRecord {
    return {
      id: timer.orderId,
      guildId: timer.guildId,
      buyerDiscordId: timer.buyerDiscordId,
      voiceChannelId: timer.voiceChannelId,
      status: "active",
      createdAt: timer.startedAt ?? timer.waitingExpiresAt,
      startedAt: timer.startedAt,
      closedAt: null,
    };
  }
}
