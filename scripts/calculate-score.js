// Frozen production-score formulas. This file changes data only; it does not change model weights.
import { json, save, now } from './lib.js';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

const condition = (drawdown, trend) =>
  clamp(
    50 +
      Math.min(30, Math.max(0, -drawdown * 1.5)) +
      (trend > 45 ? -10 : trend < -25 ? -5 : 0),
    20,
    100
  );

const riskHealth = volatility =>
  clamp(85 - volatility * 1.6, 15, 85);

const status = s =>
  s >= 80
    ? '非常有吸引力'
    : s >= 65
      ? '偏有吸引力'
      : s >= 45
        ? '中性'
        : s >= 30
          ? '偏低'
          : '明显偏低';

const valuationStatus = s =>
  s >= 80
    ? '明显偏便宜'
    : s >= 65
      ? '偏便宜'
      : s >= 45
        ? '合理'
        : s >= 30
          ? '偏贵'
          : '明显偏贵';

// Fundamentals/Growth is intentionally not a required component in the simplified model.
// Retained outer weights are renormalized only across components with data.
const OUTER_WEIGHTS = {
  valuation: 55,
  market_condition: 15,
  risk_health: 10
};

const VALUATION_MODELS = {
  nasdaq100: [
    {
      metric: 'forward_pe_fy1',
      baseline_metric: 'forward_pe_10y_mean',
      weight: 1,
      direction: 'lower'
    }
  ],

  sp500: [
    {
      metric: 'forward_pe_fy1',
      baseline_metric: 'forward_pe_10y_mean',
      weight: 1,
      direction: 'lower'
    }
  ],

  csi_a500: [
    {
      metric: 'rolling_pe',
      weight: 0.7,
      direction: 'lower'
    },
    {
      metric: 'pb',
      weight: 0.3,
      direction: 'lower'
    }
  ],

  dividend_lowvol100: [
    {
      metric: 'dividend_yield',
      weight: 0.6,
      direction: 'higher'
    },
    {
      metric: 'rolling_pe',
      weight: 0.4,
      direction: 'lower'
    }
  ],

  hangseng_tech: [
    {
      metric: 'pe',
      weight: 1,
      direction: 'lower'
    }
  ],

  csi_securities: [
    {
      metric: 'pb',
      weight: 0.7,
      direction: 'lower'
    },
    {
      metric: 'rolling_pe',
      weight: 0.3,
      direction: 'lower'
    }
  ]
};

const metricRow = (rows, assetId, name) =>
  rows.find(
    row =>
      row.asset_id === assetId &&
      row.metric === name &&
      Number.isFinite(row.value)
  ) ?? null;

const priorComponent = (asset, name) =>
  Number.isFinite(asset?.[name])
    ? asset[name]
    : null;

const weightedAverage = entries => {
  const denominator = entries.reduce(
    (total, entry) => total + entry.weight,
    0
  );

  return denominator
    ? entries.reduce(
        (total, entry) =>
          total + entry.score * entry.weight,
        0
      ) / denominator
    : null;
};

function metricSeries(history, latest, assetId, name) {
  const byDate = new Map();

  for (const row of [
    ...history.records,
    ...latest.metrics
  ]) {
    if (
      row.asset_id === assetId &&
      row.metric === name &&
      Number.isFinite(row.value)
    ) {
      byDate.set(
        row.observation_date,
        row.value
      );
    }
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value);
}

// A continuous same-metric percentile. Short histories are shrunk to neutral
// rather than using an invented historical band or an absolute-value threshold.
function historicalAttractiveness(
  history,
  latest,
  row,
  direction
) {
  const values = metricSeries(
    history,
    latest,
    row.asset_id,
    row.metric
  );

  if (!values.length) {
    return null;
  }

  if (values.length === 1) {
    return {
      score: 50,
      sample_count: 1,
      context: 'limited_history_percentile'
    };
  }

  const lower = values.filter(
    value => value < row.value
  ).length;

  const equal = values.filter(
    value => value === row.value
  ).length;

  const percentile =
    ((lower + (equal - 1) / 2) /
      (values.length - 1)) *
    100;

  const directional =
    direction === 'higher'
      ? percentile
      : 100 - percentile;

  const historyStrength = Math.min(
    1,
    (values.length - 1) / 11
  );

  return {
    score:
      50 +
      (directional - 50) *
        historyStrength,
    sample_count: values.length,
    context:
      values.length >= 12
        ? 'exact_percentile'
        : 'limited_history_percentile'
  };
}

