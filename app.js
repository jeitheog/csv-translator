/* ============================================================
   CSV Traductor al Español — app.js
   ============================================================ */

// ── State ──────────────────────────────────────────────────
const state = {
  rawText: '',
  headers: [],
  rows: [],        // array of arrays
  selectedCols: new Set(),
  translatedRows: [],
  fileName: '',
  isShopify: false,
};

// ── Shopify Template Detection ─────────────────────────────
// Only these columns will be translated in a Shopify CSV.
// Supports BOTH the generic template format AND the real export format.
const SHOPIFY_TRANSLATABLE_COLS = new Set([
  'Title',
  'Description',        // generic template format
  'Body (HTML)',         // real export format
  'Option1 name',       // generic template (names)
  'Option2 name',
  'Option3 name',
  'Option1 Name',       // real export (names)
  'Option2 Name',
  'Option3 Name',
  // Option Values are added dynamically — only for color options
]);

// Keywords that identify a color option (case-insensitive)
const COLOR_KEYWORDS = ['color', 'colour', 'farbe', 'kleur', 'couleur'];

function addColorOptionValues(headers, rows) {
  // For each Option Name column, check if its value is color-related
  // If so, add the corresponding Option Value column to translatable set
  const optionPairs = [
    ['Option1 Name', 'Option1 Value'], ['Option1 name', 'Option1 value'],
    ['Option2 Name', 'Option2 Value'], ['Option2 name', 'Option2 value'],
    ['Option3 Name', 'Option3 Value'], ['Option3 name', 'Option3 value'],
  ];
  const extra = new Set();
  for (const [nameCol, valueCol] of optionPairs) {
    const nameIdx = headers.indexOf(nameCol);
    if (nameIdx < 0) continue;
    // Check first non-empty row for the option name
    for (const row of rows) {
      const name = (row[nameIdx] || '').trim().toLowerCase();
      if (name && COLOR_KEYWORDS.some(k => name.includes(k))) {
        extra.add(valueCol);
        break;
      }
    }
  }
  return extra;
}

// Two signature sets: generic template vs real Shopify export
const SHOPIFY_SIGNATURE_TEMPLATE = ['URL handle', 'SKU', 'Fulfillment service', 'SEO title'];
const SHOPIFY_SIGNATURE_EXPORT = ['Handle', 'Variant SKU', 'Variant Inventory Policy', 'Variant Price'];

function isShopifyTemplate(headers) {
  const headerSet = new Set(headers);
  const matchesTemplate = SHOPIFY_SIGNATURE_TEMPLATE.every(col => headerSet.has(col));
  const matchesExport = SHOPIFY_SIGNATURE_EXPORT.every(col => headerSet.has(col));
  return matchesTemplate || matchesExport;
}

// ── DOM refs ───────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dropZone = $('dropZone');
const fileInput = $('fileInput');
const browseBtn = $('browseBtn');
const fileInfo = $('fileInfo');
const fileNameEl = $('fileName');
const fileSizeEl = $('fileSize');
const removeFileBtn = $('removeFile');

const stepUpload = $('step-upload');
const stepConfigure = $('step-configure');
const stepProgress = $('step-progress');
const stepResult = $('step-result');

const sourceLang = $('sourceLang');
const columnsGrid = $('columnsGrid');
const selectAllBtn = $('selectAll');
const deselectAllBtn = $('deselectAll');
const previewTable = $('previewTable');

const translateBtn = $('translateBtn');
const progressText = $('progressText');
const progressPct = $('progressPercent');
const progressFill = $('progressFill');
const progressDetail = $('progressDetail');

const resultStats = $('resultStats');
const resultTable = $('resultTable');
const comparisonTable = $('comparisonTable');
const downloadBtn = $('downloadBtn');
const startOverBtn = $('startOverBtn');

// ── File Upload ────────────────────────────────────────────
browseBtn.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', e => { if (e.target !== browseBtn) fileInput.click(); });

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.csv')) handleFile(file);
  else alert('Por favor sube un archivo .csv');
});

removeFileBtn.addEventListener('click', resetUpload);

function handleFile(file) {
  state.fileName = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    state.rawText = e.target.result;
    parseCSV(state.rawText);
    showFileInfo(file);
    showConfigStep();
  };
  reader.readAsText(file, 'UTF-8');
}

function showFileInfo(file) {
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  fileInfo.classList.remove('hidden');
  dropZone.classList.add('hidden');
}

