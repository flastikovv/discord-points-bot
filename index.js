require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require("discord.js");
const Database = require("better-sqlite3");
const cron = require("node-cron");

const db = new Database("bot.db");

// =================== НАСТРОЙКИ ===================
const VOICE_POINTS_PER_HOUR = 10;
const HOUR = 3600;

// Магазин (всё, что ты просил)
const SHOP_ITEMS = [
  // Деньги
  { id: "cash_50k", label: "💵 50.000$", cost: 100 },
  { id: "cash_100k", label: "💵 100.000$", cost: 180 },
  { id: "cash_300k", label: "💵 300.000$", cost: 450 },
  { id: "cash_500k", label: "💵 500.000$", cost: 700 },

  // Предметы
  { id: "spank_10", label: "💊 Spank x10", cost: 120 },
  { id: "shotgun", label: "🔫 Assault Shotgun", cost: 300 },

  // “Гибкие” награды (выдача вручную, но списание автоматом)
  { id: "item_500k", label: "🎁 Предмет до 500.000$", cost: 800 },
  { id: "car_1m", label: "🚗 Машина до 1.000.000$", cost: 900 },

  // IRL (антифарм — делаем дорогими)
  { id: "nitro", label: "💎 Discord Nitro (1м)", cost: 1200 },
  { id: "irl_small", label: "🍔 ИРЛ приз (малый)", cost: 1500 },
  { id: "irl_medium", label: "🎮 ИРЛ приз (средний)", cost: 2200 },
];

// =================== DB ===================
db.exec(`
CREATE TABLE IF NOT EXISTS points (
  guild_id TEXT,
  user_id TEXT,
  points INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS reports (
  guild_id TEXT,
  user_id TEXT,
  channel_id TEXT,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  user_id TEXT,
  channel_id TEXT,
  points INTEGER,
  status TEXT
);

-- voice:
-- seconds_total: накопленное время
-- joined_at: время входа в войс
-- hours_awarded: сколько часов уже конвертировано в баллы
CREATE TABLE IF NOT EXISTS voice (
  guild_id TEXT,
  user_id TEXT,
  seconds_total INTEGER DEFAULT 0,
  joined_at INTEGER,
  hours_awarded INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

-- settings: храним message_id плашек, чтобы редактировать, а не спамить
CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT,
  key TEXT,
  value TEXT,
  PRIMARY KEY (guild_id, key)
);
`);

const now = () => Math.floor(Date.now() / 1000);

// =================== HELPERS ===================
function getSetting(g, key) {
  return db.prepare("SELECT value FROM settings WHERE guild_id=? AND key=?").get(g, key)?.value || null;
}
function setSetting(g, key, value) {
  db.prepare("INSERT OR REPLACE INTO settings (guild_id,key,value) VALUES (?,?,?)").run(g, key, String(value));
}

function getPoints(g, u) {
  return db.prepare("SELECT points FROM points WHERE guild_id=? AND user_id=?").get(g, u)?.points || 0;
}
function addPoints(g, u, p) {
  const cur = getPoints(g, u);
  db.prepare("INSERT OR REPLACE INTO points (guild_id,user_id,points) VALUES (?,?,?)").run(g, u, cur + p);
}
function removePoints(g, u, p) {
  const cur = getPoints(g, u);
  if (cur < p) return false;
  db.prepare("UPDATE points SET points=? WHERE guild_id=? AND user_id=?").run(cur - p, g, u);
  return true;
}

function isMod(member) {
  return member.roles.cache.some((r) => process.env.MOD_ROLE_NAMES.split(",").includes(r.name));
}

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}ч ${m}м`;
}

function getChannelByName(guild, name) {
  return guild.channels.cache.find((c) => c && c.name === name) || null;
}

async function safeSendLog(guild, text) {
  const logCh = getChannelByName(guild, process.env.MOD_LOG_CHANNEL_NAME);
  if (!logCh) return;
  try {
    await logCh.send(text);
  } catch (e) {
    // игнорируем, чтобы бот не падал
  }
}

// =================== UI BUILDERS ===================
function buildLeaderboardEmbed(guildId) {
  const rows = db.prepare(
    "SELECT user_id, points FROM points WHERE guild_id=? ORDER BY points DESC LIMIT 10"
  ).all(guildId);

  const desc = rows.length
    ? rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — **${r.points}**`).join("\n")
    : "Пока пусто.";

  return new EmbedBuilder()
    .setTitle("🏆 Лидерборд (автообновление)")
    .setDescription(desc)
    .setFooter({ text: `Обновлено: ${new Date().toLocaleString("ru-RU")}` })
    .setColor(0x2ecc71);
}

function buildLeaderboardButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("lb_top_points").setLabel("🏆 Топ баллов").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("lb_my_points").setLabel("💰 Мои баллы").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("lb_top_voice").setLabel("🎙 Топ войса").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("lb_my_voice").setLabel("🎧 Мой войс").setStyle(ButtonStyle.Secondary),
  );
}

function buildShopEmbed() {
  const lines = SHOP_ITEMS.map((i) => `• ${i.label} — **${i.cost}** баллов`).join("\n");
  return new EmbedBuilder()
    .setTitle("🛒 Магазин")
    .setDescription(lines)
    .setFooter({ text: "Покупка списывает баллы автоматически. Выдача наград — по правилам сервера." })
    .setColor(0xf1c40f);
}

function buildShopRows() {
  // Discord: до 5 кнопок в ряд, до 5 рядов. Сделаем максимум 25 предметов (у нас меньше).
  const rows = [];
  let current = new ActionRowBuilder();
  let countInRow = 0;

  for (const item of SHOP_ITEMS) {
    if (countInRow === 5) {
      rows.push(current);
      current = new ActionRowBuilder();
      countInRow = 0;
    }
    current.addComponents(
      new ButtonBuilder()
        .setCustomId(`buy_${item.id}`)
        .setLabel(item.label)
        .setStyle(ButtonStyle.Primary)
    );
    countInRow++;
  }

  if (countInRow > 0) rows.push(current);
  return rows.slice(0, 5);
}

// =================== ENSURE PANELS ===================
async function ensurePanelMessage(channel, guildId, key, payloadBuilder) {
  // payloadBuilder() => { embeds, components, content }
  const stored = getSetting(guildId, key);
  if (stored) {
    try {
      const msg = await channel.messages.fetch(stored);
      const payload = payloadBuilder();
      await msg.edit(payload);
      return msg.id;
    } catch (e) {
      // message not found / no access => заново создаём
    }
  }

  const payload = payloadBuilder();
  const msg = await channel.send(payload);
  setSetting(guildId, key, msg.id);
  return msg.id;
}

async function updateLeaderboard(guild) {
  const lbCh = getChannelByName(guild, process.env.LEADERBOARD_CHANNEL_NAME);
  if (!lbCh) return;

  await ensurePanelMessage(lbCh, guild.id, "leaderboard_message_id", () => ({
    embeds: [buildLeaderboardEmbed(guild.id)],
    components: [buildLeaderboardButtons()],
  }));
}

// =================== DISCORD CLIENT ===================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;

  // 1) Панель отчётов (кнопка)
  const reportCh = getChannelByName(guild, process.env.REPORT_CHANNEL_NAME);
  if (reportCh) {
    await ensurePanelMessage(reportCh, guild.id, "report_panel_message_id", () => ({
      content: "📸 Нажми кнопку, чтобы создать **личный канал отчёта** (один раз). Дальше кидаешь всё туда.",
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("create_report").setLabel("Создать отчёт").setStyle(ButtonStyle.Primary)
        ),
      ],
    }));
  }

  // 2) Лидерборд (автообновляемая плашка)
  await updateLeaderboard(guild);

  // 3) Магазин (плашка + кнопки)
  const shopCh = getChannelByName(guild, process.env.SHOP_CHANNEL_NAME);
  if (shopCh) {
    await ensurePanelMessage(shopCh, guild.id, "shop_message_id", () => ({
      embeds: [buildShopEmbed()],
      components: buildShopRows(),
    }));
  }

  // 4) Автообновление лидерборда каждые 5 минут (на всякий)
  setInterval(() => updateLeaderboard(guild), 5 * 60 * 1000);

  // 5) Автосброс 1 числа
  cron.schedule("0 0 1 * *", async () => {
    db.prepare("DELETE FROM points").run();
    db.prepare("DELETE FROM voice").run();
    await safeSendLog(guild, "🔄 Автосброс: баллы и войс статистика обнулены (1 число).");
    await updateLeaderboard(guild);
  });

  await safeSendLog(guild, "✅ Бот запущен и панели обновлены.");
});