// For US index FY1 P/E, the verified public data includes a current value and
// a published 10-year mean, but not a complete same-definition time series.
// This continuous relative-to-mean mapping is the previously validated
// approximate-band rule; it is explicitly capped at Medium confidence.
function approximateBandAttractiveness(value, baseline) {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(baseline) ||
    baseline <= 0
  ) {
    return null;
  }

  return clamp(
    50 - ((value / baseline - 1) * 100) * 1.25,
    0,
    100
  );
}

function confidenceFor(inputs, expectedCount) {
  if (
    !inputs.length ||
    inputs.length < expectedCount
  ) {
    return 'Low';
  }

  if (
    inputs.some(
      input => input.context === 'approximate_band'
    )
  ) {
    return 'Medium';
  }

  if (
    inputs.some(
      input => input.sample_count < 3
    )
  ) {
    return 'Low';
  }

  if (
    inputs.some(
      input => input.sample_count < 12
    )
  ) {
    return 'Medium';
  }

  return 'High';
}

function valuationFor(
  history,
  latest,
  assetId,
  definition
) {
  const inputs = definition.flatMap(config => {
    const row = metricRow(
      latest.metrics,
      assetId,
      config.metric
    );

    const baseline = config.baseline_metric
      ? metricRow(
          latest.metrics,
          assetId,
          config.baseline_metric
        )
      : null;

    const bandScore =
      row && baseline
        ? approximateBandAttractiveness(
            row.value,
            baseline.value
          )
        : null;

    const normalized =
      Number.isFinite(bandScore)
        ? {
            score: bandScore,
            sample_count: 1,
            context: 'approximate_band'
          }
        : row
          ? historicalAttractiveness(
              history,
              latest,
              row,
              config.direction
            )
          : null;

    return normalized
      ? [
          {
            metric: config.metric,
            value: row.value,
            unit: row.unit,
            observation_date:
              row.observation_date,
            source: row.source,
            baseline_metric:
              config.baseline_metric ?? null,
            baseline_value:
              baseline?.value ?? null,
            weight: config.weight,
            score: normalized.score,
            sample_count:
              normalized.sample_count,
            context:
              normalized.context
          }
        ]
      : [];
  });

  const value =
    weightedAverage(inputs);

  return value === null
    ? null
    : {
        value: Math.round(value),
        inputs,
        confidence: confidenceFor(
          inputs,
          definition.length
        ),
        context: inputs.every(
          input => input.context === 'exact_percentile'
        )
          ? 'exact_percentile'
          : inputs.some(
                input => input.context === 'approximate_band'
              )
            ? 'approximate_band'
            : 'limited_history_percentile',
        partial:
          inputs.length <
          definition.length
      };
}

function finalScore(
  valuation,
  marketCondition,
  risk
) {
  return weightedAverage([
    ...(Number.isFinite(valuation)
      ? [
          {
            score: valuation,
            weight:
              OUTER_WEIGHTS.valuation
          }
        ]
      : []),

    ...(Number.isFinite(
      marketCondition
    )
      ? [
          {
            score: marketCondition,
            weight:
              OUTER_WEIGHTS.market_condition
          }
        ]
      : []),

    ...(Number.isFinite(risk)
      ? [
          {
            score: risk,
            weight:
              OUTER_WEIGHTS.risk_health
          }
        ]
      : [])
  ]);
}

const percentile = (values, value) => {
  const finite = values.filter(Number.isFinite);
  if (!finite.length || !Number.isFinite(value)) return null;
  return (
    (finite.filter(item => item <= value).length /
      finite.length) *
    100
  );
};

const sampleDeviation = values => {
  if (values.length < 2) return null;
  const mean =
    values.reduce((total, value) => total + value, 0) /
    values.length;
  return Math.sqrt(
    values.reduce(
      (total, value) => total + (value - mean) ** 2,
      0
    ) /
      (values.length - 1)
  );
};

