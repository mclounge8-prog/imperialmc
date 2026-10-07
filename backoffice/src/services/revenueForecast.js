/**
 * Прогноз выручки на главной.
 *
 * Это отдельный механизм: модели зарегистрированы ниже, активные по умолчанию
 * задаёт forecastConfig. На главной в тестовом режиме модель можно переключить
 * кнопкой (выбор запоминается в cookie). Новая модель — функция predict и строка
 * в HOURLY_MODELS или SERIES_MODELS, без правок графика.
 *
 * Часовой прогноз отвечает «сколько будет к закрытию».
 * Прогноз ряда «Выручка» отвечает «куда смотрит уже закрытая история»
 * и не включает текущий незаконченный день / неделю / месяц.
 */

export const forecastConfig = {
  testMode: true,
  hourlyModel: 'weekdayProfile',
  seriesModel: 'halfCompare',
  /** Сколько таких же дней недели брать в базу (не считая сегодня). */
  weekdayLookback: 4,
  /** Насколько темп утра двигает вечер: 0 — вечер как в базе, 1 — вечер целиком в темпе утра. */
  paceDamping: 0.5,
  minBaselineDays: 2,
  /** До этого часа коэффициент «утро × день» ещё сильно прыгает. */
  lowConfidenceUntilHour: 12,
  /** Потолок коэффициента до полудня, чтобы короткое утро не раздувало день. */
  maxRatio: 3,
  /** После полудня обычная доля дня уже читается, режем только явный выброс. */
  maxRatioLate: 8,
  /** Ниже этой выручки к текущему часу коэффициент не считаем. */
  minWindowRevenue: 300,
};

const WEEKDAY_PLURAL = {
  1: 'понедельникам',
  2: 'вторникам',
  3: 'средам',
  4: 'четвергам',
  5: 'пятницам',
  6: 'субботам',
  7: 'воскресеньям',
};

export function weekdayPhrase(weekday) {
  return WEEKDAY_PLURAL[weekday] || 'таким дням';
}

/** Короткая фраза для экрана: «Пока тренд на спад, −8%». */
export function trendWords(sign, pct, { ongoing = false } = {}) {
  const n = Math.round(Math.abs(Number(pct) || 0));
  const head = ongoing ? 'Пока тренд' : 'Тренд';
  if (sign === 'up') return { sign: 'up', title: `${head} на рост, +${n}%` };
  if (sign === 'down') return { sign: 'down', title: `${head} на спад, −${n}%` };
  return { sign: 'flat', title: ongoing ? 'Пока тренд ровный' : 'Тренд ровный' };
}

function sum(values) {
  let total = 0;
  for (const value of values) {
    if (value == null) continue;
    total += Number(value) || 0;
  }
  return total;
}

function avg(values) {
  if (!values.length) return 0;
  return sum(values) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].map((v) => Number(v) || 0).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function direction(current, previous) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) {
    if (c === 0) return { pct: 0, sign: 'flat' };
    return { pct: 100, sign: 'up' };
  }
  const pct = ((c - p) / p) * 100;
  return { pct: Math.abs(pct), sign: pct > 0.5 ? 'up' : pct < -0.5 ? 'down' : 'flat' };
}

function activeDays(days) {
  return (days || []).filter((day) => sum(day.hours || []) > 0);
}

function hoursMedian(days) {
  return Array.from({ length: 24 }, (_, hour) => median(days.map((day) => Number(day.hours?.[hour]) || 0)));
}

function paceFactor(fact, baseline, damping) {
  if (!(baseline > 0) || !(fact > 0)) return 1;
  const raw = fact / baseline;
  return 1 + (raw - 1) * damping;
}

function confidenceOf(currentHour, windowBaseline, config) {
  if (currentHour >= config.lowConfidenceUntilHour) return 'ok';
  if (!(windowBaseline > 0)) return 'early';
  return 'low';
}

