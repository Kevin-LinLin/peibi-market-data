import { ASSETS, SOURCES } from './sources.js';
import { json, save, now, daysSince } from './lib.js';

const [market, valuation, history, latestRun] = await Promise.all([
  json('data/latest-market.json'), json('data/latest-valuation.json'), json('history/metrics.json'), json('logs/refresh-latest.json')
]);
const latest = (rows, id, predicate) => rows.filter(row => row.asset_id === id && predicate(row)).sort((a, b) => b.observation_date.localeCompare(a.observation_date))[0];
const slaStatus = checked => !checked ? 'Warning' : daysSince(checked) <= 7 ? 'Healthy' : daysSince(checked) <= 14 ? 'Delayed' : 'Warning';
const refreshStatus = (lastSuccess, lastAttemptStatus, healthyDays, warningDays) => {
  if (lastAttemptStatus === 'failed') return 'Warning';
  if (!lastSuccess) return 'Warning';
  const age = daysSince(lastSuccess);
  return age <= healthyDays ? 'Healthy' : age <= warningDays ? 'Delayed' : 'Warning';
};
const old = await json('data/data-health.json');
const weeklyFailedSources = latestRun.run_type === 'weekly'
  ? (latestRun.failed_sources ?? [])
  : (old.weekly_failed_sources ?? []);
const failedSourceByMetric = new Map(
  weeklyFailedSources.map(item => [`${item.asset_id}:${item.metric}`, item])
);
const assets = {};

for (const asset of ASSETS) {
  const id = asset.id;
  const rows = [...market.metrics, ...valuation.metrics].filter(row => row.asset_id === id);
  const marketRow = latest(market.metrics, id, () => true);
  const coreMetrics = Object.entries(SOURCES[id]).filter(([, config]) => config.mode === 'auto_parsed').map(([metric]) => metric);
  const coreRows = coreMetrics.map(metric => latest(valuation.metrics, id, row => row.metric === metric)).filter(Boolean);
  // Asset health is constrained by its stalest required source, not its freshest one.
  // A newly checked PE must not hide an overdue PB (or vice versa).
  const coreChecked = coreRows.map(row => row.latest_available_checked_at).filter(Boolean).sort();
  const checked = coreMetrics.length
    ? (coreRows.length === coreMetrics.length ? (coreChecked.at(0) ?? null) : null)
    : (rows.map(row => row.latest_available_checked_at).filter(Boolean).sort().at(0) ?? null);
  const metric_status = Object.fromEntries(coreMetrics.map(metric => {
    const row = coreRows.find(item => item.metric === metric);
    const failure = failedSourceByMetric.get(`${id}:${metric}`);
    if (failure) {
      return [metric, {
        source_status: 'source_failure',
        status: row ? 'last_known_good' : 'unavailable',
        observation_date: row?.observation_date ?? null,
        latest_available_checked_at: row?.latest_available_checked_at ?? null,
        error: failure.error
      }];
    }
    return [metric, row ? { source_status: 'available', status: row.status, observation_date: row.observation_date, latest_available_checked_at: row.latest_available_checked_at } : { source_status: 'source_missing', status: 'unavailable', latest_available_checked_at: null }];
  }));
  const hasSourceFailure = coreMetrics.some(metric => failedSourceByMetric.has(`${id}:${metric}`));
  assets[id] = {
    latest_market_date: marketRow?.observation_date ?? null,
    latest_valuation_date: coreRows.map(row => row.observation_date).sort().at(-1) ?? latest(valuation.metrics, id, row => !['earnings_growth', 'roe'].includes(row.metric))?.observation_date ?? null,
    latest_fundamental_date: latest(valuation.metrics, id, row => ['earnings_growth', 'roe'].includes(row.metric))?.observation_date ?? null,
    latest_available_checked_at: checked,
    sla_status: slaStatus(checked),
    source_status: coreMetrics.length ? (hasSourceFailure || coreRows.length !== coreMetrics.length ? 'partial' : 'available') : (rows.length ? 'supervised' : 'core_data_missing'),
    metric_status,
    history_sample_count: history.records.filter(row => row.asset_id === id).length,
    history_sample_count_by_metric: Object.fromEntries(
      coreMetrics.map(metric => [
        metric,
        new Set(
          history.records
            .filter(row => row.asset_id === id && row.metric === metric)
            .map(row => row.observation_date)
        ).size
      ])
    )
  };
}

const finishedAt = latestRun.finished_at ?? now();
const lastDailyAttempt = latestRun.run_type === 'daily' ? finishedAt : (old.last_daily_attempt ?? old.last_daily_refresh ?? null);
const lastDailyRefresh = latestRun.run_type === 'daily' && latestRun.success ? finishedAt : (old.last_daily_refresh ?? null);
const dailyAttemptStatus = latestRun.run_type === 'daily' ? (latestRun.success ? 'success' : 'failed') : (old.daily_last_run_status ?? 'unknown');
const lastWeeklyAttempt = latestRun.run_type === 'weekly' ? finishedAt : (old.last_weekly_attempt ?? old.last_weekly_refresh ?? null);
const lastWeeklyRefresh = latestRun.run_type === 'weekly' && latestRun.success ? finishedAt : (old.last_weekly_refresh ?? null);
const weeklyAttemptStatus = latestRun.run_type === 'weekly' ? (latestRun.success ? 'success' : 'failed') : (old.weekly_last_run_status ?? 'unknown');

await save('data/data-health.json', {
  schema_version: 1,
  last_daily_attempt: lastDailyAttempt,
  last_daily_refresh: lastDailyRefresh,
  daily_last_run_status: dailyAttemptStatus,
  last_weekly_attempt: lastWeeklyAttempt,
  last_weekly_refresh: lastWeeklyRefresh,
  weekly_last_run_status: weeklyAttemptStatus,
  daily_status: refreshStatus(lastDailyRefresh, dailyAttemptStatus, 3, 7),
  weekly_status: refreshStatus(lastWeeklyRefresh, weeklyAttemptStatus, 7, 14),
  weekly_failed_sources: weeklyFailedSources,
  generated_at: now(),
  assets
});
