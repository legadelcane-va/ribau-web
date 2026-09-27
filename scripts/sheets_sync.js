// Keeps the website in sync with the Google Sheet. Runs every night and when started by hand
// (see .github/workflows/sheets_sync.yml):
// 1. adds the new answers of the "Nuovo prodotto" Google Form to the Prodotti sheet, with the next free ID
// 2. downloads their photos from Google Drive as public/images/products/{ID}_1.jpg, {ID}_2.jpg, ...
// 3. exports the Prodotti sheet to public/data/products.csv
// 4. writes the problems it finds (e.g. products without photos) in the Controlli sheet; a small
//    Apps Script in the spreadsheet emails them when they change (see scripts/controlli-email.gs)

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import sharp from 'sharp';

const PRODUCTS_SHEET = 'Prodotti';
const RESPONSES_SHEET = process.env.FORM_RESPONSES_SHEET || 'Risposte del modulo 1';
const CHECKS_SHEET = 'Controlli';
const ASSIGNED_ID_HEADER = 'ID assegnato';

const PHOTOS_DIR = path.join(process.cwd(), 'public', 'images', 'products');
const CSV_PATH = path.join(process.cwd(), 'public', 'data', 'products.csv');
// Photos from the form are saved at most this big: plenty for the zoom view, light for the repository
const PHOTO_MAX_SIDE = 2000;
const PHOTO_NAME = /^(.+?)(?:_(\d+))?\.(jpe?g|png)$/i;

export async function syncSheet({ sheets, drive, spreadsheetId, getAccessToken }) {
  const problems = [];
  const tabs = await getTabs(sheets, spreadsheetId);
  if (!tabs[PRODUCTS_SHEET]) throw new Error(`The spreadsheet has no "${PRODUCTS_SHEET}" sheet`);

  let products = await readSheet(sheets, spreadsheetId, PRODUCTS_SHEET, 'A:J');
  let formIds = [];
  if (tabs[RESPONSES_SHEET]) {
    const responses = await readSheet(sheets, spreadsheetId, RESPONSES_SHEET, 'A:Z');
    if (await importResponses({ sheets, spreadsheetId, tabs, products, responses, problems })) {
      products = await readSheet(sheets, spreadsheetId, PRODUCTS_SHEET, 'A:J');
    }
    await downloadMissingPhotos({ drive, products, responses, getAccessToken, problems });
    formIds = assignedIds(responses);
  } else {
    console.log(`No "${RESPONSES_SHEET}" sheet: no form answers to import`);
  }

  writeCsv(products);
  problems.push(...checkProducts(products, formIds));
  await writeChecks({ sheets, spreadsheetId, tabs, problems });
}

