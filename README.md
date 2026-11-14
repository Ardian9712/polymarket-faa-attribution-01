# Polymarket FAA attribution forecast

`main.ts` reads each case in `MAKEFUN_INPUT_DIR` (default `/input`) and writes one 240-minute, five-quantile forecast per market to `MAKEFUN_OUTPUT_DIR` (default `/output`). The final model uses the last price as its median. Its spread level is recent realized one-minute volatility, geometrically shrunk 70/30 toward case-pooled volatility, scaled by 0.85 and clamped to 0.25x–100x pooled volatility. For each horizon it estimates pooled empirical move quantiles in each market's own spread units, shrunk 60/40 toward normal quantile shape. Horizon samples below 200 use the normal shape. No drift or fitted width factors are enabled.

Run locally with:

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=work-kit/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`work-kit/score.mjs` is the local A–E evaluation harness. Practice p00–p04 targets use matching markets' next-case prices; p05 targets were fetched from Polymarket's public history endpoint, one request for each of its 24 markets, then carried forward onto the minute grid. The persistence reference is 0.392518 on p00–p04 and 0.363589 officially on all six practice cases.

The broken transient-era diagnostics were replaced. Tune and holdout use 66 rolling pseudo-checkpoints (33 each), only at least 24 hours after a market's first price, at four-hour intervals, with all 240 target minutes observed, split chronologically. Candidate B (empirical spread, persistence median) scores 2.881416 tune and 0.458068 holdout, versus persistence A at 2.930426 and 0.522637. On p00–p04 B scores 0.331113 versus A 0.392518. With fetched p05 targets, B scores 0.289974 across p00–p05 versus the official 0.363589 baseline; per-case B scores are 0.463886, 0.326050, 0.375824, 0.312459, 0.212491, and 0.111704. Drift (C) and width fitting (D/E) fail to beat B on tune, holdout, and p00–p04 together, so B is selected. Full per-case and per-candidate results are in `work-kit/sweep-results.json`.
