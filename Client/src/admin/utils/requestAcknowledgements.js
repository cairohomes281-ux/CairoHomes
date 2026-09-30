import { useSyncExternalStore } from 'react';

const listeners = new Set();
const snapshotCache = new Map();

function storageKey(kind, userId) {
  return `pms:ack:${kind}:${userId}`;
}

function readIds(kind, userId) {
  if (!userId) return new Set();
  try {
    const raw = sessionStorage.getItem(storageKey(kind, userId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeIds(kind, userId, ids) {
  if (!userId) return;
  try {
    sessionStorage.setItem(storageKey(kind, userId), JSON.stringify([...ids]));
  } catch {
    /* ignore quota errors */
  }
  snapshotCache.clear();
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(kind, userId) {
  const cacheKey = `${kind}:${userId}`;
  const ids = readIds(kind, userId);
  const serialized = JSON.stringify([...ids].sort());
  const cached = snapshotCache.get(cacheKey);
  if (cached && cached.serialized === serialized) return cached.ids;
  snapshotCache.set(cacheKey, { serialized, ids });
  return ids;
}

export function acknowledgeRequest(kind, requestId, userId) {
  if (!requestId || !userId) return;
  const ids = readIds(kind, userId);
  ids.add(String(requestId));
  writeIds(kind, userId, ids);
}

export function clearAcknowledgedRequest(kind, requestId, userId) {
  if (!requestId || !userId) return;
  const ids = readIds(kind, userId);
  ids.delete(String(requestId));
  writeIds(kind, userId, ids);
}

export function useAcknowledgedRequestIds(kind, userId) {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot(kind, userId),
    () => new Set()
  );
}

export function countActionableRequests(rows, { kind, userId, acknowledged, reviewableOnly = true }) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((row) => {
    if (row.status !== 'pending') return false;
    if (reviewableOnly && !(row.can_review_slots || []).length) return false;
    if (acknowledged?.has(String(row.id))) return false;
    return true;
  }).length;
}
