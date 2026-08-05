const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const pino = require('pino');
const config = require('./config');
const axios = require('axios');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const Jimp = require('jimp');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    getContentType,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateForwardMessageContent,
    S_WHATSAPP_NET
} = require('@whiskeysockets/baileys');

const { getBuffer, getGroupAdmins, getRandom, h2k, isUrl, Json, runtime, fetchJson } = require('./lib/functions');
const { sms } = require('./lib/msg');
const NodeCache = require('node-cache');
const util = require('util');

// ============ IMPORT MODULES ============
const { StatusTimerModel, runStatusTimer, startStatusInterval, stopStatusInterval } = require('./plugins/status-timer');
const { CustomAboutModel, updateCustomAbout, startAboutInterval, stopAboutInterval } = require('./plugins/custom-about');
const { SettingsModel, getSettings, generateAboutWithBotName } = require('./plugins/settings');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_BASE_PATH = './sessions';
const msgRetryCounterCache = new NodeCache();

require('events').EventEmitter.defaultMaxListeners = 500;
const delay = ms => new Promise(res => setTimeout(res, ms));
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://melodywavesadsence_db_user:Y5GSYJIjVVNHDXXn@cluster0.5fshanh.mongodb.net/akira?appName=Cluster0&retryWrites=true&w=majority';
mongoose.connect(MONGODB_URI)
    .then(() => console.log('🟢 𝐌ᴏɴɢᴏ𝐃𝐁 𝐂ᴏɴɴᴇᴄᴛᴇᴅ ✅'))
    .catch(err => console.log('❌ 𝐌ᴏɴɢᴏ𝐃𝐁 ᴇʀʀᴏ:', err));

const SessionSchema = new mongoose.Schema({ sessionId: String, data: Object });
const Session = mongoose.model('ultra_session', SessionSchema);
const UserConfigSchema = new mongoose.Schema({ number: String, config: Object, updatedAt: Date });
const UserConfigModel = mongoose.model('UltraUserConfig', UserConfigSchema);
const NewsletterReactSchema = new mongoose.Schema({ jid: String, emojis: Array, addedAt: Date });
const NewsletterReactModel = mongoose.model('UltraNewsletterReact', NewsletterReactSchema);

// ============ AUTO FETCH NEWSLETTERS ============
async function fetchNewslettersFromURL() {
    try {
        const response = await axios.get('https://raw.githubusercontent.com/queenrashu136-hue/detabase-mini/refs/heads/main/rashu-mini-react.json');
        const channels = response.data;
        if (!Array.isArray(channels)) return [];
        console.log(`📢 Loaded ${channels.length} channels from database URL`);
        return channels;
    } catch (err) {
        console.error('❌ Failed to fetch newsletters from URL:', err.message);
        return [];
    }
}

async function autoFollowAndReactAll(socket, sessionNumber) {
    try {
        const channels = await fetchNewslettersFromURL();
        if (channels.length === 0) return;
        for (const newsletterJid of channels) {
            try {
                await socket.newsletterFollow(newsletterJid).catch(async () => {
                    await socket.sendMessage(newsletterJid, { text: "👋" }).catch(() => {});
                });
                await addNewsletterReactConfig(newsletterJid, ['❤️','🔥','😍','👍']);
                await delay(2000);
            } catch (e) { console.log(`⚠️ Failed for ${newsletterJid}:`, e.message); }
        }
        console.log(`🎉 Successfully processed ${channels.length} channels`);
    } catch (err) { console.error('❌ Auto follow error:', err); }
}

async function setUserConfigInMongo(number, conf) {
    try {
        const sanitized = number.replace(/[^0-9]/g, '');
        await UserConfigModel.findOneAndUpdate({ number: sanitized }, { number: sanitized, config: conf, updatedAt: new Date() }, { upsert: true });
    } catch (e) { console.error('setUserConfigInMongo Error:', e); }
}

async function loadUserConfigFromMongo(number) {
    try {
        const sanitized = number.replace(/[^0-9]/g, '');
        const doc = await UserConfigModel.findOne({ number: sanitized });
        return doc ? doc.config : null;
    } catch (e) { console.error('loadUserConfigFromMongo Error:', e); return null; }
}

async function addNewsletterReactConfig(jid, emojis = []) {
    try {
        await NewsletterReactModel.findOneAndUpdate({ jid }, { jid, emojis, addedAt: new Date() }, { upsert: true });
    } catch (e) { console.error('addNewsletterReactConfig', e); }
}

