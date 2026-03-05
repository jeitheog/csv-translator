module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Email inválido' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const timestamp  = new Date().toISOString();

    // Reenvía al webhook si está configurado (Make / Zapier / n8n → Google Sheets, Mailchimp, etc.)
    const webhookUrl = process.env.EMAIL_WEBHOOK_URL;
    if (webhookUrl) {
        try {
            await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: cleanEmail, timestamp, source: 'csv-translator' })
            });
        } catch (_) { /* webhook failure must not block the user */ }
    }

    return res.status(200).json({ ok: true });
};
