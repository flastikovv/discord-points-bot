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
`);

const now = () => Math.floor(Date.now() / 1000);

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
  if (!names.length) {
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
  }
  return member.roles.cache.some((r) => names.includes(r.name));
}

function addPoints(guildId, userId, delta) {
  const row = db
    .prepare("SELECT points FROM points WHERE guild_id=? AND user_id=?")
    .get(guildId, userId);

  if (!row) {
    db.prepare(
      "INSERT INTO points (guild_id,user_id,points,updated_at) VALUES (?,?,?,?)"
    ).run(guildId, userId, delta, now());
  } else {
    db.prepare(
      "UPDATE points SET points=?, updated_at=? WHERE guild_id=? AND user_id=?"
    ).run(row.points + delta, now(), guildId, userId);
  }
}

function topPoints(guildId, limit = 20) {
  return db
    .prepare(
      "SELECT user_id, points FROM points WHERE guild_id=? ORDER BY points DESC LIMIT ?"
    )
    .all(guildId, limit);
}

// ================== CLIENT ==================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

// ================== READY ==================
client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const guild = client.guilds.cache.first();
  if (!guild) return;

  // отправляем кнопку в канал отчётов
  const reportChannel = guild.channels.cache.find(
    (c) => c.name === process.env.REPORT_CHANNEL_NAME
  );

  if (reportChannel) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("create_report")
        .setLabel("Создать отчёт")
        .setStyle(ButtonStyle.Primary)
    );

    await reportChannel.send({
      content:
        "Нажми **«Создать отчёт»**, чтобы открыть приватный канал.\n" +
        "Внутри прикрепи скрин и напиши `+число` (от 1 до 1000).",
      components: [row],
    });
  }

  // обновляем таблицу
  await updateLeaderboard(guild);
});

// ================== BUTTONS ==================
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.guild) return;

  // ---------- CREATE REPORT ----------
  if (interaction.customId === "create_report") {
    const guild = interaction.guild;
    const member = interaction.member;

    const modRoles = guild.roles.cache.filter((r) =>
      modRoleNames().includes(r.name)
    );

    const overwrites = [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
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
    });

    await channel.send(
      `Привет, <@${member.id}> 👋\n` +
        `Прикрепи **скрин** и напиши **+число** (от 1 до 1000).\n` +
        `После этого модератор подтвердит начисление.`
    );

    return interaction.reply({
      content: `✅ Канал создан: ${channel}`,
      ephemeral: true,
    });
  }

  // ---------- APPROVE / REJECT ----------
  if (
    interaction.customId.startsWith("approve:") ||
    interaction.customId.startsWith("reject:")
  ) {
    if (!isModerator(interaction.member)) {
      return interaction.reply({
        content: "❌ Только модератор может подтверждать.",
        ephemeral: true,
      });
    }

    const [action, id] = interaction.customId.split(":");
    const sub = db
      .prepare("SELECT * FROM submissions WHERE id=?")
      .get(id);

    if (!sub || sub.status !== "pending") {
      return interaction.reply({
        content: "Заявка не найдена или уже обработана.",
        ephemeral: true,
      });
    }

    if (action === "approve") {
      db.prepare("UPDATE submissions SET status='approved' WHERE id=?").run(id);
      addPoints(sub.guild_id, sub.user_id, sub.delta_points);
      await interaction.reply(
        `✅ <@${sub.user_id}> получил **+${sub.delta_points}** баллов`
      );
      await updateLeaderboard(interaction.guild);
    } else {
      db.prepare("UPDATE submissions SET status='rejected' WHERE id=?").run(id);
      await interaction.reply("❌ Заявка отклонена");
    }
  }
});

// ================== MESSAGES ==================
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
    .run(
      message.guild.id,
      message.author.id,
      message.channel.id,
      message.id,
      points,
      now()
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve:${info.lastInsertRowid}`)
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`reject:${info.lastInsertRowid}`)
      .setLabel("Reject")
      .setStyle(ButtonStyle.Danger)
  );

  await message.reply({
    content: `📝 Заявка создана: **+${points}** баллов`,
    components: [row],
  });
});

// ================== LEADERBOARD ==================
async function updateLeaderboard(guild) {
  const channel = guild.channels.cache.find(
    (c) => c.name === process.env.LEADERBOARD_CHANNEL_NAME
  );
  if (!channel) return;

  const top = topPoints(guild.id, 20);
  const text = top.length
    ? top
        .map(
          (u, i) => `**${i + 1}.** <@${u.user_id}> — **${u.points}** баллов`
        )
        .join("\n")
    : "Пока нет данных.";

  const embed = new EmbedBuilder()
    .setTitle("🏆 Таблица баллов")
    .setDescription(text);

  const msgs = await channel.messages.fetch({ limit: 10 });
  const old = msgs.find(
    (m) => m.author.id === client.user.id && m.embeds.length
  );

  if (old) await old.edit({ embeds: [embed] });
  else await channel.send({ embeds: [embed] });
}

// ================== LOGIN ==================
client.login(process.env.DISCORD_TOKEN);
