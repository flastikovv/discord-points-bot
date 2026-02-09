require("dotenv").config();
const {
  Client, GatewayIntentBits, PermissionsBitField, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder
} = require("discord.js");
const cron = require("node-cron");
const Database = require("better-sqlite3");
const db = new Database("bot.db");

// ================= НАСТРОЙКИ =================
const VOICE_POINTS_PER_HOUR = 10;
const HOUR = 3600;

const SHOP_ITEMS = [
  { id: "50k", label: "💵 50.000$", cost: 100 },
  { id: "100k", label: "💵 100.000$", cost: 180 },
  { id: "spank", label: "💊 Spank x10", cost: 120 },
  { id: "shotgun", label: "🔫 Assault Shotgun", cost: 300 },
];

// ================= БАЗА =================
db.exec(`
CREATE TABLE IF NOT EXISTS points (
  guild_id TEXT, user_id TEXT, points INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id,user_id)
);
CREATE TABLE IF NOT EXISTS reports (
  guild_id TEXT, user_id TEXT, channel_id TEXT,
  PRIMARY KEY (guild_id,user_id)
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT, user_id TEXT, channel_id TEXT,
  points INTEGER, status TEXT
);
CREATE TABLE IF NOT EXISTS voice (
  guild_id TEXT, user_id TEXT,
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
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ================= ХЕЛПЕРЫ =================
const getPoints = (g,u)=>db.prepare(
  "SELECT points FROM points WHERE guild_id=? AND user_id=?"
).get(g,u)?.points||0;

const addPoints=(g,u,p)=>{
  db.prepare("INSERT OR REPLACE INTO points VALUES (?,?,?)")
    .run(g,u,getPoints(g,u)+p);
};

const removePoints=(g,u,p)=>{
  if(getPoints(g,u)<p) return false;
  db.prepare("UPDATE points SET points=? WHERE guild_id=? AND user_id=?")
    .run(getPoints(g,u)-p,g,u);
  return true;
};

const isMod=m=>m.roles.cache.some(r=>
  process.env.MOD_ROLE_NAMES.split(",").includes(r.name)
);

const formatTime=s=>`${Math.floor(s/3600)} ч ${Math.floor(s%3600/60)} мин`;

// ================= READY =================
client.once("ready", async ()=>{
  console.log(`Logged in as ${client.user.tag}`);
  const g=client.guilds.cache.get(process.env.GUILD_ID);
  if(!g) return;

  // КНОПКА ОТЧЁТА
  const rc=g.channels.cache.find(c=>c.name===process.env.REPORT_CHANNEL_NAME);
  rc?.send({
    content:"Нажми, чтобы создать **личный канал отчёта**",
    components:[new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("create_report")
        .setLabel("Создать отчёт").setStyle(ButtonStyle.Primary)
    )]
  });

  // ЛИДЕРБОРД
  const lb=g.channels.cache.find(c=>c.name===process.env.LEADERBOARD_CHANNEL_NAME);
  lb?.send({
    embeds:[new EmbedBuilder().setTitle("🏆 Лидерборд").setColor(0x2ecc71)],
    components:[new ActionRowBuilder().addComponents(
      ["top_points","my_points","top_voice","my_voice","open_shop"].map(id=>
        new ButtonBuilder().setCustomId(id).setLabel({
          top_points:"🏆 Топ баллов",
          my_points:"💰 Мои баллы",
          top_voice:"🎙 Топ войса",
          my_voice:"🎧 Мой войс",
          open_shop:"🛒 Магазин"
        }[id]).setStyle(ButtonStyle.Secondary)
      )
    )]
  });

  // МАГАЗИН
  const shop=g.channels.cache.find(c=>c.name===process.env.SHOP_CHANNEL_NAME);
  shop?.send({
    embeds:[new EmbedBuilder()
      .setTitle("🛒 Магазин")
      .setDescription(SHOP_ITEMS.map(i=>`${i.label} — ${i.cost}`).join("\n"))
    ],
    components:[new ActionRowBuilder().addComponents(
      SHOP_ITEMS.map(i=>new ButtonBuilder()
        .setCustomId(`buy_${i.id}`)
        .setLabel(i.label)
        .setStyle(ButtonStyle.Primary))
    )]
  });

  cron.schedule("0 0 1 * *",()=>{
    db.prepare("DELETE FROM points").run();
    db.prepare("DELETE FROM voice").run();
  });
});

// ================= INTERACTIONS =================
client.on("interactionCreate", async i=>{
  if(!i.isButton()) return;
  const g=i.guild.id,u=i.user.id;

  if(i.customId==="create_report"){
    const exists=db.prepare(
      "SELECT 1 FROM reports WHERE guild_id=? AND user_id=?"
    ).get(g,u);
    if(exists) return i.reply({content:"❌ Уже есть отчёт",ephemeral:true});

    const overwrites=[
      {id:i.guild.roles.everyone,deny:[PermissionsBitField.Flags.ViewChannel]},
      {id:u,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages]},
      {id:i.guild.members.me.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages]}
    ];
    i.guild.roles.cache
      .filter(r=>process.env.MOD_ROLE_NAMES.split(",").includes(r.name))
      .forEach(r=>overwrites.push({id:r.id,allow:overwrites[1].allow}));

    const ch=await i.guild.channels.create({
      name:`отчёт-${i.user.username}`,
      type:ChannelType.GuildText,
      permissionOverwrites:overwrites
    });

    ch.send("📸 Отправляй **скрин** и `+число` (пример `+25`)");
    db.prepare("INSERT INTO reports VALUES (?,?,?)").run(g,u,ch.id);
    return i.reply({content:"✅ Канал создан",ephemeral:true});
  }

  if(i.customId.startsWith("buy_")){
    const item=SHOP_ITEMS.find(x=>`buy_${x.id}`===i.customId);
    if(!item||!removePoints(g,u,item.cost))
      return i.reply({content:"❌ Недостаточно баллов",ephemeral:true});
    i.reply({content:`✅ Куплено: ${item.label}`,ephemeral:true});
  }

  if(i.customId==="my_points")
    return i.reply({content:`💰 ${getPoints(g,u)}`,ephemeral:true});

  if(i.customId==="top_points"){
    const rows=db.prepare(
      "SELECT user_id,points FROM points WHERE guild_id=? ORDER BY points DESC LIMIT 10"
    ).all(g);
    return i.reply({content:rows.map((r,i)=>`${i+1}. <@${r.user_id}> — ${r.points}`).join("\n")||"Пусто",ephemeral:true});
  }

  if(i.customId==="my_voice"){
    const v=db.prepare("SELECT seconds FROM voice WHERE guild_id=? AND user_id=?")
      .get(g,u)?.seconds||0;
    return i.reply({content:`🎧 ${formatTime(v)}`,ephemeral:true});
  }

  if(i.customId==="top_voice"){
    const rows=db.prepare(
      "SELECT user_id,seconds FROM voice WHERE guild_id=? ORDER BY seconds DESC LIMIT 10"
    ).all(g);
    return i.reply({content:rows.map((r,i)=>`${i+1}. <@${r.user_id}> — ${formatTime(r.seconds)}`).join("\n")||"Пусто",ephemeral:true});
  }
});

// ================= ВОЙС =================
client.on("voiceStateUpdate",(o,n)=>{
  const g=n.guild.id,u=n.id;
  if(!o.channelId&&n.channelId){
    db.prepare("INSERT OR IGNORE INTO voice VALUES (?,?,0,?)").run(g,u,now());
  }
  if(o.channelId&&!n.channelId){
    const r=db.prepare("SELECT * FROM voice WHERE guild_id=? AND user_id=?").get(g,u);
    if(!r?.joined_at) return;
    const spent=now()-r.joined_at;
    const total=r.seconds+spent;
    addPoints(g,u,Math.floor(total/HOUR)*VOICE_POINTS_PER_HOUR);
    db.prepare("UPDATE voice SET seconds=?,joined_at=NULL WHERE guild_id=? AND user_id=?")
      .run(total,g,u);
  }
});

client.login(process.env.DISCORD_TOKEN);
