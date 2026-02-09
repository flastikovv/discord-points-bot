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

// ================= НАСТРОЙКИ =================
const VOICE_POINTS_PER_HOUR = 10;
const HOUR = 3600;

const SHOP_ITEMS = [
  { id: "50k", label: "💵 50.000$", cost: 100 },
  { id: "100k", label: "💵 100.000$", cost: 180 },
  { id: "spank10", label: "💊 Spank x10", cost: 120 },
  { id: "shotgun", label: "🔫 Assault Shotgun", cost: 300 },
];

// ================= БАЗА =================
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
  thread_id TEXT,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  user_id TEXT,
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

// ================= КЛИЕНТ =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// ================= ХЕЛПЕРЫ =================
function isMod(member) {
  return member.roles.cache.some(r =>
    process.env.MOD_ROLE_NAMES.split(",").includes(r.name)
  );
}

function getPoints(g, u) {
  return db.prepare(
    "SELECT points FROM points WHERE guild_id=? AND user_id=?"
  ).get(g, u)?.points || 0;
}

function addPoints(g, u, p) {
  const cur = getPoints(g, u);
  db.prepare(
    "INSERT OR REPLACE INTO points VALUES (?,?,?)"
  ).run(g, u, cur + p);
}

function removePoints(g, u, p) {
  const cur = getPoints(g, u);
  if (cur < p) return false;
  db.prepare(
    "UPDATE points SET points=? WHERE guild_id=? AND user_id=?"
  ).run(cur - p, g, u);
  return true;
}

// ================= READY =================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;

  // Кнопка создать отчёт
  const reportCh = guild.channels.cache.find(c => c.name === process.env.REPORT_CHANNEL_NAME);
  if (reportCh) {
    await reportCh.send({
      content: "Создай личную ветку для отчётов",
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("create_report")
            .setLabel("Создать отчёт")
            .setStyle(ButtonStyle.Primary)
        ),
      ],
    });
  }

  // Магазин
  const shop = guild.channels.cache.find(c => c.name === process.env.SHOP_CHANNEL_NAME);
  if (shop) {
    const embed = new EmbedBuilder()
      .setTitle("🛒 Магазин")
      .setDescription(SHOP_ITEMS.map(i => `${i.label} — **${i.cost} баллов**`).join("\n"))
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
    guild.channels.cache
      .find(c => c.name === process.env.MOD_LOG_CHANNEL_NAME)
      ?.send("🔄 Автосброс баллов за месяц");
  });
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  const g = i.guild.id;
  const u = i.user.id;
  const log = i.guild.channels.cache.find(c => c.name === process.env.MOD_LOG_CHANNEL_NAME);

  // Создание личной ветки
  if (i.customId === "create_report") {
    const exists = db.prepare(
      "SELECT thread_id FROM reports WHERE guild_id=? AND user_id=?"
    ).get(g, u);

    if (exists) {
      return i.reply({ content: "❌ У тебя уже есть ветка", ephemeral: true });
    }

    const thread = await i.channel.threads.create({
      name: `отчёт-${i.user.username}`,
      autoArchiveDuration: 1440,
    });

    db.prepare(
      "INSERT INTO reports VALUES (?,?,?)"
    ).run(g, u, thread.id);

    return i.reply({ content: "✅ Ветка создана", ephemeral: true });
  }

  // Магазин
  if (i.customId.startsWith("buy_")) {
    const item = SHOP_ITEMS.find(x => `buy_${x.id}` === i.customId);
    if (!item) return;

    if (!removePoints(g, u, item.cost)) {
      return i.reply({ content: "❌ Недостаточно баллов", ephemeral: true });
    }

    log?.send(`🛒 <@${u}> купил **${item.label}** за ${item.cost}`);
    return i.reply({ content: `✅ Куплено: ${item.label}`, ephemeral: true });
  }

  // Модерация
  if (!isMod(i.member)) {
    return i.reply({ content: "❌ Нет прав", ephemeral: true });
  }

  const sub = db.prepare(
    "SELECT * FROM submissions WHERE status='pending' ORDER BY id DESC"
  ).get();
  if (!sub) return;

  if (i.customId === "approve") {
    addPoints(g, sub.user_id, sub.delta);
    db.prepare("UPDATE submissions SET status='approved' WHERE id=?").run(sub.id);
    log?.send(`✅ ${i.user.tag} одобрил +${sub.delta} <@${sub.user_id}>`);
    return i.reply("✅ Одобрено");
  }

  if (i.customId === "reject") {
    db.prepare("UPDATE submissions SET status='rejected' WHERE id=?").run(sub.id);
    log?.send(`❌ ${i.user.tag} отклонил +${sub.delta} <@${sub.user_id}>`);
    return i.reply("❌ Отклонено");
  }
});

// ================= СООБЩЕНИЯ В ВЕТКЕ =================
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  if (!msg.channel.isThread()) return;
  if (!msg.attachments.size) return;
  if (!msg.content.startsWith("+")) return;

  const pts = parseInt(msg.content.slice(1));
  if (isNaN(pts)) return;

  db.prepare(
    "INSERT INTO submissions (guild_id,user_id,delta,status) VALUES (?,?,?,?)"
  ).run(msg.guild.id, msg.author.id, pts, "pending");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("approve").setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("reject").setLabel("Reject").setStyle(ButtonStyle.Danger)
  );

  await msg.reply({
    content: `Заявка на **+${pts}** баллов`,
    components: [row],
  });
});

// ================= ВОЙС =================
client.on("voiceStateUpdate", (o, n) => {
  const g = n.guild.id;
  const u = n.id;

  if (!o.channelId && n.channelId && !n.selfMute && !n.selfDeaf) {
    db.prepare(
      "INSERT OR REPLACE INTO voice_sessions VALUES (?,?,?,?)"
    ).run(g, u, now(), 0);
  }

  if (o.channelId && !n.channelId) {
    const s = db.prepare(
      "SELECT * FROM voice_sessions WHERE guild_id=? AND user_id=?"
    ).get(g, u);
    if (!s) return;

    const total = s.carry + (now() - s.joined_at);
    const hours = Math.floor(total / HOUR);
    const carry = total % HOUR;

    if (hours > 0) addPoints(g, u, hours * VOICE_POINTS_PER_HOUR);

    db.prepare(
      "INSERT OR REPLACE INTO voice_sessions VALUES (?,?,?,?)"
    ).run(g, u, now(), carry);
  }
});

// ================= LOGIN =================
client.login(process.env.DISCORD_TOKEN);
