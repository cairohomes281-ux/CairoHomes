import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/http';
import { COMPOUNDS, AREAS, CAIRO_IMAGES } from '../data/compounds';

export const PROJECT_CATALOG_KEY = ['guest-projects-catalog'];


const FALLBACK_CATALOG = {
  destinations: AREAS,
  projectsByDestination: COMPOUNDS.reduce((acc, c) => {
    if (!acc[c.area]) acc[c.area] = [];
    acc[c.area].push(c.name);
    return acc;
  }, {}),
  items: COMPOUNDS.map((c, i) => ({
    id: c.slug,
    destination: c.area,
    name: c.name,
    image_url: c.image,
    sort_order: i,
  })),
};

async function fetchProjectCatalog() {
  const { data } = await api.get('/projects/catalog');
  const payload = data?.data || data || {};
  return {
    destinations: Array.isArray(payload.destinations) ? payload.destinations : [],
    projectsByDestination:
      payload.projectsByDestination && typeof payload.projectsByDestination === 'object'
        ? payload.projectsByDestination
        : {},
    items: Array.isArray(payload.items) ? payload.items : [],
  };
}


export function useProjectCatalog() {
  const { data, isLoading, error, refetch, isError, isSuccess } = useQuery({
    queryKey: PROJECT_CATALOG_KEY,
    queryFn: fetchProjectCatalog,
    staleTime: 10 * 60_000,
  });

  const resolved =
    isSuccess && data
      ? data
      : isError
        ? FALLBACK_CATALOG
        : { destinations: [], projectsByDestination: {}, items: [] };

  const projectCards = useMemo(() => {
    const cards = [];
    for (const destination of resolved.destinations) {
      for (const name of resolved.projectsByDestination[destination] || []) {
        const item = resolved.items.find(
          (r) => r.destination === destination && r.name === name
        );
        const fallback = COMPOUNDS.find((c) => c.name === name);
        cards.push({
          id: item?.id || `${destination}-${name}`,
          name,
          destination,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          image: item?.image_url || fallback?.image || CAIRO_IMAGES.apartment,
          area: destination,
        });
      }
    }
    return cards;
  }, [resolved]);

  const projectNames = useMemo(() => {
    const names = new Set();
    for (const list of Object.values(resolved.projectsByDestination || {})) {
      for (const name of list || []) {
        if (name) names.add(String(name));
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [resolved.projectsByDestination]);

  return {
    destinations: resolved.destinations,
    projectsByDestination: resolved.projectsByDestination,
    items: resolved.items,
    projectCards,
    projectNames,
    loading: isLoading,
    error: error?.response?.data?.error || error?.message || '',
    refresh: refetch,
  };
}

export function resolveLocationFilter(where, catalog) {
  const value = String(where || '').trim();
  if (!value) return {};
  const destinations = catalog?.destinations || [];
  const projectsByDestination = catalog?.projectsByDestination || {};

  if (destinations.some((d) => d.toLowerCase() === value.toLowerCase())) {
    return { destination: value, area: value };
  }

  for (const [destination, projects] of Object.entries(projectsByDestination)) {
    if ((projects || []).some((p) => p.toLowerCase() === value.toLowerCase())) {
      return { destination, area: destination, compound: value, project: value };
    }
  }

  const compound = COMPOUNDS.find(
    (c) => c.name.toLowerCase() === value.toLowerCase() || c.slug === value.toLowerCase()
  );
  if (compound && destinations.some((d) => d.toLowerCase() === compound.area.toLowerCase())) {
    return {
      destination: compound.area,
      area: compound.area,
      compound: compound.name,
      project: compound.name,
    };
  }

  return { q: value };
}