function goldScore(baseline, allRows) {
  const price = metricRow(allRows, 'gold', 'price');
  const realYield = metricRow(allRows, 'gold', 'real_yield');
  const usd = metricRow(allRows, 'gold', 'usd_index');

  if (!price || !realYield || !usd) return null;

  const currentCpi = baseline.cpi
    .filter(row => row.date <= price.observation_date)
    .at(-1);

  const cpiByMonth = new Map(
    baseline.cpi.map(row => [row.date.slice(0, 7), row.value])
  );

  if (!currentCpi) return null;

  const realPrices = baseline.gold_price.flatMap(row => {
    const cpi = cpiByMonth.get(row.date.slice(0, 7));
    return Number.isFinite(cpi)
      ? [row.value * currentCpi.value / cpi]
      : [];
  });

  const realPricePercentile = percentile(realPrices, price.value);
  const rollingPrices = baseline.gold_price
    .slice(-120)
    .map(row => row.value);
  const rollingPercentile = percentile(rollingPrices, price.value);
  const combinedPosition =
    realPricePercentile * 0.5 + rollingPercentile * 0.5;

  const monthly = [
    ...baseline.gold_price.slice(-12).map(row => row.value),
    price.value
  ];
  const returns = monthly
    .slice(1)
    .map((value, index) => value / monthly[index] - 1);
  const twelveMonthReturn =
    (price.value / monthly[0] - 1) * 100;
  const volatility =
    sampleDeviation(returns) * Math.sqrt(12) * 100;

  const components = {
    real_yield:
      100 - percentile(
        baseline.real_yield.map(row => row.value),
        realYield.value
      ),
    usd:
      100 - percentile(
        baseline.usd_index.map(row => row.value),
        usd.value
      ),
    price_position: 100 - combinedPosition,
    // Frozen trend transform: a normal positive long-term trend stays near
    // neutral, while an unusually extended 12-month move lowers attractiveness.
    long_term_trend: clamp(
      55 - twelveMonthReturn / 4,
      20,
      80
    ),
    risk_health: riskHealth(volatility)
  };

  const score = Math.round(
    components.real_yield * 0.3 +
      components.usd * 0.2 +
      components.price_position * 0.25 +
      components.long_term_trend * 0.15 +
      components.risk_health * 0.1
  );

  return {
    score,
    components: Object.fromEntries(
      Object.entries(components).map(([key, value]) => [
        key,
        Math.round(value * 100) / 100
      ])
    ),
    diagnostics: {
      real_yield_percentile: Math.round((100 - components.real_yield) * 100) / 100,
      usd_percentile: Math.round((100 - components.usd) * 100) / 100,
      real_price_percentile: Math.round(realPricePercentile * 100) / 100,
      rolling_10y_percentile: Math.round(rollingPercentile * 100) / 100,
      combined_price_percentile: Math.round(combinedPosition * 100) / 100,
      twelve_month_return: Math.round(twelveMonthReturn * 100) / 100,
      annualized_volatility: Math.round(volatility * 100) / 100
    },
    observation_date: latestObservationDate([price, realYield, usd])
  };
}

function runDirectionalityChecks() {
  const lowerPe = approximateBandAttractiveness(18, 20);
  const higherPe = approximateBandAttractiveness(24, 20);
  if (!(lowerPe > higherPe)) {
    throw new Error('Direction check failed: lower P/E must be more attractive.');
  }

  const mockHistory = {
    records: [
      { asset_id: 'test', metric: 'yield', value: 2, observation_date: '2026-01-01' },
      { asset_id: 'test', metric: 'yield', value: 4, observation_date: '2026-02-01' }
    ]
  };
  const lowYield = historicalAttractiveness(
    mockHistory,
    { metrics: [] },
    { asset_id: 'test', metric: 'yield', value: 2 },
    'higher'
  );
  const highYield = historicalAttractiveness(
    mockHistory,
    { metrics: [] },
    { asset_id: 'test', metric: 'yield', value: 4 },
    'higher'
  );
  if (!(highYield.score > lowYield.score)) {
    throw new Error('Direction check failed: higher dividend yield must be more attractive.');
  }
}

runDirectionalityChecks();

if (process.argv.includes('--self-test')) {
  console.log('Score directionality checks passed.');
  process.exit(0);
}

