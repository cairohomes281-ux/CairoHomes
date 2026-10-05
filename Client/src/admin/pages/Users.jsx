import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Edit2,
  Trash2,
  Key,
  Users as UsersIcon,
  UserCircle,
  CheckCircle,
  XCircle,
  Check,
  X,
  Link2,
  Eye,
  Download,
  ShieldPlus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import api from '../api/axios';
import { usePermissions } from '../hooks/usePermissions';
import { useSortableTable } from '../hooks/useSortableTable';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import SortTh from '../components/ui/SortTh';
import SearchableSelect from '../components/ui/SearchableSelect';
import { StaffRolesPanel, RoleForm, EMPTY_ROLE_FORM } from '../components/StaffRoles';
import {
  ROLE_LABELS,
  ROLE_COLORS,
  roleLabel,
  creatableRoles,
  canEditStaffCompensation,
  isLineManagerRole,
  HR_STAFF_FILTER_ROLES,
  ADMIN_STAFF_FILTER_ROLES,
} from '../utils/permissions';
import { getRoleTheme } from '../utils/roleTheme';
import { currency, formatDate } from '../utils/formatters';

const TABS = [
  { id: 'staff', label: 'Staff', icon: UsersIcon },
  { id: 'roles', label: 'Roles', icon: ShieldPlus },
  { id: 'owners', label: 'Owners', icon: UserCircle },
];

const CUSTOM_PREFIX = 'custom:';

function avatarStyle(role) {
  return { background: getRoleTheme(role).avatarBg };
}

const EMPTY_STAFF_FORM = {
  full_name: '',
  email: '',
  role: 'reservations_manual',
  custom_role_id: '',
  base_salary: '',
  is_active: 1,
  sales_commission_pct: '',
  leave_casual_days: '0',
  leave_annual_days: '0',
  leave_unpaid_days: '0',
  staff_code: '',
  manager_id: '',
  manager_ids: [],
};

const EMPTY_OWNER_FORM = {
  full_name: '',
  phone: '',
  email: '',
  is_active: 1,
  unit_ids: [],
};