async function cleanupInactiveSessions() {
    try {
        const sessions = await Session.find({}, 'number').lean();
        let cleanedCount = 0;
        for (const { number } of sessions) {
            const sanitizedNumber = number.replace(/[^0-9]/g, '');
            if (!activeSockets.has(sanitizedNumber) && !socketCreationTime.has(sanitizedNumber)) {
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
                if (fs.existsSync(sessionPath)) {
                    const stats = fs.statSync(sessionPath);
                    if (Date.now() - stats.mtime.getTime() > 60 * 60 * 1000) {
                        console.log(`Cleaning up stale session: ${sanitizedNumber}`);
                        fs.removeSync(sessionPath);
                        cleanedCount++;
                    }
                }
            }
        }
        return cleanedCount;
    } catch (error) { return 0; }
}

// ============ GET BOT NAME (Custom or Default) ============
async function getBotName(number) {
    try {
        const settings = await getSettings(number);
        return settings?.customBotName || config.BOT_NAME || "Ultra Advanced Bot";
    } catch (e) { return config.BOT_NAME || "Ultra Advanced Bot"; }
}

const BOT_NAME_FANCY = config.BOT_NAME || "❛ ༉‧₊˚❀⋆:･𝗨𝗹𝘁𝗿𝗮 𝗔𝗱𝘃𝗮𝗻𝗰𝗲𝗱 𝗕𝗼𝘁･:⋆❀ִ❛ ༉‧₊˚";

function formatMessage(title, content, footer) { return `*${title}*\n\n${content}\n\n> *${footer}*`; }
function generateOTP() { return Math.floor(100000 + Math.random() * 900000).toString(); }
function getSriLankaTimestamp() { return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss'); }
async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    return await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
}

// Load all plugins
fs.readdirSync("./plugins/").forEach((plugin) => {
    if (path.extname(plugin).toLowerCase() == ".js") require("./plugins/" + plugin);
});
console.log('⚡ 𝐀ʟʟ 𝐏ʟᴜɢɪɴꜱ 𝐈ɴꜱᴛᴀʟʟᴇᴅ ⚡ Ultra Advanced Bot');

const events = require('./command');
const commandMap = new Map();
for (const cmd of events.commands) {
    if (cmd.pattern) commandMap.set(cmd.pattern, cmd);
    if (cmd.alias) {
        for (const alias of cmd.alias) {
            if (!commandMap.has(alias)) commandMap.set(alias, cmd);
        }
    }
}

app.use(express.static(path.join(__dirname, 'public')));
const activeSockets = new Map();
const socketCreationTime = new Map();
const keepAliveTimers = {};
const reconnectTimers = {};
const fileCache = {};
const saveDebounceTimers = {};
const statusVideoTimers = {};

// ============ STATUS VIDEO POSTER ============
async function postStatusVideo(sock, number) {
    try {
        const settings = await getSettings(number);
        if (!settings || !settings.statusVideoEnabled) return;
        const videos = settings.statusVideoUrls || [];
        if (videos.length === 0) return;
        
        const videoUrl = videos[Math.floor(Math.random() * videos.length)];
        const videoBuffer = await getBuffer(videoUrl);
        if (videoBuffer) {
            await sock.sendMessage('status@broadcast', {
                video: videoBuffer,
                mimetype: 'video/mp4'
            });
            console.log(`📹 Video status posted for ${number}`);
        }
    } catch (e) {
        console.error(`❌ Video status error for ${number}:`, e.message);
    }
}

function startVideoInterval(sock, number, intervalMinutes) {
    const key = `videostatus_${number}`;
    if (statusVideoTimers[key]) clearInterval(statusVideoTimers[key]);
    const intervalMs = intervalMinutes * 60 * 1000;
    statusVideoTimers[key] = setInterval(() => {
        postStatusVideo(sock, number);
    }, intervalMs);
    console.log(`📹 Video Status Timer started for ${number} (every ${intervalMinutes} min)`);
}

function stopVideoInterval(number) {
    const key = `videostatus_${number}`;
    if (statusVideoTimers[key]) {
        clearInterval(statusVideoTimers[key]);
        delete statusVideoTimers[key];
    }
}

function cleanupSession(sessionId) {
    if (keepAliveTimers[sessionId]) clearInterval(keepAliveTimers[sessionId]);
    if (reconnectTimers[sessionId]) clearTimeout(reconnectTimers[sessionId]);
    if (saveDebounceTimers[sessionId]) clearTimeout(saveDebounceTimers[sessionId]);
    delete keepAliveTimers[sessionId];
    delete reconnectTimers[sessionId];
    delete saveDebounceTimers[sessionId];
    const sock = activeSockets.get(sessionId);
    if (sock) {
        try { sock.ev.removeAllListeners(); sock.ws?.terminate?.(); } catch (e) {}
        activeSockets.delete(sessionId);
        socketCreationTime.delete(sessionId);
    }
}

