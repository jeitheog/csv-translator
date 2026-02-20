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
  user: null,      // { email, plan, usage, billingHistory: [], filesProcessed: 0 }
};

// ── Shopify Template Detection ─────────────────────────────
// Only these columns will be translated in a Shopify CSV.
// Supports BOTH the generic template format AND the real export format.
const SHOPIFY_TRANSLATABLE_COLS = new Set([
  'Title',
  'Description',        // generic template format
  'Body (HTML)',         // real export format
  'Body HTML',           // variation
  'Content',             // variation
  'Option1 name',       // generic template (names)
  'Option2 name',
  'Option3 name',
  'Option1 Name',       // real export (names)
  'Option2 Name',
  'Option3 Name',
  // Option Values are added dynamically — only for color options
]);

const SHOPIFY_CLEARED_COLS = new Set([
  'Type',
  'Collections',        // generic template
  'Tags',               // generic template
  'Collection',         // variation
  'Custom Product Type', // real export
  'Standard Product Type' // real export
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
const selectedCount = $('selectedCount');
const previewTable = $('previewTable');

const translateBtn = $('translateBtn');
const progressText = $('progressText');
const progressPct = $('progressPercent');
const progressFill = $('progressFill');
const progressDetail = $('progressDetail');

const resultStats = $('resultStats');
const resultTable = $('resultTable');
const comparisonTable = $('comparisonTable');

// ── Auth Refs ─────────────────────────────────────────────
const loginBtn = $('loginBtn');
const logoutBtn = $('logoutBtn');
const userProfile = $('userProfile');
const userEmailDisplay = $('userEmailDisplay');
const authModal = $('authModal');
const closeAuthModal = $('closeAuthModal');
const authForm = $('authForm');
const authEmail = $('authEmail');
const authPassword = $('authPassword');
const authSubmitBtn = $('authSubmitBtn');
const authError = $('authError');
const authTabs = document.querySelectorAll('.auth-tab');
const authWarning = $('authWarning');
const authWarningLink = $('authWarningLink');
const authWarningTitle = $('authWarningTitle');
const authWarningText = $('authWarningText');

const userPlanBadge = $('userPlanBadge');
const upgradeBtns = document.querySelectorAll('.upgrade-btn');

const translationEngine = $('translationEngine');
const engineHint = $('engineHint');
const claudeConfig = $('claudeConfig');
const claudeKey = $('claudeKey');

// ── Dashboard & Payment Refs ────────────────────────────────
const miCuentaBtn = $('miCuentaBtn');
const dashboardModal = $('dashboardModal');
const closeDashboardModal = $('closeDashboardModal');
const dashEmail = $('dashEmail');
const dashPlan = $('dashPlan');
const dashNavItems = document.querySelectorAll('.nav-item');
const dashViews = document.querySelectorAll('.dash-view');
const usageCount = $('usageCount');
const usageBarFill = $('usageBarFill');
const dashFilesCount = $('dashFilesCount');

const paymentModal = $('paymentModal');
const closePaymentModal = $('closePaymentModal');
const paymentForm = $('paymentForm');
const cardNumber = $('cardNumber');
const cardExpiry = $('cardExpiry');
const cardCvc = $('cardCvc');
const paymentError = $('paymentError');
const paymentBtnText = $('paymentBtnText');
const paymentSpinner = $('paymentSpinner');

const cancelSubBtn = $('cancelSubBtn');
const dashUpgradeBtn = $('dashUpgradeBtn');
const dashUpgradeContainer = $('dashUpgradeContainer');
const navAdmin = $('navAdmin');

// Admin Refs
const adminMRR = $('adminMRR');
const adminUserRatios = $('adminUserRatios');
const abuseAlerts = $('abuseAlerts');
const adminUserTable = $('adminUserTable');
const adminFailedPayments = $('adminFailedPayments');
const adminLogsTable = $('adminLogsTable');
const logFilter = $('logFilter');
const addFaqBtn = $('addFaqBtn');
const faqManagerList = $('faqManagerList');

// FAQ Modal Refs
const faqModal = $('faqModal');
const closeFaqModal = $('closeFaqModal');
const faqModalTitle = $('faqModalTitle');
const faqQuestionInput = $('faqQuestionInput');
const faqAnswerInput = $('faqAnswerInput');
const saveFaqBtn = $('saveFaqBtn');

let pendingPlanUpgrade = null;
let currentDashView = 'stats';

// ── Subscription Refs ──────────────────────────────────────
const pricingModal = $('pricingModal');
const closePricingModal = $('closePricingModal');

let currentAuthTab = 'login';
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

  // Calculate statistics
  const totalVariants = state.rows.length;
  let uniqueProducts = 0;

  const handleIdx = state.headers.indexOf('Handle');
  const titleIdx = state.headers.indexOf('Title');

  if (handleIdx >= 0) {
    const handles = new Set(state.rows.map(r => r[handleIdx]).filter(h => h && h.trim()));
    uniqueProducts = handles.size;
  } else if (titleIdx >= 0) {
    const titles = new Set(state.rows.map(r => r[titleIdx]).filter(t => t && t.trim()));
    uniqueProducts = titles.size;
  } else {
    uniqueProducts = totalVariants; // Fallback
  }

  // Update Stats UI
  const productEl = document.getElementById('countProducts');
  const variantEl = document.getElementById('countVariants');
  if (productEl) productEl.textContent = uniqueProducts;
  if (variantEl) variantEl.textContent = totalVariants;

  // Check limits
  checkUsageLimits(uniqueProducts);

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

    const shouldClearByDefault = state.isShopify && SHOPIFY_CLEARED_COLS.has(header);

    const chip = document.createElement('label');
    chip.className = 'col-chip';
    if (shouldTranslate && !shouldClearByDefault) chip.classList.add('selected');
    chip.dataset.idx = idx;

    // In Shopify mode, lock non-translatable columns visually (unless they are cleared columns)
    const locked = state.isShopify && !allTranslatable.has(header) && !shouldClearByDefault;
    if (locked) chip.classList.add('locked');

    let recommendTag = '';
    if (shouldTranslate && !shouldClearByDefault) {
      recommendTag = ' <small style="color:var(--accent);opacity:0.8;font-weight:600;">(recomendada)</small>';
    } else if (shouldClearByDefault) {
      recommendTag = ' <small style="color:#ef4444;opacity:0.9;font-weight:600;">(borrado recomendado)</small>';
    }

    const isChecked = shouldTranslate && !shouldClearByDefault;
    chip.innerHTML = `<input type="checkbox" ${isChecked ? 'checked' : ''} /><span class="check">${isChecked ? '✓' : ''}</span> ${escapeHtml(header)}${recommendTag}`;

    if (!locked) {
      chip.addEventListener('click', () => toggleCol(chip, idx));
    }

    columnsGrid.appendChild(chip);
    if (isChecked) state.selectedCols.add(idx);
  });

  updateSelectionCounter();
}

