# 🔑 ASO Keyword Optimization Engine

> A specialized SaaS tool for **App Store Optimization (ASO)** — discover, score, and shortlist high-impact keywords from AppTweak CSV exports. Built for mobile UA & ASO teams who need speed, precision, and data-driven decisions.

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green?logo=supabase)](https://supabase.com)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)](https://vercel.com)

---

## 📌 What is this?

**ASO Keyword Optimization Engine** is a private-by-default SaaS tool built for ASO professionals. It helps you:

- **Import** AppTweak CSV keyword exports with multi-competitor columns
- **Score & rank** keywords using a fully configurable weighted formula
- **Filter** by volume, difficulty, KEI, my rank, competitor relevancy
- **Select** target keywords (with shift/ctrl multi-select support)
- **Export** selected keywords to CSV or XLSX for team sharing

The tool is inspired by AppTweak's UX: table-first layout, filter chips, proof panel, and summary bar — but fully customizable for your team's scoring criteria.

---

## ✨ Features

### 📥 Dataset Import
- Upload AppTweak-exported CSV files directly
- Auto-detects rank columns (`Rank - App Name` format)
- Supports up to **10 competitors** per dataset
- Smart deduplication & normalization (lowercase, trim, null handling)
- Chunked async import pipeline — handles **10,000+ keywords** without timeout

### 🔢 Scoring Engine
- **Configurable weighted formula**: `Total Score = wRel×Rel + wVol×Vol + wKEI×KEI − wDiff×Diff − wRank×Penalty`
- Normalize metrics (Volume, Difficulty, KEI) per dataset min-max
- Optional log-transform for Volume
- Keyword relevancy scoring based on competitor rank distribution

### 🎛️ Preset System
- Save/load scoring configurations per workspace
- Built-in presets: **Balanced**, **Relevancy-First**, **Low Competition**, **Volume Growth**, **UA Focus**
- State drift detection — alerts when unsaved changes exist
- Filter presets for thresholds (Min Volume, Max Difficulty, Min Rank)

### 📊 Keyword Table
- Virtualized rendering via `@tanstack/react-virtual` — no DOM crash at large datasets
- Sortable columns: Volume, Difficulty, KEI, Relevancy Score, Total Score
- Column chooser — show/hide competitor rank columns
- KPI stats panel with rank distribution buckets

### 🔍 Proof Panel
- Click any keyword to see competitor rank breakdown
- Derived metrics: `competitor_ranked_count`, `competitor_topN_count`, `competitor_best_rank`
- Score explanation breakdown

### 🌐 AI Translation
- Translates non-English keywords to English using **Google Gemini 2.5 Flash**
- Chunked async pipeline to prevent Vercel timeout limits

### 📤 Export
- Export **selected keywords** or **filtered results**
- Formats: **CSV** and **XLSX** (multi-sheet with preset metadata)
- Formula injection sanitization for safe Excel use

### 🔒 Security
- Multi-tenant isolation via **Supabase Row Level Security (RLS)**
- Workspace invite system (email-based, with roles: owner/editor/viewer)
- Secrets managed via Vercel environment variables (never exposed to client)

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) + TypeScript |
| Auth & Database | Supabase (PostgreSQL + Auth + RLS) |
| Hosting | Vercel |
| Table | TanStack Table + TanStack Virtual |
| UI | shadcn/ui + Tailwind CSS |
| CSV Parsing | PapaParse |
| Excel Export | SheetJS (xlsx) |
| AI Translation | Google Gemini 2.5 Flash API |
| Background Jobs | Cloudflare Worker (heavy processing) |
| Testing | Playwright |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project
- A [Vercel](https://vercel.com) account (for deployment)
- Google Gemini API key (for AI translation)

### 1. Clone & Install

```bash
git clone https://github.com/Ytube2403/AppStore_KWO.git
cd AppStore_KWO
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in the project root:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Server-only (never expose to client)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Google Gemini (for AI translation)
GEMINI_API_KEY=your-gemini-api-key
```

### 3. Set Up the Database

Run migrations against your Supabase project:

```bash
npx supabase db push
```

Or manually apply SQL files from the `supabase/migrations/` folder in the Supabase Dashboard SQL Editor.

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📖 How to Use

### Step 1 — Sign In
- Go to the app and sign in with Google or Email Magic Link
- You'll land on your **Workspace list**

### Step 2 — Create a Workspace
- Click **"New Workspace"**
- Name it (e.g., "My App - iOS US")
- Optionally invite teammates by email with a role (editor/viewer)

### Step 3 — Import a Dataset
1. Open your workspace
2. Click **"Import Dataset"**
3. Upload your **AppTweak CSV export**
4. Map columns:
   - Select which column is **Keyword**, **Volume**, **Difficulty**, **KEI**
   - Choose **My App's rank column** (radio)
   - Choose **Competitor rank columns** (checkboxes, up to 10)
5. Click **"Build Dataset"** — keywords are parsed, scored, and stored

### Step 4 — Filter & Score Keywords
- Use **filter chips** at the top: Min Volume, Max Difficulty, Min Rank, Relevancy
- Switch between **Presets** to apply different scoring strategies
- Adjust weights in the Preset panel and click **Apply**

### Step 5 — Select Target Keywords
- **Click** a row to select it
- **Shift+Click** to select a range
- **Ctrl/Cmd+Click** to add/remove individual rows
- Selected keywords appear in the **bottom drawer**

### Step 6 — Add Notes & Tags
- In the Selected drawer, add **tags** (e.g., `high-priority`, `brand`) or **notes** to selected keywords

### Step 7 — Export
- Click **"Export"** from the Selected drawer or header
- Choose format: **CSV** or **XLSX**
- Options:
  - Export Selected only (recommended)
  - Include proof fields (competitor ranks, derived metrics)
  - Include Preset metadata sheet (XLSX only)

---

## 📁 Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/              # Server routes (import, export, scoring)
│   │   ├── app/              # Client pages (workspace, dataset views)
│   │   ├── auth/             # Auth callback
│   │   └── login/            # Login page
│   └── lib/                  # Utilities, Supabase client, scoring logic
├── supabase/
│   └── migrations/           # Database migration SQL files
├── worker/
│   └── src/                  # Cloudflare Worker for heavy async jobs
├── tests/                    # Playwright e2e tests
├── public/                   # Static assets
└── components.json           # shadcn/ui configuration
```

---

## 🔑 Scoring Formula

The **Total Score** is computed as:

```
Total Score = wRel × RelevancyScore
            + wVol × NormalizedVolume
            + wKEI × NormalizedKEI
            − wDiff × NormalizedDifficulty
            − wRank × RankPenalty
```

**Relevancy Score** is based on competitor rank distribution:
- `TopFactor = competitors_in_top_N / total_competitors`
- `RankedFactor = competitors_ranked / total_competitors`
- `BestRankFactor = (T − min(best_rank, T)) / T`

All weights and thresholds are configurable per preset.

---

## 🔐 Security Model

- All data is **private by default** — users only see workspaces they own or are invited to
- Access control enforced at the **database level** via Supabase RLS policies
- Role capabilities: **Owner** (full control) → **Editor** (read + write) → **Viewer** (read-only)
- Invite system: pending invites with expiry, accept/revoke support
- CSV export: sanitized against formula injection attacks

---

## 📜 License

Private repository — internal tool for ASO/UA teams.

---

*Built with ❤️ using Next.js, Supabase, and Vercel.*
