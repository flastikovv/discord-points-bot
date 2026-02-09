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

const HOUR = 3600;
const VOICE_POINTS_PER_HOUR = 10;

// ================== SHOP ==================
const SHOP_ITEMS = [
  { id: "money_50k", label: "💵 50.000$", cost: 100 },
  { id: "money_100k", label: "💵 100.000$", cost: 180 },
  { id: "spank_10", label: "💊 Spank x10", cost: 120 },
  { id: "shotgun", label: "🔫 Assault Shotgun", cost: 300 },
];

// ================== DB ==================
db.exec(`
CREATE TABLE IF NOT EXISTS points (
  guild_id TEXT,
  user_id TEXT,
  points INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  user_id TEXT,
  channel_id TEXT,
  delta INTEGER,
  status TEXT
);

CREATE TABLE IF NOT EXISTS voice_sessions (
  guild_id TEXT,
  user_id TEXT,
  joined_at INTEGER,
  carry INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS voice_stats (
  guild_id TEXT,
  user_id TEXT,
  seconds INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
`);

const now = () => Math.floor(Date.now() / 1000);

// ================== CLIENT ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// ================== HELPERS ==================
function isMod(member) {
  return member.roles.cache.some(r =>
    process.env.MOD_ROLE_NAMES.split(",").includes(r.name)
  );
}

function addPoints(gid, uid, pts) {
  const row = db.prepare(
    "SELECT points FROM points WHERE guild_id=? AND user_id=?"
  ).get(gid, uid);

  if (!row) {
    db.prepare("INSERT INTO points VALUES (?,?,?)").run(gid, uid, pts);
  } else {
    db.prepare(
      "UPDATE points SET points=? WHERE guild_id=? AND user_id=?"
    ).run(row.points + pts, gid, uid);
  }
}

function removePoints(gid, uid, pts) {
  const cur = getPoints(gid, uid);
  if (cur < pts) return false;
  db.prepare(
    "UPDATE points SET points=? WHERE guild_id=? AND user_id=?"
  ).run(cur - pts, gid, uid);
  return true;
}

function getPoints(gid, uid) {
  return db.prepare(
    "SELECT points FROM points WHERE guild_id=? AND user_id=?"
  ).get(gid, uid)?.points || 0;
}

// ================== READY ==================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;

  const shop = guild.channels.cache.find(c => c.name === process.env.SHOP_CHANNEL_NAME);
  const log = guild.channels.cache.find(c => c.name === process.env.MOD_LOG_CHANNEL_NAME);

  // магазин
  if (shop) {
    const embed = new EmbedBuilder()
      .setTitle("🛒 Магазин наград")
      .setDescription(
        SHOP_ITEMS.map(i => `${i.label} — **${i.cost} баллов**`).join("\n")
      )
      .setColor(0xf1c40f);

    const row = new ActionRowBuilder().addComponents(
      SHOP_ITEMS.map(i =>
        new ButtonBuilder()
          .setCustomId(`buy_${i.id}`)
          .setLabel(i.label)
          .setStyle(ButtonStyle.Primary)
      )
    );

    await shop.send({ embeds: [embed], components: [row] });
  }

  cron.schedule("0 0 1 * *", () => {
    db.prepare("DELETE FROM points").run();
    db.prepare("DELETE FROM voice_stats").run();
    log?.send("🔄 Автосброс баллов за месяц");
  });
});

// ================== INTERACTIONS ==================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  const gid = i.guild.id;
  const uid = i.user.id;
  const log = i.guild.channels.cache.find(c => c.name === process.env.MOD_LOG_CHANNEL_NAME);

  // покупка
  if (i.customId.startsWith("buy_")) {
    const item = SHOP_ITEMS.find(x => `buy_${x.id}` === i.customId);
    if (!item) return;

    if (!removePoints(gid, uid, item.cost)) {
      return i.reply({ content: "❌ Недостаточно баллов", ephemeral: true });
    }

    log?.send(`🛒 <@${uid}> купил **${item.label}** за ${item.cost} баллов`);
    return i.reply({ content: `✅ Куплено: ${item.label}`, ephemeral: true });
  }
});

// ================== VOICE ==================
client.on("voiceStateUpdate", (o, n) => {
  const gid = n.guild.id;
  const uid = n.id;
  const log = n.guild.channels.cache.find(c => c.name === process.env.MOD_LOG_CHANNEL_NAME);

  if (!o.channelId && n.channelId && !n.selfMute && !n.selfDeaf) {
    db.prepare(
      "INSERT OR REPLACE INTO voice_sessions VALUES (?,?,?,?)"
    ).run(gid, uid, now(), 0);
  }

  if (o.channelId && !n.channelId) {
    const s = db.prepare(
      "SELECT * FROM voice_sessions WHERE guild_id=? AND user_id=?"
    ).get(gid, uid);
    if (!s) return;

    const total = s.carry + (now() - s.joined_at);
    const hours = Math.floor(total / HOUR);
    const carry = total % HOUR;

    if (hours > 0) {
      addPoints(gid, uid, hours * VOICE_POINTS_PER_HOUR);
      log?.send(`🎙 <@${uid}> получил ${hours * VOICE_POINTS_PER_HOUR} баллов за войс`);
    }

    db.prepare(
      "INSERT OR REPLACE INTO voice_sessions VALUES (?,?,?,?)"
    ).run(gid, uid, now(), carry);
  }
});

// ================== LOGIN ==================
client.login(process.env.DISCORD_TOKEN);
