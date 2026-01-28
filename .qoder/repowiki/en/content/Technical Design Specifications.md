# Technical Design Specifications

<cite>
**Referenced Files in This Document**
- [00_project_overview.md](file://docs/00_project_overview.md)
- [0001-initial-architecture.md](file://docs/adr/0001-initial-architecture.md)
- [0002-mvp-manual-first.md](file://docs/adr/0002-mvp-manual-first.md)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md)
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md)
- [0003-client-app-suite-architecture.md](file://docs/rfc/0003-client-app-suite-architecture.md)
- [0004-local-api.md](file://docs/rfc/0004-local-api.md)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md)
- [01_user_story_inventory.md](file://docs/mvp/01_user_story_inventory.md)
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md)
- [0001-mvp-execution-roadmap.md](file://docs/roadmap/0001-mvp-execution-roadmap.md)
- [glossary.md](file://docs/glossary.md)
</cite>

## Update Summary
**Changes Made**
- Added comprehensive documentation for Local API RFC (RFC-0004)
- Integrated Event Ingest Source Nodes RFC (RFC-0005) with SourceNode manifest and pairing protocols
- Enhanced retention, TTL, and distillation pipeline documentation (RFC-0006)
- Updated system topology to reflect new component relationships
- Refined client app suite architecture to align with manual-first approach
- Enhanced documentation structure with new RFC-based organization

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [New RFC-Based Features](#new-rfc-based-features)
7. [Dependency Analysis](#dependency-analysis)
8. [Performance Considerations](#performance-considerations)
9. [Troubleshooting Guide](#troubleshooting-guide)
10. [Conclusion](#conclusion)
11. [Appendices](#appendices)

## Introduction
This document presents the Technical Design Specifications for Timeskein's component architecture and system design. It focuses on the MVP inventory design, system topology, and client app suite architecture, with enhanced coverage of the newly added RFCs. It explains component relationships, data flow patterns, and integration mechanisms among TS-AGENT, TS-DESKTOP, TS-ANDROID, TS-HUB, and TS-SCHEMA. It documents the ports & adapters and hexagonal architecture patterns, event-driven communication protocols, and outlines API specifications for Local API, Event Ingest API, and sync protocols. The document now includes comprehensive coverage of SourceNode management, retention policies, and distillation pipelines, along with infrastructure requirements, scalability considerations, deployment topology, and the technical decisions, trade-offs, and constraints shaping the current design.

## Project Structure
Timeskein's documentation is organized around:
- Initial architecture decisions (ADR)
- Functional designs for MVP features (RFCs)
- User stories and UX for manual-first inventory
- Execution roadmap for MVP delivery
- Comprehensive RFC coverage for advanced features

```mermaid
graph TB
ADR["ADR-0001<br/>Initial Architecture"] --> RFC2["RFC-0002<br/>System Topology & Component Map"]
RFC1["RFC-0001<br/>MVP Inventory Design"] --> RFC2
RFC3["RFC-0003<br/>Client App Suite Architecture"] --> RFC2
RFC4["RFC-0004<br/>Local API"] --> RFC2
RFC5["RFC-0005<br/>Event Ingest Source Nodes"] --> RFC2
RFC6["RFC-0006<br/>Retention TTL Distillation"] --> RFC2
US1["User Story: Inventory"] --> RFC1
UX["Manual Inventory UI/UX"] --> RFC3
Roadmap["MVP Execution Roadmap"] --> RFC2
Overview["Project Overview"] --> RFC2
Glossary["Glossary"] --> RFC2
```

**Diagram sources**
- [0001-initial-architecture.md](file://docs/adr/0001-initial-architecture.md#L1-L190)
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L1-L606)
- [0003-client-app-suite-architecture.md](file://docs/rfc/0003-client-app-suite-architecture.md#L1-L498)
- [0004-local-api.md](file://docs/rfc/0004-local-api.md#L1-L340)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L1-L370)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L1-L367)
- [00_project_overview.md](file://docs/00_project_overview.md#L1-L187)
- [glossary.md](file://docs/glossary.md#L1-L244)

**Section sources**
- [00_project_overview.md](file://docs/00_project_overview.md#L1-L187)
- [0001-initial-architecture.md](file://docs/adr/0001-initial-architecture.md#L1-L190)
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L1-L606)
- [0003-client-app-suite-architecture.md](file://docs/rfc/0003-client-app-suite-architecture.md#L1-L498)
- [0004-local-api.md](file://docs/rfc/0004-local-api.md#L1-L340)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L1-L370)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L1-L367)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L1-L340)
- [01_user_story_inventory.md](file://docs/mvp/01_user_story_inventory.md#L1-L85)
- [02_manual_inventory_ui_ux.md](file://docs/mvp/02_manual_inventory_ui_ux.md#L1-L514)
- [02_user_story_manual_inventory.md](file://docs/mvp/02_user_story_manual_inventory.md#L1-L419)
- [0001-mvp-execution-roadmap.md](file://docs/roadmap/0001-mvp-execution-roadmap.md#L1-L301)
- [glossary.md](file://docs/glossary.md#L1-L244)

## Core Components
This section describes the core components and their responsibilities, focusing on the MVP inventory and the multi-device topology with enhanced coverage of new RFC-based features.

- **TS-AGENT**: Device Agent (local backend) on each device. Central point of truth for data, executes use-cases, stores locally, exposes Local API to Surfaces, accepts Event Ingest from Collectors/Connectors, integrates with Sync to Hub, and manages SourceNodes with pairing and revocation capabilities.
- **TS-DESKTOP**: Desktop Surfaces (Windows/macOS). Thin UI hosts for command palette, tray/menubar, and optional full management UI. Communicates exclusively via Local API to TS-AGENT.
- **TS-ANDROID**: Android App Surface. Mobile UI plus embedded Agent. Provides quick interactions and offline-first operation.
- **TS-HUB**: Hub Backend (central backend). Receives data/changes from devices, serves changes back, maintains a unified copy of user data, and prepares for future global indexing/aggregations.
- **TS-SYNC**: Sync Engine module inside TS-AGENT. Manages outbox/inbox, applies changes, handles minimal conflict strategy, retries/backoff, and idempotency.
- **TS-SCHEMA**: Shared Data Model & Protocol. Defines DTOs/events for Local API and Sync API, versioning, serialization/deserialization, and compatibility policies.
- **SourceNode**: Event source management system with manifest-based registration, permission-based access control, and lifecycle management.
- **Retention Engine**: Data lifecycle management system with TTL policies, distillation processes, and garbage collection.

Key architectural direction:
- Core-first / ports & adapters: domain and use-cases at the center, infrastructure on the outside.
- Deterministic time (Clock port), transactional use-cases, identical model across platforms; OS specifics only in adapters.
- Local-first and offline-first: UI and sync are optional; data stored locally.
- **Enhanced**: SourceNode management with explicit approval workflow and revocation capabilities.
- **Enhanced**: Comprehensive retention and distillation pipeline for data lifecycle management.

**Section sources**
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L144-L346)
- [0003-client-app-suite-architecture.md](file://docs/rfc/0003-client-app-suite-architecture.md#L78-L129)
- [0001-initial-architecture.md](file://docs/adr/0001-initial-architecture.md#L42-L90)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L30-L91)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L32-L78)

## Architecture Overview
The system architecture follows a device-centric model with a central Hub for multi-device synchronization. Surfaces communicate with TS-AGENT via Local API; Collectors/Connectors send events via Event Ingest API; TS-AGENT persists to local storage and coordinates with TS-SYNC to synchronize with TS-HUB. The architecture now includes comprehensive SourceNode management and retention pipeline.

```mermaid
graph TB
subgraph "Devices"
subgraph "Windows"
WSurface["TS-DESKTOP"]
WAgent["TS-AGENT"]
WCollectors["TS-COLLECTORS-WIN"]
WSourceNode["SourceNode Registry"]
WRetention["Retention Engine"]
end
subgraph "macOS"
MSurface["TS-DESKTOP"]
MAgent["TS-AGENT"]
MCollectors["TS-COLLECTORS-MAC"]
MSourceNode["SourceNode Registry"]
MRetention["Retention Engine"]
end
subgraph "Android"
AApp["TS-ANDROID"]
ACollectors["TS-COLLECTORS-ANDROID"]
ASourceNode["SourceNode Registry"]
ARetention["Retention Engine"]
end
end
subgraph "Central"
Hub["TS-HUB"]
end
WSurface -- "Local API" --> WAgent
MSurface -- "Local API" --> MAgent
AApp -- "Local API" --> AApp
WCollectors -- "Event Ingest API" --> WAgent
MCollectors -- "Event Ingest API" --> MAgent
ACollectors -- "Event Ingest API" --> AApp
WAgent -- "HTTPS Sync" --> Hub
MAgent -- "HTTPS Sync" --> Hub
AApp -- "HTTPS Sync" --> Hub
WAgent --> WSourceNode
MAgent --> MSourceNode
AApp --> ASourceNode
WAgent --> WRetention
MAgent --> MRetention
AApp --> ARetention
```

**Diagram sources**
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L88-L128)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L94-L111)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L246-L259)

**Section sources**
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L82-L128)
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L416-L459)

## Detailed Component Analysis

### TS-AGENT: Device Agent (Local Backend)
Responsibilities:
- Execute manual-first inventory use-cases
- Local storage (SQLite-equivalent)
- Local settings (hotkey, denylist, policies)
- Optional local event log
- Local API for Surfaces
- Optional ingestion from Collectors/Connectors
- Sync with Hub
- **Enhanced**: SourceNode management with pairing and revocation
- **Enhanced**: Retention pipeline coordination

Ports & Adapters:
- Domain and use-cases at the center
- OS adapters for opener, permissions, background services
- Storage adapter for SQLite
- Sync adapter for HTTPS to Hub
- Clock port for deterministic time
- **Enhanced**: SourceNode adapter for event source management
- **Enhanced**: Retention adapter for lifecycle management

Integration points:
- Surfaces: Local API commands/queries
- Collectors/Connectors: Event Ingest API
- Hub: Sync client
- **Enhanced**: SourceNode registry for event source management
- **Enhanced**: Retention engine for data lifecycle

**Section sources**
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L144-L168)
- [0003-client-app-suite-architecture.md](file://docs/rfc/0003-client-app-suite-architecture.md#L78-L97)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L171-L237)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L388-L413)

### TS-DESKTOP: Desktop Surfaces (Windows/macOS)
Responsibilities:
- Command palette overlay, tray/menubar, optional full management UI
- Execute UX flows for manual-first inventory
- No business logic or refs/denylist rules in UI
- Communication only via Local API to TS-AGENT

Deployment:
- Recommended two-process model: separate agent and UI host
- Alternative: monolithic desktop app with clear module boundaries

**Section sources**
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L241-L263)
- [0003-client-app-suite-architecture.md](file://docs/rfc/0003-client-app-suite-architecture.md#L142-L166)

### TS-ANDROID: Android App Surface
Responsibilities:
- Quick interactions (touch/state/note/add ref/open ref)
- Embedded Agent container
- Offline-first operation
- Android share sheet for importing refs

Embedded Agent:
- Same domain/use-cases/data model as desktop
- Runs as Android Service (possibly foreground for always-on)

**Section sources**
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L266-L286)
- [0003-client-app-suite-architecture.md](file://docs/rfc/0003-client-app-suite-architecture.md#L167-L178)

### TS-HUB: Hub Backend
Responsibilities:
- Device/user registration
- Receive data/changes from devices
- Serve changes back to devices
- Maintain unified user data
- Prepare for global index/search/aggregations

Security:
- Device identity, authorization, transport encryption, self-host option

**Section sources**
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L289-L306)

### TS-SYNC: Sync Engine (Agent Module)
Responsibilities:
- Outbox/inbox for changes
- Minimal conflict strategy
- Retries/backoff, offline resilience
- Idempotency (replay safety)

Strategy:
- Prefer replicating events/patches over full state reload
- Evolve to support new event types (context events, episodes)

**Section sources**
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L309-L325)

### TS-SCHEMA: Shared Data Model & Protocol
Responsibilities:
- Define DTOs/events for Local API and Sync API
- Schema versioning, serialization/deserialization
- Compatibility (backward/forward)

Direction:
- Single source of truth for contracts
- Strict version discipline

**Section sources**
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L328-L346)

### TS-COLLECTORS-* and TS-CONNECTORS (Future Contour)
Responsibilities:
- Platform-specific activity collectors
- Semantic integrations (browser extensions, Obsidian plugin, messengers)
- Convert signals to canonical events and deliver to TS-AGENT

Design:
- Collectors do not write to DB directly
- Independent enable/disable per feature
- Local-first processing: maximize cleanup/redaction on device

**Section sources**
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L349-L366)
- [0003-client-app-suite-architecture.md](file://docs/rfc/0003-client-app-suite-architecture.md#L370-L378)

### SourceNode Management System
**Enhanced**: New comprehensive system for managing event sources:

**SourceNode Manifest**:
- Unique identification (vendor.type.name format)
- Type classification (collector, connector, extension)
- Version management and capability declarations
- Permission requirements and sensitivity defaults

**Pairing Workflow**:
- Request approval with manifest presentation
- User-controlled permission scoping
- Token-based authentication for event ingestion
- Revocation capability with data cleanup

**Control Plane Functions**:
- Health monitoring and status reporting
- Enable/disable source lifecycle management
- Global ingestion control (pause/resume)
- Distillation status monitoring

**Section sources**
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L30-L91)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L94-L157)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L175-L237)

### Retention, TTL, and Distillation Pipeline
**Enhanced**: Comprehensive data lifecycle management system:

**Data Layers**:
- **Canonical**: Append-only event logs with provenance
- **Derived**: Computed representations (Episodes, Threads, summaries)
- **Ephemeral**: Heavy artifacts with time-based expiration

**TTL Policies**:
- Sensitivity-based retention (normal: 90d, sensitive: 30d, private: 7d)
- User-configurable overrides and permanent retention
- Automated cleanup with distillation prioritization

**Distillation Process**:
- "Distill before forget" principle
- Episode building from context events
- Thread updating from episode relationships
- Daily summary generation

**Garbage Collection**:
- Scheduled cleanup with provenance logging
- Artifact cleanup with content extraction
- User-triggered forced cleanup
- Audit trail for all deletions

**Section sources**
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L32-L78)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L81-L115)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L118-L174)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L177-L214)

### Data Model and Inventory Pipeline (MVP)
MVP data model and pipeline:
- WorkItem: minimal fields (id, title, type, state, pinned, timestamps, note, deleted_at)
- ContextEvent (append-only): normalized context events (active window, browser tab)
- Refs: normalized bindings (url, issue_key, repo_issue, file_path, domain, custom)
- WorkItemEvent (append-only): audit trail of changes

Pipeline:
- Collectors: active window + browser extension
- Ref extraction: deterministic rules + normalization
- Resolution: strong refs > explicit user binding > no auto-create
- Update last_seen and record work_item_events

Privacy:
- Denylist, pause, minimal metadata by default

**Section sources**
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L82-L128)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L129-L204)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L169-L172)

### Ports & Adapters and Hexagonal Architecture
- Domain and use-cases are platform-independent
- OS-specific capabilities are adapters
- Storage, OS services, and sync are externalized
- Transactional use-cases and deterministic time via Clock port
- Identical model across platforms; OS specifics only in adapters

Benefits:
- Testability and portability
- Ability to add platforms and collectors without rewriting core

**Section sources**
- [0003-client-app-suite-architecture.md](file://docs/rfc/0003-client-app-suite-architecture.md#L87-L97)
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L158-L163)

### Event-Driven Communication Protocols
- Local API: strict typing (DTOs from shared schema), stable versioning, clear error model, subscription capability
- Event Ingest API: batch acceptance, provenance (source/version/device), apply denylist/policies, idempotency
- Sync protocol: outbox/inbox, minimal conflict strategy, retries/backoff, idempotency
- **Enhanced**: SourceNode pairing protocol with token-based authentication
- **Enhanced**: Retention API for lifecycle management

**Section sources**
- [0003-client-app-suite-architecture.md](file://docs/rfc/0003-client-app-suite-architecture.md#L275-L306)
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L416-L459)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L157-L210)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L277-L320)

## New RFC-Based Features

### Local API (RFC-0004)
**Enhanced**: Comprehensive Local API specification with strict typing and security model:

**Transport Options**:
- localhost HTTP (universal)
- Unix domain sockets (macOS/Android)
- Named pipes (Windows)
- In-process (embedded Android)

**Request/Response Model**:
- Versioned requests with request_id correlation
- Success responses with result payloads
- Error responses with structured error codes
- Subscription model for real-time updates

**Error Handling**:
- validation_error: Input validation failures
- not_found: Resource not found
- conflict: Resource conflicts (ref already attached)
- privacy_blocked: Policy violation
- internal_error: System errors
- version_mismatch: Protocol version issues

**API Methods**:
- Inventory operations (list, get)
- Work Item management (create, touch, state, note, pin, delete)
- Ref operations (add, remove, open, conflict checking)
- Settings management (get, set, denylist)
- System operations (status, ping, version)

**Security Model**:
- Local-only operation (127.0.0.1 only)
- Process-level security
- Optional token-based authentication for future levels

**Section sources**
- [0004-local-api.md](file://docs/rfc/0004-local-api.md#L55-L97)
- [0004-local-api.md](file://docs/rfc/0004-local-api.md#L125-L157)
- [0004-local-api.md](file://docs/rfc/0004-local-api.md#L161-L206)
- [0004-local-api.md](file://docs/rfc/0004-local-api.md#L246-L262)

### Event Ingest + SourceNode + Pairing (RFC-0005)
**Enhanced**: Complete event ingestion system with source management:

**SourceNode Manifest**:
- source_id: Unique identifier (vendor.type.name)
- source_type: collector, connector, or extension
- version: Semantic versioning
- capabilities: Event types supported
- permissions: System and data permissions
- event_types: Generated event categories
- sensitivity_defaults: Default sensitivity levels

**Pairing Flow**:
1. Source sends pairing_request with manifest
2. Agent displays approval UI with permissions summary
3. User approves or rejects with scoped permissions
4. Agent issues token or rejection
5. Events sent with Authorization: Bearer token

**Event Envelope**:
- batch_id: Correlation for batch processing
- events: Array of individual events
- idempotency_key: Prevent duplicate processing
- provenance: Source, version, device, timestamps
- policies_applied: Applied privacy policies

**Revocation Process**:
- User-initiated source removal
- Token invalidation
- Data cleanup with provenance tracking
- User confirmation for data deletion

**Section sources**
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L40-L78)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L94-L157)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L157-L210)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L238-L271)

### Retention, TTL, and Distillation (RFC-0006)
**Enhanced**: Comprehensive data lifecycle management:

**Data Layer Architecture**:
- **Canonical Layer**: Append-only event logs with provenance
- **Derived Layer**: Computed representations (Episodes, Threads, summaries)
- **Ephemeral Layer**: Heavy artifacts with TTL (screenshots, transcripts)

**TTL Policy Framework**:
- Sensitivity-based retention periods
- User override capabilities
- Permanent retention options
- Artifact-specific policies

**Distillation Pipeline**:
- Episode Builder: ContextEvent → Episode transformation
- Thread Updater: Episode → Thread relationship building
- Daily Summary: Periodic summary generation
- Artifact Processing: Content extraction and cleanup

**Lifecycle Management**:
- Scheduled garbage collection
- Provenance logging for all deletions
- User-triggered cleanup
- Audit trail maintenance

**Storage Management**:
- Database size limits with warnings
- Artifact storage quotas
- Automatic cleanup triggers
- Critical threshold handling

**Section sources**
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L32-L78)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L81-L115)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L118-L174)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L246-L274)

## Dependency Analysis
- Surfaces depend on TS-AGENT via Local API
- Collectors/Connectors depend on TS-AGENT via Event Ingest API
- TS-AGENT depends on Storage, OS adapters, and Sync client
- TS-HUB depends on TS-SYNC for receiving changes
- TS-SCHEMA is consumed by all components for contracts and versioning
- **Enhanced**: SourceNode registry manages event source dependencies
- **Enhanced**: Retention engine coordinates with all data layers

Coupling and Cohesion:
- High cohesion within TS-AGENT domain/use-cases
- Loose coupling via ports & adapters and shared schema
- Clear separation of concerns: UI, agent, collectors, hub
- **Enhanced**: SourceNode management provides controlled coupling for event sources
- **Enhanced**: Retention pipeline maintains loose coupling through provenance

Potential Circular Dependencies:
- None identified; boundaries enforced by shared schema and adapter layers
- **Enhanced**: SourceNode and retention systems maintain clear separation

External Dependencies:
- OS capabilities via adapters
- Network via HTTPS to Hub
- Serialization/deserialization via TS-SCHEMA
- **Enhanced**: Event source tokens and permissions
- **Enhanced**: Storage quota management

**Section sources**
- [0002-system-topology-and-component-map.md](file://docs/rfc/0002-system-topology-and-component-map.md#L416-L459)
- [0003-client-app-suite-architecture.md](file://docs/rfc/0003-client-app-suite-architecture.md#L172-L213)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L275-L321)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L277-L320)

## Performance Considerations
- Debounce events to reduce churn (e.g., focus toggles)
- Indexes on timestamps, last_seen, and state for fast queries
- Append-only logs for immutable audit trails
- Idempotent sync to avoid redundant processing
- Minimal data by default to reduce IO overhead
- Background services designed for low resource usage (especially on Android)
- **Enhanced**: SourceNode token caching for reduced authentication overhead
- **Enhanced**: Retention job scheduling to minimize performance impact
- **Enhanced**: Batch processing for event ingestion to reduce overhead

## Troubleshooting Guide
Common issues and mitigations:
- Ref conflicts: explicit conflict dialog prevents duplicate refs across items
- Privacy violations: denylist blocks or redacts sensitive domains
- Offline scenarios: all operations work offline; sync resumes later
- Permission prompts: minimal permissions; explicit user action required for sensitive features
- **Enhanced**: SourceNode approval issues: check pairing tokens and permissions
- **Enhanced**: Event ingestion failures: verify SourceNode manifest and token validity
- **Enhanced**: Retention cleanup problems: check TTL policies and storage quotas
- **Enhanced**: Sync conflicts: review conflict resolution strategy and retry policies

**Section sources**
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L169-L172)
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L195-L204)
- [0003-client-app-suite-architecture.md](file://docs/rfc/0003-client-app-suite-architecture.md#L370-L398)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L238-L271)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L177-L214)

## Conclusion
Timeskein's architecture centers on a robust, local-first design with a clear separation between UI surfaces and the device agent. The ports & adapters and hexagonal architecture ensure testability and portability while enabling future expansion. The system topology supports multi-device synchronization via TS-HUB and TS-SYNC, while the shared schema ensures contract consistency. The MVP inventory design balances simplicity, privacy, and extensibility, laying a solid foundation for richer context collection and synchronization in future iterations. The newly integrated RFC-based features (Local API, SourceNode management, and retention/distillation) significantly enhance the system's operational capabilities, security model, and data lifecycle management, providing a comprehensive foundation for the evolution toward Level 2 and Level 3 functionality.

## Appendices

### MVP Inventory Data Model
- WorkItem: id, title, type, state, pinned, timestamps, note, deleted_at
- ContextEvent: id, ts, device_id, source, app_id, window_title, url, url_title, is_private, raw
- Refs: id, kind, value, confidence
- WorkItemEvent: id, ts, work_item_id, kind, payload

**Section sources**
- [0001-mvp-inventory-design.md](file://docs/rfc/0001-mvp-inventory-design.md#L82-L128)

### Enhanced RFC-Based Component Specifications
**Local API DTOs**:
- WorkItemView: id, title, type, state, pinned, note, refs_count, timestamps
- RefView: id, kind, value, is_primary
- AgentStatus: version, uptime, counts, storage path, paused

**SourceNode Manifest Fields**:
- source_id, source_type, version, name, description
- capabilities, permissions, event_types, sensitivity_defaults

**Retention Policy Structure**:
- ttl_policies: context_events, artifacts
- storage_limits: database, artifacts, screenshots
- cleanup_triggers: scheduled, manual, critical

**Section sources**
- [0004-local-api.md](file://docs/rfc/0004-local-api.md#L267-L305)
- [0005-event-ingest-source-nodes.md](file://docs/rfc/0005-event-ingest-source-nodes.md#L40-L78)
- [0006-retention-ttl-distillation.md](file://docs/rfc/0006-retention-ttl-distillation.md#L93-L108)

### MVP Execution Roadmap Highlights
- Monorepo scaffolding with core-first/hexagonal structure
- Zero vertical end-to-end slice (UI to agent)
- TS-AGENT implementation without UI
- Desktop and Android surfaces connected to agent
- Iterative implementation of user-story-02 scenarios
- Optional Hub + Sync integration
- **Enhanced**: RFC-based feature integration and testing
- **Enhanced**: SourceNode and retention system development

**Section sources**
- [0001-mvp-execution-roadmap.md](file://docs/roadmap/0001-mvp-execution-roadmap.md#L59-L301)