/**
 * Остаток дня раскладываем по форме shapeHours (часы после текущего).
 * Уже наступившие часы в projected остаются null — их рисует факт.
 */
function projectRemainder(currentHour, closeForecast, fact, shapeHours) {
  const projected = Array.from({ length: 24 }, () => null);
  const weights = [];
  for (let hour = currentHour + 1; hour < 24; hour += 1) {
    weights.push({ hour, weight: Math.max(0, Number(shapeHours[hour]) || 0) });
  }
  if (!weights.length) return projected;
  const remainder = Math.max(0, closeForecast - fact);
  const weightSum = sum(weights.map((item) => item.weight));
  if (weightSum <= 0) {
    const each = remainder / weights.length;
    for (const item of weights) projected[item.hour] = each;
    return projected;
  }
  for (const item of weights) projected[item.hour] = remainder * (item.weight / weightSum);
  return projected;
}

function fail(modelId, reason) {
  return { ok: false, modelId, reason };
}

function baseResult(modelId, ctx, extra) {
  const fact = sum(ctx.todayHours.slice(0, ctx.currentHour + 1));
  return {
    ok: true,
    modelId,
    weekday: ctx.weekday || null,
    fact,
    currentHour: ctx.currentHour,
    ...extra,
  };
}

/**
 * Оставшиеся часы — медиана того же часа по таким же дням недели.
 * Если утро уже отличается от обычного, вечер сдвигается только на долю этого разрыва.
 */
function predictWeekdayProfile(ctx) {
  const config = ctx.config;
  const days = activeDays(ctx.sameWeekday);
  if (days.length < config.minBaselineDays) {
    return fail('weekdayProfile', 'мало таких дней недели');
  }
  const completedFact = sum(ctx.todayHours.slice(0, ctx.currentHour));
  const partial = Number(ctx.todayHours[ctx.currentHour]) || 0;
  const fact = completedFact + partial;
  const windowBaseline = median(days.map((day) => sum(day.hours.slice(0, ctx.currentHour))));
  const closeBaseline = median(days.map((day) => sum(day.hours)));
  const pace = paceFactor(completedFact, windowBaseline, config.paceDamping);
  const shape = hoursMedian(days);
  const projected = Array.from({ length: 24 }, (_, hour) => {
    if (hour <= ctx.currentHour) return null;
    return shape[hour] * pace;
  });
  const closeForecast = fact + sum(projected);
  const trend = direction(completedFact, windowBaseline);
  return baseResult('weekdayProfile', ctx, {
    compareWith: 'weekday',
    baselineDays: days.length,
    closeForecast,
    closeBaseline,
    trendCurrent: fact,
    trendBaseline: windowBaseline,
    sign: trend.sign,
    pct: trend.pct,
    projected,
    confidence: confidenceOf(ctx.currentHour, windowBaseline, config),
    capped: false,
  });
}

function predictRatio(modelId, ctx, shapeHours, windowBaseline, closeBaseline, compareWith, baselineDays) {
  const config = ctx.config;
  if (!(windowBaseline >= config.minWindowRevenue)) {
    return fail(modelId, 'к этому часу в базе ещё мало выручки');
  }
  const completedFact = sum(ctx.todayHours.slice(0, ctx.currentHour));
  const partial = Number(ctx.todayHours[ctx.currentHour]) || 0;
  const fact = completedFact + partial;
  let ratio = closeBaseline / windowBaseline;
  let capped = false;
  const ceiling = ctx.currentHour < config.lowConfidenceUntilHour ? config.maxRatio : config.maxRatioLate;
  if (ratio > ceiling) {
    ratio = ceiling;
    capped = true;
  }
  const closeForecast = completedFact * ratio + partial;
  const projected = projectRemainder(ctx.currentHour, closeForecast, fact, shapeHours);
  const trend = direction(completedFact, windowBaseline);
  return baseResult(modelId, ctx, {
    compareWith,
    baselineDays,
    closeForecast,
    closeBaseline,
    trendCurrent: fact,
    trendBaseline: windowBaseline,
    sign: trend.sign,
    pct: trend.pct,
    projected,
    confidence: confidenceOf(ctx.currentHour, windowBaseline, config),
    capped,
  });
}

