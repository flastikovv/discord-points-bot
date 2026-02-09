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
} = require("discord.js");
const Database = require("better-sqlite3");
const db = new Database("bot.db");

const HOUR = 3600;
const VOICE_POINTS_PER_HOUR = 10;

// ================= DB =================
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
  message_id TEXT,
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

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// ================= HELPERS =================
function isMod(member) {
  return member.roles.cache.some(r =>
    process.env.MOD_ROLE_NAMES.split(",").includes(r.name)
  );
}

function addPoints(gid, uid, pts) {
  const cur = getPoints(gid, uid);
  db.prepare(
    "INSERT OR REPLACE INTO points VALUES (?,?,?)"
  ).run(gid, uid, cur + pts);
}

function getPoints(gid, uid) {
  return db.prepare(
    "SELECT points FROM points WHERE guild_id=? AND user_id=?"
  ).get(gid, uid)?.points || 0;
}

// ================= READY =================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;

  const table = guild.channels.cache.find(c => c.name === process.env.LEADERBOARD_CHANNEL_NAME);
  if (table) updateLeaderboard(table);

  cron.schedule("0 0 1 * *", () => {
    db.prepare("DELETE FROM points").run();
    db.prepare("DELETE FROM voice_stats").run();
    guild.channels.cache
      .find(c => c.name === process.env.MOD_LOG_CHANNEL_NAME)
      ?.send("🔄 Автосброс баллов за месяц");
  });
});

// ================= REPORTS =================
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  if (msg.channel.name !== process.env.REPORT_CHANNEL_NAME) return;
  if (!msg.attachments.size) return;
  if (!msg.content.startsWith("+")) return;

  const pts = parseInt(msg.content.slice(1));
  if (isNaN(pts)) return;

  const thread = await msg.startThread({
    name: `Отчёт +${pts} | ${msg.author.username}`,
    autoArchiveDuration: 1440,
  });

  db.prepare(
    "INSERT INTO submissions (guild_id,user_id,message_id,delta,status) VALUES (?,?,?,?,?)"
  ).run(msg.guild.id, msg.author.id, msg.id, pts, "pending");

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("approve").setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("reject").setLabel("Reject").setStyle(ButtonStyle.Danger)
  );

  await thread.send({
    content: `Заявка на **+${pts}** баллов\nОжидает решения модератора`,
    components: [buttons],
  });
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  if (!isMod(i.member)) {
    return i.reply({ content: "❌ Нет прав", ephemeral: true });
  }

  const thread = i.channel;
  const sub = db.prepare(
    "SELECT * FROM submissions WHERE status='pending' ORDER BY id DESC"
  ).get();
  if (!sub) return;

  const log = i.guild.channels.cache.find(c => c.name === process.env.MOD_LOG_CHANNEL_NAME);

  if (i.customId === "approve") {
    addPoints(i.guild.id, sub.user_id, sub.delta);
    db.prepare("UPDATE submissions SET status='approved' WHERE id=?").run(sub.id);
    log?.send(`✅ ${i.user.tag} одобрил +${sub.delta} для <@${sub.user_id}>`);
    await i.reply("✅ Одобрено");
    await thread.setArchived(true);
  }

  if (i.customId === "reject") {
    db.prepare("UPDATE submissions SET status='rejected' WHERE id=?").run(sub.id);
    log?.send(`❌ ${i.user.tag} отклонил +${sub.delta} для <@${sub.user_id}>`);
    await i.reply("❌ Отклонено");
    await thread.setArchived(true);
  }

  const table = i.guild.channels.cache.find(c => c.name === process.env.LEADERBOARD_CHANNEL_NAME);
  if (table) updateLeaderboard(table);
});

// ================= LEADERBOARD =================
async function updateLeaderboard(channel) {
  const rows = db.prepare(
    "SELECT user_id, points FROM points ORDER BY points DESC LIMIT 10"
  ).all();

  const embed = new EmbedBuilder()
    .setTitle("🏆 Таблица баллов")
    .setColor(0x2ecc71)
    .setDescription(
      rows.map((r, i) =>
        `${i + 1}. <@${r.user_id}> — **${r.points}**`
      ).join("\n") || "Пусто"
    );

  const msgs = await channel.messages.fetch({ limit: 1 });
  if (msgs.first()) {
    await msgs.first().edit({ embeds: [embed] });
  } else {
    await channel.send({ embeds: [embed] });
  }
}

// ================= VOICE =================
client.on("voiceStateUpdate", (o, n) => {
  const gid = n.guild.id;
  const uid = n.id;

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

    if (hours > 0) addPoints(gid, uid, hours * VOICE_POINTS_PER_HOUR);

    db.prepare(
      "INSERT OR REPLACE INTO voice_sessions VALUES (?,?,?,?)"
    ).run(gid, uid, now(), carry);
  }
});

// ================= LOGIN =================
client.login(process.env.DISCORD_TOKEN);
