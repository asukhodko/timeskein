# Vendored opskarta v3 tools

This directory contains the minimal opskarta v3 toolchain vendored from
`/Users/a.sukhodko/dalamar81/opskarta`.

Vendored scope:

- `specs/v3/tools/**`
- `specs/v3/schemas/**`
- `specs/v3/ru/SPEC.min.md`

Install Python dependencies:

```bash
python3 -m pip install -r tools/opskarta/specs/v3/tools/requirements.txt
```

Validate the Timeskein roadmap:

```bash
cd tools/opskarta
python3 -m specs.v3.tools.cli validate ../../plans/timeskein/*.plan.yaml
```

Render useful views:

```bash
cd tools/opskarta
python3 -m specs.v3.tools.cli render tree ../../plans/timeskein/*.plan.yaml
python3 -m specs.v3.tools.cli render list ../../plans/timeskein/*.plan.yaml --view current
python3 -m specs.v3.tools.cli render gantt ../../plans/timeskein/*.plan.yaml --view current-gantt
python3 -m specs.v3.tools.cli render executive ../../plans/timeskein/*.plan.yaml --view exec-top
```

Refresh generated blocks in the human-readable roadmap:

```bash
cd docs/roadmap
/usr/bin/env PYTHONPATH=../../tools/opskarta python3 -m specs.v3.tools.markdown opskarta.md
```
