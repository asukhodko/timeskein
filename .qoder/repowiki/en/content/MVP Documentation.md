# MVP Documentation

<cite>
**Referenced Files in This Document**
- [00_project_overview.md](file://docs/00_project_overview.md)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md)
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md)
- [01_user_story_context_capture.md](file://docs/mvp/01_user_story_context_capture.md)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md)
- [0002-mvp-manual-first.md](file://docs/adr/0002-mvp-manual-first.md)
</cite>

## Update Summary
**Changes Made**
- Consolidated user story documentation with enhanced manual inventory story replacing the previous inventory story
- Added new context capture user story for Level 2 functionality
- Updated UI/UX documentation to reflect manual-first approach consolidation
- Revised project structure to reflect the new documentation organization
- Updated references to reflect the removal of the old user story file

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document consolidates the MVP specifications for manual inventory management in Timeskein. It focuses on the user story for manual-first work inventory, acceptance criteria, user interaction scenarios, UI/UX design principles, and how these requirements translate into system functionality. The documentation now reflects the consolidated approach where the manual inventory user story serves as the canonical specification for MVP, with context capture functionality reserved for future levels.

## Project Structure
The MVP documentation is organized around the consolidated user story and supporting specifications:
- A comprehensive user story describing the manual inventory feature and its acceptance criteria
- A UI/UX specification for the manual inventory experience
- A context capture user story for future expansion
- An RFC detailing the MVP design, including data model, pipeline, and privacy policies
- An ADR establishing the manual-first architecture and principles for MVP

```mermaid
graph TB
A["Project Overview<br/>docs/00_project_overview.md"] --> B["Manual Inventory User Story<br/>docs/mvp/02_user_story_manual_inventory.md"]
B --> C["Manual Inventory UI/UX<br/>docs/mvp/02_manual_inventory_ui_ux.md"]
B --> D["RFC: MVP Inventory Design<br/>docs/rfc/0001-mvp-inventory-design.md"]
B --> E["Context Capture User Story<br/>docs/mvp/01_user_story_context_capture.md"]
D --> F["ADR: Manual-first Architecture<br/>docs/adr/0002-mvp-manual-first.md"]
E --> D
```

**Diagram sources**
- [00_project_overview.md](file://docs/00_project_overview.md#L1-L187)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L1-L513)
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L1-L570)
- [01_user_story_context_capture.md](file://docs/mvp/01_user_story_context_capture.md#L1-L135)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L1-L340)
- [0002-mvp-manual-first.md](file://docs/adr/0002-mvp-manual-first.md#L1-L124)

**Section sources**
- [00_project_overview.md](file://docs/00_project_overview.md#L116-L136)

## Core Components
- Work Item: The core entity representing a task/project/question. It includes title, state, note, pinned flag, last_seen_at, timestamps, and optional type.
- Refs: Normalized anchors to external contexts (URLs, file paths, custom identifiers). They support deduplication and conflict resolution.
- Inventory list: A filtered and sorted view of Work Items based on pinned state, state rank, and recency.
- Events: Append-only logs capturing user actions and system updates for auditability and future event-sourcing.

Key acceptance criteria covered:
- Viewing inventory with title, state, relative last_seen, and note
- Fast state transitions (active, waiting, blocked, done, someday, unknown)
- Creating items from current context and attaching refs
- Opening the last ref with automatic last_seen update
- Privacy controls via denylist and pause
- Full offline operation with local storage

**Section sources**
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L54-L81)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L93-L206)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L80-L128)

## Architecture Overview
The MVP architecture centers on a local-first agent that persists minimal context and maintains a human-readable Work Item state. Data is stored locally (SQLite), and UI surfaces are designed for speed and clarity. The manual-first approach ensures that all actions require explicit user initiation.

```mermaid
graph TB
subgraph "Local Agent"
UI["UI/Commands"]
INV["Inventory View"]
DB["SQLite Storage"]
end
subgraph "Data Model"
WI["Work Items"]
REFS["Refs"]
WIE["Work Item Events"]
END
UI --> INV
INV --> DB
DB --> WI
DB --> REFS
DB --> WIE
```

**Diagram sources**
- [0002-mvp-manual-first.md](file://docs/adr/0002-mvp-manual-first.md#L40-L57)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L80-L128)

## Detailed Component Analysis

### Manual Inventory User Story
This story defines the manual-first ledger for Work Items, serving as the canonical specification for MVP:
- Work Item lifecycle: create, set state, add note, pin, attach refs, touch, open last ref
- Inventory sorting: pinned first, then by state rank, then by last_seen descending
- Offline-first behavior with explicit user actions updating last_seen
- Privacy safeguards: denylist policy and pause toggle

User interaction scenarios:
- Create a new Work Item quickly from current context
- Change state in one or two keystrokes
- Add refs from clipboard or file picker
- Re-open the last ref to resume work
- Toggle pin to keep items at the top

Acceptance criteria mapping:
- Viewing inventory with required fields and sort order
- State changes update timestamps and last_seen
- Note editing updates timestamps and last_seen
- Touch action updates last_seen without changing state/note
- Pin toggles persist and influence sorting
- Ref management includes normalization, deduplication, and conflict resolution
- Open last ref opens the appropriate context and updates last_seen
- Offline operation and local storage
- Privacy controls via denylist and pause

**Section sources**
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L46-L254)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L93-L206)

### UI/UX Specification for Manual Inventory
The UI/UX emphasizes speed and clarity through a global hotkey overlay and tray menu:
- Global hotkey overlay as the primary surface for instant access
- Tray/menu bar for quick access and settings
- Minimal screens and keyboard-driven navigation
- Clear affordances for fast actions: Enter (open), T (touch), N (note), S (state), R (refs), P (pin)
- Command-line support for power users
- Denylist UX during ref addition
- Onboarding flow for trust and habit formation

User workflows:
- Open inventory and scan pinned → state → recency
- Create item via hotkey or form; optionally add note and refs immediately
- Touch to re-prioritize an item
- Change state rapidly via numeric shortcuts or menu
- Edit note inline; show truncated note in lists
- Pin/unpin to stabilize position
- Add refs from clipboard, manual input, or file picker
- Resolve conflicts when a ref is already attached to another item
- Open last ref with automatic last_seen update

Privacy and error handling:
- Denylist blocks or redacts domain refs according to policy
- Graceful handling of missing or invalid refs
- Conflict dialog with clear choices

**Section sources**
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L80-L122)
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L194-L226)
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L246-L383)
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L386-L401)