// Adds the form answers that have no ID yet to the Prodotti sheet, and writes the ID they got
// next to the answer (column "ID assegnato"). Returns how many were added.
async function importResponses({ sheets, spreadsheetId, tabs, products, responses, problems }) {
  const [header = [], ...answers] = responses;
  const col = {
    name: columnIndex(header, 'nome'),
    description: columnIndex(header, 'descrizione'),
    category: columnIndex(header, 'categoria'),
    price: columnIndex(header, 'prezzo'),
    id: columnIndex(header, ASSIGNED_ID_HEADER)
  };
  if (col.name === -1) {
    problems.push(`La scheda "${RESPONSES_SHEET}" non ha la colonna "Nome": risposte del modulo non importate`);
    return 0;
  }
  const idColumn = col.id !== -1 ? col.id : header.length;
  const answerText = (answer, column) => String(answer[column] ?? '').trim();

  // Next ID: one more than any ID ever used, also by sold products (their photos are still in the repository)
  const productIdColumn = columnIndex(products[0] || [], 'id');
  const usedIds = [
    ...products.slice(1).map(row => row[productIdColumn]),
    ...answers.map(answer => answer[idColumn]),
    ...fs.readdirSync(PHOTOS_DIR).map(file => file.match(PHOTO_NAME)?.[1])
  ].map(id => Number(String(id ?? '').trim())).filter(Number.isInteger);
  let nextId = Math.max(0, ...usedIds) + 1;

  const imports = [];
  answers.forEach((answer, i) => {
    if (answerText(answer, idColumn) || !answer.some(cell => String(cell).trim())) return;
    if (!answerText(answer, col.name)) {
      problems.push(`Risposta del modulo del ${answer[0] || '?'} senza nome: non importata`);
      return;
    }
    const id = String(nextId++).padStart(4, '0');
    imports.push({
      answer,
      rowIndex: i + 1,
      id,
      product: {
        id,
        nome: answerText(answer, col.name),
        descrizione: answerText(answer, col.description),
        categoria: answerText(answer, col.category),
        prezzo: parsePrice(answerText(answer, col.price)),
        disponibile: true,
        primopiano: false
      }
    });
  });
  if (imports.length === 0) return 0;

  const responsesTab = tabs[RESPONSES_SHEET];
  if (col.id === -1) {
    const requests = [];
    if (idColumn >= responsesTab.columnCount) {
      requests.push({ appendDimension: { sheetId: responsesTab.sheetId, dimension: 'COLUMNS', length: idColumn - responsesTab.columnCount + 1 } });
    }
    requests.push(updateCell(responsesTab.sheetId, 0, idColumn, ASSIGNED_ID_HEADER));
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    header[idColumn] = ASSIGNED_ID_HEADER;
  }

  // Each product and its ID next to the answer are written together, so an answer is never imported twice
  const productsTab = tabs[PRODUCTS_SHEET];
  const productHeader = (products[0] || []).map(cell => String(cell).trim().toLowerCase());
  const requestsFor = list => [
    {
      appendCells: {
        sheetId: productsTab.sheetId,
        ...(productsTab.tableId && { tableId: productsTab.tableId }),
        rows: list.map(({ product }) => ({ values: productHeader.map(name => cellValue(product[name] ?? '')) })),
        fields: 'userEnteredValue'
      }
    },
    ...list.map(({ rowIndex, id }) => updateCell(responsesTab.sheetId, rowIndex, idColumn, id))
  ];
  let imported = [];
  try {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: requestsFor(imports) } });
    imported = imports;
  } catch {
    // Something was refused (e.g. a value the sheet doesn't accept): add them one by one to find which
    for (const item of imports) {
      try {
        await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: requestsFor([item]) } });
        imported.push(item);
      } catch (error) {
        problems.push(`Risposta del modulo "${item.product.nome}" non importata: ${error.message}`);
      }
    }
  }
  for (const { answer, id, product } of imported) {
    answer[idColumn] = id;
    console.log(`✓ Added ${id} ${product.nome} from the form`);
  }
  return imported.length;
}

// Downloads the photos of the products added from the form that have no photos on the website yet
async function downloadMissingPhotos({ drive, products, responses, getAccessToken, problems }) {
  const [header = [], ...answers] = responses;
  const idColumn = columnIndex(header, ASSIGNED_ID_HEADER);
  const nameColumn = columnIndex(header, 'nome');
  const photoColumn = columnIndex(header, 'foto');
  if (idColumn === -1 || photoColumn === -1) return;

  const productIdColumn = columnIndex(products[0] || [], 'id');
  const productIds = new Set(products.slice(1).map(row => String(row[productIdColumn] ?? '').trim()));
  const photos = photosById();
  for (const answer of answers) {
    const id = String(answer[idColumn] ?? '').trim();
    // Skip products already with photos, and sold ones (removed from the Prodotti sheet)
    if (!id || !productIds.has(id) || photos.has(id)) continue;

    // Google Forms lists the uploaded files as links like https://drive.google.com/open?id=...
    const fileIds = [...String(answer[photoColumn] ?? '').matchAll(/(?:[?&]id=|\/d\/)([\w-]{10,})/g)].map(match => match[1]);
    for (const [i, fileId] of fileIds.entries()) {
      try {
        await savePhoto(drive, fileId, path.join(PHOTOS_DIR, `${id}_${i + 1}.jpg`), getAccessToken);
        console.log(`✓ Downloaded photo ${i + 1} of ${id}`);
      } catch (error) {
        problems.push(`${id} ${String(answer[nameColumn] ?? '').trim()}: foto ${i + 1} non scaricata (${error.message})`);
      }
    }
  }
}

