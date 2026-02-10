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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const db = new Database("bot.db");
const VOICE_POINTS_PER_HOUR = 10;

const SHOP_ITEMS = [
  { id: "cash_50k", label: "💰 50.000$", cost: 60 },
  { id: "cash_100k", label: "💰 100.000$", cost: 120 },
  { id: "cash_300k", label: "💰 300.000$", cost: 360 },
  { id: "cash_500k", label: "💰 500.000$", cost: 600 },
  { id: "spank_10", label: "💊 Spank x10", cost: 35 },
  { id: "shotgun", label: "🔫 Assault Shotgun", cost: 90 },
  { id: "item_500k", label: "🎁 Предмет до 500.000$", cost: 420 },
  { id: "car_1m", label: "🚗 Машина до 1.000.000$", cost: 1300 },
  { id: "irl_nitro", label: "💎 Discord Nitro (1 мес.)", cost: 800 },
  { id: "irl_500", label: "🌐 Подписка до 500₽", cost: 900 },
  { id: "irl_1000", label: "🌐 Подписка до 1.000₽", cost: 1400 },
];

db.exec(`
CREATE TABLE IF NOT EXISTS points (guild_id TEXT,user_id TEXT,points INTEGER,PRIMARY KEY (guild_id,user_id));
CREATE TABLE IF NOT EXISTS reports (guild_id TEXT,user_id TEXT,channel_id TEXT,PRIMARY KEY (guild_id,user_id));
CREATE TABLE IF NOT EXISTS voice (guild_id TEXT,user_id TEXT,seconds INTEGER,joined_at INTEGER,hours_awarded INTEGER,PRIMARY KEY (guild_id,user_id));
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT);
`);

const getPoints = (g,u)=>db.prepare("SELECT points FROM points WHERE guild_id=? AND user_id=?").get(g,u)?.points||0;
const addPoints = (g,u,p)=>db.prepare("INSERT OR REPLACE INTO points VALUES (?,?,?)").run(g,u,getPoints(g,u)+p);
const removePoints = (g,u,p)=>{const c=getPoints(g,u);if(c<p)return false;db.prepare("UPDATE points SET points=? WHERE guild_id=? AND user_id=?").run(c-p,g,u);return true};
const isMod = m => m.roles.cache.some(r => ["dep","high","Leader"].includes(r.name));
const getCh = (g,n)=>g.channels.cache.find(c=>c.name===n);
const now = ()=>Math.floor(Date.now()/1000);

const getTopPoints = g =>
  db.prepare("SELECT user_id, points FROM points WHERE guild_id=? ORDER BY points DESC LIMIT 10").all(g);

async function updateLeaderboard(guild){
  const ch = getCh(guild, process.env.LEADERBOARD_CHANNEL_NAME);
  if(!ch) return;

  const top = getTopPoints(guild.id);
  const desc = top.length
    ? top.map((u,i)=>`**${i+1}.** <@${u.user_id}> — ${u.points}`).join("\n")
    : "Пока нет данных.";

  const embed = new EmbedBuilder()
    .setTitle("🏆 Лидерборд")
    .setDescription(desc)
    .setColor(0x2ecc71);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("lb_top").setLabel("🏆 Топ баллов").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("lb_my").setLabel("💰 Мои баллы").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("lb_voice_my").setLabel("🎧 Мой войс").setStyle(ButtonStyle.Secondary)
  );

  const saved = db.prepare("SELECT value FROM meta WHERE key='leaderboard_msg'").get();
  if(saved){
    const msg = await ch.messages.fetch(saved.value).catch(()=>null);
    if(msg) return msg.edit({embeds:[embed],components:[row]});
  }

  const msg = await ch.send({embeds:[embed],components:[row]});
  db.prepare("INSERT OR REPLACE INTO meta VALUES ('leaderboard_msg',?)").run(msg.id);
}

async function sendShop(guild){
  const ch = getCh(guild, process.env.SHOP_CHANNEL_NAME);
  if(!ch) return;

  const embed = new EmbedBuilder()
    .setTitle("🛒 Магазин")
    .setDescription(
      "Выбери награду и потрать баллы\n\n" +
      SHOP_ITEMS.map(i=>`${i.label} — **${i.cost} баллов**`).join("\n")
    )
    .setColor(0xf1c40f);

  const rows = [];
  SHOP_ITEMS.forEach((i,idx)=>{
    if(idx % 5 === 0) rows.push(new ActionRowBuilder());
    rows[rows.length-1].addComponents(
      new ButtonBuilder()
        .setCustomId(`buy_${i.id}`)
        .setLabel(i.label)
        .setStyle(ButtonStyle.Primary)
    );
  });

  await ch.send({embeds:[embed],components:rows});
}

client.once("ready", async ()=>{
  const g = client.guilds.cache.get(process.env.GUILD_ID);
  if(!g) return;

  const reportCh = getCh(g, process.env.REPORT_CHANNEL_NAME);
  if(reportCh){
    await reportCh.send({
      content:"Нажми кнопку для создания личного канала отчёта.",
      components:[new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("create_report")
          .setLabel("Создать отчёт")
          .setStyle(ButtonStyle.Primary)
      )]
    });
  }

  await sendShop(g);
  await updateLeaderboard(g);

  cron.schedule("0 0 1 * *",()=>{
    db.prepare("DELETE FROM points").run();
    db.prepare("DELETE FROM voice").run();
    updateLeaderboard(g);
  });
});