### Context Capture User Story (Level 2)
This user story describes future functionality for Level 2 expansion:
- Users can capture current context (active window, URL) via explicit command
- Automatic extraction of refs from current context (URL, window title, issue keys)
- Suggestions for existing Work Items based on strong refs
- Optional automatic last_seen updates for previously linked refs

Dependencies and limitations:
- Requires SourceNode infrastructure and explicit user approval
- Works only when sources are connected and approved
- Does not replace manual-first as the base functionality
- Maintains user control over state and note values

**Section sources**
- [01_user_story_context_capture.md](file://docs/mvp/01_user_story_context_capture.md#L39-L83)
- [01_user_story_context_capture.md](file://docs/mvp/01_user_story_context_capture.md#L55-L83)

### Inventory View and Sorting Logic
The inventory view is computed from persisted Work Items with deterministic rules:
- Filter out deleted items
- Optionally hide done items unless pinned or recently touched
- Sort by pinned flag, state rank, and last_seen descending (nulls last)

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
- URL: trim, lowercase scheme/host, strip fragment, optional tracking params
- File path: trim and normalize separators per OS
- Custom: trim and reject empty strings

Deduplication and conflict handling:
- If adding an existing ref to the same item: no-op
- If adding a ref already attached to another item: warn and offer to open existing or continue

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
- Denylist domains with two policies: block or redact_to_domain
- Redacted refs are stored as a special kind/value pair indicating domain-only

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
- list_inventory()
- create_work_item(title, state?, note?, refs[])
- touch_work_item(work_item_id)
- set_state(work_item_id, state)
- set_note(work_item_id, note)
- toggle_pin(work_item_id)
- add_ref(work_item_id, ref_kind, ref_value)
- remove_ref(work_item_id, ref_id)
- open_ref(work_item_id, ref_id? | last_primary)

Each user action updates timestamps and emits events for auditability.

**Section sources**
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L173-L194)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L382-L401)

## Dependency Analysis
The MVP relies on a cohesive set of documents that define requirements, UX, and implementation scaffolding. The manual-first approach ensures that the documentation remains focused and actionable.

```mermaid
graph LR
A["Project Overview"] --> B["Manual Inventory Story"]
B --> C["Manual Inventory UI/UX"]
B --> D["RFC: MVP Inventory Design"]
D --> E["ADR: Manual-first Architecture"]
B --> F["Context Capture Story"]
F --> D
```

**Diagram sources**
- [00_project_overview.md](file://docs/00_project_overview.md#L116-L136)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L13-L18)
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L13-L18)
- [01_user_story_context_capture.md](file://docs/mvp/01_user_story_context_capture.md#L10-L15)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L14-L20)
- [0002-mvp-manual-first.md](file://docs/adr/0002-mvp-manual-first.md#L13-L18)

**Section sources**
- [00_project_overview.md](file://docs/00_project_overview.md#L116-L136)
- [0002-mvp-manual-first.md](file://docs/adr/0002-mvp-manual-first.md#L40-L57)

## Performance Considerations
- Keep UI responsive by minimizing DOM updates and using virtualization for long lists
- Use efficient sorting and filtering in memory or via SQL with proper indexes
- Debounce frequent actions (e.g., search/filter) to avoid unnecessary recomputation
- Persist changes immediately to reduce latency and improve reliability
- Avoid network operations during manual inventory tasks to maintain offline-first behavior

## Troubleshooting Guide
Common UX issues and expectations:
- Ref does not open (file removed or app missing): show a clear message and suggest editing refs
- Empty or invalid ref added: reject and prompt for correction
- Conflicting ref already exists: present a choice to open existing item or proceed
- Denylist policy triggered: explain the action as a privacy protection and offer alternatives

**Section sources**
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L428-L449)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L187-L206)

## Conclusion
The MVP manual inventory feature provides a fast, private, and offline-first way to track current work. It centers on explicit user actions to manage Work Items, with a clean UI that supports rapid state changes, note-taking, and ref management. The consolidated documentation establishes a clear foundation for implementation while preserving the simplicity and trust of manual-first operation. Future context capture functionality will build upon this foundation without compromising the core manual-first principles.

## Appendices

### Gherkin Scenarios
Representative scenarios derived from the user stories:

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

**Section sources**
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L255-L284)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L257-L270)