#!/usr/bin/env python3
"""
Translate a Shopify CSV from German to Spanish.
Only translates: Title, Body (HTML), Option1/2/3 Value
Preserves HTML tags in Body (HTML).
"""

import csv
import re
import sys
import time
import urllib.parse
import urllib.request
import json

INPUT_FILE  = '/Users/jeisonlebron/.gemini/antigravity/scratch/csv-translator/wearbreeze_products.csv'
OUTPUT_FILE = '/Users/jeisonlebron/.gemini/antigravity/scratch/csv-translator/wearbreeze_translated.csv'

# Columns to translate: Title, Description, and Option NAMES (not values)
TRANSLATE_COLS = {'Title', 'Body (HTML)', 'Option1 Name', 'Option2 Name', 'Option3 Name'}

SRC_LANG = 'de'
TGT_LANG = 'es'


def translate_text(text):
    """Translate plain text using Google Translate API."""
    if not text or not text.strip():
        return text
    # Skip purely numeric
    if re.match(r'^\d+([.,]\d+)?$', text.strip()):
        return text

    url = f'https://translate.googleapis.com/translate_a/single?client=gtx&sl={SRC_LANG}&tl={TGT_LANG}&dt=t&q={urllib.parse.quote(text)}'

    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                if data and data[0]:
                    result = ''.join(seg[0] for seg in data[0] if seg[0])
                    return result
        except Exception as e:
            print(f'  ⚠ Retry {attempt+1}: {e}')
            time.sleep(1 * (attempt + 1))

    return text  # fallback: return original


def translate_html(html):
    """Translate HTML: preserve tags, translate only text content."""
    parts = re.split(r'(<[^>]*>)', html)
    result = []
    for part in parts:
        if not part:
            continue
        if re.match(r'^<[^>]*>$', part):
            # HTML tag — keep as-is
            result.append(part)
        elif not part.strip():
            # Whitespace only
            result.append(part)
        else:
            # Text content — translate it
            translated = translate_text(part)
            result.append(translated)
    return ''.join(result)


def main():
    print(f'📄 Reading: {INPUT_FILE}')
    with open(INPUT_FILE, 'r', encoding='utf-8-sig') as f:
        reader = csv.reader(f)
        headers = next(reader)
        rows = list(reader)

    print(f'   {len(rows)} rows, {len(headers)} columns')

    # Find column indices to translate
    col_indices = {}
    for i, h in enumerate(headers):
        if h in TRANSLATE_COLS:
            col_indices[i] = h
    print(f'   Columns to translate: {list(col_indices.values())}')

    # Translate
    total_cells = 0
    for row_idx, row in enumerate(rows):
        for col_idx, col_name in col_indices.items():
            if col_idx < len(row) and row[col_idx].strip():
                original = row[col_idx]

                if col_name == 'Body (HTML)' and '<' in original:
                    translated = translate_html(original)
                else:
                    translated = translate_text(original)

                row[col_idx] = translated
                total_cells += 1

        pct = (row_idx + 1) / len(rows) * 100
        print(f'   ✅ Row {row_idx+1}/{len(rows)} ({pct:.0f}%)')
        time.sleep(0.3)  # Rate limit protection

    print(f'\n🎯 Translated {total_cells} cells')
    print(f'💾 Writing: {OUTPUT_FILE}')

    with open(OUTPUT_FILE, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)

    print(f'✅ Done! File saved to: {OUTPUT_FILE}')


if __name__ == '__main__':
    main()
