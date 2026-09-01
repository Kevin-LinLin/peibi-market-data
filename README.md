# Peibi Market Data

Public, static data endpoint for the Peibi monthly allocation app. It is intentionally separate from the production UI: GitHub Actions refreshes and validates data, while the existing `chatgpt.site` app only reads the published JSON at runtime.

## Published endpoints

After GitHub Pages is enabled for this repository, the endpoints are:

- `/data/latest-market.json`
- `/data/latest-valuation.json`
- `/data/market-snapshot.json`
- `/data/data-health.json`

The expected base URL is `https://<owner>.github.io/peibi-market-data`.

## Data rules

- `observation_date` is the date the value represents. It is never advanced merely because a check ran.
- `retrieved_at` records when this repository obtained the record.
- `latest_available_checked_at` advances only after a source check succeeds.
- History is append-only and deduplicated by `asset_id + metric + observation_date`.
- A failed refresh preserves the prior valid snapshot (Last Known Good).
- Every generated JSON file passes `scripts/validate-data.js` before a workflow commits or publishes it.

## Local commands

```sh
npm run validate
npm run score
npm run refresh:daily
npm run refresh:weekly
```

The workflow will only write data after validation. Metrics without a stable, machine-readable reliable source remain unchanged and are listed in the refresh log for manual review.
