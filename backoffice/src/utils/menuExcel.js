import ExcelJS from 'exceljs';

const LOCATION_SEP = /\s*→\s*/;

function cellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object' && value.text != null) return String(value.text).trim();
  if (typeof value === 'object' && Array.isArray(value.richText)) {
    return value.richText.map((p) => p.text || '').join('').trim();
  }
  return String(value).trim();
}

function parsePrice(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = cellText(value).replace(/\s/g, '').replace(',', '.');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function splitLocation(location) {
  if (!location) return [];
  return location
    .split(LOCATION_SEP)
    .map((s) => s.trim())
    .filter(Boolean);
}

function leafCategory(location) {
  const parts = splitLocation(location);
  return parts.length ? parts[parts.length - 1] : null;
}

function normalizeHeader(value) {
  return cellText(value).toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Находит строку заголовков QuickResto / нашего экспорта.
 * Возвращает { headerRow, cols } где cols — индексы колонок (1-based для exceljs).
 */
function findHeader(worksheet) {
  const maxScan = Math.min(worksheet.rowCount || 30, 40);
  for (let r = 1; r <= maxScan; r += 1) {
    const row = worksheet.getRow(r);
    const byName = {};
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const h = normalizeHeader(cell.value);
      if (!h) return;
      byName[h] = colNumber;
    });

    const nameCol =
      byName['наименование'] ||
      byName['название'] ||
      byName['name'];
    if (!nameCol) continue;

    const priceCol =
      byName['базовая цена, руб.'] ||
      byName['базовая цена'] ||
      byName['цена'] ||
      byName['price'];
    const categoryCol =
      byName['категория'] ||
      byName['category'];
    const locationCol =
      byName['расположение'] ||
      byName['location'];
    const activeCol =
      byName['активна'] ||
      byName['active'] ||
      byName['is_active'];

    return {
      headerRow: r,
      cols: {
        name: nameCol,
        price: priceCol || null,
        category: categoryCol || null,
        location: locationCol || null,
        active: activeCol || null,
      },
    };
  }
  return null;
}

/**
 * Разбирает Excel-буфер в плоский список категорий и позиций.
 * Поддерживает:
 * 1) экспорт QuickResto (Наименование / Базовая цена / Расположение)
 * 2) наш простой экспорт (Категория / Наименование / Цена / Активна)
 *
 * @returns {{ categories: string[], items: Array<{ name: string, price: number, category: string|null, isActive: boolean }> }}
 */
export async function parseMenuExcel(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('В файле нет ни одного листа');
  }

  const header = findHeader(worksheet);
  if (!header) {
    throw new Error('Не найдена строка заголовков (нужна колонка «Наименование»)');
  }

  const { headerRow, cols } = header;
  const categoryOrder = [];
  const categorySeen = new Set();
  const items = [];

  function rememberCategory(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (categorySeen.has(key)) return;
    categorySeen.add(key);
    categoryOrder.push(trimmed);
  }

  for (let r = headerRow + 1; r <= worksheet.rowCount; r += 1) {
    const row = worksheet.getRow(r);
    const name = cellText(row.getCell(cols.name).value);
    const price = cols.price ? parsePrice(row.getCell(cols.price).value) : null;
    const location = cols.location ? cellText(row.getCell(cols.location).value) : '';
    const explicitCategory = cols.category ? cellText(row.getCell(cols.category).value) : '';

    if (!name && !explicitCategory && !location) continue;

    // Строка-категория: нет цены (QuickResto-заголовок или пустая категория нашего экспорта)
    if (price == null) {
      if (name) rememberCategory(name);
      if (explicitCategory) rememberCategory(explicitCategory);
      for (const part of splitLocation(location)) rememberCategory(part);
      continue;
    }

    if (!name) continue;

    let category = null;
    if (explicitCategory) {
      category = explicitCategory;
    } else if (location) {
      category = leafCategory(location);
      for (const part of splitLocation(location)) rememberCategory(part);
    }

    if (category) rememberCategory(category);

    let isActive = true;
    if (cols.active) {
      const raw = cellText(row.getCell(cols.active).value).toLowerCase();
      if (raw === 'нет' || raw === 'no' || raw === '0' || raw === 'false' || raw === 'отключена') {
        isActive = false;
      }
    }

    // QuickResto: «Скрыто на терминалах» — Да значит неактивна; у нас отдельной колонки нет в findHeader,
    // оставляем isActive=true по умолчанию (скрытость на терминалах QR ≠ наш is_active).

    items.push({
      name,
      price,
      category,
      isActive,
    });
  }

  return { categories: categoryOrder, items };
}

/**
 * Собирает простой Excel для скачивания из текущего каталога.
 * @param {Array<{ name: string }>} categories
 * @param {Array<{ name: string, price: number|string, is_active: boolean, category_id: number|null }>} items
 */
export async function buildMenuExportWorkbook(categories, items) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Imperial MC';
  const sheet = workbook.addWorksheet('Меню');

  sheet.columns = [
    { header: 'Категория', key: 'category', width: 28 },
    { header: 'Наименование', key: 'name', width: 40 },
    { header: 'Цена', key: 'price', width: 12 },
    { header: 'Активна', key: 'active', width: 12 },
  ];

  const categoryById = new Map(categories.map((c) => [c.id, c.name]));

  // Пустые категории — строка без цены, чтобы при реимпорте они не потерялись
  const usedCategoryIds = new Set(items.map((i) => i.category_id).filter(Boolean));
  for (const cat of categories) {
    if (!usedCategoryIds.has(cat.id)) {
      sheet.addRow({
        category: cat.name,
        name: '',
        price: '',
        active: '',
      });
    }
  }

  for (const item of items) {
    sheet.addRow({
      category: item.category_id ? categoryById.get(item.category_id) || '' : '',
      name: item.name,
      price: Number(item.price),
      active: item.is_active ? 'Да' : 'Нет',
    });
  }

  sheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
