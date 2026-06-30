# opskarta v3 Reference Tools

The v3 tools keep the v2 pipeline:

`Load -> Merge -> Validate -> Compute -> Render`

## Install

```bash
pip install -r specs/v3/tools/requirements.txt
```

## CLI

```bash
python -m specs.v3.tools.cli validate plan.yaml
python -m specs.v3.tools.cli render tree plan.yaml
python -m specs.v3.tools.cli render list plan.yaml
python -m specs.v3.tools.cli render deps plan.yaml --mode hierarchical
python -m specs.v3.tools.cli render gantt plan.yaml --view release-window --style status
python -m specs.v3.tools.cli render executive plan.yaml exec.yaml --view exec-top
python -m specs.v3.tools.cli render executive-report plan.yaml exec.yaml --section status --lang en
python -m specs.v3.tools.cli update-markdown plan.md exec.md
```

## Tool Modules

| Module | Purpose |
|--------|---------|
| `models.py` | Dataclasses for plan, schedule, execution and views. |
| `loader.py` | Load YAML fragments and merge them into one plan. |
| `validator.py` | Validate references, dates, views, execution and `x.exec`. |
| `effort.py` | Compute effort rollups and gaps. |
| `execution.py` | Compute progress rollups from `execution.nodes`. |
| `scheduler.py` | Compute schedule dates. |
| `render/` | Render tree/list/deps/gantt/executive outputs. |
| `markdown.py` | Refresh generated blocks in Markdown files. |
| `build_spec.py` | Build `SPEC.md` from `spec/*.md`. |

## Executive Rendering

```bash
python -m specs.v3.tools.cli render executive release.plan.yaml --view exec-top
python -m specs.v3.tools.cli render executive-report release.plan.yaml --section tracks --view exec-active-tracks --lang en
```

`render executive` emits Mermaid flowchart syntax. `render executive-report` emits Markdown sections:

- `status`
- `tracks`
- `signals`

By default, `status` uses `exec-top`; `tracks` and `signals` use
`exec-active-tracks`. Pass `--view` to render a different executive view and
`--lang ru|en` to choose built-in report labels.

## Markdown Refresh

`update-markdown` looks for comments:

````markdown
<!--
Перегенерить:
python -m specs.v3.tools.cli validate plan.yaml exec.yaml
python -m specs.v3.tools.cli render executive plan.yaml exec.yaml --view exec-top
-->
```mermaid
old
```
````

It runs validation commands once per document directory, runs the render command,
and replaces the immediately following Mermaid block or `GENERATED` block.
