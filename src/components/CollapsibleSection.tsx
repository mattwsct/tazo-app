'use client';

import { useState, useEffect, useCallback } from 'react';

export const STORAGE_KEY = 'admin_sections_collapsed';
export const COLLAPSE_ALL_EVENT = 'admin-collapse-sections';

function loadCollapsed(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCollapsed(map: Record<string, boolean>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export const ADMIN_SECTION_IDS = [
  'location-map',
  'connection',
  'stream-title',
  'weather-altitude-speed',
  'steps-distance',
  'todo-list',
  'leaderboard-alerts',
  'poll',
  'message-templates',
] as const;

export function collapseAllSections(collapsed: boolean) {
  const map: Record<string, boolean> = {};
  for (const id of ADMIN_SECTION_IDS) {
    map[id] = collapsed;
  }
  saveCollapsed(map);
  window.dispatchEvent(new CustomEvent(COLLAPSE_ALL_EVENT));
}

export default function CollapsibleSection({
  id,
  title,
  description,
  children,
  defaultCollapsed = false,
}: {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    const stored = loadCollapsed();
    return id in stored ? stored[id] : defaultCollapsed;
  });

  useEffect(() => {
    const stored = loadCollapsed();
    const next = { ...stored, [id]: collapsed };
    saveCollapsed(next);
  }, [id, collapsed]);

  useEffect(() => {
    const handler = () => {
      const stored = loadCollapsed();
      setCollapsedState(id in stored ? stored[id] : defaultCollapsed);
    };
    window.addEventListener(COLLAPSE_ALL_EVENT, handler);
    return () => window.removeEventListener(COLLAPSE_ALL_EVENT, handler);
  }, [id, defaultCollapsed]);

  const toggle = useCallback(() => {
    setCollapsedState((prev) => !prev);
  }, []);

  return (
    <section className="settings-section collapsible-section" data-section-id={id} data-collapsed={collapsed}>
      <button
        type="button"
        className="section-header collapsible-header"
        onClick={toggle}
        aria-expanded={!collapsed}
      >
        <span className="collapsible-chevron" aria-hidden>{collapsed ? '▶' : '▼'}</span>
        <h2 className="collapsible-title">{title}</h2>
      </button>
      {!collapsed && (
        <div className="collapsible-content">
          {description && <p className="section-description">{description}</p>}
          {children}
        </div>
      )}
    </section>
  );
}
