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
const cron = require("node-cron");
const Database = require("better-sqlite3");
const db = new Database("bot.db");

// ================= НАСТРОЙКИ =================
const VOICE_POINTS_PER_HOUR = 10;
const HOUR = 3600;

// ================= БАЗА =================
db.exec(`
CREATE TABLE IF NOT EXISTS points (
  guild_id TEXT,
  user_id TEXT,
  points INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id,user_id)
);
CREATE TABLE IF NOT EXISTS reports (
  guild_id TEXT,
  user_id TEXT,
  channel_id TEXT,
  PRIMARY KEY (guild_id,user_id)
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  user_id TEXT,
  channel_id TEXT,
  points INTEGER,
  status TEXT
);
CREATE TABLE IF NOT EXISTS voice (
  guild_id TEXT,
  user_id TEXT,
  seconds INTEGER DEFAULT 0,
  joined_at INTEGER,
  PRIMARY KEY (guild_id,user_id)
);
`);

const now = () => Math.floor(Date.now() / 1000);

// ================= КЛИЕНТ =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

// ================= ХЕЛПЕРЫ =================
const getPoints = (g, u) =>
  db.prepare("SELECT points FROM points WHERE guild_id=? AND user_id=?")
    .get(g, u)?.points || 0;

const addPoints = (g, u, p) => {
  db.prepare("INSERT OR REPLACE INTO points VALUES (?,?,?)")
    .run(g, u, getPoints(g, u) + p);
};

const isMod = m =>
  m.roles.cache.some(r =>
    process.env.MOD_ROLE_NAMES.split(",").includes(r.name)
  );

const formatTime = s =>
  `${Math.floor(s / 3600)} ч ${Math.floor((s % 3600) / 60)} мин`;

// ================= READY =================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const g = client.guilds.cache.get(process.env.GUILD_ID);
  if (!g) return;

  // КНОПКА СОЗДАТЬ ОТЧЁТ
  const reportChannel = g.channels.cache.find(
    c => c.name === process.env.REPORT_CHANNEL_NAME
  );
  reportChannel?.send({
    content: "✨ Отправляй **+число** (пример `+25`). Скриншот по желанию.",
  });

  // ЛИДЕРБОРД (БЕЗ МАГАЗИНА)
  const lb = g.channels.cache.find(
    c => c.name === process.env.LEADERBOARD_CHANNEL_NAME
  );
  lb?.send({
    embeds: [new EmbedBuilder().setTitle("🏆 Лидерборд").setColor(0x2ecc71)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("top_points").setLabel("🏆 Топ баллов").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("my_points").setLabel("💰 Мои баллы").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("top_voice").setLabel("🎙 Топ войса").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("my_voice").setLabel("🎧 Мой войс").setStyle(ButtonStyle.Secondary)
      ),
    ],
  });

  cron.schedule("0 0 1 * *", () => {
    db.prepare("DELETE FROM points").run();
    db.prepare("DELETE FROM voice").run();
  });
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  const g = i.guild.id;
  const u = i.user.id;

  if (i.customId === "approve" || i.customId === "reject") {
    if (!isMod(i.member))
      return i.reply({ content: "❌ Нет прав", ephemeral: true });

    const sub = db.prepare(
      "SELECT * FROM submissions WHERE channel_id=? AND status='pending' ORDER BY id DESC"
    ).get(i.channel.id);

    if (!sub)
      return i.reply({ content: "❌ Заявка не найдена", ephemeral: true });

    if (i.customId === "approve") {
      addPoints(g, sub.user_id, sub.points);
      db.prepare("UPDATE submissions SET status='approved' WHERE id=?").run(sub.id);
      return i.update({ content: `✅ Одобрено (+${sub.points})`, components: [] });
    }

    if (i.customId === "reject") {
      db.prepare("UPDATE submissions SET status='rejected' WHERE id=?").run(sub.id);
      return i.update({ content: "❌ Отклонено", components: [] });
    }
  }

  if (i.customId === "my_points")
    return i.reply({ content: `💰 ${getPoints(g, u)} баллов`, ephemeral: true });

  if (i.customId === "top_points") {
    const rows = db.prepare(
      "SELECT user_id,points FROM points WHERE guild_id=? ORDER BY points DESC LIMIT 10"
    ).all(g);
    return i.reply({
      content: rows.map((r, i) => `${i + 1}. <@${r.user_id}> — ${r.points}`).join("\n") || "Пусто",
      ephemeral: true,
    });
  }

  if (i.customId === "my_voice") {
    const v = db.prepare(
      "SELECT seconds FROM voice WHERE guild_id=? AND user_id=?"
    ).get(g, u)?.seconds || 0;
    return i.reply({ content: `🎧 ${formatTime(v)}`, ephemeral: true });
  }

  if (i.customId === "top_voice") {
    const rows = db.prepare(
      "SELECT user_id,seconds FROM voice WHERE guild_id=? ORDER BY seconds DESC LIMIT 10"
    ).all(g);
    return i.reply({
      content: rows.map((r, i) => `${i + 1}. <@${r.user_id}> — ${formatTime(r.seconds)}`).join("\n") || "Пусто",
      ephemeral: true,
    });
  }
});

// ================= ЗАЯВКИ =================
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;

  const report = db.prepare(
    "SELECT * FROM reports WHERE channel_id=?"
  ).get(msg.channel.id);
  if (!report) return;

  if (!msg.content.startsWith("+")) return;

  const pts = parseInt(msg.content.slice(1));
  if (isNaN(pts)) return;

  db.prepare(
    "INSERT INTO submissions (guild_id,user_id,channel_id,points,status) VALUES (?,?,?,?,?)"
  ).run(msg.guild.id, msg.author.id, msg.channel.id, pts, "pending");

  await msg.reply({
    content: `Заявка на **+${pts} баллов**`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("approve").setLabel("Approve").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("reject").setLabel("Reject").setStyle(ButtonStyle.Danger)
      ),
    ],
  });
});

// ================= ВОЙС =================
client.on("voiceStateUpdate", (o, n) => {
  const g = n.guild.id;
  const u = n.id;

  if (!o.channelId && n.channelId) {
    db.prepare("INSERT OR IGNORE INTO voice VALUES (?,?,0,?)").run(g, u, now());
  }

  if (o.channelId && !n.channelId) {
    const r = db.prepare(
      "SELECT * FROM voice WHERE guild_id=? AND user_id=?"
    ).get(g, u);
    if (!r?.joined_at) return;

    const spent = now() - r.joined_at;
    const total = r.seconds + spent;
    addPoints(g, u, Math.floor(total / HOUR) * VOICE_POINTS_PER_HOUR);

    db.prepare(
      "UPDATE voice SET seconds=?,joined_at=NULL WHERE guild_id=? AND user_id=?"
    ).run(total, g, u);
  }
});

client.login(process.env.DISCORD_TOKEN);
