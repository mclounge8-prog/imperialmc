const PLAN_CELL = 40;

function planScale(viewport, bounds) {
  const width = viewport.clientWidth;
  if (!width || !bounds.width) return 1;
  const fit = width / bounds.width;
  if (width < 720) return Math.max(fit, 0.78);
  return fit;
}

function mountPlan(viewport, zone) {
  const bounds = zone.bounds;
  const scale = planScale(viewport, bounds);
  const width = viewport.clientWidth;
  const wide = width > 0 && width < 720;
  const visualW = wide ? Math.ceil(bounds.width * scale) : width || Math.ceil(bounds.width * scale);
  const visualH = Math.ceil(bounds.height * scale);
  viewport.dataset.pan = wide ? '1' : '0';
  viewport.style.overflow = wide ? 'auto' : 'hidden';
  viewport.style.height = `${visualH}px`;
  viewport.replaceChildren();
  const sizer = document.createElement('div');
  sizer.className = 'plan-sizer';
  sizer.style.width = `${visualW}px`;
  sizer.style.height = `${visualH}px`;
  const stage = document.createElement('div');
  stage.className = 'plan';
  stage.style.width = `${bounds.width}px`;
  stage.style.height = `${bounds.height}px`;
  stage.style.transform = `scale(${scale})`;
  stage.dataset.scale = String(scale);
  stage.style.setProperty('--cell', `${PLAN_CELL}px`);
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
