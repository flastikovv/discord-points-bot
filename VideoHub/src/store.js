// Хранилище данных программы: один JSON-файл в папке пользователя.
// Секреты (токены, ключи) шифруются средствами Windows через safeStorage.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

const DEFAULT = {
  settings: {
    googleClientId: '',
    googleClientSecret: '', // enc
    tiktokClientKey: '',
    tiktokClientSecret: '', // enc
    tiktokRedirectUri: 'http://localhost:53682/callback/',
    tiktokAudited: false,
    anthropicKey: '', // enc
    autostart: true,
    keepInTray: true,
    statsAutoRefreshHours: 3,
    desktopNotify: false,
    telegramToken: '', // enc
    telegram: {
      chatId: null, chatName: '', pairCode: '',
      notify: { published: true, errors: true, milestones: true, followers: true, daily: true },
      milestones: '1000, 10000, 50000, 100000, 500000, 1000000',
      followerMilestones: '1000, 5000, 10000, 50000, 100000',
      dailyHour: 21,
    },
  },
  milestones: {},
  accounts: [],
  videos: [],
  stats: {},
  details: {},
  analyses: [],
  templates: [],
};

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'studio-data.json');
    this.data = JSON.parse(JSON.stringify(DEFAULT));
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...this.data, ...raw, settings: { ...DEFAULT.settings, ...(raw.settings || {}) } };
      this.data.settings.telegram = { ...DEFAULT.settings.telegram, ...(raw.settings?.telegram || {}), notify: { ...DEFAULT.settings.telegram.notify, ...(raw.settings?.telegram?.notify || {}) } };
    } catch (_) { /* первый запуск */ }
    this._timer = null;
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), 150);
  }

  saveNow() {
    const tmp = this.file + '.tmp';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }

  enc(text) {
    if (!text) return '';
    if (safeStorage.isEncryptionAvailable()) return 'e:' + safeStorage.encryptString(text).toString('base64');
    return 'p:' + Buffer.from(text).toString('base64');
  }

  dec(value) {
    if (!value) return '';
    try {
      if (value.startsWith('e:')) return safeStorage.decryptString(Buffer.from(value.slice(2), 'base64'));
      if (value.startsWith('p:')) return Buffer.from(value.slice(2), 'base64').toString();
    } catch (_) { return ''; }
    return value;
  }

  secret(name) { return this.dec(this.data.settings[name]); }

  id() { return crypto.randomBytes(8).toString('hex'); }

  account(id) { return this.data.accounts.find((a) => a.id === id); }

  // Токены аккаунта (зашифрованы целиком)
  tokens(acc) {
    try { return JSON.parse(this.dec(acc.tokens) || '{}'); } catch (_) { return {}; }
  }

  setTokens(acc, tokens) {
    acc.tokens = this.enc(JSON.stringify(tokens));
    this.save();
  }

  // Состояние без секретов — для интерфейса
  publicState() {
    const s = this.data.settings;
    return {
      settings: {
        googleClientId: s.googleClientId,
        hasGoogleSecret: !!s.googleClientSecret,
        tiktokClientKey: s.tiktokClientKey,
        hasTiktokSecret: !!s.tiktokClientSecret,
        tiktokRedirectUri: s.tiktokRedirectUri,
        tiktokAudited: s.tiktokAudited,
        hasAnthropicKey: !!s.anthropicKey,
        autostart: s.autostart,
        keepInTray: s.keepInTray,
        statsAutoRefreshHours: s.statsAutoRefreshHours,
        desktopNotify: s.desktopNotify,
        hasTelegramToken: !!s.telegramToken,
        telegram: s.telegram,
      },
      accounts: this.data.accounts.map(({ tokens, ...rest }) => rest),
      videos: this.data.videos,
      stats: this.data.stats,
      details: this.data.details,
      analyses: this.data.analyses,
      templates: this.data.templates,
    };
  }
}

module.exports = { Store };
