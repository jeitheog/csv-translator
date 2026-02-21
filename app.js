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
  'Body HTML',           // variation
  'Content',             // variation
  'Product Description', // variant
  'Long Description',    // variant
  'Image Alt Text',     // image descriptions
  'SEO Title',          // SEO title
  'SEO Description',    // SEO description
  'Option1 name',       // generic template (names)
  'Option2 name',
  'Option3 name',
  'Option1 Name',       // real export (names)
  'Option2 Name',
  'Option3 Name',
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

const downloadBtn = $('downloadBtn');
const startOverBtn = $('startOverBtn');

// ── Shopify Scraper refs ────────────────────────────────────
const shopifyImportUrl = $('shopifyImportUrl');
const importFromUrlBtn = $('importFromUrlBtn');
const importStatus = $('importStatus');
const stepSelect = $('step-select');
const productsGrid = $('productsGrid');
const continueWithSelected = $('continueWithSelected');
const selectProductCountEl = $('selectProductCount');
const productSearchInput = $('productSearchInput');
const selectAllProductsBtn = $('selectAllProducts');
const deselectAllProductsBtn = $('deselectAllProducts');
const backToUploadBtn = $('backToUpload');

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
  stepSelect.classList.add('hidden');
  stepConfigure.classList.add('hidden');
  stepProgress.classList.add('hidden');
  stepResult.classList.add('hidden');
  importStatus.classList.add('hidden');
  importFromUrlBtn.disabled = false;
  state.rawText = '';
  state.headers = [];
  state.rows = [];
  state.selectedCols.clear();
  state.translatedRows = [];
  state.scrapedProducts = [];
}

