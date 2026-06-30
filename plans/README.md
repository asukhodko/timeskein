# Timeskein plans

The current executable roadmap is the opskarta v3 plan set in
`plans/timeskein/*.plan.yaml`.

The old `timeskein_mvp` v1 files are kept in `plans/legacy/` as historical
context only.

Validate the current plan:

```bash
cd tools/opskarta
python3 -m specs.v3.tools.cli validate ../../plans/timeskein/*.plan.yaml
```

Read the rendered roadmap in `docs/roadmap/opskarta.md`.
