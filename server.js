const express = require("express");
const cors = require("cors");
const fs = require("fs-extra");
const pino = require("pino");
const qrcode = require("qrcode"); 
const { default: makeWASocket, useMultiFileAuthState, delay, DisconnectReason } = require("@whiskeysockets/baileys");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
    res.send("KIRA SESSION GENERATOR ONLINE 🔥");
});

function getOptimizedSocket(state) {
    return makeWASocket({
        logger: pino({ level: "silent" }),
        printQRInTerminal: false,
        auth: state,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false, 
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => { return { conversation: "KIRA_SESSION" } } 
    });
}

// ----------------------------------------
// 1. PAIRING CODE ENGINE
// ----------------------------------------
app.get("/pair", async (req, res) => {
    let phone = req.query.phone;
    if (!phone) return res.json({ error: "Please provide a phone number!" });
    phone = phone.replace(/[^0-9]/g, '');

    // 🚨 ഒറിജിനൽ ഫോൾഡർ സ്ട്രക്ച്ചറിലേക്ക് തന്നെ മാറ്റി
    const sessionFolder = `./temp_sessions/session_${phone}_${Date.now()}`;
    
    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
        const sock = getOptimizedSocket(state);

        sock.ev.on('messaging-history.set', () => {
            console.log(`🗑️ Blocked history sync for ${phone} to save RAM!`);
        });

        if (!sock.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    let code = await sock.requestPairingCode(phone);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    if (!res.headersSent) res.json({ code: code }); 
                } catch (err) {
                    if (!res.headersSent) res.json({ error: "Failed to generate code." });
                }
            }, 3000); 
        }

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                await delay(3000); 
                const credsData = fs.readFileSync(`${sessionFolder}/creds.json`);
                const sessionId = Buffer.from(credsData).toString('base64');
                const successMsg = `*✅ KIRA-X-MD SESSION GENERATED*\n\n*✨ SESSION ID:*\n${sessionId}\n\n_⚠️ Do not share this code with anyone!_`;
                
                await sock.sendMessage(sock.user.id, { text: successMsg });
                await delay(2000);
                
                await sock.logout();
                await sock.ws.close();
                fs.removeSync(sessionFolder); 
                console.log(`✅ Session complete for ${phone}`);
            }
            
            if (connection === 'close') {
                let reason = lastDisconnect?.error?.output?.statusCode;
                if (reason === DisconnectReason.loggedOut || reason === DisconnectReason.connectionClosed) {
                    try { fs.removeSync(sessionFolder); } catch (e) {}
                }
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
    } catch (err) {
        try { fs.removeSync(sessionFolder); } catch (e) {}
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
        const sock = getOptimizedSocket(state);
        let qrSent = false;

        sock.ev.on('messaging-history.set', () => {});

        sock.ev.on('connection.update', async (update) => {
            const { connection, qr, lastDisconnect } = update;

            if (qr && !qrSent) {
                qrSent = true;
                const qrBuffer = await qrcode.toBuffer(qr);
                res.type('image/png');
                res.send(qrBuffer);
            }

            if (connection === 'open') {
                await delay(3000);
                const credsData = fs.readFileSync(`${sessionFolder}/creds.json`);
                const sessionId = Buffer.from(credsData).toString('base64');
                const successMsg = `*✅ KIRA-X-MD SESSION GENERATED*\n\n*✨ SESSION ID:*\n${sessionId}\n\n_⚠️ Do not share this code with anyone!_`;
                
                await sock.sendMessage(sock.user.id, { text: successMsg });
                await delay(2000);
                
                await sock.logout();
                await sock.ws.close();
                fs.removeSync(sessionFolder);
            }

            if (connection === 'close') {
                let reason = lastDisconnect?.error?.output?.statusCode;
                if (reason === DisconnectReason.loggedOut || reason === DisconnectReason.connectionClosed) {
                    try { fs.removeSync(sessionFolder); } catch (e) {}
                }
            }
        });
        
        sock.ev.on('creds.update', saveCreds);
        
    } catch (err) {
        try { fs.removeSync(sessionFolder); } catch (e) {}
        if (!res.headersSent) res.status(500).send("Error generating QR");
    }
});

// 🚨 Pterodactyl പാനലിന് വേണ്ടിയുള്ള പോർട്ട് കോൺഫിഗറേഷൻ
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});