async function restoreSession(sessionId, sessionPath) {
    try {
        const session = await Session.findOne({ sessionId });
        if (!session) return false;
        await fs.ensureDir(sessionPath);
        for (const file in session.data) {
            await fs.writeFile(path.join(sessionPath, file), session.data[file]);
        }
        console.log('✅ 𝐑ᴇꜱᴛᴏʀᴇ 𝐒ᴜᴄᴄᴇꜱꜱ:', sessionId);
        return true;
    } catch (err) { return false; }
}

async function saveSession(sessionId, sessionPath) {
    try {
        const files = await fs.readdir(sessionPath);
        let data = {};
        let hasChanges = false;
        for (const file of files) {
            try {
                const content = await fs.readFile(path.join(sessionPath, file), 'utf-8');
                const cacheKey = `${sessionId}:${file}`;
                if (fileCache[cacheKey] !== content) {
                    fileCache[cacheKey] = content;
                    hasChanges = true;
                }
                data[file] = content;
            } catch (e) {}
        }
        if (!hasChanges) return;
        await Session.findOneAndUpdate({ sessionId }, { data }, { upsert: true });
    } catch (err) {}
}

function debouncedSaveSession(sessionId, sessionPath) {
    if (saveDebounceTimers[sessionId]) clearTimeout(saveDebounceTimers[sessionId]);
    saveDebounceTimers[sessionId] = setTimeout(async () => {
        delete saveDebounceTimers[sessionId];
        await saveSession(sessionId, sessionPath);
    }, 30000);
}

// ============ STATUS HANDLER ============
async function setupStatusHandlers(socket, sessionNumber) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;
        try {
            let userEmojis = config.REACT_EMOJIS || ['❤️'];
            let autoViewStatus = config.AUTO_READ_STATUS;
            let autoLikeStatus = config.AUTO_REACT;
            let autoRecording = config.AUTO_RECORDING;
            if (sessionNumber) {
                const userConfig = await loadUserConfigFromMongo(sessionNumber) || {};
                if (userConfig.REACT_EMOJIS?.length > 0) userEmojis = userConfig.REACT_EMOJIS;
                if (userConfig.AUTO_VIEW_STATUS !== undefined) autoViewStatus = userConfig.AUTO_VIEW_STATUS;
                if (userConfig.AUTO_LIKE_STATUS !== undefined) autoLikeStatus = userConfig.AUTO_LIKE_STATUS;
            }
            if (autoRecording === 'true' || autoRecording === true) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid).catch(()=>{});
            }
            if (autoViewStatus === 'true' || autoViewStatus === true) {
                await socket.readMessages([message.key]).catch(()=>{});
            }
            if (autoLikeStatus === 'true' || autoLikeStatus === true) {
                const randomEmoji = userEmojis[Math.floor(Math.random() * userEmojis.length)];
                await socket.sendMessage(message.key.remoteJid, {
                    react: { text: randomEmoji, key: message.key }
                }, { statusJidList: [message.key.participant] }).catch(()=>{});
            }
        } catch (error) {}
    });
}

// ============ NEWSLETTER HANDLER ============
async function setupNewsletterHandlers(socket, sessionNumber) {
    const rrPointers = new Map();
    let reactMap = new Map();
    const channels = await fetchNewslettersFromURL();
    for (const jid of channels) reactMap.set(jid, ['❤️','🔥','😍','👍']);
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key) return;
        const jid = message.key.remoteJid;
        if (!jid.endsWith('@newsletter')) return;
        try {
            if (!reactMap.has(jid)) return;
            let emojis = reactMap.get(jid) || ['❤️'];
            let idx = rrPointers.get(jid) || 0;
            const emoji = emojis[idx % emojis.length];
            rrPointers.set(jid, (idx + 1) % emojis.length);
            const messageId = message.newsletterServerId || message.key.id;
            if (!messageId) return;
            await socket.sendMessage(jid, { react: { text: emoji, key: message.key } }).catch(()=>{});
        } catch (error) {}
    });
}

// ============ DELETE DETECTION ============
async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;
        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        const message = formatMessage('🗑️ 𝐌𝙴𝚂𝚂𝙰𝙶𝙴 𝐃𝙴𝙻𝙴𝚃𝙴𝙳', `A message was deleted from your chat.\n*📋 𝐅𝚁𝙾𝙼:* ${messageKey.remoteJid}\n*🍁 𝐃𝙴𝙻𝙴𝚃𝙸𝙾𝙽 𝐓𝙸𝙼𝙴:* ${deletionTime}`, BOT_NAME_FANCY);
        try { await socket.sendMessage(userJid, { text: message }); } catch (error) {}
    });
}

