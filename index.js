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

// ================== НАСТРОЙКИ ==================
const VOICE_POINTS_PER_HOUR = 10;
const HOUR = 3600;

// ================== БАЗА ==================
db.exec(`
CREATE TABLE IF NOT EXISTS points (
  guild_id TEXT,
  user_id TEXT,
  points INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS voice (
  guild_id TEXT,
  user_id TEXT,
  seconds INTEGER DEFAULT 0,
  joined_at INTEGER,
  PRIMARY KEY (guild_id, user_id)
);
`);

const now = () => Math.floor(Date.now() / 1000);

// ================== КЛИЕНТ ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ================== ХЕЛПЕРЫ ==================
function getPoints(g, u) {
  return (
    db.prepare("SELECT points FROM points WHERE guild_id=? AND user_id=?")
      .get(g, u)?.points || 0
  );
}

function addPoints(g, u, p) {
  const cur = getPoints(g, u);
  db.prepare("INSERT OR REPLACE INTO points VALUES (?,?,?)")
    .run(g, u, cur + p);
}

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h} ч ${m} мин`;
}

// ================== READY ==================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(process.env.GUILD_ID);

  const leaderboard = guild.channels.cache.find(
    c => c.name === process.env.LEADERBOARD_CHANNEL_NAME
  );

  if (leaderboard) {
    await leaderboard.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏆 Лидерборд")
          .setDescription("Выберите действие ниже")
          .setColor(0xf1c40f),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("top_points").setLabel("🏆 Топ баллов").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("my_points").setLabel("💰 Мои баллы").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("top_voice").setLabel("🎙 Топ войса").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("my_voice").setLabel("🎧 Мой войс").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("open_shop").setLabel("🛒 Магазин").setStyle(ButtonStyle.Success)
        ),
      ],
    });
  }

  cron.schedule("0 0 1 * *", () => {
    db.prepare("DELETE FROM points").run();
    db.prepare("DELETE FROM voice").run();
  });
});

// ================== КНОПКИ ==================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  const g = i.guild.id;
  const u = i.user.id;

  if (i.customId === "my_points") {
    return i.reply({
      content: `💰 У тебя **${getPoints(g, u)} баллов**`,
      ephemeral: true,
    });
  }

  if (i.customId === "top_points") {
    const rows = db.prepare(
      "SELECT user_id, points FROM points WHERE guild_id=? ORDER BY points DESC LIMIT 10"
    ).all(g);

    return i.reply({
      content: rows.length
        ? rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — ${r.points}`).join("\n")
        : "Пока пусто",
      ephemeral: true,
    });
  }

  if (i.customId === "my_voice") {
    const v = db.prepare(
      "SELECT seconds FROM voice WHERE guild_id=? AND user_id=?"
    ).get(g, u);

    return i.reply({
      content: `🎧 Ты в войсе: **${formatTime(v?.seconds || 0)}**`,
      ephemeral: true,
    });
  }

  if (i.customId === "top_voice") {
    const rows = db.prepare(
      "SELECT user_id, seconds FROM voice WHERE guild_id=? ORDER BY seconds DESC LIMIT 10"
    ).all(g);

    return i.reply({
      content: rows.length
        ? rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — ${formatTime(r.seconds)}`).join("\n")
        : "Пока пусто",
      ephemeral: true,
    });
  }
});

// ================== ВОЙС ==================
client.on("voiceStateUpdate", (o, n) => {
  const g = n.guild.id;
  const u = n.id;

  if (!o.channelId && n.channelId && !n.selfMute && !n.selfDeaf) {
    db.prepare(
      "INSERT OR REPLACE INTO voice (guild_id,user_id,joined_at,seconds) VALUES (?,?,?,COALESCE((SELECT seconds FROM voice WHERE guild_id=? AND user_id=?),0))"
    ).run(g, u, now(), g, u);
  }

  if (o.channelId && !n.channelId) {
    const row = db.prepare(
      "SELECT * FROM voice WHERE guild_id=? AND user_id=?"
    ).get(g, u);
    if (!row?.joined_at) return;

    const spent = now() - row.joined_at;
    const total = row.seconds + spent;
    const hours = Math.floor(total / HOUR);

    if (hours > 0) addPoints(g, u, hours * VOICE_POINTS_PER_HOUR);

    db.prepare(
      "UPDATE voice SET seconds=?, joined_at=NULL WHERE guild_id=? AND user_id=?"
    ).run(total, g, u);
  }
});

client.login(process.env.DISCORD_TOKEN);
