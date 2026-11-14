# Astra app — how it works

The living picture of the Expo app: every screen, what the user can do on it, and the path data
takes. Every commit that adds or changes a screen, user action, module or data path updates this
file in the same commit. It draws what exists in code today; scaffolding (placeholder screens,
services not yet wired) is marked so nobody mistakes a mock-up for a working feature.

Legend: solid boxes are working features; dashed boxes are placeholder screens whose layout is
final but whose actions do nothing yet; the dotted link is a connection that does not exist yet.

```mermaid
flowchart TD
  classDef scaffold stroke-dasharray: 5 5
  classDef data fill:#eef,stroke:#669

  Launch([App launch]) --> Root["Root layout<br/>loads brand fonts, holds splash until ready,<br/>mounts the router stack (dark theme)"]
  Root --> Tabs["Tab layout<br/>five bottom tabs, Workout dead center,<br/>floating top-right profile button"]

  Tabs --> Home["Home<br/>social feed (SOC-1)<br/>today: brand + empty state pointing to Workout"]
  Tabs --> Market["Marketplace<br/>programs (MKT-1..5)<br/>today: featured-section skeleton, placeholder cards"]
  Tabs --> Workout["Workout<br/>logger front door (LOG-1) + Tool Kit preview (TK-1..5)<br/>today: final visual design, buttons inert"]
  Tabs --> Communities["Communities<br/>Teams and Gyms<br/>today: two sections, each an empty state"]
  Tabs --> Library["Library<br/>browse every launch exercise as a card"]
  Tabs -->|profile button| You["You<br/>profile skeleton: avatar ring, follow counts, PRs label<br/>today: empty values, no account yet"]

  Library -->|type a name| Search["Live name search<br/>alias-aware, e.g. Squats finds Back Squat"]
  Library -->|tap a chip| Filter["Body-region filter chips<br/>four regions + result count + no-results state"]

  subgraph LibData["Exercise library data (frontend/src/library)"]
    Seed[("exercises.ts<br/>founder's library by movement pattern:<br/>22 patterns, equipment, muscle intensities,<br/>5-step coaching cues, name aliases")]
    Catalog[("catalog.ts<br/>one entry per unique exercise (151),<br/>canonical names, searchExercises")]
    Seed --> Catalog
  end
  Catalog --> Library
  Catalog --> Search
  Catalog --> Filter

  subgraph Backend["Supabase project (live, schema applied)"]
    DB[("Postgres<br/>profiles, settings, body data, follows, blocks,<br/>exercises, workouts, workout_exercises, sets<br/>see database-erd.md")]
  end
  Root -.->|"not wired yet: no supabase-js client, no auth screens,<br/>no on-device SQLite or sync (FND-2 part 2, FND-3)"| DB

  class Home,Market,Workout,Communities,You scaffold
  class Seed,Catalog,DB data
```

## What a user can do today

1. Open the app and move between the five tabs and the You screen.
2. On Library, scroll every launch exercise, search by name (aliases included) and filter by body
   region. Nothing is written anywhere; the catalog is bundled, read-only seed data.
3. Everything else is a placeholder that renders its final layout with inert controls.

## Data path today

All data is on the device and read-only: the Library tab reads the bundled catalog, which is built
from the bundled seed module. No network calls are made. The Supabase project exists with its
schema applied and row-level security verified, but the app has no client for it yet.

## Shared pieces every screen uses

- `components/Screen.tsx` and `components/AppBackground.tsx` wrap each tab in the common chrome.
- `components/AstraTabBar.tsx` defines the five tabs once (route, label, icon) and renders the bar.
- `components/ProfileButton.tsx` is the floating route to You.
- `components/ui/` holds Button, Card, EmptyState and Text, styled from `theme/tokens.ts`.
