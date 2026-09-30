import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList,
  CalendarDays,
  Landmark,
  Scale,
  Wallet,
  Banknote,
  Coins,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Download,
  CheckCircle2,
  PenLine,
  Plus,
  Trash2,
  BookOpen,
  PiggyBank,
  Shield,
  TrendingUp,
  Receipt,
  CircleDollarSign,
  CreditCard,
  Home,
  Zap,
  UtensilsCrossed,
  Users,
  AlertCircle,
  Settings2,
  FileSpreadsheet,
  Lock,
  Unlock,
  Building2,
  Globe,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import SearchableSelect from '../components/ui/SearchableSelect';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Modal from '../components/ui/Modal';
import { currency, formatDate, formatDateTime } from '../utils/formatters';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';
import { ACCOUNT_GROUPS, CHART_OF_ACCOUNTS, getAccount } from '../../lib/finance/chartOfAccounts';
import { VAT_OUTPUT_PCT, WHT_STANDARD_PCT, WHT_REDUCED_PCT } from '../../lib/finance/taxEngine';
import { PettyCashSection } from './PettyCash';
import { FinLocaleProvider, useFinLocale } from '../context/FinLocaleContext';

const GROUP_META = {
  assets: {
    label: ACCOUNT_GROUPS.assets,
    icon: Landmark,
    tint: 'bg-sky-50 text-sky-800',
    tile: 'bg-sky-600',
    hint: 'What Cairo Homes holds',
  },
  liabilities: {
    label: ACCOUNT_GROUPS.liabilities,
    icon: Shield,
    tint: 'bg-amber-50 text-amber-900',
    tile: 'bg-amber-500',
    hint: 'What Cairo Homes owes',
  },
  equity: {
    label: ACCOUNT_GROUPS.equity,
    icon: PiggyBank,
    tint: 'bg-slate-100 text-slate-800',
    tile: 'bg-slate-700',
    hint: 'Capital and earnings',
  },
  revenue: {
    label: ACCOUNT_GROUPS.revenue,
    icon: TrendingUp,
    tint: 'bg-emerald-50 text-emerald-900',
    tile: 'bg-emerald-600',
    hint: 'Reservation totals plus custom revenue',
  },
  expenses: {
    label: ACCOUNT_GROUPS.expenses,
    icon: Receipt,
    tint: 'bg-orange-50 text-orange-900',
    tile: 'bg-orange-500',
    hint: 'Direct costs and company running costs',
  },
};

const MANUAL_ACCOUNT_OPTIONS = CHART_OF_ACCOUNTS.filter((a) => !a.virtual).map((a) => ({
  value: a.code,
  label: `${a.code} — ${a.name}`,
  group: ACCOUNT_GROUPS[a.group] || a.group,
}));

const ACCOUNT_ICONS = {
  '101000': Landmark,
  '102000': Landmark,
  '103000': Banknote,
  '104000': Banknote,
  '105000': CircleDollarSign,
  '106000': CreditCard,
  '107000': Scale,
  '202000': Users,
  '205000': Scale,
  '400000': TrendingUp,
  '401000': TrendingUp,
  '506000': Users,
  '508000': UtensilsCrossed,
  '604000': Home,
  '608000': Zap,
  '609000': Users,
};

function IconFor({ code, group, className = 'w-5 h-5' }) {
  const Comp = ACCOUNT_ICONS[code] || GROUP_META[group]?.icon || BookOpen;
  return <Comp className={className} />;
}

function cairoYearMonth() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }).slice(0, 7);
}

function clampYearMonth(ym) {
  const epochYm = FINANCIAL_EPOCH.slice(0, 7);
  const raw = String(ym || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(raw)) return clampYearMonth(cairoYearMonth());
  return raw < epochYm ? epochYm : raw;
}

