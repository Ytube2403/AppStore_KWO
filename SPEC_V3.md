# ASO Keyword Optimization Engine - SPEC_V3

## 1. Project Objective and Status
**Goal:** Build a specialized SaaS tool for ASO (App Store Optimization) focused on discovering, measuring, and shortlisting high-impact keyword opportunities sourced from AppTweak CSV exports.

**Current Phase:** Phase 5 (Advanced UI & Configuration Engine)
**Current Status:** Completed features include the core table view, dataset imports, keyword translation strings via Google Gemini, preset configuration saving structures, and advanced mathematical score scaling tools.

## 2. Completed Features (Up to V3)

### Core Systems
- **Database & Architecture**: Next.js 14 App Router, Supabase (PostgreSQL), and Shadcn/UI for building robust interfaces rapidly.
- **Dataset Import**: Parses unstructured / long-format CSV dataset exports from AppTweak directly into a structured database context resolving multiple competitors dynamically.
- **Localization / AI Translation**: Invokes the `gemini-2.5-flash` model to translate foreign language rows into `keyword_en` securely utilizing a chunked asynchronous parsing pipeline to prevent timeouts.

### Data Table View
- **Virtualized Lists**: Uses `@tanstack/react-virtual` preventing DOM crashes when processing subsets exceeding 10,000+ data rows.
- **KPI Metrics Dashboard**: Calculates Top N rank distribution buckets mapped to dynamic progress bars summarizing organic dataset competition value.
- **Select & Export Strategy**: Users can mark target keywords, compile custom bundles, and export `.csv` arrays formatting targeted subsets against specific algorithms seamlessly.

### Preset Optimization Engine (V3 Focus)
- **Mathematical Multipliers**: Dynamic UI configured mapping the equations weighting Relevancy vs. Difficulty vs. Volume variables.
- **Filter Chips**: "Dropdown Chip" popover inputs mimicking enterprise SaaS properties to constraint thresholds seamlessly (`Min Vol`, `Max Diff`, `Min Rank`).
- **State Drift Detection**: Warning alerts informing the active table session when an un-applied configuration drift exists in settings forms.
- **Node Matrix Evaluation**: Calculation algorithms process arrays against custom SQL boundaries on-demand whenever the Preset settings commit changes.

## 3. Next Steps & Upcoming Work
The architecture foundation is heavily established. Upcoming workflow requirements should prioritize:

- **1. Keyword Tagging & Grouping Systems**: Upgrading generic `notes` / arrays to an interactive client-side element for taxonomy assignment directly across table instances.
- **2. Team / Shared Preset Configuration Policies**: Modifying the Preset Database schema mapping configurations against Workspace structures versus localized raw objects.
- **3. AI Keyword Ideation**: Building tools integrating existing competitors sets and leveraging AI to hypothesize keyword trees tangentially alongside the raw import sets.
- **4. Production Build Validation**: Standardizing component caching and refactoring any leftover legacy logic flags prior to official alpha release hosting.
