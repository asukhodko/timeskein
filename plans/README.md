# Timeskein plans

The current executable roadmap is the opskarta v3 plan set in
`plans/timeskein/*.plan.yaml`.

The old `timeskein_mvp` v1 files are kept in `plans/legacy/` as historical
context only.

The committed capability order is:

1. accept Working Memory Bridge through the real D0/D1/D4/D11 protocol;
2. promote confirmed change into causal period review;
3. clarify and prune incoming inventory;
4. run one bounded automatic-context probe behind trust controls.

Unscheduled ideas remain in
`docs/product-memory-and-future-capabilities.md`; they do not become plan nodes
until they have a user outcome, a minimal slice, and a real-use gate.

Validate the current plan:

```bash
cd tools/opskarta
python3 -m specs.v3.tools.cli validate ../../plans/timeskein/*.plan.yaml
```

Read the rendered roadmap in `docs/roadmap/opskarta.md`.