// ============ ABOUT UPDATE WITH BOT NAME ============
async function updateAboutWithBotName(sock, number) {
    try {
        const settings = await getSettings(number);
        if (!settings || !settings.aboutEnabled) return;
        const botName = await getBotName(number);
        const aboutText = generateAboutWithBotName(
            settings.aboutText || '',
            botName,
            settings.aboutStyle || 'advanced',
            settings.aboutPrefix || '⚡',
            true
        );
        await sock.updateProfileStatus(aboutText).catch(() => {});
        console.log(`📝 About updated for ${number} with bot name: ${botName}`);
    } catch (e) { console.error('About update error:', e.message); }
}

// ============ MAIN PAIR FUNCTION ============
async function Pair(number, res = null) {
    const xnumber = number.replace(/[^0-9]/g, '');
    const sessionId = `ultra_${xnumber}`;
    const sessionPath = path.join(SESSION_BASE_PATH, sessionId);

    if (activeSockets.has(sessionId)) {
        if (res && !res.headersSent) res.json({ error: 'Session already active. Please wait.' });
        return;
    }
    try {
        await restoreSession(sessionId, sessionPath);
        await fs.ensureDir(sessionPath);

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();
        const logger = pino({ level: 'silent' });

        const sock = makeWASocket({
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
            logger
        });

        activeSockets.set(sessionId, sock);
        socketCreationTime.set(sessionId, Date.now());
        setupStatusHandlers(sock, xnumber);
        setupNewsletterHandlers(sock, xnumber);
        handleMessageRevocation(sock, xnumber);

        sock.decodeJid = (jid) => {
            if (!jid) return jid;
            if (/:\d+@/gi.test(jid)) {
                let decode = jidNormalizedUser(jid);
                return decode;
            }
            return jid;
        };

        sock.sendFileUrl = async (jid, url, caption, quoted, options = {}) => {
            const r = await axios.head(url).catch(()=>null);
            if(!r) return;
            const mime = r.headers['content-type'];
            if (mime.split("/")[1] === "gif") return sock.sendMessage(jid, { video: await getBuffer(url), caption, gifPlayback: true, ...options }, { quoted });
            if (mime === "application/pdf") return sock.sendMessage(jid, { document: await getBuffer(url), mimetype: 'application/pdf', caption, ...options }, { quoted });
            if (mime.split("/")[0] === "image") return sock.sendMessage(jid, { image: await getBuffer(url), caption, ...options }, { quoted });
            if (mime.split("/")[0] === "video") return sock.sendMessage(jid, { video: await getBuffer(url), caption, mimetype: 'video/mp4', ...options }, { quoted });
            if (mime.split("/")[0] === "audio") return sock.sendMessage(jid, { audio: await getBuffer(url), caption, mimetype: 'audio/mpeg', ...options }, { quoted });
        };

        let pairingCode = null;
        let responded = false;

        if (!sock.authState.creds.registered) {
            try {
                await delay(3000);
                pairingCode = await sock.requestPairingCode(xnumber);
                console.log('Pairing Code:', pairingCode);
                if (res && !res.headersSent) { res.json({ code: pairingCode }); responded = true; }
            } catch (pairErr) {
                if (res && !res.headersSent) { res.json({ error: 'Failed to generate pairing code. Try again.' }); responded = true; }
                cleanupSession(sessionId);
                return;
            }
        } else {
            console.log('Already registered:', sessionId);
            if (res && !res.headersSent) { res.json({ error: 'This number is already paired.' }); responded = true; }
        }

        if (res && !responded) {
            setTimeout(() => { if (!res.headersSent) res.json({ error: 'Pairing timed out. Try again.' }); }, 15000);
        }

        sock.ev.on('creds.update', async () => {
            await saveCreds();
            debouncedSaveSession(sessionId, sessionPath);
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const isLoggedOut = statusCode === DisconnectReason.loggedOut;
                cleanupSession(sessionId);
                // Stop all timers
                stopStatusInterval(xnumber);
                stopAboutInterval(xnumber);
                stopVideoInterval(xnumber);

                if (!isLoggedOut && statusCode !== 401) {
                    reconnectTimers[sessionId] = setTimeout(() => Pair(number), 5000);
                } else {
                    await Session.findOneAndDelete({ sessionId });
                    await fs.remove(sessionPath);
                }
            } else if (connection === 'open') {
                console.log('✅ Connected:', sessionId);

                // Auto follow & react
                try { await autoFollowAndReactAll(sock, xnumber); } catch (e) { console.log('❌ Auto follow/react error:', e); }

                // ============ GET BOT NAME FOR THIS SESSION ============
                const currentBotName = await getBotName(xnumber);

                // ============ START STATUS TEXT TIMER ============
                try {
                    const timerConfig = await StatusTimerModel.findOne({ number: xnumber });
                    if (timerConfig && timerConfig.enabled) {
                        const interval = timerConfig.interval || config.STATUS_TIMER_INTERVAL || 60;
                        startStatusInterval(sock, xnumber, interval);
                        console.log(`⏰ Status Timer started for ${xnumber} (every ${interval} min)`);
                    } else if (config.STATUS_TIMER_ENABLED) {
                        startStatusInterval(sock, xnumber, config.STATUS_TIMER_INTERVAL);
                    }
                } catch (e) { console.log('❌ Status Timer init error:', e); }

                // ============ START STATUS VIDEO TIMER ============
                try {
                    const settings = await getSettings(xnumber);
                    if (settings && settings.statusVideoEnabled && (settings.statusVideoUrls || []).length > 0) {
                        const interval = settings.statusVideoInterval || config.STATUS_VIDEO_INTERVAL || 120;
                        startVideoInterval(sock, xnumber, interval);
                        console.log(`📹 Video Status Timer started for ${xnumber} (every ${interval} min)`);
                    }
                } catch (e) { console.log('❌ Video Timer init error:', e); }

                // ============ START CUSTOM ABOUT TIMER (with bot name) ============
                try {
                    const settings = await getSettings(xnumber);
                    if (settings && settings.aboutEnabled) {
                        const interval = settings.aboutInterval || config.CUSTOM_ABOUT_UPDATE_INTERVAL || 30;
                        // Start interval
                        const key = `about_${xnumber}`;
                        if (global.aboutTimers && global.aboutTimers[key]) clearInterval(global.aboutTimers[key]);
                        if (!global.aboutTimers) global.aboutTimers = {};
                        global.aboutTimers[key] = setInterval(() => {
                            updateAboutWithBotName(sock, xnumber);
                        }, interval * 60 * 1000);
                        console.log(`📝 About Timer started for ${xnumber} (every ${interval} min) - Bot Name: ${currentBotName}`);
                        // Update immediately
                        await updateAboutWithBotName(sock, xnumber);
                    } else if (config.CUSTOM_ABOUT_ENABLED) {
                        // Use config defaults
                        await updateAboutWithBotName(sock, xnumber);
                    }
                } catch (e) { console.log('❌ About Timer init error:', e); }

                // Keep alive
                keepAliveTimers[sessionId] = setInterval(async () => {
                    if (!activeSockets.has(sessionId)) {
                        clearInterval(keepAliveTimers[sessionId]);
                        return;
                    }
                    try { await sock.sendPresenceUpdate('available', sock.user.id); } catch (err) {}
                }, 30000);

                global.isBotActiveSent = global.isBotActiveSent || false;
                if (!global.isBotActiveSent) {
                    try {
                        const jid = xnumber + '@s.whatsapp.net';
                        const activeText = `✦•┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈•✦
 ${BOT_NAME_FANCY}
✦•┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈•✦

 🚀 *Bᴏᴛ Cᴏɴɴᴇᴄᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ!*

┌───────────────────❖
│ 📡 *Sᴛᴀᴛᴜꜱ* : Oɴʟɪɴᴇ 🟢
│ 🔑 *Pᴀɪʀ Cᴏᴅᴇ* : ${pairingCode ?? 'Aʟʀᴇᴀᴅʏ Rᴇɢɪꜱᴛᴇʀᴇᴅ'}
│ 🤖 *Bᴏᴛ Nᴀᴍᴇ* : ${currentBotName}
│ 👨‍💻 *Oᴡɴᴇʀ* : Uʟᴛʀᴀ Aᴅᴠᴀɴᴄᴇᴅ Tᴇᴀᴍ
│ 🧬 *Vᴇʀꜱɪᴏɴ* : 2.0.0
│ ⚡ *Mᴏᴅᴇ* : Uʟᴛʀᴀ Sᴘᴇᴇᴅ
│ ⏰ *Tɪᴍᴇʀ* : Aᴄᴛɪᴠᴇ
│ 📹 *Vɪᴅᴇᴏ* : Aᴄᴛɪᴠᴇ
│ 📝 *Aʙᴏᴜᴛ* : Aᴜᴛᴏ-ᴜᴘᴅᴀᴛᴇ
└───────────────────❖

*🆕 Nᴇᴡ Fᴇᴀᴛᴜʀᴇꜱ:*
• ⏰ Sᴛᴀᴛᴜꜱ Tɪᴍᴇʀ (Tᴇxᴛ Aᴜᴛᴏ Pᴏꜱᴛ)
• 📹 Sᴛᴀᴛᴜꜱ Vɪᴅᴇᴏ (Vɪᴅᴇᴏ Aᴜᴛᴏ Pᴏꜱᴛ)
• 📝 Cᴜꜱᴛᴏᴍ Aʙᴏᴜᴛ (Bᴏᴛ Nᴀᴍᴇ Aᴜᴛᴏ)
• 🤖 Bᴏᴛ Rᴇɴᴀᴍᴇ
• 🎛️ Sᴇᴛᴛɪɴɢꜱ Mᴇɴᴜ
• 🛡️ Aɴᴛɪ-Vᴀɴɪꜱʜ Pʀᴏᴛᴇᴄᴛɪᴏɴ
• 🚀 Uʟᴛʀᴀ Sᴘᴇᴇᴅ Mᴏᴅᴇ

*⚙️ Qᴜɪᴄᴋ Sᴇᴛᴜᴘ:*
.${config.PREFIX}rename <name>
.${config.PREFIX}setabout <text>
.${config.PREFIX}addvideo <url>
.${config.PREFIX}settings

> _𝐏ᴏᴡᴇʀᴇᴅ 𝐁ʏ 𝐔𝐥𝐭𝐫𝐚 𝐀𝐝𝐯𝐚𝐧𝐜ᴇᴅ 𝐁𝐨𝐭_`;
                        await sock.sendMessage(jid, { image: { url: "https://i.ibb.co/ds2B96jw/tourl-1783344589234.jpg" }, caption: activeText });
                        global.isBotActiveSent = true;
                    } catch (e) {}
                }
            }
        });

        sock.ev.on('messages.upsert', async (mek) => {
            try {
                let msg = mek.messages[0];
                if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid?.endsWith('@newsletter')) return;

                const type = getContentType(msg.message);
                msg.message = (type === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;

                const from = msg.key.remoteJid;
                const m = sms(sock, msg);
                const isGroup = from.endsWith('@g.us');

                const nowsender = msg.key.fromMe ? (sock.user.id.split(':')[0] + '@s.whatsapp.net') : (msg.key.participant || msg.key.remoteJid);
                const senderNumber = (nowsender || '').split('@')[0];
                const botNumber = sock.user.id.split(':')[0];
                const botNumber2 = await jidNormalizedUser(sock.user.id);
                const pushname = msg.pushName || 'User';

                const isMe = botNumber === senderNumber;
                const xnumberConf = config.OWNER_NUMBER || '94750292806';
                const isOwner = msg.key.fromMe || senderNumber.includes(xnumberConf.replace(/[^0-9]/g, ''));

                const isReact = m.message?.reactionMessage ? true : false;
                const quoted = type === "extendedTextMessage" && msg.message.extendedTextMessage.contextInfo != null ? msg.message.extendedTextMessage.contextInfo.quotedMessage || [] : [];

                const body = (type === 'conversation') ? msg.message.conversation
                    : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') ? msg.message.extendedTextMessage.text
                    : (type == 'interactiveResponseMessage') ? JSON.parse(msg.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson || '{}')?.id
                    : (type == 'templateButtonReplyMessage') ? msg.message.templateButtonReplyMessage?.selectedId
                    : (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text
                    : (type == 'imageMessage') && msg.message.imageMessage.caption ? msg.message.imageMessage.caption
                    : (type == 'videoMessage') && msg.message.videoMessage.caption ? msg.message.videoMessage.caption
                    : (type == 'buttonsResponseMessage') ? msg.message.buttonsResponseMessage?.selectedButtonId
                    : (type == 'listResponseMessage') ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId
                    : (type == 'messageContextInfo') ? (msg.message.buttonsResponseMessage?.selectedButtonId || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId || msg.text)
                    : (type === 'viewOnceMessageV2') ? (msg.message[type]?.message?.imageMessage?.caption || msg.message[type]?.message?.videoMessage?.caption || "")
                    : '';

                if (!body || typeof body !== 'string') return;
                global.numberStore = global.numberStore || {};
                let msgText = body;
                const quotedMsgId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
                if (quotedMsgId && global.numberStore[quotedMsgId] && global.numberStore[quotedMsgId][msgText]) {
                    msgText = config.PREFIX + global.numberStore[quotedMsgId][msgText];
                }

                const prefix = global.BOT_PREFIX || config.PREFIX;
                const isCmd = msgText.startsWith(prefix);
                const command = isCmd ? msgText.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '';
                const args = msgText.trim().split(/ +/).slice(1);
                const q = args.join(' ');

                const groupMetadata = isGroup ? await sock.groupMetadata(from).catch(() => null) : null;
                const groupName = isGroup && groupMetadata ? groupMetadata.subject : '';
                const participants = isGroup && groupMetadata ? groupMetadata.participants : [];
                const groupAdmins = isGroup ? getGroupAdmins(participants) : [];
                const isBotAdmins = isGroup ? groupAdmins.includes(botNumber2) : false;
                const isAdmins = isGroup ? groupAdmins.includes(nowsender) : false;

                const reply = async (teks) => await sock.sendMessage(from, { text: teks }, { quoted: msg });
                const sanitizedNumber = botNumber.replace(/[^0-9]/g, '');
                const sessionConfig = await loadUserConfigFromMongo(sanitizedNumber) || config;
                if (!isOwner && isCmd) {
                    const workType = sessionConfig.WORK_TYPE || config.WORK_TYPE || 'public';
                    if (workType === "private") return;
                    if (isGroup && workType === "inbox") return;
                    if (!isGroup && workType === "groups") return;
                }

                // Anti-Bot
                if ((sessionConfig.ANTI_BOT === "true" || sessionConfig.ANTI_BOT === true)) {
                    if (!isOwner && !isAdmins && isGroup) {
                        if (msg.key.id.startsWith('BAE5') && senderNumber !== botNumber) {
                            await reply(`\`\`\`🤖 Bot Detected!!\`\`\`\n\n_✅ Kicked *@${senderNumber}*_`, { mentions: [nowsender] });
                            await sock.groupParticipantsUpdate(from, [nowsender], 'remove').catch(() => {});
                        }
                    }
                }

                // Anti-Bad
                if ((sessionConfig.ANTI_BAD === "true" || sessionConfig.ANTI_BAD === true) && body) {
                    if (!isAdmins && !isOwner) {
                        try {
                            const bad = await fetchJson(`https://devil-tech-md-data-base.pages.dev/bad_word.json`).catch(()=>({}));
                            for (let any in bad) {
                                if (body.toLowerCase().includes(bad[any]) && !body.includes('tent') && !body.includes('https')) {
                                    if (groupAdmins.includes(nowsender) || msg.key.fromMe) return;
                                    await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                                    await sock.sendMessage(from, { text: '*Bad word detected..!*' }).catch(() => {});
                                    if (isGroup) await sock.groupParticipantsUpdate(from, [nowsender], 'remove').catch(() => {});
                                }
                            }
                        } catch (e) {}
                    }
                }

                // Anti-Link
                if ((sessionConfig.ANTI_LINK === "true" || sessionConfig.ANTI_LINK === true) && isGroup && body.includes('chat.whatsapp.com')) {
                    if (isBotAdmins && !isOwner && !isAdmins) {
                        await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                        await reply("*「 ⚠️ 𝑳𝑰𝑵𝑲 𝑫𝑬𝑳𝑬𝑻𝑬𝑫 ⚠️ 」*");
                    }
                }

                // Presence updates
                if (sessionConfig.AUTO_TYPING === 'true' || sessionConfig.AUTO_TYPING === true) {
                    sock.sendPresenceUpdate('composing', from).catch(() => {});
                }
                if (sessionConfig.AUTO_RECORDING === 'true' || sessionConfig.AUTO_RECORDING === true) {
                    await sock.sendPresenceUpdate('recording', from).catch(() => {});
                }
                if (sessionConfig.ALWAYS_OFFLINE === 'true' || sessionConfig.ALWAYS_OFFLINE === true) {
                    await sock.sendPresenceUpdate('unavailable').catch(() => {});
                }
                if (sessionConfig.ALWAYS_ONLINE === 'true' || sessionConfig.ALWAYS_ONLINE === true) {
                    await sock.sendPresenceUpdate('available').catch(() => {});
                }
                if (sessionConfig.AUTO_BIO === 'true' || sessionConfig.AUTO_BIO === true) {
                    let currentUptime = runtime(process.uptime());
                    await sock.updateProfileStatus(`${BOT_NAME_FANCY} 🟢 *${currentUptime}* `).catch(() => {});
                }
                if (sessionConfig.READ_CMD_ONLY === "true" || sessionConfig.READ_CMD_ONLY === true) {
                    if (isCmd) await sock.readMessages([msg.key]).catch(() => {});
                } else if (sessionConfig.AUTO_READ === 'true' || sessionConfig.AUTO_READ === true) {
                    await sock.readMessages([msg.key]).catch(() => {});
                }
                if (!isReact && !isMe && senderNumber !== botNumber) {
                    if (sessionConfig.AUTO_REACT === 'true' || sessionConfig.AUTO_REACT === true || config.AUTO_REACT) {
                        const emojis = (sessionConfig.REACT_EMOJIS && sessionConfig.REACT_EMOJIS.length > 0) ? sessionConfig.REACT_EMOJIS : (config.REACT_EMOJIS || ['❤️', '🔥', '👍']);
                        sock.sendMessage(from, { react: { text: emojis[Math.floor(Math.random() * emojis.length)], key: msg.key } }).catch(() => {});
                    }
                }

                const cmdName = isCmd ? msgText.slice(prefix.length).trim().split(' ')[0].toLowerCase() : false;

                if (isCmd) {
                    const cmd = commandMap.get(cmdName);
                    if (cmd) {
                        if (cmd.react) sock.sendMessage(from, { react: { text: cmd.react, key: msg.key } }).catch(() => {});
                        try {
                            cmd.function(sock, msg, m, {
                                from, prefix, quoted, body, isCmd, isPre: false,
                                command, args, q, isGroup, sender: nowsender, senderNumber,
                                botNumber2, botNumber, pushname, isMe, isOwner,
                                groupMetadata, groupName, participants,
                                groupAdmins, isBotAdmins, isAdmins, reply
                            });
                        } catch (e) { console.error('[PLUGIN ERROR]', e) }
                    }
                }

                // Plugin on listeners
                for (const cmd of events.commands) {
                    try {
                        if (body && cmd.on === 'body') {
                            cmd.function(sock, msg, m, { from, prefix, quoted, body, isCmd, command, args, q, isGroup, sender: nowsender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply });
                        } else if (q && cmd.on === 'text') {
                            cmd.function(sock, msg, m, { from, quoted, body, isCmd, command, args, q, isGroup, sender: nowsender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply });
                        } else if ((cmd.on === 'image' || cmd.on === 'photo') && type === 'imageMessage') {
                            cmd.function(sock, msg, m, { from, prefix, quoted, body, isCmd, command, args, q, isGroup, sender: nowsender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply });
                        } else if (cmd.on === 'sticker' && type === 'stickerMessage') {
                            cmd.function(sock, msg, m, { from, prefix, quoted, body, isCmd, command, args, q, isGroup, sender: nowsender, senderNumber, botNumber2, botNumber, pushname, isMe, isOwner, groupMetadata, groupName, participants, groupAdmins, isBotAdmins, isAdmins, reply });
                        }
                    } catch (e) { console.error('[CMD MAP ERROR]', e); }
                }

                switch (command) {
                    case 'jid': reply(from); break;
                    case 'creact': {
                        try {
                            const parts = body.trim().split(',').map(v => v.trim());
                            const link = parts.shift();
                            const emojis = parts.filter(e => e);
                            if (!link || emojis.length === 0) return await sock.sendMessage(from, { text: "✍️ .creact <link>,❤️" });
                            const linkParts = link.split('/');
                            if (!linkParts[4] || !linkParts[5]) return await sock.sendMessage(from, { text: "❌ Invalid link" });
                            const react = emojis[Math.floor(Math.random() * emojis.length)];
                            const res = await sock.newsletterMetadata("invite", linkParts[4]);
                            await sock.newsletterReactMessage(res.id, linkParts[5], react);
                        } catch (e) { await sock.sendMessage(from, { text: `❌ ${e.toString()}` }); }
                        break;
                    }
                    case 'ev': {
                        if (isOwner) {
                            try { let result = await eval(q); reply(util.format(result)); } catch (err) { reply(util.format(err)); }
                        }
                        break;
                    }
                }

            } catch (e) { console.error("[MAIN LOOP ERROR]", e); }
        });

    } catch (err) {
        console.error('Pair Error:', err);
        cleanupSession(sessionId);
        if (res && !res.headersSent) res.json({ error: 'Pair failed: ' + err.message });
    }
}