function resetUpload() {
  fileInfo.classList.add('hidden');
  dropZone.classList.remove('hidden');
  fileInput.value = '';
  stepConfigure.classList.add('hidden');
  stepProgress.classList.add('hidden');
  stepResult.classList.add('hidden');
  state.rawText = '';
  state.headers = [];
  state.rows = [];
  state.selectedCols.clear();
  state.translatedRows = [];
}

// ── CSV Parsing ────────────────────────────────────────────
function parseCSV(text) {
  // RFC 4180-compliant parser: handles multi-line quoted fields, escaped quotes, etc.
  const rows = [];
  let current = '';
  let inQuotes = false;
  let row = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          // Escaped quote ""
          current += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        row.push(current);
        current = '';
        i++;
      } else if (ch === '\r') {
        // Handle \r\n or standalone \r
        row.push(current);
        current = '';
        rows.push(row);
        row = [];
        i++;
        if (i < text.length && text[i] === '\n') i++;
      } else if (ch === '\n') {
        row.push(current);
        current = '';
        rows.push(row);
        row = [];
        i++;
      } else {
        current += ch;
        i++;
      }
    }
  }

  // Push last field and row
  if (current || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  // Filter out empty rows
  const filtered = rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));

  if (filtered.length === 0) return;

  state.headers = filtered[0];
  state.rows = filtered.slice(1);

  // Ensure all rows have the same number of columns as headers
  const colCount = state.headers.length;
  state.rows = state.rows.map(r => {
    if (r.length < colCount) {
      // Pad with empty strings
      return [...r, ...new Array(colCount - r.length).fill('')];
    } else if (r.length > colCount) {
      // Trim excess
      return r.slice(0, colCount);
    }
    return r;
  });

  console.log(`CSV parsed: ${state.headers.length} columns, ${state.rows.length} rows`);
}

// ── Configure Step ─────────────────────────────────────────
function showConfigStep() {
  state.isShopify = isShopifyTemplate(state.headers);

  // Show or hide the Shopify info banner
  let banner = $('shopifyBanner');
  if (state.isShopify) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'shopifyBanner';
      banner.className = 'shopify-banner';
      banner.innerHTML = `
        <span class="shopify-icon">🛍️</span>
        <div>
          <strong>Plantilla de Shopify detectada</strong>
          <p>Solo se traducirán: <em>Title, Description, y nombres de opciones (Farbe→Color, Größe→Talla)</em>. Los valores y demás campos se mantienen intactos.</p>
        </div>
      `;
      stepConfigure.insertBefore(banner, stepConfigure.querySelector('.config-row'));
    }
  } else {
    if (banner) banner.remove();
  }

  stepConfigure.classList.remove('hidden');
  buildColumnsGrid();
  buildPreviewTable();
}

function buildColumnsGrid() {
  columnsGrid.innerHTML = '';
  state.selectedCols.clear();

  // Dynamically add color option value columns
  const colorCols = state.isShopify ? addColorOptionValues(state.headers, state.rows) : new Set();
  const allTranslatable = new Set([...SHOPIFY_TRANSLATABLE_COLS, ...colorCols]);

  state.headers.forEach((header, idx) => {
    const shouldTranslate = state.isShopify
      ? allTranslatable.has(header)              // Shopify: text + color fields
      : true;                                    // Generic: all columns by default

    const chip = document.createElement('label');
    chip.className = 'col-chip' + (shouldTranslate ? ' selected' : '');
    chip.dataset.idx = idx;

    // In Shopify mode, lock non-translatable columns visually
    const locked = state.isShopify && !allTranslatable.has(header);
    if (locked) chip.classList.add('locked');

    chip.innerHTML = `<input type="checkbox" ${shouldTranslate ? 'checked' : ''} /><span class="check">${shouldTranslate ? '✓' : ''}</span> ${escapeHtml(header)}`;

    if (!locked) {
      chip.addEventListener('click', () => toggleCol(chip, idx));
    }

    columnsGrid.appendChild(chip);
    if (shouldTranslate) state.selectedCols.add(idx);
  });
}

function toggleCol(chip, idx) {
  if (state.selectedCols.has(idx)) {
    state.selectedCols.delete(idx);
    chip.classList.remove('selected');
    chip.querySelector('.check').textContent = '';
  } else {
    state.selectedCols.add(idx);
    chip.classList.add('selected');
    chip.querySelector('.check').textContent = '✓';
  }
}

