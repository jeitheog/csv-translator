/**
 * POST /api/collect-email
 * Stores the submitted email in Airtable.
 * Required env vars:
 *   AIRTABLE_TOKEN    – personal access token (airtable.com/create/tokens)
 *   AIRTABLE_BASE_ID  – base ID from the Airtable URL (appXXXXXXXX)
 *   AIRTABLE_TABLE    – table name (default: "Emails")
 */
module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

    const { email } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Email inválido' });
    }

    const cleanEmail = email.trim().toLowerCase();

    const token   = process.env.AIRTABLE_TOKEN;
    const baseId  = process.env.AIRTABLE_BASE_ID;
    const table   = process.env.AIRTABLE_TABLE || 'Emails';

    if (token && baseId) {
        try {
            const atRes = await fetch(
                `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        fields: {
                            Email: cleanEmail,
                            Fecha: new Date().toISOString().split('T')[0],
                            Fuente: 'csv-translator'
                        }
                    })
                }
            );
            if (!atRes.ok) {
                const err = await atRes.json().catch(() => ({}));
                console.error('Airtable error:', JSON.stringify(err));
            }
        } catch (e) {
            console.error('Airtable fetch failed:', e.message);
        }
    } else {
        // Fallback: log so it appears in Vercel function logs
        console.log(JSON.stringify({ event: 'email_collected', email: cleanEmail, ts: new Date().toISOString() }));
    }

    return res.status(200).json({ ok: true });
};