function monthBounds(ym) {
  const safe = clampYearMonth(ym);
  const [y, m] = safe.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

function clampDate(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return FINANCIAL_EPOCH;
  return raw < FINANCIAL_EPOCH ? FINANCIAL_EPOCH : raw;
}

function presetRange(id) {
  const ym = cairoYearMonth();
  const [y, m] = ym.split('-').map(Number);
  if (id === 'last_month') {
    return monthBounds(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`);
  }
  if (id === 'this_year') return { from: clampDate(`${y}-01-01`), to: `${y}-12-31` };
  return monthBounds(ym);
}

function DateFilters({ fromDate, toDate, basis, onChange }) {
  const { t } = useFinLocale();
  const presets = [
    ['this_month', t('pms.fin.presetThisMonth')],
    ['last_month', t('pms.fin.presetLastMonth')],
    ['this_year', t('pms.fin.presetThisYear')],
  ];

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('pms.fin.countBy')}</label>
        <select
          className="input w-36 text-sm py-1.5"
          value={basis}
          onChange={(e) => onChange({ basis: e.target.value })}
        >
          <option value="stay">{t('pms.fin.basisStay')}</option>
          <option value="created">{t('pms.fin.basisCreated')}</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('pms.fin.dateFrom')}</label>
        <input
          type="date"
          className="input w-40 text-sm py-1.5"
          min={FINANCIAL_EPOCH}
          value={fromDate}
          onChange={(e) => onChange({ from: clampDate(e.target.value) })}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('pms.fin.dateTo')}</label>
        <input
          type="date"
          className="input w-40 text-sm py-1.5"
          min={fromDate || FINANCIAL_EPOCH}
          value={toDate}
          onChange={(e) => onChange({ to: e.target.value || '' })}
        />
      </div>
      <div className="flex gap-1">
        {presets.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="btn-secondary text-xs px-2.5 py-1.5"
            onClick={() => onChange(presetRange(id))}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ExportPeriodModal({ open, defaultFrom, defaultTo, onClose, onConfirm, exporting }) {
  const { t } = useFinLocale();
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-md space-y-4 p-5 shadow-xl">
        <div>
          <h2 className="text-lg font-semibold text-ch-pine">{t('pms.fin.exportPeriodTitle')}</h2>
          <p className="text-sm text-gray-500 mt-1">{t('pms.fin.exportPeriodHint')}</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="label text-xs">{t('pms.fin.dateFrom')}</label>
            <input
              type="date"
              className="input text-sm"
              min={FINANCIAL_EPOCH}
              value={fromDate}
              onChange={(e) => setFromDate(clampDate(e.target.value))}
            />
          </div>
          <div>
            <label className="label text-xs">{t('pms.fin.dateTo')}</label>
            <input
              type="date"
              className="input text-sm"
              min={fromDate || FINANCIAL_EPOCH}
              value={toDate}
              onChange={(e) => setToDate(e.target.value || fromDate)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary text-sm" onClick={onClose} disabled={exporting}>
            {t('pms.fin.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={exporting}
            onClick={() => {
              const from = clampDate(fromDate);
              const to = toDate && toDate >= from ? toDate : from;
              onConfirm(from, to);
            }}
          >
            {exporting ? t('pms.fin.exporting') : t('pms.fin.exportExcel')}
          </button>
        </div>
      </div>
    </div>
  );
}

function useFinanceNav() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') || 'home';
  const group = searchParams.get('group') || '';
  const code = searchParams.get('code') || '';
  const txn = searchParams.get('txn') || '';
  const tabAlias = {
    assets: 'assets',
    owners: 'owners',
    settlements: 'owners',
    statement: 'owners',
    tax: 'tax',
    manual: 'manual',
    expenses: 'manual',
    petty: 'petty',
    'petty-cash': 'petty',
    reports: 'reports',
    aging: 'aging',
    insurance: 'insurance',
    'checkin-audit': 'checkin-audit',
    checkins: 'checkin-audit',
    'check-in-audit': 'checkin-audit',
    'payment-calendar': 'payment-calendar',
    calendar: 'payment-calendar',
    'payments-calendar': 'payment-calendar',
    close: 'close',
    gateway: 'gateway',
    bank: 'bank',
    trust: 'trust',
    vendors: 'vendors',
    ar: 'ar',
  };
  const tool = searchParams.get('tool') || tabAlias[searchParams.get('tab')] || '';

  function go(next) {
    const nextParams = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([k, v]) => {
      if (v == null || v === '') nextParams.delete(k);
      else nextParams.set(k, String(v));
    });
    setSearchParams(nextParams, { replace: true });
  }

  return { view, group, code, txn, tool, go, searchParams, setSearchParams };
}

function rangeParams(fromDate, toDate, basis) {
  return { from_date: fromDate || undefined, to_date: toDate || undefined, basis: basis || undefined };
}

function HomeView({ data, basisLabel, onOpenGroup, onOpenAccount, onOpenTreasury, onOpenTool, onExport, exporting }) {
  const { t } = useFinLocale();
  const groups = data?.groups || [];
  const treasury = data?.treasury || [];
  const kpis = data?.kpis || {};
  const outstanding = data?.outstanding || { amount: 0, count: 0 };
  const receipts = data?.receipts || {};

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {data?.to_date
            ? t('pms.fin.home.periodRange', { from: data?.from_date, to: data.to_date, basis: basisLabel })
            : t('pms.fin.home.periodOpen', { from: data?.from_date, basis: basisLabel })}
        </p>
        <button type="button" className="btn-secondary text-sm" onClick={onExport} disabled={exporting}>
          <Download className="w-4 h-4" />
          {exporting ? t('pms.fin.exporting') : t('pms.fin.exportExcel')}
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          [t('pms.fin.home.collectedInTreasury'), kpis.collected, t('pms.fin.home.collectedHint')],
          [t('pms.fin.home.outstanding'), outstanding.amount, t('pms.fin.home.outstandingHint', { count: outstanding.count })],
          [t('pms.fin.home.grossRevenue'), kpis.gross_revenue ?? kpis.revenue, t('pms.fin.home.grossRevenueHint', { stays: currency(receipts.stays), custom: currency(receipts.custom) })],
          [t('pms.fin.home.ownerTrust'), kpis.owner_trust, t('pms.fin.home.ownerTrustHint')],
        ].map(([label, amount, sub]) => (
          <div key={label} className="rounded-2xl border border-ch-line bg-white px-4 py-4">
            <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
            <p className="text-xl font-bold tabular-nums text-ch-pine mt-1">{currency(amount)}</p>
            <p className="text-xs text-gray-500 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onOpenTool('reports')}
        className={`w-full rounded-2xl border p-5 text-left transition-colors ${
          (kpis.net_profit || 0) >= 0
            ? 'border-emerald-200 bg-emerald-50/70 hover:border-emerald-300'
            : 'border-rose-200 bg-rose-50/70 hover:border-rose-300'
        }`}
      >
        <div className="flex flex-wrap items-center gap-4">
          <div
            className={`w-12 h-12 rounded-2xl text-white flex items-center justify-center ${
              (kpis.net_profit || 0) >= 0 ? 'bg-emerald-600' : 'bg-rose-600'
            }`}
          >
            <TrendingUp className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-wider text-gray-500">{t('pms.fin.home.netProfit')}</p>
            <p className="font-semibold text-ch-pine">{t('pms.fin.home.netProfitFormula')}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {t('pms.fin.home.netProfitDetail', { revenue: currency(kpis.gross_revenue ?? kpis.revenue), ownerShare: currency(kpis.owner_share), cogs: currency(kpis.cogs), opex: currency(kpis.opex) })}
            </p>
          </div>
          <p
            className={`text-2xl font-bold tabular-nums ${(kpis.net_profit || 0) >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}
          >
            {currency(kpis.net_profit)}
          </p>
        </div>
      </button>

      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-ch-pine">{t('pms.fin.home.treasury')}</h2>
            <p className="text-xs text-gray-500">
              {t('pms.fin.home.treasuryHint')}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {treasury.map((t2) => {
            const Icon = t2.kind === 'cash' ? Banknote : Coins;
            return (
              <button
                key={t2.code}
                type="button"
                onClick={() => onOpenTreasury(t2.code)}
                className="rounded-2xl border border-ch-line bg-white p-5 text-left hover:border-ch-pine/40 hover:bg-ch-pine-50/40 transition-colors"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-white ${t2.kind === 'cash' ? 'bg-emerald-600' : 'bg-ch-pine'}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-[11px] font-mono text-gray-400">{t2.currency}</span>
                </div>
                <p className="text-xs uppercase tracking-wider text-gray-400">
                  {t2.kind === 'cash' ? t('pms.fin.home.cash') : t('pms.fin.home.bank')} · {t2.currency}
                </p>
                <p className="font-semibold text-ch-pine mt-1 leading-snug">{t2.name.replace(/^Bank - |^Cash - /, '')}</p>
                <p className="text-2xl font-bold tabular-nums mt-3">{currency(t2.balance, t2.currency)}</p>
                <p className="text-xs text-gray-500 mt-2">
                  {t('pms.fin.home.inOut', { inflow: currency(t2.inflow, t2.currency), outflow: currency(t2.outflow, t2.currency) })}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-ch-pine mb-1">{t('pms.fin.home.chartOfAccounts')}</h2>
        <p className="text-xs text-gray-500 mb-3">{t('pms.fin.home.chartHint')}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {groups.map((g) => {
            const meta = GROUP_META[g.id] || GROUP_META.assets;
            const Icon = meta.icon;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onOpenGroup(g.id)}
                className="rounded-2xl border border-ch-line bg-white p-5 text-left hover:border-ch-pine/40 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-2xl ${meta.tile} text-white flex items-center justify-center flex-shrink-0`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-ch-pine">{meta.label}</p>
                      <ChevronRight className="w-4 h-4 text-gray-300" />
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{t(`pms.fin.groupMeta.${g.id}Hint`) || meta.hint}</p>
                    <p className="text-xl font-bold tabular-nums mt-3">{currency(g.balance)}</p>
                    <p className="text-xs text-gray-400 mt-1">{t('pms.fin.subAccounts', { count: g.account_count })}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <button
        type="button"
        onClick={() => onOpenTool('aging')}
        className="w-full rounded-2xl border border-amber-200 bg-amber-50/70 p-5 text-left hover:border-amber-300"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-500 text-white flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-amber-800">{t('pms.fin.home.arTitle')}</p>
            <p className="font-semibold text-ch-pine">{t('pms.fin.home.arSubtitle')}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {t('pms.fin.home.arHint', { count: outstanding.count })}
            </p>
          </div>
          <p className="text-2xl font-bold tabular-nums text-amber-900">{currency(outstanding.amount)}</p>
        </div>
      </button>

      <button
        type="button"
        onClick={() => onOpenTool('payment-calendar')}
        className="w-full rounded-2xl border border-violet-200 bg-violet-50/70 p-5 text-left hover:border-violet-300"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-violet-600 text-white flex items-center justify-center">
            <CalendarDays className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-violet-800">{t('pms.fin.home.paymentCalendarTitle')}</p>
            <p className="font-semibold text-ch-pine">{t('pms.fin.home.paymentCalendarSubtitle')}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {t('pms.fin.home.paymentCalendarHint')}
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-violet-400" />
        </div>
      </button>

      <button
        type="button"
        onClick={() => onOpenTool('checkin-audit')}
        className="w-full rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 text-left hover:border-emerald-300"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center">
            <ClipboardList className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-emerald-800">{t('pms.fin.home.checkinAuditTitle')}</p>
            <p className="font-semibold text-ch-pine">{t('pms.fin.home.checkinAuditSubtitle')}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {t('pms.fin.home.checkinAuditHint')}
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-emerald-400" />
        </div>
      </button>

      <button
        type="button"
        onClick={() => onOpenTool('insurance')}
        className="w-full rounded-2xl border border-sky-200 bg-sky-50/70 p-5 text-left hover:border-sky-300"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-sky-600 text-white flex items-center justify-center">
            <Shield className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="text-xs uppercase tracking-wider text-sky-800">{t('pms.fin.home.insuranceTitle')}</p>
            <p className="font-semibold text-ch-pine">{t('pms.fin.home.insuranceSubtitle')}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {t('pms.fin.home.insuranceHint')}
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-sky-400" />
        </div>
      </button>

      <section>
        <h2 className="text-lg font-semibold text-ch-pine mb-3">{t('pms.fin.home.workspace')}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { id: 'assets', labelKey: 'fixedAssets', icon: Landmark },
            { id: 'owners', labelKey: 'ownerPayouts', icon: Users },
            { id: 'insurance', labelKey: 'insurancePayout', icon: Shield },
            { id: 'checkin-audit', labelKey: 'checkinAudit', icon: ClipboardList },
            { id: 'payment-calendar', labelKey: 'paymentCalendar', icon: CalendarDays },
            { id: 'trust', labelKey: 'ownerTrust', icon: Building2 },
            { id: 'reports', labelKey: 'monthEndReports', icon: FileSpreadsheet },
            { id: 'cashflow', labelKey: 'cashFlow', icon: Banknote },
            { id: 'aging', labelKey: 'arAging', icon: AlertCircle },
            { id: 'close', labelKey: 'closeMonth', icon: Lock },
            { id: 'gateway', labelKey: 'gatewaySettle', icon: CreditCard },
            { id: 'bank', labelKey: 'bankRec', icon: Landmark },
            { id: 'manual', labelKey: 'manualEntries', icon: PenLine },
            { id: 'petty', labelKey: 'pettyCash', icon: Wallet },
            { id: 'tax', labelKey: 'taxDesk', icon: Scale },
            { id: 'segment', labelKey: 'segmentPnl', icon: FileSpreadsheet },
            { id: 'forecast', labelKey: 'cashForecast', icon: TrendingUp },
            { id: 'vendors', labelKey: 'apVendors', icon: Users },
            { id: 'recurring', labelKey: 'monthlyCharges', icon: Settings2 },
            { id: 'ar', labelKey: 'arControls', icon: AlertCircle },
          ].map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => onOpenTool(tool.id)}
                className="rounded-2xl border border-ch-line bg-white px-4 py-4 text-left hover:bg-ch-pine-50/40"
              >
                <Icon className="w-5 h-5 text-ch-pine mb-2" />
                <p className="text-sm font-semibold">{t(`pms.fin.tools.${tool.labelKey}`)}</p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function GroupView({ groupId, data, onOpenAccount }) {
  const { t } = useFinLocale();
  const meta = GROUP_META[groupId] || GROUP_META.assets;
  const group = (data?.groups || []).find((g) => g.id === groupId);
  const Icon = meta.icon;
  const accounts = group?.accounts || [];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-ch-line bg-white p-6 flex items-center gap-4">
        <div className={`w-14 h-14 rounded-2xl ${meta.tile} text-white flex items-center justify-center`}>
          <Icon className="w-7 h-7" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-400">{groupId}</p>
          <h2 className="text-2xl font-semibold text-ch-pine">{meta.label}</h2>
          <p className="text-sm text-gray-500">{t(`pms.fin.groupMeta.${groupId}Hint`) || meta.hint} · {t('pms.fin.subAccounts', { count: accounts.length })}</p>
        </div>
        <p className="ml-auto text-2xl font-bold tabular-nums">{currency(group?.balance)}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.map((a) => (
          <button
            key={a.code}
            type="button"
            onClick={() => onOpenAccount(a.code)}
            className="rounded-2xl border border-ch-line bg-white p-5 text-left hover:border-ch-pine/40 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-xl ${meta.tint} flex items-center justify-center flex-shrink-0`}>
                <IconFor code={a.code} group={groupId} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-mono text-gray-400">{a.code}</p>
                <p className="font-semibold text-ch-pine leading-snug">{a.name}</p>
                {a.virtual ? (
                  <p className="text-[11px] text-amber-700 mt-1">{t('pms.fin.group.managementView')}</p>
                ) : a.recurring ? (
                  <p className="text-[11px] text-violet-700 mt-1">{t('pms.fin.group.monthlyAutoDeduct')}</p>
                ) : null}
              </div>
              <ChevronRight className="w-4 h-4 text-gray-300 mt-1" />
            </div>
            <div className="mt-4 flex items-end justify-between">
              <p className="text-xl font-bold tabular-nums">{currency(a.balance)}</p>
              <p className="text-xs text-gray-400">{t('pms.fin.entries', { count: a.txn_count })}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AccountView({ code, fromDate, toDate, basis, onOpenTxn }) {
  const { t } = useFinLocale();
  const params = rangeParams(fromDate, toDate, basis);
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-account', code, params],
    queryFn: () => api.get(`/financial-system/accounts/${code}`, { params }).then((r) => r.data),
    enabled: Boolean(code),
  });

  if (isLoading) return <LoadingSpinner />;
  const account = data?.account || getAccount(code) || { code, name: code };
  const rows = data?.transactions || [];
  const meta = GROUP_META[account.group] || GROUP_META.assets;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-ch-line bg-white p-6">
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-2xl ${meta.tile} text-white flex items-center justify-center`}>
            <IconFor code={code} group={account.group} className="w-7 h-7" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-mono text-gray-400">{account.code}</p>
            <h2 className="text-2xl font-semibold text-ch-pine">{account.name}</h2>
            <p className="text-sm text-gray-500 capitalize">
              {ACCOUNT_GROUPS[account.group] || account.group}
              {account.virtual ? ` · ${t('pms.fin.account.managementView')}` : ''}
              {account.recurring ? ` · ${t('pms.fin.account.monthlyAutomatic')}` : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">{t('pms.fin.balance')}</p>
            <p className="text-3xl font-bold tabular-nums text-ch-pine">{currency(account.balance)}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-ch-line">
          <h3 className="font-semibold">{t('pms.fin.account.transactionLog')}</h3>
          <p className="text-xs text-gray-500">{t('pms.fin.account.transactionLogHint')}</p>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">{t('pms.fin.account.noMovements')}</p>
        ) : (
          <div className="divide-y divide-ch-line">
            {rows.map((row) => (
              <button
                key={`${row.id}-${row.side}`}
                type="button"
                onClick={() => onOpenTxn(row.id)}
                className="w-full px-6 py-3.5 flex items-center gap-4 text-left hover:bg-ch-pine-50/50"
              >
                <div className="w-24 shrink-0 text-xs text-gray-500">{formatDate(row.date)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{row.description}</p>
                  <p className="text-xs text-gray-400 truncate">{row.counterparty || row.type}</p>
                </div>
                <p className={`tabular-nums font-semibold ${row.side === 'debit' ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {row.side === 'debit' ? '+' : '−'}
                  {currency(row.amount)}
                </p>
                <ChevronRight className="w-4 h-4 text-gray-300" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TransactionView({ txnId, fromDate, toDate, basis }) {
  const { t } = useFinLocale();
  const params = rangeParams(fromDate, toDate, basis);
  const { data, isLoading, error } = useQuery({
    queryKey: ['financial-system-txn', txnId, params],
    queryFn: () =>
      api.get(`/financial-system/transactions/${encodeURIComponent(txnId)}`, { params }).then((r) => r.data),
    enabled: Boolean(txnId),
  });

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) {
    return (
      <div className="rounded-2xl border border-ch-line bg-white p-10 text-center text-gray-500">
        {t('pms.fin.txn.notInPeriod')}
      </div>
    );
  }

  const meta = data.meta || {};
  const flow = data.flow || {};

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-ch-line bg-white p-6">
        <p className="text-[11px] font-mono text-gray-400">{data.id}</p>
        <h2 className="text-2xl font-semibold text-ch-pine mt-1">{data.description}</h2>
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="text-xs px-2 py-1 rounded-full bg-slate-100 capitalize">{data.type.replace('_', ' ')}</span>
          <span className="text-xs px-2 py-1 rounded-full bg-slate-100">{formatDate(data.date)}</span>
          <span className={`text-xs px-2 py-1 rounded-full ${data.balanced ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            {data.balanced ? t('pms.fin.txn.balanced') : t('pms.fin.txn.checkLines')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-center">
        <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-5">
          <p className="text-[11px] uppercase tracking-wider text-rose-700">{t('pms.fin.txn.from')}</p>
          <p className="font-mono text-xs text-gray-400 mt-2">{flow.from_account || '—'}</p>
          <p className="font-semibold text-ch-pine">{flow.from_name || '—'}</p>
        </div>
        <div className="flex flex-col items-center justify-center py-2">
          <ArrowRight className="w-8 h-8 text-ch-pine hidden md:block" />
          <p className="text-lg font-bold tabular-nums">{currency(data.debit || data.credit)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-5">
          <p className="text-[11px] uppercase tracking-wider text-emerald-700">{t('pms.fin.txn.to')}</p>
          <p className="font-mono text-xs text-gray-400 mt-2">{flow.to_account || '—'}</p>
          <p className="font-semibold text-ch-pine">{flow.to_name || '—'}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b font-semibold">{t('pms.fin.txn.journalLines')}</div>
        <table className="table text-sm">
          <thead>
            <tr>
              <th>{t('pms.fin.txn.thAccount')}</th>
              <th>{t('pms.fin.txn.thMemo')}</th>
              <th className="text-right">{t('pms.fin.txn.thDebit')}</th>
              <th className="text-right">{t('pms.fin.txn.thCredit')}</th>
            </tr>
          </thead>
          <tbody>
            {(data.lines || []).map((line, i) => (
              <tr key={i}>
                <td>
                  <div className="font-mono text-[11px] text-gray-400">{line.account}</div>
                  <div className="font-medium">{line.account_name}</div>
                </td>
                <td className="text-gray-500">{line.memo}</td>
                <td className="text-right tabular-nums">{line.debit ? currency(line.debit) : '—'}</td>
                <td className="text-right tabular-nums">{line.credit ? currency(line.credit) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-ch-line bg-white p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        {meta.guest_name && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.guest')}</p>
            <p className="font-medium">{meta.guest_name}</p>
          </div>
        )}
        {meta.unit_name && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.unit')}</p>
            <p className="font-medium">{meta.unit_name}{meta.project ? ` · ${meta.project}` : ''}</p>
          </div>
        )}
        {meta.payment_method && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.paymentMethod')}</p>
            <p className="font-medium capitalize">{String(meta.payment_method).replace('_', ' ')}</p>
          </div>
        )}
        {meta.channel && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.channel')}</p>
            <p className="font-medium">{meta.channel}</p>
          </div>
        )}
        {meta.created_at && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.booked')}</p>
            <p className="font-medium">{formatDate(meta.created_at)}</p>
          </div>
        )}
        {meta.check_in && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.stay')}</p>
            <p className="font-medium">
              {formatDate(meta.check_in)} → {formatDate(meta.check_out)}
            </p>
          </div>
        )}
        {meta.total_amount != null && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.guestTotalCollectedOutstanding')}</p>
            <p className="font-medium tabular-nums">
              {currency(meta.total_amount)} · {currency(meta.amount_paid)} · {currency(meta.outstanding)}
            </p>
          </div>
        )}
        {meta.automatic && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.posting')}</p>
            <p className="font-medium">{t('pms.fin.txn.monthlyAutoDeduction')}</p>
          </div>
        )}
        {meta.notes && (
          <div className="sm:col-span-2">
            <p className="text-xs text-gray-400">{t('pms.fin.txn.notes')}</p>
            <p>{meta.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function RecurringTool() {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ['financial-system-recurring'],
    queryFn: () => api.get('/financial-system/recurring').then((r) => r.data),
  });
  const [drafts, setDrafts] = useState({});

  const save = useMutation({
    mutationFn: ({ kind, amount_egp, day_of_month }) =>
      api.put(`/financial-system/recurring/${kind}`, { amount_egp, day_of_month }),
    onSuccess: () => {
      toast.success(t('pms.fin.recurring.saved'));
      qc.invalidateQueries({ queryKey: ['financial-system-recurring'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  if (isLoading) return <LoadingSpinner />;

  const icons = { rent: Home, utilities: Zap, buffet: UtensilsCrossed };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {t('pms.fin.recurring.description')}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {(Array.isArray(data) ? data : []).map((row) => {
          const Icon = icons[row.kind] || Settings2;
          const draft = drafts[row.kind] || {
            amount_egp: row.amount_egp,
            day_of_month: row.day_of_month,
          };
          return (
            <div key={row.kind} className="rounded-2xl border border-ch-line bg-white p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-800 flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold">{row.label}</p>
                  <p className="text-[11px] font-mono text-gray-400">{row.account_code}</p>
                </div>
              </div>
              <label className="label">{t('pms.fin.recurring.monthlyAmount')}</label>
              <input
                type="number"
                min="0"
                className="input w-full mb-3"
                value={draft.amount_egp}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [row.kind]: { ...draft, amount_egp: e.target.value } }))
                }
              />
              <label className="label">{t('pms.fin.recurring.dayOfMonth')}</label>
              <input
                type="number"
                min="1"
                max="28"
                className="input w-full mb-4"
                value={draft.day_of_month}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [row.kind]: { ...draft, day_of_month: e.target.value } }))
                }
              />
              <button
                type="button"
                className="btn-primary w-full"
                disabled={save.isPending}
                onClick={() =>
                  save.mutate({
                    kind: row.kind,
                    amount_egp: draft.amount_egp,
                    day_of_month: draft.day_of_month,
                  })
                }
              >
                {t('pms.fin.save')}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaxTab({ rangeParams: params }) {
  const { t } = useFinLocale();
  const [showPack, setShowPack] = useState(false);
  const toDate = params.to_date || new Date().toISOString().slice(0, 10);
  const packMonth = toDate.slice(0, 7);
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-tax', params],
    queryFn: () => api.get('/financial-system/tax', { params }).then((r) => r.data),
  });
  const { data: packData, isLoading: packLoading } = useQuery({
    queryKey: ['financial-system-tax-pack', packMonth],
    queryFn: () => api.get(`/financial-system/tax-filing-pack/${packMonth}`).then((r) => r.data),
    enabled: showPack,
  });
  if (isLoading) return <LoadingSpinner />;
  const liability = data?.liability || {};
  const vat = liability.output_vat || {};
  const wht = liability.withholding || {};
  const vatReturn = data?.vat_return || {};
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-amber-200 bg-white p-5">
          <p className="text-xs text-gray-500">{t('pms.fin.tax.outputVat', { pct: VAT_OUTPUT_PCT })}</p>
          <p className="text-2xl font-bold mt-2 tabular-nums">{currency(vatReturn.output_vat ?? vat.vat_amount)}</p>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-white p-5">
          <p className="text-xs text-gray-500">{t('pms.fin.tax.inputVat')}</p>
          <p className="text-2xl font-bold mt-2 tabular-nums">{currency(vatReturn.input_vat)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-white p-5">
          <p className="text-xs text-gray-500">{t('pms.fin.tax.vatReturn')}</p>
          <p className="text-2xl font-bold mt-2 tabular-nums">{currency(vatReturn.net_vat_payable)}</p>
        </div>
        <div className="rounded-2xl border border-violet-200 bg-white p-5">
          <p className="text-xs text-gray-500">{t('pms.fin.tax.withholding', { std: WHT_STANDARD_PCT, reduced: WHT_REDUCED_PCT })}</p>
          <p className="text-2xl font-bold mt-2 tabular-nums">{currency(wht.total_wht)}</p>
        </div>
      </div>

      <button type="button" className="btn-secondary" onClick={() => setShowPack(!showPack)}>
        <FileSpreadsheet className="w-4 h-4" /> {showPack ? t('pms.fin.tax.hideFilingPack') : t('pms.fin.tax.showFilingPack')} {t('pms.fin.tax.filingPack', { month: packMonth })}
      </button>

      {showPack && (
        packLoading ? <LoadingSpinner /> : (
          <div className="space-y-4">
            {/* VAT Output detail */}
            <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
              <div className="px-6 py-3 border-b font-semibold">{t('pms.fin.tax.vatOutputDetail')}</div>
              <table className="table text-sm">
                <thead><tr><th>{t('pms.fin.tax.category')}</th><th className="text-right">{t('pms.fin.tax.taxableBase')}</th><th className="text-right">{t('pms.fin.tax.vatPct', { pct: VAT_OUTPUT_PCT })}</th></tr></thead>
                <tbody>
                  <tr>
                    <td>{t('pms.fin.tax.commissionRevenue')}</td>
                    <td className="text-right tabular-nums">{currency(packData?.vat_output?.commission_base)}</td>
                    <td className="text-right tabular-nums">{currency(packData?.vat_output?.commission_vat)}</td>
                  </tr>
                  <tr>
                    <td>{t('pms.fin.tax.cleaningRevenue')}</td>
                    <td className="text-right tabular-nums">{currency(packData?.vat_output?.cleaning_base)}</td>
                    <td className="text-right tabular-nums">{currency(packData?.vat_output?.cleaning_vat)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td>{t('pms.fin.tax.totalOutputVat')}</td>
                    <td />
                    <td className="text-right tabular-nums">{currency(packData?.vat_output?.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* VAT Input detail */}
            <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
              <div className="px-6 py-3 border-b font-semibold">{t('pms.fin.tax.vatInputDetail')}</div>
              <table className="table text-sm">
                <thead><tr><th>{t('pms.fin.tax.category')}</th><th className="text-right">{t('pms.fin.tax.inputVatLabel')}</th></tr></thead>
                <tbody>
                  {Object.entries(packData?.vat_input?.by_category || {}).map(([cat, amt]) => (
                    <tr key={cat}><td className="capitalize">{cat}</td><td className="text-right tabular-nums">{currency(amt)}</td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold"><td>{t('pms.fin.tax.totalInputVat')}</td><td className="text-right tabular-nums">{currency(packData?.vat_input?.total)}</td></tr>
                </tfoot>
              </table>
            </div>

            {/* Net VAT reconciliation */}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 space-y-2">
              <h4 className="font-semibold">{t('pms.fin.tax.netVatReconciliation')}</h4>
              <div className="flex justify-between text-sm"><span>{t('pms.fin.tax.outputVatLabel')}</span><span className="tabular-nums">{currency(packData?.vat_output?.total)}</span></div>
              <div className="flex justify-between text-sm"><span>{t('pms.fin.tax.inputVatShort')}</span><span className="tabular-nums">−{currency(packData?.vat_input?.total)}</span></div>
              <div className="flex justify-between font-bold border-t pt-2"><span>{t('pms.fin.tax.netVatPayable')}</span><span className="tabular-nums">{currency(packData?.net_vat_payable)}</span></div>
              {packData?.reconciliation && (
                <div className="pt-2 border-t text-xs text-gray-500 space-y-1">
                  <p>{t('pms.fin.tax.bookOutput', { book: currency(packData.reconciliation.book_output_vat), computed: currency(packData.reconciliation.computed_output_vat), diff: currency(packData.reconciliation.output_diff) })}</p>
                  <p>{t('pms.fin.tax.bookInput', { book: currency(packData.reconciliation.book_input_vat), computed: currency(packData.reconciliation.computed_input_vat), diff: currency(packData.reconciliation.input_diff) })}</p>
                </div>
              )}
            </div>

            {/* WHT detail by vendor */}
            <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
              <div className="px-6 py-3 border-b font-semibold">{t('pms.fin.tax.whtDetailByVendor')}</div>
              <table className="table text-sm">
                <thead><tr><th>{t('pms.fin.tax.vendor')}</th><th>{t('pms.fin.tax.category')}</th><th className="text-right">{t('pms.fin.amount')}</th><th className="text-right">{t('pms.fin.tax.rate')}</th><th className="text-right">{t('pms.fin.tax.wht')}</th></tr></thead>
                <tbody>
                  {(packData?.wht?.lines || []).map((l) => (
                    <tr key={l.expense_id}>
                      <td>{l.vendor}</td>
                      <td className="capitalize">{l.category}</td>
                      <td className="text-right tabular-nums">{currency(l.amount)}</td>
                      <td className="text-right tabular-nums">{l.wht_rate_pct}%</td>
                      <td className="text-right tabular-nums">{currency(l.wht_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold"><td colSpan={4}>{t('pms.fin.tax.totalWhtPayable')}</td><td className="text-right tabular-nums">{currency(packData?.wht?.total)}</td></tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function OwnerStatementsTab({ fromDate, toDate, rangeParams: params }) {
  const { t } = useFinLocale();
  const [unitId, setUnitId] = useState('');
  const [settleOwner, setSettleOwner] = useState(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleNotes, setSettleNotes] = useState('');
  const qc = useQueryClient();
  const { data: units = [] } = useQuery({
    queryKey: ['financial-system-units'],
    queryFn: () => api.get('/financial-system/units').then((r) => r.data),
  });
  const q = { ...params, unit_id: unitId || undefined };
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-owners', fromDate, toDate, params.basis, unitId],
    queryFn: () => api.get('/financial-system/owner-statements', { params: q }).then((r) => r.data),
  });
  const settle = useMutation({
    mutationFn: (id) => api.post(`/financial-system/payouts/${id}/settle`),
    onSuccess: () => {
      toast.success(t('pms.fin.owners.markSettled'));
      qc.invalidateQueries({ queryKey: ['financial-system-owners'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
      qc.invalidateQueries({ queryKey: ['financial-system-trust'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const settleOwnerMutation = useMutation({
    mutationFn: ({ ownerId, amount, notes }) =>
      api.post(
        `/financial-system/owners/${ownerId}/settle`,
        { amount, notes },
        { params }
      ),
    onSuccess: (res) => {
      toast.success(t('pms.fin.owners.settledFor', { amount: currency(res.data?.amount), name: res.data?.owner?.full_name || t('pms.fin.owners.ownerFallback') }));
      setSettleOwner(null);
      setSettleAmount('');
      setSettleNotes('');
      qc.invalidateQueries({ queryKey: ['financial-system-owners'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
      qc.invalidateQueries({ queryKey: ['financial-system-trust'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.owners.failedToSettle')),
  });
  const reviewPayout = useMutation({
    mutationFn: ({ id, status }) => api.post(`/owner/payout-requests/${id}/review`, { status }),
    onSuccess: () => {
      toast.success(t('pms.fin.owners.payoutUpdated'));
      qc.invalidateQueries({ queryKey: ['financial-system-owners'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  if (isLoading) return <LoadingSpinner />;
  const statements = data?.statements || [];
  const ownerBalances = data?.owner_balances || [];
  const payouts = data?.payouts || [];

  function openSettle(owner) {
    setSettleOwner(owner);
    setSettleAmount(
      owner.remaining != null && owner.remaining > 0 ? String(owner.remaining) : ''
    );
    setSettleNotes('');
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        {t('pms.fin.owners.description')}
      </p>
      <SearchableSelect
        className="w-72"
        value={unitId}
        onChange={setUnitId}
        placeholder={t('pms.fin.owners.allUnits')}
        options={[
          { value: '', label: t('pms.fin.owners.allUnits') },
          ...units.map((u) => ({
            value: String(u.id),
            label: `${u.project ? `${u.project} — ` : ''}${u.unit_name}`,
          })),
        ]}
      />

      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold">{t('pms.fin.owners.settleByOwner')}</h3>
          <p className="text-xs text-gray-500 mt-1">
            {t('pms.fin.owners.settleByOwnerHint')}
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.owners.owner')}</th>
                <th className="text-right">{t('pms.fin.owners.earned')}</th>
                <th className="text-right">{t('pms.fin.owners.alreadyPaid')}</th>
                <th className="text-right">{t('pms.fin.owners.remaining')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ownerBalances.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-sm text-gray-400 py-8">
                    {t('pms.fin.owners.noOwnerBalances')}
                  </td>
                </tr>
              ) : (
                ownerBalances.map((o) => (
                  <tr key={o.owner_id}>
                    <td className="font-medium">{o.full_name}</td>
                    <td className="text-right tabular-nums">{currency(o.earned)}</td>
                    <td className="text-right tabular-nums text-emerald-700">
                      {o.paid_out > 0 ? currency(o.paid_out) : '—'}
                    </td>
                    <td className="text-right font-bold tabular-nums">{currency(o.remaining)}</td>
                    <td className="text-right">
                      {o.remaining > 0.009 ? (
                        <button
                          type="button"
                          className="btn-secondary text-xs py-1 px-2"
                          onClick={() => openSettle(o)}
                        >
                          <CheckCircle2 className="w-3 h-3 inline mr-1" />
                          {t('pms.fin.owners.customSettle')}
                        </button>
                      ) : (
                        <span className="text-xs text-emerald-600 font-medium">{t('pms.fin.owners.settled')}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold">{t('pms.fin.owners.ownerBalancesByUnit')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.owners.unitCol')}</th>
                <th>{t('pms.fin.owners.owner')}</th>
                <th className="text-right">{t('pms.fin.owners.credits')}</th>
                <th className="text-right">{t('pms.fin.owners.maintenance')}</th>
                <th className="text-right">{t('pms.fin.owners.netDue')}</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.unit_id}>
                  <td className="font-medium">{s.unit_name}</td>
                  <td>{s.owner_names}</td>
                  <td className="text-right tabular-nums">{currency(s.gross_credits)}</td>
                  <td className="text-right tabular-nums text-rose-600">
                    {s.maintenance_deductions > 0 ? `−${currency(s.maintenance_deductions)}` : '—'}
                  </td>
                  <td className="text-right font-bold tabular-nums">{currency(s.net_payout_due)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b font-semibold">{t('pms.fin.owners.withdrawalRequests')}</div>
        <table className="table text-sm">
          <thead>
            <tr>
              <th>{t('pms.fin.owners.owner')}</th>
              <th className="text-right">{t('pms.fin.amount')}</th>
              <th>{t('pms.fin.owners.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {payouts.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center text-sm text-gray-400 py-6">
                  {t('pms.fin.owners.noWithdrawals')}
                </td>
              </tr>
            ) : (
              payouts.map((p) => (
                <tr key={p.id}>
                  <td>{p.owner_name}</td>
                  <td className="text-right tabular-nums">{currency(p.amount)}</td>
                  <td className="capitalize">{p.status}</td>
                  <td className="text-right space-x-2">
                    {p.status === 'requested' && (
                      <>
                        <button
                          type="button"
                          className="text-xs text-emerald-700"
                          onClick={() => reviewPayout.mutate({ id: p.id, status: 'approved' })}
                        >
                          {t('pms.fin.approve')}
                        </button>
                        <button
                          type="button"
                          className="text-xs text-red-600"
                          onClick={() => reviewPayout.mutate({ id: p.id, status: 'rejected' })}
                        >
                          {t('pms.fin.reject')}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-xs py-1 px-2"
                          onClick={() => settle.mutate(p.id)}
                        >
                          {t('pms.fin.owners.markSettled')}
                        </button>
                      </>
                    )}
                    {p.status === 'approved' && (
                      <button
                        type="button"
                        className="btn-secondary text-xs py-1 px-2"
                        onClick={() => settle.mutate(p.id)}
                      >
                        <CheckCircle2 className="w-3 h-3 inline mr-1" />
                        {t('pms.fin.owners.markSettled')}
                      </button>
                    )}
                    {p.status === 'paid' && (
                      <span className="text-xs text-emerald-600 font-medium">{t('pms.fin.owners.paid')}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={Boolean(settleOwner)}
        onClose={() => setSettleOwner(null)}
        title={settleOwner ? t('pms.fin.owners.settleModalTitle', { name: settleOwner.full_name }) : t('pms.fin.owners.settleOwnerFallback')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setSettleOwner(null)}>
              {t('pms.fin.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={settleOwnerMutation.isPending || !(parseFloat(settleAmount) > 0)}
              onClick={() =>
                settleOwnerMutation.mutate({
                  ownerId: settleOwner.owner_id,
                  amount: parseFloat(settleAmount),
                  notes: settleNotes || undefined,
                })
              }
            >
              {settleOwnerMutation.isPending ? t('pms.fin.owners.saving') : t('pms.fin.owners.confirmSettled')}
            </button>
          </>
        }
      >
        {settleOwner && (
          <div className="space-y-4 text-sm">
            <p className="text-gray-600">
              {t('pms.fin.owners.settleDescription', { remaining: currency(settleOwner.remaining) })}
            </p>
            <div>
              <label className="label">{t('pms.fin.amountEgp')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input w-full"
                value={settleAmount}
                onChange={(e) => setSettleAmount(e.target.value)}
              />
            </div>
            <div>
              <label className="label">{t('pms.fin.notesOptional')}</label>
              <input
                className="input w-full"
                value={settleNotes}
                onChange={(e) => setSettleNotes(e.target.value)}
                placeholder={t('pms.fin.owners.notesPlaceholder')}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ManualEntriesTab({ fromDate, toDate, rangeParams: params }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const emptyForm = {
    from_account: '',
    to_account: '',
    amount: '',
    entry_date: new Date().toISOString().slice(0, 10),
    notes: '',
  };
  const [form, setForm] = useState(emptyForm);
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-manual', fromDate, toDate],
    queryFn: () => api.get('/financial-system/manual-entries', { params }).then((r) => r.data),
  });
  const createEntry = useMutation({
    mutationFn: (payload) => api.post('/financial-system/manual-entries', payload),
    onSuccess: () => {
      toast.success(t('pms.fin.manual.entryAdded'));
      qc.invalidateQueries({ queryKey: ['financial-system-manual'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
      setShowForm(false);
      setForm(emptyForm);
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const removeEntry = useMutation({
    mutationFn: (id) => api.delete(`/financial-system/manual-entries/${id}`),
    onSuccess: () => {
      toast.success(t('pms.fin.manual.entryRemoved'));
      qc.invalidateQueries({ queryKey: ['financial-system-manual'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  if (isLoading) return <LoadingSpinner />;
  const entries = data?.entries || [];
  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <p className="text-sm text-gray-500">{t('pms.fin.manual.description')}</p>
        <button type="button" className="btn-primary text-sm" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" /> {t('pms.fin.manual.addEntry')}
        </button>
      </div>
      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <table className="table text-sm">
          <thead>
            <tr>
              <th>{t('pms.fin.manual.date')}</th>
              <th>{t('pms.fin.manual.fromAccount')}</th>
              <th>{t('pms.fin.manual.toAccount')}</th>
              <th>{t('pms.fin.notes')}</th>
              <th className="text-right">{t('pms.fin.amount')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-sm text-gray-400 py-8">
                  {t('pms.fin.manual.noEntries')}
                </td>
              </tr>
            ) : (
              entries.map((row) => {
                const fromCode = row.credit_account_code;
                const toCode = row.debit_account_code;
                const fromAcct = fromCode ? getAccount(fromCode) : null;
                const toAcct = toCode ? getAccount(toCode) : null;
                return (
                  <tr key={row.id}>
                    <td>{formatDate(row.entry_date)}</td>
                    <td>
                      {fromCode ? (
                        <>
                          <span className="font-mono text-[11px] text-gray-400 mr-1">{fromCode}</span>
                          {fromAcct?.name || row.entry_type}
                        </>
                      ) : (
                        <span className="capitalize text-gray-500">{row.entry_type}</span>
                      )}
                    </td>
                    <td>
                      {toCode ? (
                        <>
                          <span className="font-mono text-[11px] text-gray-400 mr-1">{toCode}</span>
                          {toAcct?.name || '—'}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="max-w-[14rem] truncate">{row.notes || row.description || '—'}</td>
                    <td className="text-right tabular-nums">{currency(row.amount)}</td>
                    <td className="text-right">
                      <button type="button" className="p-1.5 text-gray-400 hover:text-rose-600" onClick={() => setDeleteId(row.id)}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={t('pms.fin.manual.addEntryTitle')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>{t('pms.fin.cancel')}</button>
            <button
              type="submit"
              form="manual-entry-form"
              className="btn-primary"
              disabled={createEntry.isPending}
            >
              {t('pms.fin.save')}
            </button>
          </>
        }
      >
        <form
          id="manual-entry-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.from_account || !form.to_account) {
              toast.error(t('pms.fin.manual.chooseFrom'));
              return;
            }
            if (form.from_account === form.to_account) {
              toast.error(t('pms.fin.manual.fromHint'));
              return;
            }
            createEntry.mutate({
              entry_type: 'journal',
              from_account: form.from_account,
              to_account: form.to_account,
              amount: parseFloat(form.amount),
              entry_date: form.entry_date,
              notes: form.notes.trim() || undefined,
            });
          }}
        >
          <div>
            <label className="label">{t('pms.fin.manual.fromAccount')}</label>
            <SearchableSelect
              className="w-full"
              value={form.from_account}
              onChange={(v) => setForm((f) => ({ ...f, from_account: v }))}
              placeholder={t('pms.fin.manual.chooseFrom')}
              options={MANUAL_ACCOUNT_OPTIONS}
              required
            />
            <p className="text-[11px] text-gray-400 mt-1">{t('pms.fin.manual.fromHint')}</p>
          </div>
          <div>
            <label className="label">{t('pms.fin.manual.toAccount')}</label>
            <SearchableSelect
              className="w-full"
              value={form.to_account}
              onChange={(v) => setForm((f) => ({ ...f, to_account: v }))}
              placeholder={t('pms.fin.manual.chooseTo')}
              options={MANUAL_ACCOUNT_OPTIONS}
              required
            />
            <p className="text-[11px] text-gray-400 mt-1">{t('pms.fin.manual.toHint')}</p>
          </div>
          <div>
            <label className="label">{t('pms.fin.amountEgp')}</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              className="input w-full"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">{t('pms.fin.manual.date')}</label>
            <input
              type="date"
              min={FINANCIAL_EPOCH}
              className="input w-full"
              value={form.entry_date}
              onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">{t('pms.fin.notes')}</label>
            <textarea
              className="input w-full min-h-[80px]"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={t('pms.fin.manual.notesPlaceholder')}
            />
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title={t('pms.fin.manual.deleteTitle')}
        message={t('pms.fin.manual.deleteMessage')}
        confirmText={t('pms.fin.delete')}
        danger
        onConfirm={() => removeEntry.mutate(deleteId)}
        loading={removeEntry.isPending}
      />
    </div>
  );
}

function AccountLines({ rows, amountKey = 'balance' }) {
  const { t } = useFinLocale();
  if (!rows?.length) return <p className="text-sm text-gray-400 py-6 text-center">{t('pms.fin.reports.noBalances')}</p>;
  return (
    <table className="table text-sm">
      <thead>
        <tr>
          <th>{t('pms.fin.reports.thAccount')}</th>
          <th className="text-right">{t('pms.fin.amount')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.code}>
            <td>
              <span className="font-mono text-[11px] text-gray-400 mr-2">{a.code}</span>
              {a.name}
            </td>
            <td className="text-right tabular-nums">{currency(a[amountKey] ?? a.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CashFlowSection({ cf, fromDate, toDate }) {
  const { t } = useFinLocale();
  const [expanded, setExpanded] = useState({});

  function toggle(key) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function lineLabel(line) {
    const key = `pms.fin.reports.cfLines.${line.id}`;
    const translated = t(key);
    return translated === key ? line.label || line.id : translated;
  }

  function SectionBlock({ title, section, sectionKey }) {
    const lines = section?.lines || [];
    return (
      <div className="space-y-1">
        <div className="px-4 py-2 bg-slate-50 border-b font-semibold text-sm text-ch-pine">
          {title}
        </div>
        {lines.length === 0 ? (
          <p className="px-4 py-2 text-xs text-gray-400">{t('pms.fin.reports.cfNoActivity')}</p>
        ) : (
          lines.map((line) => {
            const key = `${sectionKey}:${line.id}`;
            const open = Boolean(expanded[key]);
            return (
              <div key={key} className="border-b border-ch-line/60 last:border-0">
                <button
                  type="button"
                  className="w-full flex justify-between items-center gap-3 px-4 py-2 text-sm hover:bg-ch-pine-50/40 text-left"
                  onClick={() => toggle(key)}
                >
                  <span className="flex items-center gap-2">
                    <ChevronRight
                      className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
                    />
                    {lineLabel(line)}
                    {line.entries?.length ? (
                      <span className="text-[10px] text-gray-400">({line.entries.length})</span>
                    ) : null}
                  </span>
                  <span className="tabular-nums font-medium">{currency(line.amount)}</span>
                </button>
                {open && line.entries?.length ? (
                  <div className="bg-gray-50/80 px-4 py-2 space-y-1">
                    {line.entries.map((e) => (
                      <div
                        key={`${e.id}-${e.amount}-${e.date}`}
                        className="flex justify-between gap-3 text-xs text-gray-600"
                      >
                        <span className="min-w-0 truncate">
                          <span className="text-gray-400 mr-2">{formatDate(e.date)}</span>
                          {e.description}
                        </span>
                        <span className="tabular-nums shrink-0">{currency(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
        <div className="flex justify-between px-4 py-2.5 text-sm font-semibold border-t">
          <span>{t('pms.fin.reports.cfSectionTotal', { section: title })}</span>
          <span className="tabular-nums">{currency(section?.total)}</span>
        </div>
      </div>
    );
  }

  const balanced = cf.reconciliation?.balanced !== false;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-ch-line bg-white p-5 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-ch-pine">{t('pms.fin.reports.cfTitle')}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {t('pms.fin.reports.cfMethodHint', {
                from: fromDate || cf.from_date,
                to: toDate || cf.to_date,
              })}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="rounded-xl border border-ch-line bg-slate-50/80 p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">{t('pms.fin.reports.cfOpening')}</p>
            <p className="text-lg font-bold tabular-nums mt-1">{currency(cf.opening_cash)}</p>
          </div>
          <div className="rounded-xl border border-ch-line bg-white p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">{t('pms.fin.reports.cfNetChange')}</p>
            <p className="text-lg font-bold tabular-nums mt-1">{currency(cf.net_change)}</p>
          </div>
          <div
            className={`rounded-xl border p-3 ${
              balanced ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/60'
            }`}
          >
            <p className="text-[11px] uppercase tracking-wide text-gray-400">{t('pms.fin.reports.cfEnding')}</p>
            <p className="text-lg font-bold tabular-nums mt-1">{currency(cf.ending_cash)}</p>
            {!balanced ? (
              <p className="text-[11px] text-rose-700 mt-1">
                {t('pms.fin.reports.cfVariance', {
                  amount: currency(cf.reconciliation?.variance),
                })}
              </p>
            ) : (
              <p className="text-[11px] text-emerald-700 mt-1">{t('pms.fin.reports.cfReconciled')}</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <SectionBlock
          title={t('pms.fin.reports.cfOperating')}
          section={cf.operating}
          sectionKey="operating"
        />
        <SectionBlock
          title={t('pms.fin.reports.cfInvesting')}
          section={cf.investing}
          sectionKey="investing"
        />
        <SectionBlock
          title={t('pms.fin.reports.cfFinancing')}
          section={cf.financing}
          sectionKey="financing"
        />
        <div className="flex justify-between px-4 py-3 bg-ch-pine text-white font-semibold">
          <span>{t('pms.fin.reports.netTreasuryChange')}</span>
          <span className="tabular-nums">{currency(cf.net_change)}</span>
        </div>
      </div>

      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-sm">{t('pms.fin.reports.cfByAccount')}</div>
        <table className="table text-sm">
          <thead>
            <tr>
              <th>{t('pms.fin.reports.thAccount')}</th>
              <th className="text-right">{t('pms.fin.reports.cfOpening')}</th>
              <th className="text-right">{t('pms.fin.reports.cfInflows')}</th>
              <th className="text-right">{t('pms.fin.reports.cfOutflows')}</th>
              <th className="text-right">{t('pms.fin.reports.cfEnding')}</th>
            </tr>
          </thead>
          <tbody>
            {(cf.by_account || []).map((a) => (
              <tr key={a.code}>
                <td>
                  <span className="font-mono text-[11px] text-gray-400 mr-2">{a.code}</span>
                  {a.name}
                  {a.currency && a.currency !== 'EGP' ? (
                    <span className="text-[10px] text-gray-400 ml-1">({a.currency})</span>
                  ) : null}
                </td>
                <td className="text-right tabular-nums">{currency(a.opening)}</td>
                <td className="text-right tabular-nums text-emerald-700">{currency(a.inflows)}</td>
                <td className="text-right tabular-nums text-rose-700">{currency(a.outflows)}</td>
                <td className="text-right tabular-nums font-medium">{currency(a.closing)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-2 text-[11px] text-gray-500 border-t">{cf.note}</p>
      </div>
    </div>
  );
}

function CashFlowTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-reports', params],
    queryFn: () => api.get('/financial-system/reports', { params }).then((r) => r.data),
  });
  if (isLoading) return <LoadingSpinner />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {t('pms.fin.reports.cfPageHint', {
          from: data?.from_date,
          to: data?.to_date,
        })}
      </p>
      <CashFlowSection
        cf={data?.cash_flow || {}}
        fromDate={data?.from_date}
        toDate={data?.to_date}
      />
    </div>
  );
}

function ReportsTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const [tab, setTab] = useState('pnl');
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-reports', params],
    queryFn: () => api.get('/financial-system/reports', { params }).then((r) => r.data),
  });
  if (isLoading) return <LoadingSpinner />;
  const pnl = data?.profit_and_loss || {};
  const tb = data?.trial_balance || {};
  const bs = data?.balance_sheet || {};
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {t('pms.fin.reports.description', { from: data?.from_date, to: data?.to_date })}
      </p>
      <div className="flex flex-wrap gap-2">
        {[
          ['pnl', t('pms.fin.reports.pnl')],
          ['tb', t('pms.fin.reports.tb')],
          ['bs', t('pms.fin.reports.bs')],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`px-3 py-1.5 rounded-full text-sm ${tab === id ? 'bg-ch-pine text-white' : 'bg-white border border-ch-line'}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'pnl' && (
        <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h3 className="font-semibold">{t('pms.fin.reports.pnlTitle')}</h3>
            <p className="text-xs text-gray-500">{t('pms.fin.reports.pnlHint')}</p>
          </div>
          <div className="px-6 py-3 bg-emerald-50 text-sm flex justify-between font-semibold">
            <span>{t('pms.fin.reports.grossRevenueLabel')}</span>
            <span className="tabular-nums">{currency(pnl.totals?.gross_revenue ?? pnl.receipts?.total)}</span>
          </div>
          <div className="px-6 py-1.5 text-sm flex justify-between text-gray-600">
            <span>{t('pms.fin.reports.reservationTotals')}</span>
            <span className="tabular-nums">{currency(pnl.receipts?.stays)}</span>
          </div>
          <div className="px-6 py-1.5 text-sm flex justify-between text-gray-600">
            <span>{t('pms.fin.reports.customRevenue')}</span>
            <span className="tabular-nums">{currency(pnl.receipts?.custom)}</span>
          </div>
          <div className="px-6 py-2 text-sm flex justify-between text-rose-800 bg-rose-50/70">
            <span>{t('pms.fin.reports.ownerShareLabel')}</span>
            <span className="tabular-nums">−{currency(pnl.totals?.owner_share ?? pnl.receipts?.owner_share)}</span>
          </div>
          <div className="px-6 py-2 text-sm flex justify-between font-semibold">
            <span>{t('pms.fin.reports.revenueAfterOwners')}</span>
            <span className="tabular-nums">{currency(pnl.totals?.net_revenue)}</span>
          </div>
          <AccountLines rows={(pnl.cogs || []).filter((a) => a.code !== '506000')} />
          <div className="px-6 py-2 bg-slate-50 text-sm flex justify-between">
            <span>{t('pms.fin.reports.grossAfterDirect')}</span>
            <span className="tabular-nums font-semibold">{currency(pnl.totals?.gross)}</span>
          </div>
          <AccountLines rows={pnl.opex} />
          <div className="px-6 py-3 bg-ch-pine text-white flex justify-between">
            <span>{t('pms.fin.reports.netProfitLoss')}</span>
            <span className="tabular-nums font-bold">{currency(pnl.totals?.net)}</span>
          </div>
        </div>
      )}
      {tab === 'tb' && (
        <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.reports.thAccount')}</th>
                <th className="text-right">{t('pms.fin.reports.thDebit')}</th>
                <th className="text-right">{t('pms.fin.reports.thCredit')}</th>
              </tr>
            </thead>
            <tbody>
              {(tb.rows || []).map((a) => (
                <tr key={a.code}>
                  <td>
                    <span className="font-mono text-[11px] text-gray-400 mr-2">{a.code}</span>
                    {a.name}
                  </td>
                  <td className="text-right tabular-nums">{a.debit ? currency(a.debit) : '—'}</td>
                  <td className="text-right tabular-nums">{a.credit ? currency(a.credit) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>{t('pms.fin.reports.total')}</td>
                <td className="text-right tabular-nums">{currency(tb.debit)}</td>
                <td className="text-right tabular-nums">{currency(tb.credit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {tab === 'bs' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
            <div className="px-6 py-3 border-b font-semibold">{t('pms.fin.reports.assets')}</div>
            <AccountLines rows={bs.assets} />
            <div className="px-6 py-3 bg-slate-50 flex justify-between font-semibold">
              <span>{t('pms.fin.reports.totalAssets')}</span>
              <span className="tabular-nums">{currency(bs.totals?.assets)}</span>
            </div>
          </div>
          <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
            <div className="px-6 py-3 border-b font-semibold">{t('pms.fin.reports.liabilitiesEquity')}</div>
            <AccountLines rows={bs.liabilities} />
            <AccountLines rows={bs.equity} />
            <div className="px-6 py-3 bg-slate-50 flex justify-between font-semibold">
              <span>{t('pms.fin.reports.liabilitiesPlusEquity')}</span>
              <span className="tabular-nums">{currency(bs.totals?.liabilities_and_equity)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AgingTool({ rangeParams: params, onOpenAccount }) {
  const { t } = useFinLocale();
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-aging', params],
    queryFn: () => api.get('/financial-system/aging', { params }).then((r) => r.data),
  });
  if (isLoading) return <LoadingSpinner />;
  const buckets = data?.buckets || {};
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-gray-500">
          {t('pms.fin.aging.description', { balance: currency(data?.ar_balance) })}
        </p>
        <button type="button" className="btn-secondary text-sm" onClick={() => onOpenAccount('105000')}>
          {t('pms.fin.aging.openAccount')}
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Object.entries(buckets).map(([key, b]) => (
          <div key={key} className="rounded-2xl border border-ch-line bg-white p-4">
            <p className="text-xs text-gray-400">{b.label}</p>
            <p className="text-xl font-bold tabular-nums mt-1">{currency(b.amount)}</p>
            <p className="text-xs text-gray-500">{t('pms.fin.stays', { count: b.count })}</p>
          </div>
        ))}
      </div>
      {Object.values(buckets).map((b) =>
        (b.rows || []).length ? (
          <div key={b.label} className="rounded-2xl border border-ch-line bg-white overflow-hidden">
            <div className="px-6 py-3 border-b font-semibold">{b.label}</div>
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>{t('pms.fin.aging.guest')}</th>
                  <th>{t('pms.fin.aging.unit')}</th>
                  <th>{t('pms.fin.aging.checkIn')}</th>
                  <th className="text-right">{t('pms.fin.aging.days')}</th>
                  <th className="text-right">{t('pms.fin.aging.due')}</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r) => (
                  <tr key={r.reservation_id}>
                    <td>{r.guest_name}</td>
                    <td>{r.unit_name}</td>
                    <td>{formatDate(r.check_in)}</td>
                    <td className="text-right tabular-nums">{r.days}</td>
                    <td className="text-right tabular-nums font-medium">{currency(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null
      )}
    </div>
  );
}

function PaymentCalendarTool() {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState(today);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({
    title: '',
    amount: '',
    due_date: today,
    direction: 'out',
    category: 'other',
    status: 'pending',
    notes: '',
    account_code: '',
  });

  const range = useMemo(() => {
    const from = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-01`;
    const last = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const to = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { from, to };
  }, [cursor]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['financial-system-payment-calendar', range.from, range.to],
    queryFn: () =>
      api
        .get('/financial-system/payment-calendar', { params: { from: range.from, to: range.to } })
        .then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: (payload) => {
      if (payload.id) {
        return api.patch(`/financial-system/payment-calendar/${payload.id}`, payload.body);
      }
      return api.post('/financial-system/payment-calendar', payload.body);
    },
    onSuccess: () => {
      toast.success(t('pms.fin.paymentCalendar.saved'));
      setEditItem(null);
      qc.invalidateQueries({ queryKey: ['financial-system-payment-calendar'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.paymentCalendar.saveFailed')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/financial-system/payment-calendar/${id}`),
    onSuccess: () => {
      toast.success(t('pms.fin.paymentCalendar.deleted'));
      setEditItem(null);
      qc.invalidateQueries({ queryKey: ['financial-system-payment-calendar'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.paymentCalendar.deleteFailed')),
  });

  const items = data?.items || [];
  const summary = data?.summary || {};
  const byDay = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const key = String(it.due_date).slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return map;
  }, [items]);

  const days = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const startPad = (first.getDay() + 6) % 7; // Monday-first
    const dim = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i += 1) cells.push(null);
    for (let d = 1; d <= dim; d += 1) {
      const iso = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push(iso);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const dayItems = byDay.get(selectedDay) || [];

  function openCreate(day) {
    setForm({
      title: '',
      amount: '',
      due_date: day || selectedDay || today,
      direction: 'out',
      category: 'other',
      status: 'pending',
      notes: '',
      account_code: '',
    });
    setEditItem({ mode: 'create' });
  }

  function openEdit(item) {
    if (!item.editable) {
      setEditItem({ mode: 'view', item });
      return;
    }
    setForm({
      title: item.title || '',
      amount: String(item.amount ?? ''),
      due_date: item.due_date,
      direction: item.direction || 'out',
      category: item.category || 'other',
      status: item.status === 'overdue' ? 'pending' : item.status || 'pending',
      notes: item.notes || '',
      account_code: item.account_code || '',
    });
    setEditItem({ mode: 'edit', item });
  }

  function statusClass(status) {
    if (status === 'overdue') return 'bg-rose-100 text-rose-800 border-rose-200';
    if (status === 'paid') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (status === 'cancelled') return 'bg-slate-100 text-slate-500 border-slate-200';
    return 'bg-amber-50 text-amber-900 border-amber-200';
  }

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-gray-500 max-w-3xl">{t('pms.fin.paymentCalendar.description')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={() => refetch()} disabled={isFetching}>
            {t('pms.fin.paymentCalendar.refresh')}
          </button>
          <button type="button" className="btn-primary text-sm" onClick={() => openCreate(selectedDay)}>
            <Plus className="w-4 h-4" /> {t('pms.fin.paymentCalendar.addManual')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-ch-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.paymentCalendar.items')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{summary.total || 0}</p>
          <p className="text-[11px] text-gray-400 mt-1">
            {t('pms.fin.paymentCalendar.sourceSplit', {
              accounting: summary.accounting_count || 0,
              manual: summary.manual_count || 0,
            })}
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-xs text-amber-800">{t('pms.fin.paymentCalendar.pending')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{summary.pending || 0}</p>
          <p className="text-xs text-gray-500">{currency(summary.amount_pending)}</p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
          <p className="text-xs text-rose-800">{t('pms.fin.paymentCalendar.overdue')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{summary.overdue || 0}</p>
          <p className="text-xs text-gray-500">{currency(summary.amount_overdue)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-xs text-emerald-800">{t('pms.fin.paymentCalendar.paid')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{summary.paid || 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4">
        <div className="rounded-2xl border border-ch-line bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              className="btn-secondary text-xs px-2 py-1"
              onClick={() =>
                setCursor((c) => {
                  const d = new Date(c.year, c.month - 1, 1);
                  return { year: d.getFullYear(), month: d.getMonth() };
                })
              }
            >
              ←
            </button>
            <p className="font-semibold text-ch-pine">{monthLabel}</p>
            <button
              type="button"
              className="btn-secondary text-xs px-2 py-1"
              onClick={() =>
                setCursor((c) => {
                  const d = new Date(c.year, c.month + 1, 1);
                  return { year: d.getFullYear(), month: d.getMonth() };
                })
              }
            >
              →
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-[11px] text-center text-gray-400 mb-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((iso, idx) => {
              if (!iso) return <div key={`e-${idx}`} className="min-h-[72px] rounded-lg bg-slate-50/50" />;
              const list = byDay.get(iso) || [];
              const overdueCount = list.filter((x) => x.status === 'overdue').length;
              const selected = iso === selectedDay;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSelectedDay(iso)}
                  className={`min-h-[72px] rounded-lg border p-1.5 text-left transition-colors ${
                    selected
                      ? 'border-ch-pine bg-ch-pine-50/50'
                      : overdueCount
                        ? 'border-rose-200 bg-rose-50/40 hover:border-rose-300'
                        : 'border-ch-line bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${isToday ? 'text-ch-pine' : 'text-gray-700'}`}>
                      {Number(iso.slice(8, 10))}
                    </span>
                    {list.length ? (
                      <span className="text-[10px] tabular-nums text-gray-400">{list.length}</span>
                    ) : null}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {list.slice(0, 2).map((it) => (
                      <div
                        key={it.id}
                        className={`truncate rounded px-1 py-0.5 text-[10px] border ${statusClass(it.status)}`}
                        title={it.title}
                      >
                        {it.source === 'manual' ? '• ' : ''}
                        {currency(it.amount)}
                      </div>
                    ))}
                    {list.length > 2 ? (
                      <p className="text-[10px] text-gray-400">+{list.length - 2}</p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-gray-400">
            {t('pms.fin.paymentCalendar.legend')}
          </p>
        </div>

        <div className="rounded-2xl border border-ch-line bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-400">{t('pms.fin.paymentCalendar.dayList')}</p>
              <p className="font-semibold text-ch-pine">{formatDate(selectedDay)}</p>
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={() => openCreate(selectedDay)}>
              <Plus className="w-3.5 h-3.5" /> {t('pms.fin.paymentCalendar.add')}
            </button>
          </div>
          {!dayItems.length ? (
            <p className="text-sm text-gray-400 py-8 text-center">{t('pms.fin.paymentCalendar.noDayItems')}</p>
          ) : (
            <ul className="space-y-2 max-h-[28rem] overflow-y-auto">
              {dayItems.map((it) => (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => openEdit(it)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left hover:border-ch-pine/40 ${statusClass(it.status)}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{it.title}</p>
                        <p className="text-[11px] opacity-80 mt-0.5">
                          {it.source === 'manual'
                            ? t('pms.fin.paymentCalendar.manual')
                            : t('pms.fin.paymentCalendar.accounting')}
                          {it.account_code ? ` · ${it.account_code}` : ''}
                          {' · '}
                          {t(`pms.fin.paymentCalendar.status.${it.status}`)}
                        </p>
                      </div>
                      <p className="font-semibold tabular-nums shrink-0">{currency(it.amount)}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(editItem)}
        onClose={() => setEditItem(null)}
        title={
          editItem?.mode === 'create'
            ? t('pms.fin.paymentCalendar.addManual')
            : editItem?.mode === 'edit'
              ? t('pms.fin.paymentCalendar.editManual')
              : t('pms.fin.paymentCalendar.details')
        }
        size="md"
        footer={
          editItem?.mode === 'view' ? (
            <button type="button" className="btn-secondary" onClick={() => setEditItem(null)}>
              {t('pms.fin.paymentCalendar.close')}
            </button>
          ) : (
            <>
              {editItem?.mode === 'edit' ? (
                <button
                  type="button"
                  className="btn-secondary text-rose-700 mr-auto"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(editItem.item.source_id)}
                >
                  {t('pms.fin.paymentCalendar.delete')}
                </button>
              ) : null}
              <button type="button" className="btn-secondary" onClick={() => setEditItem(null)}>
                {t('pms.fin.paymentCalendar.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={saveMutation.isPending}
                onClick={() => {
                  if (!String(form.title || '').trim()) {
                    toast.error(t('pms.fin.paymentCalendar.titleRequired'));
                    return;
                  }
                  if (!form.due_date) {
                    toast.error(t('pms.fin.paymentCalendar.dueRequired'));
                    return;
                  }
                  const body = {
                    title: form.title.trim(),
                    amount: form.amount,
                    due_date: form.due_date,
                    direction: form.direction,
                    category: form.category,
                    status: form.status,
                    notes: form.notes,
                    account_code: form.account_code || null,
                  };
                  saveMutation.mutate({
                    id: editItem?.mode === 'edit' ? editItem.item.source_id : null,
                    body,
                  });
                }}
              >
                {saveMutation.isPending ? t('pms.fin.paymentCalendar.saving') : t('pms.fin.paymentCalendar.save')}
              </button>
            </>
          )
        }
      >
        {editItem?.mode === 'view' && editItem.item ? (
          <div className="space-y-3 text-sm">
            <p className="font-semibold text-ch-pine">{editItem.item.title}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.paymentCalendar.amount')}</p>
                <p className="tabular-nums font-medium">{currency(editItem.item.amount)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.paymentCalendar.dueDate')}</p>
                <p>{formatDate(editItem.item.due_date)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.paymentCalendar.statusLabel')}</p>
                <p>{t(`pms.fin.paymentCalendar.status.${editItem.item.status}`)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.paymentCalendar.source')}</p>
                <p>{t('pms.fin.paymentCalendar.accounting')}</p>
              </div>
            </div>
            {editItem.item.related_ref ? (
              <p className="text-xs text-gray-500">{editItem.item.related_ref}</p>
            ) : null}
            <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
              {t('pms.fin.paymentCalendar.accountingReadOnly')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label">{t('pms.fin.paymentCalendar.title')} *</label>
              <input
                className="input"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('pms.fin.paymentCalendar.amount')}</label>
                <input
                  type="number"
                  className="input"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">{t('pms.fin.paymentCalendar.dueDate')} *</label>
                <input
                  type="date"
                  className="input"
                  value={form.due_date}
                  onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">{t('pms.fin.paymentCalendar.direction')}</label>
                <select
                  className="input"
                  value={form.direction}
                  onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}
                >
                  <option value="out">{t('pms.fin.paymentCalendar.directionOut')}</option>
                  <option value="in">{t('pms.fin.paymentCalendar.directionIn')}</option>
                </select>
              </div>
              <div>
                <label className="label">{t('pms.fin.paymentCalendar.statusLabel')}</label>
                <select
                  className="input"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                >
                  <option value="pending">{t('pms.fin.paymentCalendar.status.pending')}</option>
                  <option value="paid">{t('pms.fin.paymentCalendar.status.paid')}</option>
                  <option value="cancelled">{t('pms.fin.paymentCalendar.status.cancelled')}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">{t('pms.fin.paymentCalendar.accountCode')}</label>
              <input
                className="input"
                value={form.account_code}
                onChange={(e) => setForm((f) => ({ ...f, account_code: e.target.value }))}
                placeholder="e.g. 604000"
              />
            </div>
            <div>
              <label className="label">{t('pms.fin.paymentCalendar.notes')}</label>
              <textarea
                className="input min-h-[80px]"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function CheckinAuditTool() {
  const { t } = useFinLocale();
  const defaults = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const iso = (d) => d.toISOString().slice(0, 10);
    return { from: iso(from), to: iso(to) };
  }, []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [detailId, setDetailId] = useState(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['financial-system-checkin-audit', from, to],
    queryFn: () =>
      api.get('/financial-system/checkin-audit', { params: { from, to } }).then((r) => r.data),
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['financial-system-checkin-audit-detail', detailId],
    queryFn: () => api.get(`/financial-system/checkin-audit/${detailId}`).then((r) => r.data),
    enabled: Boolean(detailId),
  });

  if (isLoading) return <LoadingSpinner />;
  const summary = data?.summary || {};
  const rows = data?.rows || [];

  const actionLabel = (action) => {
    const map = {
      OPS_COLLECT_CHECKIN: t('pms.fin.checkinAudit.eventCollect'),
      OPS_HANDOVER_CHECKIN: t('pms.fin.checkinAudit.eventHandover'),
      OPS_EDIT_CHECKIN_BILL: t('pms.fin.checkinAudit.eventBillEdit'),
      OPS_ASSIGN_CHECKIN: t('pms.fin.checkinAudit.eventAssign'),
      CREATE_PAYMENT: t('pms.fin.checkinAudit.eventPayment'),
      APPROVE_PAYMENT: t('pms.fin.checkinAudit.eventApprove'),
      RECORD_PAYMENT: t('pms.fin.checkinAudit.eventPayment'),
    };
    return map[action] || action;
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 max-w-3xl">{t('pms.fin.checkinAudit.description')}</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-ch-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.checkinAudit.checkins')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{summary.checkin_count || 0}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-xs text-emerald-800">{t('pms.fin.checkinAudit.doorCollected')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{currency(summary.money_collected_total)}</p>
        </div>
        <div className="rounded-2xl border border-ch-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.checkinAudit.totalPaid')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{currency(summary.amount_paid_total)}</p>
        </div>
        <div className="rounded-2xl border border-ch-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.checkinAudit.handedOver')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{summary.handed_over_count || 0}</p>
        </div>
      </div>

      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[10px] uppercase text-gray-500">{t('pms.fin.checkinAudit.from')}</label>
          <input
            type="date"
            className="input text-sm py-1.5 mt-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-gray-500">{t('pms.fin.checkinAudit.to')}</label>
          <input
            type="date"
            className="input text-sm py-1.5 mt-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <button type="button" className="btn-secondary text-sm" onClick={() => refetch()} disabled={isFetching}>
          {t('pms.fin.checkinAudit.refresh')}
        </button>
        <div className="text-xs text-gray-500 pb-2">
          {rows.length} {t('pms.fin.checkinAudit.records')}
        </div>
      </div>

      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.aging.checkIn')}</th>
                <th>{t('pms.fin.aging.guest')}</th>
                <th>{t('pms.fin.aging.unit')}</th>
                <th className="text-right">{t('pms.fin.checkinAudit.bill')}</th>
                <th className="text-right">{t('pms.fin.checkinAudit.collected')}</th>
                <th className="text-right">{t('pms.fin.checkinAudit.paid')}</th>
                <th>{t('pms.fin.checkinAudit.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-8">
                    {t('pms.fin.checkinAudit.noRows')}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.reservation_id}>
                    <td className="whitespace-nowrap">
                      <p className="font-medium">{formatDate(r.check_in)}</p>
                      <p className="text-[11px] text-gray-400">→ {formatDate(r.check_out)}</p>
                    </td>
                    <td>
                      <p className="font-medium">{r.guest_name || '—'}</p>
                      {r.guest_phone ? <p className="text-xs text-gray-400">{r.guest_phone}</p> : null}
                    </td>
                    <td>
                      <p>{r.unit_name}</p>
                      {r.project ? <p className="text-xs text-gray-400">{r.project}</p> : null}
                    </td>
                    <td className="text-right tabular-nums font-medium">{currency(r.total_amount)}</td>
                    <td className="text-right tabular-nums">
                      <p className="font-medium text-emerald-800">{currency(r.ops_money_collected_amount)}</p>
                      {r.ops_money_collected_by_name ? (
                        <p className="text-[11px] text-gray-400">{r.ops_money_collected_by_name}</p>
                      ) : null}
                    </td>
                    <td className="text-right tabular-nums">{currency(r.amount_paid)}</td>
                    <td>
                      {r.ops_handed_over ? (
                        <span className="text-emerald-700 text-xs font-semibold">
                          {t('pms.fin.checkinAudit.handedOverBadge')}
                        </span>
                      ) : r.ops_money_collected ? (
                        <span className="text-amber-700 text-xs font-semibold">
                          {t('pms.fin.checkinAudit.collectedBadge')}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">{r.payment_status || '—'}</span>
                      )}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-secondary text-xs py-1 px-2"
                        onClick={() => setDetailId(r.reservation_id)}
                      >
                        {t('pms.fin.checkinAudit.viewTrail')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={
          detail
            ? t('pms.fin.checkinAudit.detailTitle', { id: detail.reservation_id })
            : t('pms.fin.checkinAudit.viewTrail')
        }
        size="lg"
      >
        {detailLoading || !detail ? (
          <LoadingSpinner />
        ) : (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.aging.guest')}</p>
                <p className="font-semibold">{detail.guest_name || '—'}</p>
                <p className="text-xs text-gray-500">{detail.guest_phone || ''}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.aging.unit')}</p>
                <p className="font-semibold">{detail.unit_name}</p>
                <p className="text-xs text-gray-500">{detail.project || ''}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.aging.checkIn')}</p>
                <p>{formatDate(detail.check_in)} → {formatDate(detail.check_out)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.checkinAudit.opsAgent')}</p>
                <p>{detail.ops_assignee_name || '—'}</p>
              </div>
            </div>

            <div className="rounded-xl border border-ch-line bg-slate-50/80 p-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div>
                <p className="text-[11px] text-gray-400">{t('pms.fin.checkinAudit.bill')}</p>
                <p className="font-semibold tabular-nums">{currency(detail.total_amount)}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400">{t('pms.fin.checkinAudit.collected')}</p>
                <p className="font-semibold tabular-nums text-emerald-800">
                  {currency(detail.ops_money_collected_amount)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400">{t('pms.fin.checkinAudit.paid')}</p>
                <p className="font-semibold tabular-nums">{currency(detail.amount_paid)}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400">{t('pms.fin.checkinAudit.accommodation')}</p>
                <p className="tabular-nums">{currency(detail.accommodation)}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400">{t('pms.fin.checkinAudit.housekeeping')}</p>
                <p className="tabular-nums">{currency(detail.housekeeping_fees)}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400">{t('pms.fin.checkinAudit.insurance')}</p>
                <p className="tabular-nums">{currency(detail.insurance)}</p>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-ch-pine mb-2">{t('pms.fin.checkinAudit.payments')}</h4>
              {!detail.payments?.length ? (
                <p className="text-gray-400 text-xs">{t('pms.fin.checkinAudit.noPayments')}</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-ch-line">
                  <table className="table text-xs">
                    <thead>
                      <tr>
                        <th>{t('pms.fin.checkinAudit.when')}</th>
                        <th>{t('pms.fin.checkinAudit.method')}</th>
                        <th className="text-right">{t('pms.fin.checkinAudit.amount')}</th>
                        <th>{t('pms.fin.checkinAudit.status')}</th>
                        <th>{t('pms.fin.checkinAudit.by')}</th>
                        <th>{t('pms.fin.checkinAudit.notes')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.payments.map((p) => (
                        <tr key={p.id}>
                          <td className="whitespace-nowrap">
                            {formatDateTime(p.paid_at || p.payment_date || p.created_at)}
                          </td>
                          <td>{p.payment_method || '—'}</td>
                          <td className="text-right tabular-nums font-medium">{currency(p.amount)}</td>
                          <td>{p.status || '—'}</td>
                          <td>{p.created_by_name || '—'}</td>
                          <td className="max-w-[12rem] truncate" title={p.notes || ''}>
                            {p.notes || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h4 className="font-semibold text-ch-pine mb-2">{t('pms.fin.checkinAudit.timeline')}</h4>
              {!detail.events?.length ? (
                <p className="text-gray-400 text-xs">{t('pms.fin.checkinAudit.noEvents')}</p>
              ) : (
                <ul className="space-y-2">
                  {detail.events.map((e) => (
                    <li
                      key={e.id}
                      className="rounded-lg border border-ch-line bg-white px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-ch-pine">{actionLabel(e.action)}</span>
                        <span className="text-[11px] text-gray-400">
                          {formatDateTime(e.created_at)}
                          {e.actor_name ? ` · ${e.actor_name}` : ''}
                        </span>
                      </div>
                      {e.details && typeof e.details === 'object' && Object.keys(e.details).length ? (
                        <pre className="mt-1 text-[11px] text-gray-500 whitespace-pre-wrap break-all">
                          {JSON.stringify(e.details, null, 0)}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function InsuranceRefundsTool({ onOpenAccount }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [filter, setFilter] = useState('due');
  const [settleRow, setSettleRow] = useState(null);
  const [refundedAmount, setRefundedAmount] = useState('');
  const [damageAmount, setDamageAmount] = useState('0');
  const [method, setMethod] = useState('cash');
  const [notes, setNotes] = useState('');
  const [refundDate, setRefundDate] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-insurance', filter],
    queryFn: () =>
      api.get('/financial-system/insurance-refunds', { params: { filter } }).then((r) => r.data),
  });

  const settle = useMutation({
    mutationFn: ({ id, body }) => api.post(`/financial-system/insurance-refunds/${id}/settle`, body),
    onSuccess: () => {
      toast.success(t('pms.fin.insurance.settledToast'));
      setSettleRow(null);
      qc.invalidateQueries({ queryKey: ['financial-system-insurance'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.owners.failedToSettle')),
  });

  function openSettle(row) {
    const held = Number(row.insurance) || 0;
    setSettleRow(row);
    setRefundedAmount(String(held));
    setDamageAmount('0');
    setMethod('cash');
    setNotes('');
    setRefundDate(row.check_out || new Date().toISOString().slice(0, 10));
  }

  function onDamageChange(value) {
    setDamageAmount(value);
    if (!settleRow) return;
    const held = Number(settleRow.insurance) || 0;
    const dmg = Math.max(0, parseFloat(value) || 0);
    setRefundedAmount(String(Math.max(0, Math.round((held - dmg) * 100) / 100)));
  }

  function onRefundChange(value) {
    setRefundedAmount(value);
    if (!settleRow) return;
    const held = Number(settleRow.insurance) || 0;
    const ref = Math.max(0, parseFloat(value) || 0);
    setDamageAmount(String(Math.max(0, Math.round((held - ref) * 100) / 100)));
  }

  if (isLoading) return <LoadingSpinner />;
  const summary = data?.summary || {};
  const rows = data?.rows || [];
  const filters = [
    { id: 'due', label: t('pms.fin.insurance.dueNow') },
    { id: 'upcoming', label: t('pms.fin.insurance.upcoming') },
    { id: 'settled', label: t('pms.fin.insurance.settledFilter') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-gray-500 max-w-2xl">
          {t('pms.fin.insurance.description', { code: data?.account?.code || '204000', damageCode: data?.damage_account?.code || '410000' })}
        </p>
        <button type="button" className="btn-secondary text-sm" onClick={() => onOpenAccount('204000')}>
          {t('pms.fin.insurance.openAccount')}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-xs text-amber-800">{t('pms.fin.insurance.dueToRefund')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{currency(summary.due_amount)}</p>
          <p className="text-xs text-gray-500">{t('pms.fin.stays', { count: summary.due_count || 0 })}</p>
        </div>
        <div className="rounded-2xl border border-ch-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.insurance.upcomingCheckouts')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{currency(summary.upcoming_amount)}</p>
          <p className="text-xs text-gray-500">{t('pms.fin.stays', { count: summary.upcoming_count || 0 })}</p>
        </div>
        <div className="rounded-2xl border border-ch-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.insurance.openEscrow')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{currency(summary.escrow_open)}</p>
          <p className="text-xs text-gray-500">{t('pms.fin.insurance.heldAfterCheckIn')}</p>
        </div>
        <div className="rounded-2xl border border-ch-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.insurance.settledRecords')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{summary.settled_count || 0}</p>
          <p className="text-xs text-gray-500">{t('pms.fin.insurance.fullPartialForfeited')}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-full text-sm border ${
              filter === f.id
                ? 'bg-ch-pine text-white border-ch-pine'
                : 'bg-white border-ch-line text-gray-700 hover:bg-ch-pine-50/40'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.aging.guest')}</th>
                <th>{t('pms.fin.aging.unit')}</th>
                <th>{t('pms.fin.aging.checkIn')}</th>
                <th>{t('pms.fin.insurance.checkout')}</th>
                <th className="text-right">{t('pms.fin.insurance.insuranceCol')}</th>
                <th>{t('pms.fin.insurance.statusCol')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-gray-400 py-8">
                    {t('pms.fin.insurance.noRows')}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.reservation_id}>
                    <td>
                      <p className="font-medium">{r.guest_name || '—'}</p>
                      {r.guest_phone ? <p className="text-xs text-gray-400">{r.guest_phone}</p> : null}
                    </td>
                    <td>
                      <p>{r.unit_name}</p>
                      {r.project ? <p className="text-xs text-gray-400">{r.project}</p> : null}
                    </td>
                    <td>{formatDate(r.check_in)}</td>
                    <td>{formatDate(r.check_out)}</td>
                    <td className="text-right tabular-nums font-medium">{currency(r.insurance)}</td>
                    <td className="capitalize">
                      {r.insurance_refund_status === 'pending' ? (
                        <span className="text-amber-700">{t('pms.fin.insurance.pendingRefund')}</span>
                      ) : r.insurance_refund_status === 'partial' ? (
                        <span className="text-sky-700">
                          {t('pms.fin.insurance.partial', { amount: currency(r.insurance_refunded_amount) })}
                        </span>
                      ) : r.insurance_refund_status === 'forfeited' ? (
                        <span className="text-rose-700">{t('pms.fin.insurance.forfeited')}</span>
                      ) : (
                        <span className="text-emerald-700">{t('pms.fin.insurance.refunded')}</span>
                      )}
                    </td>
                    <td className="text-right">
                      {r.insurance_refund_status === 'pending' ? (
                        <button
                          type="button"
                          className="btn-secondary text-xs py-1 px-2"
                          onClick={() => openSettle(r)}
                        >
                          {t('pms.fin.insurance.settleRefund')}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">
                          {r.insurance_damage_amount > 0
                            ? t('pms.fin.insurance.damage', { amount: currency(r.insurance_damage_amount) })
                            : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={Boolean(settleRow)}
        onClose={() => setSettleRow(null)}
        title={t('pms.fin.insurance.settleModalTitle')}
      >
        {settleRow ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {t('pms.fin.insurance.guestStayCheckout', { guest: settleRow.guest_name, unit: settleRow.unit_name, date: formatDate(settleRow.check_out) })}
            </p>
            <p className="text-sm">
              {t('pms.fin.insurance.heldInsurance', { amount: currency(settleRow.insurance) })}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">{t('pms.fin.insurance.refundToGuest')}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  value={refundedAmount}
                  onChange={(e) => onRefundChange(e.target.value)}
                />
              </div>
              <div>
                <label className="label">{t('pms.fin.insurance.damageRetained')}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  value={damageAmount}
                  onChange={(e) => onDamageChange(e.target.value)}
                />
              </div>
              <div>
                <label className="label">{t('pms.fin.insurance.refundMethod')}</label>
                <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="cash">{t('pms.fin.insurance.cashMethod')}</option>
                  <option value="instapay">{t('pms.fin.insurance.instapayMethod')}</option>
                  <option value="bank_transfer">{t('pms.fin.insurance.bankTransferMethod')}</option>
                  <option value="credit_card">{t('pms.fin.insurance.cardMethod')}</option>
                </select>
              </div>
              <div>
                <label className="label">{t('pms.fin.insurance.refundDate')}</label>
                <input
                  type="date"
                  className="input"
                  value={refundDate}
                  onChange={(e) => setRefundDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="label">{t('pms.fin.notesOptional')}</label>
              <textarea
                className="input min-h-[80px]"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('pms.fin.insurance.damagePlaceholder')}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setSettleRow(null)}>
                {t('pms.fin.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={settle.isPending}
                onClick={() =>
                  settle.mutate({
                    id: settleRow.reservation_id,
                    body: {
                      refunded_amount: parseFloat(refundedAmount) || 0,
                      damage_amount: parseFloat(damageAmount) || 0,
                      payment_method: method,
                      refunded_at: refundDate,
                      notes: notes || undefined,
                    },
                  })
                }
              >
                {t('pms.fin.insurance.confirmSettle')}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function CloseTool({ toDate }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const defaultMonth = (toDate || new Date().toISOString().slice(0, 10)).slice(0, 7);
  const [month, setMonth] = useState(defaultMonth);
  const { data = [], isLoading } = useQuery({
    queryKey: ['financial-system-periods'],
    queryFn: () => api.get('/financial-system/periods').then((r) => r.data),
  });
  const { data: checklistData, isLoading: clLoading } = useQuery({
    queryKey: ['financial-system-checklist', month],
    queryFn: () => api.get(`/financial-system/close-checklist/${month}`).then((r) => r.data),
    enabled: Boolean(month),
  });
  const updateItem = useMutation({
    mutationFn: ({ itemId, body }) => api.post(`/financial-system/close-checklist/${month}/${itemId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['financial-system-checklist', month] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const close = useMutation({
    mutationFn: (yearMonth) => api.post(`/financial-system/periods/${yearMonth}/close`),
    onSuccess: () => {
      toast.success(t('pms.fin.close.monthClosed'));
      qc.invalidateQueries({ queryKey: ['financial-system-periods'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
      qc.invalidateQueries({ queryKey: ['financial-system-reports'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const reopen = useMutation({
    mutationFn: (yearMonth) => api.delete(`/financial-system/periods/${yearMonth}/close`),
    onSuccess: () => {
      toast.success(t('pms.fin.close.monthReopened'));
      qc.invalidateQueries({ queryKey: ['financial-system-periods'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  const [notesItem, setNotesItem] = useState(null);
  const [notesText, setNotesText] = useState('');

  if (isLoading) return <LoadingSpinner />;

  const items = checklistData?.items || [];
  const requiredItems = items.filter((i) => i.required_before_close);
  const doneRequired = requiredItems.filter((i) => i.status === 'done' || i.status === 'skipped');
  const allRequiredDone = requiredItems.length > 0 && doneRequired.length >= requiredItems.length;
  const progress = requiredItems.length > 0 ? Math.round((doneRequired.length / requiredItems.length) * 100) : 0;

  const statusColors = {
    pending: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-amber-100 text-amber-800',
    done: 'bg-emerald-100 text-emerald-800',
    skipped: 'bg-slate-100 text-slate-600',
  };
  const nextStatus = { pending: 'in_progress', in_progress: 'done', done: 'pending', skipped: 'pending' };
  const roleColors = {
    finance: 'text-sky-700',
    finance_manager: 'text-violet-700',
    admin: 'text-rose-700',
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {t('pms.fin.close.description')}
      </p>
      <div className="rounded-2xl border border-ch-line bg-white p-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">{t('pms.fin.close.month')}</label>
          <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
      </div>

      {/* Checklist section */}
      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">{t('pms.fin.close.checklist', { month })}</h3>
              <p className="text-xs text-gray-500 mt-1">{t('pms.fin.close.checklistHint')}</p>
            </div>
            <span className="text-sm font-semibold tabular-nums">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 mt-3">
            <div
              className={`h-2 rounded-full transition-all ${allRequiredDone ? 'bg-emerald-500' : 'bg-ch-pine'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        {clLoading ? (
          <div className="p-8"><LoadingSpinner /></div>
        ) : (
          <div className="divide-y divide-ch-line">
            {items.map((item) => (
              <div key={item.id} className="px-6 py-3 flex items-start gap-4">
                <button
                  type="button"
                  className="mt-1 flex-shrink-0"
                  onClick={() => updateItem.mutate({ itemId: item.id, body: { status: nextStatus[item.status] || 'pending' } })}
                >
                  {item.status === 'done' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  ) : (
                    <div className={`w-5 h-5 rounded-full border-2 ${item.status === 'in_progress' ? 'border-amber-500 bg-amber-100' : 'border-gray-300'}`} />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 tabular-nums w-5">{item.task_order || ''}</span>
                    <p className={`text-sm font-medium ${item.status === 'done' ? 'line-through text-gray-400' : ''}`}>{item.title}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusColors[item.status]}`}>{item.status}</span>
                    {item.required_before_close && <span className="text-[10px] text-rose-500">{t('pms.fin.close.required')}</span>}
                  </div>
                  {item.description && <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>}
                  {item.owner_role && <p className={`text-[11px] mt-0.5 ${roleColors[item.owner_role] || 'text-gray-500'}`}>{item.owner_role}</p>}
                  {item.evidence_notes && <p className="text-xs text-emerald-700 mt-1 italic">{item.evidence_notes}</p>}
                </div>
                <button
                  type="button"
                  className="text-xs text-ch-pine hover:underline flex-shrink-0"
                  onClick={() => { setNotesItem(item); setNotesText(item.evidence_notes || ''); }}
                >
                  {t('pms.fin.close.evidenceNotes')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-ch-line bg-white p-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={close.isPending || !allRequiredDone}
          onClick={() => close.mutate(month)}
          title={!allRequiredDone ? t('pms.fin.close.completeRequiredTooltip') : ''}
        >
          <Lock className="w-4 h-4" /> {t('pms.fin.close.closeMonth')}
        </button>
        {!allRequiredDone && <span className="text-xs text-amber-700">{t('pms.fin.close.completeRequired')}</span>}
      </div>

      {/* Closed periods table */}
      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <table className="table text-sm">
          <thead>
            <tr>
              <th>{t('pms.fin.close.thMonth')}</th>
              <th className="text-right">{t('pms.fin.close.thPnlTransferred')}</th>
              <th>{t('pms.fin.close.thClosedBy')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(Array.isArray(data) ? data : []).map((row) => (
              <tr key={row.year_month}>
                <td className="font-medium">{row.year_month}</td>
                <td className="text-right tabular-nums">{currency(row.pnl_amount)}</td>
                <td>{row.closed_by_name || '—'}</td>
                <td className="text-right">
                  <button type="button" className="text-xs text-amber-700 inline-flex items-center gap-1" onClick={() => reopen.mutate(row.year_month)}>
                    <Unlock className="w-3 h-3" /> {t('pms.fin.close.reopen')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Evidence notes modal */}
      <Modal open={Boolean(notesItem)} onClose={() => setNotesItem(null)} title={t('pms.fin.close.evidenceNotesTitle')} size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setNotesItem(null)}>{t('pms.fin.cancel')}</button>
            <button type="button" className="btn-primary" disabled={updateItem.isPending}
              onClick={() => { updateItem.mutate({ itemId: notesItem.id, body: { evidence_notes: notesText } }); setNotesItem(null); }}>
              {t('pms.fin.save')}
            </button>
          </>
        }
      >
        <textarea className="input w-full min-h-[120px]" value={notesText} onChange={(e) => setNotesText(e.target.value)}
          placeholder={t('pms.fin.close.evidencePlaceholder')} />
      </Modal>
    </div>
  );
}

function SegmentPnlTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-segment-pnl', params],
    queryFn: () => api.get('/financial-system/segment-pnl', { params }).then((r) => r.data),
  });
  if (isLoading) return <LoadingSpinner />;
  const segments = data?.segments || [];
  const consolidated = data?.consolidated || {};

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {t('pms.fin.segment.description')}
      </p>
      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.segment.project')}</th>
                <th className="text-right">{t('pms.fin.segment.grossRevenue')}</th>
                <th className="text-right">{t('pms.fin.segment.ownerShare')}</th>
                <th className="text-right">{t('pms.fin.segment.netRevenue')}</th>
                <th className="text-right">{t('pms.fin.segment.directCosts')}</th>
                <th className="text-right">{t('pms.fin.segment.opexAlloc')}</th>
                <th className="text-right">{t('pms.fin.segment.netProfit')}</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.project}>
                  <td className="font-medium">{s.project}</td>
                  <td className="text-right tabular-nums">{currency(s.gross_revenue)}</td>
                  <td className="text-right tabular-nums">{currency(s.owner_share)}</td>
                  <td className="text-right tabular-nums">{currency(s.net_revenue)}</td>
                  <td className="text-right tabular-nums">{currency(s.direct_costs)}</td>
                  <td className="text-right tabular-nums">{currency(s.opex_allocation)}</td>
                  <td className={`text-right tabular-nums font-bold ${s.net_profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {currency(s.net_profit)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td>{consolidated.project}</td>
                <td className="text-right tabular-nums">{currency(consolidated.gross_revenue)}</td>
                <td className="text-right tabular-nums">{currency(consolidated.owner_share)}</td>
                <td className="text-right tabular-nums">{currency(consolidated.net_revenue)}</td>
                <td className="text-right tabular-nums">{currency(consolidated.direct_costs)}</td>
                <td className="text-right tabular-nums">{currency(consolidated.opex_allocation)}</td>
                <td className={`text-right tabular-nums font-bold ${(consolidated.net_profit || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {currency(consolidated.net_profit)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function CashForecastTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-cash-forecast', params],
    queryFn: () => api.get('/financial-system/cash-forecast', { params }).then((r) => r.data),
  });
  const [editWeek, setEditWeek] = useState(null);
  const [editForm, setEditForm] = useState({ category: 'collections', amount: '', notes: '' });

  const addEntry = useMutation({
    mutationFn: (payload) => api.post('/financial-system/cash-forecast', payload),
    onSuccess: () => {
      toast.success(t('pms.fin.forecast.entryAdded'));
      qc.invalidateQueries({ queryKey: ['financial-system-cash-forecast'] });
      setEditWeek(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const removeEntry = useMutation({
    mutationFn: (id) => api.delete(`/financial-system/cash-forecast/${id}`),
    onSuccess: () => {
      toast.success(t('pms.fin.forecast.entryRemoved'));
      qc.invalidateQueries({ queryKey: ['financial-system-cash-forecast'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  if (isLoading) return <LoadingSpinner />;
  const weeks = data?.weeks || [];
  const startingBalance = data?.starting_balance || 0;

  const categories = [
    { value: 'collections', label: t('pms.fin.forecast.collections') },
    { value: 'owner_payouts', label: t('pms.fin.forecast.ownerPayouts') },
    { value: 'vendor_payments', label: t('pms.fin.forecast.vendorPayments') },
    { value: 'recurring', label: t('pms.fin.forecast.recurring') },
    { value: 'payroll', label: t('pms.fin.forecast.payroll') },
    { value: 'tax', label: t('pms.fin.forecast.taxCol') },
    { value: 'other_in', label: t('pms.fin.forecast.otherIn') },
    { value: 'other_out', label: t('pms.fin.forecast.otherOut') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-gray-500">
          {t('pms.fin.forecast.description', { balance: currency(startingBalance) })}
        </p>
      </div>
      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.forecast.week')}</th>
                <th className="text-right">{t('pms.fin.forecast.collections')}</th>
                <th className="text-right">{t('pms.fin.forecast.ownerPayouts')}</th>
                <th className="text-right">{t('pms.fin.forecast.vendor')}</th>
                <th className="text-right">{t('pms.fin.forecast.recurring')}</th>
                <th className="text-right">{t('pms.fin.forecast.payroll')}</th>
                <th className="text-right">{t('pms.fin.forecast.taxCol')}</th>
                <th className="text-right">{t('pms.fin.forecast.other')}</th>
                <th className="text-right">{t('pms.fin.forecast.netFlow')}</th>
                <th className="text-right">{t('pms.fin.forecast.cumulative')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {weeks.map((w, i) => (
                <tr key={w.week_start} className={w.cumulative_balance < 0 ? 'bg-rose-50' : ''}>
                  <td className="font-medium text-xs whitespace-nowrap">{w.week_start}</td>
                  <td className="text-right tabular-nums text-emerald-700">{currency(w.collections)}</td>
                  <td className="text-right tabular-nums">{currency(w.owner_payouts)}</td>
                  <td className="text-right tabular-nums">{currency(w.vendor_payments)}</td>
                  <td className="text-right tabular-nums">{currency(w.recurring)}</td>
                  <td className="text-right tabular-nums">{currency(w.payroll)}</td>
                  <td className="text-right tabular-nums">{currency(w.tax)}</td>
                  <td className="text-right tabular-nums">{w.other_in > 0 ? `+${currency(w.other_in)}` : ''}{w.other_out > 0 ? ` −${currency(w.other_out)}` : ''}</td>
                  <td className={`text-right tabular-nums font-semibold ${w.net_flow >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {currency(w.net_flow)}
                  </td>
                  <td className={`text-right tabular-nums font-bold ${w.cumulative_balance >= 0 ? '' : 'text-rose-700'}`}>
                    {currency(w.cumulative_balance)}
                  </td>
                  <td className="text-right">
                    <button type="button" className="text-xs text-ch-pine" onClick={() => { setEditWeek(w.week_start); setEditForm({ category: 'collections', amount: '', notes: '' }); }}>
                      <Plus className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={Boolean(editWeek)} onClose={() => setEditWeek(null)} title={t('pms.fin.forecast.addForecast', { week: editWeek })} size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditWeek(null)}>{t('pms.fin.cancel')}</button>
            <button type="button" className="btn-primary" disabled={addEntry.isPending}
              onClick={() => addEntry.mutate({ week_start: editWeek, category: editForm.category, amount: parseFloat(editForm.amount), notes: editForm.notes || undefined })}>
              {t('pms.fin.forecast.add')}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <select className="input w-full" value={editForm.category} onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <input type="number" className="input w-full" placeholder={t('pms.fin.amount')} value={editForm.amount} onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))} />
          <input className="input w-full" placeholder={t('pms.fin.notes')} value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>
      </Modal>
    </div>
  );
}

function GatewayTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [mdr, setMdr] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-gateway', params],
    queryFn: () => api.get('/financial-system/gateway', { params }).then((r) => r.data),
  });
  const save = useMutation({
    mutationFn: (value_num) => api.put('/financial-system/settings/gateway_mdr_pct', { value_num }),
    onSuccess: () => {
      toast.success(t('pms.fin.gateway.mdrSaved'));
      qc.invalidateQueries({ queryKey: ['financial-system-gateway'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  if (isLoading) return <LoadingSpinner />;
  const pct = mdr === '' ? data?.mdr_pct : mdr;
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {t('pms.fin.gateway.description')}
      </p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          [t('pms.fin.gateway.clearingIn'), data?.clearing_in],
          [t('pms.fin.gateway.settledToBank'), data?.settled_net],
          [t('pms.fin.gateway.mdrExpense'), data?.mdr_expense],
          [t('pms.fin.gateway.stillUncleared'), data?.uncleared],
        ].map(([label, amt]) => (
          <div key={label} className="rounded-2xl border border-ch-line bg-white p-4">
            <p className="text-xs text-gray-400">{label}</p>
            <p className="text-xl font-bold tabular-nums mt-1">{currency(amt)}</p>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-ch-line bg-white p-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">{t('pms.fin.gateway.gatewayMdr')}</label>
          <input type="number" min="0" step="0.1" className="input w-32" value={pct} onChange={(e) => setMdr(e.target.value)} />
        </div>
        <button type="button" className="btn-primary" disabled={save.isPending} onClick={() => save.mutate(pct)}>
          {t('pms.fin.gateway.saveMdr')}
        </button>
      </div>
    </div>
  );
}

function BankRecTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [account, setAccount] = useState('101000');
  const [snap, setSnap] = useState({ statement_date: new Date().toISOString().slice(0, 10), statement_balance: '' });
  const q = { ...params, account };
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-bank', q],
    queryFn: () => api.get('/financial-system/bank-rec', { params: q }).then((r) => r.data),
  });
  const toggle = useMutation({
    mutationFn: (row) => api.post('/financial-system/bank-rec/toggle', { entry_id: row.id, account_code: account }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['financial-system-bank'] }),
  });
  const saveSnap = useMutation({
    mutationFn: () =>
      api.post('/financial-system/bank-rec/snapshot', {
        account_code: account,
        statement_date: snap.statement_date,
        statement_balance: parseFloat(snap.statement_balance),
      }),
    onSuccess: () => {
      toast.success(t('pms.fin.bank.statementSaved'));
      qc.invalidateQueries({ queryKey: ['financial-system-bank'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  if (isLoading) return <LoadingSpinner />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {['101000', '102000', '103000', '104000'].map((code) => (
          <button
            key={code}
            type="button"
            className={`px-3 py-1.5 rounded-full text-sm ${account === code ? 'bg-ch-pine text-white' : 'bg-white border'}`}
            onClick={() => setAccount(code)}
          >
            {code}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-2xl border bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.bank.bookBalance')}</p>
          <p className="text-xl font-bold tabular-nums">{currency(data?.account?.balance)}</p>
        </div>
        <div className="rounded-2xl border bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.bank.unreconciledMovement')}</p>
          <p className="text-xl font-bold tabular-nums">{currency(data?.unreconciled)}</p>
        </div>
        <div className="rounded-2xl border bg-white p-4 space-y-2">
          <p className="text-xs text-gray-400">{t('pms.fin.bank.bankStatementSnapshot')}</p>
          <input type="date" className="input w-full" value={snap.statement_date} onChange={(e) => setSnap((s) => ({ ...s, statement_date: e.target.value }))} />
          <input type="number" className="input w-full" placeholder={t('pms.fin.bank.statementBalance')} value={snap.statement_balance} onChange={(e) => setSnap((s) => ({ ...s, statement_balance: e.target.value }))} />
          <button type="button" className="btn-secondary w-full text-sm" onClick={() => saveSnap.mutate()}>{t('pms.fin.bank.saveSnapshot')}</button>
        </div>
      </div>
      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <table className="table text-sm">
          <thead>
            <tr>
              <th />
              <th>{t('pms.fin.bank.date')}</th>
              <th>{t('pms.fin.description')}</th>
              <th className="text-right">{t('pms.fin.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.lines || []).map((row) => (
              <tr key={`${row.id}-${row.side}`} className={row.reconciled ? 'bg-emerald-50/40' : ''}>
                <td>
                  <input type="checkbox" checked={Boolean(row.reconciled)} onChange={() => toggle.mutate(row)} />
                </td>
                <td>{formatDate(row.date)}</td>
                <td>{row.description}</td>
                <td className="text-right tabular-nums">
                  {row.side === 'debit' ? '+' : '−'}
                  {currency(row.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OwnerTrustTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [form, setForm] = useState({ owner_id: '', amount: '', reason: '' });
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-trust', params],
    queryFn: () => api.get('/financial-system/owner-trust', { params }).then((r) => r.data),
  });
  const { data: owners = [] } = useQuery({
    queryKey: ['users-owners'],
    queryFn: () => api.get('/users/owners').then((r) => r.data),
  });
  const addHb = useMutation({
    mutationFn: (payload) => api.post('/financial-system/holdbacks', payload),
    onSuccess: () => {
      toast.success(t('pms.fin.trust.holdbackRecorded'));
      qc.invalidateQueries({ queryKey: ['financial-system-trust'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const release = useMutation({
    mutationFn: (id) => api.post(`/financial-system/holdbacks/${id}/release`),
    onSuccess: () => {
      toast.success(t('pms.fin.trust.holdbackReleased'));
      qc.invalidateQueries({ queryKey: ['financial-system-trust'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
  });
  if (isLoading) return <LoadingSpinner />;
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-ch-line bg-white p-5 flex flex-wrap gap-6">
        <div>
          <p className="text-xs text-gray-400">{t('pms.fin.trust.controlAccount')}</p>
          <p className="text-2xl font-bold tabular-nums">{currency(data?.control_202000)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">{t('pms.fin.trust.subLedgerTied')}</p>
          <p className="text-2xl font-bold">{data?.tied ? t('pms.fin.trust.yes') : t('pms.fin.trust.check')}</p>
        </div>
      </div>
      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <div className="px-6 py-3 border-b font-semibold">{t('pms.fin.trust.ownerTrustSubLedger')}</div>
        <table className="table text-sm">
          <thead>
            <tr>
              <th>{t('pms.fin.trust.owner')}</th>
              <th className="text-right">{t('pms.fin.trust.credits')}</th>
              <th className="text-right">{t('pms.fin.trust.payouts')}</th>
              <th className="text-right">{t('pms.fin.trust.holdbacks')}</th>
              <th className="text-right">{t('pms.fin.trust.charges')}</th>
              <th className="text-right">{t('pms.fin.balance')}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.owners || []).map((o) => (
              <tr key={o.owner_id || o.owner_name}>
                <td>{o.owner_name}</td>
                <td className="text-right tabular-nums">{currency(o.credits)}</td>
                <td className="text-right tabular-nums">{currency(o.payouts)}</td>
                <td className="text-right tabular-nums">{currency(o.holdbacks)}</td>
                <td className="text-right tabular-nums">{currency(o.expenses)}</td>
                <td className="text-right tabular-nums font-bold">{currency(o.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-2xl border border-ch-line bg-white p-5 space-y-3">
        <h3 className="font-semibold">{t('pms.fin.trust.holdBackTitle')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <SearchableSelect
            className="w-full"
            value={form.owner_id}
            onChange={(v) => setForm((f) => ({ ...f, owner_id: v }))}
            placeholder={t('pms.fin.trust.ownerPlaceholder')}
            options={(Array.isArray(owners) ? owners : []).map((o) => ({
              value: String(o.id),
              label: o.full_name || o.name,
            }))}
          />
          <input type="number" className="input" placeholder={t('pms.fin.amount')} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          <input className="input" placeholder={t('pms.fin.trust.reason')} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          <button
            type="button"
            className="btn-primary"
            disabled={addHb.isPending}
            onClick={() => addHb.mutate({ owner_id: parseInt(form.owner_id, 10), amount: parseFloat(form.amount), reason: form.reason })}
          >
            {t('pms.fin.trust.holdBack')}
          </button>
        </div>
        <table className="table text-sm">
          <thead>
            <tr>
              <th>{t('pms.fin.trust.owner')}</th>
              <th className="text-right">{t('pms.fin.amount')}</th>
              <th>{t('pms.fin.trust.reason')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data?.holdbacks || []).map((h) => (
              <tr key={h.id}>
                <td>{h.owner_name}</td>
                <td className="text-right tabular-nums">{currency(h.amount)}</td>
                <td>{h.reason || '—'} {Number(h.is_released) === 1 ? t('pms.fin.trust.released') : ''}</td>
                <td className="text-right">
                  {Number(h.is_released) !== 1 && (
                    <button type="button" className="text-xs text-emerald-700" onClick={() => release.mutate(h.id)}>
                      {t('pms.fin.trust.release')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VendorsTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [tab, setTab] = useState('vendors');
  const [vendorModal, setVendorModal] = useState(null);
  const [invoiceModal, setInvoiceModal] = useState(false);
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [invStatus, setInvStatus] = useState('');
  const [invVendor, setInvVendor] = useState('');

  // Vendors
  const { data: vendors = [], isLoading: vendorsLoading } = useQuery({
    queryKey: ['financial-system-vendors'],
    queryFn: () => api.get('/financial-system/vendors').then((r) => r.data),
  });
  const [vendorForm, setVendorForm] = useState({ name: '', tax_id: '', category: 'general', payment_terms_days: 30, contact_name: '', contact_phone: '', contact_email: '', bank_name: '', bank_account: '', notes: '', wht_rate_pct: 3 });
  const saveVendor = useMutation({
    mutationFn: (payload) =>
      vendorModal?.id
        ? api.put(`/financial-system/vendors/${vendorModal.id}`, payload)
        : api.post('/financial-system/vendors', payload),
    onSuccess: () => {
      toast.success(vendorModal?.id ? t('pms.fin.vendors.vendorUpdated') : t('pms.fin.vendors.vendorCreated'));
      qc.invalidateQueries({ queryKey: ['financial-system-vendors'] });
      setVendorModal(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  function openVendorEdit(v) {
    setVendorForm({
      name: v.name || '', tax_id: v.tax_id || '', category: v.category || 'general',
      payment_terms_days: v.payment_terms_days || 30, contact_name: v.contact_name || '',
      contact_phone: v.contact_phone || '', contact_email: v.contact_email || '',
      bank_name: v.bank_name || '', bank_account: v.bank_account || '',
      notes: v.notes || '', wht_rate_pct: v.wht_rate_pct ?? 3,
    });
    setVendorModal(v);
  }
  function openVendorNew() {
    setVendorForm({ name: '', tax_id: '', category: 'general', payment_terms_days: 30, contact_name: '', contact_phone: '', contact_email: '', bank_name: '', bank_account: '', notes: '', wht_rate_pct: 3 });
    setVendorModal({});
  }

  // Invoices
  const invParams = { status: invStatus || undefined, vendor_id: invVendor || undefined };
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ['financial-system-vendor-invoices', invStatus, invVendor],
    queryFn: () => api.get('/financial-system/vendor-invoices', { params: invParams }).then((r) => r.data),
  });
  const [invForm, setInvForm] = useState({ vendor_id: '', invoice_number: '', invoice_date: new Date().toISOString().slice(0, 10), amount: '', description: '', category: '', notes: '' });
  const createInvoice = useMutation({
    mutationFn: (payload) => api.post('/financial-system/vendor-invoices', payload),
    onSuccess: () => {
      toast.success(t('pms.fin.vendors.invoiceCreated'));
      qc.invalidateQueries({ queryKey: ['financial-system-vendor-invoices'] });
      qc.invalidateQueries({ queryKey: ['financial-system-vendors'] });
      setInvoiceModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const approveInv = useMutation({
    mutationFn: (id) => api.post(`/financial-system/vendor-invoices/${id}/approve`),
    onSuccess: () => { toast.success(t('pms.fin.vendors.approvedToast')); qc.invalidateQueries({ queryKey: ['financial-system-vendor-invoices'] }); qc.invalidateQueries({ queryKey: ['financial-system-vendors'] }); },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const rejectInv = useMutation({
    mutationFn: (id) => api.post(`/financial-system/vendor-invoices/${id}/reject`),
    onSuccess: () => { toast.success(t('pms.fin.vendors.rejectedToast')); qc.invalidateQueries({ queryKey: ['financial-system-vendor-invoices'] }); qc.invalidateQueries({ queryKey: ['financial-system-vendors'] }); },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const payInv = useMutation({
    mutationFn: (id) => api.post(`/financial-system/vendor-invoices/${id}/pay`, { payment_method: 'bank_transfer' }),
    onSuccess: () => { toast.success(t('pms.fin.vendors.markedPaid')); qc.invalidateQueries({ queryKey: ['financial-system-vendor-invoices'] }); qc.invalidateQueries({ queryKey: ['financial-system-vendors'] }); },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  // Aging
  const { data: agingData, isLoading: agingLoading } = useQuery({
    queryKey: ['financial-system-vendor-aging'],
    queryFn: () => api.get('/financial-system/vendor-aging').then((r) => r.data),
    enabled: tab === 'aging',
  });

  // Payment runs
  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ['financial-system-payment-runs'],
    queryFn: () => api.get('/financial-system/payment-runs').then((r) => r.data),
    enabled: tab === 'runs',
  });
  const createRun = useMutation({
    mutationFn: (invoice_ids) => api.post('/financial-system/payment-runs', { invoice_ids }),
    onSuccess: () => {
      toast.success(t('pms.fin.vendors.paymentRunCreated'));
      setSelectedInvoices([]);
      qc.invalidateQueries({ queryKey: ['financial-system-payment-runs'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const confirmRun = useMutation({
    mutationFn: (id) => api.post(`/financial-system/payment-runs/${id}/confirm`),
    onSuccess: () => {
      toast.success(t('pms.fin.vendors.runConfirmed'));
      qc.invalidateQueries({ queryKey: ['financial-system-payment-runs'] });
      qc.invalidateQueries({ queryKey: ['financial-system-vendor-invoices'] });
      qc.invalidateQueries({ queryKey: ['financial-system-vendors'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  // Approved invoices for payment run selection
  const approvedInvoices = invoices.filter((i) => i.status === 'approved');

  function toggleInvoiceSelect(id) {
    setSelectedInvoices((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const tabs = [
    { id: 'vendors', label: t('pms.fin.vendors.tabs.vendors') },
    { id: 'invoices', label: t('pms.fin.vendors.tabs.invoices') },
    { id: 'aging', label: t('pms.fin.vendors.tabs.aging') },
    { id: 'runs', label: t('pms.fin.vendors.tabs.runs') },
  ];

  const VENDOR_CATEGORIES = [
    { value: 'general', label: t('pms.fin.vendors.general') },
    { value: 'professional', label: t('pms.fin.vendors.professional') },
    { value: 'utilities', label: t('pms.fin.vendors.utilities') },
    { value: 'rent', label: t('pms.fin.vendors.rent') },
    { value: 'maintenance', label: t('pms.fin.vendors.maintenanceCat') },
    { value: 'software', label: t('pms.fin.vendors.software') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            className={`px-3 py-1.5 rounded-full text-sm ${tab === tabItem.id ? 'bg-ch-pine text-white' : 'bg-white border border-ch-line'}`}
            onClick={() => setTab(tabItem.id)}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {tab === 'vendors' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">{t('pms.fin.vendors.vendorMasterHint')}</p>
            <button type="button" className="btn-primary text-sm" onClick={openVendorNew}>
              <Plus className="w-4 h-4" /> {t('pms.fin.vendors.addVendor')}
            </button>
          </div>
          {vendorsLoading ? <LoadingSpinner /> : (
            <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>{t('pms.fin.vendors.name')}</th>
                    <th>{t('pms.fin.vendors.category')}</th>
                    <th>{t('pms.fin.vendors.whtPct')}</th>
                    <th>{t('pms.fin.vendors.terms')}</th>
                    <th className="text-right">{t('pms.fin.vendors.outstandingCol')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {vendors.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-gray-400 py-8">{t('pms.fin.vendors.noVendors')}</td></tr>
                  ) : vendors.map((v) => (
                    <tr key={v.id} className={v.is_active === false ? 'opacity-50' : ''}>
                      <td className="font-medium">{v.name}</td>
                      <td className="capitalize">{v.category}</td>
                      <td className="tabular-nums">{v.wht_rate_pct}%</td>
                      <td className="tabular-nums">{v.payment_terms_days}d</td>
                      <td className="text-right tabular-nums font-semibold">{currency(v.outstanding)}</td>
                      <td className="text-right">
                        <button type="button" className="text-xs text-ch-pine" onClick={() => openVendorEdit(v)}>{t('pms.fin.vendors.edit')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Modal
            open={Boolean(vendorModal)}
            onClose={() => setVendorModal(null)}
            title={vendorModal?.id ? t('pms.fin.vendors.editVendor') : t('pms.fin.vendors.newVendor')}
            footer={
              <>
                <button type="button" className="btn-secondary" onClick={() => setVendorModal(null)}>{t('pms.fin.cancel')}</button>
                <button type="submit" form="vendor-form" className="btn-primary" disabled={saveVendor.isPending}>{t('pms.fin.save')}</button>
              </>
            }
          >
            <form id="vendor-form" className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveVendor.mutate(vendorForm); }}>
              <input className="input w-full" placeholder={t('pms.fin.vendors.vendorName')} value={vendorForm.name} onChange={(e) => setVendorForm((f) => ({ ...f, name: e.target.value }))} required />
              <div className="grid grid-cols-2 gap-3">
                <input className="input" placeholder={t('pms.fin.vendors.taxId')} value={vendorForm.tax_id} onChange={(e) => setVendorForm((f) => ({ ...f, tax_id: e.target.value }))} />
                <select className="input" value={vendorForm.category} onChange={(e) => setVendorForm((f) => ({ ...f, category: e.target.value }))}>
                  {VENDOR_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('pms.fin.vendors.paymentTermsDays')}</label>
                  <input type="number" min="0" className="input w-full" value={vendorForm.payment_terms_days} onChange={(e) => setVendorForm((f) => ({ ...f, payment_terms_days: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('pms.fin.vendors.whtRate')}</label>
                  <input type="number" min="0" step="0.01" className="input w-full" value={vendorForm.wht_rate_pct} onChange={(e) => setVendorForm((f) => ({ ...f, wht_rate_pct: e.target.value }))} />
                </div>
              </div>
              <input className="input w-full" placeholder={t('pms.fin.vendors.contactName')} value={vendorForm.contact_name} onChange={(e) => setVendorForm((f) => ({ ...f, contact_name: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <input className="input" placeholder={t('pms.fin.vendors.phone')} value={vendorForm.contact_phone} onChange={(e) => setVendorForm((f) => ({ ...f, contact_phone: e.target.value }))} />
                <input className="input" placeholder={t('pms.fin.vendors.email')} value={vendorForm.contact_email} onChange={(e) => setVendorForm((f) => ({ ...f, contact_email: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input className="input" placeholder={t('pms.fin.vendors.bankName')} value={vendorForm.bank_name} onChange={(e) => setVendorForm((f) => ({ ...f, bank_name: e.target.value }))} />
                <input className="input" placeholder={t('pms.fin.vendors.bankAccount')} value={vendorForm.bank_account} onChange={(e) => setVendorForm((f) => ({ ...f, bank_account: e.target.value }))} />
              </div>
              <textarea className="input w-full min-h-[60px]" placeholder={t('pms.fin.notes')} value={vendorForm.notes} onChange={(e) => setVendorForm((f) => ({ ...f, notes: e.target.value }))} />
            </form>
          </Modal>
        </div>
      )}

      {tab === 'invoices' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <select className="input text-sm w-36" value={invStatus} onChange={(e) => setInvStatus(e.target.value)}>
                <option value="">{t('pms.fin.vendors.allStatuses')}</option>
                <option value="pending">{t('pms.fin.vendors.pending')}</option>
                <option value="approved">{t('pms.fin.vendors.approved')}</option>
                <option value="paid">{t('pms.fin.vendors.paidStatus')}</option>
                <option value="rejected">{t('pms.fin.vendors.rejected')}</option>
              </select>
              <SearchableSelect
                className="w-48"
                value={invVendor}
                onChange={setInvVendor}
                placeholder={t('pms.fin.vendors.allVendors')}
                options={[
                  { value: '', label: t('pms.fin.vendors.allVendors') },
                  ...vendors.map((v) => ({ value: String(v.id), label: v.name })),
                ]}
              />
            </div>
            <button type="button" className="btn-primary text-sm" onClick={() => setInvoiceModal(true)}>
              <Plus className="w-4 h-4" /> {t('pms.fin.vendors.newInvoice')}
            </button>
          </div>
          {invoicesLoading ? <LoadingSpinner /> : (
            <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>{t('pms.fin.vendors.vendorCol')}</th>
                    <th>{t('pms.fin.vendors.invoiceNum')}</th>
                    <th>{t('pms.fin.vendors.dateCol')}</th>
                    <th>{t('pms.fin.vendors.dueCol')}</th>
                    <th className="text-right">{t('pms.fin.vendors.amountCol')}</th>
                    <th className="text-right">{t('pms.fin.vendors.whtCol')}</th>
                    <th className="text-right">{t('pms.fin.vendors.netCol')}</th>
                    <th>{t('pms.fin.vendors.statusCol')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 ? (
                    <tr><td colSpan={9} className="text-center text-gray-400 py-8">{t('pms.fin.vendors.noInvoices')}</td></tr>
                  ) : invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="font-medium">{inv.vendor_name}</td>
                      <td>{inv.invoice_number || '—'}</td>
                      <td>{formatDate(inv.invoice_date)}</td>
                      <td>{formatDate(inv.due_date)}</td>
                      <td className="text-right tabular-nums">{currency(inv.amount)}</td>
                      <td className="text-right tabular-nums text-gray-500">{currency(inv.wht_amount)}</td>
                      <td className="text-right tabular-nums font-semibold">{currency(inv.net_payable)}</td>
                      <td>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          inv.status === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                          inv.status === 'approved' ? 'bg-sky-100 text-sky-800' :
                          inv.status === 'rejected' ? 'bg-rose-100 text-rose-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="text-right space-x-1">
                        {inv.status === 'pending' && (
                          <>
                            <button type="button" className="text-xs text-emerald-700" onClick={() => approveInv.mutate(inv.id)}>{t('pms.fin.approve')}</button>
                            <button type="button" className="text-xs text-rose-600" onClick={() => rejectInv.mutate(inv.id)}>{t('pms.fin.reject')}</button>
                          </>
                        )}
                        {inv.status === 'approved' && (
                          <button type="button" className="text-xs text-ch-pine" onClick={() => payInv.mutate(inv.id)}>{t('pms.fin.vendors.pay')}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Modal
            open={invoiceModal}
            onClose={() => setInvoiceModal(false)}
            title={t('pms.fin.vendors.newVendorInvoice')}
            footer={
              <>
                <button type="button" className="btn-secondary" onClick={() => setInvoiceModal(false)}>{t('pms.fin.cancel')}</button>
                <button type="submit" form="invoice-form" className="btn-primary" disabled={createInvoice.isPending}>{t('pms.fin.save')}</button>
              </>
            }
          >
            <form id="invoice-form" className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              createInvoice.mutate({
                vendor_id: parseInt(invForm.vendor_id, 10),
                invoice_number: invForm.invoice_number || undefined,
                invoice_date: invForm.invoice_date,
                amount: parseFloat(invForm.amount),
                description: invForm.description || undefined,
                category: invForm.category || undefined,
                notes: invForm.notes || undefined,
              });
            }}>
              <SearchableSelect
                className="w-full"
                value={invForm.vendor_id}
                onChange={(v) => setInvForm((f) => ({ ...f, vendor_id: v }))}
                placeholder={t('pms.fin.vendors.selectVendor')}
                options={vendors.filter((v) => v.is_active !== false).map((v) => ({ value: String(v.id), label: v.name }))}
              />
              <input className="input w-full" placeholder={t('pms.fin.vendors.invoiceNumber')} value={invForm.invoice_number} onChange={(e) => setInvForm((f) => ({ ...f, invoice_number: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('pms.fin.vendors.invoiceDate')}</label>
                  <input type="date" className="input w-full" value={invForm.invoice_date} onChange={(e) => setInvForm((f) => ({ ...f, invoice_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('pms.fin.vendors.amountRequired')}</label>
                  <input type="number" min="0.01" step="0.01" className="input w-full" value={invForm.amount} onChange={(e) => setInvForm((f) => ({ ...f, amount: e.target.value }))} required />
                </div>
              </div>
              {invForm.vendor_id && invForm.amount > 0 && (() => {
                const v = vendors.find((x) => String(x.id) === invForm.vendor_id);
                if (!v) return null;
                const wht = Math.round(parseFloat(invForm.amount) * (parseFloat(v.wht_rate_pct) || 0) / 100 * 100) / 100;
                const net = Math.round((parseFloat(invForm.amount) - wht) * 100) / 100;
                return (
                  <div className="rounded-xl bg-slate-50 p-3 text-sm flex gap-4">
                    <span>{t('pms.fin.vendors.whtCalc', { pct: v.wht_rate_pct, wht: currency(wht) })}</span>
                    <span>{t('pms.fin.vendors.netPayable', { net: currency(net) })}</span>
                    <span>{t('pms.fin.vendors.dueIn', { days: v.payment_terms_days })}</span>
                  </div>
                );
              })()}
              <input className="input w-full" placeholder={t('pms.fin.description')} value={invForm.description} onChange={(e) => setInvForm((f) => ({ ...f, description: e.target.value }))} />
              <textarea className="input w-full min-h-[60px]" placeholder={t('pms.fin.notes')} value={invForm.notes} onChange={(e) => setInvForm((f) => ({ ...f, notes: e.target.value }))} />
            </form>
          </Modal>
        </div>
      )}

      {tab === 'aging' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">{t('pms.fin.vendors.agingHint', { total: currency(agingData?.total_outstanding) })}</p>
          {agingLoading ? <LoadingSpinner /> : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(agingData?.buckets || {}).map(([key, b]) => (
                  <div key={key} className="rounded-2xl border border-ch-line bg-white p-4">
                    <p className="text-xs text-gray-400">{b.label}</p>
                    <p className="text-xl font-bold tabular-nums mt-1">{currency(b.amount)}</p>
                    <p className="text-xs text-gray-500">{t('pms.fin.vendors.invoicesCount', { count: b.count })}</p>
                  </div>
                ))}
              </div>
              {Object.values(agingData?.buckets || {}).map((b) =>
                (b.rows || []).length ? (
                  <div key={b.label} className="rounded-2xl border border-ch-line bg-white overflow-hidden">
                    <div className="px-6 py-3 border-b font-semibold">{b.label}</div>
                    <table className="table text-sm">
                      <thead>
                        <tr>
                          <th>{t('pms.fin.vendors.vendorCol')}</th>
                          <th>{t('pms.fin.vendors.invoiceNum')}</th>
                          <th>{t('pms.fin.vendors.dueCol')}</th>
                          <th className="text-right">{t('pms.fin.vendors.daysCol')}</th>
                          <th className="text-right">{t('pms.fin.vendors.amountCol')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.rows.map((r) => (
                          <tr key={r.invoice_id}>
                            <td>{r.vendor_name}</td>
                            <td>{r.invoice_number || '—'}</td>
                            <td>{formatDate(r.due_date)}</td>
                            <td className="text-right tabular-nums">{r.days}</td>
                            <td className="text-right tabular-nums font-medium">{currency(r.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null
              )}
            </>
          )}
        </div>
      )}

      {tab === 'runs' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            {t('pms.fin.vendors.selectApproved')}
          </p>
          {approvedInvoices.length > 0 && (
            <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
              <div className="px-6 py-3 border-b font-semibold flex justify-between items-center">
                <span>{t('pms.fin.vendors.approvedInvoices', { count: approvedInvoices.length })}</span>
                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={!selectedInvoices.length || createRun.isPending}
                  onClick={() => createRun.mutate(selectedInvoices)}
                >
                  {t('pms.fin.vendors.createRun', { count: selectedInvoices.length })}
                </button>
              </div>
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th />
                    <th>{t('pms.fin.vendors.vendorCol')}</th>
                    <th>{t('pms.fin.vendors.invoiceNum')}</th>
                    <th className="text-right">{t('pms.fin.vendors.netCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {approvedInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedInvoices.includes(inv.id)}
                          onChange={() => toggleInvoiceSelect(inv.id)}
                        />
                      </td>
                      <td>{inv.vendor_name}</td>
                      <td>{inv.invoice_number || '—'}</td>
                      <td className="text-right tabular-nums">{currency(inv.net_payable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {runsLoading ? <LoadingSpinner /> : (
            <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
              <div className="px-6 py-3 border-b font-semibold">{t('pms.fin.vendors.paymentRuns')}</div>
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>{t('pms.fin.vendors.id')}</th>
                    <th>{t('pms.fin.vendors.dateCol')}</th>
                    <th className="text-right">{t('pms.fin.vendors.amountCol')}</th>
                    <th className="text-right">{t('pms.fin.vendors.whtCol')}</th>
                    <th className="text-right">{t('pms.fin.vendors.netCol')}</th>
                    <th>{t('pms.fin.vendors.invoicesCol')}</th>
                    <th>{t('pms.fin.vendors.statusCol')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {runs.length === 0 ? (
                    <tr><td colSpan={8} className="text-center text-gray-400 py-8">{t('pms.fin.vendors.noPaymentRuns')}</td></tr>
                  ) : runs.map((r) => (
                    <tr key={r.id}>
                      <td className="font-mono text-xs">#{r.id}</td>
                      <td>{formatDate(r.run_date)}</td>
                      <td className="text-right tabular-nums">{currency(r.total_amount)}</td>
                      <td className="text-right tabular-nums text-gray-500">{currency(r.total_wht)}</td>
                      <td className="text-right tabular-nums font-semibold">{currency(r.total_net)}</td>
                      <td className="tabular-nums">{r.invoice_count}</td>
                      <td>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          r.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                          r.status === 'confirmed' ? 'bg-sky-100 text-sky-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="text-right">
                        {r.status === 'draft' && (
                          <button type="button" className="btn-secondary text-xs py-1 px-2" onClick={() => confirmRun.mutate(r.id)} disabled={confirmRun.isPending}>
                            <CheckCircle2 className="w-3 h-3 inline mr-1" /> {t('pms.fin.confirm')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ACTION_TYPE_KEYS = [
  { value: 'reminder_sent', labelKey: 'reminderSent' },
  { value: 'phone_call', labelKey: 'phoneCall' },
  { value: 'final_notice', labelKey: 'finalNotice' },
  { value: 'write_off_proposed', labelKey: 'writeOffProposed' },
  { value: 'dispute', labelKey: 'dispute' },
  { value: 'payment_plan', labelKey: 'paymentPlan' },
];

function ArControlsTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const [tab, setTab] = useState('dashboard');
  const qc = useQueryClient();

  const actionTypes = ACTION_TYPE_KEYS.map((at) => ({
    value: at.value,
    label: t(`pms.fin.ar.${at.labelKey}`),
  }));
  const actionTypeLabel = (type) =>
    actionTypes.find((at) => at.value === type)?.label || String(type || '').replace(/_/g, ' ');

  // ── Dashboard ──
  const { data: dash, isLoading: dashLoading } = useQuery({
    queryKey: ['ar-dashboard', params],
    queryFn: () => api.get('/financial-system/ar-dashboard', { params }).then((r) => r.data),
    enabled: tab === 'dashboard',
  });

  // ── Collection log ──
  const { data: actions = [], isLoading: actionsLoading } = useQuery({
    queryKey: ['ar-actions'],
    queryFn: () => api.get('/financial-system/ar-actions').then((r) => r.data),
    enabled: tab === 'log',
  });
  const [showActionForm, setShowActionForm] = useState(false);
  const [actionForm, setActionForm] = useState({ reservation_id: '', action_type: 'reminder_sent', notes: '', next_action_date: '', amount_disputed: '' });
  const createAction = useMutation({
    mutationFn: (payload) => api.post('/financial-system/ar-actions', payload),
    onSuccess: () => {
      toast.success(t('pms.fin.ar.actionLogged'));
      qc.invalidateQueries({ queryKey: ['ar-actions'] });
      qc.invalidateQueries({ queryKey: ['ar-dashboard'] });
      setShowActionForm(false);
      setActionForm({ reservation_id: '', action_type: 'reminder_sent', notes: '', next_action_date: '', amount_disputed: '' });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  // ── Provisions ──
  const { data: provisions = [], isLoading: provLoading } = useQuery({
    queryKey: ['ar-provisions'],
    queryFn: () => api.get('/financial-system/ar-provisions').then((r) => r.data),
    enabled: tab === 'provisions',
  });
  const [showProvForm, setShowProvForm] = useState(false);
  const [provForm, setProvForm] = useState({ period_month: new Date().toISOString().slice(0, 7), bucket_0_30_pct: '0', bucket_31_60_pct: '1', bucket_61_90_pct: '5', bucket_90_plus_pct: '20', notes: '' });
  const calcProvision = useMutation({
    mutationFn: (payload) => api.post('/financial-system/ar-provisions', payload),
    onSuccess: () => {
      toast.success(t('pms.fin.ar.provisionCalculated'));
      qc.invalidateQueries({ queryKey: ['ar-provisions'] });
      qc.invalidateQueries({ queryKey: ['ar-dashboard'] });
      setShowProvForm(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  // ── Write-offs ──
  const { data: writeOffs = [], isLoading: woLoading } = useQuery({
    queryKey: ['ar-write-offs'],
    queryFn: () => api.get('/financial-system/ar-write-offs').then((r) => r.data),
    enabled: tab === 'writeoffs',
  });
  const [showWoForm, setShowWoForm] = useState(false);
  const [woForm, setWoForm] = useState({ reservation_id: '', amount: '', reason: '' });
  const createWo = useMutation({
    mutationFn: (payload) => api.post('/financial-system/ar-write-offs', payload),
    onSuccess: () => {
      toast.success(t('pms.fin.ar.writeOffProposedToast'));
      qc.invalidateQueries({ queryKey: ['ar-write-offs'] });
      qc.invalidateQueries({ queryKey: ['ar-dashboard'] });
      setShowWoForm(false);
      setWoForm({ reservation_id: '', amount: '', reason: '' });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const approveWo = useMutation({
    mutationFn: (id) => api.post(`/financial-system/ar-write-offs/${id}/approve`),
    onSuccess: () => {
      toast.success(t('pms.fin.ar.writeOffApproved'));
      qc.invalidateQueries({ queryKey: ['ar-write-offs'] });
      qc.invalidateQueries({ queryKey: ['ar-dashboard'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const rejectWo = useMutation({
    mutationFn: (id) => api.post(`/financial-system/ar-write-offs/${id}/reject`),
    onSuccess: () => {
      toast.success(t('pms.fin.ar.writeOffRejected'));
      qc.invalidateQueries({ queryKey: ['ar-write-offs'] });
      qc.invalidateQueries({ queryKey: ['ar-dashboard'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  const tabs = [
    ['dashboard', t('pms.fin.ar.tabs.dashboard')],
    ['log', t('pms.fin.ar.tabs.log')],
    ['provisions', t('pms.fin.ar.tabs.provisions')],
    ['writeoffs', t('pms.fin.ar.tabs.writeoffs')],
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {t('pms.fin.ar.description')}
      </p>
      <div className="flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`px-3 py-1.5 rounded-full text-sm ${tab === id ? 'bg-ch-pine text-white' : 'bg-white border border-ch-line'}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Dashboard ── */}
      {tab === 'dashboard' && (dashLoading ? <LoadingSpinner /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-ch-line bg-white p-4">
              <p className="text-xs text-gray-400">{t('pms.fin.ar.totalAr')}</p>
              <p className="text-xl font-bold tabular-nums mt-1">{currency(dash?.total_ar)}</p>
            </div>
            <div className="rounded-2xl border border-ch-line bg-white p-4">
              <p className="text-xs text-gray-400">{t('pms.fin.ar.badDebtProvision')}</p>
              <p className="text-xl font-bold tabular-nums mt-1">{currency(dash?.total_provision)}</p>
              {dash?.latest_provision && <p className="text-xs text-gray-500">{dash.latest_provision.period_month}</p>}
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <p className="text-xs text-amber-800">{t('pms.fin.ar.overdue')}</p>
              <p className="text-xl font-bold tabular-nums mt-1">{t('pms.fin.ar.overdueStays', { count: dash?.overdue_count || 0 })}</p>
              <p className="text-xs text-gray-500">{t('pms.fin.ar.overduePct', { pct: dash?.overdue_pct || 0 })}</p>
            </div>
            <div className="rounded-2xl border border-ch-line bg-white p-4">
              <p className="text-xs text-gray-400">{t('pms.fin.ar.actionsThisMonth')}</p>
              <p className="text-xl font-bold tabular-nums mt-1">{dash?.actions_this_month || 0}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(dash?.aging?.buckets || {}).map(([key, b]) => (
              <div key={key} className="rounded-2xl border border-ch-line bg-white p-4">
                <p className="text-xs text-gray-400">{b.label}</p>
                <p className="text-xl font-bold tabular-nums mt-1">{currency(b.amount)}</p>
                <p className="text-xs text-gray-500">{t('pms.fin.stays', { count: b.count })}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-ch-line bg-white p-5">
              <h3 className="font-semibold mb-3">{t('pms.fin.ar.collectionActionsByType')}</h3>
              {Object.entries(dash?.action_counts || {}).length === 0 ? (
                <p className="text-sm text-gray-400">{t('pms.fin.ar.noCollectionActions')}</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(dash?.action_counts || {}).map(([type, cnt]) => (
                    <div key={type} className="flex justify-between text-sm">
                      <span>{actionTypeLabel(type)}</span>
                      <span className="font-semibold tabular-nums">{cnt}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-ch-line bg-white p-5">
              <h3 className="font-semibold mb-3">{t('pms.fin.ar.writeOffSummary')}</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>{t('pms.fin.ar.pendingWo')}</span>
                  <span className="font-semibold tabular-nums">{currency(dash?.write_offs?.pending)} ({dash?.write_offs?.pending_count || 0})</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('pms.fin.ar.approvedWo')}</span>
                  <span className="font-semibold tabular-nums text-emerald-700">{currency(dash?.write_offs?.approved)} ({dash?.write_offs?.approved_count || 0})</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* ── Collection log ── */}
      {tab === 'log' && (actionsLoading ? <LoadingSpinner /> : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className="btn-primary text-sm" onClick={() => setShowActionForm(true)}>
              <Plus className="w-4 h-4" /> {t('pms.fin.ar.logAction')}
            </button>
          </div>
          <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>{t('pms.fin.manual.date')}</th>
                  <th>{t('pms.fin.ar.reservation')}</th>
                  <th>{t('pms.fin.ar.typeCol')}</th>
                  <th>{t('pms.fin.notes')}</th>
                  <th>{t('pms.fin.ar.nextAction')}</th>
                  <th>{t('pms.fin.ar.by')}</th>
                </tr>
              </thead>
              <tbody>
                {actions.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-gray-400 py-8">{t('pms.fin.ar.noCollectionLog')}</td></tr>
                ) : actions.map((a) => (
                  <tr key={a.id}>
                    <td>{formatDate(a.created_at)}</td>
                    <td className="tabular-nums">#{a.reservation_id}</td>
                    <td>{actionTypeLabel(a.action_type)}</td>
                    <td className="max-w-xs truncate">{a.notes || '—'}</td>
                    <td>{a.next_action_date ? formatDate(a.next_action_date) : '—'}</td>
                    <td>{a.created_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Modal open={showActionForm} onClose={() => setShowActionForm(false)} title={t('pms.fin.ar.logActionTitle')} footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setShowActionForm(false)}>{t('pms.fin.cancel')}</button>
              <button type="submit" form="ar-action-form" className="btn-primary" disabled={createAction.isPending}>{t('pms.fin.save')}</button>
            </>
          }>
            <form id="ar-action-form" className="space-y-4" onSubmit={(e) => {
              e.preventDefault();
              createAction.mutate({
                reservation_id: parseInt(actionForm.reservation_id, 10),
                action_type: actionForm.action_type,
                notes: actionForm.notes || undefined,
                next_action_date: actionForm.next_action_date || undefined,
                amount_disputed: parseFloat(actionForm.amount_disputed) || 0,
              });
            }}>
              <div>
                <label className="label">{t('pms.fin.ar.reservationId')}</label>
                <input type="number" className="input w-full" required value={actionForm.reservation_id} onChange={(e) => setActionForm((f) => ({ ...f, reservation_id: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('pms.fin.ar.actionType')}</label>
                <select className="input w-full" value={actionForm.action_type} onChange={(e) => setActionForm((f) => ({ ...f, action_type: e.target.value }))}>
                  {actionTypes.map((at) => <option key={at.value} value={at.value}>{at.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('pms.fin.notes')}</label>
                <textarea className="input w-full min-h-[80px]" value={actionForm.notes} onChange={(e) => setActionForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('pms.fin.ar.nextActionDate')}</label>
                  <input type="date" className="input w-full" value={actionForm.next_action_date} onChange={(e) => setActionForm((f) => ({ ...f, next_action_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('pms.fin.ar.amountDisputed')}</label>
                  <input type="number" min="0" step="0.01" className="input w-full" value={actionForm.amount_disputed} onChange={(e) => setActionForm((f) => ({ ...f, amount_disputed: e.target.value }))} />
                </div>
              </div>
            </form>
          </Modal>
        </div>
      ))}

      {/* ── Provisions ── */}
      {tab === 'provisions' && (provLoading ? <LoadingSpinner /> : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className="btn-primary text-sm" onClick={() => setShowProvForm(true)}>
              <Plus className="w-4 h-4" /> {t('pms.fin.ar.calculateProvision')}
            </button>
          </div>
          <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>{t('pms.fin.ar.monthCol')}</th>
                  <th className="text-right">{t('pms.fin.ar.totalArCol')}</th>
                  <th className="text-right">{t('pms.fin.ar.bucket0_30')}</th>
                  <th className="text-right">{t('pms.fin.ar.bucket31_60')}</th>
                  <th className="text-right">{t('pms.fin.ar.bucket61_90')}</th>
                  <th className="text-right">{t('pms.fin.ar.bucket90plus')}</th>
                  <th className="text-right">{t('pms.fin.ar.provisionCol')}</th>
                  <th>{t('pms.fin.ar.by')}</th>
                </tr>
              </thead>
              <tbody>
                {provisions.length === 0 ? (
                  <tr><td colSpan={8} className="text-center text-gray-400 py-8">{t('pms.fin.ar.noProvisions')}</td></tr>
                ) : provisions.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.period_month}</td>
                    <td className="text-right tabular-nums">{currency(p.total_ar)}</td>
                    <td className="text-right tabular-nums">{p.bucket_0_30_pct}%</td>
                    <td className="text-right tabular-nums">{p.bucket_31_60_pct}%</td>
                    <td className="text-right tabular-nums">{p.bucket_61_90_pct}%</td>
                    <td className="text-right tabular-nums">{p.bucket_90_plus_pct}%</td>
                    <td className="text-right tabular-nums font-bold">{currency(p.total_provision)}</td>
                    <td>{p.created_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Modal open={showProvForm} onClose={() => setShowProvForm(false)} title={t('pms.fin.ar.calcProvisionTitle')} footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setShowProvForm(false)}>{t('pms.fin.cancel')}</button>
              <button type="submit" form="ar-prov-form" className="btn-primary" disabled={calcProvision.isPending}>{t('pms.fin.ar.calculate')}</button>
            </>
          }>
            <form id="ar-prov-form" className="space-y-4" onSubmit={(e) => {
              e.preventDefault();
              calcProvision.mutate({
                period_month: provForm.period_month,
                bucket_0_30_pct: parseFloat(provForm.bucket_0_30_pct),
                bucket_31_60_pct: parseFloat(provForm.bucket_31_60_pct),
                bucket_61_90_pct: parseFloat(provForm.bucket_61_90_pct),
                bucket_90_plus_pct: parseFloat(provForm.bucket_90_plus_pct),
                notes: provForm.notes || undefined,
              });
            }}>
              <div>
                <label className="label">{t('pms.fin.ar.periodMonth')}</label>
                <input type="month" className="input w-full" required value={provForm.period_month} onChange={(e) => setProvForm((f) => ({ ...f, period_month: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('pms.fin.ar.bucket0_30loss')}</label>
                  <input type="number" min="0" max="100" step="0.1" className="input w-full" value={provForm.bucket_0_30_pct} onChange={(e) => setProvForm((f) => ({ ...f, bucket_0_30_pct: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('pms.fin.ar.bucket31_60loss')}</label>
                  <input type="number" min="0" max="100" step="0.1" className="input w-full" value={provForm.bucket_31_60_pct} onChange={(e) => setProvForm((f) => ({ ...f, bucket_31_60_pct: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('pms.fin.ar.bucket61_90loss')}</label>
                  <input type="number" min="0" max="100" step="0.1" className="input w-full" value={provForm.bucket_61_90_pct} onChange={(e) => setProvForm((f) => ({ ...f, bucket_61_90_pct: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('pms.fin.ar.bucket90plusLoss')}</label>
                  <input type="number" min="0" max="100" step="0.1" className="input w-full" value={provForm.bucket_90_plus_pct} onChange={(e) => setProvForm((f) => ({ ...f, bucket_90_plus_pct: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">{t('pms.fin.notes')}</label>
                <textarea className="input w-full min-h-[60px]" value={provForm.notes} onChange={(e) => setProvForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </form>
          </Modal>
        </div>
      ))}

      {/* ── Write-offs ── */}
      {tab === 'writeoffs' && (woLoading ? <LoadingSpinner /> : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className="btn-primary text-sm" onClick={() => setShowWoForm(true)}>
              <Plus className="w-4 h-4" /> {t('pms.fin.ar.proposeWriteOff')}
            </button>
          </div>
          <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>{t('pms.fin.ar.reservation')}</th>
                  <th className="text-right">{t('pms.fin.amount')}</th>
                  <th>{t('pms.fin.ar.reasonCol')}</th>
                  <th>{t('pms.fin.ar.statusCol')}</th>
                  <th>{t('pms.fin.ar.by')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {writeOffs.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-gray-400 py-8">{t('pms.fin.ar.noWriteOffs')}</td></tr>
                ) : writeOffs.map((w) => (
                  <tr key={w.id}>
                    <td className="tabular-nums">#{w.reservation_id}</td>
                    <td className="text-right tabular-nums font-medium">{currency(w.amount)}</td>
                    <td className="max-w-xs truncate">{w.reason || '—'}</td>
                    <td>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        w.status === 'approved' ? 'bg-emerald-100 text-emerald-800' :
                        w.status === 'rejected' ? 'bg-rose-100 text-rose-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {w.status}
                      </span>
                    </td>
                    <td>{w.created_by_name || '—'}</td>
                    <td className="text-right space-x-2">
                      {w.status === 'pending' && (
                        <>
                          <button type="button" className="text-xs text-emerald-700" onClick={() => approveWo.mutate(w.id)}>{t('pms.fin.approve')}</button>
                          <button type="button" className="text-xs text-rose-600" onClick={() => rejectWo.mutate(w.id)}>{t('pms.fin.reject')}</button>
                        </>
                      )}
                      {w.status === 'approved' && w.approved_by_name && (
                        <span className="text-xs text-gray-400">{t('pms.fin.ar.approvedBy', { name: w.approved_by_name })}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Modal open={showWoForm} onClose={() => setShowWoForm(false)} title={t('pms.fin.ar.proposeWriteOffTitle')} footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setShowWoForm(false)}>{t('pms.fin.cancel')}</button>
              <button type="submit" form="ar-wo-form" className="btn-primary" disabled={createWo.isPending}>{t('pms.fin.ar.propose')}</button>
            </>
          }>
            <form id="ar-wo-form" className="space-y-4" onSubmit={(e) => {
              e.preventDefault();
              createWo.mutate({
                reservation_id: parseInt(woForm.reservation_id, 10),
                amount: parseFloat(woForm.amount),
                reason: woForm.reason || undefined,
              });
            }}>
              <div>
                <label className="label">{t('pms.fin.ar.reservationId')}</label>
                <input type="number" className="input w-full" required value={woForm.reservation_id} onChange={(e) => setWoForm((f) => ({ ...f, reservation_id: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('pms.fin.amountEgp')}</label>
                <input type="number" min="0.01" step="0.01" className="input w-full" required value={woForm.amount} onChange={(e) => setWoForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('pms.fin.ar.reasonCol')}</label>
                <textarea className="input w-full min-h-[80px]" value={woForm.reason} onChange={(e) => setWoForm((f) => ({ ...f, reason: e.target.value }))} placeholder={t('pms.fin.ar.reasonPlaceholder')} />
              </div>
            </form>
          </Modal>
        </div>
      ))}
    </div>
  );
}

function FixedAssetsTool() {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showRun, setShowRun] = useState(false);
  const [runMonth, setRunMonth] = useState(new Date().toISOString().slice(0, 7));
  const [scheduleAsset, setScheduleAsset] = useState(null);
  const [disposeId, setDisposeId] = useState(null);
  const [form, setForm] = useState({
    name: '',
    category: 'equipment',
    purchase_date: new Date().toISOString().slice(0, 10),
    purchase_cost: '',
    salvage_value: '0',
    useful_life_months: '36',
    notes: '',
  });

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['financial-system-fixed-assets'],
    queryFn: () => api.get('/financial-system/fixed-assets').then((r) => r.data),
  });

  const { data: scheduleRows = [], isLoading: scheduleLoading } = useQuery({
    queryKey: ['financial-system-fixed-asset-schedule', scheduleAsset?.id],
    queryFn: () =>
      api.get(`/financial-system/fixed-assets/${scheduleAsset.id}/schedule`).then((r) => r.data),
    enabled: Boolean(scheduleAsset?.id),
  });

  const createAsset = useMutation({
    mutationFn: (payload) => api.post('/financial-system/fixed-assets', payload),
    onSuccess: () => {
      toast.success(t('pms.fin.assets.assetCreated'));
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['financial-system-fixed-assets'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  const disposeAsset = useMutation({
    mutationFn: (id) => api.post(`/financial-system/fixed-assets/${id}/dispose`),
    onSuccess: () => {
      toast.success(t('pms.fin.assets.assetDisposed'));
      setDisposeId(null);
      qc.invalidateQueries({ queryKey: ['financial-system-fixed-assets'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  const runDep = useMutation({
    mutationFn: (month) => api.post('/financial-system/fixed-assets/run-depreciation', { month }),
    onSuccess: (_res, month) => {
      toast.success(t('pms.fin.assets.depreciationRun', { month }));
      setShowRun(false);
      qc.invalidateQueries({ queryKey: ['financial-system-fixed-assets'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  const categoryLabel = (c) =>
    t(`pms.fin.assets.${c}`) !== `pms.fin.assets.${c}` ? t(`pms.fin.assets.${c}`) : c;

  const statusLabel = (s) => {
    if (s === 'active') return t('pms.fin.assets.active');
    if (s === 'disposed') return t('pms.fin.assets.disposed');
    if (s === 'fully_depreciated') return t('pms.fin.assets.fullyDepreciated');
    return s;
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-gray-500 max-w-2xl">{t('pms.fin.assets.hint')}</p>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={() => setShowRun(true)}>
            {t('pms.fin.assets.runDepreciation')}
          </button>
          <button type="button" className="btn-primary text-sm" onClick={() => setShowForm(true)}>
            <Plus className="w-4 h-4" /> {t('pms.fin.assets.addAsset')}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-ch-line bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.assets.code')}</th>
                <th>{t('pms.fin.assets.name')}</th>
                <th>{t('pms.fin.assets.category')}</th>
                <th>{t('pms.fin.assets.purchaseDate')}</th>
                <th className="text-right">{t('pms.fin.assets.cost')}</th>
                <th className="text-right">{t('pms.fin.assets.accumulated')}</th>
                <th className="text-right">{t('pms.fin.assets.bookValue')}</th>
                <th>{t('pms.fin.assets.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(assets) ? assets : []).length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center text-gray-400 py-8">
                    {t('pms.fin.assets.noAssets')}
                  </td>
                </tr>
              ) : (
                (Array.isArray(assets) ? assets : []).map((a) => {
                  const cost = Number(a.purchase_cost) || 0;
                  const accum = Number(a.accumulated_depreciation) || 0;
                  const book =
                    a.current_book_value != null
                      ? Number(a.current_book_value)
                      : Math.max(0, cost - accum);
                  return (
                    <tr key={a.id}>
                      <td className="font-mono text-xs">{a.asset_code}</td>
                      <td className="font-medium">{a.name}</td>
                      <td>{categoryLabel(a.category)}</td>
                      <td>{formatDate(a.purchase_date)}</td>
                      <td className="text-right tabular-nums">{currency(cost)}</td>
                      <td className="text-right tabular-nums">{currency(accum)}</td>
                      <td className="text-right tabular-nums font-semibold">{currency(book)}</td>
                      <td className="capitalize">{statusLabel(a.status)}</td>
                      <td className="text-right space-x-2 rtl:space-x-reverse">
                        <button
                          type="button"
                          className="text-xs text-ch-pine"
                          onClick={() => setScheduleAsset(a)}
                        >
                          {t('pms.fin.assets.schedule')}
                        </button>
                        {a.status === 'active' && (
                          <button
                            type="button"
                            className="text-xs text-rose-600"
                            onClick={() => setDisposeId(a.id)}
                          >
                            {t('pms.fin.assets.dispose')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={t('pms.fin.assets.addAsset')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              {t('pms.fin.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={createAsset.isPending || !(form.name && parseFloat(form.purchase_cost) > 0)}
              onClick={() =>
                createAsset.mutate({
                  name: form.name.trim(),
                  category: form.category,
                  purchase_date: form.purchase_date,
                  purchase_cost: parseFloat(form.purchase_cost),
                  salvage_value: parseFloat(form.salvage_value) || 0,
                  useful_life_months: parseInt(form.useful_life_months, 10) || 36,
                  notes: form.notes.trim() || undefined,
                })
              }
            >
              {t('pms.fin.save')}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">{t('pms.fin.assets.name')}</label>
            <input
              className="input w-full"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">{t('pms.fin.assets.category')}</label>
            <select
              className="input w-full"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            >
              {['equipment', 'furniture', 'technology', 'vehicle', 'other'].map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">{t('pms.fin.assets.purchaseDate')}</label>
              <input
                type="date"
                className="input w-full"
                value={form.purchase_date}
                onChange={(e) => setForm((f) => ({ ...f, purchase_date: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('pms.fin.assets.purchaseCost')}</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                className="input w-full"
                value={form.purchase_cost}
                onChange={(e) => setForm((f) => ({ ...f, purchase_cost: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('pms.fin.assets.salvageValue')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input w-full"
                value={form.salvage_value}
                onChange={(e) => setForm((f) => ({ ...f, salvage_value: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('pms.fin.assets.usefulLifeMonths')}</label>
              <input
                type="number"
                min="1"
                className="input w-full"
                value={form.useful_life_months}
                onChange={(e) => setForm((f) => ({ ...f, useful_life_months: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="label">{t('pms.fin.assets.notesOptional')}</label>
            <input
              className="input w-full"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={showRun}
        onClose={() => setShowRun(false)}
        title={t('pms.fin.assets.runDepreciation')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setShowRun(false)}>
              {t('pms.fin.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={runDep.isPending}
              onClick={() => runDep.mutate(runMonth)}
            >
              {t('pms.fin.assets.run')}
            </button>
          </>
        }
      >
        <div>
          <label className="label">{t('pms.fin.assets.runMonth')}</label>
          <input
            type="month"
            className="input w-full"
            value={runMonth}
            onChange={(e) => setRunMonth(e.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(scheduleAsset)}
        onClose={() => setScheduleAsset(null)}
        title={
          scheduleAsset
            ? `${t('pms.fin.assets.schedule')} — ${scheduleAsset.asset_code}`
            : t('pms.fin.assets.schedule')
        }
      >
        {scheduleLoading ? (
          <LoadingSpinner />
        ) : (
          <table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.assets.period')}</th>
                <th className="text-right">{t('pms.fin.assets.amount')}</th>
                <th className="text-right">{t('pms.fin.assets.accumulated')}</th>
                <th className="text-right">{t('pms.fin.assets.bookValue')}</th>
              </tr>
            </thead>
            <tbody>
              {(Array.isArray(scheduleRows) ? scheduleRows : []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-gray-400 py-6">
                    {t('pms.fin.assets.noSchedule')}
                  </td>
                </tr>
              ) : (
                (Array.isArray(scheduleRows) ? scheduleRows : []).map((row) => (
                  <tr key={row.id || row.period_month}>
                    <td>{row.period_month}</td>
                    <td className="text-right tabular-nums">{currency(row.amount)}</td>
                    <td className="text-right tabular-nums">{currency(row.accumulated)}</td>
                    <td className="text-right tabular-nums">{currency(row.book_value)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(disposeId)}
        onClose={() => setDisposeId(null)}
        title={t('pms.fin.assets.dispose')}
        message={t('pms.fin.assets.disposeConfirm')}
        confirmText={t('pms.fin.assets.confirmDispose')}
        danger
        onConfirm={() => disposeAsset.mutate(disposeId)}
        loading={disposeAsset.isPending}
      />
    </div>
  );
}

function FinancialSystemInner() {
  const { t, locale, toggleLocale, isRtl } = useFinLocale();
  const { view, group, code, txn, tool, go } = useFinanceNav();
  const [period, setPeriod] = useState(() => ({ ...monthBounds(cairoYearMonth()), basis: 'stay' }));
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { from: fromDate, to: toDate, basis } = period;
  const params = rangeParams(fromDate, toDate, basis);
  const basisLabel = basis === 'created' ? t('pms.fin.basisCreated') : t('pms.fin.basisStay');

  function updatePeriod(patch) {
    setPeriod((prev) => {
      const next = { ...prev, ...patch };
      if (next.to && next.to < next.from) next.to = next.from;
      return next;
    });
  }

  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-portal', fromDate, toDate, basis],
    queryFn: () => api.get('/financial-system/portal', { params }).then((r) => r.data),
    refetchInterval: 60_000,
  });

  async function exportReport(from, to) {
    try {
      setExporting(true);
      const res = await api.get('/financial-system/export', {
        params: rangeParams(from, to, basis),
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `cairo-homes-financial-system-${from}_to_${to}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch {
      toast.error(t('pms.fin.exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  const crumbs = useMemo(() => {
    const items = [{ label: t('pms.fin.title'), onClick: () => go({ view: 'home', group: '', code: '', txn: '', tool: '' }) }];
    if (tool) {
      const labels = {
        assets: t('pms.fin.tools.fixedAssets'),
        owners: t('pms.fin.tools.ownerPayouts'),
        insurance: t('pms.fin.tools.insurancePayout'),
        'checkin-audit': t('pms.fin.tools.checkinAudit'),
        'payment-calendar': t('pms.fin.tools.paymentCalendar'),
        trust: t('pms.fin.tools.ownerTrust'),
        manual: t('pms.fin.tools.manualEntries'),
        petty: t('pms.fin.tools.pettyCash'),
        tax: t('pms.fin.tools.taxDesk'),
        recurring: t('pms.fin.tools.monthlyCharges'),
        reports: t('pms.fin.tools.monthEndReports'),
        cashflow: t('pms.fin.tools.cashFlow'),
        aging: t('pms.fin.tools.arAging'),
        close: t('pms.fin.tools.closeMonth'),
        gateway: t('pms.fin.tools.gatewaySettle'),
        bank: t('pms.fin.tools.bankRec'),
        vendors: t('pms.fin.tools.apVendors'),
        ar: t('pms.fin.tools.arControls'),
        segment: t('pms.fin.tools.segmentPnl'),
        forecast: t('pms.fin.tools.cashForecast'),
      };
      items.push({ label: labels[tool] || tool });
      return items;
    }
    if (group) items.push({ label: GROUP_META[group]?.label || group, onClick: () => go({ view: 'group', group, code: '', txn: '', tool: '' }) });
    if (code) items.push({ label: getAccount(code)?.name || code, onClick: () => go({ view: 'account', group: getAccount(code)?.group || group, code, txn: '', tool: '' }) });
    if (txn) items.push({ label: txn });
    return items;
  }, [tool, group, code, txn, t, go]);

  const showHome = view === 'home' && !tool && !code && !txn;
  const showGroup = view === 'group' && group && !code && !txn && !tool;
  const showAccount = Boolean(code) && !txn && !tool;
  const showTxn = Boolean(txn) && !tool;

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400 mb-1">{t('pms.fin.companyBooks')}</p>
          <h1 className="page-title flex items-center gap-2">
            <Landmark className="w-7 h-7 text-ch-pine" />
            {t('pms.fin.title')}
          </h1>
          <nav className="flex flex-wrap items-center gap-1 text-sm mt-2">
            {crumbs.map((c, i) => (
              <span key={`${c.label}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-gray-300" />}
                {c.onClick ? (
                  <button type="button" className="text-ch-pine hover:underline" onClick={c.onClick}>
                    {c.label}
                  </button>
                ) : (
                  <span className="text-gray-500">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={toggleLocale}
            className="btn-secondary text-sm inline-flex items-center gap-1.5"
            aria-label={locale === 'en' ? 'العربية' : 'English'}
          >
            <Globe className="w-4 h-4" />
            {locale === 'en' ? 'العربية' : 'English'}
          </button>
          <DateFilters fromDate={fromDate} toDate={toDate} basis={basis} onChange={updatePeriod} />
        </div>
      </div>

      <ExportPeriodModal
        key={exportOpen ? `export-${fromDate}-${toDate}` : 'export-closed'}
        open={exportOpen}
        defaultFrom={fromDate}
        defaultTo={toDate}
        exporting={exporting}
        onClose={() => setExportOpen(false)}
        onConfirm={exportReport}
      />

      {!showHome && (
        <button
          type="button"
          className="text-sm text-ch-pine inline-flex items-center gap-1"
          onClick={() => {
            if (txn) return go({ view: 'account', txn: '', code: code || getAccount(code)?.code, group });
            if (code) return go({ view: 'group', code: '', txn: '', group: getAccount(code)?.group || group });
            if (tool) return go({ view: 'home', tool: '', group: '', code: '', txn: '' });
            go({ view: 'home', group: '', code: '', txn: '', tool: '' });
          }}
        >
          <ArrowLeft className="w-4 h-4" /> {t('pms.fin.back')}
        </button>
      )}

      {isLoading && showHome ? (
        <LoadingSpinner />
      ) : showHome ? (
        <HomeView
          data={data}
          basisLabel={basisLabel}
          onOpenGroup={(id) => go({ view: 'group', group: id, code: '', txn: '', tool: '' })}
          onOpenAccount={(c) => go({ view: 'account', code: c, group: getAccount(c)?.group || '', txn: '', tool: '' })}
          onOpenTreasury={(c) => go({ view: 'account', code: c, group: 'assets', txn: '', tool: '' })}
          onOpenTool={(id) => go({ view: 'tool', tool: id, group: '', code: '', txn: '' })}
          onExport={() => setExportOpen(true)}
          exporting={exporting}
        />
      ) : showTxn ? (
        <TransactionView txnId={txn} fromDate={fromDate} toDate={toDate} basis={basis} />
      ) : showAccount ? (
        <AccountView
          code={code}
          fromDate={fromDate}
          toDate={toDate}
          basis={basis}
          onOpenTxn={(id) => go({ view: 'txn', txn: id, code, group: getAccount(code)?.group || group })}
        />
      ) : showGroup ? (
        <GroupView
          groupId={group}
          data={data}
          onOpenAccount={(c) => go({ view: 'account', code: c, group, txn: '', tool: '' })}
        />
      ) : tool === 'tax' ? (
        <TaxTab rangeParams={params} />
      ) : tool === 'owners' ? (
        <OwnerStatementsTab fromDate={fromDate} toDate={toDate} rangeParams={params} />
      ) : tool === 'trust' ? (
        <OwnerTrustTool rangeParams={params} />
      ) : tool === 'reports' ? (
        <ReportsTool rangeParams={params} />
      ) : tool === 'cashflow' ? (
        <CashFlowTool rangeParams={params} />
      ) : tool === 'aging' ? (
        <AgingTool
          rangeParams={params}
          onOpenAccount={(c) => go({ view: 'account', code: c, group: 'assets', txn: '', tool: '' })}
        />
      ) : tool === 'insurance' ? (
        <InsuranceRefundsTool
          onOpenAccount={(c) => go({ view: 'account', code: c, group: 'liabilities', txn: '', tool: '' })}
        />
      ) : tool === 'checkin-audit' ? (
        <CheckinAuditTool />
      ) : tool === 'payment-calendar' ? (
        <PaymentCalendarTool />
      ) : tool === 'close' ? (
        <CloseTool toDate={toDate} month={(toDate || new Date().toISOString().slice(0, 10)).slice(0, 7)} />
      ) : tool === 'segment' ? (
        <SegmentPnlTool rangeParams={params} />
      ) : tool === 'forecast' ? (
        <CashForecastTool rangeParams={params} />
      ) : tool === 'gateway' ? (
        <GatewayTool rangeParams={params} />
      ) : tool === 'bank' ? (
        <BankRecTool rangeParams={params} />
      ) : tool === 'manual' ? (
        <ManualEntriesTab fromDate={fromDate} toDate={toDate} rangeParams={params} />
      ) : tool === 'petty' ? (
        <PettyCashSection embedded />
      ) : tool === 'vendors' ? (
        <VendorsTool rangeParams={params} />
      ) : tool === 'ar' ? (
        <ArControlsTool rangeParams={params} />
      ) : tool === 'recurring' ? (
        <RecurringTool />
      ) : tool === 'assets' ? (
        <FixedAssetsTool />
      ) : (
        <LoadingSpinner />
      )}
    </div>
  );
}

export default function FinancialSystem() {
  return (
    <FinLocaleProvider>
      <FinancialSystemInner />
    </FinLocaleProvider>
  );
}