selectAllBtn.addEventListener('click', () => {
  document.querySelectorAll('.col-chip').forEach((chip, idx) => {
    state.selectedCols.add(idx);
    chip.classList.add('selected');
    chip.querySelector('.check').textContent = '✓';
  });
});

deselectAllBtn.addEventListener('click', () => {
  document.querySelectorAll('.col-chip').forEach(chip => {
    chip.classList.remove('selected');
    chip.querySelector('.check').textContent = '';
  });
  state.selectedCols.clear();
});

function buildPreviewTable() {
  const maxRows = 5;
  let html = '<thead><tr>';
  state.headers.forEach(h => { html += `<th>${escapeHtml(h)}</th>`; });
  html += '</tr></thead><tbody>';

  state.rows.slice(0, maxRows).forEach(row => {
    html += '<tr>';
    state.headers.forEach((_, i) => {
      html += `<td title="${escapeHtml(row[i] || '')}">${escapeHtml(row[i] || '')}</td>`;
    });
    html += '</tr>';
  });

  if (state.rows.length > maxRows) {
    html += `<tr><td colspan="${state.headers.length}" style="text-align:center;color:var(--text-muted);font-style:italic">... y ${state.rows.length - maxRows} filas más</td></tr>`;
  }
  html += '</tbody>';
  previewTable.innerHTML = html;
}

// ── Title Paraphrasing Engine ──────────────────────────────
const brandNameInput = document.getElementById('brandName');

// Spanish synonym dictionary for common product/fashion words
const SYNONYMS = {
  // Clothing types
  'polo': ['camiseta polo', 'polo deportivo', 'polo clásico', 'polo casual'],
  'camiseta': ['remera', 'playera', 'top', 'camiseta casual'],
  'camisa': ['blusa', 'camisa elegante', 'camisa de vestir'],
  'pantalón': ['pantalones', 'jeans', 'vaqueros'],
  'pantalones': ['pantalón', 'jeans', 'vaqueros'],
  'chaqueta': ['cazadora', 'chamarra', 'abrigo ligero', 'jacket'],
  'sudadera': ['hoodie', 'suéter', 'jersey'],
  'vestido': ['traje', 'atuendo', 'prenda elegante'],
  'zapatos': ['calzado', 'zapatillas'],
  'zapatillas': ['tenis', 'sneakers', 'zapatos deportivos'],

  // Descriptors
  'ultra': ['súper', 'extra', 'máxima', 'extremadamente'],
  'cómodo': ['confortable', 'suave al tacto', 'de gran comodidad', 'ergonómico'],
  'cómoda': ['confortable', 'suave', 'de gran comodidad'],
  'elegante': ['sofisticado', 'distinguido', 'refinado', 'con estilo'],
  'moderno': ['contemporáneo', 'actual', 'de última tendencia', 'vanguardista'],
  'moderna': ['contemporánea', 'actual', 'de última tendencia'],
  'clásico': ['atemporal', 'tradicional', 'de estilo eterno'],
  'clásica': ['atemporal', 'tradicional', 'de estilo eterno'],
  'premium': ['de alta gama', 'de lujo', 'de primera calidad', 'exclusivo'],
  'ligero': ['liviano', 'ultraligero', 'de peso pluma'],
  'ligera': ['liviana', 'ultraligera', 'de peso pluma'],
  'suave': ['aterciopelado', 'delicado', 'sedoso'],
  'casual': ['informal', 'desenfadado', 'relajado', 'de uso diario'],
  'deportivo': ['atlético', 'sport', 'para actividades'],
  'deportiva': ['atlética', 'sport', 'para actividades'],
  'resistente': ['duradero', 'robusto', 'de alta resistencia'],
  'ajustado': ['entallado', 'slim fit', 'de corte ceñido'],
  'ajustada': ['entallada', 'slim fit', 'de corte ceñido'],
  'transpirable': ['ventilado', 'de alta ventilación', 'fresh'],
  'increíble': ['asombroso', 'extraordinario', 'fantástico', 'impresionante'],

  // Target audience
  'hombre': ['caballero', 'él', 'hombre moderno'],
  'hombres': ['caballeros', 'ellos'],
  'mujer': ['dama', 'ella', 'mujer moderna'],
  'mujeres': ['damas', 'ellas'],
  'niño': ['chico', 'pequeño'],
  'niños': ['chicos', 'pequeños'],

  // Prepositions & connectors
  'para': ['ideal para', 'diseñado para', 'pensado para', 'perfecto para'],
};

