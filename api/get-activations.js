const https = require('https');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');

    if (req.method === 'OPTIONS') return res.status(204).end();

    // ─── Auth Check ───
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
    const password = req.headers['x-admin-password'] || req.query.password;

    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_KEY = process.env.SUPABASE_KEY;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return res.status(500).json({ message: 'Database not configured' });
    }

    try {
        const limit = req.query.limit || 50;
        const offset = req.query.offset || 0;

        const data = await httpRequest({
            hostname: SUPABASE_URL.replace('https://', ''),
            path: `/rest/v1/activations?order=created_at.desc&limit=${limit}&offset=${offset}&select=*`,
            method: 'GET',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
            },
        });

        // Get total count
        const countData = await httpRequest({
            hostname: SUPABASE_URL.replace('https://', ''),
            path: `/rest/v1/activations?select=id&limit=0`,
            method: 'HEAD',
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Prefer': 'count=exact',
            },
        });

        return res.status(200).json({
            records: JSON.parse(data),
            total: parseInt(countData.headers?.['content-range']?.split('/')[1] || '0'),
        });
    } catch (err) {
        console.error('Fetch error:', err.message);
        return res.status(500).json({ message: 'Failed to fetch records' });
    }
};

function httpRequest(options, body) {
    return new Promise((resolve, reject) => {
        const req = https.request({ ...options, port: 443 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (options.method === 'HEAD') {
                    resolve({ headers: res.headers });
                } else if (res.statusCode >= 200 && res.statusCode < 300) {
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