function updateSelectionCounter() {
  if (selectedCount) {
    const count = state.selectedCols.size;
    selectedCount.textContent = `${count} ${count === 1 ? 'seleccionada' : 'seleccionadas'}`;
  }
}

function toggleCol(chip, idx) {
  if (state.selectedCols.has(idx)) {
    state.selectedCols.delete(idx);
    chip.classList.remove('selected');
    chip.querySelector('.check').textContent = '';
    chip.querySelector('input').checked = false;
  } else {
    state.selectedCols.add(idx);
    chip.classList.add('selected');
    chip.querySelector('.check').textContent = '✓';
    chip.querySelector('input').checked = true;
  }
  updateSelectionCounter();
}

selectAllBtn.addEventListener('click', () => {
  document.querySelectorAll('.col-chip').forEach((chip) => {
    const idx = parseInt(chip.dataset.idx);
    state.selectedCols.add(idx);
    chip.classList.add('selected');
    chip.querySelector('.check').textContent = '✓';
    chip.querySelector('input').checked = true;
  });
  updateSelectionCounter();
});

deselectAllBtn.addEventListener('click', () => {
  document.querySelectorAll('.col-chip').forEach(chip => {
    chip.classList.remove('selected');
    chip.querySelector('.check').textContent = '';
    chip.querySelector('input').checked = false;
  });
  state.selectedCols.clear();
  updateSelectionCounter();
});


// ── Title Paraphrasing Engine ──────────────────────────────
const brandNameInput = document.getElementById('brandName');

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

// ── AI-Style Brand Name Generator ──────────────────────────
// Generates unique, premium-sounding brand names using syllable combinations

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
  if (!garment) garment = 'Producto';

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

  // Name patterns (Removed Brand name as per user request)
  const PATTERNS = [
    () => `${garment} ${adj} ${audience}`.trim(),
    () => `${garment} ${style} ${audience}`.trim(),
    () => `${garment} ${adj} · ${style}`,
    () => `${adj} ${garment} ${audience}`.trim(),
  ];

  const pattern = PATTERNS[Math.floor(Math.random() * PATTERNS.length)];
  return pattern();
}

// ── Translation ────────────────────────────────────────────
// ── Engine Selection ──────────────────────────────────────
translationEngine.onchange = () => {
  const isClaude = translationEngine.value === 'claude';
  claudeConfig.classList.toggle('hidden', !isClaude);
  engineHint.textContent = isClaude
    ? 'Claude 3.5 Sonnet ofrece traducciones perfectas que respetan el HTML y el tono de tu marca.'
    : 'Google es rápido pero Claude es mucho mejor con el código HTML y el sentido de las descripciones.';
};

// Auto-load Claude Key
if (localStorage.getItem('claude_api_key')) {
  claudeKey.value = localStorage.getItem('claude_api_key');
}
claudeKey.oninput = () => {
  localStorage.setItem('claude_api_key', claudeKey.value.trim());
};

translateBtn.addEventListener('click', startTranslation);