// Sentence pattern variations for restructuring
const TITLE_PATTERNS = [
  (brand, desc) => `${brand} - ${desc}`,
  (brand, desc) => `${brand} | ${desc}`,
  (brand, desc) => `${desc} - ${brand}`,
  (brand, desc) => `${brand} - ${desc}`,
];

let patternIndex = 0;

function paraphraseText(text) {
  // Split into words, replace some with synonyms
  let result = text;
  const wordsToReplace = Object.keys(SYNONYMS).sort((a, b) => b.length - a.length);

  // Replace 2-3 words per title to make it different but natural
  let replacements = 0;
  for (const word of wordsToReplace) {
    if (replacements >= 3) break;
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    if (regex.test(result)) {
      const options = SYNONYMS[word];
      const replacement = options[Math.floor(Math.random() * options.length)];
      result = result.replace(regex, replacement);
      replacements++;
    }
  }

  return result;
}

// ── AI-Style Brand Name Generator ──────────────────────────
// Generates unique, premium-sounding brand names using syllable combinations
const BRAND_PREFIXES = [
  'Ve', 'Lu', 'Al', 'Ca', 'Do', 'Es', 'Fi', 'Ga', 'Ma', 'No',
  'Or', 'Pa', 'Ra', 'Sa', 'To', 'Va', 'Ze', 'Ar', 'Be', 'Cr',
  'De', 'El', 'Fo', 'Gi', 'Ha', 'In', 'La', 'Mi', 'Ni', 'Ro',
  'Se', 'Vi', 'Mo', 'Le', 'An', 'Ba', 'Co', 'Di', 'Fe', 'Ge',
];
const BRAND_MIDDLES = [
  'lan', 'ren', 'ros', 'vel', 'nar', 'ten', 'lor', 'ran', 'lin', 'ven',
  'lar', 'ron', 'san', 'tan', 'van', 'zel', 'ras', 'len', 'mon', 'ner',
  'ral', 'sel', 'tel', 'val', 'zen', 'ran', 'lon', 'men', 'nel', 'rel',
  'sol', 'tor', 'ver', 'zar', 'ber', 'der', 'fer', 'ger', 'ker', 'mer',
];
const BRAND_SUFFIXES = [
  'o', 'i', 'a', 'io', 'ia', 'ino', 'ello', 'ano', 'ero', 'ari',
  'ini', 'oni', 'osi', 'anti', 'enti', 'é', 'ier', 'ón', 'és',
  'otti', 'etti', 'ossi', 'elli', 'acci', 'ucci',
];

const usedBrandNames = new Set();

function generateBrandName() {
  let name;
  let attempts = 0;
  do {
    const pre = BRAND_PREFIXES[Math.floor(Math.random() * BRAND_PREFIXES.length)];
    const mid = BRAND_MIDDLES[Math.floor(Math.random() * BRAND_MIDDLES.length)];
    const suf = BRAND_SUFFIXES[Math.floor(Math.random() * BRAND_SUFFIXES.length)];
    name = pre + mid + suf;
    attempts++;
  } while (usedBrandNames.has(name) && attempts < 100);
  usedBrandNames.add(name);
  return name;
}

