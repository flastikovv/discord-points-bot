require("dotenv").config();
const cron = require("node-cron");
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
} = require("discord.js");

const Database = require("better-sqlite3");
const db = new Database("bot.db");

// ================== DATABASE ==================
db.exec(`
CREATE TABLE IF NOT EXISTS points (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  delta_points INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS points_history (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  points INTEGER NOT NULL,
  saved_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_sessions (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS voice_stats (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS voice_history (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  seconds INTEGER NOT NULL,
  saved_at INTEGER NOT NULL
);
`);

const now = () => Math.floor(Date.now() / 1000);
const monthKey = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

// ================== HELPERS ==================
function parsePlusPoints(text) {
  const m = (text || "").match(/\+\s*(\d{1,4})/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 1 || n > 1000) return null;
  return n;
}

function modRoleNames() {
  return (process.env.MOD_ROLE_NAMES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isModerator(member) {
  const names = modRoleNames();
  if (!names.length) return member.permissions.has(PermissionsBitField.Flags.Administrator);
  return member.roles.cache.some((r) => names.includes(r.name));
}

function addPoints(guildId, userId, delta) {
  const row = db.prepare("SELECT points FROM points WHERE guild_id=? AND user_id=?").get(guildId, userId);
  if (!row) {
    db.prepare("INSERT INTO points (guild_id,user_id,points,updated_at) VALUES (?,?,?,?)")
      .run(guildId, userId, delta, now());
  } else {
    db.prepare("UPDATE points SET points=?, updated_at=? WHERE guild_id=? AND user_id=?")
      .run(row.points + delta, now(), guildId, userId);
  }
}

function getPoints(guildId, userId) {
  const row = db.prepare("SELECT points FROM points WHERE guild_id=? AND user_id=?").get(guildId, userId);
  return row?.points ?? 0;
}

function topPoints(guildId, limit = 20) {
  return db.prepare("SELECT user_id, points FROM points WHERE guild_id=? ORDER BY points DESC LIMIT ?")
    .all(guildId, limit);
}

function addVoiceSeconds(guildId, userId, seconds) {
  if (seconds <= 0) return;
  const row = db.prepare("SELECT seconds FROM voice_stats WHERE guild_id=? AND user_id=?").get(guildId, userId);
  if (!row) {
    db.prepare("INSERT INTO voice_stats (guild_id,user_id,seconds,updated_at) VALUES (?,?,?,?)")
      .run(guildId, userId, seconds, now());
  } else {
    db.prepare("UPDATE voice_stats SET seconds=?, updated_at=? WHERE guild_id=? AND user_id=?")
      .run(row.seconds + seconds, now(), guildId, userId);
  }
}

function getVoiceSeconds(guildId, userId) {
  const row = db.prepare("SELECT seconds FROM voice_stats WHERE guild_id=? AND user_id=?").get(guildId, userId);
  return row?.seconds ?? 0;
}

function topVoice(guildId, limit = 20) {
  return db.prepare("SELECT user_id, seconds FROM voice_stats WHERE guild_id=? ORDER BY seconds DESC LIMIT ?")
    .all(guildId, limit);
}

function fmtTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${sec}с`;
  return `${sec}с`;
}

// ================== CLIENT ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates, // 👈 для учета войса
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

// ================== LEADERBOARD ==================
async function updateLeaderboard(guild) {
  const channel = guild.channels.cache.find((c) => c.name === process.env.LEADERBOARD_CHANNEL_NAME);
  if (!channel) return;

  const top = topPoints(guild.id, 20);
  const text = top.length
    ? top.map((u, i) => `**${i + 1}.** <@${u.user_id}> — **${u.points}** баллов`).join("\n")
    : "Пока нет данных.";

  const embed = new EmbedBuilder()
    .setTitle("🏆 Таблица баллов")
    .setDescription(text)
    .setFooter({ text: `Месяц: ${monthKey()} | Баллы начисляются после подтверждения модератора` });

  const msgs = await channel.messages.fetch({ limit: 20 });
  const old = msgs.find((m) => m.author.id === client.user.id && m.embeds.length);
  if (old) await old.edit({ embeds: [embed] });
  else await channel.send({ embeds: [embed] });
}

// ================== SLASH COMMANDS ==================
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("my_points").setDescription("Показать мои баллы"),
    new SlashCommandBuilder().setName("leaderboard").setDescription("Показать топ по баллам"),
    new SlashCommandBuilder()
      .setName("add_points")
      .setDescription("Добавить баллы игроку (только модеры)")
      .addUserOption((o) => o.setName("user").setDescription("Кому").setRequired(true))
      .addIntegerOption((o) =>
        o.setName("points").setDescription("Сколько (1-1000)").setRequired(true).setMinValue(1).setMaxValue(1000)
      ),
    new SlashCommandBuilder().setName("my_voice").setDescription("Показать мой актив в войсе"),
    new SlashCommandBuilder().setName("voice_top").setDescription("Топ по войсу"),
    new SlashCommandBuilder()
      .setName("reset_month")
      .setDescription("Сбросить баллы/войс вручную (только модеры)"),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  const appId = client.user.id;

  // Регистрируем глобально (может обновляться до ~1 часа)
  // Если хочешь быстрее (моментально), можно на сервер (guild) — скажешь, сделаю.
  const guildId = process.env.GUILD_ID;
if (guildId) {
  await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: commands });
} else {
  await rest.put(Routes.applicationCommands(appId), { body: commands });
}

// ================== MONTH RESET ==================
async function doMonthlyReset(guild) {
  const mk = monthKey();
  const savedAt = now();

  // Архив баллов
  const all = db.prepare("SELECT user_id, points FROM points WHERE guild_id=?").all(guild.id);
  const insHist = db.prepare("INSERT INTO points_history (guild_id,user_id,month,points,saved_at) VALUES (?,?,?,?,?)");
  const tx1 = db.transaction((rows) => {
    for (const r of rows) insHist.run(guild.id, r.user_id, mk, r.points, savedAt);
  });
  tx1(all);

  // Архив войса
  const vAll = db.prepare("SELECT user_id, seconds FROM voice_stats WHERE guild_id=?").all(guild.id);
  const insVHist = db.prepare("INSERT INTO voice_history (guild_id,user_id,month,seconds,saved_at) VALUES (?,?,?,?,?)");
  const tx2 = db.transaction((rows) => {
    for (const r of rows) insVHist.run(guild.id, r.user_id, mk, r.seconds, savedAt);
  });
  tx2(vAll);

  // Чистим текущие
  db.prepare("DELETE FROM points WHERE guild_id=?").run(guild.id);
  db.prepare("DELETE FROM submissions WHERE guild_id=?").run(guild.id);
  db.prepare("DELETE FROM voice_sessions WHERE guild_id=?").run(guild.id);
  db.prepare("DELETE FROM voice_stats WHERE guild_id=?").run(guild.id);

  // Сообщение в таблицу
  const lb = guild.channels.cache.find((c) => c.name === process.env.LEADERBOARD_CHANNEL_NAME);
  if (lb) {
    await lb.send(`🔄 **Сброс месяца выполнен!** Начался новый месяц: **${monthKey()}**`);
  }

  await updateLeaderboard(guild);
}

// ================== READY ==================
client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  // Регистрируем слеш-команды
  await registerCommands();

  // Кнопка в канал отчётов (чтобы не спамить — отправляем только если нет свежей)
  const guild = client.guilds.cache.first();
  if (!guild) return;

  const reportChannel = guild.channels.cache.find((c) => c.name === process.env.REPORT_CHANNEL_NAME);
  if (reportChannel) {
    const recent = (await reportChannel.messages.fetch({ limit: 20 })).find(
      (m) => m.author.id === client.user.id && m.components?.length
    );
    if (!recent) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("create_report").setLabel("Создать отчёт").setStyle(ButtonStyle.Primary)
      );
      await reportChannel.send({
        content:
          "Нажми **«Создать отчёт»**, чтобы открыть приватный канал.\n" +
          "Внутри прикрепи скрин и напиши `+число` (от 1 до 1000).",
        components: [row],
      });
    }
  }

  await updateLeaderboard(guild);

  // Автосброс 1 числа в 00:05 по TZ (МСК если TZ=Europe/Moscow)
  cron.schedule("5 0 1 * *", async () => {
    try {
      const g = client.guilds.cache.first();
      if (g) await doMonthlyReset(g);
    } catch (e) {
      console.error("Monthly reset failed:", e);
    }
  });

  console.log("Monthly reset cron scheduled: 00:05 on day 1");
});

// ================== BUTTONS ==================
client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const guild = interaction.guild;
    if (!guild) return;

    if (interaction.commandName === "my_points") {
      const pts = getPoints(guild.id, interaction.user.id);
      return interaction.reply({ content: `💳 У тебя **${pts}** баллов (месяц ${monthKey()}).`, ephemeral: true });
    }

    if (interaction.commandName === "leaderboard") {
      const top = topPoints(guild.id, 15);
      const text = top.length
        ? top.map((u, i) => `**${i + 1}.** <@${u.user_id}> — **${u.points}**`).join("\n")
        : "Пока пусто.";
      return interaction.reply({ content: `🏆 **Топ баллов (${monthKey()})**\n${text}`, ephemeral: false });
    }

    if (interaction.commandName === "add_points") {
      const member = await guild.members.fetch(interaction.user.id);
      if (!isModerator(member)) {
        return interaction.reply({ content: "❌ Только модераторы могут добавлять баллы.", ephemeral: true });
      }
      const user = interaction.options.getUser("user", true);
      const pts = interaction.options.getInteger("points", true);
      addPoints(guild.id, user.id, pts);
      await updateLeaderboard(guild);
      return interaction.reply({ content: `✅ Начислено <@${user.id}> **+${pts}** баллов.` });
    }

    if (interaction.commandName === "my_voice") {
      const sec = getVoiceSeconds(guild.id, interaction.user.id);
      return interaction.reply({ content: `🎙 Твой актив в войсе: **${fmtTime(sec)}** (месяц ${monthKey()}).`, ephemeral: true });
    }

    if (interaction.commandName === "voice_top") {
      const top = topVoice(guild.id, 15);
      const text = top.length
        ? top.map((u, i) => `**${i + 1}.** <@${u.user_id}> — **${fmtTime(u.seconds)}**`).join("\n")
        : "Пока пусто.";
      return interaction.reply({ content: `🎙 **Топ войса (${monthKey()})**\n${text}`, ephemeral: false });
    }

    if (interaction.commandName === "reset_month") {
      const member = await guild.members.fetch(interaction.user.id);
      if (!isModerator(member)) {
        return interaction.reply({ content: "❌ Только модераторы могут делать сброс.", ephemeral: true });
      }
      await interaction.reply({ content: "🔄 Делаю сброс месяца..." });
      await doMonthlyReset(guild);
      return;
    }
  }

  if (!interaction.isButton()) return;
  if (!interaction.guild) return;

  // ---------- CREATE REPORT ----------
  if (interaction.customId === "create_report") {
    const guild = interaction.guild;
    const member = interaction.member;

    const modRoles = guild.roles.cache.filter((r) => modRoleNames().includes(r.name));

    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      {
        id: member.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
      {
        id: client.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
      ...modRoles.map((r) => ({
        id: r.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      })),
    ];

    const name = `отчёт-${member.user.username}`
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]/gi, "-")
      .slice(0, 90);

    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      permissionOverwrites: overwrites,
      reason: "Создан приватный канал отчёта",
    });

    await channel.send(
      `Привет, <@${member.id}> 👋\n` +
        `Прикрепи **скрин** и напиши **+число** (от 1 до 1000).\n` +
        `После этого модератор подтвердит начисление.`
    );

    return interaction.reply({ content: `✅ Канал создан: ${channel}`, ephemeral: true });
  }

  // ---------- APPROVE / REJECT ----------
  if (interaction.customId.startsWith("approve:") || interaction.customId.startsWith("reject:")) {
    const member = interaction.member;
    if (!isModerator(member)) {
      return interaction.reply({ content: "❌ Только модератор может подтверждать.", ephemeral: true });
    }

    const [action, id] = interaction.customId.split(":");
    const sub = db.prepare("SELECT * FROM submissions WHERE id=?").get(id);

    if (!sub || sub.status !== "pending") {
      return interaction.reply({ content: "Заявка не найдена или уже обработана.", ephemeral: true });
    }

    if (action === "approve") {
      db.prepare("UPDATE submissions SET status='approved' WHERE id=?").run(id);
      addPoints(sub.guild_id, sub.user_id, sub.delta_points);
      await interaction.reply(`✅ <@${sub.user_id}> получил **+${sub.delta_points}** баллов`);
      await updateLeaderboard(interaction.guild);
    } else {
      db.prepare("UPDATE submissions SET status='rejected' WHERE id=?").run(id);
      await interaction.reply("❌ Заявка отклонена");
    }
  }
});

// ================== MESSAGES (отчеты) ==================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.channel.name.startsWith("отч")) return;

  const points = parsePlusPoints(message.content);
  const hasAttachment = message.attachments.size > 0;
  if (!points || !hasAttachment) return;

  const info = db
    .prepare(
      "INSERT INTO submissions (guild_id,user_id,channel_id,message_id,delta_points,status,created_at) VALUES (?,?,?,?,?,'pending',?)"
    )
    .run(message.guild.id, message.author.id, message.channel.id, message.id, points, now());

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`approve:${info.lastInsertRowid}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reject:${info.lastInsertRowid}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
  );

  await message.reply({ content: `📝 Заявка создана: **+${points}** баллов`, components: [row] });
});