/** К закрытию = факт × (обычный полный такой день / обычная выручка к этому часу). */
function predictWeekdayRatio(ctx) {
  const days = activeDays(ctx.sameWeekday);
  if (days.length < ctx.config.minBaselineDays) {
    return fail('weekdayRatio', 'мало таких дней недели');
  }
  const shape = hoursMedian(days);
  const windowBaseline = median(days.map((day) => sum(day.hours.slice(0, ctx.currentHour))));
  const closeBaseline = median(days.map((day) => sum(day.hours)));
  return predictRatio('weekdayRatio', ctx, shape, windowBaseline, closeBaseline, 'weekday', days.length);
}

/** То же самое, но база — только вчера, без оглядки на день недели. */
function predictYesterdayRatio(ctx) {
  const yesterday = ctx.yesterdayHours || [];
  const windowBaseline = sum(yesterday.slice(0, ctx.currentHour));
  const closeBaseline = sum(yesterday);
  if (!(closeBaseline > 0)) return fail('yesterdayRatio', 'вчера продаж не было');
  return predictRatio('yesterdayRatio', ctx, yesterday, windowBaseline, closeBaseline, 'yesterday', 1);
}

export const HOURLY_MODELS = {
  weekdayProfile: {
    id: 'weekdayProfile',
    label: 'Профиль дня',
    hint: 'Оставшиеся часы как в такие же дни недели. Вечер сдвигается только наполовину от темпа утра.',
    plain: 'Смотрим обычные такие дни: как идёт день сейчас, так чуть поправляем вечер.',
    predict: predictWeekdayProfile,
  },
  weekdayRatio: {
    id: 'weekdayRatio',
    label: 'Доля дня',
    hint: 'Факт умножается на то, какую долю дня обычно уже сделали к этому часу.',
    plain: 'Смотрим, какую долю дня обычно уже сделали к этому часу, и так дорисовываем остаток.',
    predict: predictWeekdayRatio,
  },
  yesterdayRatio: {
    id: 'yesterdayRatio',
    label: 'Как вчера',
    hint: 'Та же доля, но база — вчерашний день, без поправки на день недели.',
    plain: 'Смотрим вчерашний день и прикидываем, что сегодня закончится так же.',
    predict: predictYesterdayRatio,
  },
};

const HOURLY_FALLBACK = {
  weekdayProfile: ['weekdayRatio', 'yesterdayRatio'],
  weekdayRatio: ['yesterdayRatio'],
  yesterdayRatio: [],
};

function closedValues(values) {
  if (!values || values.length < 2) return values ? [...values] : [];
  return values.slice(0, -1);
}

/** Вторая половина закрытых точек против первой. Пунктир — уровень недавней половины. */
function predictHalfCompare(ctx) {
  const closed = closedValues(ctx.values);
  if (closed.length < 4) return fail('halfCompare', 'мало закрытых периодов');
  const mid = Math.floor(closed.length / 2);
  const older = closed.slice(0, mid);
  const newer = closed.slice(mid);
  const olderAvg = avg(older);
  const newerAvg = avg(newer);
  const trend = direction(newerAvg, olderAvg);
  return {
    ok: true,
    modelId: 'halfCompare',
    sign: trend.sign,
    pct: trend.pct,
    trendCurrent: newerAvg,
    trendBaseline: olderAvg,
    nextValue: Math.max(0, newerAvg),
    pointKind: 'level',
  };
}

