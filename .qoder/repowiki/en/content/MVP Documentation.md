# MVP Documentation

<cite>
**Referenced Files in This Document**
- [README.md](file://docs/mvp/README.md)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md)
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md)
- [01_user_story_context_capture.md](file://docs/mvp/01_user_story_context_capture.md)
- [03_user_story_evidence_mode.md](file://docs/mvp/03_user_story_evidence_mode.md)
- [03_evidence_mode_ui_ux.md](file://docs/mvp/03_evidence_mode_ui_ux.md)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md)
- [0002-mvp-manual-first.md](file://docs/adr/0002-mvp-manual-first.md)
- [0003-evidence-mode-opt-in.md](file://docs/adr/0003-evidence-mode-opt-in.md)
- [0002-level3-evidence-mode-roadmap.md](file://docs/roadmap/0002-level3-evidence-mode-roadmap.md)
- [index.md](file://docs/index.md)
</cite>

## Update Summary
**Changes Made**
- Enhanced documentation with comprehensive Evidence-Mode user stories and UI/UX specifications
- Reorganized to clearly separate Level 0 MVP from Level 3 Evidence-Mode functionality
- Added detailed Evidence-Mode acceptance criteria, privacy controls, and user interaction scenarios
- Updated architecture diagrams to reflect the new Level-based maturity system
- Expanded context capture documentation to distinguish between Level 2 and Level 3 features

## Table of Contents
1. [Introduction](#introduction)
2. [MVP Organization and Structure](#mvp-organization-and-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document consolidates the MVP specifications for manual inventory management in Timeskein, reflecting the new organizational structure with docs/mvp/README.md as the central hub. The documentation now clearly separates Level 0 manual inventory features (MVP) from future Level 2+ context capture capabilities, establishing a structured evolution from manual-first operation to automated context capture.

The MVP documentation is organized around three core user stories and specifications:
- **Level 0 (MVP)**: Manual inventory user story and UI/UX specification
- **Level 2 (Future)**: Context capture user story for automated context extraction
- **Level 3 (Future)**: Evidence-Mode user story for opt-in screen evidence capture
- **Supporting documents**: RFC design specifications and ADR architectural decisions

## MVP Organization and Structure

The MVP documentation follows a hierarchical structure that clearly separates current capabilities from future enhancements:

```mermaid
graph TB
A["MVP Documentation Hub<br/>docs/mvp/README.md"] --> B["Level 0: Manual Inventory<br/>02_user_story_manual_inventory.md"]
B --> C["UI/UX Specification<br/>02_manual_inventory_ui_ux.md"]
A --> D["Level 2: Context Capture<br/>01_user_story_context_capture.md"]
A --> E["Level 3: Evidence-Mode<br/>03_user_story_evidence_mode.md"]
E --> F["Evidence-Mode UI/UX<br/>03_evidence_mode_ui_ux.md"]
A --> G["Supporting Specifications"]
G --> H["RFC-0001: MVP Design<br/>rfc/0001-mvp-inventory-design.md"]
G --> I["ADR-0002: Manual-first<br/>adr/0002-mvp-manual-first.md"]
G --> J["ADR-0003: Evidence-Mode Opt-in<br/>adr/0003-evidence-mode-opt-in.md"]
```

**Diagram sources**
- [README.md](file://docs/mvp/README.md#L1-L43)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L1-L513)
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L1-L606)
- [01_user_story_context_capture.md](file://docs/mvp/01_user_story_context_capture.md#L1-L150)
- [03_user_story_evidence_mode.md](file://docs/mvp/03_user_story_evidence_mode.md#L1-L324)
- [03_evidence_mode_ui_ux.md](file://docs/mvp/03_evidence_mode_ui_ux.md#L1-L528)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L1-L387)
- [0002-mvp-manual-first.md](file://docs/adr/0002-mvp-manual-first.md#L1-L127)
- [0003-evidence-mode-opt-in.md](file://docs/adr/0003-evidence-mode-opt-in.md#L1-L200)

**Section sources**
- [README.md](file://docs/mvp/README.md#L1-L43)
- [index.md](file://docs/index.md#L95-L105)

## Core Components

### Level 0: Manual Inventory (MVP)
The core entity representing a task/project/question under manual-first operation:

**Work Item**: Contains title, state, note, pinned flag, last_seen_at timestamps, and optional type
**Refs**: Normalized anchors to external contexts (URLs, file paths, custom identifiers) with deduplication and conflict resolution
**Inventory List**: Filtered and sorted view based on pinned state, state rank, and recency
**Events**: Append-only logs capturing user actions and system updates for auditability

### Level 2: Context Capture (Future)
**Context Extraction**: Automated extraction of refs from current context (active window, URL, issue keys)
**SourceNode Integration**: Mechanism for connecting external data sources with explicit user approval
**Automatic State Management**: Optional automatic last_seen updates for previously linked refs

### Level 3: Evidence-Mode (Future)
**Screen Evidence Capture**: Strictly opt-in functionality for capturing screen evidence chunks with privacy controls
**Chunking Model**: Canonical artifact type `chunk` (series of frames over time period) with TTL enforcement
**Timeline Cards**: Derived view of Episodes with summary, extracted refs, and distraction marks
**Privacy-First Design**: Short TTL (72h), pause/resume, purge, and redaction rules

**Section sources**
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L54-L81)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L93-L206)
- [01_user_story_context_capture.md](file://docs/mvp/01_user_story_context_capture.md#L29-L37)
- [03_user_story_evidence_mode.md](file://docs/mvp/03_user_story_evidence_mode.md#L74-L106)

## Architecture Overview
The MVP architecture centers on a local-first agent that persists minimal context and maintains a human-readable Work Item state. The manual-first approach ensures that all actions require explicit user initiation, with future context capture capabilities built as optional extensions.

```mermaid
graph TB
subgraph "Level 0: Manual-first Agent"
UI["Manual UI/Commands"]
INV["Manual Inventory View"]
DB["SQLite Storage"]
end
subgraph "Level 2: Context Extensions"
CN["Context Extractor"]
SN["SourceNode Manager"]
AE["Auto Events"]
end
subgraph "Level 3: Evidence-Mode"
EC["Evidence Collector"]
SC["Screen Capture"]
PR["Provider Abstraction"]
end
subgraph "Data Model"
WI["Work Items"]
REFS["Refs"]
WIE["Work Item Events"]
CE["Context Events"]
EE["Evidence Artifacts"]
END
UI --> INV
INV --> DB
DB --> WI
DB --> REFS
DB --> WIE
CN --> CE
SN --> CN
AE --> CE
CE --> DB
EC --> EE
SC --> EC
PR --> EC
```

**Diagram sources**
- [0002-mvp-manual-first.md](file://docs/adr/0002-mvp-manual-first.md#L40-L57)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L80-L128)
- [01_user_story_context_capture.md](file://docs/mvp/01_user_story_context_capture.md#L45-L54)
- [03_user_story_evidence_mode.md](file://docs/mvp/03_user_story_evidence_mode.md#L74-L106)

## Detailed Component Analysis

### Level 0: Manual Inventory User Story
This story defines the manual-first ledger for Work Items, serving as the canonical specification for MVP Level 0:

**Work Item Lifecycle**: create, set state, add note, pin, attach refs, touch, open last ref
**Inventory Sorting**: pinned first, then by state rank, then by last_seen descending
**Offline-first Behavior**: Explicit user actions update last_seen; no background observation
**Privacy Safeguards**: denylist policy and pause toggle

**User Interaction Scenarios**:
- Create new Work Item quickly from current context
- Change state in one or two keystrokes
- Add refs from clipboard or file picker
- Re-open last ref to resume work
- Toggle pin to keep items at the top

**Acceptance Criteria Mapping**:
- Viewing inventory with required fields and sort order
- State changes update timestamps and last_seen
- Note editing updates timestamps and last_seen
- Touch action updates last_seen without changing state/note
- Pin toggles persist and influence sorting
- Ref management includes normalization, deduplication, and conflict resolution
- Open last ref opens appropriate context and updates last_seen
- Offline operation and local storage
- Privacy controls via denylist and pause

**Section sources**
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L46-L254)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L93-L206)

### Level 0: Manual Inventory UI/UX Specification
The UI/UX emphasizes speed and clarity through a global hotkey overlay and tray menu:

**Primary Surfaces**:
- Global hotkey overlay as primary instant-access surface
- Tray/menu bar for quick access and settings
- Minimal screens and keyboard-driven navigation
- Clear affordances for fast actions: Enter (open), T (touch), N (note), S (state), R (refs), P (pin)

**Command-line Support**: Available for power users
**Denylist UX**: Integrated during ref addition
**Onboarding Flow**: For trust and habit formation

**User Workflows**:
- Open inventory and scan pinned → state → recency
- Create item via hotkey or form; optionally add note and refs immediately
- Touch to re-prioritize an item
- Change state rapidly via numeric shortcuts or menu
- Edit note inline; show truncated note in lists
- Pin/unpin to stabilize position
- Add refs from clipboard, manual input, or file picker
- Resolve conflicts when a ref is already attached to another item
- Open last ref with automatic last_seen update

**Privacy and Error Handling**:
- Denylist blocks or redacts domain refs according to policy
- Graceful handling of missing or invalid refs
- Conflict dialog with clear choices

**Section sources**
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L80-L122)
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L194-L226)
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L246-L383)
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L386-L401)

### Level 2: Context Capture User Story
This user story describes future functionality for Level 2 expansion:

**Context Capture Capabilities**:
- Users can capture current context (active window, URL) via explicit command
- Automatic extraction of refs from current context (URL, window title, issue keys)
- Suggestions for existing Work Items based on strong refs
- Optional automatic last_seen updates for previously linked refs

**Dependencies and Limitations**:
- Requires SourceNode infrastructure and explicit user approval
- Works only when sources are connected and approved
- Does not replace manual-first as the base functionality
- Maintains user control over state and note values

**Migration Path**: Existing Work Items and refs remain unchanged; new refs gain provenance from SourceNode

**Section sources**
- [01_user_story_context_capture.md](file://docs/mvp/01_user_story_context_capture.md#L39-L83)
- [01_user_story_context_capture.md](file://docs/mvp/01_user_story_context_capture.md#L55-L83)

### Level 3: Evidence-Mode User Story
This user story defines the strictly opt-in Level 3 functionality for screen evidence capture:

**Evidence-Mode Capabilities**:
- Strictly opt-in functionality that never activates by default
- Screen evidence chunk capture with privacy controls
- Timeline Cards with summary, extracted refs, and distraction marks
- Provider selection (local/remote) with privacy indicators
- Storage budget management with automatic garbage collection
- Redaction Rules for sensitive content exclusion

**Privacy-First Design**:
- 72-hour TTL for evidence artifacts by default
- Explicit opt-in with comprehensive privacy information
- Pause/resume functionality for immediate control
- Purge capability to remove evidence while preserving distilled snapshots
- Revocation mechanism to remove all data from specific sources

**User Interaction Scenarios**:
- Enable Evidence-Mode through explicit consent process
- Monitor capture status via tray indicator
- Manage storage budget and receive warnings at thresholds
- Configure redaction rules for sensitive applications and domains
- Review Timeline Cards with evidence purged indicators
- Purge specific time ranges or all evidence with confirmation

**Acceptance Criteria Mapping**:
- Opt-in requirement with explicit privacy information display
- Status indicator visibility in tray and settings
- Pause/resume functionality with preserved configuration
- Timeline Cards display with evidence availability indicators
- Purge confirmation dialog with scope selection
- Redaction Rules configuration with multiple pattern types
- Provider selection with privacy attribute indicators
- Storage Budget warnings at 80% and critical at 95%
- Distraction Mark classification for self-analysis

**Section sources**
- [03_user_story_evidence_mode.md](file://docs/mvp/03_user_story_evidence_mode.md#L125-L252)
- [03_user_story_evidence_mode.md](file://docs/mvp/03_user_story_evidence_mode.md#L255-L289)
- [03_user_story_evidence_mode.md](file://docs/mvp/03_user_story_evidence_mode.md#L292-L324)

### Evidence-Mode UI/UX Specification
The Evidence-Mode UI emphasizes privacy transparency and user control:

**Settings Interface**:
- Dedicated Evidence-Mode panel in Settings → Privacy → Evidence-Mode
- Status section showing capture progress and storage usage
- Provider selection with privacy indicators (🔒 local, ☁️ remote)
- Redaction Rules management with multiple pattern types
- Storage Budget configuration with visual indicators

**Status Indicators**:
- Tray menu with Evidence-Mode status and quick controls
- Color-coded status: Enabled (🔴), Paused (🟡), Error (🟠)
- Persistent indicator showing capture activity level
- Storage usage percentage with warning/critical states

**Timeline View**:
- Timeline Cards showing time ranges, summaries, and extracted refs
- Distraction Mark indicators for off-task activities
- Evidence purged state with preserved snapshot information
- Preview buttons for accessible evidence artifacts
- Action menus for purge, linking to Work Items, and management

**Privacy Controls**:
- Comprehensive redaction rules for apps, domains, and content patterns
- Sensitivity classification system (normal/private/high)
- Provider privacy attributes (data stays on device, encryption)
- Consent dialogs for remote provider usage
- Storage budget warnings with automatic pause at critical levels

**Section sources**
- [03_evidence_mode_ui_ux.md](file://docs/mvp/03_evidence_mode_ui_ux.md#L34-L98)
- [03_evidence_mode_ui_ux.md](file://docs/mvp/03_evidence_mode_ui_ux.md#L100-L130)
- [03_evidence_mode_ui_ux.md](file://docs/mvp/03_evidence_mode_ui_ux.md#L133-L231)
- [03_evidence_mode_ui_ux.md](file://docs/mvp/03_evidence_mode_ui_ux.md#L234-L292)

### Inventory View and Sorting Logic
The inventory view is computed from persisted Work Items with deterministic rules:

```mermaid
flowchart TD
Start(["Compute Inventory"]) --> Load["Load Work Items (not deleted)"]
Load --> Filter["Optionally filter out done unless pinned or recent"]
Filter --> Sort["Sort by:<br/>1) pinned desc<br/>2) state rank asc<br/>3) last_seen desc (NULLs last)"]
Sort --> Output["Return WorkItemView[]"]
```

**Diagram sources**
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L145-L159)

**Section sources**
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L145-L159)

### Ref Normalization and Deduplication
Refs are normalized and deduplicated to maintain data quality:

```mermaid
flowchart TD
Start(["Add Ref"]) --> Normalize["Normalize kind/value"]
Normalize --> Find["Find existing ref by kind/value"]
Find --> Exists{"Exists?"}
Exists --> |No| Create["Create new ref"]
Exists --> |Yes| SameItem{"Same Work Item?"}
SameItem --> |Yes| Noop["No-op"]
SameItem --> |No| Warn["Warn: already linked to another item"]
Warn --> Choice{"Open existing or continue?"}
Choice --> |Open| OpenExisting["Open existing Work Item"]
Choice --> |Continue| Attach["Attach to current item"]
Create --> Attach
```

**Diagram sources**
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L402-L413)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L195-L204)

**Section sources**
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L402-L413)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L129-L144)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L195-L204)

### Privacy Controls and Denylist Policy
Manual-first privacy is enforced at ref-attachment time:

```mermaid
flowchart TD
Start(["Add Ref"]) --> CheckDeny["Is domain in denylist?"]
CheckDeny --> |No| Save["Save ref normally"]
CheckDeny --> |Yes| Policy{"Policy?"}
Policy --> |Block| Block["Reject with message"]
Policy --> |Redact_to_domain| Redact["Store domain-only ref"]
```

**Diagram sources**
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L414-L427)

**Section sources**
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L193-L206)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L414-L427)

### Evidence-Mode Privacy and Trust Guarantees
Evidence-Mode provides comprehensive privacy guarantees through explicit opt-in and granular controls:

```mermaid
flowchart TD
Start(["Enable Evidence-Mode"]) --> Consent["Show privacy information"]
Consent --> Permission["Request screen capture permission"]
Permission --> Provider["Select provider (local/remote)"]
Provider --> Activate["Activate capture"]
Activate --> Monitor["Monitor status and storage"]
Monitor --> Control["User control: pause/resume/purge/revoke"]
```

**Diagram sources**
- [03_user_story_evidence_mode.md](file://docs/mvp/03_user_story_evidence_mode.md#L127-L145)
- [03_evidence_mode_ui_ux.md](file://docs/mvp/03_evidence_mode_ui_ux.md#L296-L324)

**Section sources**
- [03_user_story_evidence_mode.md](file://docs/mvp/03_user_story_evidence_mode.md#L110-L122)
- [03_evidence_mode_ui_ux.md](file://docs/mvp/03_evidence_mode_ui_ux.md#L326-L334)

### Data Model and Event Logs
The MVP data model supports the manual inventory feature with minimal fields and append-only event logs for auditability.

```mermaid
erDiagram
WORK_ITEMS {
text id PK
text title
text type
text state
int pinned
text note
datetime created_at
datetime updated_at
datetime last_seen_at
datetime deleted_at
}
REFS {
text id PK
text kind
text value
datetime created_at
}
WORK_ITEM_REFS {
text work_item_id FK
text ref_id FK
datetime created_at
}
WORK_ITEM_EVENTS {
text id PK
datetime ts
text work_item_id FK
text kind
text payload
}
WORK_ITEMS ||--o{ WORK_ITEM_REFS : "links"
REFS ||--o{ WORK_ITEM_REFS : "attached_to"
```

**Diagram sources**
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L82-L128)

**Section sources**
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L80-L128)

### API/Use Cases (UI-Agnostic)
The following internal use cases capture the core functionality:

**Level 0 Use Cases**:
- list_inventory()
- create_work_item(title, state?, note?, refs[])
- touch_work_item(work_item_id)
- set_state(work_item_id, state)
- set_note(work_item_id, note)
- toggle_pin(work_item_id)
- add_ref(work_item_id, ref_kind, ref_value)
- remove_ref(work_item_id, ref_id)
- open_ref(work_item_id, ref_id? | last_primary)

**Level 2 Use Cases**:
- capture_context() - extract context from active window/browser
- suggest_existing_item(refs) - propose existing Work Items based on refs
- auto_update_last_seen(context_event) - update last_seen for linked refs

**Level 3 Use Cases**:
- enable_evidence_mode() - activate screen evidence capture with consent
- disable_evidence_mode() - deactivate capture and optionally purge artifacts
- pause_capture() - temporarily stop evidence collection
- resume_capture() - restart capture with preserved settings
- purge_evidence(scope) - remove evidence artifacts with confirmation
- add_redaction_rule(rule) - configure privacy rules
- select_provider(provider) - choose local/remote processing
- manage_storage_budget(budget) - configure storage limits

Each user action updates timestamps and emits events for auditability.

**Section sources**
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L173-L194)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L382-L401)
- [01_user_story_context_capture.md](file://docs/mvp/01_user_story_context_capture.md#L55-L83)
- [03_user_story_evidence_mode.md](file://docs/mvp/03_user_story_evidence_mode.md#L125-L252)

## Dependency Analysis
The MVP relies on a cohesive set of documents that define requirements, UX, and implementation scaffolding. The manual-first approach ensures that the documentation remains focused and actionable, with clear separation between current capabilities and future enhancements.

```mermaid
graph LR
A["Project Overview"] --> B["MVP Documentation Hub"]
B --> C["Level 0: Manual Inventory"]
C --> D["Manual Inventory Story"]
C --> E["Manual Inventory UI/UX"]
B --> F["Level 2: Context Capture"]
F --> G["Context Capture Story"]
B --> H["Level 3: Evidence-Mode"]
H --> I["Evidence-Mode Story"]
H --> J["Evidence-Mode UI/UX"]
B --> K["Supporting Specs"]
K --> L["RFC-0001: MVP Design"]
K --> M["ADR-0002: Manual-first"]
K --> N["ADR-0003: Evidence-Mode Opt-in"]
```

**Diagram sources**
- [index.md](file://docs/index.md#L95-L105)
- [README.md](file://docs/mvp/README.md#L1-L43)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L13-L18)
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L13-L18)
- [01_user_story_context_capture.md](file://docs/mvp/01_user_story_context_capture.md#L10-L15)
- [03_user_story_evidence_mode.md](file://docs/mvp/03_user_story_evidence_mode.md#L13-L18)
- [03_evidence_mode_ui_ux.md](file://docs/mvp/03_evidence_mode_ui_ux.md#L13-L18)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L14-L20)
- [0002-mvp-manual-first.md](file://docs/adr/0002-mvp-manual-first.md#L13-L18)
- [0003-evidence-mode-opt-in.md](file://docs/adr/0003-evidence-mode-opt-in.md#L13-L18)

**Section sources**
- [index.md](file://docs/index.md#L95-L105)
- [0002-mvp-manual-first.md](file://docs/adr/0002-mvp-manual-first.md#L40-L57)

## Performance Considerations
- Keep UI responsive by minimizing DOM updates and using virtualization for long lists
- Use efficient sorting and filtering in memory or via SQL with proper indexes
- Debounce frequent actions (e.g., search/filter) to avoid unnecessary recomputation
- Persist changes immediately to reduce latency and improve reliability
- Avoid network operations during manual inventory tasks to maintain offline-first behavior
- Design Level 2+ features to be opt-in and configurable to minimize performance impact
- Implement Evidence-Mode chunking model to limit storage growth and processing overhead
- Use background processing for evidence capture to minimize UI blocking
- Cache frequently accessed Timeline Cards to improve responsiveness

## Troubleshooting Guide
Common UX issues and expectations:

**Level 0 Issues**:
- Ref does not open (file removed or app missing): show clear message and suggest editing refs
- Empty or invalid ref added: reject and prompt for correction
- Conflicting ref already exists: present choice to open existing item or proceed
- Denylist policy triggered: explain action as privacy protection and offer alternatives

**Level 2 Issues**:
- SourceNode not connected: prompt user to approve and connect source
- Context extraction fails: fallback to manual ref entry
- Auto-update conflicts: respect user's manual state/note decisions

**Level 3 Issues**:
- Evidence-Mode not enabled: explain opt-in requirement and privacy benefits
- Storage budget exceeded: show warning and suggest purge or increase budget
- Screen capture permission denied: guide user through system permission settings
- Provider selection issues: explain privacy implications and offer alternatives
- Redaction Rules conflicts: show which content was excluded and why
- Timeline Card rendering problems: check evidence availability and purged state

**Section sources**
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L428-L449)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L187-L206)
- [03_evidence_mode_ui_ux.md](file://docs/mvp/03_evidence_mode_ui_ux.md#L402-L400)

## Conclusion
The MVP manual inventory feature provides a fast, private, and offline-first way to track current work, establishing a robust foundation for future context capture capabilities. The new organizational structure with docs/mvp/README.md as the central hub clarifies the distinction between Level 0 manual-first operation and Level 2+ automated context capture, ensuring that the core manual-first principles remain intact while providing a clear migration path for future enhancements.

The enhanced Evidence-Mode documentation demonstrates the evolution toward Level 3 functionality while maintaining strict opt-in requirements and comprehensive privacy controls. Evidence-Mode serves as a strictly opt-in enhancement that preserves manual-first principles while adding screen evidence capture capabilities with granular user control.

The consolidated documentation establishes a clear foundation for implementation while preserving the simplicity and trust of manual-first operation. Future context capture functionality will build upon this foundation without compromising the core manual-first principles, maintaining user control and privacy throughout the evolution.

## Appendices

### Gherkin Scenarios
Representative scenarios derived from the user stories:

**Level 0 Scenarios**:
- Scenario: Check what is currently relevant
  - Given the user has several Work Items
  - When the user opens the Inventory
  - Then they see a list of relevant items, their state, and last contact

- Scenario: Capture a new work item from current context
  - Given the user is viewing a ticket page
  - When they create a Work Item from the current context
  - Then a Work Item is created with a title from the page and a ref to the URL

- Scenario: Set a "waiting" state with a note
  - Given a Work Item "Designer review" exists
  - When the user sets state to waiting and adds a note "awaiting review by Friday"
  - Then the Work Item appears in the inventory as waiting with the note

**Level 2 Scenarios**:
- Scenario: Capture context automatically
  - Given a browser extension is connected as SourceNode
  - When the user triggers "Capture current context"
  - Then the system extracts URL and issue keys and suggests existing Work Items

- Scenario: Automatic last_seen update
  - Given a Work Item with URL ref exists
  - When the user returns to the same URL
  - Then the system updates last_seen automatically

**Level 3 Scenarios**:
- Scenario: Enable Evidence-Mode with privacy consent
  - Given the user wants to capture screen evidence
  - When they enable Evidence-Mode through explicit consent
  - Then the system requests screen capture permission and explains privacy controls

- Scenario: Manage storage budget warnings
  - Given Evidence-Mode is capturing screen evidence
  - When storage reaches 80% capacity
  - Then the system shows warning and suggests purge or increase budget

- Scenario: Configure redaction rules
  - Given Evidence-Mode is enabled
  - When the user adds redaction rules for sensitive applications
  - Then the system excludes those applications from evidence capture

**Section sources**
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L255-L284)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L257-L270)
- [01_user_story_context_capture.md](file://docs/mvp/01_user_story_context_capture.md#L93-L120)
- [03_user_story_evidence_mode.md](file://docs/mvp/03_user_story_evidence_mode.md#L255-L289)