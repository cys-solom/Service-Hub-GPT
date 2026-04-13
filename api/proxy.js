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

    const isGet = req.method === 'GET';

    // For POST: stringify body. For GET: no body at all
    let bodyStr = '';
    if (!isGet && req.body) {
        bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    return new Promise((resolve) => {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://ai-redeem.cc',
            'Referer': 'https://ai-redeem.cc/',
        };

        // Only set Content-Type and Content-Length for POST requests
        if (!isGet) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(bodyStr);
        }

        const options = {
            hostname: 'ai-redeem.cc',
            port: 443,
            path: targetPath,
            method: req.method,
            headers,
        };

        console.log(`[PROXY] ${req.method} ${targetPath}`);

        const proxyReq = https.request(options, (proxyRes) => {
            let data = '';
            proxyRes.on('data', chunk => data += chunk);
            proxyRes.on('end', () => {
                console.log(`[PROXY] Response ${proxyRes.statusCode}: ${data.substring(0, 200)}`);
                res.status(proxyRes.statusCode)
                   .setHeader('Content-Type', proxyRes.headers['content-type'] || 'application/json')
                   .send(data);
                resolve();
            });
        });

        proxyReq.on('error', (err) => {
            console.error(`[PROXY] Error: ${err.message}`);
            res.status(502).json({ message: 'Proxy error: ' + err.message });
            resolve();
        });

        proxyReq.setTimeout(15000, () => {
            proxyReq.destroy();
            res.status(504).json({ message: 'Gateway timeout' });
            resolve();
        });

        if (!isGet && bodyStr) proxyReq.write(bodyStr);
        proxyReq.end();
    });
};
