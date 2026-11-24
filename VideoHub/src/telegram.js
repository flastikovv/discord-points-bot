// Telegram-бот: уведомления (видео вышло, рубежи просмотров, ошибки, сводка дня)
// и команды (статистика, очередь, анализ, публикация черновиков с телефона).
// Работает, пока программа запущена на ПК (можно свёрнутой в трей).

const API = 'https://api.telegram.org/bot';

class TelegramBot {
  constructor(store, handlers) {
    this.store = store;
    this.h = handlers; // { commands: {name: async (args, chatId) => text|{text, buttons}}, callback: async (data) => text }
    this.running = false;
    this.offset = 0;
    this.abort = null;
    this.status = 'off';
    this.lastError = '';
    this.botName = '';
  }

  token() { return this.store.secret('telegramToken'); }
  cfg() { return this.store.data.settings.telegram || {}; }

  async api(method, body, signal) {
    const res = await fetch(`${API}${this.token()}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.description || `Telegram HTTP ${res.status}`);
    return data.result;
  }

  async start() {
    this.stop();
    if (!this.token()) { this.status = 'off'; return; }
    try {
      const me = await this.api('getMe');
      this.botName = me.username;
      this.status = 'on';
      this.lastError = '';
      await this.api('setMyCommands', {
        commands: [
          ['stats', 'Сводка по всем аккаунтам'],
          ['top', 'Лучшие видео за 7 дней'],
          ['weak', 'Слабые видео за 7 дней'],
          ['queue', 'Что запланировано'],
          ['drafts', 'Черновики — выложить с телефона'],
          ['money', 'Прогресс монетизации'],
          ['refresh', 'Обновить статистику'],
          ['analyze', 'ИИ-анализ за 30 дней'],
          ['help', 'Помощь'],
        ].map(([command, description]) => ({ command, description })),
      }).catch(() => {});
    } catch (e) {
      this.status = 'error';
      this.lastError = e.message;
      return;
    }
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    this.abort?.abort();
  }

  async loop() {
    while (this.running) {
      this.abort = new AbortController();
      try {
        const updates = await this.api('getUpdates', { offset: this.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, this.abort.signal);
        for (const u of updates) {
          this.offset = u.update_id + 1;
          this.onUpdate(u).catch((e) => console.warn('tg', e.message));
        }
        this.status = 'on';
      } catch (e) {
        if (!this.running) break;
        this.status = 'error';
        this.lastError = e.message;
        await new Promise((r) => setTimeout(r, 10000));
      }
    }
  }

  linked(chatId) { return String(this.cfg().chatId || '') === String(chatId); }

  async onUpdate(u) {
    if (u.callback_query) {
      const q = u.callback_query;
      if (!this.linked(q.message.chat.id)) return;
      await this.api('answerCallbackQuery', { callback_query_id: q.id }).catch(() => {});
      const reply = await this.h.callback(q.data).catch((e) => '❌ ' + e.message);
      if (reply) await this.send(reply);
      return;
    }
    const m = u.message;
    if (!m?.text) return;
    const [cmdRaw, ...args] = m.text.trim().split(/\s+/);
    const cmd = cmdRaw.replace(/^\//, '').replace(/@.*$/, '').toLowerCase();
    if (cmd === 'start') {
      const code = args[0];
      const cfg = this.cfg();
      if (this.linked(m.chat.id)) return this.reply(m.chat.id, '✅ Этот чат уже привязан к «Студии Монетизации». /help — список команд.');
      if (code && code === cfg.pairCode) {
        cfg.chatId = m.chat.id;
        cfg.chatName = m.from.username ? '@' + m.from.username : (m.from.first_name || 'чат');
        this.store.data.settings.telegram = cfg;
        this.store.save();
        this.h.onLinked?.();
        return this.reply(m.chat.id, '✅ Готово! Теперь сюда будут приходить уведомления.\n\n' + HELP);
      }
      return this.reply(m.chat.id, '🔒 Чтобы привязать бота, отправь код из программы:\n/start КОД\n\n(вкладка «Telegram» в «Студии Монетизации»)');
    }
    if (!this.linked(m.chat.id)) return this.reply(m.chat.id, '🔒 Бот не привязан к этому чату. Отправь /start КОД из программы.');
    if (cmd === 'help') return this.reply(m.chat.id, HELP);
    const fn = this.h.commands[cmd];
    if (!fn) return this.reply(m.chat.id, 'Не знаю такую команду. /help — список.');
    await this.api('sendChatAction', { chat_id: m.chat.id, action: 'typing' }).catch(() => {});
    try {
      const out = await fn(args, m.chat.id);
      if (out) await this.send(out, m.chat.id);
    } catch (e) {
      await this.reply(m.chat.id, '❌ ' + e.message);
    }
  }

  reply(chatId, text) { return this.send(text, chatId); }

  // text может быть строкой или { text, buttons: [[{text, data}]] }. Формат — HTML.
  async send(out, chatId = this.cfg().chatId) {
    if (!chatId || !this.token()) return;
    const { text, buttons } = typeof out === 'string' ? { text: out } : out;
    const parts = split(text, 3900);
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      await this.api('sendMessage', {
        chat_id: chatId, text: parts[i], parse_mode: 'HTML', disable_web_page_preview: true,
        ...(last && buttons ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => (b.url ? { text: b.text, url: b.url } : { text: b.text, callback_data: b.data }))) } } : {}),
      }).catch(async (e) => {
        // если HTML сломался — отправить без разметки
        if (/parse/i.test(e.message)) await this.api('sendMessage', { chat_id: chatId, text: parts[i].replace(/<[^>]+>/g, '') });
        else throw e;
      });
    }
  }

  // Уведомление с учётом настроек: kind = published | errors | milestones | followers | daily
  async notify(kind, out) {
    const cfg = this.cfg();
    if (!cfg.chatId || this.status !== 'on') return;
    if (cfg.notify && cfg.notify[kind] === false) return;
    await this.send(out).catch((e) => { this.lastError = e.message; });
  }
}

function split(text, n) {
  if (text.length <= n) return [text];
  const out = [];
  let rest = text;
  while (rest.length > n) {
    let cut = rest.lastIndexOf('\n', n);
    if (cut < n / 2) cut = n;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push(rest);
  return out;
}

const HELP = `<b>Команды «Студии Монетизации»</b>
/stats — подписчики и просмотры по всем аккаунтам
/top — лучшие видео за 7 дней
/weak — видео, которые просели
/queue — что запланировано
/drafts — черновики с кнопкой «Выложить»
/money — прогресс монетизации
/refresh — обновить статистику
/analyze — ИИ-разбор за 30 дней`;

// Перевод простого markdown от ИИ в HTML для Telegram
function mdToTg(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(src || '')
    .replace(/^#{1,3}\s+(.*)$/gm, '\n<b>$1</b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { TelegramBot, mdToTg };
