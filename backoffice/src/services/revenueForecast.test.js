import test from 'node:test';
import assert from 'node:assert/strict';
import {
  forecastConfig,
  runHourlyForecast,
  runSeriesForecast,
  resolveHourlyModel,
  presentHourlyForecast,
  presentSeriesForecast,
} from './revenueForecast.js';
import { renderHourlyWidget, renderRevenueCard } from '../views/statsView.js';

const config = { ...forecastConfig };

function hours(partial) {
  const row = new Array(24).fill(0);
  for (const [hour, value] of Object.entries(partial)) row[Number(hour)] = value;
  return row;
}

function hourlyCtx(extra) {
  return {
    todayHours: hours({}),
    yesterdayHours: hours({}),
    currentHour: 11,
    sameWeekday: [],
    weekday: 2,
    config,
    ...extra,
  };
}

test('weekday profile keeps hours already passed and damps the evening pace', () => {
  const result = runHourlyForecast(
    'weekdayProfile',
    hourlyCtx({
      todayHours: hours({ 10: 2000 }),
      currentHour: 11,
      sameWeekday: [
        { hours: hours({ 10: 1000, 18: 100, 19: 300 }) },
        { hours: hours({ 10: 1000, 18: 300, 19: 500 }) },
      ],
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.modelId, 'weekdayProfile');
  assert.equal(result.fellBack, false);
  assert.equal(result.projected[10], null);
  assert.equal(result.projected[11], null);
  assert.equal(result.projected[18], 300);
  assert.equal(result.projected[19], 600);
  assert.equal(result.closeForecast, 2900);
  assert.equal(result.sign, 'up');
  assert.equal(result.confidence, 'low');
});

test('weekday profile before opening shows a typical day without scaling', () => {
  const result = runHourlyForecast(
    'weekdayProfile',
    hourlyCtx({
      currentHour: 9,
      sameWeekday: [
        { hours: hours({ 18: 400, 19: 600 }) },
        { hours: hours({ 18: 200, 19: 400 }) },
      ],
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.confidence, 'early');
  assert.equal(result.sign, 'flat');
  assert.equal(result.projected[18], 300);
  assert.equal(result.projected[19], 500);
  assert.equal(result.closeForecast, 800);
});

test('weekday profile falls back when there are not enough same weekdays', () => {
  const result = runHourlyForecast(
    'weekdayProfile',
    hourlyCtx({
      todayHours: hours({ 10: 2000 }),
      yesterdayHours: hours({ 10: 1000, 18: 1000 }),
      sameWeekday: [{ hours: hours({ 10: 1000, 18: 1000 }) }],
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.fellBack, true);
  assert.equal(result.modelId, 'yesterdayRatio');
  assert.equal(result.requestedModelId, 'weekdayProfile');
  assert.equal(result.closeForecast, 4000);
  assert.equal(result.projected[18], 2000);
});

test('weekday ratio spreads the remainder by the usual evening shape', () => {
  const result = runHourlyForecast(
    'weekdayRatio',
    hourlyCtx({
      todayHours: hours({ 10: 1000 }),
      currentHour: 11,
      sameWeekday: [
        { hours: hours({ 10: 1000, 18: 100, 19: 300 }) },
        { hours: hours({ 10: 1000, 18: 100, 19: 300 }) },
      ],
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.modelId, 'weekdayRatio');
  assert.equal(result.closeForecast, 1400);
  assert.equal(result.projected[18], 100);
  assert.equal(result.projected[19], 300);
  assert.equal(result.capped, false);
});

test('yesterday ratio is capped so a tiny morning does not explode the day', () => {
  const result = runHourlyForecast(
    'yesterdayRatio',
    hourlyCtx({
      todayHours: hours({ 10: 300 }),
      yesterdayHours: hours({ 10: 300, 18: 10000 }),
      currentHour: 11,
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.capped, true);
  assert.equal(result.closeForecast, 900);
});

test('yesterday ratio refuses a morning with almost no base', () => {
  const result = runHourlyForecast(
    'yesterdayRatio',
    hourlyCtx({
      todayHours: hours({ 10: 50 }),
      yesterdayHours: hours({ 10: 40, 18: 5000 }),
      currentHour: 11,
    })
  );

  assert.equal(result.ok, false);
  assert.match(result.reason, /мало выручки/);
});

test('ratio cap relaxes after noon', () => {
  const result = runHourlyForecast(
    'yesterdayRatio',
    hourlyCtx({
      todayHours: hours({ 14: 1000 }),
      yesterdayHours: hours({ 14: 1000, 19: 3000 }),
      currentHour: 15,
    })
  );

  assert.equal(result.ok, true);
  assert.equal(result.capped, false);
  assert.equal(result.closeForecast, 4000);
});

test('unknown hourly model uses the configured default', () => {
  assert.equal(resolveHourlyModel('nope'), forecastConfig.hourlyModel);
});

test('half compare ignores the open tail and uses the recent half as the next point', () => {
  const result = runSeriesForecast('halfCompare', { values: [10, 20, 30, 40, 50, 99] });
  assert.equal(result.ok, true);
  assert.equal(result.trendBaseline, 15);
  assert.equal(result.trendCurrent, 40);
  assert.equal(result.nextValue, 40);
  assert.equal(result.sign, 'up');
  assert.equal(result.pointKind, 'level');
});

test('linear slope projects the next closed step and ignores the open tail', () => {
  const result = runSeriesForecast('linearSlope', { values: [10, 20, 30, 40, 50, 99] });
  assert.equal(result.ok, true);
  assert.equal(result.nextValue, 60);
  assert.equal(result.sign, 'up');
  assert.equal(result.pointKind, 'slope');
});

test('series forecast waits until four closed periods exist', () => {
  const result = runSeriesForecast('halfCompare', { values: [10, 20, 30] });
  assert.equal(result.ok, false);
});

test('presenters expose close, pace and a chart that starts at the current hour', () => {
  const result = runHourlyForecast(
    'weekdayProfile',
    hourlyCtx({
      todayHours: hours({ 10: 2000 }),
      currentHour: 11,
      sameWeekday: [
        { hours: hours({ 10: 1000, 18: 100, 19: 300 }) },
        { hours: hours({ 10: 1000, 18: 300, 19: 500 }) },
      ],
    })
  );
  const view = presentHourlyForecast(result, hours({ 10: 2000 }));
  assert.equal(view.ok, true);
  assert.equal(view.closeForecast, 2900);
  assert.equal(view.chart[10], null);
  assert.equal(view.chart[11], 0);
  assert.equal(view.chart[18], 300);
  assert.equal(view.closeLabel.includes('вторник'), true);
  assert.match(view.paceTitle, /тренд/i);
  assert.match(view.closeTitle, /тренд/i);
  assert.ok(view.models.some((model) => model.id === 'yesterdayRatio'));

  const series = presentSeriesForecast(runSeriesForecast('halfCompare', { values: [10, 20, 30, 40, 50, 99] }));
  assert.equal(series.ok, true);
  assert.equal(series.nextValue, 40);
  assert.match(series.note, /не входит/);
  assert.match(series.title, /Тренд/);
});

test('widgets render the test switcher and the hourly forecast line', () => {
  const forecast = runHourlyForecast(
    'weekdayProfile',
    hourlyCtx({
      todayHours: hours({ 10: 2000 }),
      currentHour: 11,
      sameWeekday: [
        { hours: hours({ 10: 1000, 18: 400 }) },
        { hours: hours({ 10: 1000, 19: 400 }) },
      ],
    })
  );
  const hourlyHtml = renderHourlyWidget({
    hourly: {
      todayHours: hours({ 10: 2000 }),
      yesterdayHours: hours({ 10: 1000, 18: 500 }),
      currentHour: 11,
      todayTotalSoFar: 2000,
      yesterdayTotalSameWindow: 1000,
    },
    forecast,
    venueId: '5',
    hourlyModel: 'weekdayProfile',
  });
  assert.match(hourlyHtml, /[Тт]ренд/);
  assert.match(hourlyHtml, /К закрытию около/);
  assert.doesNotMatch(hourlyHtml, /forecast-test-badge/);
  assert.match(hourlyHtml, /#e2b15a/);
  assert.match(hourlyHtml, /hourlyModel=weekdayRatio/);
  assert.match(hourlyHtml, /id="hourly-model-field"/);

  const series = runSeriesForecast('halfCompare', { values: [10, 20, 30, 40, 50, 60, 70, 80] });
  const revenueHtml = renderRevenueCard({
    trend: [10, 20, 30, 40, 50, 60, 70, 80].map((revenue, index) => ({ label: String(index), revenue })),
    periodTotals: { day: 1, week: 2, month: 3, quarter: 4 },
    activePeriod: 'week',
    venueId: '5',
    forecast: series,
    seriesModel: 'halfCompare',
  });
  assert.match(revenueHtml, /Тренд/);
  assert.doesNotMatch(revenueHtml, /forecast-test-badge/);
  assert.match(revenueHtml, /seriesModel=linearSlope/);
  assert.match(revenueHtml, /id="series-model-field"/);
  assert.match(revenueHtml, /Текущая неделя не входит/);
});
