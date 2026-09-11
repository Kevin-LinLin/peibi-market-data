import { json, date, metricKey, validNumber } from './lib.js';
const limits = {
  price: [0, 1000000],
  volatility: [0, 200],
  drawdown: [-100, 0.0001],
  trend: [-100, 1000],
  real_yield: [-20, 30],
  usd_index: [1, 1000],
  pe: [0, 1000],
  rolling_pe: [0, 1000],
  pb: [0, 100],
  dividend_yield: [0, 100]
};
const futureCutoff = Date.now() + 864e5;
const files = ['data/latest-market.json', 'data/latest-valuation.json', 'history/metrics.json'];
let failed = false;
for (const file of files) {
  const document = await json(file);
  const rows = document.metrics || document.records || [];
  const keys = new Set();
  for (const row of rows) {
    const required = ['asset_id','metric','unit','observation_date','source','source_url','retrieved_at','latest_available_checked_at','quality','status'];
    const missing = required.filter(k => !row[k]);
    const range = limits[row.metric];
    const outsideRange = range && (row.value < range[0] || row.value > range[1]);
    const futureObservation = date(row.observation_date) && new Date(row.observation_date).getTime() > futureCutoff;
    if (missing.length || !validNumber(row.value) || !date(row.observation_date) || !date(row.published_date ?? row.observation_date) || outsideRange || futureObservation) {
      console.error(`${file}: invalid metric ${row.asset_id}:${row.metric}${outsideRange ? ' (outside plausible range)' : ''}${futureObservation ? ' (future observation date)' : ''}`);
      failed = true;
    }
    const key = file.includes('history') ? metricKey(row) : `${row.asset_id}:${row.metric}`;
    if (keys.has(key)) { console.error(`${file}: duplicate ${key}`); failed = true; }
    keys.add(key);
  }
}
if (failed) process.exit(1); console.log('Data validation passed.');
