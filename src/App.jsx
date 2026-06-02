import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Users, User, Wrench, LayoutDashboard, Plus, Trash2, Upload,
  Download, CircleDot, Clock, CheckCircle2, X, Search, Calendar, ChevronDown, Building2,
  Lock, LogOut, Shield, ShieldCheck, Eye, EyeOff
} from "lucide-react";

// ---------- storage helpers (localStorage) ----------
const K = {
  emps: "jb:employees",
  groups: "jb:groups",
  equip: "jb:equipment",
  sites: "jb:sites",
  users: "jb:users",
  currentUser: "jb:currentUser",
};

// Non-crypto hash for "is this the same password" comparison (localStorage app, not real security).
function hashPassword(str, salt = "jb_v1") {
  const s = salt + str;
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(13, "0");
}

function canAccessSite(user, siteName) {
  if (!user) return false;
  if (user.role === "admin" || user.sites === "all") return true;
  return Array.isArray(user.sites) && user.sites.includes(siteName);
}

function visibleSitesFor(user, sites) {
  if (!user) return [];
  if (user.role === "admin" || user.sites === "all") return sites;
  if (!Array.isArray(user.sites)) return [];
  return sites.filter(s => user.sites.includes(s.name));
}
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.error(e); }
}
const uid = () => Math.random().toString(36).slice(2, 10);
const today = () => new Date().toISOString().slice(0, 10);

function durationMs(eq, now) {
  if (!eq.startedAt) return null;
  const start = new Date(eq.startedAt).getTime();
  const end = eq.completedAt ? new Date(eq.completedAt).getTime() : now;
  return Math.max(0, end - start);
}
function formatDuration(ms) {
  if (ms == null) return null;
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return "<1m";
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  const parts = [];
  if (d) parts.push(d + "d");
  if (h) parts.push(h + "h");
  if (m && d === 0) parts.push(m + "m");
  return parts.join(" ") || "<1m";
}
// Returns a tier label for in-progress equipment based on how long it has been running.
// Thresholds (hours) are configurable but use sensible defaults.
const PROGRESS_TIERS = { warn: 4, overdue: 8 };
// Effective supervisor for a piece of equipment: explicit lead (if set), else the assigned group's supervisor.
function effectiveSupervisor(eq, employees, groups) {
  if (eq.lead) {
    const e = employees.find(x => x.id === eq.lead);
    if (e) return e;
  }
  if (eq.assigneeType === "group") {
    const g = groups.find(x => x.id === eq.assigneeId);
    if (g) {
      const members = employees.filter(e => g.members.includes(e.id));
      return members.find(e => /supervis|lead|foreman/i.test(e.title || "")) || members[0] || null;
    }
  }
  if (eq.assigneeType === "employee") {
    return employees.find(x => x.id === eq.assigneeId) || null;
  }
  return null;
}

function inProgressTier(eq, now) {
  if (eq.status !== "in_progress" || !eq.startedAt) return "";
  const hours = (now - new Date(eq.startedAt).getTime()) / 3600000;
  if (hours >= PROGRESS_TIERS.overdue) return "overdue";
  if (hours >= PROGRESS_TIERS.warn) return "warn";
  return "fresh";
}

function useTick(activeIntervalMs = 60000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), activeIntervalMs);
    return () => clearInterval(id);
  }, [activeIntervalMs]);
  return now;
}