// =================== INTERACTIONS ===================
client.on("interactionCreate", async (i) => {
  if (!i.isButton()) return;

  const guild = i.guild;
  const g = guild.id;
  const u = i.user.id;

  // -------- CREATE REPORT (личный канал) --------
  if (i.customId === "create_report") {
    const exists = db.prepare("SELECT channel_id FROM reports WHERE guild_id=? AND user_id=?").get(g, u);
    if (exists) {
      return i.reply({ content: "❌ У тебя уже есть канал отчёта.", ephemeral: true });
    }

    const modRoles = guild.roles.cache.filter((r) => process.env.MOD_ROLE_NAMES.split(",").includes(r.name));

    const overwrites = [
      { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
      {
        id: u,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      },
      {
        id: guild.members.me.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageMessages,
        ],
      },
    ];

    modRoles.forEach((r) => {
      overwrites.push({
        id: r.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageMessages,
        ],
      });
    });

    const ch = await guild.channels.create({
      name: `отчёт-${i.user.username}`.toLowerCase(),
      type: ChannelType.GuildText,
      permissionOverwrites: overwrites,
    });

    db.prepare("INSERT INTO reports (guild_id,user_id,channel_id) VALUES (?,?,?)").run(g, u, ch.id);

    await ch.send(
      "✨ **Инструкция**\n" +
      "Кидай скриншот (желательно) и в сообщении пиши `+число`.\n" +
      "Пример: `+25`\n\n" +
      "Каждое сообщение = заявка. Модератор нажмёт Approve/Reject."
    );

    await safeSendLog(guild, `📌 Создан канал отчёта: ${ch} для <@${u}>`);
    return i.reply({ content: `✅ Канал отчёта создан: ${ch}`, ephemeral: true });
  }

  // -------- LEADERBOARD BUTTONS --------
  if (i.customId === "lb_my_points") {
    return i.reply({ content: `💰 У тебя **${getPoints(g, u)}** баллов.`, ephemeral: true });
  }

  if (i.customId === "lb_top_points") {
    const rows = db.prepare(
      "SELECT user_id, points FROM points WHERE guild_id=? ORDER BY points DESC LIMIT 10"
    ).all(g);

    const text = rows.length
      ? rows.map((r, idx) => `**${idx + 1}.** <@${r.user_id}> — **${r.points}**`).join("\n")
      : "Пока пусто.";

    return i.reply({ content: text, ephemeral: true });
  }

  if (i.customId === "lb_my_voice") {
    const v = db.prepare("SELECT seconds_total FROM voice WHERE guild_id=? AND user_id=?").get(g, u)?.seconds_total || 0;
    return i.reply({ content: `🎧 Твой войс: **${formatTime(v)}**`, ephemeral: true });
  }

  if (i.customId === "lb_top_voice") {
    const rows = db.prepare(
      "SELECT user_id, seconds_total FROM voice WHERE guild_id=? ORDER BY seconds_total DESC LIMIT 10"
    ).all(g);

    const text = rows.length
      ? rows.map((r, idx) => `**${idx + 1}.** <@${r.user_id}> — **${formatTime(r.seconds_total)}**`).join("\n")
      : "Пока пусто.";

    return i.reply({ content: text, ephemeral: true });
  }

  // -------- SHOP BUY --------
  if (i.customId.startsWith("buy_")) {
    const itemId = i.customId.replace("buy_", "");
    const item = SHOP_ITEMS.find((x) => x.id === itemId);
    if (!item) return i.reply({ content: "❌ Товар не найден.", ephemeral: true });

    if (!removePoints(g, u, item.cost)) {
      return i.reply({ content: "❌ Недостаточно баллов.", ephemeral: true });
    }

    await safeSendLog(guild, `🛒 Покупка: <@${u}> купил **${item.label}** за **${item.cost}** баллов.`);
    await updateLeaderboard(guild);

    return i.reply({ content: `✅ Куплено: **${item.label}** (-${item.cost} баллов)`, ephemeral: true });
  }

  // -------- APPROVE / REJECT --------
  if (i.customId === "approve" || i.customId === "reject") {
    if (!isMod(i.member)) return i.reply({ content: "❌ Нет прав.", ephemeral: true });

    const sub = db.prepare(
      "SELECT * FROM submissions WHERE channel_id=? AND status='pending' ORDER BY id DESC"
    ).get(i.channel.id);

    if (!sub) return i.reply({ content: "❌ Заявка не найдена.", ephemeral: true });

    if (i.customId === "approve") {
      addPoints(g, sub.user_id, sub.points);
      db.prepare("UPDATE submissions SET status='approved' WHERE id=?").run(sub.id);

      await safeSendLog(guild, `✅ Approve: ${i.user.tag} начислил +${sub.points} <@${sub.user_id}> (канал: <#${sub.channel_id}>)`);
      await updateLeaderboard(guild);

      return i.update({ content: `✅ **Одобрено** (+${sub.points})`, components: [] });
    } else {
      db.prepare("UPDATE submissions SET status='rejected' WHERE id=?").run(sub.id);

      await safeSendLog(guild, `❌ Reject: ${i.user.tag} отклонил заявку <@${sub.user_id}> (канал: <#${sub.channel_id}>)`);
      return i.update({ content: `❌ **Отклонено**`, components: [] });
    }
  }
});

