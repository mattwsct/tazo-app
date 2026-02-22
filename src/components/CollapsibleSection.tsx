'use client';

import { useState, useCallback, useEffect } from 'react';

export const COLLAPSE_ALL_EVENT = 'admin-collapse-sections';

export function collapseAllSections(collapsed: boolean) {
  window.dispatchEvent(new CustomEvent(COLLAPSE_ALL_EVENT, { detail: { collapsed } }));
}

export default function CollapsibleSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ collapsed: boolean }>).detail;
      setCollapsed(detail.collapsed);
    };
    window.addEventListener(COLLAPSE_ALL_EVENT, handler);
    return () => window.removeEventListener(COLLAPSE_ALL_EVENT, handler);
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => !prev);
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