async function savePhoto(drive, fileId, target, getAccessToken) {
  const { data: file } = await drive.files.get({ fileId, fields: 'name,thumbnailLink', supportsAllDrives: true });
  const { data } = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  let image;
  try {
    image = await resizePhoto(Buffer.from(data));
  } catch (error) {
    // Formats sharp can't read (e.g. HEIC photos from iPhones): use the JPEG preview Google Drive makes of every photo
    if (!file.thumbnailLink) throw new Error(`${file.name}: ${error.message}`);
    const preview = await fetch(file.thumbnailLink.replace(/=s\d+$/, `=s${PHOTO_MAX_SIDE}`), {
      headers: { Authorization: `Bearer ${await getAccessToken()}` }
    });
    if (!preview.ok) throw new Error(`${file.name}: ${error.message}`);
    image = await resizePhoto(Buffer.from(await preview.arrayBuffer()));
  }
  fs.writeFileSync(target, image);
}

function resizePhoto(image) {
  return sharp(image)
    .rotate() // apply the phone's orientation (EXIF), if any
    .resize({ width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

function writeCsv(rows) {
  const priceColumn = columnIndex(rows[0] || [], 'prezzo');
  const csv = rows.map(row =>
    row.map((cell, i) => {
      let value = String(cell ?? '').trim();
      // The website reads prices with a decimal point (12.50, not 12,50)
      if (i === priceColumn) value = value.replace(/[€\s]/g, '').replace(',', '.');
      // Quote values containing commas, quotes or line breaks, doubling the quotes inside
      return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    }).join(',')
  ).join('\n');

  fs.mkdirSync(path.dirname(CSV_PATH), { recursive: true });
  fs.writeFileSync(CSV_PATH, csv, 'utf8');
  console.log(`✓ Successfully synced ${rows.length - 1} products to CSV`);
}

// Returns the problems volunteers should fix in the Prodotti sheet.
// formIds: the IDs the form ever assigned, also of products sold since then.
function checkProducts(products, formIds) {
  const [header = [], ...rows] = products;
  const [idColumn, nameColumn, categoryColumn, priceColumn] = ['id', 'nome', 'categoria', 'prezzo'].map(name => columnIndex(header, name));
  const photos = photosById();
  const problems = [];
  const idCount = new Map();
  const productsByCategory = new Map();

  rows.forEach((row, i) => {
    const cell = column => String(row[column] ?? '').trim();
    if (!row.some(value => String(value).trim())) return;
    const id = cell(idColumn);
    const label = `${id || `Riga ${i + 2}`} ${cell(nameColumn)}`.trim();
    if (!id) {
      problems.push(`${label}: manca l'ID`);
      return;
    }
    idCount.set(id, (idCount.get(id) || 0) + 1);
    if (!cell(nameColumn)) problems.push(`${label}: manca il nome`);
    if (!cell(categoryColumn)) {
      problems.push(`${label}: manca la categoria`);
    } else {
      productsByCategory.set(cell(categoryColumn), [...(productsByCategory.get(cell(categoryColumn)) || []), label]);
    }
    if (!/^\d+([.,]\d+)?$/.test(cell(priceColumn).replace(/[€\s]/g, ''))) {
      problems.push(`${label}: prezzo mancante o non valido ("${cell(priceColumn)}")`);
    }
    if (!photos.has(id)) problems.push(`${label}: nessuna foto`);
  });

  for (const [id, count] of idCount) {
    if (count > 1) problems.push(`L'ID ${id} è usato da ${count} prodotti`);
  }
  // A category used by a single product is often a typo, and would get its own filter button on the website
  if (productsByCategory.size > 1) {
    for (const [category, labels] of productsByCategory) {
      if (labels.length === 1) problems.push(`${labels[0]}: la categoria "${category}" è usata solo da questo prodotto, è scritta giusta?`);
    }
  }
  // Photos with an ID higher than any product (also sold ones added from the form) were uploaded
  // for a product never added. Photos of lower IDs belong to sold products, removed from the sheet: that's normal.
  const highestId = Math.max(0, ...[...idCount.keys(), ...formIds].map(Number).filter(Number.isInteger));
  for (const [id, files] of photos) {
    if (Number(id) > highestId) problems.push(`Foto ${files.join(', ')} senza prodotto: nel foglio non c'è l'ID ${id}`);
  }
  return problems;
}

// Writes the problems in the Controlli sheet, keeping the email recipients written in B1
async function writeChecks({ sheets, spreadsheetId, tabs, problems }) {
  console.log(problems.length ? `⚠ ${problems.length} problems:\n  - ${problems.join('\n  - ')}` : '✓ No problems found');
  if (process.env.GITHUB_STEP_SUMMARY) {
    const list = problems.length ? problems.map(problem => `- ${problem}`).join('\n') : 'Nessun problema';
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Controlli\n\n${list}\n`);
  }

  try {
    if (!tabs[CHECKS_SHEET]) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title: CHECKS_SHEET } } }] } });
    }
    const [[recipients = ''] = []] = await readSheet(sheets, spreadsheetId, CHECKS_SHEET, 'B1');
    await sheets.spreadsheets.values.clear({ spreadsheetId, range: sheetRange(CHECKS_SHEET, 'A:Z') });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRange(CHECKS_SHEET, 'A1'),
      valueInputOption: 'RAW',
      requestBody: {
        values: [
          ['Destinatari email', recipients, 'Indirizzi separati da virgola. Se vuoto, l\'email arriva a questo account Google.'],
          ['Ultimo controllo', new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome' })],
          ['Problemi trovati', problems.length],
          [],
          ['Problemi da sistemare'],
          ...problems.map(problem => [problem])
        ]
      }
    });
  } catch (error) {
    // Fail the run, so GitHub emails about it: otherwise nobody would notice the sheet can't be updated
    throw new Error(`Could not write the "${CHECKS_SHEET}" sheet (does the service account have edit access to the spreadsheet?): ${error.message}`);
  }
}

async function getTabs(sheets, spreadsheetId) {
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties(columnCount)),tables(tableId,range))'
  });
  return Object.fromEntries(data.sheets.map(sheet => [sheet.properties.title, {
    sheetId: sheet.properties.sheetId,
    columnCount: sheet.properties.gridProperties?.columnCount ?? 26,
    // If the data is formatted as a table, new rows must be added to the table
    tableId: sheet.tables?.find(table => !table.range?.startColumnIndex)?.tableId
  }]));
}

async function readSheet(sheets, spreadsheetId, title, columns) {
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetRange(title, columns) });
  return data.values || [];
}

function sheetRange(title, cells) {
  return `'${title.replace(/'/g, "''")}'!${cells}`;
}

function columnIndex(header, name) {
  return header.findIndex(cell => String(cell).trim().toLowerCase().startsWith(name.toLowerCase()));
}

function assignedIds(responses) {
  const [header = [], ...answers] = responses;
  const idColumn = columnIndex(header, ASSIGNED_ID_HEADER);
  return idColumn === -1 ? [] : answers.map(answer => String(answer[idColumn] ?? '').trim()).filter(Boolean);
}

function photosById() {
  const photos = new Map();
  for (const file of fs.readdirSync(PHOTOS_DIR).sort()) {
    const id = file.match(PHOTO_NAME)?.[1];
    if (id) photos.set(id, [...(photos.get(id) || []), file]);
  }
  return photos;
}

function parsePrice(text) {
  const number = text.replace(/[€\s]/g, '').replace(',', '.');
  // Anything that isn't a number is kept as written, and reported by the checks
  return /^\d+(\.\d+)?$/.test(number) ? Number(number) : text;
}

function cellValue(value) {
  if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
  if (typeof value === 'number') return { userEnteredValue: { numberValue: value } };
  return { userEnteredValue: { stringValue: String(value) } };
}

function updateCell(sheetId, rowIndex, columnIndex, value) {
  return {
    updateCells: {
      start: { sheetId, rowIndex, columnIndex },
      rows: [{ values: [cellValue(value)] }],
      fields: 'userEnteredValue'
    }
  };
}

async function main() {
  // Parse service account credentials from environment variable
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly'
    ]
  });
  await syncSheet({
    sheets: google.sheets({ version: 'v4', auth }),
    drive: google.drive({ version: 'v3', auth }),
    spreadsheetId: process.env.GOOGLE_SHEETS_ID,
    getAccessToken: () => auth.getAccessToken()
  });
}

// Run directly with `node scripts/sheets_sync.js`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error('Error syncing sheets:', error);
    process.exit(1);
  });
}
