import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { eventFromPath, reportEvent } from '../utils/siteTelemetry';

export default function SiteTelemetryBridge() {
  const location = useLocation();
  const previous = useRef(null);

  useEffect(() => {
    const path = location.pathname || '/';
    if (path.startsWith('/admin') || path.startsWith('/sales')) return undefined;

    const now = Date.now();
    if (previous.current) {
      reportEvent({
        event: 'page_timing',
        path: previous.current.path,
        duration_ms: Math.max(0, now - previous.current.at),
        unit_slug: previous.current.unit_slug,
      });
    }

    const mapped = eventFromPath(path, location.search || '');
    if (mapped) reportEvent({ ...mapped, path });
    previous.current = { path, at: now, unit_slug: mapped?.unit_slug || null };

    try {
      const nav = performance.getEntriesByType?.('navigation')?.[0];
      if (nav && !sessionStorage.getItem(`ch_nav_${path}`)) {
        sessionStorage.setItem(`ch_nav_${path}`, '1');
        if (Number(nav.duration) > 0) {
          reportEvent({
            event: 'page_timing',
            path,
            duration_ms: Math.round(nav.duration),
            unit_slug: mapped?.unit_slug || null,
          });
        }
      }
    } catch {
      /* ignore */
    }

    return undefined;
  }, [location.pathname, location.search]);

  return null;
}