const market =
  await json('data/latest-market.json');

const valuationData =
  await json('data/latest-valuation.json');

const history =
  await json('history/metrics.json');

const goldBaseline =
  await json('history/gold-score-baseline.json');

const existing =
  await json('data/market-snapshot.json');

const all = [
  ...market.metrics,
  ...valuationData.metrics
];

const assets = Object.fromEntries(
  Object.entries(existing.assets).map(
    ([id, asset]) => [
      id,
      { ...asset }
    ]
  )
);

const latestObservationDate = rows =>
  rows
    .map(row => row?.observation_date)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

for (const [id, definition] of Object.entries(
  VALUATION_MODELS
)) {
  const valuation = valuationFor(
    history,
    valuationData,
    id,
    definition
  );

  if (!valuation) {
    assets[id] = {
      ...assets[id],
      score: null,
      investment_status: '待更新',
      valuation_status: '数据待更新',
      confidence: 'Low',
      data_status: 'unavailable',
      fundamentals: null
    };

    continue;
  }

  const drawdown =
    metricRow(
      all,
      id,
      'drawdown'
    )?.value;

  const trend =
    metricRow(
      all,
      id,
      'trend'
    )?.value;

  const volatility =
    metricRow(
      all,
      id,
      'volatility'
    )?.value;

  const marketCondition =
    Number.isFinite(drawdown) &&
    Number.isFinite(trend)
      ? Math.round(
          condition(
            drawdown,
            trend
          )
        )
      : priorComponent(
          assets[id],
          'market_condition'
        );

  const risk =
    Number.isFinite(volatility)
      ? Math.round(
          riskHealth(volatility)
        )
      : priorComponent(
          assets[id],
          'risk_health'
        );

  const total = Math.round(
    finalScore(
      valuation.value,
      marketCondition,
      risk
    )
  );

  assets[id] = {
    ...assets[id],

    score: total,
    score_type:
      'simplified_valuation',

    investment_status:
      status(total),

    valuation:
      valuation.value,

    valuation_status:
      valuationStatus(
        valuation.value
      ),

    valuation_inputs:
      valuation.inputs,

    valuation_context_type:
      valuation.context,

    fundamentals: null,

    market_condition:
      marketCondition,

    risk_health:
      risk,

    score_observation_date:
      latestObservationDate([
        ...valuation.inputs,
        metricRow(
          all,
          id,
          'drawdown'
        ),
        metricRow(
          all,
          id,
          'trend'
        ),
        metricRow(
          all,
          id,
          'volatility'
        )
      ]),

    confidence:
      valuation.confidence,

    data_status:
      valuation.partial
        ? 'partial'
        : 'available',

    model:
      'production-v1-simplified-valuation'
  };
}

// Gold keeps its frozen independent five-factor model. The latest verified
// market inputs are now recalculated against official historical baselines,
// instead of leaving a newer input set attached to an older score.
const currentGold = goldScore(goldBaseline, all);

assets.gold = currentGold
  ? {
      ...existing.assets.gold,
      score: currentGold.score,
      investment_status: status(currentGold.score),
      valuation: Math.round(currentGold.components.price_position),
      valuation_status: valuationStatus(
        currentGold.components.price_position
      ),
      confidence: 'High',
      components: currentGold.components,
      diagnostics: currentGold.diagnostics,
      score_observation_date: currentGold.observation_date,
      latest_input_observation_date: currentGold.observation_date,
      score_status: 'current',
      data_status: 'available',
      model: 'production-v1-gold-frozen'
    }
  : {
      ...existing.assets.gold,
      confidence: 'Low',
      score_status: 'recalculation_required',
      data_status: 'stale'
    };

assets.csi_healthcare = {
  ...existing.assets.csi_healthcare,
  score: null,
  investment_status: '待更新',
  valuation_status: '数据待更新',
  confidence: 'Low',
  data_status: 'unavailable'
};

await save(
  'data/market-snapshot.json',
  {
    ...existing,
    as_of:
      latestObservationDate(all),
    generated_at: now(),
    model_version:
      'production-v1-simplified-valuation',
    assets
  }
);

console.log(
  'Scores recalculated using simplified valuation inputs.'
);