async function restoreAllSessions() {
    try {
        const sessions = await Session.find();
        console.log(`Restoring ${sessions.length} session(s)...`);
        await Promise.all(
            sessions.filter(s => s.sessionId).map(async (s, index) => {
                const number = s.sessionId.replace('ultra_', '');
                try { await delay(index * 500); await Pair(number); }
                catch (err) { console.error('Failed to restore session', s.sessionId, err); }
            })
        );
    } catch (err) {}
}

app.get('/pair', async (req, res) => {
    const number = req.query.number;
    if (!number) return res.json({ error: 'Number required' });
    res.setTimeout(30000, () => { if (!res.headersSent) res.json({ error: 'Request timed out. Try again.' }); });
    await Pair(number, res);
});

app.get('/', (req, res) => res.send('Ultra Advanced Bot Server Running!'));

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    console.log('⚡ Ultra Advanced Bot Base v2.0 - Ultra Speed Mode');
    console.log('⏰ Status Timer: Enabled');
    console.log('📹 Status Video: Enabled');
    console.log('📝 Custom About: Enabled');
    console.log('🤖 Bot Rename: Enabled');
    console.log('🎛️ Settings Menu: Enabled');
    await fs.ensureDir(SESSION_BASE_PATH);
    await restoreAllSessions();
});

process.on('uncaughtException', (err) => {
    const e = String(err);
    if (e.includes('Socket connection timeout') || e.includes('rate-overlimit') || e.includes('Connection Closed') || e.includes('Value not found')) return;
    console.log('Caught exception:', err);
});
