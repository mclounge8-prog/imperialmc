const PLAN_CELL = 40;

function planScale(viewport, bounds) {
  const width = viewport.clientWidth;
  if (!width || !bounds.width) return 1;
  return width / bounds.width;
}

function planLabel(name, scale, width) {
  const visual = Number(width) * Number(scale);
  if (!Number.isFinite(visual) || visual >= 78) return name;
  const number = /^Стол\s+(.+)$/.exec(String(name || ''));
  return number ? number[1] : name;
}

function mountPlan(viewport, zone) {
  const bounds = zone.bounds;
  const scale = planScale(viewport, bounds);
  const width = viewport.clientWidth || Math.ceil(bounds.width * scale);
  const visualW = width;
  const visualH = Math.ceil(bounds.height * scale);
  const box = getComputedStyle(viewport);
  const frame = (parseFloat(box.borderTopWidth) || 0) + (parseFloat(box.borderBottomWidth) || 0);
  viewport.dataset.pan = '0';
  viewport.style.overflow = 'hidden';
  viewport.style.height = `${visualH + frame}px`;
  viewport.replaceChildren();
  const sizer = document.createElement('div');
  sizer.className = 'plan-sizer';
  sizer.style.width = `${visualW}px`;
  sizer.style.height = `${visualH}px`;
  const stage = document.createElement('div');
  stage.className = scale < 0.7 ? 'plan tight' : 'plan';
  stage.style.width = `${bounds.width}px`;
  stage.style.height = `${bounds.height}px`;
  stage.style.transform = `scale(${scale})`;
  stage.dataset.scale = String(scale);
  stage.style.setProperty('--cell', `${PLAN_CELL}px`);
  stage.style.setProperty('--scale', String(scale));
  sizer.appendChild(stage);
  viewport.appendChild(sizer);
  return stage;
}

function placeTable(table) {
  return `left:${table.x}px;top:${table.y}px;width:${table.w}px;height:${table.h}px`;
}

function snapPlan(value, limit) {
  const n = Math.round(Number(value) / PLAN_CELL) * PLAN_CELL;
  return Math.max(0, Math.min(limit, n));
}

function formatMoney(value) {
  return `${new Intl.NumberFormat('ru-RU').format(Number(value) || 0)} ₽`;
}
