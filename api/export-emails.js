/**
 * GET /api/export-emails?key=ADMIN_KEY
 * Returns all collected emails as a CSV file ready to download.
 * Required env vars:
 *   AIRTABLE_TOKEN    – same as collect-email
 *   AIRTABLE_BASE_ID  – same as collect-email
 *   AIRTABLE_TABLE    – same as collect-email (default: "Emails")
 *   ADMIN_KEY         – secret key to protect this endpoint
 */
module.exports = async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const adminKey = process.env.ADMIN_KEY;
    if (adminKey && req.query.key !== adminKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token  = process.env.AIRTABLE_TOKEN;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table  = process.env.AIRTABLE_TABLE || 'Emails';

    if (!token || !baseId) {
        return res.status(503).json({ error: 'Airtable not configured' });
    }

    // Paginate through all records
    const records = [];
    let offset = null;

    do {
        const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`);
        url.searchParams.set('pageSize', '100');
        if (offset) url.searchParams.set('offset', offset);

        const r = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await r.json();
        if (data.error) return res.status(500).json({ error: data.error.message });

        (data.records || []).forEach(rec => {
            records.push({
                email: rec.fields.Email || '',
                fecha: rec.fields.Fecha || '',
                fuente: rec.fields.Fuente || ''
            });
        });
        offset = data.offset || null;
    } while (offset);

    // Build CSV
    const header = 'Email,Fecha,Fuente';
    const rows   = records.map(r => `${r.email},${r.fecha},${r.fuente}`);
    const csv    = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="emails_${new Date().toISOString().split('T')[0]}.csv"`);
    return res.send(csv);
};
