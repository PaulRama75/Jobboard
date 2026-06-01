# Equipment Job Board

A site-aware equipment work tracker. Track equipment status (Not Started / In Progress / Completed), assign work to employees or groups, and drill down by site, status, or assignee.

## Features

- **Job Board** — table or Kanban view (by status, by assignee) with inline status / assignee editing, search, sortable columns, per-column filters.
- **Dashboard** — clickable status cards, drill-down list, date and assignee filters, duration column.
- **Employees** — manage employees with title, shift, group, and site fields. CSV import / export.
- **Groups** — manage groups, assign members, scope per site.
- **Sites** — create sites, see per-site counts, add equipment / employees directly from a site card.
- **Users & Auth** — first-run admin setup, login, per-user role (admin / user) and per-site access. Admins manage users from a Users tab. Non-admins are scoped to their assigned sites for all data.
- **Equipment timing** — start time captured on In Progress, completion time on Completed, with a live-running duration tag.
- **CSV import/export** — equipment, employees, groups, sites. Handles BOM, comma / semicolon / tab delimiters.
- **Local-first** — all data persists in browser `localStorage`. No backend required.

## Stack

- React 18 + Vite
- lucide-react icons
- No backend / no API — single-page app with localStorage persistence

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173.

On first run you'll be prompted to create an administrator account.

## Build

```bash
npm run build
npm run preview
```

## Notes

- Passwords are stored as a non-cryptographic 13-character hash. This gates normal use; it is not a security boundary against someone with browser dev tools.
- All persistence is in browser `localStorage` under keys prefixed `jb:`. Clearing site data resets the app.
