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
      metric: 'pe',
      weight: 1,
      direction: 'lower'
    }
  ],

  sp500: [
    {
      metric: 'pe',
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

function confidenceFor(inputs, expectedCount) {
  if (
    !inputs.length ||
    inputs.length < expectedCount ||
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

    const normalized =
      row &&
      historicalAttractiveness(
        history,
        latest,
        row,
        config.direction
      );

    return normalized
      ? [
          {
            metric: config.metric,
            value: row.value,
            unit: row.unit,
            observation_date:
              row.observation_date,
            source: row.source,
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
          input =>
            input.context ===
            'exact_percentile'
        )
          ? 'exact_percentile'
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

const market =
  await json('data/latest-market.json');

const valuationData =
  await json('data/latest-valuation.json');

const history =
  await json('history/metrics.json');

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

// Gold is deliberately copied unchanged:
// its independent frozen model is outside Stage B.
assets.gold = {
  ...existing.assets.gold
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
    generated_at: now(),
    model_version:
      'production-v1-simplified-valuation',
    assets
  }
);

console.log(
  'Scores recalculated using simplified valuation inputs.'
);