/** Прямая по закрытым точкам. Пунктир — следующий период по этой прямой. */
function predictLinearSlope(ctx) {
  const closed = closedValues(ctx.values);
  if (closed.length < 4) return fail('linearSlope', 'мало закрытых периодов');
  const n = closed.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    const y = Number(closed[i]) || 0;
    sumX += i;
    sumY += y;
    sumXY += i * y;
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const fittedStart = intercept;
  const fittedEnd = intercept + slope * (n - 1);
  const trend = direction(Math.max(0, fittedEnd), Math.max(0, fittedStart));
  return {
    ok: true,
    modelId: 'linearSlope',
    sign: trend.sign,
    pct: trend.pct,
    trendCurrent: Math.max(0, fittedEnd),
    trendBaseline: Math.max(0, fittedStart),
    nextValue: Math.max(0, intercept + slope * n),
    pointKind: 'slope',
  };
}

export const SERIES_MODELS = {
  halfCompare: {
    id: 'halfCompare',
    label: 'Половины',
    hint: 'Средняя второй половины закрытых периодов против первой. Текущий период не входит.',
    plain: 'Сравниваем недавние закрытые недели с более ранними.',
    predict: predictHalfCompare,
  },
  linearSlope: {
    id: 'linearSlope',
    label: 'Наклон',
    hint: 'Прямая по закрытым периодам и один шаг вперёд. Текущий период не входит.',
    plain: 'Смотрим, вверх или вниз ползут закрытые недели, и продлеваем эту линию.',
    predict: predictLinearSlope,
  },
};

export function listHourlyModels() {
  return Object.values(HOURLY_MODELS).map(({ id, label, hint, plain }) => ({ id, label, hint, plain }));
}

export function listSeriesModels() {
  return Object.values(SERIES_MODELS).map(({ id, label, hint, plain }) => ({ id, label, hint, plain }));
}

export function resolveHourlyModel(id) {
  return HOURLY_MODELS[id] ? id : forecastConfig.hourlyModel;
}

export function resolveSeriesModel(id) {
  return SERIES_MODELS[id] ? id : forecastConfig.seriesModel;
}

export function runHourlyForecast(modelId, ctx) {
  const requested = resolveHourlyModel(modelId);
  const order = [requested, ...(HOURLY_FALLBACK[requested] || [])];
  let lastReason = 'нет базы для прогноза';
  for (const id of order) {
    const model = HOURLY_MODELS[id];
    const result = model.predict({ ...ctx, config: ctx.config || forecastConfig });
    if (result.ok) {
      return {
        ...result,
        requestedModelId: requested,
        modelLabel: model.label,
        fellBack: id !== requested,
        fallbackReason: id !== requested ? lastReason : null,
      };
    }
    lastReason = result.reason || lastReason;
  }
  return {
    ok: false,
    modelId: requested,
    requestedModelId: requested,
    modelLabel: HOURLY_MODELS[requested].label,
    fellBack: false,
    reason: lastReason,
  };
}

export function runSeriesForecast(modelId, ctx) {
  const requested = resolveSeriesModel(modelId);
  const model = SERIES_MODELS[requested];
  const result = model.predict(ctx);
  if (!result.ok) {
    return {
      ...result,
      requestedModelId: requested,
      modelLabel: model.label,
    };
  }
  return {
    ...result,
    requestedModelId: requested,
    modelLabel: model.label,
  };
}

function hourlyCompareLabels(result) {
  if (result.compareWith === 'yesterday') {
    return { pace: 'к вчерашнему часу', close: 'к вчерашнему дню' };
  }
  const days = weekdayPhrase(result.weekday);
  return { pace: `к обычным ${days}`, close: `к обычным ${days}` };
}