function OwnerUnitPicker({ selectedIds, onChange, ownerId, enabled }) {
  const [search, setSearch] = useState('');
  const { data: units = [], isLoading } = useQuery({
    queryKey: ['owner-linkable-units', ownerId || 'new'],
    queryFn: () =>
      api
        .get('/users/owners/linkable-units', {
          params: ownerId ? { owner_id: ownerId } : undefined,
        })
        .then((r) => r.data),
    enabled: Boolean(enabled),
  });

  const selected = new Set((selectedIds || []).map((id) => String(id)));
  const q = search.trim().toLowerCase();
  const allUnits = Array.isArray(units) ? units : [];

  const matchesSearch = (u) => {
    if (!q) return true;
    const hay = [u.name, u.unit_number, u.title, u.project, u.unit_owner_name, u.unit_owner_phone]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  };

  const unitLabel = (u) => u.name || u.unit_number || u.title || `Unit #${u.id}`;
  const unitMeta = (u) =>
    [u.project, u.unit_owner_name ? `Listing owner: ${u.unit_owner_name}` : null]
      .filter(Boolean)
      .join(' · ') || '—';

  const linkedUnits = allUnits.filter((u) => selected.has(String(u.id))).filter(matchesSearch);
  const availableUnits = allUnits
    .filter((u) => !selected.has(String(u.id)))
    .filter(matchesSearch);

  // Keep selected units that might not be in the latest list (edge case) visible for unlink.
  const linkedIdsInList = new Set(allUnits.map((u) => String(u.id)));
  const orphanLinkedIds = [...selected].filter((id) => !linkedIdsInList.has(id));

  const linkUnit = (id) => {
    const sid = String(id);
    if (selected.has(sid)) return;
    onChange([...(selectedIds || []), sid]);
  };

  const unlinkUnit = (id) => {
    const sid = String(id);
    onChange((selectedIds || []).filter((x) => String(x) !== sid));
  };

  const unlinkAll = () => onChange([]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="label mb-0">Units for this owner</label>
        <span className="text-[11px] text-slate-400">
          {selected.size} linked · check or use Link / Unlink, then save
        </span>
      </div>
      <p className="text-[11px] text-slate-500">
        Link or unlink any rent unit for portal access. Listing owner name/phone do not need to
        match. Unlink removes a mistaken assignment.
      </p>
      <input
        className="input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search unit, project, listing owner…"
      />

      {isLoading ? (
        <div className="p-4 text-center text-xs text-slate-400 border border-slate-200 rounded-lg">
          Loading units…
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-slate-700">
                Linked ({selected.size})
              </p>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={unlinkAll}
                  className="text-[11px] font-medium text-red-600 hover:text-red-700"
                >
                  Unlink all
                </button>
              )}
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
              {linkedUnits.length === 0 && orphanLinkedIds.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400">
                  No units linked yet
                </div>
              ) : (
                <>
                  {linkedUnits.map((u) => {
                    const id = String(u.id);
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-3 px-3 py-2.5 bg-emerald-50/40"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-800 truncate">
                            {unitLabel(u)}
                          </span>
                          <span className="block text-[11px] text-slate-500 truncate">
                            {unitMeta(u)}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => unlinkUnit(id)}
                          className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                        >
                          Unlink
                        </button>
                      </div>
                    );
                  })}
                  {orphanLinkedIds.map((id) => (
                    <div key={id} className="flex items-center gap-3 px-3 py-2.5 bg-emerald-50/40">
                      <span className="min-w-0 flex-1 text-sm font-medium text-slate-800">
                        Unit #{id}
                      </span>
                      <button
                        type="button"
                        onClick={() => unlinkUnit(id)}
                        className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                      >
                        Unlink
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-700 mb-1.5">
              Available to link ({availableUnits.length}
              {q ? ' match' : ''})
            </p>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
              {availableUnits.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400">
                  {q ? 'No matching unlinked units' : 'No unlinked units available'}
                </div>
              ) : (
                availableUnits.map((u) => {
                  const id = String(u.id);
                  return (
                    <div key={id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-800 truncate">
                          {unitLabel(u)}
                        </span>
                        <span className="block text-[11px] text-slate-500 truncate">
                          {unitMeta(u)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => linkUnit(id)}
                        className="shrink-0 text-xs font-medium text-emerald-700 hover:text-emerald-800 px-2 py-1 rounded hover:bg-emerald-50"
                      >
                        Link
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function isReservationAgentRole(role) {
  return ['reservations_web', 'reservations_manual', 'reservations'].includes(role);
}

function isUnitAcquisitionAgentRole(role) {
  return role === 'unit_acquisition_agent';
}

function isResaleAgentRole(role) {
  return role === 'resale';
}

function isFinanceAgentRole(role) {
  return role === 'finance';
}

function isWebDeveloperRole(role) {
  return role === 'web_developer';
}

function usesCommissionPct(role) {
  return isReservationAgentRole(role) || isResaleAgentRole(role);
}

function StaffForm({
  form,
  setForm,
  isEdit,
  roleOptions,
  customRoles = [],
  lockPayAndLeave,
  applySalaryImmediately,
  managerOptions = [],
}) {
  const assignableCustomRoles = customRoles.filter(
    (r) => roleOptions.includes(r.base_role) || String(r.id) === String(form.custom_role_id)
  );
  const roleValue = form.custom_role_id ? `${CUSTOM_PREFIX}${form.custom_role_id}` : form.role;
  const showCommission = usesCommissionPct(form.role);
  const lockHint = 'Only HR, an HR Manager, or a CEO can change salary and holiday balances.';
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        {lockPayAndLeave
          ? lockHint
          : isEdit
            ? applySalaryImmediately
              ? 'Staff ID, salary, leave, and other fields can be updated anytime. Changes apply immediately.'
              : 'Salary edits require CEO approval before they apply.'
            : 'Creates login with the Staff ID you enter and a one-time temporary password (shown after save). User must change password on first login.'}
      </p>
      <div className="form-grid">
        <div>
          <label className="label">Full Name *</label>
          <input
            className="input"
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            placeholder="John Smith"
          />
        </div>
        <div>
          <label className="label">Staff ID *</label>
          <input
            className="input font-mono"
            value={form.staff_code}
            onChange={(e) => setForm((f) => ({ ...f, staff_code: e.target.value }))}
            placeholder="e.g. SH12"
          />
        </div>
        <div>
          <label className="label">Email *</label>
          <input
            type="email"
            className="input"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="name@company.com"
          />
        </div>
        <div>
          <label className="label">Role *</label>
          <SearchableSelect
            value={roleValue}
            onChange={(picked) =>
              setForm((f) => {
                const custom = String(picked).startsWith(CUSTOM_PREFIX)
                  ? customRoles.find((r) => `${CUSTOM_PREFIX}${r.id}` === picked)
                  : null;
                const v = custom ? custom.base_role : picked;
                const next = {
                  ...f,
                  role: v,
                  custom_role_id: custom ? String(custom.id) : '',
                  sales_commission_pct: usesCommissionPct(v) ? f.sales_commission_pct : '',
                };
                if (v === 'web_developer' && f.manager_id) {
                  next.manager_ids = [
                    ...new Set([...(f.manager_ids || []), String(f.manager_id)]),
                  ];
                  next.manager_id = '';
                }
                if (v !== 'web_developer') {
                  next.manager_ids = [];
                }
                return next;
              })
            }
            placeholder="Select role…"
            options={[
              ...assignableCustomRoles.map((r) => ({
                value: `${CUSTOM_PREFIX}${r.id}`,
                label: `${r.name} · custom`,
              })),
              ...roleOptions.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
            ]}
          />
          {form.custom_role_id ? (
            <p className="mt-1 text-[11px] text-ch-muted">
              Custom role · works like {ROLE_LABELS[form.role] || form.role}
            </p>
          ) : null}
        </div>
        {form.role !== 'admin' && form.role !== 'owner' ? (
          isWebDeveloperRole(form.role) ? (
            <div className="sm:col-span-2">
              <label className="label">Line managers</label>
              <div className="max-h-52 overflow-y-auto rounded-xl border border-ch-line divide-y bg-white">
                {managerOptions.filter((u) => isLineManagerRole(u.role)).length === 0 ? (
                  <p className="px-3 py-3 text-sm text-ch-muted">No line managers available.</p>
                ) : (
                  managerOptions
                    .filter((u) => isLineManagerRole(u.role))
                    .map((u) => {
                      const selected = new Set((form.manager_ids || []).map(String));
                      const checked = selected.has(String(u.id));
                      return (
                        <label
                          key={u.id}
                          className="flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer hover:bg-ch-surface/70"
                        >
                          <input
                            type="checkbox"
                            className="rounded border-ch-line"
                            checked={checked}
                            onChange={() =>
                              setForm((f) => {
                                const ids = new Set((f.manager_ids || []).map(String));
                                if (ids.has(String(u.id))) ids.delete(String(u.id));
                                else ids.add(String(u.id));
                                return { ...f, manager_ids: [...ids], manager_id: '' };
                              })
                            }
                          />
                          <span className="text-ch-pine">{u.full_name}</span>
                          <span className="text-[11px] text-ch-muted">
                            {ROLE_LABELS[u.role] || u.role}
                          </span>
                        </label>
                      );
                    })
                )}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                Web developers can have more than one manager. Each selected manager can assign tasks.
                Only the primary manager (first selected) approves holiday and WFH requests,
                with the HR Manager. Loans need HR Manager then Financial Manager.
              </p>
            </div>
          ) : (
          <div>
            <label className="label">
              {isReservationAgentRole(form.role)
                ? 'Reservations manager'
                : isUnitAcquisitionAgentRole(form.role)
                  ? 'Unit Acquisition Manager'
                  : isResaleAgentRole(form.role)
                    ? 'Resale Manager'
                    : isFinanceAgentRole(form.role)
                      ? 'Financial Manager'
                      : 'Line manager'}
            </label>
            <SearchableSelect
              value={form.manager_id ? String(form.manager_id) : ''}
              onChange={(v) => setForm((f) => ({ ...f, manager_id: v }))}
              placeholder={
                isReservationAgentRole(form.role)
                  ? 'Reservations manager'
                  : isUnitAcquisitionAgentRole(form.role)
                    ? 'Unit Acquisition Manager'
                    : isResaleAgentRole(form.role)
                      ? 'Resale Manager'
                      : isFinanceAgentRole(form.role)
                        ? 'Financial Manager'
                        : 'Department default'
              }
              options={[
                {
                  value: '',
                  label: isReservationAgentRole(form.role)
                    ? 'Department default (Reservations Manager)'
                    : isUnitAcquisitionAgentRole(form.role)
                      ? 'Department default (Unit Acquisition Manager)'
                      : isResaleAgentRole(form.role)
                        ? 'Department default (Resale Manager)'
                        : isFinanceAgentRole(form.role)
                          ? 'Department default (Financial Manager)'
                          : 'Department default',
                },
                ...managerOptions.map((u) => ({
                  value: String(u.id),
                  label: `${u.full_name} (${ROLE_LABELS[u.role] || u.role})`,
                })),
              ]}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              {isReservationAgentRole(form.role)
                ? 'This manager sees the agent\'s reservations and must accept holiday and WFH requests first (then HR Manager). Loans go HR Manager → Financial Manager.'
                : isUnitAcquisitionAgentRole(form.role)
                  ? 'This manager sees the agent\'s daily audit and must accept holiday and WFH requests first (then HR Manager). Loans go HR Manager → Financial Manager.'
                  : isResaleAgentRole(form.role)
                    ? 'This manager tracks units added and signed sales for this agent on the Performance page.'
                    : isFinanceAgentRole(form.role)
                      ? 'This manager tracks finance desk activity for this agent on the Audit page.'
                      : 'Must accept holiday and WFH requests first (then the HR Manager). Loans go HR Manager → Financial Manager.'}
            </p>
          </div>
          )
        ) : null}
        <div>
          <label className="label">Base Salary (EGP) *</label>
          <input
            type="number"
            min="0"
            step="1"
            className="input"
            value={form.base_salary}
            disabled={lockPayAndLeave}
            onChange={(e) => setForm((f) => ({ ...f, base_salary: e.target.value }))}
            placeholder="8000"
          />
          {lockPayAndLeave ? (
            <p className="mt-1 text-[11px] text-amber-700">
              Ask HR, an HR Manager, or a CEO to update this salary.
            </p>
          ) : null}
        </div>
        <div>
          <label className="label">Casual days</label>
          <input
            type="number"
            min="0"
            step="1"
            className="input"
            value={form.leave_casual_days}
            disabled={lockPayAndLeave}
            onChange={(e) => setForm((f) => ({ ...f, leave_casual_days: e.target.value }))}
          />
          <p className="mt-1 text-[11px] text-slate-400">Paid casual balance. No deduction when approved.</p>
        </div>
        <div>
          <label className="label">Annual days</label>
          <input
            type="number"
            min="0"
            step="1"
            className="input"
            value={form.leave_annual_days}
            disabled={lockPayAndLeave}
            onChange={(e) => setForm((f) => ({ ...f, leave_annual_days: e.target.value }))}
          />
          <p className="mt-1 text-[11px] text-slate-400">Paid annual balance. No deduction when approved.</p>
        </div>
        <div className="sm:col-span-2 rounded-xl border border-ch-line bg-slate-50 px-3 py-2 text-sm text-ch-muted">
          Unpaid leave is unlimited for all staff. Each approved day deducts 1× daily rate (salary ÷ 30).
        </div>
        {showCommission && (
          <div>
            <label className="label">Commission % *</label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              className="input"
              value={form.sales_commission_pct}
              onChange={(e) => setForm((f) => ({ ...f, sales_commission_pct: e.target.value }))}
              placeholder="e.g. 1.5"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              {isResaleAgentRole(form.role)
                ? 'Of expected sale value on signed owner requests'
                : 'Of company commission on reservations assigned to this agent'}
            </p>
          </div>
        )}
        {isEdit && (
          <div>
            <label className="label">Status</label>
            <SearchableSelect
              value={String(form.is_active)}
              onChange={(v) => setForm((f) => ({ ...f, is_active: parseInt(v, 10) }))}
              options={[
                { value: '1', label: 'Active' },
                { value: '0', label: 'Inactive' },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function OwnerForm({ form, setForm, isEdit, ownerId, showUnits }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        {isEdit
          ? 'Update owner profile details. Phone/login cannot be changed here.'
          : 'Creates an owner portal login. Phone is the username. A one-time temporary password is shown after save — owner must change it on first login.'}
      </p>
      <div className="form-grid">
        <div>
          <label className="label">Full Name *</label>
          <input
            className="input"
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            placeholder="Owner name"
          />
        </div>
        <div>
          <label className="label">Phone {isEdit ? '' : '*'}</label>
          <input
            className="input"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="01xxxxxxxxx"
            disabled={isEdit}
          />
          {isEdit ? (
            <p className="mt-1 text-[11px] text-slate-400">Login username (read-only)</p>
          ) : (
            <p className="mt-1 text-[11px] text-slate-400">Used as the owner portal username</p>
          )}
        </div>
        <div>
          <label className="label">Email</label>
          <input
            type="email"
            className="input"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="Optional — auto-generated if blank"
          />
        </div>
        {isEdit && (
          <div>
            <label className="label">Status</label>
            <SearchableSelect
              value={String(form.is_active)}
              onChange={(v) => setForm((f) => ({ ...f, is_active: parseInt(v, 10) }))}
              options={[
                { value: '1', label: 'Active' },
                { value: '0', label: 'Inactive' },
              ]}
            />
          </div>
        )}
      </div>
      {showUnits ? (
        <OwnerUnitPicker
          selectedIds={form.unit_ids || []}
          onChange={(unit_ids) => setForm((f) => ({ ...f, unit_ids }))}
          ownerId={ownerId}
          enabled
        />
      ) : null}
    </div>
  );
}

function ownerEmailDisplay(email) {
  if (!email || String(email).includes('@cairohomes.owners.local')) return '—';
  return email;
}

function OwnerDetailsView({ owner, units, loading }) {
  if (!owner) return null;
  const linked = Array.isArray(units) ? units : [];

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-ch-line bg-slate-50 px-4 py-4">
        <div className="flex items-start gap-3">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
            style={avatarStyle('owner')}
          >
            {owner.full_name?.charAt(0)?.toUpperCase() || 'O'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-ch-pine">{owner.full_name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {owner.is_active ? (
                <span className="flex items-center gap-1 text-green-600 text-xs">
                  <CheckCircle className="w-3.5 h-3.5" /> Active
                </span>
              ) : (
                <span className="flex items-center gap-1 text-red-500 text-xs">
                  <XCircle className="w-3.5 h-3.5" /> Inactive
                </span>
              )}
              {owner.is_first_login ? (
                <span className="text-[10px] text-amber-600 font-medium">Must change password</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-400">Phone</div>
            <div className="font-mono font-semibold">{owner.username || '—'}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-400">Email</div>
            <div>{ownerEmailDisplay(owner.email)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-400">Created</div>
            <div>{formatDate(owner.created_at)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-gray-400">Linked units</div>
            <div className="tabular-nums font-semibold">{linked.length}</div>
          </div>
        </div>
      </div>

      <div>
        <div className="text-sm font-medium text-ch-pine mb-2">Linked units</div>
        {loading ? (
          <LoadingSpinner />
        ) : linked.length === 0 ? (
          <p className="text-sm text-gray-500 py-6 text-center">No units linked to this owner.</p>
        ) : (
          <div className="table-wrapper rounded-xl border border-ch-line">
            <table className="table text-xs">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Project</th>
                  <th>Area</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {linked.map((u) => (
                  <tr key={u.id}>
                    <td className="font-medium">
                      {u.unit_number || u.name || u.title || '—'}
                      {u.title && u.unit_number && u.title !== u.unit_number ? (
                        <div className="text-[10px] text-gray-400 font-normal">{u.title}</div>
                      ) : null}
                    </td>
                    <td>{u.project || u.compound || u.project_label || '—'}</td>
                    <td>{u.area || '—'}</td>
                    <td>{u.listing_type === 'long_term' ? 'Long term' : 'Short term'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Users() {
  const qc = useQueryClient();
  const { isAdmin, isHr, isHrSupervisor, isUnitAcquisition, role, user } = usePermissions();
  const canCreateOwners = isAdmin || isUnitAcquisition;
  const canLinkUnits = isAdmin || isUnitAcquisition;
  const canSeeStaffTab = isAdmin || isHr;
  const canSeeOwnersTab = isAdmin || isUnitAcquisition;

  const canSeeRolesTab = canSeeStaffTab;
  const { data: disabledRoles = [] } = useQuery({
    queryKey: ['staff-roles-disabled'],
    queryFn: () => api.get('/staff-roles/disabled').then((r) => r.data),
    enabled: canSeeRolesTab,
  });
  const disabledRoleSet = new Set(disabledRoles);
  const staffRoleOptions = creatableRoles(role).filter(
    (r) => r !== 'owner' && !disabledRoleSet.has(r)
  );
  const visibleTabs = TABS.filter((t) =>
    t.id === 'owners' ? canSeeOwnersTab : t.id === 'roles' ? canSeeRolesTab : canSeeStaffTab
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || (canSeeStaffTab ? 'staff' : 'owners');
  const activeTab = rawTab === 'owners' || rawTab === 'roles' ? rawTab : 'staff';
  const isOwnersTab = activeTab === 'owners';
  const isRolesTab = activeTab === 'roles';

  function setTab(id) {
    setSearchParams({ tab: id }, { replace: true });
  }

  useEffect(() => {
    if (!visibleTabs.some((t) => t.id === activeTab) && visibleTabs[0]) setTab(visibleTabs[0].id);
  }, [canSeeStaffTab, canSeeOwnersTab, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [modal, setModal] = useState(null);
  const [staffForm, setStaffForm] = useState(EMPTY_STAFF_FORM);
  const formRoleOptions =
    modal === 'edit-staff' && staffForm.role && !staffRoleOptions.includes(staffForm.role)
      ? [staffForm.role, ...staffRoleOptions]
      : staffRoleOptions;
  const [ownerForm, setOwnerForm] = useState(EMPTY_OWNER_FORM);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [createdInfo, setCreatedInfo] = useState(null);
  const [viewOwnerId, setViewOwnerId] = useState(null);
  const [roleForm, setRoleForm] = useState(EMPTY_ROLE_FORM);
  const [editRoleId, setEditRoleId] = useState(null);
  const [deleteRole, setDeleteRole] = useState(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  });

  const { data: customRoles = [], isLoading: rolesLoading } = useQuery({
    queryKey: ['staff-roles'],
    queryFn: () => api.get('/staff-roles').then((r) => r.data),
    enabled: canSeeRolesTab,
  });
  const roleBaseOptions = staffRoleOptions;
  const canManageRoles = canSeeRolesTab && roleBaseOptions.length > 0;

  const saveRoleMutation = useMutation({
    mutationFn: (d) =>
      editRoleId ? api.patch(`/staff-roles/${editRoleId}`, d) : api.post('/staff-roles', d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-roles'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success(editRoleId ? 'Role updated' : 'Role created');
      setModal(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving role'),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (id) => api.delete(`/staff-roles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-roles'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Role deleted');
      setDeleteRole(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error deleting role'),
  });

  const [deleteBuiltInRole, setDeleteBuiltInRole] = useState(null);
  const builtInRoleMutation = useMutation({
    mutationFn: ({ role: r, restore }) =>
      restore
        ? api.post(`/staff-roles/built-in/${r}/restore`)
        : api.delete(`/staff-roles/built-in/${r}`),
    onSuccess: (_d, { role: r, restore }) => {
      qc.invalidateQueries({ queryKey: ['staff-roles-disabled'] });
      toast.success(`${ROLE_LABELS[r] || r} ${restore ? 'restored' : 'deleted'}`);
      setDeleteBuiltInRole(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error updating role'),
  });

  const openAddRole = () => {
    setEditRoleId(null);
    setRoleForm({ ...EMPTY_ROLE_FORM });
    setModal('role');
  };

  const openEditRole = (r) => {
    setEditRoleId(r.id);
    setRoleForm({
      name: r.name || '',
      description: r.description || '',
      base_role: r.base_role || '',
      pages: Array.isArray(r.pages) ? r.pages : [],
    });
    setModal('role');
  };

  const handleSaveRole = () => {
    if (roleForm.name.trim().length < 2) {
      toast.error('Give the role a name');
      return;
    }
    if (!roleForm.base_role) {
      toast.error('Pick what this role works like');
      return;
    }
    if (!roleForm.pages.length) {
      toast.error('Pick at least one page');
      return;
    }
    saveRoleMutation.mutate({
      name: roleForm.name.trim(),
      description: roleForm.description.trim(),
      base_role: roleForm.base_role,
      pages: roleForm.pages,
    });
  };

  const { data: ownerStats = [] } = useQuery({
    queryKey: ['users-owners'],
    queryFn: () => api.get('/users/owners').then((r) => r.data),
    enabled: isOwnersTab,
  });

  const { data: viewOwnerUnits = [], isLoading: viewUnitsLoading } = useQuery({
    queryKey: ['owner-units', viewOwnerId],
    queryFn: () => api.get(`/users/owners/${viewOwnerId}/units`).then((r) => r.data),
    enabled: Boolean(viewOwnerId),
  });

  const unitCountById = Object.fromEntries(
    (Array.isArray(ownerStats) ? ownerStats : []).map((o) => [o.id, o.unit_count])
  );
  const unitNumbersById = Object.fromEntries(
    (Array.isArray(ownerStats) ? ownerStats : []).map((o) => [o.id, o.unit_numbers || ''])
  );
  const viewOwner = users.find((u) => Number(u.id) === Number(viewOwnerId)) || null;

  const scopedUsers = users.filter((u) =>
    isOwnersTab ? u.role === 'owner' : u.role !== 'owner'
  );

  const filtered = scopedUsers.filter(
    (u) =>
      (!search ||
        u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        u.email?.toLowerCase().includes(search.toLowerCase()) ||
        u.staff_code?.toLowerCase().includes(search.toLowerCase()) ||
        u.username?.toLowerCase().includes(search.toLowerCase())) &&
      (!filterRole ||
        (filterRole.startsWith(CUSTOM_PREFIX)
          ? `${CUSTOM_PREFIX}${u.custom_role_id}` === filterRole
          : u.role === filterRole && !u.custom_role_id))
  );

  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(
    filtered,
    'full_name',
    'asc'
  );

  const exportOwnersExcel = () => {
    const rows = sorted.map((u) => ({
      Name: u.full_name || '',
      Phone: u.username || '',
      Email: u.email?.includes('@cairohomes.owners.local') ? '' : u.email || '',
      'Units count': unitCountById[u.id] != null ? unitCountById[u.id] : 0,
      Units: unitNumbersById[u.id] || '',
      Status: u.is_active ? 'Active' : 'Inactive',
      Created: u.created_at ? String(u.created_at).split('T')[0] : '',
    }));
    if (!rows.length) {
      toast.error('No owners to export');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Owners');
    XLSX.writeFile(wb, `owners_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success(`Exported ${rows.length} owner${rows.length === 1 ? '' : 's'}`);
  };

  const saveStaffMutation = useMutation({
    mutationFn: (d) => (editId ? api.put(`/users/${editId}`, d) : api.post('/users', d)),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      if (!editId && res?.data) {
        setCreatedInfo(res.data);
        setModal('created');
        toast.success('Staff account created');
      } else {
        toast.success(editId ? 'User updated' : 'User created');
        setModal(null);
      }
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving'),
  });

  const saveOwnerMutation = useMutation({
    mutationFn: async (d) => {
      const { unit_ids, ...profile } = d;
      if (editId) {
        const res = await api.put(`/users/${editId}`, profile);
        if (Array.isArray(unit_ids)) {
          await api.put(`/users/owners/${editId}/units`, { unit_ids });
        }
        return res;
      }
      return api.post('/users', { ...profile, unit_ids });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['users-owners'] });
      qc.invalidateQueries({ queryKey: ['owner-linkable-units'] });
      qc.invalidateQueries({ queryKey: ['owner-units'] });
      if (!editId && res?.data) {
        setCreatedInfo(res.data);
        setModal('created');
        if (res.data.unitLinkError) {
          toast.error(`Owner created, but units not linked: ${res.data.unitLinkError}`);
        } else {
          toast.success(
            res.data.unit_count
              ? `Owner created with ${res.data.unit_count} unit(s)`
              : 'Owner account created'
          );
        }
      } else {
        toast.success(editId ? 'Owner updated' : 'Owner created');
        setModal(null);
      }
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving'),
  });

  const linkUnitsMutation = useMutation({
    mutationFn: ({ ownerId, unit_ids }) =>
      api.put(`/users/owners/${ownerId}/units`, { unit_ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users-owners'] });
      qc.invalidateQueries({ queryKey: ['owner-linkable-units'] });
      qc.invalidateQueries({ queryKey: ['owner-units'] });
      toast.success('Unit links updated');
      setModal(null);
      setEditId(null);
      setOwnerForm({ ...EMPTY_OWNER_FORM });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error updating unit links'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['users-owners'] });
      toast.success(isOwnersTab ? 'Owner deleted' : 'User deleted');
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const resetPwMutation = useMutation({
    mutationFn: (id) => api.put(`/users/${id}/reset-password`, {}),
    onSuccess: (res) => {
      const temp = res.data?.temporaryPassword;
      toast.success(temp ? `Password reset to ${temp}` : 'Password reset — share the temporary password shown once');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const approveSalaryMutation = useMutation({
    mutationFn: (id) => api.post(`/users/${id}/approve-salary`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Salary change approved');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const rejectSalaryMutation = useMutation({
    mutationFn: (id) => api.post(`/users/${id}/reject-salary`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Salary change rejected');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const openAdd = () => {
    if (isRolesTab) {
      openAddRole();
      return;
    }
    setEditId(null);
    if (isOwnersTab) {
      setOwnerForm({ ...EMPTY_OWNER_FORM });
      setModal('add-owner');
    } else {
      setStaffForm({ ...EMPTY_STAFF_FORM, role: staffRoleOptions[0] || 'reservations_manual' });
      setModal('add-staff');
    }
  };

  const openEdit = async (u) => {
    setEditId(u.id);
    if (u.role === 'owner') {
      let unit_ids = [];
      try {
        const { data } = await api.get(`/users/owners/${u.id}/units`);
        unit_ids = (Array.isArray(data) ? data : []).map((x) => String(x.id));
      } catch {
        toast.error('Could not load linked units — try again');
        return;
      }
      setOwnerForm({
        full_name: u.full_name || '',
        phone: u.username || '',
        email: u.email?.includes('@cairohomes.owners.local') ? '' : u.email || '',
        is_active: u.is_active,
        unit_ids,
      });
      setModal('edit-owner');
    } else {
      setStaffForm({
        full_name: u.full_name || '',
        email: u.email || '',
        role: u.role,
        custom_role_id: u.custom_role_id ? String(u.custom_role_id) : '',
        base_salary: u.base_salary ?? '',
        is_active: u.is_active,
        sales_commission_pct:
          u.sales_commission_pct != null && u.sales_commission_pct !== ''
            ? String(u.sales_commission_pct)
            : '',
        leave_casual_days: String(u.leave_casual_days ?? 0),
        leave_annual_days: String(u.leave_annual_days ?? 0),
        leave_unpaid_days: String(u.leave_unpaid_days ?? 0),
        staff_code: u.staff_code || '',
        manager_id: u.manager_id ? String(u.manager_id) : '',
        manager_ids: (Array.isArray(u.manager_ids) && u.manager_ids.length
          ? u.manager_ids
          : u.manager_id
            ? [u.manager_id]
            : []
        ).map(String),
      });
      setModal('edit-staff');
    }
  };

  const openLinkUnits = async (u) => {
    setEditId(u.id);
    let unit_ids = [];
    try {
      const { data } = await api.get(`/users/owners/${u.id}/units`);
      unit_ids = (Array.isArray(data) ? data : []).map((x) => String(x.id));
    } catch {
      toast.error('Could not load linked units — try again');
      return;
    }
    setOwnerForm({
      full_name: u.full_name || '',
      phone: u.username || '',
      email: '',
      is_active: u.is_active,
      unit_ids,
    });
    setModal('link-units');
  };

  const handleSaveStaff = () => {
    if (!staffForm.full_name?.trim() || !staffForm.email?.trim() || staffForm.base_salary === '') {
      toast.error('Name, email, and base salary are required');
      return;
    }
    if (!String(staffForm.staff_code || '').trim()) {
      toast.error('Staff ID is required');
      return;
    }
    if (usesCommissionPct(staffForm.role)) {
      if (staffForm.sales_commission_pct === '' || staffForm.sales_commission_pct == null) {
        toast.error('Commission % is required for this role');
        return;
      }
      const pct = Number(staffForm.sales_commission_pct);
      if (Number.isNaN(pct) || pct < 0 || pct > 100) {
        toast.error('Commission % must be between 0 and 100');
        return;
      }
    }
    saveStaffMutation.mutate({
      ...staffForm,
      custom_role_id: staffForm.custom_role_id ? Number(staffForm.custom_role_id) : null,
      base_salary: Number(staffForm.base_salary),
      leave_casual_days: Number(staffForm.leave_casual_days) || 0,
      leave_annual_days: Number(staffForm.leave_annual_days) || 0,
      staff_code: String(staffForm.staff_code || '').trim(),
      manager_id: isWebDeveloperRole(staffForm.role)
        ? null
        : staffForm.manager_id
          ? Number(staffForm.manager_id)
          : null,
      manager_ids: isWebDeveloperRole(staffForm.role)
        ? (staffForm.manager_ids || []).map(Number).filter(Boolean)
        : undefined,
      sales_commission_pct: usesCommissionPct(staffForm.role)
        ? Number(staffForm.sales_commission_pct)
        : Number(staffForm.sales_commission_pct) || 0,
    });
  };

  const handleSaveOwner = () => {
    if (!ownerForm.full_name?.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!editId && !ownerForm.phone?.trim()) {
      toast.error('Phone is required for new owners');
      return;
    }
    if (editId) {
      saveOwnerMutation.mutate({
        full_name: ownerForm.full_name.trim(),
        email: ownerForm.email?.trim() || undefined,
        is_active: ownerForm.is_active,
        role: 'owner',
        base_salary: 0,
        ...(canLinkUnits ? { unit_ids: ownerForm.unit_ids || [] } : {}),
      });
    } else {
      saveOwnerMutation.mutate({
        full_name: ownerForm.full_name.trim(),
        phone: ownerForm.phone.trim(),
        username: ownerForm.phone.trim(),
        email: ownerForm.email?.trim() || '',
        role: 'owner',
        base_salary: 0,
        unit_ids: canLinkUnits ? ownerForm.unit_ids || [] : [],
      });
    }
  };

  const handleSaveLinkUnits = () => {
    if (!editId) return;
    linkUnitsMutation.mutate({
      ownerId: editId,
      unit_ids: ownerForm.unit_ids || [],
    });
  };

  const filterRoleOptions = (isAdmin ? ADMIN_STAFF_FILTER_ROLES : HR_STAFF_FILTER_ROLES).filter(
    (r) => !disabledRoleSet.has(r)
  );

  const showAddButton = isOwnersTab
    ? canCreateOwners
    : isRolesTab
      ? canManageRoles
      : staffRoleOptions.length > 0;
  const addLabel = isOwnersTab ? 'Add Owner' : isRolesTab ? 'Add Role' : 'Add User';
  const saving =
    saveStaffMutation.isPending ||
    saveOwnerMutation.isPending ||
    linkUnitsMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="page-header mb-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ch-muted">
            {isUnitAcquisition && !isAdmin ? 'Unit acquisition' : 'HR'}
          </p>
          <h1 className="page-title mt-1">
            {isUnitAcquisition && !isAdmin ? 'Owners' : 'User Management'}
          </h1>
          <p className="page-subtitle">
            {isRolesTab ? (
              <>Create roles with their own name and pages, then assign them to staff</>
            ) : (
              <>
                {isOwnersTab
                  ? 'Owner portal accounts and unit linking'
                  : isAdmin
                    ? 'Admin & HR staff accounts'
                    : 'Create staff accounts'}
                {' · '}
                {filtered.length} {isOwnersTab ? 'owner' : 'user'}
                {filtered.length !== 1 ? 's' : ''}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isOwnersTab && filtered.length > 0 && (
            <button type="button" onClick={exportOwnersExcel} className="btn-secondary">
              <Download className="w-4 h-4" /> Export Excel
            </button>
          )}
          {showAddButton && (
            <button onClick={openAdd} className="btn-primary">
              <Plus className="w-4 h-4" /> {addLabel}
            </button>
          )}
        </div>
      </div>

      {visibleTabs.length > 1 ? (
      <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          const count =
            tab.id === 'roles'
              ? customRoles.length
              : users.filter((u) =>
                  tab.id === 'owners' ? u.role === 'owner' : u.role !== 'owner'
                ).length;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-white text-ch-pine shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              <span
                className={`text-[11px] tabular-nums px-1.5 py-0.5 rounded-md ${
                  active ? 'bg-ch-pine/10 text-ch-pine' : 'bg-gray-200/80 text-gray-500'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
      ) : null}

      {isRolesTab ? (
        rolesLoading ? (
          <LoadingSpinner />
        ) : (
          <StaffRolesPanel
            roles={customRoles}
            users={users}
            canManage={canManageRoles}
            onAdd={openAddRole}
            onEdit={openEditRole}
            onDelete={setDeleteRole}
            disabledRoles={disabledRoles}
            canManageBuiltIn={isAdmin}
            onDeleteBuiltIn={setDeleteBuiltInRole}
            onRestoreBuiltIn={(r) => builtInRoleMutation.mutate({ role: r, restore: true })}
            restoringRole={
              builtInRoleMutation.isPending && builtInRoleMutation.variables?.restore
                ? builtInRoleMutation.variables.role
                : null
            }
          />
        )
      ) : (
      <>
      <SearchFilter
        value={search}
        onChange={setSearch}
        placeholder={
          isOwnersTab
            ? 'Search name, phone, email...'
            : 'Search name, email, staff ID...'
        }
      >
        {!isOwnersTab && (
          <SearchableSelect
            className="w-52"
            value={filterRole}
            onChange={setFilterRole}
            placeholder="All Roles"
            options={[
              { value: '', label: 'All Roles' },
              ...customRoles.map((r) => ({
                value: `${CUSTOM_PREFIX}${r.id}`,
                label: `${r.name} · custom`,
              })),
              ...filterRoleOptions.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
            ]}
          />
        )}
      </SearchFilter>

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={isOwnersTab ? UserCircle : UsersIcon}
          title={isOwnersTab ? 'No owners found' : 'No users found'}
          action={
            showAddButton ? (
              <button onClick={openAdd} className="btn-primary">
                <Plus className="w-4 h-4" /> {addLabel}
              </button>
            ) : null
          }
        />
      ) : isOwnersTab ? (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-sm">
              <thead>
                <tr>
                  <SortTh col="full_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Owner
                  </SortTh>
                  <SortTh col="username" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Phone
                  </SortTh>
                  <SortTh col="email" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Email
                  </SortTh>
                  <th>Units</th>
                  <SortTh col="is_active" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Status
                  </SortTh>
                  <SortTh col="created_at" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Created
                  </SortTh>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={avatarStyle('owner')}
                        >
                          {u.full_name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium">{u.full_name}</div>
                          {u.is_first_login ? (
                            <div className="text-[10px] text-amber-600 font-medium">
                              Must change password
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs font-semibold">{u.username || '—'}</td>
                    <td className="text-xs text-gray-500">
                      {u.email?.includes('@cairohomes.owners.local') ? '—' : u.email || '—'}
                    </td>
                    <td className="tabular-nums">
                      {unitCountById[u.id] != null ? unitCountById[u.id] : '—'}
                    </td>
                    <td>
                      {u.is_active ? (
                        <span className="flex items-center gap-1 text-green-600 text-xs">
                          <CheckCircle className="w-3.5 h-3.5" /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-500 text-xs">
                          <XCircle className="w-3.5 h-3.5" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="text-xs text-gray-400">{formatDate(u.created_at)}</td>
                    <td>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setViewOwnerId(u.id)}
                          className="p-1.5 rounded text-gray-400 hover:text-ch-pine hover:bg-primary-50"
                          title="View"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openEdit(u)}
                          className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {canLinkUnits && (
                          <button
                            onClick={() => openLinkUnits(u)}
                            className="p-1.5 rounded text-gray-400 hover:text-emerald-600 hover:bg-emerald-50"
                            title="Link units"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => resetPwMutation.mutate(u.id)}
                          className="p-1.5 rounded text-gray-400 hover:text-yellow-600 hover:bg-yellow-50"
                          title="Reset to temporary password"
                        >
                          <Key className="w-3.5 h-3.5" />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => setDeleteId(u.id)}
                            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-sm">
              <thead>
                <tr>
                  <SortTh col="full_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    User
                  </SortTh>
                  <SortTh col="staff_code" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Staff ID
                  </SortTh>
                  <SortTh col="role" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Role
                  </SortTh>
                  <SortTh col="base_salary" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Base Salary
                  </SortTh>
                  <SortTh
                    col="sales_commission_pct"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  >
                    Commission %
                  </SortTh>
                  <SortTh col="is_active" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Status
                  </SortTh>
                  <SortTh col="created_at" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Created
                  </SortTh>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={avatarStyle(u.role)}
                        >
                          {u.full_name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium">{u.full_name}</div>
                          {u.email && <div className="text-xs text-gray-400">{u.email}</div>}
                          {u.is_first_login ? (
                            <div className="text-[10px] text-amber-600 font-medium">
                              Must change password
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs font-semibold">{u.staff_code || '—'}</td>
                    <td>
                      <span className={`badge ${ROLE_COLORS[u.role] || 'badge-gray'}`}>
                        {roleLabel(u)}
                      </span>
                      {u.custom_role_id ? (
                        <div className="mt-1 text-[10px] text-ch-muted">
                          Works like {ROLE_LABELS[u.role] || u.role}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <div>{currency(u.base_salary || 0)}</div>
                      <div className="mt-0.5 text-[11px] text-ch-muted">
                        Casual {u.leave_casual_days ?? 0} · Annual {u.leave_annual_days ?? 0} · Unpaid Unlimited
                      </div>
                      {u.salary_change_status === 'pending' && (
                        <div className="mt-1 text-[11px] text-amber-700">
                          Pending: {currency(u.pending_base_salary)}
                          {isAdmin && (
                            <div className="flex gap-1 mt-1">
                              <button
                                type="button"
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800"
                                onClick={() => approveSalaryMutation.mutate(u.id)}
                              >
                                <Check className="w-3 h-3" /> Approve
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-100 text-rose-800"
                                onClick={() => rejectSalaryMutation.mutate(u.id)}
                              >
                                <X className="w-3 h-3" /> Reject
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="tabular-nums">
                      {usesCommissionPct(u.role)
                        ? `${Number(u.sales_commission_pct || 0)}%`
                        : '—'}
                    </td>
                    <td>
                      {u.is_active ? (
                        <span className="flex items-center gap-1 text-green-600 text-xs">
                          <CheckCircle className="w-3.5 h-3.5" /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-500 text-xs">
                          <XCircle className="w-3.5 h-3.5" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="text-xs text-gray-400">{formatDate(u.created_at)}</td>
                    <td>
                      <div className="flex gap-1">
                        <button
                          onClick={() => openEdit(u)}
                          className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => resetPwMutation.mutate(u.id)}
                          className="p-1.5 rounded text-gray-400 hover:text-yellow-600 hover:bg-yellow-50"
                          title="Reset to temporary password"
                        >
                          <Key className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteId(u.id)}
                          className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>
      )}

      <Modal
        open={!!viewOwnerId}
        onClose={() => setViewOwnerId(null)}
        title={viewOwner?.full_name ? viewOwner.full_name : 'Owner details'}
        size="lg"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setViewOwnerId(null)}>
              Close
            </button>
            {viewOwner && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const owner = viewOwner;
                  setViewOwnerId(null);
                  openEdit(owner);
                }}
              >
                Edit
              </button>
            )}
            {viewOwner && canLinkUnits && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  const owner = viewOwner;
                  setViewOwnerId(null);
                  openLinkUnits(owner);
                }}
              >
                Link units
              </button>
            )}
          </>
        }
      >
        <OwnerDetailsView owner={viewOwner} units={viewOwnerUnits} loading={viewUnitsLoading} />
      </Modal>

      <Modal
        open={modal === 'add-staff' || modal === 'edit-staff'}
        onClose={() => setModal(null)}
        title={modal === 'edit-staff' ? 'Edit User' : 'New Staff User'}
        size="lg"
        footer={
          <>
            <button onClick={() => setModal(null)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={handleSaveStaff} disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : modal === 'edit-staff' ? 'Save Changes' : 'Create User'}
            </button>
          </>
        }
      >
        <StaffForm
          form={staffForm}
          setForm={setStaffForm}
          isEdit={modal === 'edit-staff'}
          roleOptions={formRoleOptions}
          customRoles={customRoles}
          lockPayAndLeave={
            modal === 'edit-staff' && !canEditStaffCompensation(user, editId)
          }
          applySalaryImmediately={isAdmin || isHr || isHrSupervisor}
          managerOptions={users.filter((u) => {
            if (editId && String(u.id) === String(editId)) return false;
            if (isLineManagerRole(u.role)) return true;
            if (isWebDeveloperRole(staffForm.role)) {
              return (staffForm.manager_ids || []).some((id) => String(id) === String(u.id));
            }
            return staffForm.manager_id && String(u.id) === String(staffForm.manager_id);
          })}
        />
      </Modal>

      <Modal
        open={modal === 'add-owner' || modal === 'edit-owner'}
        onClose={() => setModal(null)}
        title={modal === 'edit-owner' ? 'Edit Owner' : 'New Owner'}
        size="lg"
        footer={
          <>
            <button onClick={() => setModal(null)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={handleSaveOwner} disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : modal === 'edit-owner' ? 'Save Changes' : 'Create Owner'}
            </button>
          </>
        }
      >
        <OwnerForm
          form={ownerForm}
          setForm={setOwnerForm}
          isEdit={modal === 'edit-owner'}
          ownerId={modal === 'edit-owner' ? editId : null}
          showUnits={canLinkUnits}
        />
      </Modal>

      <Modal
        open={modal === 'link-units'}
        onClose={() => setModal(null)}
        title={`Link units — ${ownerForm.full_name || 'Owner'}`}
        size="lg"
        footer={
          <>
            <button onClick={() => setModal(null)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={handleSaveLinkUnits} disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : 'Save links'}
            </button>
          </>
        }
      >
        <OwnerUnitPicker
          selectedIds={ownerForm.unit_ids || []}
          onChange={(unit_ids) => setOwnerForm((f) => ({ ...f, unit_ids }))}
          ownerId={editId}
          enabled={modal === 'link-units'}
        />
      </Modal>

      <Modal
        open={modal === 'created'}
        onClose={() => {
          setModal(null);
          setCreatedInfo(null);
        }}
        title={createdInfo?.role === 'owner' ? 'Owner account created' : 'Staff account created'}
        size="sm"
        footer={
          <>
            {createdInfo?.role === 'owner' && canLinkUnits && (
              <button
                onClick={() => {
                  const id = createdInfo.id;
                  const name = createdInfo.full_name;
                  setCreatedInfo(null);
                  openLinkUnits({
                    id,
                    full_name: name,
                    username: createdInfo.username,
                    is_active: createdInfo.is_active ?? 1,
                  });
                }}
                className="btn-secondary"
              >
                Link units
              </button>
            )}
            <button
              onClick={() => {
                setModal(null);
                setCreatedInfo(null);
              }}
              className="btn-primary"
            >
              Done
            </button>
          </>
        }
      >
        {createdInfo && (
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-slate-500">Name:</span> {createdInfo.full_name}
            </p>
            {createdInfo.role === 'owner' ? (
              <p>
                <span className="text-slate-500">Phone / username:</span>{' '}
                <span className="font-mono font-semibold">{createdInfo.username}</span>
              </p>
            ) : (
              <p>
                <span className="text-slate-500">Staff ID:</span>{' '}
                <span className="font-mono font-semibold">
                  {createdInfo.staff_code || createdInfo.staffId}
                </span>
              </p>
            )}
            <p>
              <span className="text-slate-500">Email:</span> {createdInfo.email}
            </p>
            <p>
              <span className="text-slate-500">Temporary password:</span>{' '}
              <span className="font-mono font-semibold">
                {createdInfo.temporaryPassword || '— (check create response)'}
              </span>
            </p>
            {createdInfo.role === 'owner' && (
              <p className="text-xs text-slate-500">
                Units linked: {createdInfo.unit_count ?? 0}
                {createdInfo.unitLinkError
                  ? ` — ${createdInfo.unitLinkError}`
                  : createdInfo.unit_count
                    ? ''
                    : ' — use Link units to assign portal access'}
              </p>
            )}
            <p className="text-xs text-amber-700 mt-2">
              Share these credentials securely. The user must change the password on first login.
            </p>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
        title={isOwnersTab ? 'Delete Owner' : 'Delete User'}
        message="This permanently deletes the account from the system. This cannot be undone."
        confirmText="Delete"
        danger
      />

      <Modal
        open={modal === 'role'}
        onClose={() => setModal(null)}
        title={editRoleId ? 'Edit Role' : 'New Role'}
        size="lg"
        footer={
          <>
            <button onClick={() => setModal(null)} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={handleSaveRole}
              disabled={saveRoleMutation.isPending}
              className="btn-primary"
            >
              {saveRoleMutation.isPending ? 'Saving...' : editRoleId ? 'Save Role' : 'Create Role'}
            </button>
          </>
        }
      >
        <RoleForm form={roleForm} setForm={setRoleForm} baseRoleOptions={roleBaseOptions} />
      </Modal>

      <ConfirmDialog
        open={!!deleteRole}
        onClose={() => setDeleteRole(null)}
        onConfirm={() => deleteRoleMutation.mutate(deleteRole.id)}
        loading={deleteRoleMutation.isPending}
        title="Delete Role"
        message={
          deleteRole?.user_count
            ? `${deleteRole.user_count} staff member${deleteRole.user_count === 1 ? '' : 's'} on “${deleteRole.name}” will go back to ${ROLE_LABELS[deleteRole.base_role] || deleteRole.base_role}.`
            : `Delete the role “${deleteRole?.name || ''}”?`
        }
        confirmText="Delete"
        danger
      />

      <ConfirmDialog
        open={!!deleteBuiltInRole}
        onClose={() => setDeleteBuiltInRole(null)}
        onConfirm={() => builtInRoleMutation.mutate({ role: deleteBuiltInRole })}
        loading={builtInRoleMutation.isPending}
        title="Delete Role"
        message={`Delete the ${ROLE_LABELS[deleteBuiltInRole] || deleteBuiltInRole || ''} role? It will no longer appear when adding or editing staff. You can restore it later from this tab.`}
        confirmText="Delete"
        danger
      />
    </div>
  );
}
