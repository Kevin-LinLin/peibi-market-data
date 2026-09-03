import { ASSETS, SOURCES } from './sources.js';
import { json, save, now, daysSince } from './lib.js';

const [market, valuation, history, latestRun] = await Promise.all([
  json('data/latest-market.json'), json('data/latest-valuation.json'), json('history/metrics.json'), json('logs/refresh-latest.json')
]);
const latest = (rows, id, predicate) => rows.filter(row => row.asset_id === id && predicate(row)).sort((a, b) => b.observation_date.localeCompare(a.observation_date))[0];
const slaStatus = checked => !checked ? 'Warning' : daysSince(checked) <= 7 ? 'Healthy' : daysSince(checked) <= 14 ? 'Delayed' : 'Warning';
const assets = {};

for (const asset of ASSETS) {
  const id = asset.id;
  const rows = [...market.metrics, ...valuation.metrics].filter(row => row.asset_id === id);
  const marketRow = latest(market.metrics, id, () => true);
  const coreMetrics = Object.entries(SOURCES[id]).filter(([, config]) => config.mode === 'auto_parsed').map(([metric]) => metric);
  const coreRows = coreMetrics.map(metric => latest(valuation.metrics, id, row => row.metric === metric)).filter(Boolean);
  const checked = coreRows.map(row => row.latest_available_checked_at).filter(Boolean).sort().at(-1) ?? rows.map(row => row.latest_available_checked_at).filter(Boolean).sort().at(-1) ?? null;
  const metric_status = Object.fromEntries(coreMetrics.map(metric => {
    const row = coreRows.find(item => item.metric === metric);
    return [metric, row ? { source_status: 'available', status: row.status, observation_date: row.observation_date, latest_available_checked_at: row.latest_available_checked_at } : { source_status: 'source_failure', status: 'unavailable', latest_available_checked_at: null }];
  }));
  assets[id] = {
    latest_market_date: marketRow?.observation_date ?? null,
    latest_valuation_date: coreRows.map(row => row.observation_date).sort().at(-1) ?? latest(valuation.metrics, id, row => !['earnings_growth', 'roe'].includes(row.metric))?.observation_date ?? null,
    latest_fundamental_date: latest(valuation.metrics, id, row => ['earnings_growth', 'roe'].includes(row.metric))?.observation_date ?? null,
    latest_available_checked_at: checked,
    sla_status: slaStatus(checked),
    source_status: coreMetrics.length ? (coreRows.length === coreMetrics.length ? 'available' : 'partial') : (rows.length ? 'supervised' : 'core_data_missing'),
    metric_status,
    history_sample_count: history.records.filter(row => row.asset_id === id).length
  };
}

const old = await json('data/data-health.json');
await save('data/data-health.json', {
  schema_version: 1,
  last_daily_refresh: latestRun.run_type === 'daily' ? latestRun.finished_at : old.last_daily_refresh,
  last_weekly_refresh: latestRun.run_type === 'weekly' ? latestRun.finished_at : old.last_weekly_refresh,
  daily_status: latestRun.run_type === 'daily' ? (latestRun.success ? 'Healthy' : 'Warning') : old.daily_status,
  weekly_status: latestRun.run_type === 'weekly' ? (latestRun.success ? 'Healthy' : 'Warning') : old.weekly_status,
  generated_at: now(),
  assets
});