// ── Shopify URL Importer ────────────────────────────────────
importFromUrlBtn.addEventListener('click', async () => {
  const url = shopifyImportUrl.value.trim();
  if (!url) return;

  importFromUrlBtn.disabled = true;
  importStatus.textContent = '⏳ Conectando con la tienda...';
  importStatus.classList.remove('hidden');

  try {
    const res = await fetch('/api/scraper', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    let data;
    try { data = await res.json(); } catch { throw new Error(`Error del servidor (${res.status}). Verifica que la URL sea una tienda Shopify válida.`); }
    if (!res.ok) throw new Error(data.error || 'Error desconocido');

    if (!data.products || data.products.length === 0) {
      importStatus.textContent = '⚠️ No se encontraron productos en esa tienda.';
      importFromUrlBtn.disabled = false;
      return;
    }

    importStatus.textContent = `✅ ${data.total} productos encontrados`;
    state.scrapedProducts = data.products;
    showProductSelect(data.products);
  } catch (err) {
    importStatus.textContent = `❌ ${err.message}`;
    importFromUrlBtn.disabled = false;
  }
});

function showProductSelect(products) {
  stepUpload.classList.add('hidden');
  stepSelect.classList.remove('hidden');
  stepConfigure.classList.add('hidden');

  productsGrid.innerHTML = '';
  productSearchInput.value = '';
  const selected = new Set(products.map((_, i) => i));

  function updateCount() {
    selectProductCountEl.textContent = `${selected.size} seleccionados`;
    continueWithSelected.disabled = selected.size === 0;
  }

  products.forEach((p, i) => {
    const img = (p.images && p.images[0]) ? p.images[0].src : '';
    const price = p.variants && p.variants[0] ? `€${p.variants[0].price}` : '';
    const card = document.createElement('div');
    card.className = 'product-card selected';
    card.dataset.index = i;
    card.dataset.title = p.title.toLowerCase();
    card.innerHTML = `
      <input type="checkbox" checked />
      ${img ? `<img src="${img}" alt="${p.title}" loading="lazy" />` : '<div style="width:100%;aspect-ratio:1;background:rgba(255,255,255,0.08);border-radius:8px;"></div>'}
      <p class="product-title">${p.title}</p>
      <p class="product-price">${price}</p>
    `;
    card.addEventListener('click', () => {
      const cb = card.querySelector('input[type="checkbox"]');
      if (selected.has(i)) {
        selected.delete(i);
        card.classList.remove('selected');
        cb.checked = false;
      } else {
        selected.add(i);
        card.classList.add('selected');
        cb.checked = true;
      }
      updateCount();
    });
    productsGrid.appendChild(card);
  });

  updateCount();

  // ── Search filter ──
  productSearchInput.oninput = () => {
    const q = productSearchInput.value.trim().toLowerCase();
    productsGrid.querySelectorAll('.product-card').forEach(c => {
      c.style.display = (!q || c.dataset.title.includes(q)) ? '' : 'none';
    });
  };

  // ── Select / deselect only visible cards ──
  selectAllProductsBtn.onclick = () => {
    productsGrid.querySelectorAll('.product-card').forEach(c => {
      if (c.style.display === 'none') return;
      const idx = parseInt(c.dataset.index);
      selected.add(idx);
      c.classList.add('selected');
      c.querySelector('input').checked = true;
    });
    updateCount();
  };

  deselectAllProductsBtn.onclick = () => {
    productsGrid.querySelectorAll('.product-card').forEach(c => {
      if (c.style.display === 'none') return;
      const idx = parseInt(c.dataset.index);
      selected.delete(idx);
      c.classList.remove('selected');
      c.querySelector('input').checked = false;
    });
    updateCount();
  };

  backToUploadBtn.onclick = () => {
    stepSelect.classList.add('hidden');
    stepUpload.classList.remove('hidden');
    importFromUrlBtn.disabled = false;
  };

  continueWithSelected.onclick = () => {
    const selectedProducts = products.filter((_, i) => selected.has(i));
    const csvText = productsToCSV(selectedProducts);
    state.fileName = `${shopifyImportUrl.value.trim().replace(/https?:\/\//, '')}-productos.csv`;
    parseCSV(csvText);
    stepSelect.classList.add('hidden');
    showConfigStep();
  };
}

function productsToCSV(products) {
  const headers = [
    'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Tags', 'Published',
    'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
    'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Qty',
    'Variant Inventory Policy', 'Variant Fulfillment Service', 'Variant Price',
    'Variant Compare At Price', 'Variant Requires Shipping', 'Variant Taxable', 'Variant Barcode',
    'Image Src', 'Image Alt Text', 'Gift Card', 'SEO Title', 'SEO Description', 'Variant Weight Unit',
  ];

  const escapeCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const rows = [headers.map(escapeCell).join(',')];

  for (const p of products) {
    const variants = p.variants || [];
    const options = p.options || [];
    const images = p.images || [];
    const tags = Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags || '');
    const firstImg = images[0] || {};

    variants.forEach((v, i) => {
      const isFirst = i === 0;
      rows.push([
        p.handle,
        isFirst ? p.title : '',
        isFirst ? (p.body_html || '') : '',
        isFirst ? (p.vendor || '') : '',
        isFirst ? (p.product_type || '') : '',
        isFirst ? tags : '',
        isFirst ? (p.published_at ? 'true' : 'false') : '',
        isFirst ? (options[0] ? options[0].name : '') : '',
        v.option1 || '',
        isFirst ? (options[1] ? options[1].name : '') : '',
        v.option2 || '',
        isFirst ? (options[2] ? options[2].name : '') : '',
        v.option3 || '',
        v.sku || '',
        v.grams || '',
        v.inventory_management || '',
        v.inventory_quantity ?? '',
        v.inventory_policy || 'deny',
        v.fulfillment_service || 'manual',
        v.price || '',
        v.compare_at_price || '',
        v.requires_shipping ?? '',
        v.taxable ?? '',
        v.barcode || '',
        isFirst ? (firstImg.src || '') : '',
        isFirst ? (firstImg.alt || '') : '',
        'false',
        isFirst ? (p.title || '') : '',
        '',
        v.weight_unit || 'kg',
      ].map(escapeCell).join(','));
    });

    // Add one image-only row per extra image (Shopify CSV format for multiple images)
    for (const img of images.slice(1)) {
      if (!img.src) continue;
      rows.push(headers.map(h => {
        if (h === 'Handle') return escapeCell(p.handle);
        if (h === 'Image Src') return escapeCell(img.src);
        if (h === 'Image Alt Text') return escapeCell(img.alt || '');
        return '""';
      }).join(','));
    }
  }

  return rows.join('\n');
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

  // Case-insensitive check for Shopify translatable columns
  const normalizedTranslatable = new Set(Array.from(SHOPIFY_TRANSLATABLE_COLS).map(c => c.toLowerCase()));
  const normalizedColorCols = new Set(Array.from(colorCols).map(c => c.toLowerCase()));

  state.headers.forEach((header, idx) => {
    const hLower = header.toLowerCase();
    const shouldTranslate = state.isShopify
      ? (normalizedTranslatable.has(hLower) || normalizedColorCols.has(hLower)) // Shopify: text + color fields
      : true;                                    // Generic: all columns by default

    const shouldClearByDefault = state.isShopify && SHOPIFY_CLEARED_COLS.has(header);

    const chip = document.createElement('label');
    chip.className = 'col-chip';
    if (shouldTranslate && !shouldClearByDefault) chip.classList.add('selected');
    chip.dataset.idx = idx;

    // In Shopify mode, lock non-translatable columns visually (unless they are cleared columns)
    const locked = state.isShopify && !SHOPIFY_TRANSLATABLE_COLS.has(header) && !shouldClearByDefault;
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

translateBtn.addEventListener('click', startTranslation);

async function startTranslation() {
  if (state.selectedCols.size === 0) {
    alert('Selecciona al menos una columna para traducir.');
    return;
  }

  const rowsToProcess = state.rows;
  const skippedRows = 0;

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
        console.warn('MyMemory API error:', data2.responseDetails);
      }
    } catch (e) {
      console.warn('MyMemory fallback failed:', e);
    }

    if (attempt < retries - 1) await sleep(1000);
  }
  return null; // all retries exhausted, signal failure
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

  // Shopify requires these exact values on variant rows only
  const invPolicyIdx = state.headers.indexOf('Variant Inventory Policy');
  const fulfillIdx   = state.headers.indexOf('Variant Fulfillment Service');
  const priceIdx     = state.headers.indexOf('Variant Price');

  const VALID_INV_POLICIES = new Set(['deny', 'continue']);

  const rows = state.translatedRows.map(row => {
    const r = [...row];

    // Image-only rows have no Variant Price — skip variant enforcement on them
    const isVariantRow = priceIdx < 0 || (r[priceIdx] || '').trim() !== '';

    if (vendorIdx >= 0 && isVariantRow) r[vendorIdx] = brandNameInput.value || 'Rovelli Maison';

    // Ensure Shopify-required fields always have valid values (variant rows only)
    if (isVariantRow) {
      if (invPolicyIdx >= 0 && !VALID_INV_POLICIES.has((r[invPolicyIdx] || '').trim().toLowerCase())) {
        r[invPolicyIdx] = 'deny';
      }
      if (fulfillIdx >= 0 && !(r[fulfillIdx] || '').trim()) {
        r[fulfillIdx] = 'manual';
      }
    }

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