const STATUS = {
  not_started: { label: "Not Started", color: "var(--s-grey)", icon: CircleDot },
  in_progress: { label: "In Progress", color: "var(--s-amber)", icon: Clock },
  completed:   { label: "Completed",   color: "var(--s-green)", icon: CheckCircle2 },
};
const STATUS_ORDER = ["not_started", "in_progress", "completed"];

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [employees, setEmployees] = useState(() => load(K.emps, []));
  const [groups, setGroups] = useState(() => load(K.groups, []));
  const [equipment, setEquipment] = useState(() => load(K.equip, []));
  const [sites, setSites] = useState(() => load(K.sites, []));
  const [users, setUsers] = useState(() => load(K.users, []));
  const [currentUserId, setCurrentUserId] = useState(() => load(K.currentUser, ""));
  const [currentSite, setCurrentSite] = useState("");

  useEffect(() => { save(K.emps, employees); }, [employees]);
  useEffect(() => { save(K.groups, groups); }, [groups]);
  useEffect(() => { save(K.equip, equipment); }, [equipment]);
  useEffect(() => { save(K.sites, sites); }, [sites]);
  useEffect(() => { save(K.users, users); }, [users]);
  useEffect(() => { save(K.currentUser, currentUserId); }, [currentUserId]);

  const currentUser = users.find(u => u.id === currentUserId) || null;

  // Auth gate
  if (users.length === 0) {
    return <SetupAdmin onCreate={(user) => {
      setUsers([user]);
      setCurrentUserId(user.id);
    }} />;
  }
  if (!currentUser) {
    return <Login users={users} onLogin={(user) => setCurrentUserId(user.id)} />;
  }

  // Keep currentSite valid for the user's access
  const allowedSites = visibleSitesFor(currentUser, sites);
  const canSeeAll = currentUser.role === "admin" || currentUser.sites === "all";
  if (currentSite && !canAccessSite(currentUser, currentSite)) {
    // Site no longer accessible — clear silently
    setTimeout(() => setCurrentSite(""), 0);
  }

  // Hard-scope all records to the user's allowed sites — applied even when "All Sites" is chosen.
  // Equipment / employees / groups without a site stay accessible only to admins / all-access users.
  const userEquipment = canSeeAll ? equipment : equipment.filter(e => canAccessSite(currentUser, e.site || ""));
  const userEmployees = canSeeAll ? employees : employees.filter(e => canAccessSite(currentUser, e.site || ""));
  const userGroups = canSeeAll ? groups : groups.filter(g => canAccessSite(currentUser, g.site || ""));

  const tabs = [
    { id: "board", label: "Job Board", icon: Wrench },
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "people", label: "Employees", icon: User },
    { id: "groups", label: "Groups", icon: Users },
    { id: "sites", label: "Sites", icon: Building2 },
    ...(currentUser.role === "admin" ? [{ id: "users", label: "Users", icon: ShieldCheck }] : []),
  ];

  return (
    <div className="jb">
      <style>{CSS}</style>
      <header className="jb-head">
        <div className="brand">
          <img className="logo-img" src="/logo.png" alt="Logo" onError={e => { e.currentTarget.style.display = "none"; }} />
          <span className="brand-sub">Equipment Job Board</span>
        </div>
        <div className="head-r">
          <div className="site-picker">
            <Building2 size={14} />
            <select value={currentSite} onChange={e => setCurrentSite(e.target.value)}>
              {canSeeAll && <option value="">All Sites</option>}
              {allowedSites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <nav>
            {tabs.map(t => (
              <button key={t.id} className={tab === t.id ? "nav on" : "nav"} onClick={() => setTab(t.id)}>
                <t.icon size={16} /> <span>{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="user-chip" title={currentUser.role === "admin" ? "Administrator" : "User"}>
            {currentUser.role === "admin" ? <Shield size={13} /> : <User size={13} />}
            <span>{currentUser.username}</span>
            <button onClick={() => setCurrentUserId("")} title="Log out"><LogOut size={13} /></button>
          </div>
        </div>
      </header>

      <main>
        {tab === "board" && <Board {...{ equipment: userEquipment, setEquipment, employees: userEmployees, groups: userGroups, sites: allowedSites, currentSite }} />}
        {tab === "dashboard" && <Dashboard {...{ equipment: userEquipment, employees: userEmployees, groups: userGroups, currentSite }} />}
        {tab === "people" && <People {...{ employees: userEmployees, setEquipment, setEmployees, equipment: userEquipment, groups: userGroups, setGroups, sites: allowedSites, currentSite }} />}
        {tab === "groups" && <Groups {...{ groups: userGroups, setGroups, employees: userEmployees, equipment: userEquipment, setEquipment, sites: allowedSites, currentSite }} />}
        {tab === "sites" && <Sites {...{ sites: allowedSites, setSites, equipment: userEquipment, setEquipment, employees: userEmployees, setEmployees, groups: userGroups, setGroups, canCreate: currentUser.role === "admin" }} />}
        {tab === "users" && currentUser.role === "admin" && <UsersAdmin {...{ users, setUsers, currentUser, sites }} />}
      </main>
    </div>
  );
}

function assigneeLabel(eq, employees, groups) {
  if (eq.assigneeType === "employee") {
    const e = employees.find(x => x.id === eq.assigneeId);
    return e ? { name: e.name, kind: "employee" } : null;
  }
  if (eq.assigneeType === "group") {
    const g = groups.find(x => x.id === eq.assigneeId);
    return g ? { name: g.name, kind: "group" } : null;
  }
  return null;
}

function Board({ equipment, setEquipment, employees, groups, sites = [], currentSite = "" }) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [view, setView] = useState("table");
  const [importMsg, setImportMsg] = useState(null);
  const fileRef = useRef();
  const inSite = (e) => !currentSite || (e.site || "") === currentSite;
  const flash = (msg, kind = "ok") => {
    setImportMsg({ msg, kind });
    setTimeout(() => setImportMsg(m => m && m.msg === msg ? null : m), 5000);
  };

  const importEquip = (text) => {
    const rows = parseCSV(text);
    if (rows.length === 0) { flash("CSV is empty — no rows found.", "err"); return; }
    let header = null;
    const first = rows[0].map(c => c.toLowerCase());
    const findIdx = (...names) => {
      for (const n of names) {
        const i = first.findIndex(c => c === n || c === `﻿${n}`);
        if (i !== -1) return i;
      }
      return -1;
    };
    const nameIdx = findIdx("name", "equipment");
    if (nameIdx !== -1) {
      header = {
        name: nameIdx,
        site: findIdx("site"),
        unit: findIdx("unit"),
        system: findIdx("system"),
        area: findIdx("area"),
      };
      rows.shift();
    }
    const records = rows.map(r => {
      if (header) return {
        name: r[header.name] || "",
        site: header.site >= 0 ? r[header.site] || "" : "",
        unit: header.unit >= 0 ? r[header.unit] || "" : "",
        system: header.system >= 0 ? r[header.system] || "" : "",
        area: header.area >= 0 ? r[header.area] || "" : "",
      };
      return { name: r[0] || "", site: r[1] || "", unit: r[2] || "", system: r[3] || "", area: r[4] || "" };
    }).filter(r => r.name.trim());

    if (records.length === 0) {
      flash(`Parsed ${rows.length} row(s) but none had a name. Check that your CSV has a 'name' column or that name is the first column.`, "err");
      return;
    }

    const have = new Set(equipment.map(p => p.name.toLowerCase()));
    const adds = [];
    let skipped = 0;
    records.forEach(r => {
      if (have.has(r.name.trim().toLowerCase())) { skipped++; return; }
      adds.push({
        id: uid(),
        name: r.name.trim(),
        site: r.site.trim() || currentSite || "",
        unit: r.unit.trim(),
        system: r.system.trim(),
        area: r.area.trim(),
        status: "not_started",
        assigneeType: null,
        assigneeId: null,
        completedDate: null,
      });
    });
    if (adds.length) setEquipment(prev => [...prev, ...adds]);
    const parts = [];
    if (adds.length) parts.push(`${adds.length} added`);
    if (skipped) parts.push(`${skipped} skipped (duplicate name)`);
    flash(parts.join(", ") || "No new equipment added.", adds.length ? "ok" : "warn");
  };

  const exportEquip = () => {
    const head = "name,site,unit,system,area";
    const body = equipment.map(e =>
      [e.name, e.site || "", e.unit || "", e.system || "", e.area || ""].map(csvCell).join(",")
    ).join("\n");
    downloadCSV("equipment.csv", head + "\n" + body);
  };

  const downloadEquipTemplate = () => downloadCSV(
    "equipment-template.csv",
    "name,site,unit,system,area\nPump P-101,Refinery A,Unit 10,Cooling Water,North Yard\nVessel V-205,Refinery A,Unit 20,Crude Distillation,South Yard"
  );

  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return equipment.filter(e => inSite(e) && (
      e.name.toLowerCase().includes(needle) ||
      (e.site || "").toLowerCase().includes(needle) ||
      (e.unit || "").toLowerCase().includes(needle) ||
      (e.system || "").toLowerCase().includes(needle) ||
      (e.area || "").toLowerCase().includes(needle)
    ));
  }, [equipment, q, currentSite]);

  const cols = useMemo(() =>
    STATUS_ORDER.map(s => ({ s, items: filtered.filter(e => e.status === s) })),
    [filtered]);

  const lanes = useMemo(() => {
    const out = [];
    employees.forEach(e => out.push({
      key: "employee:" + e.id, name: e.name, kind: "employee",
      items: filtered.filter(x => x.assigneeType === "employee" && x.assigneeId === e.id),
    }));
    groups.forEach(g => out.push({
      key: "group:" + g.id, name: g.name, kind: "group",
      items: filtered.filter(x => x.assigneeType === "group" && x.assigneeId === g.id),
    }));
    const unassigned = filtered.filter(x => !x.assigneeType);
    if (unassigned.length) out.push({ key: "none", name: "Unassigned", kind: "none", items: unassigned });
    return out;
  }, [filtered, employees, groups]);

  const setStatus = (id, status) =>
    setEquipment(prev => prev.map(e => {
      if (e.id !== id) return e;
      const nowIso = new Date().toISOString();
      const next = { ...e, status };
      if (status === "in_progress") {
        if (!next.startedAt) next.startedAt = nowIso;
        next.completedAt = null;
        next.completedDate = null;
      } else if (status === "completed") {
        if (!next.startedAt) next.startedAt = nowIso;
        next.completedAt = nowIso;
        next.completedDate = nowIso.slice(0, 10);
      } else {
        next.startedAt = null;
        next.completedAt = null;
        next.completedDate = null;
      }
      return next;
    }));
  const assign = (id, type, aid) =>
    setEquipment(prev => prev.map(e => e.id === id ? { ...e, assigneeType: type, assigneeId: aid } : e));
  const setLead = (id, leadId) =>
    setEquipment(prev => prev.map(e => e.id === id ? { ...e, lead: leadId || null } : e));
  const remove = (id) => setEquipment(prev => prev.filter(e => e.id !== id));

  return (
    <section className="wrap">
      <div className="bar">
        <h2>Job Board</h2>
        <div className="bar-r">
          <div className="toggle">
            <button className={view === "table" ? "on" : ""} onClick={() => setView("table")}>Table</button>
            <button className={view === "status" ? "on" : ""} onClick={() => setView("status")}>By Status</button>
            <button className={view === "assignee" ? "on" : ""} onClick={() => setView("assignee")}>By Assignee</button>
          </div>
          <div className="search"><Search size={15} /><input placeholder="Search name / unit / system / area…" value={q} onChange={e => setQ(e.target.value)} /></div>
          <button className="btn ghost" onClick={() => fileRef.current.click()}><Upload size={15} /> Import</button>
          <button className="btn ghost" onClick={exportEquip}><Download size={15} /> Export</button>
          <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Add Equipment</button>
          <input ref={fileRef} type="file" accept=".csv,.txt" hidden onChange={ev => {
            const f = ev.target.files[0]; if (!f) return;
            const r = new FileReader(); r.onload = () => importEquip(String(r.result)); r.readAsText(f); ev.target.value = "";
          }} />
        </div>
      </div>

      {adding && <AddEquipment sites={sites} defaultSite={currentSite} onClose={() => setAdding(false)} onAdd={(data) =>
        setEquipment(prev => [...prev, {
          id: uid(),
          name: data.name,
          site: data.site || currentSite || "",
          unit: data.unit || "",
          system: data.system || "",
          area: data.area || "",
          status: "not_started",
          assigneeType: null,
          assigneeId: null,
          completedDate: null,
        }])} />}

      {view === "table" ? (
        <EquipTable items={filtered} employees={employees} groups={groups}
          onAssign={assign} onLead={setLead} onStatus={setStatus} onRemove={remove} />
      ) : view === "status" ? (
        <div className="cols">
          {cols.map(({ s, items }) => {
            const St = STATUS[s];
            return (
              <div className="col" key={s}>
                <div className="col-head" style={{ "--c": St.color }}>
                  <St.icon size={16} /><span>{St.label}</span><b>{items.length}</b>
                </div>
                <div className="col-body">
                  {items.length === 0 && <div className="empty-sm">No equipment</div>}
                  {items.map(eq => (
                    <EquipCard key={eq.id} eq={eq} color={St.color}
                      employees={employees} groups={groups}
                      onAssign={assign} onStatus={setStatus} onRemove={remove} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="lanes">
          {lanes.length === 0 && <div className="empty">No equipment yet</div>}
          {lanes.map(lane => {
            const done = lane.items.filter(i => i.status === "completed").length;
            return (
              <div className="lane" key={lane.key}>
                <div className={"lane-head " + lane.kind}>
                  {lane.kind === "group" ? <Users size={15} /> : lane.kind === "employee" ? <User size={15} /> : <CircleDot size={15} />}
                  <span className="lane-name">{lane.name}</span>
                  <span className="lane-stats">{done}/{lane.items.length} done</span>
                  <b>{lane.items.length}</b>
                </div>
                <div className="lane-body">
                  {lane.items.length === 0 && <div className="empty-sm">No equipment assigned</div>}
                  {lane.items.map(eq => (
                    <EquipCard key={eq.id} eq={eq} color={STATUS[eq.status].color}
                      employees={employees} groups={groups}
                      onAssign={assign} onStatus={setStatus} onRemove={remove} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {importMsg && <div className={"flash " + importMsg.kind}>{importMsg.msg} <button onClick={() => setImportMsg(null)}><X size={12} /></button></div>}
      <p className="hint">Import accepts a CSV with columns <b>name, site, unit, system, area</b> (header optional). <button className="link" onClick={downloadEquipTemplate}>Download template</button></p>
    </section>
  );
}

function EquipCard({ eq, color, employees, groups, onAssign, onStatus, onRemove }) {
  const now = useTick();
  const a = assigneeLabel(eq, employees, groups);
  const hasMeta = eq.site || eq.unit || eq.system || eq.area;
  const dur = formatDuration(durationMs(eq, now));
  const running = eq.status === "in_progress";
  return (
    <div className="card" style={{ "--c": color }}>
      <div className="card-top">
        <strong>{eq.name}</strong>
        <button className="x" onClick={() => onRemove(eq.id)}><Trash2 size={13} /></button>
      </div>
      {hasMeta && (
        <div className="eq-meta">
          {eq.site && <span className="meta-tag site">Site: {eq.site}</span>}
          {eq.unit && <span className="meta-tag unit">Unit: {eq.unit}</span>}
          {eq.system && <span className="meta-tag system">Sys: {eq.system}</span>}
          {eq.area && <span className="meta-tag area">Area: {eq.area}</span>}
        </div>
      )}
      <AssignPicker eq={eq} a={a} employees={employees} groups={groups} onAssign={onAssign} />
      <div className="card-foot">
        <select className="status-sel" value={eq.status} onChange={e => onStatus(eq.id, e.target.value)}>
          {STATUS_ORDER.map(k => <option key={k} value={k}>{STATUS[k].label}</option>)}
        </select>
        {dur && <span className={"dur " + (running ? "running" : "")}>
          <Clock size={11} /> {dur}{running ? "" : ""}
        </span>}
        {eq.status === "completed" && eq.completedDate &&
          <span className="done-date"><Calendar size={11} /> {eq.completedDate}</span>}
      </div>
    </div>
  );
}

function EquipTable({ items, employees, groups, onAssign, onLead, onStatus, onRemove }) {
  const now = useTick();
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const [filters, setFilters] = useState({ name: "", site: "", unit: "", system: "", area: "", assignee: "", lead: "", status: "" });

  const assigneeKey = (eq) => {
    const a = assigneeLabel(eq, employees, groups);
    return a ? a.name : "";
  };
  const leadName = (eq) => {
    const sup = effectiveSupervisor(eq, employees, groups);
    return sup ? sup.name : "";
  };

  const filtered = useMemo(() => items.filter(e => {
    if (filters.name && !e.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
    if (filters.site && !(e.site || "").toLowerCase().includes(filters.site.toLowerCase())) return false;
    if (filters.unit && !(e.unit || "").toLowerCase().includes(filters.unit.toLowerCase())) return false;
    if (filters.system && !(e.system || "").toLowerCase().includes(filters.system.toLowerCase())) return false;
    if (filters.area && !(e.area || "").toLowerCase().includes(filters.area.toLowerCase())) return false;
    if (filters.status && e.status !== filters.status) return false;
    if (filters.assignee) {
      if (filters.assignee === "__unassigned") { if (e.assigneeType) return false; }
      else if (`${e.assigneeType}:${e.assigneeId}` !== filters.assignee) return false;
    }
    if (filters.lead) {
      if (filters.lead === "__none") { if (effectiveSupervisor(e, employees, groups)) return false; }
      else if ((e.lead || "") !== filters.lead) return false;
    }
    return true;
  }), [items, filters, employees, groups]);

  const sorted = useMemo(() => {
    const arr = filtered.slice();
    const dir = sort.dir === "desc" ? -1 : 1;
    arr.sort((a, b) => {
      let av, bv;
      switch (sort.key) {
        case "site": av = a.site || ""; bv = b.site || ""; break;
        case "unit": av = a.unit || ""; bv = b.unit || ""; break;
        case "system": av = a.system || ""; bv = b.system || ""; break;
        case "area": av = a.area || ""; bv = b.area || ""; break;
        case "assignee": av = assigneeKey(a); bv = assigneeKey(b); break;
        case "lead": av = leadName(a); bv = leadName(b); break;
        case "status": av = STATUS_ORDER.indexOf(a.status); bv = STATUS_ORDER.indexOf(b.status); break;
        case "duration": av = durationMs(a, now) ?? -1; bv = durationMs(b, now) ?? -1; break;
        case "done": av = a.completedDate || ""; bv = b.completedDate || ""; break;
        case "name":
        default: av = a.name; bv = b.name;
      }
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return arr;
  }, [filtered, sort, now]);

  const toggleSort = (key) => setSort(s => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  const sortIcon = (key) => sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
  const updateFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const anyFilter = Object.values(filters).some(Boolean);
  const clearFilters = () => setFilters({ name: "", site: "", unit: "", system: "", area: "", assignee: "", lead: "", status: "" });

  if (items.length === 0) return <div className="empty">No equipment</div>;
  const counts = STATUS_ORDER.map(s => ({ s, n: items.filter(i => i.status === s).length }));
  return (
    <div className="eq-table-wrap">
      <div className="eq-summary">
        {counts.map(({ s, n }) => {
          const St = STATUS[s];
          return <span key={s} className="sum" style={{ "--c": St.color }}>
            <St.icon size={12} /> {St.label} <b>{n}</b>
          </span>;
        })}
        <span className="sum total">Total <b>{items.length}</b></span>
      </div>
      <table className="eq-table">
        <thead>
          <tr className="sort-row">
            <th onClick={() => toggleSort("name")}>Equipment{sortIcon("name")}</th>
            <th onClick={() => toggleSort("site")}>Site{sortIcon("site")}</th>
            <th onClick={() => toggleSort("unit")}>Unit{sortIcon("unit")}</th>
            <th onClick={() => toggleSort("system")}>System{sortIcon("system")}</th>
            <th onClick={() => toggleSort("area")}>Area{sortIcon("area")}</th>
            <th onClick={() => toggleSort("assignee")}>Assignee{sortIcon("assignee")}</th>
            <th onClick={() => toggleSort("lead")}>Lead{sortIcon("lead")}</th>
            <th onClick={() => toggleSort("status")}>Status{sortIcon("status")}</th>
            <th onClick={() => toggleSort("duration")}>Duration{sortIcon("duration")}</th>
            <th onClick={() => toggleSort("done")}>Done{sortIcon("done")}</th>
            <th>{anyFilter && <button className="clear-flt" onClick={clearFilters} title="Clear filters"><X size={12} /></button>}</th>
          </tr>
          <tr className="filter-row">
            <th><input className="flt" placeholder="Filter…" value={filters.name} onChange={e => updateFilter("name", e.target.value)} /></th>
            <th><input className="flt" placeholder="Filter…" value={filters.site} onChange={e => updateFilter("site", e.target.value)} /></th>
            <th><input className="flt" placeholder="Filter…" value={filters.unit} onChange={e => updateFilter("unit", e.target.value)} /></th>
            <th><input className="flt" placeholder="Filter…" value={filters.system} onChange={e => updateFilter("system", e.target.value)} /></th>
            <th><input className="flt" placeholder="Filter…" value={filters.area} onChange={e => updateFilter("area", e.target.value)} /></th>
            <th>
              <select className="flt" value={filters.assignee} onChange={e => updateFilter("assignee", e.target.value)}>
                <option value="">All</option>
                <option value="__unassigned">Unassigned</option>
                {employees.length > 0 && <optgroup label="Employees">
                  {employees.map(e => <option key={e.id} value={`employee:${e.id}`}>{e.name}</option>)}
                </optgroup>}
                {groups.length > 0 && <optgroup label="Groups">
                  {groups.map(g => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}
                </optgroup>}
              </select>
            </th>
            <th>
              <select className="flt" value={filters.lead} onChange={e => updateFilter("lead", e.target.value)}>
                <option value="">All</option>
                <option value="__none">— None —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </th>
            <th>
              <select className="flt" value={filters.status} onChange={e => updateFilter("status", e.target.value)}>
                <option value="">All</option>
                {STATUS_ORDER.map(k => <option key={k} value={k}>{STATUS[k].label}</option>)}
              </select>
            </th>
            <th></th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && <tr><td colSpan={11} className="td-empty">No equipment matches filters</td></tr>}
          {sorted.map(eq => {
            const a = assigneeLabel(eq, employees, groups);
            const St = STATUS[eq.status];
            const dur = formatDuration(durationMs(eq, now));
            const running = eq.status === "in_progress";
            return (
              <tr key={eq.id} style={{ "--c": St.color }}>
                <td className="eq-name"><span className="row-dot" /> {eq.name}</td>
                <td className="muted">{eq.site || "—"}</td>
                <td className="muted">{eq.unit || "—"}</td>
                <td className="muted">{eq.system || "—"}</td>
                <td className="muted">{eq.area || "—"}</td>
                <td>
                  <select className="row-sel" value={a ? `${eq.assigneeType}:${eq.assigneeId}` : ""}
                    onChange={e => {
                      const v = e.target.value;
                      if (!v) onAssign(eq.id, null, null);
                      else { const [t, id] = v.split(":"); onAssign(eq.id, t, id); }
                    }}>
                    <option value="">— Unassigned —</option>
                    {employees.length > 0 && <optgroup label="Employees">
                      {employees.map(e => <option key={e.id} value={`employee:${e.id}`}>{e.name}</option>)}
                    </optgroup>}
                    {groups.length > 0 && <optgroup label="Groups">
                      {groups.map(g => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}
                    </optgroup>}
                  </select>
                </td>
                <td>
                  <select className="row-sel" value={eq.lead || ""} onChange={e => onLead(eq.id, e.target.value)}
                    title={eq.lead ? "Explicit lead set" : "Defaults to assignee's supervisor"}>
                    <option value="">{leadName(eq) ? `(${leadName(eq)})` : "— Auto —"}</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </td>
                <td>
                  <select className="row-sel status" value={eq.status} onChange={e => onStatus(eq.id, e.target.value)} style={{ color: St.color }}>
                    {STATUS_ORDER.map(k => <option key={k} value={k}>{STATUS[k].label}</option>)}
                  </select>
                </td>
                <td className="mono">{dur ? <span className={"dur " + (running ? "running" : "")}>{dur}</span> : "—"}</td>
                <td className="muted mono">{eq.status === "completed" && eq.completedDate ? eq.completedDate : "—"}</td>
                <td><button className="x" onClick={() => onRemove(eq.id)}><Trash2 size={13} /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AssignPicker({ eq, a, employees, groups, onAssign }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="assign" ref={ref}>
      <button className="assign-btn" onClick={() => setOpen(o => !o)}>
        {a ? (
          <span className={"pill " + a.kind}>{a.kind === "group" ? <Users size={11} /> : <User size={11} />}{a.name}</span>
        ) : <span className="pill none">Unassigned</span>}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="assign-menu">
          <div className="menu-sec">Employees</div>
          {employees.length === 0 && <div className="menu-empty">None</div>}
          {employees.map(e => <button key={e.id} onClick={() => { onAssign(eq.id, "employee", e.id); setOpen(false); }}><User size={12} />{e.name}</button>)}
          <div className="menu-sec">Groups</div>
          {groups.length === 0 && <div className="menu-empty">None</div>}
          {groups.map(g => <button key={g.id} onClick={() => { onAssign(eq.id, "group", g.id); setOpen(false); }}><Users size={12} />{g.name}</button>)}
          {a && <button className="clear" onClick={() => { onAssign(eq.id, null, null); setOpen(false); }}><X size={12} />Clear</button>}
        </div>
      )}
    </div>
  );
}

function AddEquipment({ sites = [], defaultSite = "", onClose, onAdd }) {
  const [name, setName] = useState("");
  const [site, setSite] = useState(defaultSite);
  const [unit, setUnit] = useState("");
  const [system, setSystem] = useState("");
  const [area, setArea] = useState("");
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onAdd({ name: n, site, unit: unit.trim(), system: system.trim(), area: area.trim() });
    onClose();
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <h3>Add Equipment</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <label className="field"><span>Name</span>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
        </label>
        <label className="field"><span>Site</span>
          <select value={site} onChange={e => setSite(e.target.value)}>
            <option value="">— None —</option>
            {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Unit</span>
          <input value={unit} onChange={e => setUnit(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
        </label>
        <label className="field"><span>System</span>
          <input value={system} onChange={e => setSystem(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
        </label>
        <label className="field"><span>Area</span>
          <input value={area} onChange={e => setArea(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
        </label>
        <button className="btn primary full" onClick={submit}><Plus size={16} /> Add</button>
      </div>
    </div>
  );
}

function Dashboard({ equipment, employees, groups, currentSite = "" }) {
  const now = useTick();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [who, setWho] = useState("all");
  const [focus, setFocus] = useState("in_progress"); // "all" | "not_started" | "in_progress" | "completed"
  const [groupBy, setGroupBy] = useState("crew"); // "crew" | "supervisor" | "org"

  const scoped = useMemo(() =>
    currentSite ? equipment.filter(e => (e.site || "") === currentSite) : equipment,
    [equipment, currentSite]);

  const counts = STATUS_ORDER.map(s => ({ s, n: scoped.filter(e => e.status === s).length }));
  const total = scoped.length;

  const rows = useMemo(() => {
    let list = focus === "all" ? scoped : scoped.filter(e => e.status === focus);
    if (focus === "completed") {
      list = list.filter(e => e.completedDate)
        .filter(e => (!from || e.completedDate >= from) && (!to || e.completedDate <= to));
    }
    if (who !== "all") list = list.filter(e => `${e.assigneeType}:${e.assigneeId}` === who);
    return list.sort((a, b) => {
      if (focus === "completed") return (b.completedDate || "").localeCompare(a.completedDate || "");
      return a.name.localeCompare(b.name);
    });
  }, [scoped, focus, from, to, who]);

  const whoOptions = [
    ...employees.map(e => ({ v: `employee:${e.id}`, label: e.name })),
    ...groups.map(g => ({ v: `group:${g.id}`, label: g.name })),
  ];

  const panelTitle = focus === "all" ? "All Equipment"
    : focus === "completed" ? "Completed Work"
    : STATUS[focus].label;

  const eqTile = (eq, crewSupId) => {
    const tier = inProgressTier(eq, now);
    const dur = formatDuration(durationMs(eq, now));
    const sup = effectiveSupervisor(eq, employees, groups);
    const leadHint = eq.lead && sup && sup.id !== crewSupId ? sup.name : null;
    return (
      <div className={"tile eq " + eq.status + (tier ? " " + tier : "")} key={eq.id}
        title={`${eq.name} · ${STATUS[eq.status].label}${dur ? " · " + dur : ""}${leadHint ? " · Lead: " + leadHint : ""}`}>
        <div className="eq-name-line">{eq.name}</div>
        {leadHint && <div className="eq-lead-line">→ {leadHint}</div>}
      </div>
    );
  };

  // ---- Crew boards: by crew (group) ----
  const visibleGroups = currentSite ? groups.filter(g => (g.site || "") === currentSite) : groups;
  const crews = visibleGroups.map(g => {
    const members = employees.filter(e => g.members.includes(e.id));
    const supervisor = members.find(e => /supervis|lead|foreman/i.test(e.title || ""))
      || members[0]
      || null;
    const equip = scoped.filter(e => e.assigneeType === "group" && e.assigneeId === g.id && e.status !== "completed");
    return { group: g, supervisor, equipment: equip };
  });
  const directs = useMemo(() => {
    const map = new Map();
    scoped.forEach(e => {
      if (e.assigneeType !== "employee" || e.status === "completed") return;
      const emp = employees.find(x => x.id === e.assigneeId);
      if (!emp) return;
      if (!map.has(emp.id)) map.set(emp.id, { employee: emp, equipment: [] });
      map.get(emp.id).equipment.push(e);
    });
    return [...map.values()];
  }, [scoped, employees]);

  // ---- Crew boards: by supervisor ----
  // Group equipment under each effective supervisor; each group within shows that group's tile.
  const bySupervisor = useMemo(() => {
    const map = new Map(); // supId -> { supervisor, groups: Map(groupId -> {group, equipment}), solos: [] }
    const ensure = (sup) => {
      const key = sup ? sup.id : "__none";
      if (!map.has(key)) map.set(key, { supervisor: sup, lanes: new Map(), solos: [] });
      return map.get(key);
    };
    scoped.forEach(e => {
      if (e.status === "completed") return;
      const sup = effectiveSupervisor(e, employees, groups);
      const bucket = ensure(sup);
      if (e.assigneeType === "group") {
        const g = groups.find(x => x.id === e.assigneeId);
        if (!g) return;
        if (!bucket.lanes.has(g.id)) bucket.lanes.set(g.id, { group: g, equipment: [] });
        bucket.lanes.get(g.id).equipment.push(e);
      } else if (e.assigneeType === "employee") {
        bucket.solos.push(e);
      }
    });
    return [...map.values()].map(b => ({ ...b, lanes: [...b.lanes.values()] }));
  }, [scoped, employees, groups]);

  // ---- Org chart: Supervisor at top, leads as sub-trees below.
  // For each crew supervisor, group their in-progress equipment by lead.
  // Equipment whose lead is the supervisor (or has no explicit lead) goes into the supervisor's own bucket.
  const orgChart = useMemo(() => {
    const crewSup = (eq) => {
      if (eq.assigneeType === "group") {
        const g = groups.find(x => x.id === eq.assigneeId);
        if (!g) return null;
        const members = employees.filter(e => g.members.includes(e.id));
        return members.find(e => /supervis|lead|foreman/i.test(e.title || "")) || members[0] || null;
      }
      if (eq.assigneeType === "employee") return employees.find(x => x.id === eq.assigneeId) || null;
      return null;
    };
    const map = new Map();
    scoped.forEach(e => {
      if (e.status !== "in_progress") return;
      const sup = crewSup(e);
      if (!sup) return;
      if (!map.has(sup.id)) map.set(sup.id, { supervisor: sup, leadMap: new Map() });
      const bucket = map.get(sup.id);
      const leadKey = e.lead && e.lead !== sup.id ? e.lead : "__sup";
      const leadObj = leadKey === "__sup" ? null : (employees.find(x => x.id === leadKey) || null);
      if (!bucket.leadMap.has(leadKey)) bucket.leadMap.set(leadKey, { lead: leadObj, equipment: [] });
      bucket.leadMap.get(leadKey).equipment.push(e);
    });
    return [...map.values()].map(b => {
      // Supervisor's own bucket first (when present), then explicit leads sorted by name.
      const leads = [...b.leadMap.values()];
      leads.sort((a, c) => (a.lead ? 1 : 0) - (c.lead ? 1 : 0) || (a.lead && c.lead ? a.lead.name.localeCompare(c.lead.name) : 0));
      return { supervisor: b.supervisor, leads };
    });
  }, [scoped, employees, groups]);

  // Hide cards with no supervisor in By Supervisor view too.
  const bySupervisorVisible = bySupervisor.filter(b => b.supervisor);

  return (
    <section className="wrap">
      <div className="bar">
        <h2>Dashboard</h2>
        <div className="toggle">
          <button className={groupBy === "crew" ? "on" : ""} onClick={() => setGroupBy("crew")}>By Crew</button>
          <button className={groupBy === "supervisor" ? "on" : ""} onClick={() => setGroupBy("supervisor")}>By Supervisor</button>
          <button className={groupBy === "org" ? "on" : ""} onClick={() => setGroupBy("org")}>Org Chart</button>
        </div>
      </div>

      {groupBy === "crew" ? (
        <div className="crew-grid">
          {crews.length === 0 && directs.length === 0 && (
            <div className="empty">No crews yet. Create a group, assign equipment to it, and it'll appear here.</div>
          )}
          {crews.map(c => (
            <div className="crew" key={c.group.id}>
              <div className="tile sup">{c.supervisor ? c.supervisor.name : "— No supervisor —"}</div>
              <div className="tile grp">{c.group.name}</div>
              {c.equipment.length === 0 && <div className="tile empty-tile">No equipment</div>}
              {c.equipment.map(eq => eqTile(eq, c.supervisor && c.supervisor.id))}
            </div>
          ))}
          {directs.map(d => (
            <div className="crew" key={"emp:" + d.employee.id}>
              <div className="tile sup">{d.employee.name}</div>
              {d.equipment.map(eq => eqTile(eq, d.employee.id))}
            </div>
          ))}
        </div>
      ) : groupBy === "supervisor" ? (
        <div className="crew-grid">
          {bySupervisorVisible.length === 0 && (
            <div className="empty">No active work assigned. Set leads on the Job Board or assign equipment.</div>
          )}
          {bySupervisorVisible.map(b => (
            <div className="crew" key={b.supervisor.id}>
              <div className="tile sup">{b.supervisor.name}</div>
              {b.lanes.map(l => (
                <React.Fragment key={l.group.id}>
                  <div className="tile grp">{l.group.name}</div>
                  {l.equipment.map(eq => eqTile(eq, b.supervisor.id))}
                </React.Fragment>
              ))}
              {b.solos.length > 0 && b.solos.map(eq => eqTile(eq, b.supervisor.id))}
            </div>
          ))}
        </div>
      ) : (
        <div className="crew-grid">
          {orgChart.length === 0 && (
            <div className="empty">No in-progress work assigned.</div>
          )}
          {orgChart.map(b => (
            <div className="crew" key={b.supervisor.id}>
              <div className="tile sup">{b.supervisor.name}</div>
              {b.leads.map((l, i) => (
                <div className={"lead-branch" + (i > 0 ? " divided" : "")} key={l.lead ? l.lead.id : "sup"}>
                  {l.lead ? (
                    <div className="tile lead-tile lead-header">↳ {l.lead.name}</div>
                  ) : (
                    <div className="lead-self-mark">Direct</div>
                  )}
                  <div className="lead-eq">
                    {l.equipment.map(eq => eqTile(eq, l.lead ? l.lead.id : b.supervisor.id))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="status-tiles">
        <button className={"status-tile total" + (focus === "all" ? " on" : "")} onClick={() => setFocus("all")}>
          <span>Total</span><b>{total}</b><em>Click to view</em>
        </button>
        {counts.map(({ s, n }) => {
          const St = STATUS[s];
          return <button key={s} className={"status-tile " + s + (focus === s ? " on" : "")} onClick={() => setFocus(s)}>
            <span><St.icon size={14} /> {St.label}</span><b>{n}</b><em>Click to view</em>
          </button>;
        })}
      </div>

      <div className="panel">
        <div className="panel-h">
          <h3>{panelTitle} <span className="row-count">({rows.length})</span></h3>
          <div className="filters">
            {focus === "completed" && <>
              <label>From <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
              <label>To <input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
            </>}
            <select value={who} onChange={e => setWho(e.target.value)}>
              <option value="all">Everyone</option>
              {whoOptions.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <table className="tbl">
          <thead><tr>
            <th>Equipment</th>
            <th>Unit</th>
            <th>System</th>
            <th>Area</th>
            <th>Assignee</th>
            <th>Type</th>
            {focus !== "completed" && <th>Status</th>}
            <th>Duration</th>
            <th>{focus === "completed" ? "Completed" : "Done Date"}</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={9} className="td-empty">No equipment for this filter</td></tr>}
            {rows.map(e => {
              const a = assigneeLabel(e, employees, groups);
              const St = STATUS[e.status];
              const dur = formatDuration(durationMs(e, now));
              const running = e.status === "in_progress";
              return <tr key={e.id}>
                <td><strong>{e.name}</strong></td>
                <td className="muted">{e.unit || "—"}</td>
                <td className="muted">{e.system || "—"}</td>
                <td className="muted">{e.area || "—"}</td>
                <td>{a ? a.name : "—"}</td>
                <td>{a ? <span className={"pill sm " + a.kind}>{a.kind}</span> : "—"}</td>
                {focus !== "completed" && <td><span className="pill sm" style={{ background: "color-mix(in srgb, " + St.color + " 18%, transparent)", color: St.color }}>{St.label}</span></td>}
                <td className="mono">{dur ? <span className={"dur " + (running ? "running" : "")}>{dur}</span> : "—"}</td>
                <td className="mono">{e.completedDate || "—"}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function People({ employees, setEmployees, equipment, setEquipment, groups, setGroups, sites = [], currentSite = "" }) {
  const fileRef = useRef();
  const [adding, setAdding] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState([]);
  const [naming, setNaming] = useState(false);

  const groupsFor = (eid) => groups.filter(g => g.members.includes(eid));
  const visibleEmployees = currentSite ? employees.filter(e => (e.site || "") === currentSite) : employees;

  // Adds new groups by name to `gs` if missing, then ensures `empId` is a member of every named group.
  // Returns the updated groups array.
  const assignGroups = (gs, empId, groupNames) => {
    let next = gs.slice();
    const wanted = groupNames.map(n => n.trim()).filter(Boolean);
    wanted.forEach(name => {
      const idx = next.findIndex(g => g.name.toLowerCase() === name.toLowerCase());
      if (idx === -1) next.push({ id: uid(), name, members: [empId] });
      else if (!next[idx].members.includes(empId))
        next = next.map((g, i) => i === idx ? { ...g, members: [...g.members, empId] } : g);
    });
    return next;
  };

  const add = ({ name, title, shift, group, site }) => {
    const id = uid();
    setEmployees(prev => [...prev, { id, name, title: title || "", shift: shift || "", site: site || currentSite || "" }]);
    const names = splitGroupList(group);
    if (names.length) setGroups(prev => assignGroups(prev, id, names));
  };

  const remove = (id) => {
    setEmployees(prev => prev.filter(e => e.id !== id));
    setEquipment(prev => prev.map(e => (e.assigneeType === "employee" && e.assigneeId === id) ? { ...e, assigneeType: null, assigneeId: null } : e));
    setGroups(prev => prev.map(g => ({ ...g, members: g.members.filter(m => m !== id) })));
    setSelected(prev => prev.filter(x => x !== id));
  };

  const importCSV = (text) => {
    const rows = parseCSV(text);
    if (rows.length === 0) return;
    let header = null;
    const first = rows[0].map(c => c.toLowerCase());
    if (first.includes("name")) {
      header = {
        name: first.indexOf("name"),
        title: first.indexOf("title"),
        shift: first.indexOf("shift"),
        group: first.indexOf("group") !== -1 ? first.indexOf("group") : first.indexOf("groups"),
        site: first.indexOf("site"),
      };
      rows.shift();
    }
    const records = rows.map(r => {
      if (header) return {
        name: r[header.name] || "",
        title: header.title >= 0 ? r[header.title] || "" : "",
        shift: header.shift >= 0 ? r[header.shift] || "" : "",
        group: header.group >= 0 ? r[header.group] || "" : "",
        site: header.site >= 0 ? r[header.site] || "" : "",
      };
      return { name: r[0] || "", title: r[1] || "", shift: r[2] || "", group: r[3] || "", site: r[4] || "" };
    }).filter(r => r.name.trim());

    // Build new employees + collect (empId -> group names) for batched group update
    const toAssign = [];
    setEmployees(prev => {
      const have = new Set(prev.map(p => p.name.toLowerCase()));
      const add = [];
      records.forEach(r => {
        const nm = r.name.trim();
        if (have.has(nm.toLowerCase())) return;
        const id = uid();
        add.push({ id, name: nm, title: r.title.trim(), shift: r.shift.trim(), site: r.site.trim() || currentSite || "" });
        const names = splitGroupList(r.group);
        if (names.length) toAssign.push({ id, names });
      });
      return [...prev, ...add];
    });
    if (toAssign.length) setGroups(prev => {
      let next = prev;
      toAssign.forEach(({ id, names }) => { next = assignGroups(next, id, names); });
      return next;
    });
  };

  const exportCSV = () => {
    const head = "name,title,shift,group,site";
    const body = visibleEmployees.map(e => {
      const grp = groupsFor(e.id).map(g => g.name).join("; ");
      return [e.name, e.title || "", e.shift || "", grp, e.site || ""].map(csvCell).join(",");
    }).join("\n");
    downloadCSV("employees.csv", head + "\n" + body);
  };
  const countLoad = (id) => equipment.filter(e => e.assigneeType === "employee" && e.assigneeId === id).length;

  const toggleSel = (id) => setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const exitSelect = () => { setSelectMode(false); setSelected([]); };
  const createGroup = (name) => {
    setGroups(prev => [...prev, { id: uid(), name, members: [...selected] }]);
    setNaming(false); exitSelect();
  };
  const downloadTemplate = () => downloadCSV(
    "employees-template.csv",
    "name,title,shift,group\nJohn Doe,Welder,Day,Alpha\nJane Smith,Inspector,Night,Bravo\nMike Lee,Welder,Day,Alpha; Bravo"
  );

  return (
    <section className="wrap">
      <div className="bar">
        <h2>Employees</h2>
        <div className="bar-r">
          {!selectMode ? (
            <>
              <button className="btn ghost" onClick={() => setSelectMode(true)}><Users size={15} /> New Group from Selection</button>
              <button className="btn ghost" onClick={() => fileRef.current.click()}><Upload size={15} /> Import</button>
              <button className="btn ghost" onClick={exportCSV}><Download size={15} /> Export</button>
              <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Add</button>
            </>
          ) : (
            <>
              <span className="sel-count">{selected.length} selected</span>
              <button className="btn primary" disabled={!selected.length} onClick={() => setNaming(true)}><Users size={15} /> Create Group</button>
              <button className="btn ghost" onClick={exitSelect}><X size={15} /> Cancel</button>
            </>
          )}
          <input ref={fileRef} type="file" accept=".csv,.txt" hidden onChange={ev => {
            const f = ev.target.files[0]; if (!f) return;
            const r = new FileReader(); r.onload = () => importCSV(String(r.result)); r.readAsText(f); ev.target.value = "";
          }} />
        </div>
      </div>

      {adding && <EmployeeForm groups={groups} sites={sites} defaultSite={currentSite} onClose={() => setAdding(false)} onAdd={add} />}
      {naming && <AddSimple title={`Name Group (${selected.length} members)`} onClose={() => setNaming(false)} onAdd={createGroup} />}

      <div className="grid">
        {visibleEmployees.length === 0 && <div className="empty">{currentSite ? `No employees at ${currentSite} yet.` : "No employees yet. Add manually or import a CSV."}</div>}
        {visibleEmployees.map(it => {
          const on = selected.includes(it.id);
          return (
            <div className={"pcard" + (selectMode ? " selectable" : "") + (on ? " sel" : "")} key={it.id}
              onClick={selectMode ? () => toggleSel(it.id) : undefined}>
              {selectMode && <input type="checkbox" checked={on} readOnly className="sel-box" />}
              <div className="pcard-l">
                <span className="pill employee"><User size={12} /> {it.name}</span>
                {(it.title || it.shift || it.site || groupsFor(it.id).length > 0) && (
                  <div className="pmeta">
                    {it.title && <span className="meta-tag title">{it.title}</span>}
                    {it.shift && <span className="meta-tag shift">{it.shift}</span>}
                    {it.site && <span className="meta-tag site">{it.site}</span>}
                    {groupsFor(it.id).map(g => (
                      <span key={g.id} className="meta-tag group"><Users size={10} /> {g.name}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="pcard-r">
                <span className="load">{countLoad(it.id)} jobs</span>
                {!selectMode && <button className="x" onClick={() => remove(it.id)}><Trash2 size={14} /></button>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="hint">{selectMode
        ? "Tap employees to select them, then Create Group."
        : <>Import accepts a CSV with columns <b>name, title, shift, group</b> (header optional). Use <b>;</b> to assign multiple groups. <button className="link" onClick={downloadTemplate}>Download template</button></>}</p>
    </section>
  );
}

function Sites({ sites, setSites, equipment, setEquipment, employees, setEmployees, groups, setGroups }) {
  const [adding, setAdding] = useState(false);
  const [addEqFor, setAddEqFor] = useState(null);  // site name
  const [addEmpFor, setAddEmpFor] = useState(null);
  const fileRef = useRef();

  const add = (name) => setSites(prev => [...prev, { id: uid(), name }]);
  const remove = (id) => setSites(prev => prev.filter(s => s.id !== id));
  const importCSV = (text) => {
    const names = text.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    setSites(prev => {
      const have = new Set(prev.map(p => p.name.toLowerCase()));
      const add = names.filter(n => !have.has(n.toLowerCase())).map(n => ({ id: uid(), name: n }));
      return [...prev, ...add];
    });
  };
  const exportCSV = () => downloadCSV("sites.csv", sites.map(s => s.name).join("\n"));

  const equipCountFor = (name) => equipment.filter(e => (e.site || "") === name).length;
  const empCountFor = (name) => employees.filter(e => (e.site || "") === name).length;
  const groupCountFor = (name) => groups.filter(g => (g.site || "") === name).length;

  const addEquipForSite = (siteName) => (data) => setEquipment(prev => [...prev, {
    id: uid(),
    name: data.name,
    site: data.site || siteName,
    unit: data.unit || "",
    system: data.system || "",
    area: data.area || "",
    status: "not_started",
    assigneeType: null,
    assigneeId: null,
    completedDate: null,
  }]);

  const addEmpForSite = (siteName) => ({ name, title, shift, group, site }) => {
    const id = uid();
    setEmployees(prev => [...prev, { id, name, title: title || "", shift: shift || "", site: site || siteName }]);
    const groupNames = splitGroupList(group);
    if (groupNames.length) setGroups(prev => {
      let next = prev.slice();
      groupNames.forEach(gn => {
        const idx = next.findIndex(g => g.name.toLowerCase() === gn.toLowerCase());
        if (idx === -1) next.push({ id: uid(), name: gn, members: [id], site: siteName });
        else if (!next[idx].members.includes(id))
          next = next.map((g, i) => i === idx ? { ...g, members: [...g.members, id] } : g);
      });
      return next;
    });
  };

  return (
    <section className="wrap">
      <div className="bar">
        <h2>Sites</h2>
        <div className="bar-r">
          <button className="btn ghost" onClick={() => fileRef.current.click()}><Upload size={15} /> Import</button>
          <button className="btn ghost" onClick={exportCSV}><Download size={15} /> Export</button>
          <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Add Site</button>
          <input ref={fileRef} type="file" accept=".csv,.txt" hidden onChange={ev => {
            const f = ev.target.files[0]; if (!f) return;
            const r = new FileReader(); r.onload = () => importCSV(String(r.result)); r.readAsText(f); ev.target.value = "";
          }} />
        </div>
      </div>
      {adding && <AddSimple title="Add Site" onClose={() => setAdding(false)} onAdd={add} />}
      {addEqFor && <AddEquipment sites={sites} defaultSite={addEqFor} onClose={() => setAddEqFor(null)} onAdd={addEquipForSite(addEqFor)} />}
      {addEmpFor && <EmployeeForm sites={sites} groups={groups} defaultSite={addEmpFor} onClose={() => setAddEmpFor(null)} onAdd={addEmpForSite(addEmpFor)} />}

      <div className="grid sites-grid">
        {sites.length === 0 && <div className="empty">No sites yet. Add manually or import a CSV.</div>}
        {sites.map(s => (
          <div className="scard" key={s.id}>
            <div className="scard-h">
              <span className="pill site"><Building2 size={12} /> {s.name}</span>
              <button className="x" onClick={() => remove(s.id)}><Trash2 size={14} /></button>
            </div>
            <div className="scard-stats">
              <span><b>{equipCountFor(s.name)}</b> equipment</span>
              <span><b>{empCountFor(s.name)}</b> employees</span>
              <span><b>{groupCountFor(s.name)}</b> groups</span>
            </div>
            <div className="scard-actions">
              <button className="btn ghost sm" onClick={() => setAddEqFor(s.name)}><Plus size={13} /> Add Equipment</button>
              <button className="btn ghost sm" onClick={() => setAddEmpFor(s.name)}><Plus size={13} /> Add Employee</button>
            </div>
          </div>
        ))}
      </div>
      <p className="hint">Use the buttons above to import sites, then add equipment or employees scoped to each site.</p>
    </section>
  );
}

function Groups({ groups, setGroups, employees, equipment, setEquipment, sites = [], currentSite = "" }) {
  const visibleGroups = currentSite ? groups.filter(g => (g.site || "") === currentSite) : groups;
  const add = (name) => setGroups(prev => [...prev, { id: uid(), name, members: [], site: currentSite || "" }]);
  const remove = (id) => {
    setGroups(prev => prev.filter(g => g.id !== id));
    setEquipment(prev => prev.map(e => (e.assigneeType === "group" && e.assigneeId === id) ? { ...e, assigneeType: null, assigneeId: null } : e));
  };
  const toggleMember = (gid, eid) =>
    setGroups(prev => prev.map(g => g.id === gid
      ? { ...g, members: g.members.includes(eid) ? g.members.filter(m => m !== eid) : [...g.members, eid] }
      : g));
  const importCSV = (text) => {
    const names = text.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    setGroups(prev => {
      const have = new Set(prev.map(p => p.name.toLowerCase()));
      const add = names.filter(n => !have.has(n.toLowerCase())).map(n => ({ id: uid(), name: n, members: [], site: currentSite || "" }));
      return [...prev, ...add];
    });
  };
  const exportCSV = () => downloadCSV("groups.csv", visibleGroups.map(g => g.name).join("\n"));
  const [adding, setAdding] = useState(false);
  const fileRef = useRef();

  return (
    <section className="wrap">
      <div className="bar">
        <h2>Groups</h2>
        <div className="bar-r">
          <button className="btn ghost" onClick={() => fileRef.current.click()}><Upload size={15} /> Import</button>
          <button className="btn ghost" onClick={exportCSV}><Download size={15} /> Export</button>
          <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Add Group</button>
          <input ref={fileRef} type="file" accept=".csv,.txt" hidden onChange={ev => {
            const f = ev.target.files[0]; if (!f) return;
            const r = new FileReader(); r.onload = () => importCSV(String(r.result)); r.readAsText(f); ev.target.value = "";
          }} />
        </div>
      </div>
      {adding && <AddSimple title="Add Group" onClose={() => setAdding(false)} onAdd={add} />}
      <div className="grid">
        {visibleGroups.length === 0 && <div className="empty">{currentSite ? `No groups at ${currentSite} yet.` : "No groups yet"}</div>}
        {visibleGroups.map(g => {
          const memberPool = currentSite ? employees.filter(e => (e.site || "") === currentSite) : employees;
          return (
            <div className="gcard" key={g.id}>
              <div className="gcard-h">
                <span className="pill group"><Users size={12} /> {g.name}</span>
                <button className="x" onClick={() => remove(g.id)}><Trash2 size={14} /></button>
              </div>
              {g.site && <div className="gsite"><span className="meta-tag site">{g.site}</span></div>}
              <div className="gcount">{equipment.filter(e => e.assigneeType === "group" && e.assigneeId === g.id).length} equipment · {g.members.length} members</div>
              <div className="members">
                {memberPool.length === 0 && <span className="menu-empty">Add employees first</span>}
                {memberPool.map(e => (
                  <label key={e.id} className={g.members.includes(e.id) ? "mem on" : "mem"}>
                    <input type="checkbox" checked={g.members.includes(e.id)} onChange={() => toggleMember(g.id, e.id)} />
                    {e.name}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EmployeeForm({ groups = [], sites = [], defaultSite = "", onClose, onAdd }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [shift, setShift] = useState("");
  const [group, setGroup] = useState("");
  const [site, setSite] = useState(defaultSite);
  const submit = () => {
    const n = name.trim();
    if (!n) return;
    onAdd({ name: n, title: title.trim(), shift: shift.trim(), group: group.trim(), site });
    onClose();
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-h">
          <h3>Add Employee</h3>
          <button onClick={onClose}><X size={18} /></button>
        </div>
        <label className="field"><span>Name</span>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
        </label>
        <label className="field"><span>Title</span>
          <input placeholder="e.g. Welder, Inspector" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
        </label>
        <label className="field"><span>Shift</span>
          <input list="shift-list" placeholder="e.g. Day, Night, Swing" value={shift} onChange={e => setShift(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
          <datalist id="shift-list">
            <option value="Day" /><option value="Night" /><option value="Swing" /><option value="Weekend" />
          </datalist>
        </label>
        <label className="field"><span>Group</span>
          <input list="group-list" placeholder="Existing or new (use ; for multiple)" value={group} onChange={e => setGroup(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
          <datalist id="group-list">
            {groups.map(g => <option key={g.id} value={g.name} />)}
          </datalist>
        </label>
        <label className="field"><span>Site</span>
          <select value={site} onChange={e => setSite(e.target.value)}>
            <option value="">— None —</option>
            {sites.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </label>
        <button className="btn primary full" onClick={submit}><Plus size={16} /> Add</button>
      </div>
    </div>
  );
}

function splitGroupList(v) {
  return String(v || "").split(/[;|]/).map(s => s.trim()).filter(Boolean);
}

function parseCSV(text) {
  // Strip UTF-8 BOM that Excel adds when saving as CSV
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  // Auto-detect delimiter from the first non-empty line: comma, semicolon, or tab
  const firstLine = text.split(/\r?\n/).find(l => l.trim()) || "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let q = false;
  for (const c of firstLine) {
    if (c === '"') q = !q;
    else if (!q && counts.hasOwnProperty(c)) counts[c]++;
  }
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ",";

  const rows = [];
  let cur = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === delim) { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field); field = "";
        if (cur.some(v => v.trim())) rows.push(cur);
        cur = [];
      } else field += c;
    }
  }
  if (field.length || cur.length) { cur.push(field); if (cur.some(v => v.trim())) rows.push(cur); }
  return rows.map(r => r.map(v => v.trim()));
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function AddSimple({ title, onClose, onAdd }) {
  const [v, setV] = useState("");
  const submit = () => { const n = v.trim(); if (n) { onAdd(n); onClose(); } };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-h"><h3>{title}</h3><button onClick={onClose}><X size={18} /></button></div>
        <input autoFocus placeholder="Name" value={v} onChange={e => setV(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
        <button className="btn primary full" onClick={submit}><Plus size={16} /> Add</button>
      </div>
    </div>
  );
}

function SetupAdmin({ onCreate }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const submit = () => {
    const u = username.trim();
    if (!u) return setErr("Choose a username.");
    if (password.length < 4) return setErr("Password must be at least 4 characters.");
    onCreate({ id: uid(), username: u, passwordHash: hashPassword(password), role: "admin", sites: "all" });
  };
  return (
    <div className="jb auth-screen">
      <style>{CSS}</style>
      <div className="auth-card">
        <div className="auth-h">
          <img className="logo-img auth-logo" src="/logo.png" alt="Logo" onError={e => { e.currentTarget.style.display = "none"; }} />
          <h1>Welcome</h1>
          <p>Create the first administrator account to start using the job board.</p>
        </div>
        <label className="field"><span>Username</span>
          <input autoFocus value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
        </label>
        <label className="field"><span>Password</span>
          <div className="pw">
            <input type={show ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
            <button type="button" onClick={() => setShow(s => !s)}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </div>
        </label>
        {err && <div className="auth-err">{err}</div>}
        <button className="btn primary full" onClick={submit}><Shield size={16} /> Create Admin</button>
        <p className="hint">This account will be saved locally in your browser.</p>
      </div>
    </div>
  );
}

function Login({ users, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const submit = () => {
    const u = users.find(x => x.username.toLowerCase() === username.trim().toLowerCase());
    if (!u || u.passwordHash !== hashPassword(password)) return setErr("Incorrect username or password.");
    onLogin(u);
  };
  return (
    <div className="jb auth-screen">
      <style>{CSS}</style>
      <div className="auth-card">
        <div className="auth-h">
          <img className="logo-img auth-logo" src="/logo.png" alt="Logo" onError={e => { e.currentTarget.style.display = "none"; }} />
          <h1>Sign in</h1>
          <p>Use your credentials to access the job board.</p>
        </div>
        <label className="field"><span>Username</span>
          <input autoFocus value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
        </label>
        <label className="field"><span>Password</span>
          <div className="pw">
            <input type={show ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
            <button type="button" onClick={() => setShow(s => !s)}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </div>
        </label>
        {err && <div className="auth-err">{err}</div>}
        <button className="btn primary full" onClick={submit}><Lock size={16} /> Sign In</button>
      </div>
    </div>
  );
}

function UsersAdmin({ users, setUsers, currentUser, sites }) {
  const [adding, setAdding] = useState(false);
  const remove = (id) => {
    if (id === currentUser.id) return;
    setUsers(prev => prev.filter(u => u.id !== id));
  };
  const setRole = (id, role) => setUsers(prev => prev.map(u => u.id === id ? { ...u, role, sites: role === "admin" ? "all" : (Array.isArray(u.sites) ? u.sites : []) } : u));
  const setUserSites = (id, mode, list) => setUsers(prev => prev.map(u => u.id === id ? { ...u, sites: mode === "all" ? "all" : list } : u));
  const resetPassword = (id, newPw) => setUsers(prev => prev.map(u => u.id === id ? { ...u, passwordHash: hashPassword(newPw) } : u));

  return (
    <section className="wrap">
      <div className="bar">
        <h2>Users</h2>
        <div className="bar-r">
          <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Add User</button>
        </div>
      </div>
      {adding && <UserForm sites={sites} existing={users} onClose={() => setAdding(false)} onAdd={(u) => setUsers(prev => [...prev, u])} />}
      <div className="grid">
        {users.length === 0 && <div className="empty">No users yet.</div>}
        {users.map(u => {
          const isMe = u.id === currentUser.id;
          const allSelected = u.sites === "all";
          return (
            <div className="ucard" key={u.id}>
              <div className="ucard-h">
                <span className={"pill " + (u.role === "admin" ? "admin-pill" : "employee")}>
                  {u.role === "admin" ? <Shield size={12} /> : <User size={12} />} {u.username}{isMe && " (you)"}
                </span>
                {!isMe && <button className="x" onClick={() => remove(u.id)}><Trash2 size={14} /></button>}
              </div>
              <div className="urow">
                <label className="urow-l">Role</label>
                <select value={u.role} onChange={e => setRole(u.id, e.target.value)} disabled={isMe}>
                  <option value="admin">Administrator</option>
                  <option value="user">User</option>
                </select>
              </div>
              <div className="urow">
                <label className="urow-l">Site access</label>
                <select value={allSelected ? "all" : "some"} onChange={e => setUserSites(u.id, e.target.value, Array.isArray(u.sites) ? u.sites : [])} disabled={u.role === "admin"}>
                  <option value="all">All sites</option>
                  <option value="some">Selected sites</option>
                </select>
              </div>
              {u.role !== "admin" && !allSelected && (
                <div className="usites">
                  {sites.length === 0 && <span className="menu-empty">No sites yet</span>}
                  {sites.map(s => {
                    const on = Array.isArray(u.sites) && u.sites.includes(s.name);
                    return (
                      <label key={s.id} className={on ? "mem on" : "mem"}>
                        <input type="checkbox" checked={on} onChange={() => {
                          const cur = Array.isArray(u.sites) ? u.sites : [];
                          setUserSites(u.id, "some", on ? cur.filter(x => x !== s.name) : [...cur, s.name]);
                        }} />
                        {s.name}
                      </label>
                    );
                  })}
                </div>
              )}
              <div className="urow">
                <button className="btn ghost sm" onClick={() => {
                  const np = prompt(`Set new password for ${u.username}`);
                  if (np && np.length >= 4) resetPassword(u.id, np);
                  else if (np !== null) alert("Password must be at least 4 characters.");
                }}><Lock size={12} /> Reset password</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function UserForm({ sites, existing, onClose, onAdd }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [accessAll, setAccessAll] = useState(false);
  const [siteSel, setSiteSel] = useState([]);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const toggle = (n) => setSiteSel(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]);
  const submit = () => {
    const u = username.trim();
    if (!u) return setErr("Username required.");
    if (existing.some(x => x.username.toLowerCase() === u.toLowerCase())) return setErr("That username is taken.");
    if (password.length < 4) return setErr("Password must be at least 4 characters.");
    const sitesField = role === "admin" || accessAll ? "all" : siteSel;
    onAdd({ id: uid(), username: u, passwordHash: hashPassword(password), role, sites: sitesField });
    onClose();
  };
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-h"><h3>Add User</h3><button onClick={onClose}><X size={18} /></button></div>
        <label className="field"><span>Username</span>
          <input autoFocus value={username} onChange={e => setUsername(e.target.value)} />
        </label>
        <label className="field"><span>Password</span>
          <div className="pw">
            <input type={show ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} />
            <button type="button" onClick={() => setShow(s => !s)}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
          </div>
        </label>
        <label className="field"><span>Role</span>
          <select value={role} onChange={e => setRole(e.target.value)}>
            <option value="user">User</option>
            <option value="admin">Administrator</option>
          </select>
        </label>
        {role !== "admin" && (
          <>
            <label className="field"><span>Site access</span>
              <select value={accessAll ? "all" : "some"} onChange={e => setAccessAll(e.target.value === "all")}>
                <option value="all">All sites</option>
                <option value="some">Selected sites only</option>
              </select>
            </label>
            {!accessAll && (
              <div className="usites">
                {sites.length === 0 && <span className="menu-empty">No sites yet — create some first</span>}
                {sites.map(s => (
                  <label key={s.id} className={siteSel.includes(s.name) ? "mem on" : "mem"}>
                    <input type="checkbox" checked={siteSel.includes(s.name)} onChange={() => toggle(s.name)} />
                    {s.name}
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        {err && <div className="auth-err">{err}</div>}
        <button className="btn primary full" onClick={submit}><Plus size={16} /> Add User</button>
      </div>
    </div>
  );
}

function downloadCSV(name, text) {
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Space+Mono:wght@400;700&display=swap');
.jb{--bg:#0f1115;--panel:#171a21;--panel2:#1d212b;--line:#2a2f3a;--txt:#e7ebf2;--mut:#8b93a7;--acc:#ff5a1f;--s-grey:#6b7280;--s-amber:#f5a623;--s-green:#2ec27e;
  font-family:'Archivo',sans-serif;background:var(--bg);color:var(--txt);min-height:100vh;}
.jb *{box-sizing:border-box;}
.jb-head{display:flex;align-items:center;justify-content:space-between;padding:16px 28px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#14171e,#0f1115);position:sticky;top:0;z-index:20;flex-wrap:wrap;gap:14px;}
.brand{display:flex;align-items:center;gap:14px;}
.logo-img{height:46px;width:auto;max-width:200px;object-fit:contain;display:block;}
.brand-sub{font-size:12px;color:var(--mut);letter-spacing:1.4px;text-transform:uppercase;font-weight:600;border-left:1px solid var(--line);padding-left:14px;}
.logo{width:40px;height:40px;border-radius:10px;background:var(--acc);display:grid;place-items:center;color:#fff;box-shadow:0 4px 16px rgba(255,90,31,.4);}
.brand h1{font-size:18px;font-weight:900;letter-spacing:2px;margin:0;}
.brand span{font-size:11px;color:var(--mut);letter-spacing:1px;text-transform:uppercase;}
.head-r{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.site-picker{display:flex;align-items:center;gap:8px;padding:0 10px;background:var(--panel);border:1px solid var(--line);border-radius:12px;color:var(--s-green);}
.site-picker select{background:transparent;border:0;outline:0;color:var(--txt);font-family:inherit;font-weight:600;font-size:13px;padding:10px 4px;cursor:pointer;}
.site-picker select:focus{color:var(--s-green);}
nav{display:flex;gap:4px;background:var(--panel);padding:4px;border-radius:12px;border:1px solid var(--line);}
.nav{display:flex;align-items:center;gap:7px;padding:9px 15px;border:0;background:transparent;color:var(--mut);font-family:inherit;font-weight:600;font-size:13px;border-radius:9px;cursor:pointer;transition:.15s;}
.nav:hover{color:var(--txt);}
.nav.on{background:var(--acc);color:#fff;}
main{padding:28px;max-width:1400px;margin:0 auto;}
.wrap{animation:fade .3s;}
@keyframes fade{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}
.bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:22px;flex-wrap:wrap;gap:12px;}
.bar h2{font-size:26px;font-weight:800;margin:0;letter-spacing:-.5px;}
.bar-r{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.btn{display:inline-flex;align-items:center;gap:7px;padding:10px 15px;border-radius:9px;font-family:inherit;font-weight:600;font-size:13px;cursor:pointer;border:1px solid var(--line);background:var(--panel);color:var(--txt);transition:.15s;}
.btn:hover{border-color:#3a4150;}
.btn.primary{background:var(--acc);border-color:var(--acc);color:#fff;}
.btn.primary:hover{background:#ff6b35;}
.btn.ghost{background:transparent;}
.btn.full{width:100%;justify-content:center;margin-top:12px;}
.search{display:flex;align-items:center;gap:8px;padding:0 12px;background:var(--panel);border:1px solid var(--line);border-radius:9px;color:var(--mut);}
.toggle{display:flex;background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:3px;gap:2px;}
.toggle button{border:0;background:transparent;color:var(--mut);font-family:inherit;font-weight:600;font-size:12px;padding:7px 13px;border-radius:7px;cursor:pointer;transition:.15s;}
.toggle button.on{background:var(--acc);color:#fff;}
.lanes{display:flex;flex-direction:column;gap:14px;}
.lane{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;}
.lane-head{display:flex;align-items:center;gap:10px;padding:13px 18px;font-weight:700;font-size:14px;border-bottom:1px solid var(--line);}
.lane-head.group{color:#b78cff;background:rgba(180,120,255,.07);}
.lane-head.employee{color:#6fa8ff;background:rgba(80,140,255,.07);}
.lane-head.none{color:var(--mut);}
.lane-name{margin-right:auto;}
.lane-stats{font-size:11px;color:var(--mut);font-family:'Space Mono',monospace;font-weight:400;}
.lane-head b{background:currentColor;color:#0f1115;padding:1px 10px;border-radius:20px;font-size:12px;}
.lane-body{padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;}
.search input{background:transparent;border:0;outline:0;color:var(--txt);font-family:inherit;padding:10px 0;font-size:13px;width:180px;}
.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}
.col{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;flex-direction:column;}
.col-head{display:flex;align-items:center;gap:9px;padding:14px 16px;font-weight:700;font-size:13px;color:var(--c);border-bottom:2px solid var(--c);background:color-mix(in srgb,var(--c) 8%,transparent);}
.col-head b{margin-left:auto;background:var(--c);color:#0f1115;padding:1px 9px;border-radius:20px;font-size:12px;}
.col-body{padding:12px;display:flex;flex-direction:column;gap:10px;min-height:120px;}
.empty-sm{color:var(--mut);font-size:12px;text-align:center;padding:24px 0;}
.card{background:var(--panel2);border:1px solid var(--line);border-left:3px solid var(--c);border-radius:10px;padding:12px;}
.card-top{display:flex;justify-content:space-between;align-items:start;gap:8px;margin-bottom:10px;}
.card-top strong{font-size:14px;font-weight:700;}
.x{background:transparent;border:0;color:var(--mut);cursor:pointer;padding:2px;border-radius:5px;transition:.15s;display:grid;place-items:center;}
.x:hover{color:#ff5a5a;background:rgba(255,90,90,.1);}
.assign{position:relative;margin-bottom:10px;}
.assign-btn{width:100%;display:flex;align-items:center;justify-content:space-between;background:var(--panel);border:1px solid var(--line);border-radius:7px;padding:6px 8px;cursor:pointer;color:var(--txt);font-family:inherit;}
.pill{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:3px 9px;border-radius:20px;}
.pill.employee{background:rgba(80,140,255,.15);color:#6fa8ff;}
.pill.group{background:rgba(180,120,255,.15);color:#b78cff;}
.pill.site{background:rgba(46,194,126,.15);color:var(--s-green);}
.pill.none{background:var(--line);color:var(--mut);}
.pill.sm{font-size:11px;padding:2px 8px;text-transform:capitalize;}
.assign-menu{position:absolute;top:100%;left:0;right:0;margin-top:5px;background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:6px;z-index:30;box-shadow:0 12px 30px rgba(0,0,0,.5);max-height:240px;overflow:auto;}
.menu-sec{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--mut);padding:7px 8px 3px;font-weight:700;}
.menu-empty{font-size:12px;color:var(--mut);padding:4px 8px;}
.assign-menu button{width:100%;display:flex;align-items:center;gap:8px;background:transparent;border:0;color:var(--txt);font-family:inherit;font-size:13px;padding:7px 8px;border-radius:6px;cursor:pointer;text-align:left;}
.assign-menu button:hover{background:var(--panel);}
.assign-menu .clear{color:#ff5a5a;border-top:1px solid var(--line);margin-top:4px;}
.card-foot{display:flex;align-items:center;gap:8px;justify-content:space-between;}
.status-sel{flex:1;background:var(--panel);border:1px solid var(--line);color:var(--txt);font-family:inherit;font-size:12px;padding:6px 8px;border-radius:7px;cursor:pointer;}
.done-date{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--s-green);font-family:'Space Mono',monospace;white-space:nowrap;}
.dur{display:inline-flex;align-items:center;gap:4px;font-family:'Space Mono',monospace;font-size:11.5px;color:var(--mut);white-space:nowrap;}
.dur.running{color:var(--s-amber);}
.dur.running::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--s-amber);box-shadow:0 0 8px var(--s-amber);animation:pulse 1.2s infinite ease-in-out;}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.4;transform:scale(.7);}}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px;}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px 18px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border-top:3px solid var(--c,var(--acc));font-family:inherit;color:var(--txt);text-align:center;cursor:pointer;position:relative;transition:.15s;}
.stat:hover{transform:translateY(-2px);border-color:var(--c,var(--acc));box-shadow:0 8px 20px rgba(0,0,0,.3);}
.stat.active{background:color-mix(in srgb,var(--c,var(--acc)) 12%,var(--panel));border-color:var(--c,var(--acc));}
.stat-hint{font-size:10px;color:var(--mut);font-style:normal;text-transform:uppercase;letter-spacing:.5px;opacity:0;transition:.15s;margin-top:-2px;}
.stat:hover .stat-hint, .stat.active .stat-hint{opacity:1;}
.row-count{color:var(--mut);font-weight:400;font-size:13px;margin-left:6px;}
.crew-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:18px;margin-bottom:26px;}
.crew{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px;display:flex;flex-direction:column;gap:6px;}
.tile{padding:9px 11px;border-radius:7px;font-weight:700;font-size:12.5px;letter-spacing:.3px;text-align:center;color:#16191f;text-transform:uppercase;box-shadow:inset 0 -2px 0 rgba(0,0,0,.12);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.tile.sup{background:#f3cf42;}
.tile.sup.solo{background:#d9b239;}
.tile.grp{background:#f08a3a;color:#fff;}
.tile.grp.solo{background:#b76a2a;}
.tile.eq{background:#7fb6d4;color:#0f1115;}
.tile.eq.not_started{background:#9aa3b4;color:#0f1115;}
.tile.eq.in_progress{background:#6fa8ff;color:#0f1115;}
.tile.eq.completed{background:#a8d499;color:#0f1115;}
.tile.eq.in_progress.fresh{background:#6fa8ff;color:#0f1115;}
.tile.eq.in_progress.warn{background:#f3cf42;color:#0f1115;}
.tile.eq.in_progress.overdue{background:#e2553f;color:#fff;animation:pulseOverdue 2s ease-in-out infinite;}
@keyframes pulseOverdue{0%,100%{box-shadow:inset 0 -2px 0 rgba(0,0,0,.18);}50%{box-shadow:inset 0 -2px 0 rgba(0,0,0,.18),0 0 14px rgba(226,85,63,.55);}}
.tile.empty-tile{background:transparent;color:var(--mut);border:1px dashed var(--line);text-transform:none;font-weight:500;}
.tile.eq{display:flex;flex-direction:column;gap:2px;}
.eq-name-line{font-weight:700;}
.eq-lead-line{font-size:9.5px;font-weight:600;opacity:.78;text-transform:none;letter-spacing:.2px;}
.org-grid{display:flex;flex-direction:column;gap:24px;margin-bottom:26px;}
.org-tree{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:24px 18px;display:flex;flex-direction:column;align-items:center;overflow-x:auto;}
.org-node{display:flex;flex-direction:column;align-items:center;gap:5px;}
.org-sub{font-size:9.5px;color:var(--mut);text-transform:uppercase;letter-spacing:1px;font-weight:700;white-space:nowrap;}
.org-trunk{width:1.5px;height:18px;background:var(--line);}
.org-trunk.small{height:14px;}
.org-row{display:flex;gap:24px;align-items:flex-start;justify-content:center;position:relative;padding-top:14px;}
.org-row::before{content:"";position:absolute;top:0;left:50%;height:1.5px;background:var(--line);width:calc(100% - 80px);transform:translateX(-50%);}
.org-row.single::before{display:none;}
.org-branch{display:flex;flex-direction:column;align-items:center;gap:0;position:relative;min-width:140px;}
.org-branch::before{content:"";position:absolute;top:0;left:50%;width:1.5px;height:14px;background:var(--line);transform:translateX(-50%);}
.org-row.single .org-branch::before{display:none;}
.org-equipment{display:flex;flex-direction:column;gap:4px;width:100%;align-items:stretch;}
.tile.lead-tile{background:#c08bd9;color:#1a0f1f;min-width:120px;}
.lead-branch{display:flex;flex-direction:column;gap:5px;padding-left:14px;position:relative;margin-top:6px;}
.lead-branch::before{content:"";position:absolute;left:4px;top:8px;bottom:8px;width:1.5px;background:var(--line);border-radius:1px;}
.lead-branch.divided{border-top:1px dashed var(--line);padding-top:8px;}
.lead-self-mark{font-size:9.5px;color:var(--mut);text-transform:uppercase;letter-spacing:1.2px;font-weight:700;padding:1px 0 1px 4px;}
.lead-header{align-self:flex-start;font-size:11px !important;padding:4px 10px !important;}
.lead-eq{display:flex;flex-direction:column;gap:5px;}
.tile.lead-tile.self{background:#9bc4dd;color:#0f1115;opacity:.85;}
.org-tree .tile{padding:6px 10px;font-size:11px;letter-spacing:.3px;}
.org-tree .tile.sup{padding:8px 16px;font-size:13px;min-width:160px;}
.org-tree .tile.lead-tile{padding:6px 12px;font-size:11px;}
.org-tree .eq-name-line{font-size:11px;font-weight:700;}
.org-tree .eq-lead-line{font-size:8.5px;}
.status-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:26px;padding:18px;background:var(--panel);border:1px solid var(--line);border-radius:14px;}
.status-tile{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:18px 14px;border-radius:11px;font-family:inherit;cursor:pointer;border:2px solid transparent;color:#0f1115;font-weight:700;transition:transform .15s,box-shadow .15s;box-shadow:inset 0 -3px 0 rgba(0,0,0,.18);}
.status-tile:hover{transform:translateY(-2px);box-shadow:inset 0 -3px 0 rgba(0,0,0,.2),0 6px 18px rgba(0,0,0,.3);}
.status-tile.on{border-color:#fff;}
.status-tile.total{background:#f08a3a;color:#fff;}
.status-tile.not_started{background:#9aa3b4;}
.status-tile.in_progress{background:#6fa8ff;}
.status-tile.completed{background:#a8d499;}
.status-tile span{font-size:11.5px;text-transform:uppercase;letter-spacing:.7px;display:flex;align-items:center;gap:5px;font-weight:700;}
.status-tile b{font-size:36px;font-weight:900;font-family:'Space Mono',monospace;line-height:1;}
.status-tile em{font-size:10px;text-transform:uppercase;letter-spacing:.5px;font-style:normal;opacity:.7;font-weight:600;}
.stat span{font-size:12px;color:var(--mut);font-weight:600;display:flex;align-items:center;gap:6px;text-transform:uppercase;letter-spacing:.5px;}
.stat b{font-size:34px;font-weight:900;font-family:'Space Mono',monospace;}
.stat.big{--c:var(--acc);}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;}
.panel-h{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--line);flex-wrap:wrap;gap:12px;}
.panel-h h3{margin:0;font-size:16px;font-weight:700;}
.filters{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
.filters label{font-size:12px;color:var(--mut);display:flex;align-items:center;gap:6px;font-weight:600;}
.filters input,.filters select{background:var(--panel2);border:1px solid var(--line);color:var(--txt);font-family:inherit;padding:7px 9px;border-radius:7px;font-size:12px;}
.tbl{width:100%;border-collapse:collapse;}
.tbl th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:var(--mut);padding:12px 20px;border-bottom:1px solid var(--line);font-weight:700;}
.tbl td{padding:13px 20px;border-bottom:1px solid var(--line);font-size:14px;}
.tbl tr:last-child td{border-bottom:0;}
.tbl tbody tr:hover{background:var(--panel2);}
.tbl .muted{color:var(--mut);font-size:12.5px;}
.tbl .mono{font-family:'Space Mono',monospace;font-size:12px;color:var(--mut);}
.td-empty{text-align:center;color:var(--mut);padding:32px!important;}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;}
.empty{grid-column:1/-1;text-align:center;color:var(--mut);padding:50px;border:1px dashed var(--line);border-radius:14px;}
.pcard{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:14px;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}
.pcard-l{display:flex;flex-direction:column;gap:7px;flex:1;min-width:0;}
.pmeta{display:flex;flex-wrap:wrap;gap:5px;}
.meta-tag{font-size:10.5px;font-weight:600;padding:2px 8px;border-radius:5px;letter-spacing:.3px;}
.meta-tag.title{background:var(--panel2);color:var(--mut);border:1px solid var(--line);}
.meta-tag.shift{background:rgba(46,194,126,.13);color:var(--s-green);}
.meta-tag.group{background:rgba(180,120,255,.15);color:#b78cff;display:inline-flex;align-items:center;gap:4px;}
.meta-tag.site{background:rgba(46,194,126,.13);color:var(--s-green);}
.meta-tag.unit{background:rgba(80,140,255,.13);color:#6fa8ff;}
.meta-tag.system{background:rgba(245,166,35,.13);color:var(--s-amber);}
.meta-tag.area{background:rgba(255,90,31,.13);color:var(--acc);}
.eq-meta{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;}
.eq-table-wrap{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;}
.eq-summary{display:flex;gap:14px;padding:11px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap;background:var(--panel2);}
.sum{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--mut);text-transform:uppercase;letter-spacing:.5px;}
.sum b{color:var(--c,var(--txt));font-family:'Space Mono',monospace;font-size:13px;}
.sum.total{margin-left:auto;color:var(--txt);}
.sum.total b{color:var(--acc);}
.eq-table{width:100%;border-collapse:collapse;font-size:13px;}
.eq-table th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.7px;color:var(--mut);padding:9px 12px;border-bottom:1px solid var(--line);font-weight:700;white-space:nowrap;}
.eq-table .sort-row th{cursor:pointer;user-select:none;transition:color .15s;}
.eq-table .sort-row th:hover{color:var(--txt);}
.eq-table .filter-row th{padding:6px 8px;background:rgba(255,255,255,.015);border-bottom:1px solid var(--line);}
.eq-table .flt{width:100%;min-width:80px;background:var(--panel2);border:1px solid var(--line);color:var(--txt);font-family:inherit;font-size:11.5px;padding:5px 7px;border-radius:5px;outline:0;}
.eq-table .flt:focus{border-color:var(--acc);}
.eq-table .flt:hover{border-color:#3a4150;}
.clear-flt{background:transparent;border:0;color:var(--mut);cursor:pointer;padding:2px 4px;border-radius:4px;display:inline-flex;align-items:center;}
.clear-flt:hover{color:#ff5a5a;background:rgba(255,90,90,.1);}
.eq-table td{padding:6px 12px;border-bottom:1px solid var(--line);vertical-align:middle;}
.eq-table tbody tr:last-child td{border-bottom:0;}
.eq-table tbody tr:hover{background:rgba(255,255,255,.02);}
.eq-table .eq-name{font-weight:600;display:flex;align-items:center;gap:8px;white-space:nowrap;}
.row-dot{width:8px;height:8px;border-radius:50%;background:var(--c);flex-shrink:0;}
.eq-table .muted{color:var(--mut);font-size:12px;white-space:nowrap;}
.eq-table .mono{font-family:'Space Mono',monospace;font-size:11.5px;}
.row-sel{background:transparent;border:1px solid transparent;color:var(--txt);font-family:inherit;font-size:12px;padding:4px 6px;border-radius:6px;cursor:pointer;max-width:170px;}
.row-sel:hover{background:var(--panel2);border-color:var(--line);}
.row-sel.status{font-weight:600;}
@media(max-width:820px){
  .eq-table-wrap{overflow-x:auto;}
  .eq-summary{font-size:10px;}
}
.field{display:flex;flex-direction:column;gap:5px;margin-bottom:11px;}
.field span{font-size:11px;color:var(--mut);text-transform:uppercase;letter-spacing:.7px;font-weight:700;}
.link{background:transparent;border:0;color:var(--acc);font-family:inherit;font-size:12px;font-weight:600;cursor:pointer;padding:0;text-decoration:underline;}
.pcard.selectable{cursor:pointer;transition:.15s;}
.pcard.selectable:hover{border-color:#3a4150;}
.pcard.sel{border-color:var(--acc);background:rgba(255,90,31,.08);}
.sel-box{accent-color:var(--acc);width:16px;height:16px;}
.sel-count{font-size:13px;color:var(--mut);font-weight:600;align-self:center;}
.btn:disabled{opacity:.4;cursor:not-allowed;}
.pcard-r{display:flex;align-items:center;gap:10px;}
.load{font-size:11px;color:var(--mut);font-family:'Space Mono',monospace;}
.gcard{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:16px;}
.gcard-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;}
.gcount{font-size:11px;color:var(--mut);margin-bottom:12px;font-family:'Space Mono',monospace;}
.gsite{margin-bottom:8px;}
.scard{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:16px;display:flex;flex-direction:column;gap:12px;border-left:3px solid var(--s-green);}
.scard-h{display:flex;align-items:center;justify-content:space-between;}
.scard-stats{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--mut);font-family:'Space Mono',monospace;}
.scard-stats b{color:var(--txt);font-size:14px;margin-right:3px;}
.scard-actions{display:flex;gap:8px;flex-wrap:wrap;}
.btn.sm{padding:7px 10px;font-size:12px;}
.members{display:flex;flex-wrap:wrap;gap:7px;}
.mem{display:flex;align-items:center;gap:5px;font-size:12px;padding:5px 10px;border-radius:20px;background:var(--panel2);border:1px solid var(--line);cursor:pointer;color:var(--mut);transition:.15s;}
.mem input{display:none;}
.mem.on{background:rgba(180,120,255,.15);color:#b78cff;border-color:transparent;}
.hint{font-size:12px;color:var(--mut);margin-top:16px;}
.flash{margin-top:14px;padding:10px 14px;border-radius:9px;font-size:13px;display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid;}
.flash.ok{background:rgba(46,194,126,.08);border-color:rgba(46,194,126,.35);color:var(--s-green);}
.flash.warn{background:rgba(245,166,35,.08);border-color:rgba(245,166,35,.35);color:var(--s-amber);}
.flash.err{background:rgba(255,90,90,.08);border-color:rgba(255,90,90,.35);color:#ff7a7a;}
.flash button{background:transparent;border:0;color:inherit;cursor:pointer;display:grid;place-items:center;padding:2px;border-radius:5px;}
.flash button:hover{background:rgba(255,255,255,.06);}
.auth-screen{min-height:100vh;display:grid;place-items:center;padding:20px;background:radial-gradient(circle at 20% 0%,rgba(255,90,31,.1),transparent 60%),var(--bg);}
.auth-card{width:380px;max-width:100%;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:30px;}
.auth-h{text-align:center;margin-bottom:22px;display:flex;flex-direction:column;align-items:center;gap:10px;}
.auth-logo{height:60px;max-width:240px;margin-bottom:4px;}
.auth-h h1{margin:6px 0 0;font-size:24px;font-weight:800;letter-spacing:-.5px;}
.auth-h p{margin:0;color:var(--mut);font-size:13px;}
.auth-err{background:rgba(255,90,90,.08);border:1px solid rgba(255,90,90,.35);color:#ff7a7a;padding:9px 12px;border-radius:8px;font-size:12.5px;margin-bottom:12px;}
.pw{display:flex;background:var(--panel2);border:1px solid var(--line);border-radius:9px;overflow:hidden;}
.pw input{flex:1;background:transparent;border:0;outline:0;color:var(--txt);font-family:inherit;padding:11px 13px;font-size:14px;}
.pw button{background:transparent;border:0;color:var(--mut);cursor:pointer;padding:0 12px;display:grid;place-items:center;}
.pw button:hover{color:var(--txt);}
.user-chip{display:flex;align-items:center;gap:7px;padding:7px 12px;background:var(--panel);border:1px solid var(--line);border-radius:12px;color:var(--txt);font-size:13px;font-weight:600;}
.user-chip button{background:transparent;border:0;color:var(--mut);cursor:pointer;margin-left:3px;display:grid;place-items:center;padding:3px;border-radius:5px;}
.user-chip button:hover{color:#ff7a7a;background:rgba(255,90,90,.1);}
.ucard{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:16px;display:flex;flex-direction:column;gap:10px;}
.ucard-h{display:flex;align-items:center;justify-content:space-between;}
.urow{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--mut);}
.urow-l{flex:1;font-weight:600;text-transform:uppercase;letter-spacing:.5px;font-size:11px;}
.urow select{background:var(--panel2);border:1px solid var(--line);color:var(--txt);font-family:inherit;font-size:12px;padding:6px 8px;border-radius:6px;}
.usites{display:flex;flex-wrap:wrap;gap:6px;}
.pill.admin-pill{background:rgba(255,90,31,.15);color:var(--acc);}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:grid;place-items:center;z-index:100;backdrop-filter:blur(3px);}
.modal{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:22px;width:360px;max-width:90vw;}
.modal-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;}
.modal-h h3{margin:0;font-size:17px;}
.modal-sub{color:var(--s-green);font-weight:600;font-size:13px;}
.modal-h button{background:transparent;border:0;color:var(--mut);cursor:pointer;}
.modal input{width:100%;background:var(--panel2);border:1px solid var(--line);color:var(--txt);font-family:inherit;padding:11px 13px;border-radius:9px;font-size:14px;outline:0;}
.modal input:focus{border-color:var(--acc);}
@media(max-width:820px){.cols{grid-template-columns:1fr;}.stats{grid-template-columns:repeat(2,1fr);}nav .nav span{display:none;}}
`;
