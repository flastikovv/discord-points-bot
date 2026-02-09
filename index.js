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

// ================= DATABASE =================
db.exec(`
CREATE TABLE IF NOT EXISTS points (
  guild_id TEXT,
  user_id TEXT,
  points INTEGER,
  updated_at INTEGER,
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
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS voice_stats (
  guild_id TEXT,
  user_id TEXT,
  seconds INTEGER,
  PRIMARY KEY (guild_id, user_id)
);
`);

const now = () => Math.floor(Date.now() / 1000);
const monthKey = () => new Date().toISOString().slice(0, 7);

// ================= CLIENT =================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// ================= HELPERS =================
function addPoints(guildId, userId, pts) {
  const row = db.prepare(
    "SELECT points FROM points WHERE guild_id=? AND user_id=?"
  ).get(guildId, userId);

  if (!row) {
    db.prepare(
      "INSERT INTO points VALUES (?,?,?,?)"
    ).run(guildId, userId, pts, now());
  } else {
    db.prepare(
      "UPDATE points SET points=?, updated_at=? WHERE guild_id=? AND user_id=?"
    ).run(row.points + pts, now(), guildId, userId);
  }
}

function getPoints(guildId, userId) {
  return (
    db.prepare(
      "SELECT points FROM points WHERE guild_id=? AND user_id=?"
    ).get(guildId, userId)?.points || 0
  );
}

// ================= SLASH COMMANDS =================
async function registerCommands() {
  const commands = [
    new SlashCommandBuilder().setName("my_points").setDescription("Мои баллы"),
    new SlashCommandBuilder().setName("leaderboard").setDescription("Топ баллов"),
    new SlashCommandBuilder().setName("my_voice").setDescription("Мой войс"),
    new SlashCommandBuilder().setName("voice_top").setDescription("Топ войса"),
  ].map(c => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

  if (process.env.GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      { body: commands }
    );
  } else {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
  }
}

// ================= READY =================
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();

  const guild = client.guilds.cache.first();
  if (!guild) return;

  const reportChannel = guild.channels.cache.find(
    c => c.name === process.env.REPORT_CHANNEL_NAME
  );

  if (reportChannel) {
    await reportChannel.send({
      content: "Нажми кнопку для создания отчёта",
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

  // автосброс 1 числа
  cron.schedule("0 0 1 * *", () => {
    db.prepare("DELETE FROM points").run();
    db.prepare("DELETE FROM voice_stats").run();
    console.log("MONTH RESET:", monthKey());
  });
});

// ================= BUTTON =================
client.on("interactionCreate", async interaction => {
  if (interaction.isButton() && interaction.customId === "create_report") {
    const channel = await interaction.guild.channels.create({
      name: `отчёт-${interaction.user.username}`,
      type: ChannelType.GuildText,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [PermissionsBitField.Flags.ViewChannel],
        },
      ],
    });

    await channel.send("Прикрепи скрин и напиши `+число`");
    await interaction.reply({ content: "Канал создан", ephemeral: true });
  }

  if (interaction.isChatInputCommand()) {
    const gid = interaction.guild.id;
    const uid = interaction.user.id;

    if (interaction.commandName === "my_points") {
      return interaction.reply({
        content: `Баллы: ${getPoints(gid, uid)}`,
        ephemeral: true,
      });
    }

    if (interaction.commandName === "leaderboard") {
      const rows = db.prepare(
        "SELECT user_id, points FROM points ORDER BY points DESC LIMIT 10"
      ).all();
      const text = rows.map(
        (r, i) => `${i + 1}. <@${r.user_id}> — ${r.points}`
      ).join("\n");
      return interaction.reply(text || "Пусто");
    }

    if (interaction.commandName === "my_voice") {
      const sec = db.prepare(
        "SELECT seconds FROM voice_stats WHERE guild_id=? AND user_id=?"
      ).get(gid, uid)?.seconds || 0;
      return interaction.reply(`Войс: ${Math.floor(sec / 60)} мин`);
    }

    if (interaction.commandName === "voice_top") {
      const rows = db.prepare(
        "SELECT user_id, seconds FROM voice_stats ORDER BY seconds DESC LIMIT 10"
      ).all();
      const text = rows.map(
        (r, i) => `${i + 1}. <@${r.user_id}> — ${Math.floor(r.seconds / 60)} мин`
      ).join("\n");
      return interaction.reply(text || "Пусто");
    }
  }
});

// ================= REPORTS =================
client.on("messageCreate", msg => {
  if (!msg.content.startsWith("+")) return;
  if (!msg.attachments.size) return;

  const pts = parseInt(msg.content.slice(1));
  if (isNaN(pts)) return;

  addPoints(msg.guild.id, msg.author.id, pts);
  msg.reply(`Начислено +${pts}`);
});

// ================= VOICE =================
client.on("voiceStateUpdate", (oldS, newS) => {
  const gid = newS.guild.id;
  const uid = newS.id;

  if (!oldS.channelId && newS.channelId && !newS.selfMute && !newS.selfDeaf) {
    db.prepare("INSERT OR REPLACE INTO voice_sessions VALUES (?,?,?)")
      .run(gid, uid, now());
  }

  if (oldS.channelId && !newS.channelId) {
    const sess = db.prepare(
      "SELECT joined_at FROM voice_sessions WHERE guild_id=? AND user_id=?"
    ).get(gid, uid);

    if (sess) {
      const sec = now() - sess.joined_at;
      db.prepare("DELETE FROM voice_sessions WHERE guild_id=? AND user_id=?")
        .run(gid, uid);

      const row = db.prepare(
        "SELECT seconds FROM voice_stats WHERE guild_id=? AND user_id=?"
      ).get(gid, uid);

      if (!row) {
        db.prepare("INSERT INTO voice_stats VALUES (?,?,?)")
          .run(gid, uid, sec);
      } else {
        db.prepare(
          "UPDATE voice_stats SET seconds=? WHERE guild_id=? AND user_id=?"
        ).run(row.seconds + sec, gid, uid);
      }
    }
  }
});

// ================= LOGIN =================
client.login(process.env.DISCORD_TOKEN);