// ================== VOICE TRACKING ==================
// считаем время, когда человек в войсе и НЕ selfMute/selfDeaf
client.on("voiceStateUpdate", (oldState, newState) => {
  const guildId = newState.guild.id;
  const userId = newState.id;

  const wasIn = oldState.channelId != null;
  const nowIn = newState.channelId != null;

  const wasActive = wasIn && !oldState.selfMute && !oldState.selfDeaf;
  const nowActive = nowIn && !newState.selfMute && !newState.selfDeaf;

  // старт активной сессии
  if (!wasActive && nowActive) {
    db.prepare("INSERT OR REPLACE INTO voice_sessions (guild_id,user_id,joined_at) VALUES (?,?,?)")
      .run(guildId, userId, now());
  }

  // конец активной сессии
  if (wasActive && !nowActive) {
    const sess = db.prepare("SELECT joined_at FROM voice_sessions WHERE guild_id=? AND user_id=?")
      .get(guildId, userId);
    if (sess) {
      const seconds = Math.max(0, now() - sess.joined_at);
      db.prepare("DELETE FROM voice_sessions WHERE guild_id=? AND user_id=?").run(guildId, userId);
      addVoiceSeconds(guildId, userId, seconds);
    }
  }
});

// ================== LOGIN ==================
client.login(process.env.DISCORD_TOKEN);
