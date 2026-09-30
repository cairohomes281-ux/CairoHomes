import { Check, X } from 'lucide-react';

export function approvalStatusClass(status) {
  if (status === 'approved') return 'bg-emerald-50 text-emerald-700';
  if (status === 'rejected') return 'bg-rose-50 text-rose-700';
  return 'bg-amber-50 text-amber-800';
}

function isLoanRow(row) {
  return row?.request_kind === 'loan' || (row?.amount != null && row?.leave_type == null && row?.work_date == null);
}

function stepPart(done, waitingLabel, doneName) {
  return done ? `${waitingLabel}: ${doneName || 'accepted'}` : `${waitingLabel}: waiting`;
}

function stepLine(row) {
  const loan = isLoanRow(row);
  const parts = [];
  if (row.needs_manager_approval) {
    parts.push(stepPart(row.manager_reviewed_by, 'Manager', row.manager_reviewed_by_name));
  }
  if (row.needs_hr_approval) {
    parts.push(stepPart(row.hr_reviewed_by, 'HR Manager', row.hr_reviewed_by_name));
  }
  if (loan && row.needs_finance_approval !== false) {
    parts.push(
      stepPart(row.finance_reviewed_by, 'Financial Manager', row.finance_reviewed_by_name)
    );
  }
  if (!parts.length) return '';
  const joiner = row.approval_mode === 'any' ? ' or ' : ' · ';
  return parts.join(joiner);
}

export function requestApprovalSummary(row) {
  if (row.status === 'pending') {
    return row.approval_label || stepLine(row) || 'Waiting for review';
  }
  return stepLine(row) || row.reviewed_by_name || '—';
}

export function RequestReviewActions({ row, onApprove, onReject, pending }) {
  const slots = row.can_review_slots || [];
  const acceptHint = slots.includes('admin')
    ? 'Accept and finalize'
    : slots.includes('finance')
      ? 'Accept as Financial Manager'
      : slots.includes('hr')
        ? 'Accept as HR Manager'
        : slots.includes('manager')
          ? 'Accept as manager'
          : 'Accept';

  if (row.status !== 'pending') {
    return (
      <div className="text-[11px] text-ch-muted space-y-0.5">
        <div>{stepLine(row) || row.reviewed_by_name || '—'}</div>
        {row.review_note ? <div>Note: {row.review_note}</div> : null}
      </div>
    );
  }

  if (!slots.length) {
    return (
      <div className="text-[11px] text-ch-muted space-y-0.5 max-w-[14rem]">
        <div className="font-medium text-amber-800">{row.approval_label || 'Waiting for review'}</div>
        {stepLine(row) ? <div>{stepLine(row)}</div> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {stepLine(row) ? <div className="text-[10px] text-ch-muted text-right">{stepLine(row)}</div> : null}
      <div className="flex gap-1">
        <button
          type="button"
          className="btn-secondary text-xs px-2 py-1 text-emerald-700"
          disabled={pending}
          title={acceptHint}
          onClick={(e) => {
            e.stopPropagation();
            onApprove(row);
          }}
        >
          <Check className="h-3.5 w-3.5" />
          Accept
        </button>
        <button
          type="button"
          className="btn-secondary text-xs px-2 py-1 text-rose-700"
          disabled={pending}
          onClick={(e) => {
            e.stopPropagation();
            onReject(row);
          }}
        >
          <X className="h-3.5 w-3.5" />
          Reject
        </button>
      </div>
    </div>
  );
}