function enhanceTitle(translatedTitle) {
  // Detect what kind of product this is from the translated title
  const lower = translatedTitle.toLowerCase();

  // Detect garment type
  let garment = '';
  const GARMENT_KEYWORDS = [
    { keys: ['polo'], label: 'Polo' },
    { keys: ['camiseta', 'remera', 'playera', 't-shirt'], label: 'Camiseta' },
    { keys: ['camisa', 'shirt', 'blusa'], label: 'Camisa' },
    { keys: ['sudadera', 'hoodie', 'suéter', 'jersey'], label: 'Sudadera' },
    { keys: ['chaqueta', 'jacket', 'cazadora'], label: 'Chaqueta' },
    { keys: ['pantalón', 'pantalones', 'pants', 'jean'], label: 'Pantalón' },
    { keys: ['shorts', 'bermuda', 'corto'], label: 'Shorts' },
    { keys: ['vestido', 'dress'], label: 'Vestido' },
    { keys: ['falda', 'skirt'], label: 'Falda' },
    { keys: ['abrigo', 'coat'], label: 'Abrigo' },
    { keys: ['chaleco', 'vest'], label: 'Chaleco' },
    { keys: ['zapato', 'shoe', 'zapatilla', 'sneaker'], label: 'Zapatillas' },
    { keys: ['bolso', 'bag', 'mochila'], label: 'Bolso' },
    { keys: ['gorro', 'hat', 'gorra'], label: 'Gorro' },
    { keys: ['seguro', 'versicher', 'insurance', 'prioridad', 'versand'], label: '' },
  ];
  for (const g of GARMENT_KEYWORDS) {
    if (g.keys.some(k => lower.includes(k))) {
      garment = g.label;
      break;
    }
  }
  if (!garment) garment = 'Prenda';

  // Detect audience
  let audience = '';
  if (lower.includes('hombre') || lower.includes('caballero') || lower.includes('männer') || lower.includes('herren') || lower.includes(' men') || lower.includes(' him')) {
    audience = 'para Hombre';
  } else if (lower.includes('mujer') || lower.includes('dama') || lower.includes('frauen') || lower.includes('damen') || lower.includes('women') || lower.includes(' her')) {
    audience = 'para Mujer';
  } else if (lower.includes('niño') || lower.includes('kinder') || lower.includes('kids')) {
    audience = 'para Niño';
  } else if (lower.includes('unisex')) {
    audience = 'Unisex';
  }

  // Random Spanish adjectives for product names
  const ADJECTIVES = [
    'Elegante', 'Sofisticado', 'Clásico', 'Premium', 'Moderno',
    'Exclusivo', 'Esencial', 'Sublime', 'Refinado', 'Atemporal',
    'Versátil', 'Dinámico', 'Impecable', 'Distinguido', 'Audaz',
    'Contemporáneo', 'Icónico', 'Vanguardista', 'Minimalista', 'Urbano',
  ];

  // Random style/collection words
  const STYLES = [
    'Edición Selecta', 'Colección Esencia', 'Línea Signature', 'Serie Elite',
    'Corte Italiano', 'Diseño Continental', 'Estilo Mediterráneo', 'Acabado Fino',
    'Tejido Superior', 'Comfort Fit', 'Slim Fit', 'Toque Suave',
    'Alta Costura', 'Edición Limitada', 'Colección Cápsula', 'Línea Premium',
    'Detalle Artesanal', 'Fibra Natural', 'Textura Deluxe', 'Corte Perfecto',
  ];

  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const style = STYLES[Math.floor(Math.random() * STYLES.length)];

  // Generate brand
  const brand = generateBrandName();

  // Name patterns
  const PATTERNS = [
    () => `${brand} - ${garment} ${adj} ${audience}`.trim(),
    () => `${brand} | ${garment} ${style} ${audience}`.trim(),
    () => `${brand} - ${garment} ${adj} · ${style}`,
    () => `${brand} - ${adj} ${garment} ${audience}`.trim(),
  ];

  const pattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
  return pattern();
}

// ── Translation ────────────────────────────────────────────
translateBtn.addEventListener('click', startTranslation);

async function startTranslation() {
  if (state.selectedCols.size === 0) {
    alert('Selecciona al menos una columna para traducir.');
    return;
  }

  stepConfigure.classList.add('hidden');
  stepProgress.classList.remove('hidden');

  const lang = sourceLang.value;
  const langPair = lang === 'auto' ? 'auto|es' : `${lang}|es`;

  // Collect all unique texts to translate
  const textsToTranslate = [];
  const cellMap = []; // { rowIdx, colIdx, textIdx }

  state.rows.forEach((row, rowIdx) => {
    state.headers.forEach((_, colIdx) => {
      if (state.selectedCols.has(colIdx)) {
        const text = (row[colIdx] || '').trim();
        if (text) {
          textsToTranslate.push(text);
          cellMap.push({ rowIdx, colIdx, textIdx: textsToTranslate.length - 1 });
        }
      }
    });
  });

  // Deep clone rows
  state.translatedRows = state.rows.map(r => [...r]);

  const total = textsToTranslate.length;
  let done = 0;

  updateProgress(0, total, 'Iniciando traducción...');

  // Google Translate is fast — can handle larger batches with shorter delays
  const BATCH_SIZE = 5;
  const DELAY_MS = 200;

  // Find the Title column index for enhancement
  const titleIdx = state.headers.indexOf('Title');
  const handleIdx = state.headers.indexOf('Handle') >= 0
    ? state.headers.indexOf('Handle')
    : state.headers.indexOf('URL handle');
  const enhancedTitles = {}; // handle → enhanced title (so variants share the same title)
  usedBrandNames.clear(); // reset for each translation run

  for (let i = 0; i < textsToTranslate.length; i += BATCH_SIZE) {
    const batch = textsToTranslate.slice(i, i + BATCH_SIZE);
    const batchCells = cellMap.slice(i, i + BATCH_SIZE);

    const translations = await Promise.all(
      batch.map(text => translateText(text, langPair))
    );

    translations.forEach((translated, j) => {
      const { rowIdx, colIdx } = batchCells[j];

      // If this is a Title column, enhance it creatively
      if (colIdx === titleIdx && translated) {
        const handle = handleIdx >= 0 ? state.rows[rowIdx][handleIdx] : rowIdx;
        if (!enhancedTitles[handle]) {
          enhancedTitles[handle] = enhanceTitle(translated);
        }
        translated = enhancedTitles[handle];
      }

      state.translatedRows[rowIdx][colIdx] = translated;
      done++;
    });

    updateProgress(done, total, `Traduciendo celda ${done} de ${total}...`);

    if (i + BATCH_SIZE < textsToTranslate.length) {
      await sleep(DELAY_MS);
    }
  }

  showResult(total);
}

