export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { text, langPair, model = 'claude-3-5-sonnet-20240620' } = req.body;
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) {
        return res.status(401).json({ error: 'Falta la API Key de Anthropic' });
    }

    const [sl, tl] = langPair.split('|');
    const targetLangName = tl === 'es' ? 'Español' : tl;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: model,
                max_tokens: 4096,
                system: `Eres un traductor profesional experto en E-commerce y Shopify.
Tu tarea es traducir el texto del usuario al ${targetLangName}.

REGLAS CRÍTICAS:
1. Mantén todas las etiquetas HTML (<div>, <p>, <strong>, etc.) exactamente en su lugar. Solo traduce el texto dentro de ellas.
2. NO traduzcas variables de Shopify (ej: {{ product.title }}, {{ shop.name }}).
3. Mantén el tono profesional y orientado a la venta.
4. Responde ÚNICAMENTE con la traducción, sin explicaciones ni saludos.
5. Si ves un delimitador como " [[[###]]] ", consérvalo exactamente igual para separar diferentes segmentos de texto.`,
                messages: [
                    { role: 'user', content: `Traduce el siguiente texto al ${targetLangName}:\n\n${text}` }
                ]
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Error de Anthropic:', data);
            return res.status(response.status).json({
                error: data.error?.message || 'Error en la API de Anthropic'
            });
        }

        const translatedText = data.content[0].text;
        return res.status(200).json({ translated: translatedText });
    } catch (error) {
        console.error('Error en el proxy de traducción:', error);
        return res.status(500).json({ error: 'Error interno del servidor al procesar la traducción' });
    }
}
