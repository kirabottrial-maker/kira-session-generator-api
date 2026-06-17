import express from 'express';
import cors from 'cors';
import fs from 'fs-extra';
import pino from 'pino';
import qrcode from 'qrcode';
import { ProxyAgent } from 'proxy-agent'; 
import { default as makeWASocket, useMultiFileAuthState, delay, DisconnectReason } from '@whiskeysockets/baileys';

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("KIRA SESSION GENERATOR ONLINE 🔥");
});

async function getOptimizedSocket(state) {
    return makeWASocket({
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
        agent: new ProxyAgent(), // 🚨 കണക്ഷൻ സ്റ്റേബിൾ ആക്കാൻ
        browser: ["Kira-X-MD", "Chrome", "125.0.0.0"],
        syncFullHistory: false,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: true,
        // 🚨 കണക്ഷൻ ക്രാഷ് ഒഴിവാക്കാൻ
        patchMessageBeforeSending: (message) => {
            const needsPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage);
            if (needsPatch) {
                message = { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadataVersion: 2, deviceListMetadata: {} }, ...message } } };
            }
            return message;
        }
    });
}

// ----------------------------------------
// 1. PAIRING CODE ENGINE
// ----------------------------------------
app.get("/pair", async (req, res) => {
    let phone = req.query.phone;
    if (!phone) return res.json({ error: "Please provide a phone number!" });
    phone = phone.replace(/[^0-9]/g, '');

    const sessionFolder = `./temp_sessions/session_${phone}_${Date.now()}`;
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
        const sock = await getOptimizedSocket(state);

        if (!sock.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(phone);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    if (!res.headersSent) res.json({ code: code }); 
                } catch (err) {
                    if (!res.headersSent) res.json({ error: "Failed to generate code." });
                }
            }, 10000); // 🚨 WhatsApp സ്പാം ഒഴിവാക്കാൻ സമയം കൂട്ടി
        }

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                await delay(3000); 
                const credsData = await fs.readFile(`${sessionFolder}/creds.json`);
                const sessionId = Buffer.from(credsData).toString('base64');
                await sock.sendMessage(sock.user.id, { text: `*✅ SESSION GENERATED*\n\n*ID:* ${sessionId}` });
                await delay(2000);
                await sock.logout();
                await fs.remove(sessionFolder); 
            }
            
            if (connection === 'close') {
                let reason = lastDisconnect?.error?.output?.statusCode;
                if (reason === DisconnectReason.loggedOut) await fs.remove(sessionFolder);
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
    } catch (err) {
        await fs.remove(sessionFolder).catch(() => {});
        if (!res.headersSent) res.json({ error: "Service Unavailable." });
    }
});

// ----------------------------------------
// 2. QR CODE ENGINE
// ----------------------------------------
app.get("/qr", async (req, res) => {
    const sessionFolder = `./temp_sessions/qr_${Date.now()}`;
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
        const sock = await getOptimizedSocket(state);
        let qrSent = false;

        sock.ev.on('connection.update', async (update) => {
            const { connection, qr } = update;

            if (qr && !qrSent) {
                qrSent = true;
                const qrBuffer = await qrcode.toBuffer(qr);
                res.type('image/png').send(qrBuffer);
            }

            if (connection === 'open') {
                const credsData = await fs.readFile(`${sessionFolder}/creds.json`);
                const sessionId = Buffer.from(credsData).toString('base64');
                await sock.sendMessage(sock.user.id, { text: `*✅ SESSION ID:* ${sessionId}` });
                await sock.logout();
                await fs.remove(sessionFolder);
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
    } catch (err) {
        await fs.remove(sessionFolder).catch(() => {});
        if (!res.headersSent) res.status(500).send("Error generating QR");
    }
});

const PORT = process.env.PORT || 25585;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
});