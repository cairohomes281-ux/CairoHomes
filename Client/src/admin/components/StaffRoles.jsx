import { useMemo } from 'react';
import { Edit2, Trash2, ShieldPlus, Users as UsersIcon, Plus, RotateCcw } from 'lucide-react';
import SearchableSelect from './ui/SearchableSelect';
import { ROLE_LABELS, ROLE_COLORS, PAGE_CATALOG, pagesForBaseRole } from '../utils/permissions';

export const EMPTY_ROLE_FORM = { name: '', description: '', base_role: '', pages: [] };

const PAGE_LABEL = Object.fromEntries(PAGE_CATALOG.map((p) => [p.page, p.label]));

function groupPages(pages) {
  const groups = [];
  for (const p of pages) {
    let g = groups.find((x) => x.name === p.group);
    if (!g) {
      g = { name: p.group, pages: [] };
      groups.push(g);
    }
    g.pages.push(p);
  }
  return groups;
}

export function RoleForm({ form, setForm, baseRoleOptions }) {
  const available = useMemo(() => pagesForBaseRole(form.base_role), [form.base_role]);
  const groups = useMemo(() => groupPages(available), [available]);
  const selected = new Set(form.pages || []);

  const toggle = (page) =>
    setForm((f) => {
      const next = new Set(f.pages || []);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return { ...f, pages: [...next] };
    });

  const setGroup = (group, on) =>
    setForm((f) => {
      const next = new Set(f.pages || []);
      for (const p of group.pages) {
        if (on) next.add(p.page);
        else next.delete(p.page);
      }
      return { ...f, pages: [...next] };
    });

  return (
    <div className="space-y-5">
      <p className="text-xs text-ch-muted">
        A custom role gets its own name and a chosen set of pages. It keeps the permissions of the
        role it works like, so it can never see more than that role.
      </p>
      <div className="form-grid">
        <div>
          <label className="label">Role name *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Guest Relations"
            maxLength={60}
          />
        </div>
        <div>
          <label className="label">Works like *</label>
          <SearchableSelect
            value={form.base_role}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                base_role: v,
                pages: v === f.base_role ? f.pages : pagesForBaseRole(v).map((p) => p.page),
              }))
            }
            placeholder="Pick a built-in role…"
            options={baseRoleOptions.map((r) => ({ value: r, label: ROLE_LABELS[r] || r }))}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Description</label>
          <input
            className="input"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="What this role is responsible for (optional)"
            maxLength={240}
          />
        </div>
      </div>

      <div>
        <div className="flex items-end justify-between gap-3 mb-2">
          <div>
            <label className="label mb-0">Pages this role can open</label>
            <p className="text-[11px] text-ch-muted">
              {form.base_role
                ? `${selected.size} of ${available.length} pages · Profile is always included`
                : 'Pick what the role works like to choose its pages'}
            </p>
          </div>
          {available.length > 0 && (
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                className="text-ch-pine hover:underline"
                onClick={() => setForm((f) => ({ ...f, pages: available.map((p) => p.page) }))}
              >
                Select all
              </button>
              <span className="text-ch-line">|</span>
              <button
                type="button"
                className="text-ch-muted hover:underline"
                onClick={() => setForm((f) => ({ ...f, pages: [] }))}
              >
                Clear
              </button>
            </div>
          )}
        </div>
        {groups.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-3">
            {groups.map((g) => {
              const onCount = g.pages.filter((p) => selected.has(p.page)).length;
              const allOn = onCount === g.pages.length;
              return (
                <div key={g.name} className="rounded-xl border border-ch-line bg-white">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-ch-line bg-ch-ivory/60 rounded-t-xl">
                    <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-ch-muted">
                      {g.name}
                    </span>
                    <button
                      type="button"
                      className="text-[11px] text-ch-pine hover:underline"
                      onClick={() => setGroup(g, !allOn)}
                    >
                      {allOn ? 'None' : 'All'}
                    </button>
                  </div>
                  <div className="p-2 space-y-0.5">
                    {g.pages.map((p) => (
                      <label
                        key={p.page}
                        className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-ch-rose/40 text-sm"
                      >
                        <input
                          type="checkbox"
                          className="rounded border-ch-line text-ch-pine focus:ring-ch-pine"
                          checked={selected.has(p.page)}
                          onChange={() => toggle(p.page)}
                        />
                        <span>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function StaffRolesPanel({
  roles,
  users,
  canManage,
  onAdd,
  onEdit,
  onDelete,
  disabledRoles = [],
  canManageBuiltIn = false,
  onDeleteBuiltIn,
  onRestoreBuiltIn,
  restoringRole,
}) {
  const builtInCounts = useMemo(() => {
    const counts = {};
    for (const u of users) {
      if (u.role === 'owner' || u.custom_role_id) continue;
      counts[u.role] = (counts[u.role] || 0) + 1;
    }
    return counts;
  }, [users]);

  const builtInUsage = useMemo(() => {
    const usage = {};
    const entry = (r) => (usage[r] ||= { users: 0, customRoles: [] });
    for (const u of users) entry(u.role).users += 1;
    for (const r of roles) entry(r.base_role).customRoles.push(r.name);
    return usage;
  }, [users, roles]);

  const disabledSet = new Set(disabledRoles);
  const builtInRoles = Object.keys(ROLE_LABELS).filter((r) => r !== 'owner' && r !== 'reservations');
  const activeBuiltIn = builtInRoles.filter((r) => !disabledSet.has(r));
  const deletedBuiltIn = builtInRoles.filter((r) => disabledSet.has(r));

  const deleteBlockReason = (r) => {
    if (r === 'admin') return 'The CEO role cannot be deleted';
    const u = builtInUsage[r];
    if (u?.users) return `${u.users} staff member${u.users === 1 ? '' : 's'} still on this role`;
    if (u?.customRoles.length) return `Custom role ${u.customRoles.join(', ')} works like this role`;
    return null;
  };

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="font-display text-lg text-ch-pine">Custom roles</h2>
          <span className="text-xs text-ch-muted">
            {roles.length} role{roles.length === 1 ? '' : 's'}
          </span>
        </div>
        {roles.length === 0 ? (
          <div className="card flex flex-col items-center text-center py-10">
            <div className="w-12 h-12 rounded-t-full rounded-b-lg bg-ch-rose flex items-center justify-center mb-3">
              <ShieldPlus className="w-5 h-5 text-ch-pine" />
            </div>
            <p className="font-medium text-ch-ink">No custom roles yet</p>
            <p className="text-sm text-ch-muted mt-1 max-w-sm">
              Create a role like “Guest Relations” or “Night Desk”, choose the pages it can open,
              then assign it to staff from the Staff tab.
            </p>
            {canManage && (
              <button type="button" onClick={onAdd} className="btn-primary mt-4">
                <Plus className="w-4 h-4" /> Add Role
              </button>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {roles.map((r) => {
              const pages = Array.isArray(r.pages) ? r.pages : [];
              return (
                <article key={r.id} className="card p-0 overflow-hidden flex flex-col">
                  <div className="px-5 pt-5 pb-4 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-display text-lg text-ch-ink leading-tight truncate">
                          {r.name}
                        </h3>
                        <p className="text-xs text-ch-muted mt-0.5">
                          Works like{' '}
                          <span className={`badge ${ROLE_COLORS[r.base_role] || 'badge-gray'}`}>
                            {ROLE_LABELS[r.base_role] || r.base_role}
                          </span>
                        </p>
                      </div>
                      {canManage && (
                        <div className="flex gap-1 flex-shrink-0">
                          <button
                            type="button"
                            onClick={() => onEdit(r)}
                            className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50"
                            title="Edit role"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(r)}
                            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                            title="Delete role"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    {r.description && (
                      <p className="text-sm text-ch-muted mt-3 line-clamp-2">{r.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {pages.slice(0, 8).map((p) => (
                        <span
                          key={p}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-ch-rose/70 text-ch-pine-dark"
                        >
                          {PAGE_LABEL[p] || p}
                        </span>
                      ))}
                      {pages.length > 8 && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-ch-muted">
                          +{pages.length - 8} more
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="px-5 py-2.5 border-t border-ch-line bg-ch-ivory/50 flex items-center gap-2 text-xs text-ch-muted">
                    <UsersIcon className="w-3.5 h-3.5" />
                    {r.user_count || 0} staff member{Number(r.user_count) === 1 ? '' : 's'}
                    <span className="ml-auto">{pages.length} pages</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="font-display text-lg text-ch-pine">Built-in roles</h2>
          <span className="text-xs text-ch-muted">Custom roles are built on one of these</span>
        </div>
        <div className="card">
          <div className="flex flex-wrap gap-2">
            {activeBuiltIn.map((r) => {
              const blocked = deleteBlockReason(r);
              return (
                <span
                  key={r}
                  className="inline-flex items-center gap-2 rounded-full border border-ch-line px-3 py-1 text-xs"
                >
                  <span className={`badge ${ROLE_COLORS[r] || 'badge-gray'}`}>{ROLE_LABELS[r]}</span>
                  <span className="tabular-nums text-ch-muted">{builtInCounts[r] || 0}</span>
                  {canManageBuiltIn && r !== 'admin' && (
                    <button
                      type="button"
                      onClick={() => onDeleteBuiltIn?.(r)}
                      disabled={!!blocked}
                      className="-mr-1 p-0.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:text-gray-400 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                      title={blocked ? `Can't delete: ${blocked}` : 'Delete role'}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
          {canManageBuiltIn && (
            <p className="text-[11px] text-ch-muted mt-3">
              A built-in role can be deleted once no staff member or custom role uses it. Deleted
              roles disappear from every role picker.
            </p>
          )}
        </div>
      </section>

      {deletedBuiltIn.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="font-display text-lg text-ch-pine">Deleted roles</h2>
            <span className="text-xs text-ch-muted">Hidden from role pickers</span>
          </div>
          <div className="card">
            <div className="flex flex-wrap gap-2">
              {deletedBuiltIn.map((r) => (
                <span
                  key={r}
                  className="inline-flex items-center gap-2 rounded-full border border-dashed border-ch-line px-3 py-1 text-xs text-ch-muted"
                >
                  <span className="line-through">{ROLE_LABELS[r]}</span>
                  {canManageBuiltIn && (
                    <button
                      type="button"
                      onClick={() => onRestoreBuiltIn?.(r)}
                      disabled={restoringRole === r}
                      className="inline-flex items-center gap-1 text-ch-pine hover:underline disabled:opacity-50"
                      title="Restore role"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Restore
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
