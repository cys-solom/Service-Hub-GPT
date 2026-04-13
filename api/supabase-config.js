module.exports = (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;

    if (!url || !key) {
        return res.status(500).json({ message: 'Supabase not configured' });
    }

    // Only expose the anon/public key (safe for client-side)
    return res.status(200).json({ url, key });
};