async function startTranslation() {
  if (state.selectedCols.size === 0) {
    alert('Selecciona al menos una columna para traducir.');
    return;
  }

  // ── Limit to 100 products per batch ──
  const MAX_PRODUCTS = 100;
  const totalRows = state.rows.length;
  const rowsToProcess = state.rows.slice(0, MAX_PRODUCTS);
  const skippedRows = totalRows > MAX_PRODUCTS ? totalRows - MAX_PRODUCTS : 0;

  if (skippedRows > 0) {
    const proceed = confirm(
      `⚠️ Tu archivo tiene ${totalRows} productos.\n\n` +
      `Para garantizar la calidad de las traducciones, se procesarán los primeros ${MAX_PRODUCTS} productos.\n\n` +
      `Los ${skippedRows} productos restantes se podrán traducir en otra ronda.\n\n` +
      `¿Continuar?`
    );
    if (!proceed) return;
  }

  stepConfigure.classList.add('hidden');
  stepProgress.classList.remove('hidden');

  // Show/reset verification panel
  const verifyPanel = $('verificationPanel');
  if (verifyPanel) {
    verifyPanel.classList.remove('hidden');
    $('verifySuccess').textContent = '0';
    $('verifyFailed').textContent = '0';
    $('verifyRetrying').textContent = '';
  }

  const lang = sourceLang.value;
  const langPair = lang === 'auto' ? 'auto|es' : `${lang}|es`;

  console.log(`🚀 Iniciando traducción con par: ${langPair}`);

  // Collect all texts to translate (only first MAX_PRODUCTS rows)
  const textsToTranslate = [];
  const cellMap = []; // { rowIdx, colIdx, textIdx }

  rowsToProcess.forEach((row, rowIdx) => {
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

  // Deep clone ALL rows (untouched rows beyond MAX_PRODUCTS keep original values)
  state.translatedRows = state.rows.map(r => [...r]);

  const total = textsToTranslate.length;
  let done = 0;
  let successCount = 0;
  let failedCells = []; // { idx, rowIdx, colIdx, originalText }

  updateProgress(0, total, 'Iniciando traducción...', 0, 0);

  const BATCH_SIZE = 5;
  const DELAY_MS = 250;

  // Find the Title column index for enhancement
  const titleIdx = state.headers.indexOf('Title');
  const handleIdx = state.headers.indexOf('Handle') >= 0
    ? state.headers.indexOf('Handle')
    : state.headers.indexOf('URL handle');
  const enhancedTitles = {};

  // Helper: check if text is "untranslatable" (number, URL, code, etc.)
  function isSkippable(text) {
    if (!text || text.trim() === '') return true;
    if (/^\d+([.,]\d+)?$/.test(text.trim())) return true;
    if (/^https?:\/\//i.test(text.trim())) return true;
    if (/^[A-Z0-9_-]+$/i.test(text.trim()) && text.trim().length < 30) return true; // SKUs, codes
    return false;
  }

  // ── Main translation pass ──
  for (let i = 0; i < textsToTranslate.length; i += BATCH_SIZE) {
    const batch = textsToTranslate.slice(i, i + BATCH_SIZE);
    const batchCells = cellMap.slice(i, i + BATCH_SIZE);

    const translations = await Promise.all(
      batch.map(text => translateText(text, langPair))
    );

    translations.forEach((translated, j) => {
      const { rowIdx, colIdx } = batchCells[j];
      const originalText = batch[j];

      // Verify: did translation actually change the text?
      const didTranslate = translated !== null && translated !== originalText;
      const skippable = isSkippable(originalText);

      if (translated === null) {
        // Explicit failure — keep original, mark for retry
        state.translatedRows[rowIdx][colIdx] = originalText;
        failedCells.push({ idx: i + j, rowIdx, colIdx, originalText });
      } else if (!didTranslate && !skippable && originalText.length > 3) {
        // Returned same text but it's not a code/number — suspect failure
        state.translatedRows[rowIdx][colIdx] = originalText;
        failedCells.push({ idx: i + j, rowIdx, colIdx, originalText });
      } else {
        // Success path — apply title enhancement if needed
        if (colIdx === titleIdx && translated) {
          const handle = handleIdx >= 0 ? state.rows[rowIdx][handleIdx] : rowIdx;
          if (!enhancedTitles[handle]) {
            enhancedTitles[handle] = enhanceTitle(translated);
          }
          translated = enhancedTitles[handle];
        }
        state.translatedRows[rowIdx][colIdx] = translated;
        successCount++;
      }
      done++;
    });

    updateProgress(done, total, `Traduciendo celda ${done} de ${total}...`, successCount, failedCells.length);

    if (i + BATCH_SIZE < textsToTranslate.length) {
      await sleep(DELAY_MS);
    }
  }

  // ── Retry pass for failed cells ──
  if (failedCells.length > 0) {
    if (verifyPanel) $('verifyRetrying').textContent = `🔄 Reintentando ${failedCells.length} celdas...`;
    updateProgress(done, total, `🔄 Reintentando ${failedCells.length} celdas fallidas...`, successCount, failedCells.length);

    await sleep(2000); // long pause before retry

    const retryResults = [];
    for (let k = 0; k < failedCells.length; k++) {
      const cell = failedCells[k];
      const retried = await translateText(cell.originalText, langPair);

      const didWork = retried !== null && retried !== cell.originalText;
      if (didWork) {
        let finalText = retried;
        // Apply title enhancement on retry too
        if (cell.colIdx === titleIdx && finalText) {
          const handle = handleIdx >= 0 ? state.rows[cell.rowIdx][handleIdx] : cell.rowIdx;
          if (!enhancedTitles[handle]) {
            enhancedTitles[handle] = enhanceTitle(finalText);
          }
          finalText = enhancedTitles[handle];
        }
        state.translatedRows[cell.rowIdx][cell.colIdx] = finalText;
        successCount++;
        retryResults.push(true);
      } else {
        retryResults.push(false);
      }

      updateProgress(done, total,
        `🔄 Reintento ${k + 1} de ${failedCells.length}...`,
        successCount, failedCells.length - retryResults.filter(r => r).length
      );

      await sleep(800); // slower retry pace
    }

    // Update failed count after retries
    const stillFailed = retryResults.filter(r => !r).length;
    failedCells = failedCells.filter((_, i) => !retryResults[i]);

    if (verifyPanel) {
      $('verifyRetrying').textContent = stillFailed > 0
        ? `⚠️ ${stillFailed} celdas no pudieron ser traducidas`
        : '✅ ¡Todos los reintentos exitosos!';
    }
  }

  // Final verification update
  const finalFailed = failedCells.length;
  updateProgress(total, total, '¡Traducción completada!', successCount, finalFailed);

  // Increment Usage Stats
  incrementUsage(rowsToProcess.length);

  showResult(total, successCount, finalFailed, skippedRows);
}

async function translateText(text, langPair, retries = 3) {
  if (!text || text.trim() === '') return text;

  // Skip purely numeric values
  if (/^\d+([.,]\d+)?$/.test(text.trim())) return text;

  // Skip URLs
  if (/^https?:\/\//i.test(text.trim())) return text;

  // If text contains HTML tags, translate only the text parts
  if (/<[^>]+>/.test(text)) {
    return translateHTML(text, langPair, retries);
  }

  const result = await translatePlainText(text, langPair, retries);
  return result; // null = failure, string = success
}

// Translate HTML content: preserve tags, translate only text between them
async function translateHTML(html, langPair, retries) {
  // Split into HTML tags and text segments
  const parts = html.split(/(<[^>]*>)/g);
  const textSegments = [];
  const textIndices = [];

  // Identify segments that need translation
  parts.forEach((part, idx) => {
    if (part && !/^<[^>]*>$/.test(part) && part.trim() !== '') {
      textSegments.push(part);
      textIndices.push(idx);
    }
  });

  if (textSegments.length === 0) return html;

  // Batch translate segments using a unique delimiter
  // We use characters that Google Translate usually preserves
  const delimiter = " [[[###]]] ";
  const fullText = textSegments.join(delimiter);
  const translatedBody = await translatePlainText(fullText, langPair, retries);

  // If translation failed entirely, return null to signal failure
  if (translatedBody === null) return null;

  // Split with regex to be flexible with spaces (Google might add/remove spaces around symbols)
  const translatedSegments = translatedBody.split(/\s*\[\[\[###\]\]\]\s*/).map(s => s.trim());

  // VERIFICATION: Did we get the same number of segments back?
  if (translatedSegments.length === textSegments.length) {
    textIndices.forEach((partIdx, i) => {
      parts[partIdx] = translatedSegments[i];
    });
    return parts.join('');
  } else {
    // FALLBACK: If batching failed (mangled delimiters), translate segments one by one
    console.warn(`HTML Batch mismatch (${translatedSegments.length} vs ${textSegments.length}). Falling back to individual segments.`);

    // We do this in parallel but with a slight delay between to avoid rate limiting
    const results = [];
    for (const seg of textSegments) {
      const trans = await translatePlainText(seg, langPair, retries);
      results.push(trans || seg); // fallback to original if individual fails
      await sleep(100);
    }

    textIndices.forEach((partIdx, i) => {
      parts[partIdx] = results[i];
    });
    return parts.join('');
  }
}

// Translate plain text via server-side proxy (/api/translate) with browser fallbacks
async function translatePlainText(text, langPair, retries = 3) {
  if (!text || text.trim() === '') return text;
  if (/^\d+([.,]\d+)?$/.test(text.trim())) return text;

  // For very long texts, chunk them to avoid request size limits
  const MAX_CHUNK = 1000;
  if (text.length > MAX_CHUNK) {
    const chunks = [];
    for (let i = 0; i < text.length; i += MAX_CHUNK) {
      chunks.push(text.substring(i, i + MAX_CHUNK));
    }
    const results = await Promise.all(chunks.map(c => translatePlainText(c, langPair, retries)));
    if (results.some(r => r === null)) return null;
    return results.join('');
  }

  const engine = translationEngine.value;
  if (engine === 'claude') {
    return translateClaude(text, langPair, retries);
  }

  const [sl, tl] = langPair.split('|');

  for (let attempt = 0; attempt < retries; attempt++) {
    // Primary: Google Translate (fast, no key needed)
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url);

      if (res.status === 429) {
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`Google rate limited. Waiting ${wait}ms...`);
        await sleep(wait);
        continue;
      }

      const data = await res.json();
      if (data && data[0]) {
        const translated = data[0].map(seg => seg[0]).join('');
        if (translated) return translated;
      }
    } catch (err) {
      console.warn(`Google Translate attempt ${attempt + 1} failed:`, err);
      logError(`Google Translate (${sl}|${tl})`, err.message || 'Error de red');
    }

    // Fallback: MyMemory API
    try {
      const url2 = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`;
      const res2 = await fetch(url2);
      const data2 = await res2.json();
      if (data2.responseStatus === 200 && data2.responseData?.translatedText) {
        return data2.responseData.translatedText;
      } else if (data2.responseStatus !== 200) {
        logError('MyMemory API', data2.responseDetails || 'Error desconocido');
      }
    } catch (e) {
      console.warn('MyMemory fallback failed:', e);
      logError('MyMemory Fallback', e.message || 'Error de conexión');
    }

    if (attempt < retries - 1) await sleep(1000);
  }
  return null; // all retries exhausted, signal failure
}

/**
 * Premium Translation using Claude 3.5 Sonnet via Vercel Proxy
 */
async function translateClaude(text, langPair, retries = 2) {
  const key = claudeKey.value.trim();
  if (!key) {
    alert('Por favor, introduce tu Anthropic API Key para usar Claude.');
    translationEngine.value = 'google';
    translationEngine.dispatchEvent(new Event('change'));
    return null;
  }

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key
        },
        body: JSON.stringify({
          text: text,
          langPair: langPair,
          model: 'claude-3-5-sonnet-20240620'
        })
      });

      const data = await res.json();
      if (res.ok && data.translated) {
        return data.translated;
      } else {
        throw new Error(data.error || 'Error desconocido en Claude');
      }
    } catch (err) {
      console.warn(`Claude attempt ${attempt + 1} failed:`, err);
      logError('Claude Premium API', err.message);
      if (attempt < retries - 1) await sleep(1500);
    }
  }
  return null;
}


function updateProgress(done, total, message, successCount, failedCount) {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  progressFill.style.width = pct + '%';
  progressPct.textContent = pct + '%';
  progressText.textContent = message;
  progressDetail.textContent = `${done} de ${total} celdas traducidas`;

  // Update verification panel
  const verifyPanel = $('verificationPanel');
  if (verifyPanel && successCount !== undefined) {
    $('verifySuccess').textContent = successCount;
    $('verifyFailed').textContent = failedCount || 0;
    // Color the failed count red if > 0
    const failedEl = $('verifyFailed');
    if (failedEl) failedEl.style.color = failedCount > 0 ? '#ff4d4d' : '#4ade80';
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Result ─────────────────────────────────────────────────
function showResult(totalCells, successCount, failedCount, skippedRows) {
  stepProgress.classList.add('hidden');
  stepResult.classList.remove('hidden');

  // Stats with verification info
  let statsHTML = `
    <div class="stat-chip">📊 <strong>${state.rows.length}</strong> filas totales</div>
    <div class="stat-chip">📋 <strong>${state.headers.length}</strong> columnas</div>
    <div class="stat-chip">✅ <strong>${successCount || totalCells}</strong> celdas traducidas</div>
    <div class="stat-chip">🌐 Idioma destino: <strong>Español</strong></div>
  `;

  if (failedCount > 0) {
    statsHTML += `<div class="stat-chip" style="background:rgba(255,77,77,0.15);border-color:#ff4d4d;">⚠️ <strong>${failedCount}</strong> celdas sin traducir</div>`;
  }

  if (skippedRows > 0) {
    statsHTML += `<div class="stat-chip" style="background:rgba(255,165,0,0.15);border-color:#ffa500;">⏭️ <strong>${skippedRows}</strong> productos pendientes (lote siguiente)</div>`;
  }

  resultStats.innerHTML = statsHTML;

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

function updateAuthUI() {
  if (state.user) {
    loginBtn.classList.add('hidden');
    userProfile.classList.remove('hidden');
    userEmailDisplay.textContent = state.user.email;

    // Update Plan Badge
    const plan = state.user.plan;
    userPlanBadge.textContent = plan === 'unlimited' ? 'Admin Ilimitado' : plan === 'pro' ? 'Plan Pro' : plan === 'business' ? 'Business' : 'Gratis';
    userPlanBadge.className = 'plan-badge ' + (plan || 'free');
  } else {
    loginBtn.classList.remove('hidden');
    userProfile.classList.add('hidden');
    userEmailDisplay.textContent = '';
  }

  // Re-check limits for current state if we are in config step
  if (!stepConfigure.classList.contains('hidden')) {
    showConfigStep();
  }
}

function checkUsageLimits(uniqueProducts) {
  const plan = state.user?.plan || 'free';
  if (plan === 'unlimited') {
    translateBtn.disabled = false;
    authWarning.classList.add('hidden');
    return;
  }
  const limits = { free: 10, pro: 1000, business: 6000 };
  const currentLimit = limits[plan];

  if (uniqueProducts > currentLimit) {
    translateBtn.disabled = true;
    authWarning.classList.remove('hidden');

    if (plan === 'free') {
      if (!state.user) {
        authWarningTitle.textContent = 'Límite de 10 productos superado';
        authWarningText.innerHTML = 'Para traducir archivos de este tamaño necesitas estar registrado. <a href="#" id="authWarningLink">Inicia sesión aquí</a> o <a href="#" id="seePricingLink">ver planes de pago</a>.';
        $('authWarningLink').onclick = (e) => { e.preventDefault(); loginBtn.click(); };
        $('seePricingLink').onclick = (e) => { e.preventDefault(); pricingModal.classList.remove('hidden'); };
      } else {
        authWarningTitle.textContent = 'Límite de Plan Gratis superado';
        authWarningText.innerHTML = 'Tu plan actual tiene un límite de 10 productos. <a href="#" id="upgradeLink">Sube a Pro para traducir hasta 1.000 productos</a>.';
        $('upgradeLink').onclick = (e) => { e.preventDefault(); pricingModal.classList.remove('hidden'); };
      }
    } else {
      authWarningTitle.textContent = `Límite de Plan ${plan.toUpperCase()} superado`;
      authWarningText.innerHTML = `Este archivo tiene ${uniqueProducts} productos, superando tu límite de ${currentLimit}. <a href="#" id="upgradeLink">Contacta con soporte para ampliar</a>.`;
      $('upgradeLink').onclick = (e) => { e.preventDefault(); alert('Contactando con soporte...'); };
    }
  } else {
    translateBtn.disabled = false;
    authWarning.classList.add('hidden');
  }
}

// ── Usage Tracking ─────────────────────────────────────────
function incrementUsage(count) {
  if (state.user) {
    state.user.usage = (state.user.usage || 0) + count;
    state.user.filesProcessed = (state.user.filesProcessed || 0) + 1;
    saveUserState();
    updateAuthUI();
  }
}

function saveUserState() {
  if (state.user) {
    localStorage.setItem('csv_translator_user', JSON.stringify(state.user));
  }
}

// Las credenciales de admin se verifican en el servidor (/api/auth/login).



// Restore Dashboard Handlers
miCuentaBtn.onclick = () => {
  if (!state.user) return;
  updateDashboardUI();
  dashboardModal.classList.remove('hidden');
};

closeDashboardModal.onclick = () => dashboardModal.classList.add('hidden');

dashNavItems.forEach(item => {
  item.onclick = () => {
    currentDashView = item.dataset.view;
    updateDashboardUI();
  };
});

function updateDashboardUI() {
  if (!state.user) return;

  dashEmail.textContent = state.user.email;
  const plan = state.user.plan;
  const planName = plan === 'unlimited' ? 'Admin Ilimitado' : plan === 'pro' ? 'Plan Pro' : plan === 'business' ? 'Business' : 'Gratis';
  dashPlan.textContent = planName;
  dashPlan.className = 'badge-sub ' + (plan || 'free');

  // Navigation
  dashNavItems.forEach(i => i.classList.toggle('active', i.dataset.view === currentDashView));
  dashViews.forEach(v => v.classList.toggle('hidden', v.id !== `dashView-${currentDashView}`));

  // Stats
  const currentPlan = state.user.plan || 'free';
  const limits = { free: 10, pro: 1000, business: 6000, unlimited: Infinity };
  const max = limits[currentPlan];
  const current = state.user.usage || 0;

  if (plan === 'unlimited') {
    usageCount.textContent = `${current.toLocaleString()} / ∞`;
    usageBarFill.style.width = '0%'; // Or 100% depending on preference, Infinity is tricky
  } else {
    usageCount.textContent = `${current.toLocaleString()} / ${max.toLocaleString()}`;
    const pct = Math.min(100, (current / max) * 100);
    usageBarFill.style.width = pct + '%';
  }
  dashFilesCount.textContent = state.user.filesProcessed || 0;

  // Show/Hide Upgrade/Cancel buttons based on plan
  if (state.user.plan === 'business') {
    dashUpgradeContainer.classList.add('hidden');
    dashUpgradeBtn.classList.add('hidden');
    cancelSubBtn.classList.remove('hidden');
  } else if (state.user.plan === 'pro') {
    dashUpgradeContainer.classList.remove('hidden');
    dashUpgradeBtn.classList.remove('hidden');
    cancelSubBtn.classList.remove('hidden');
  } else {
    // Free
    dashUpgradeContainer.classList.remove('hidden');
    dashUpgradeBtn.classList.remove('hidden');
    cancelSubBtn.classList.add('hidden');
  }

  // Show/Hide Admin Tab
  if (state.user.role === 'admin') {
    navAdmin.classList.remove('hidden');
    if (currentDashView === 'admin') updateAdminDash();
  } else {
    navAdmin.classList.add('hidden');
    if (currentDashView === 'admin') currentDashView = 'stats';
  }

  // Billing History
  const historyBody = document.querySelector('#billingHistory tbody');
  if (historyBody) {
    historyBody.innerHTML = (state.user.billingHistory || []).map(h => `
      <tr>
        <td>${h.date}</td>
        <td>Suscripción ${h.plan}</td>
        <td><span class="badge-sub" style="background:#059669;color:white;padding:2px 8px;border-radius:10px">Pagado</span></td>
        <td>${h.amount}</td>
      </tr>
    `).join('') || '<tr><td colspan="4" class="center muted">Sin transacciones</td></tr>';
  }
}

// ── Payment Logic (Mock Stripe) ──────────────────────────────
function handleUpgrade(plan) {
  if (!state.user) {
    alert('Por favor, inicia sesión para suscribirte.');
    pricingModal.classList.add('hidden');
    loginBtn.click();
    return;
  }
  pendingPlanUpgrade = plan;
  pricingModal.classList.add('hidden');
  paymentModal.classList.remove('hidden');
}

closePaymentModal.onclick = () => paymentModal.classList.add('hidden');

// Card Formatting
cardNumber.oninput = (e) => {
  let v = e.target.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
  let parts = [];
  for (let i = 0, len = v.length; i < len; i += 4) {
    parts.push(v.substring(i, i + 4));
  }
  if (parts.length) e.target.value = parts.join(' ');
};

cardExpiry.oninput = (e) => {
  let v = e.target.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
  if (v.length >= 2) e.target.value = v.substring(0, 2) + '/' + v.substring(2, 4);
};

paymentForm.onsubmit = async (e) => {
  e.preventDefault();
  paymentError.classList.add('hidden');
  paymentBtnText.classList.add('hidden');
  paymentSpinner.classList.remove('hidden');

  // Simulate Network Delay (Stripe-like)
  await new Promise(r => setTimeout(r, 2000));

  const plan = pendingPlanUpgrade;
  const prices = { pro: '$29,99', business: '$99,99' };

  // Success
  state.user.plan = plan;
  state.user.billingHistory = state.user.billingHistory || [];
  state.user.billingHistory.unshift({
    date: new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }),
    plan: plan.toUpperCase(),
    amount: prices[plan]
  });

  saveUserState();
  updateAuthUI();

  paymentSpinner.classList.add('hidden');
  paymentBtnText.classList.remove('hidden');
  paymentModal.classList.add('hidden');
  alert(`¡Pago exitoso! Bienvenido al Plan ${plan.toUpperCase()}`);
};

// ── Auth Logic ─────────────────────────────────────────────
function initAuth() {
  const savedUser = localStorage.getItem('csv_translator_user');
  if (!savedUser) return;

  state.user = JSON.parse(savedUser);
  updateAuthUI();

  // Si es admin, verificar que la sesión del servidor sigue vigente
  if (state.user?.role === 'admin') {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      state.user = null;
      localStorage.removeItem('csv_translator_user');
      updateAuthUI();
      return;
    }
    fetch('/api/auth/verify', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        if (!data.success) {
          state.user = null;
          localStorage.removeItem('csv_translator_user');
          localStorage.removeItem('auth_token');
          updateAuthUI();
        }
      })
      .catch(() => { /* servidor no disponible, mantener sesión local */ });
  }
}

loginBtn.onclick = () => {
  currentAuthTab = 'login';
  updateAuthModalUI();
  authModal.classList.remove('hidden');
};

if (authWarningLink) {
  authWarningLink.onclick = (e) => {
    e.preventDefault();
    loginBtn.click();
  };
}

closeAuthModal.onclick = () => authModal.classList.add('hidden');

authTabs.forEach(tab => {
  tab.onclick = () => {
    currentAuthTab = tab.dataset.tab;
    updateAuthModalUI();
  };
});

function updateAuthModalUI() {
  authTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === currentAuthTab));
  authSubmitBtn.textContent = currentAuthTab === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta';
  authError.classList.add('hidden');
}

authForm.onsubmit = async (e) => {
  e.preventDefault();
  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (password.length < 6) {
    authError.textContent = 'La contraseña debe tener al menos 6 caracteres';
    authError.classList.remove('hidden');
    return;
  }

  authSubmitBtn.disabled = true;
  authError.classList.add('hidden');

  try {
    // Verificar credenciales contra el servidor (admin)
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (data.success) {
      // Admin autenticado por el servidor
      localStorage.setItem('auth_token', data.token);
      state.user = {
        ...data.user,
        regDate: new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }),
      };
    } else if (res.status === 401) {
      // No es admin — usuario normal (mock)
      const existingUser = JSON.parse(localStorage.getItem('csv_translator_user'));
      const plan = currentAuthTab === 'login' ? (existingUser?.plan || 'free') : 'free';
      state.user = {
        email,
        plan,
        role: 'user',
        usage: existingUser?.usage || 0,
        filesProcessed: existingUser?.filesProcessed || 0,
        billingHistory: existingUser?.billingHistory || [],
        regDate: existingUser?.regDate || new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }),
      };
    } else {
      authError.textContent = data.error || 'Error del servidor';
      authError.classList.remove('hidden');
      return;
    }
  } catch {
    // Servidor no disponible — solo permite usuarios normales (mock)
    const existingUser = JSON.parse(localStorage.getItem('csv_translator_user'));
    const plan = currentAuthTab === 'login' ? (existingUser?.plan || 'free') : 'free';
    state.user = {
      email,
      plan,
      role: 'user',
      usage: existingUser?.usage || 0,
      filesProcessed: existingUser?.filesProcessed || 0,
      billingHistory: existingUser?.billingHistory || [],
      regDate: existingUser?.regDate || new Date().toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }),
    };
  } finally {
    authSubmitBtn.disabled = false;
  }

  // Añadir a allUsers para la vista del admin
  const allUsers = JSON.parse(localStorage.getItem('allUsers') || '[]');
  if (!allUsers.find(u => u.email === email)) {
    allUsers.push(state.user);
    localStorage.setItem('allUsers', JSON.stringify(allUsers));
  }

  saveUserState();
  updateAuthUI();
  authModal.classList.add('hidden');
  authForm.reset();
};

logoutBtn.onclick = async () => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
    } catch { /* ignorar si el servidor no está disponible */ }
    localStorage.removeItem('auth_token');
  }
  state.user = null;
  localStorage.removeItem('csv_translator_user');
  updateAuthUI();
};

// Initialize
initAuth();

// ── Subscription Logic ──────────────────────────────────────
upgradeBtns.forEach(btn => {
  btn.onclick = () => {
    const plan = btn.dataset.plan;
    handleUpgrade(plan);
  };
});

dashUpgradeBtn.onclick = () => {
  dashboardModal.classList.add('hidden');
  pricingModal.classList.remove('hidden');
};

cancelSubBtn.onclick = () => {
  if (confirm('¿Estás seguro de que quieres cancelar tu suscripción? Volverás al Plan Gratis.')) {
    state.user.plan = 'free';
    saveUserState();
    updateAuthUI();
    updateDashboardUI();
    alert('Tu suscripción ha sido cancelada.');
  }
};

closePricingModal.onclick = () => pricingModal.classList.add('hidden');

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
    if (vendorIdx >= 0) r[vendorIdx] = brandNameInput.value || 'Rovelli Maison';

    // Clear metadata columns if they are not selected
    state.headers.forEach((h, i) => {
      if (SHOPIFY_CLEARED_COLS.has(h) && !state.selectedCols.has(i)) {
        r[i] = '';
      }
    });

    // Generate relevant tags based on product data (only if Tags column is active)
    if (tagsIdx >= 0 && state.selectedCols.has(tagsIdx)) {
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
// ── Admin Logic ───────────────────────────────────────────

window.banUser = (email) => {
  const allUsers = JSON.parse(localStorage.getItem('allUsers') || '[]');
  const user = allUsers.find(u => u.email === email);
  if (user) {
    user.status = 'banned';
    localStorage.setItem('allUsers', JSON.stringify(allUsers));
    updateAdminDash();
  }
};

window.activateUser = (email) => {
  const allUsers = JSON.parse(localStorage.getItem('allUsers') || '[]');
  const user = allUsers.find(u => u.email === email);
  if (user) {
    user.status = 'active';
    localStorage.setItem('allUsers', JSON.stringify(allUsers));
    updateAdminDash();
  }
};

function seedUsers() {
  if (localStorage.getItem('allUsers')) return;
  const mockUsers = [
    { email: 'admin@example.com', role: 'admin', plan: 'business', status: 'active', regDate: '01 Ene, 2026', name: 'Jefe Admin' },
    { email: 'user1@test.com', role: 'user', plan: 'pro', status: 'active', regDate: '10 Feb, 2026', name: 'Alfonso Pérez', usage: 950 },
    { email: 'user2@test.com', role: 'user', plan: 'free', status: 'banned', regDate: '12 Feb, 2026', name: 'Banned Guy' },
    { email: 'scammer@test.com', role: 'user', plan: 'business', status: 'active', regDate: '15 Feb, 2026', name: 'Multi IP User', ips: ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'] },
  ];
  localStorage.setItem('allUsers', JSON.stringify(mockUsers));
}

seedUsers();
updateAdminDash();
renderFaqManager();

// ── Admin Dash Expansion ──────────────────────────────────
function updateAdminDash() {
  const allUsers = JSON.parse(localStorage.getItem('allUsers') || '[]');

  // Stats calculation
  let mrr = 0;
  let proCount = 0;
  let bizCount = 0;
  let freeCount = 0;

  allUsers.forEach(u => {
    if (u.plan === 'pro') { mrr += 29.99; proCount++; }
    else if (u.plan === 'business') { mrr += 99.99; bizCount++; }
    else { freeCount++; }
  });

  adminMRR.textContent = `$${mrr.toFixed(2)}`;
  adminUserRatios.textContent = `${proCount} Pro / ${bizCount} Biz`;

  // User Table
  const userBody = adminUserTable.querySelector('tbody');
  userBody.innerHTML = allUsers.map(u => `
    <tr>
      <td>
        <div class="user-info">
          <strong>${u.email}</strong>
          <span class="xsmall muted">${u.name || 'Sin nombre'}</span>
        </div>
      </td>
      <td><span class="badge-role ${u.role}">${u.role}</span></td>
      <td>${u.regDate || 'N/A'}</td>
      <td><span class="badge-status ${u.status === 'banned' ? 'banned' : 'active'}">${u.status === 'banned' ? 'Baneado' : 'Activo'}</span></td>
      <td>
        ${u.status === 'banned'
      ? `<button class="btn-text" onclick="activateUser('${u.email}')">Reactivar</button>`
      : `<button class="btn-text danger" onclick="banUser('${u.email}')">Banear</button>`}
      </td>
    </tr>
  `).join('');

  // Abuse Detection
  const alerts = [];
  allUsers.forEach(u => {
    if (u.usage > 900) {
      alerts.push({ type: 'Uso Crítico', user: u.email, detail: 'Consumo superior al 90% del límite mensual.' });
    }
    if (u.ips && u.ips.length > 3) {
      alerts.push({ type: 'Multi-IP', user: u.email, detail: `Inicios de sesión desde ${u.ips.length} direcciones distintas.` });
    }
  });

  abuseAlerts.innerHTML = alerts.map(a => `
    <div class="abuse-card">
      <div class="abuse-icon">⚠️</div>
      <div class="abuse-content">
        <h4>${a.type}: ${a.user}</h4>
        <p>${a.detail}</p>
      </div>
    </div>
  `).join('') || '<p class="muted center">No hay alertas activas</p>';

  // Mock Failed Payments
  const failedBody = adminFailedPayments.querySelector('tbody');
  failedBody.innerHTML = `
    <tr><td>20 Feb, 10:45</td><td>john@doe.com</td><td>Fondos insuficientes</td></tr>
    <tr><td>19 Feb, 14:20</td><td>jane@test.nl</td><td>Tarjeta expirada</td></tr>
  `;

  // Update Logs
  updateLogsTable();
}

/**
 * Centered error logger for the whole application.
 * Persists errors in localStorage for Admin view.
 */
function logError(url, errorMsg) {
  const logs = JSON.parse(localStorage.getItem('system_logs') || '[]');
  const now = new Date();
  const newLog = {
    time: now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
    url: url,
    error: errorMsg,
    user: state.user?.email || 'Huésped',
    timestamp: now.getTime()
  };

  // Keep only the last 50 logs
  logs.unshift(newLog);
  if (logs.length > 50) logs.pop();

  localStorage.setItem('system_logs', JSON.stringify(logs));

  // If we are currently in the Admin view, refresh it
  if (currentDashView === 'admin') updateLogsTable();
}

function updateLogsTable() {
  const filter = logFilter.value;
  let logs = JSON.parse(localStorage.getItem('system_logs') || '[]');

  // If empty, show some initial mock help if it's the first time
  if (logs.length === 0) {
    logs = [
      { time: '12:45', url: '/api/translate', error: 'Ejemplo: Error de red', user: 'admin@example.com', timestamp: Date.now() - 15 * 60000 }
    ];
  }

  if (filter === '1h') {
    logs = logs.filter(l => l.timestamp > Date.now() - 3600000);
  } else if (filter === '24h') {
    logs = logs.filter(l => l.timestamp > Date.now() - 86400000);
  }

  const logBody = adminLogsTable.querySelector('tbody');
  logBody.innerHTML = logs.map(l => `
    <tr>
      <td>${l.time}</td>
      <td><code class="xsmall">${l.url}</code></td>
      <td><span class="danger">${l.error}</span></td>
      <td>${l.user}</td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="center muted">Sin errores en este periodo</td></tr>';
}

logFilter.onchange = updateLogsTable;

// ── FAQ Manager ───────────────────────────────────────────
let editingFaqId = null;

function renderFaqManager() {
  const faqs = JSON.parse(localStorage.getItem('faqs') || '[]');
  if (faqs.length === 0 && !localStorage.getItem('faqs')) {
    // Default FAQs
    const defaults = [
      { id: Date.now(), q: '¿Es seguro subir mis archivos?', a: 'Sí, los archivos se procesan en el navegador o se eliminan tras la traducción.' },
      { id: Date.now() + 1, q: '¿Qué formatos soportan?', a: 'Soportamos archivos CSV estándar y exportaciones de Shopify.' }
    ];
    localStorage.setItem('faqs', JSON.stringify(defaults));
    return renderFaqManager();
  }

  faqManagerList.innerHTML = faqs.map(f => `
    <div class="faq-manager-item">
      <h4>
        ${f.q}
        <div class="faq-actions">
          <button class="btn-text btn-sm" onclick="editFaq(${f.id})">Editar</button>
          <button class="btn-text danger btn-sm" onclick="deleteFaq(${f.id})">Borrar</button>
        </div>
      </h4>
      <p>${f.a}</p>
    </div>
  `).join('') || '<p class="muted center">No hay preguntas configuradas</p>';
}

window.editFaq = (id) => {
  const faqs = JSON.parse(localStorage.getItem('faqs') || '[]');
  const faq = faqs.find(f => f.id === id);
  if (faq) {
    editingFaqId = id;
    faqModalTitle.textContent = 'Editar Pregunta';
    faqQuestionInput.value = faq.q;
    faqAnswerInput.value = faq.a;
    faqModal.classList.remove('hidden');
  }
};

window.deleteFaq = (id) => {
  if (confirm('¿Borrar esta pregunta?')) {
    let faqs = JSON.parse(localStorage.getItem('faqs') || '[]');
    faqs = faqs.filter(f => f.id !== id);
    localStorage.setItem('faqs', JSON.stringify(faqs));
    renderFaqManager();
  }
};

addFaqBtn.onclick = () => {
  editingFaqId = null;
  faqModalTitle.textContent = 'Nueva Pregunta';
  faqQuestionInput.value = '';
  faqAnswerInput.value = '';
  faqModal.classList.remove('hidden');
};

closeFaqModal.onclick = () => faqModal.classList.add('hidden');

saveFaqBtn.onclick = () => {
  const q = faqQuestionInput.value.trim();
  const a = faqAnswerInput.value.trim();
  if (!q || !a) return alert('Rellena todos los campos');

  let faqs = JSON.parse(localStorage.getItem('faqs') || '[]');
  if (editingFaqId) {
    const f = faqs.find(item => item.id === editingFaqId);
    if (f) { f.q = q; f.a = a; }
  } else {
    faqs.push({ id: Date.now(), q, a });
  }

  localStorage.setItem('faqs', JSON.stringify(faqs));
  faqModal.classList.add('hidden');
  renderFaqManager();
};
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