async function translateText(text, langPair, retries = 3) {
  if (!text || text.trim() === '') return text;

  // Skip purely numeric values
  if (/^\d+([.,]\d+)?$/.test(text.trim())) return text;

  // If text contains HTML tags, translate only the text parts
  if (/<[^>]+>/.test(text)) {
    return translateHTML(text, langPair, retries);
  }

  return translatePlainText(text, langPair, retries);
}

// Translate HTML content: preserve tags, translate only text between them
async function translateHTML(html, langPair, retries) {
  // Split into HTML tags and text segments
  // e.g. "<p>Hello</p>" → ["<p>", "Hello", "</p>"]
  const parts = html.split(/(<[^>]*>)/g);
  const result = [];

  for (const part of parts) {
    if (!part) continue;
    // If it's an HTML tag, keep it as-is
    if (/^<[^>]*>$/.test(part)) {
      result.push(part);
    } else if (part.trim() === '') {
      // Whitespace only, keep as-is
      result.push(part);
    } else {
      // It's text content — translate it
      const translated = await translatePlainText(part, langPair, retries);
      result.push(translated);
    }
  }

  return result.join('');
}

// Translate plain text (no HTML) via Google Translate with MyMemory fallback
async function translatePlainText(text, langPair, retries = 3) {
  if (!text || text.trim() === '') return text;
  if (/^\d+([.,]\d+)?$/.test(text.trim())) return text;

  const [sl, tl] = langPair.split('|');

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Primary: Google Translate (fast, no key needed)
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url);

      if (res.status === 429) {
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`Google rate limited. Waiting ${wait}ms...`);
        await sleep(wait);
        continue;
      }

      const data = await res.json();
      // Google returns [[['translated','original',...]], ...]
      if (data && data[0]) {
        const translated = data[0].map(seg => seg[0]).join('');
        if (translated) return translated;
      }
    } catch (err) {
      console.warn(`Google Translate attempt ${attempt + 1} failed:`, err);
    }

    // Fallback: MyMemory API
    try {
      const url2 = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`;
      const res2 = await fetch(url2);
      const data2 = await res2.json();
      if (data2.responseStatus === 200 && data2.responseData?.translatedText) {
        return data2.responseData.translatedText;
      }
    } catch (e) {
      console.warn('MyMemory fallback failed:', e);
    }

    if (attempt < retries - 1) await sleep(1000);
  }
  return text; // all retries exhausted, keep original
}

function updateProgress(done, total, message) {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  progressFill.style.width = pct + '%';
  progressPct.textContent = pct + '%';
  progressText.textContent = message;
  progressDetail.textContent = `${done} de ${total} celdas traducidas`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Result ─────────────────────────────────────────────────
function showResult(totalCells) {
  stepProgress.classList.add('hidden');
  stepResult.classList.remove('hidden');

  // Stats
  resultStats.innerHTML = `
    <div class="stat-chip">📊 <strong>${state.rows.length}</strong> filas</div>
    <div class="stat-chip">📋 <strong>${state.headers.length}</strong> columnas</div>
    <div class="stat-chip">✅ <strong>${totalCells}</strong> celdas traducidas</div>
    <div class="stat-chip">🌐 Idioma destino: <strong>Español</strong></div>
  `;

  buildResultTable(resultTable, state.translatedRows, false);
  buildResultTable(comparisonTable, state.translatedRows, true);
}

function buildResultTable(tableEl, rows, comparison) {
  let html = '<thead><tr>';
  if (comparison) {
    state.headers.forEach((h, i) => {
      if (state.selectedCols.has(i)) {
        html += `<th>${escapeHtml(h)} (original)</th><th>${escapeHtml(h)} (español)</th>`;
      } else {
        html += `<th>${escapeHtml(h)}</th>`;
      }
    });
  } else {
    state.headers.forEach(h => { html += `<th>${escapeHtml(h)}</th>`; });
  }
  html += '</tr></thead><tbody>';

  const maxRows = 50;
  rows.slice(0, maxRows).forEach((row, rowIdx) => {
    html += '<tr>';
    if (comparison) {
      state.headers.forEach((_, i) => {
        if (state.selectedCols.has(i)) {
          html += `<td class="original" title="${escapeHtml(state.rows[rowIdx][i] || '')}">${escapeHtml(state.rows[rowIdx][i] || '')}</td>`;
          html += `<td class="translated" title="${escapeHtml(row[i] || '')}">${escapeHtml(row[i] || '')}</td>`;
        } else {
          html += `<td title="${escapeHtml(row[i] || '')}">${escapeHtml(row[i] || '')}</td>`;
        }
      });
    } else {
      state.headers.forEach((_, i) => {
        const cls = state.selectedCols.has(i) ? ' class="translated"' : '';
        html += `<td${cls} title="${escapeHtml(row[i] || '')}">${escapeHtml(row[i] || '')}</td>`;
      });
    }
    html += '</tr>';
  });

  if (rows.length > maxRows) {
    const cols = comparison
      ? state.headers.reduce((acc, _, i) => acc + (state.selectedCols.has(i) ? 2 : 1), 0)
      : state.headers.length;
    html += `<tr><td colspan="${cols}" style="text-align:center;color:var(--text-muted);font-style:italic">... y ${rows.length - maxRows} filas más (todas incluidas en la descarga)</td></tr>`;
  }
  html += '</tbody>';
  tableEl.innerHTML = html;
}

// ── Tabs ───────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    tab.classList.add('active');
    $('tab-' + tab.dataset.tab).classList.remove('hidden');
  });
});

// ── Download ───────────────────────────────────────────────
// ── Smart Tag Generation ───────────────────────────────────
// Format: PRENDA GENERO (uppercase), e.g., POLO HOMBRE
const GARMENT_DETECT = [
  { keywords: ['polo'], label: 'POLO' },
  { keywords: ['camiseta', 'remera', 'playera', 't-shirt', 'tshirt'], label: 'CAMISETA' },
  { keywords: ['camisa', 'shirt', 'blusa'], label: 'CAMISA' },
  { keywords: ['sudadera', 'hoodie', 'suéter'], label: 'SUDADERA' },
  { keywords: ['chaqueta', 'jacket', 'cazadora', 'chamarra'], label: 'CHAQUETA' },
  { keywords: ['pantalón', 'pantalones', 'pants', 'jean', 'vaquero'], label: 'PANTALON' },
  { keywords: ['shorts', 'bermuda'], label: 'SHORTS' },
  { keywords: ['vestido', 'dress'], label: 'VESTIDO' },
  { keywords: ['falda', 'skirt'], label: 'FALDA' },
  { keywords: ['zapato', 'shoes', 'zapatilla', 'sneaker', 'tenis'], label: 'ZAPATOS' },
  { keywords: ['bolso', 'bag', 'mochila'], label: 'BOLSO' },
  { keywords: ['gorro', 'hat', 'sombrero', 'gorra'], label: 'GORRO' },
  { keywords: ['reloj', 'watch'], label: 'RELOJ' },
];

function generateTags(row, titleIdx, typeIdx, opt1NameIdx, opt2NameIdx) {
  const title = (titleIdx >= 0 ? row[titleIdx] || '' : '').toLowerCase();
  const type = (typeIdx >= 0 ? row[typeIdx] || '' : '').toLowerCase();
  const combined = title + ' ' + type;

  // Detect garment
  let garment = '';
  for (const g of GARMENT_DETECT) {
    if (g.keywords.some(k => combined.includes(k))) {
      garment = g.label;
      break;
    }
  }

  // Detect gender
  let gender = '';
  if (combined.includes('hombre') || combined.includes('caballero') || combined.includes('männer') || combined.includes('herren') || combined.includes('men')) {
    gender = 'HOMBRE';
  } else if (combined.includes('mujer') || combined.includes('dama') || combined.includes('frauen') || combined.includes('damen') || combined.includes('women')) {
    gender = 'MUJER';
  } else if (combined.includes('niño') || combined.includes('kinder') || combined.includes('kids')) {
    gender = 'NIÑO';
  } else if (combined.includes('unisex')) {
    gender = 'UNISEX';
  }

  // Combine: PRENDA GENERO
  if (garment && gender) return `${garment} ${gender}`;
  if (garment) return garment;
  if (gender) return gender;
  return '';
}

downloadBtn.addEventListener('click', downloadCSV);

function buildCSVContent() {
  // Force Vendor to "Rovelli Maison" and generate smart tags
  const vendorIdx = state.headers.indexOf('Vendor');
  const tagsIdx = state.headers.indexOf('Tags');
  const titleIdx = state.headers.indexOf('Title');
  const typeIdx = state.headers.indexOf('Type');
  const opt1NameIdx = state.headers.indexOf('Option1 Name') >= 0
    ? state.headers.indexOf('Option1 Name')
    : state.headers.indexOf('Option1 name');
  const opt2NameIdx = state.headers.indexOf('Option2 Name') >= 0
    ? state.headers.indexOf('Option2 Name')
    : state.headers.indexOf('Option2 name');

  const rows = state.translatedRows.map(row => {
    const r = [...row];
    if (vendorIdx >= 0) r[vendorIdx] = 'Rovelli Maison';

    // Generate relevant tags based on product data
    if (tagsIdx >= 0) {
      const tags = generateTags(r, titleIdx, typeIdx, opt1NameIdx, opt2NameIdx);
      r[tagsIdx] = tags;
    }
    return r;
  });

  // Output CSV with EXACT same headers as input — no renaming
  const lines = [state.headers, ...rows].map(row =>
    row.map(cell => {
      const s = String(cell ?? '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }).join(',')
  );
  return lines.join('\r\n');
}

function downloadCSV() {
  const csvContent = buildCSVContent();
  // Use ASCII-only suffix to avoid filename encoding issues on any OS/browser
  const baseName = state.fileName.replace(/\.csv$/i, '').replace(/[^a-zA-Z0-9_\-]/g, '_');
  const fileName = baseName + '_traducido.csv';
  const BOM = '\uFEFF'; // UTF-8 BOM so Excel opens accents correctly

  let downloaded = false;

  // Method 1: Blob + createObjectURL
  try {
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    downloaded = true;
  } catch (e) {
    console.warn('Blob download failed, trying data URI:', e);
  }

  // Method 2: data: URI fallback
  if (!downloaded) {
    try {
      const encoded = encodeURIComponent(BOM + csvContent);
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encoded;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      downloaded = true;
    } catch (e) {
      console.warn('data URI download failed:', e);
    }
  }

  // Always show the copy modal so the user can get the data regardless
  showCopyModal(csvContent, fileName);
}

// ── Copy Modal ─────────────────────────────────────────────
function showCopyModal(csvContent, fileName) {
  const modal = $('copyModal');
  const textarea = $('csvTextarea');
  textarea.value = csvContent;
  modal.classList.remove('hidden');
}

$('closeCopyModal').addEventListener('click', () => $('copyModal').classList.add('hidden'));
$('copyModal').addEventListener('click', e => { if (e.target === $('copyModal')) $('copyModal').classList.add('hidden'); });

$('copyClipboardBtn').addEventListener('click', () => {
  const textarea = $('csvTextarea');
  textarea.select();
  try {
    navigator.clipboard.writeText(textarea.value).then(() => {
      $('copyClipboardBtn').textContent = '✅ ¡Copiado!';
      setTimeout(() => { $('copyClipboardBtn').textContent = '📋 Copiar al portapapeles'; }, 2000);
    });
  } catch (e) {
    document.execCommand('copy');
    $('copyClipboardBtn').textContent = '✅ ¡Copiado!';
    setTimeout(() => { $('copyClipboardBtn').textContent = '📋 Copiar al portapapeles'; }, 2000);
  }
});

// ── Start Over ─────────────────────────────────────────────
startOverBtn.addEventListener('click', () => {
  stepResult.classList.add('hidden');
  resetUpload();
});

// ── Helpers ────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
