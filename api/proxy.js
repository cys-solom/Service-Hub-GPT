const https = require('https');

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // Get target path from query: /api/proxy?path=/cdk-activation/check
    const targetPath = req.query.path;
    if (!targetPath) {
        return res.status(400).json({ message: 'Missing path parameter' });
    }

    const bodyStr = req.body ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : '';

    return new Promise((resolve) => {
        const options = {
            hostname: 'ai-redeem.cc',
            port: 443,
            path: targetPath,
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Origin': 'https://ai-redeem.cc',
                'Referer': 'https://ai-redeem.cc/',
            },
        };

        const proxyReq = https.request(options, (proxyRes) => {
            let data = '';
            proxyRes.on('data', chunk => data += chunk);
            proxyRes.on('end', () => {
                res.status(proxyRes.statusCode)
                   .setHeader('Content-Type', 'application/json')
                   .send(data);
                resolve();
            });
        });

        proxyReq.on('error', (err) => {
            res.status(502).json({ message: 'Proxy error: ' + err.message });
            resolve();
        });

        proxyReq.setTimeout(15000, () => {
            proxyReq.destroy();
            res.status(504).json({ message: 'Gateway timeout' });
            resolve();
        });

        if (bodyStr) proxyReq.write(bodyStr);
        proxyReq.end();
    });
};
