const https = require('https');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { email, code, plan, activation_type, status } = req.body || {};

    if (!email || !code) {
        return res.status(400).json({ message: 'Missing email or code' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;
    const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    const now = new Date();
    const timestamp = now.toLocaleString('en-GB', { timeZone: 'Africa/Cairo' });

    // ─── 1. Save to Supabase ───
    let dbSaved = false;
    if (SUPABASE_URL && SUPABASE_KEY) {
        try {
            await httpRequest({
                hostname: SUPABASE_URL.replace('https://', ''),
                path: '/rest/v1/activations',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Prefer': 'return=minimal',
                },
            }, JSON.stringify({ email, code, plan: plan || '', activation_type: activation_type || '', status: status || 'success' }));
            dbSaved = true;
        } catch (err) {
            console.error('Supabase error:', err.message);
        }
    }

    // ─── 2. Send Telegram Notification ───
    let telegramSent = false;
    if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        const message =
            `🔔 <b>New Activation</b>\n\n` +
            `📧 <b>Email:</b> <code>${email}</code>\n` +
            `🔑 <b>Code:</b> <code>${code}</code>\n` +
            `📦 <b>Plan:</b> ${plan || '—'}\n` +
            `🔄 <b>Type:</b> ${activation_type || '—'}\n` +
            `✅ <b>Status:</b> ${status || 'success'}\n` +
            `🕐 <b>Time:</b> ${timestamp}`;

        try {
            await httpRequest({
                hostname: 'api.telegram.org',
                path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }, JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: message,
                parse_mode: 'HTML',
            }));
            telegramSent = true;
        } catch (err) {
            console.error('Telegram error:', err.message);
        }
    }

    return res.status(200).json({
        success: true,
        db_saved: dbSaved,
        telegram_sent: telegramSent,
    });
};

// Simple HTTPS request helper (no dependencies)
function httpRequest(options, body) {
    return new Promise((resolve, reject) => {
        const req = https.request({ ...options, port: 443 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
        if (body) req.write(body);
        req.end();
    });
}