// =================== REPORT SUBMISSIONS ===================
client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  // проверяем, что это канал отчёта
  const rep = db.prepare("SELECT * FROM reports WHERE channel_id=?").get(msg.channel.id);
  if (!rep) return;

  // заявка только если начинается с "+"
  if (!msg.content.startsWith("+")) return;

  const pts = parseInt(msg.content.slice(1), 10);
  if (!Number.isFinite(pts) || pts <= 0 || pts > 1000) return;

  db.prepare(
    "INSERT INTO submissions (guild_id,user_id,channel_id,points,status) VALUES (?,?,?,?,?)"
  ).run(msg.guild.id, msg.author.id, msg.channel.id, pts, "pending");

  await msg.reply({
    content: `Заявка на **+${pts}** баллов. Модератор, примите решение:`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("approve").setLabel("Approve").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("reject").setLabel("Reject").setStyle(ButtonStyle.Danger),
      ),
    ],
  });
});

// =================== VOICE TRACKING ===================
client.on("voiceStateUpdate", async (oldState, newState) => {
  const guild = newState.guild;
  const g = guild.id;
  const u = newState.id;

  // вход в любой войс
  if (!oldState.channelId && newState.channelId) {
    const row = db.prepare("SELECT * FROM voice WHERE guild_id=? AND user_id=?").get(g, u);

    if (!row) {
      db.prepare("INSERT INTO voice (guild_id,user_id,seconds_total,joined_at,hours_awarded) VALUES (?,?,?,?,?)")
        .run(g, u, 0, now(), 0);
    } else {
      // если уже есть — просто ставим joined_at (если вдруг было null)
      db.prepare("UPDATE voice SET joined_at=? WHERE guild_id=? AND user_id=?").run(now(), g, u);
    }
    return;
  }

  // выход из войса
  if (oldState.channelId && !newState.channelId) {
    const row = db.prepare("SELECT * FROM voice WHERE guild_id=? AND user_id=?").get(g, u);
    if (!row || !row.joined_at) return;

    const spent = now() - row.joined_at;
    const total = (row.seconds_total || 0) + spent;

    const totalHours = Math.floor(total / HOUR);
    const awarded = row.hours_awarded || 0;
    const deltaHours = Math.max(0, totalHours - awarded);

    if (deltaHours > 0) {
      addPoints(g, u, deltaHours * VOICE_POINTS_PER_HOUR);
      await safeSendLog(guild, `🎙 Войс: <@${u}> получил +${deltaHours * VOICE_POINTS_PER_HOUR} (за ${deltaHours}ч)`);
      await updateLeaderboard(guild);
    }

    db.prepare("UPDATE voice SET seconds_total=?, joined_at=NULL, hours_awarded=? WHERE guild_id=? AND user_id=?")
      .run(total, totalHours, g, u);

    return;
  }
});

client.login(process.env.DISCORD_TOKEN);