client.on("interactionCreate", async i=>{
  if(!i.isButton()) return;
  const g=i.guild, uid=i.user.id;
  const logCh=getCh(g,process.env.MOD_LOG_CHANNEL_NAME);

  if(i.customId==="create_report"){
    if(db.prepare("SELECT 1 FROM reports WHERE guild_id=? AND user_id=?").get(g.id,uid))
      return i.reply({content:"Канал уже существует.",ephemeral:true});

    const ch=await g.channels.create({
      name:`отчёт-${i.user.username}`.toLowerCase(),
      type:ChannelType.GuildText,
      permissionOverwrites:[
        {id:g.id,deny:[PermissionsBitField.Flags.ViewChannel]},
        {id:uid,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages]},
        ...g.roles.cache.filter(r=>["dep","high","Leader"].includes(r.name))
          .map(r=>({id:r.id,allow:[PermissionsBitField.Flags.ViewChannel,PermissionsBitField.Flags.SendMessages]}))
      ]
    });

    db.prepare("INSERT INTO reports VALUES (?,?,?)").run(g.id,uid,ch.id);
    await ch.send("Отправляй **скриншот** с мероприятия и `+число` (пример +25).");
    return i.reply({content:`Канал создан: ${ch}`,ephemeral:true});
  }

  if(i.customId.startsWith("buy_")){
    const item = SHOP_ITEMS.find(x => x.id === i.customId.replace("buy_",""));
    if(!item || !removePoints(g.id, uid, item.cost))
      return i.reply({ content: "Недостаточно баллов.", ephemeral: true });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("shop_given")
        .setLabel("Выдал")
        .setStyle(ButtonStyle.Success)
    );

    const msg = await i.channel.send({
      content: `🛒 Покупка: ${i.user} купил **${item.label}** за ${item.cost} баллов`,
      components: [row]
    });

    if(logCh){
      await logCh.send(`🛒 Покупка: ${i.user} — ${item.label} (${item.cost} баллов)`);
    }

    await updateLeaderboard(g);
    return i.reply({ content: "Покупка оформлена.", ephemeral: true });
  }

  if(i.customId==="shop_given"){
    if(!isMod(i.member))
      return i.reply({ content: "Нет прав.", ephemeral: true });

    if(logCh){
      await logCh.send(`✅ Выдано: ${i.user} подтвердил выдачу (${i.message.content})`);
    }

    await i.message.delete().catch(()=>{});
    return i.reply({ content: "Выдача подтверждена.", ephemeral: true });
  }

  if(i.customId==="approve"){
    if(!isMod(i.member)) return i.reply({content:"Нет прав.",ephemeral:true});
    const match=i.message.content.match(/\+(\d+)/);
    const user=i.message.mentions.users.first();
    if(!match||!user) return i.reply({content:"Ошибка заявки.",ephemeral:true});

    const pts=parseInt(match[1]);
    addPoints(g.id,user.id,pts);
    await updateLeaderboard(g);

    if(logCh){
      await logCh.send(`✅ Approve: ${i.user} начислил +${pts} ${user} (канал: ${i.channel})`);
    }

    await i.message.delete().catch(()=>{});
    return i.reply({content:"Начислено.",ephemeral:true});
  }

  if(i.customId==="reject"){
    if(!isMod(i.member)) return i.reply({content:"Нет прав.",ephemeral:true});

    if(logCh){
      await logCh.send(`❌ Reject: ${i.user} отклонил заявку (канал: ${i.channel})`);
    }

    await i.message.delete().catch(()=>{});
    return i.reply({content:"Отклонено.",ephemeral:true});
  }

  if(i.customId==="lb_my"){
    return i.reply({content:`У тебя ${getPoints(g.id,uid)} баллов.`,ephemeral:true});
  }

  if(i.customId==="lb_top"){
    const top=getTopPoints(g.id);
    const txt=top.length?top.map((u,i)=>`**${i+1}.** <@${u.user_id}> — ${u.points}`).join("\n"):"Пока нет данных.";
    return i.reply({embeds:[new EmbedBuilder().setTitle("🏆 Топ баллов").setDescription(txt)],ephemeral:true});
  }

  if(i.customId==="lb_voice_my"){
    const r=db.prepare("SELECT seconds FROM voice WHERE guild_id=? AND user_id=?").get(g.id,uid);
    return i.reply({content:`Ты в войсе ${r?Math.floor(r.seconds/60):0} мин.`,ephemeral:true});
  }
});

client.on("messageCreate", async m=>{
  if(m.author.bot||!m.content.startsWith("+")||!m.attachments.size) return;
  const rep=db.prepare("SELECT 1 FROM reports WHERE channel_id=?").get(m.channel.id);
  if(!rep) return;
  const pts=parseInt(m.content.slice(1));
  if(!pts) return;

  await m.reply({
    content:`Заявка на +${pts}`,
    components:[new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("approve").setLabel("Approve").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("reject").setLabel("Reject").setStyle(ButtonStyle.Danger)
    )]
  });
});

client.on("voiceStateUpdate",(o,n)=>{
  const g=n.guild.id,u=n.id,ts=now();
  if(!o.channelId&&n.channelId){
    db.prepare("INSERT OR IGNORE INTO voice VALUES (?,?,?,?,?)").run(g,u,0,ts,0);
  }
  if(o.channelId&&!n.channelId){
    const r=db.prepare("SELECT * FROM voice WHERE guild_id=? AND user_id=?").get(g,u);
    if(!r) return;
    const spent=ts-(r.joined_at||ts);
    const total=r.seconds+spent;
    const hours=Math.floor(total/3600);
    if(hours>r.hours_awarded){
      addPoints(g,u,(hours-r.hours_awarded)*VOICE_POINTS_PER_HOUR);
      updateLeaderboard(n.guild);
    }
    db.prepare("UPDATE voice SET seconds=?,joined_at=NULL,hours_awarded=? WHERE guild_id=? AND user_id=?")
      .run(total,hours,g,u);
  }
});

client.login(process.env.DISCORD_TOKEN);
