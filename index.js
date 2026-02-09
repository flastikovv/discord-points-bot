require("dotenv").config();
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
const cron = require("node-cron");
const Database = require("better-sqlite3");
const db = new Database("bot.db");

// ================== НАСТРОЙКИ ==================
const VOICE_POINTS_PER_HOUR = 10;
const HOUR = 3600;

const SHOP_ITEMS = [
  { id: "50k", label: "💵 50.000$", cost: 100 },
  { id: "100k", label: "💵 100.000$", cost: 180 },
  { id: "spank", label: "💊 Spank x10", cost: 120 },
  { id: "shotgun", label: "🔫 Assault Shotgun", cost: 300 },
];

// ================== БАЗА ==================
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

CREATE TABLE IF NOT EXISTS voice (
  guild_id TEXT,
  user_id TEXT,
  joined_at INTEGER,
  carry INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
`);

const now = () => Math.floor(Date.now() / 1000);

// ================== КЛИЕНТ ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// ================== ХЕЛПЕРЫ ==================
function getPoints(g, u) {
  return (
    db.prepare(
      "SELECT points FROM points WHERE guild_id=? AND user_id=?"
    ).get(g, u)?.points || 0
  );
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

function isMod(member) {
  return member.roles.cache.some(r =>
    process.env.MOD_ROLE_NAMES.split(",").includes(r.name)
  );
}

// ================== READY ==================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (!guild) return;

  // КНОПКА СОЗДАНИЯ ОТЧЁТА
  const reportChannel = guild.channels.cache.find(
    c => c.name === process.env.REPORT_CHANNEL_NAME
  );
  if (reportChannel) {
    await reportChannel.send({
      content: "Нажми кнопку, чтобы создать **личный канал отчёта**",
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

  // ЛИДЕРБОРД
  const leaderboard = guild.channels.cache.find(
    c => c.name === process.env.LEADERBOARD_CHANNEL_NAME
  );
  if (leaderboard) {
    await leaderboard.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏆 Лидерборд")
          .setDescription("Нажми кнопку для обновления")
          .setColor(0x2ecc71),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("refresh_top")
            .setLabel("🔄 Обновить")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("my_balance")
            .setLabel("📊 Мой баланс")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId("open_shop")
            .setLabel("🛒 Магазин")
            .setStyle(ButtonStyle.Primary)
        ),
      ],
    });
  }

  // МАГАЗИН
  const shop = guild.channels.cache.find(
    c => c.name === process.env.SHOP_CHANNEL_NAME
  );
  if (shop) {
    const embed = new EmbedBuilder()
      .setTitle("🛒 Магазин")
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

  // АВТОСБРОС
  cron.schedule("0 0 1 * *", () => {
    db.prepare("DELETE FROM points").run();
    guild.channels.cache
      .find(c => c.name === process.env.MOD_LOG_CHANNEL_NAME)
      ?.send("🔄 Автосброс баллов за месяц");
  });
});

// ================== INTERACTIONS ==================
client.on("interactionCreate", async i => {
  if (!i.isButton()) return;
  const g = i.guild.id;
  const u = i.user.id;

  // СОЗДАТЬ ОТЧЁТ
  if (i.customId === "create_report") {
    const exists = db.prepare(
      "SELECT channel_id FROM reports WHERE guild_id=? AND user_id=?"
    ).get(g, u);

    if (exists) {
      return i.reply({ content: "❌ У тебя уже есть отчёт", ephemeral: true });
    }

    const modRoles = i.guild.roles.cache.filter(r =>
      process.env.MOD_ROLE_NAMES.split(",").includes(r.name)
    );

    const overwrites = [
      {
        id: i.guild.roles.everyone,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: u,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
      {
        id: i.guild.members.me.id,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
      },
    ];

    modRoles.forEach(r =>
      overwrites.push({
        id: r.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      })
    );

    const channel = await i.guild.channels.create({
      name: `отчёт-${i.user.username}`,
      type: ChannelType.GuildText,
      permissionOverwrites: overwrites,
    });

    await channel.send(
      "📸 **Инструкция**\n\nОтправляй **скриншот** и в тексте пиши:\n`+количество`\n\nПример:\n`+25`"
    );

    db.prepare(
      "INSERT INTO reports VALUES (?,?,?)"
    ).run(g, u, channel.id);

    return i.reply({ content: "✅ Канал отчёта создан", ephemeral: true });
  }

  // БАЛАНС
  if (i.customId === "my_balance") {
    return i.reply({
      content: `💰 У тебя **${getPoints(g, u)} баллов**`,
      ephemeral: true,
    });
  }

  // ОБНОВИТЬ ТОП
  if (i.customId === "refresh_top") {
    const rows = db.prepare(
      "SELECT user_id, points FROM points WHERE guild_id=? ORDER BY points DESC LIMIT 10"
    ).all(g);

    const text = rows.length
      ? rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — ${r.points}`).join("\n")
      : "Пока пусто";

    return i.update({
      embeds: [
        new EmbedBuilder()
          .setTitle("🏆 Лидерборд")
          .setDescription(text)
          .setColor(0x2ecc71),
      ],
    });
  }

  // МАГАЗИН
  if (i.customId.startsWith("buy_")) {
    const item = SHOP_ITEMS.find(x => `buy_${x.id}` === i.customId);
    if (!item) return;

    if (!removePoints(g, u, item.cost)) {
      return i.reply({ content: "❌ Недостаточно баллов", ephemeral: true });
    }

    i.guild.channels.cache
      .find(c => c.name === process.env.MOD_LOG_CHANNEL_NAME)
      ?.send(`🛒 <@${u}> купил **${item.label}**`);

    return i.reply({ content: `✅ Куплено: ${item.label}`, ephemeral: true });
  }
});

// ================== ОТЧЁТЫ ==================
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;

  const report = db.prepare(
    "SELECT * FROM reports WHERE channel_id=?"
  ).get(msg.channel.id);
  if (!report) return;

  if (!msg.attachments.size) return;
  if (!msg.content.startsWith("+")) return;

  const pts = parseInt(msg.content.slice(1));
  if (isNaN(pts)) return;

  db.prepare(
    "INSERT INTO submissions (guild_id,user_id,channel_id,points,status) VALUES (?,?,?,?,?)"
  ).run(msg.guild.id, msg.author.id, msg.channel.id, pts, "pending");

  await msg.reply({
    content: `Заявка на **+${pts}** баллов\nМодератор, примите решение`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("approve").setLabel("Approve").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("reject").setLabel("Reject").setStyle(ButtonStyle.Danger)
      ),
    ],
  });
});

// ================== ВОЙС ==================
client.on("voiceStateUpdate", (o, n) => {
  const g = n.guild.id;
  const u = n.id;

  if (!o.channelId && n.channelId && !n.selfMute && !n.selfDeaf) {
    db.prepare(
      "INSERT OR REPLACE INTO voice VALUES (?,?,?,?)"
    ).run(g, u, now(), 0);
  }

  if (o.channelId && !n.channelId) {
    const s = db.prepare(
      "SELECT * FROM voice WHERE guild_id=? AND user_id=?"
    ).get(g, u);
    if (!s) return;

    const total = s.carry + (now() - s.joined_at);
    const hours = Math.floor(total / HOUR);
    const carry = total % HOUR;

    if (hours > 0) addPoints(g, u, hours * VOICE_POINTS_PER_HOUR);

    db.prepare(
      "INSERT OR REPLACE INTO voice VALUES (?,?,?,?)"
    ).run(g, u, now(), carry);
  }
});

client.login(process.env.DISCORD_TOKEN);
