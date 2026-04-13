const https = require('https');

module.exports = (req, res) => {
    // Extract the actual API path from the URL
    // /api/cdk-activation/check → /cdk-activation/check
    const apiPath = req.url.replace(/^\/api/, '') || '/';

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(204).end();
    }

    // Collect request body
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        const options = {
            hostname: 'ai-redeem.cc',
            port: 443,
            path: apiPath,
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Origin': 'https://ai-redeem.cc',
                'Referer': 'https://ai-redeem.cc/',
            },
        };

        const proxyReq = https.request(options, (proxyRes) => {
            // Forward status and headers
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.status(proxyRes.statusCode);

            let responseData = '';
            proxyRes.on('data', chunk => responseData += chunk);
            proxyRes.on('end', () => {
                res.send(responseData);
            });
        });

        proxyReq.on('error', (err) => {
            res.status(502).json({ message: 'Proxy error: ' + err.message });
        });

        if (body) proxyReq.write(body);
        proxyReq.end();
    });
};