/** JSON для PWA и других клиентов: без HTML, с подписями и рядом для графика. */
export function presentHourlyForecast(result, todayHours = null) {
  const models = listHourlyModels();
  if (!result?.ok) {
    return {
      ok: false,
      reason: result?.reason || 'Нет базы для прогноза',
      requestedModelId: result?.requestedModelId || result?.modelId || null,
      modelId: result?.modelId || null,
      modelLabel: result?.modelLabel || null,
      models,
    };
  }

  const labels = hourlyCompareLabels(result);
  const closeDir = direction(result.closeForecast, result.closeBaseline);
  const paceWords = trendWords(result.sign, result.pct, { ongoing: true });
  const closeWords = trendWords(closeDir.sign, closeDir.pct);
  const activeModel = models.find((model) => model.id === result.modelId);
  const notes = [];
  if (result.fellBack) {
    const requested = models.find((model) => model.id === result.requestedModelId);
    notes.push(
      `${requested?.label || 'Этот способ'} сейчас не посчитать (${result.fallbackReason}). Показан способ «${result.modelLabel}».`
    );
  }
  if (result.confidence === 'low') notes.push('До полудня процент ещё легко меняется.');
  if (result.confidence === 'early') notes.push('До выручки показываем, как обычно заканчивается такой день.');
  if (result.capped) notes.push('Утро ещё короткое, слишком резкий скачок мы придержали.');
  if (result.compareWith === 'weekday') {
    notes.push(`Считаем по ${result.baselineDays} обычным ${weekdayPhrase(result.weekday)}.`);
  }

  let chart = null;
  const hasFuture = (result.projected || []).some((value, hour) => hour > result.currentHour && value != null);
  if (hasFuture && todayHours) {
    chart = result.projected.map((value, hour) => {
      if (hour < result.currentHour) return null;
      if (hour === result.currentHour) return Number(todayHours[hour]) || 0;
      return value;
    });
  }

  return {
    ok: true,
    modelId: result.modelId,
    requestedModelId: result.requestedModelId,
    modelLabel: result.modelLabel,
    fellBack: Boolean(result.fellBack),
    models,
    closeForecast: result.closeForecast,
    closeBaseline: result.closeBaseline,
    closeSign: closeDir.sign,
    closePct: closeDir.pct,
    paceSign: result.sign,
    pacePct: result.pct,
    paceTitle: result.confidence === 'early' ? 'День ещё не разошёлся' : paceWords.title,
    paceHint:
      result.confidence === 'early'
        ? 'Рано говорить, выше сегодня обычного или ниже.'
        : `По уже закрытым часам, ${labels.pace}.`,
    showPace: result.confidence !== 'early',
    paceLabel: labels.pace,
    closeTitle: closeWords.title,
    closeHint: `К закрытию дня, ${labels.close}.`,
    closeLabel: labels.close,
    modelPlain: activeModel?.plain || '',
    confidence: result.confidence,
    notes,
    chart,
    asOfHour: result.currentHour,
  };
}

/** Направление ряда «Выручка» по закрытым неделям. */
export function presentSeriesForecast(result) {
  const models = listSeriesModels();
  if (!result?.ok) {
    return {
      ok: false,
      reason: result?.reason || 'Мало закрытых периодов',
      requestedModelId: result?.requestedModelId || result?.modelId || null,
      modelId: result?.modelId || null,
      modelLabel: result?.modelLabel || null,
      models,
    };
  }
  const words = trendWords(result.sign, result.pct);
  const hint =
    result.pointKind === 'slope'
      ? 'Так ползут уже закрытые недели. Текущая неделя не входит.'
      : 'Недавние закрытые недели против предыдущих. Текущая неделя не входит.';
  const activeModel = models.find((model) => model.id === result.modelId);
  return {
    ok: true,
    modelId: result.modelId,
    requestedModelId: result.requestedModelId,
    modelLabel: result.modelLabel,
    modelPlain: activeModel?.plain || '',
    models,
    sign: result.sign,
    pct: result.pct,
    title: words.title,
    hint,
    nextValue: result.nextValue,
    pointKind: result.pointKind,
    note: hint,
  };
}
