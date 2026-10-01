const ExcelJS = require('exceljs');
const { round2, calcReservationFinancials } = require('../commission');
const { ACCOUNT_GROUPS } = require('./chartOfAccounts');
const { bookingSplit } = require('./taxEngine');

/** Cairo Homes brand palette (matches Client tailwind ch.*) */
const C = {
  brand: '2F5D58',
  brandDark: '1E3F3B',
  accent: 'B5725A',
  ivory: 'FDF6F2',
  sand: 'E9CFC2',
  blue50: 'EEF4F3',
  blue100: 'D6E5E2',
  teal: '3D7A73',
  white: 'FFFFFF',
  ink: '132A27',
  muted: '5E7470',
  line: 'D9E3E1',
  zebra: 'FBF8F6',
  profit: '166534',
  profitBg: 'DCFCE7',
  loss: '991B1B',
  lossBg: 'FEE2E2',
  totalBg: 'FEE8E2',
};

function money(n) {
  return round2(Number(n) || 0);
}

function iso(d) {
  return String(d || '').slice(0, 10);
}

function blank() {
  return { kind: 'blank', cells: [] };
}

function banner(text) {
  return { kind: 'banner', cells: [String(text || '')] };
}

function subtitle(text) {
  return { kind: 'subtitle', cells: [String(text || '')] };
}

function section(text) {
  return { kind: 'section', cells: [String(text || '')] };
}

function header(...cols) {
  return { kind: 'header', cells: cols };
}

function kv(label, value) {
  return {
    kind: 'kv',
    cells: [label, value == null || value === '' ? '—' : value],
  };
}

function data(...cols) {
  return { kind: 'data', cells: cols };
}

function group(...cols) {
  return { kind: 'group', cells: cols };
}

function total(...cols) {
  return { kind: 'total', cells: cols };
}

function note(text) {
  return { kind: 'note', cells: [String(text || '')] };
}

function fill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${argb}` } };
}

function font(opts) {
  return { name: 'Calibri', size: 11, color: { argb: `FF${C.ink}` }, ...opts };
}

function thinBorder() {
  const edge = { style: 'thin', color: { argb: `FF${C.line}` } };
  return { top: edge, left: edge, bottom: edge, right: edge };
}

function applyCellValue(cell, value) {
  if (value == null || value === '') {
    cell.value = null;
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    cell.value = value;
    cell.numFmt = Number.isInteger(value) ? '#,##0' : '#,##0.00';
    return;
  }
  cell.value = value;
}

function styleRow(ws, rowIndex, rowDef, colCount, zebraIndex) {
  const kind = rowDef.kind || 'data';
  const cells = rowDef.cells || [];
  const excelRow = ws.getRow(rowIndex);

  if (kind === 'blank') {
    excelRow.height = 8;
    return;
  }

  for (let i = 0; i < colCount; i += 1) {
    const cell = excelRow.getCell(i + 1);
    applyCellValue(cell, cells[i]);
    cell.border = thinBorder();
    cell.alignment = { vertical: 'middle', wrapText: false };
  }

  if (kind === 'banner') {
    excelRow.height = 28;
    ws.mergeCells(rowIndex, 1, rowIndex, colCount);
    const cell = excelRow.getCell(1);
    cell.value = cells[0] || '';
    cell.fill = fill(C.brandDark);
    cell.font = font({ bold: true, size: 16, color: { argb: `FF${C.white}` } });
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    for (let i = 1; i <= colCount; i += 1) {
      excelRow.getCell(i).fill = fill(C.brandDark);
      excelRow.getCell(i).border = thinBorder();
    }
    return;
  }

  if (kind === 'subtitle') {
    excelRow.height = 22;
    ws.mergeCells(rowIndex, 1, rowIndex, colCount);
    const cell = excelRow.getCell(1);
    cell.value = cells[0] || '';
    cell.fill = fill(C.brand);
    cell.font = font({ bold: true, size: 12, color: { argb: `FF${C.ivory}` } });
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    for (let i = 1; i <= colCount; i += 1) {
      excelRow.getCell(i).fill = fill(C.brand);
      excelRow.getCell(i).border = thinBorder();
    }
    return;
  }

  if (kind === 'section') {
    excelRow.height = 20;
    ws.mergeCells(rowIndex, 1, rowIndex, colCount);
    const cell = excelRow.getCell(1);
    cell.value = cells[0] || '';
    cell.fill = fill(C.teal);
    cell.font = font({ bold: true, size: 11, color: { argb: `FF${C.white}` } });
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    for (let i = 1; i <= colCount; i += 1) {
      excelRow.getCell(i).fill = fill(C.teal);
      excelRow.getCell(i).border = thinBorder();
    }
    return;
  }

  if (kind === 'header') {
    excelRow.height = 18;
    for (let i = 0; i < colCount; i += 1) {
      const cell = excelRow.getCell(i + 1);
      cell.fill = fill(C.brand);
      cell.font = font({ bold: true, size: 10, color: { argb: `FF${C.white}` } });
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    }
    return;
  }

  if (kind === 'kv') {
    const label = excelRow.getCell(1);
    const value = excelRow.getCell(2);
    label.fill = fill(C.blue50);
    label.font = font({ bold: true, size: 10, color: { argb: `FF${C.brand}` } });
    value.fill = fill(C.white);
    value.font = font({ size: 11 });
    if (typeof cells[1] === 'number') {
      value.numFmt = '#,##0.00';
      value.alignment = { vertical: 'middle', horizontal: 'right' };
    }
    for (let i = 3; i <= colCount; i += 1) {
      excelRow.getCell(i).fill = fill(C.white);
    }
    return;
  }

  if (kind === 'group') {
    for (let i = 0; i < colCount; i += 1) {
      const cell = excelRow.getCell(i + 1);
      cell.fill = fill(C.sand);
      cell.font = font({ bold: true, size: 10, color: { argb: `FF${C.brandDark}` } });
    }
    return;
  }

  if (kind === 'total') {
    for (let i = 0; i < colCount; i += 1) {
      const cell = excelRow.getCell(i + 1);
      cell.fill = fill(C.totalBg);
      cell.font = font({ bold: true, size: 11, color: { argb: `FF${C.brandDark}` } });
      if (typeof cells[i] === 'number') {
        cell.numFmt = '#,##0.00';
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
      }
    }
    // Highlight net profit / loss on common "Net profit" rows
    const label = String(cells[0] || '').toLowerCase();
    if (label.includes('net profit') || label.includes('net change')) {
      const amount = typeof cells[1] === 'number' ? cells[1] : typeof cells[cells.length - 1] === 'number' ? cells[cells.length - 1] : null;
      if (amount != null) {
        const positive = amount >= 0;
        for (let i = 0; i < colCount; i += 1) {
          const cell = excelRow.getCell(i + 1);
          cell.fill = fill(positive ? C.profitBg : C.lossBg);
          cell.font = font({
            bold: true,
            size: 11,
            color: { argb: `FF${positive ? C.profit : C.loss}` },
          });
        }
      }
    }
    return;
  }

  if (kind === 'note') {
    ws.mergeCells(rowIndex, 1, rowIndex, colCount);
    const cell = excelRow.getCell(1);
    cell.value = cells[0] || '';
    cell.fill = fill(C.ivory);
    cell.font = font({ italic: true, size: 9, color: { argb: `FF${C.muted}` } });
    for (let i = 1; i <= colCount; i += 1) {
      excelRow.getCell(i).fill = fill(C.ivory);
      excelRow.getCell(i).border = thinBorder();
    }
    return;
  }

  // data / default — zebra striping
  const bg = zebraIndex % 2 === 0 ? C.white : C.zebra;
  for (let i = 0; i < colCount; i += 1) {
    const cell = excelRow.getCell(i + 1);
    cell.fill = fill(bg);
    cell.font = font({ size: 10 });
    if (typeof cells[i] === 'number') {
      cell.numFmt = '#,##0.00';
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    }
  }
}

function addSheet(wb, name, rows, widths = []) {
  const safe = String(name || 'Sheet').slice(0, 31);
  const ws = wb.addWorksheet(safe, {
    views: [{ state: 'frozen', ySplit: 2 }],
    properties: { defaultRowHeight: 16 },
  });

  const colCount = Math.max(
    widths.length,
    2,
    ...rows.map((r) => (r.cells && r.cells.length) || 0)
  );

  ws.columns = Array.from({ length: colCount }, (_, i) => ({
    width: widths[i] || 14,
  }));

  // Soft sheet tab color by sheet number
  const tabColors = [C.brand, C.accent, C.teal, C.brandDark];
  const tabIdx = Number(String(safe).slice(0, 2)) || 0;
  ws.properties.tabColor = { argb: `FF${tabColors[tabIdx % tabColors.length]}` };

  let zebra = 0;
  rows.forEach((rowDef, idx) => {
    const rowIndex = idx + 1;
    if (rowDef.kind === 'data') zebra += 1;
    styleRow(ws, rowIndex, rowDef, colCount, zebra);
  });

  return ws;
}

function buildCoverSheet({ from, to, generatedAt, kpis, outstanding }) {
  return [
    banner('CAIRO HOMES'),
    subtitle('Financial System — Full Period Report'),
    blank(),
    kv('Period from', from),
    kv('Period to', to || 'Open'),
    kv('Filter basis', 'Created / booked date'),
    kv('Generated at', generatedAt),
    kv('Currency', 'EGP'),
    blank(),
    section('EXECUTIVE SUMMARY'),
    blank(),
    header('Metric', 'Amount (EGP)'),
    kv('Gross revenue', money(kpis.gross_revenue ?? kpis.revenue)),
    kv('Owner share', money(kpis.owner_share)),
    kv('Company / Cairo Homes fees', money(kpis.company_fees ?? kpis.commission)),
    kv('Net revenue (company view)', money(kpis.net_revenue)),
    kv('COGS / direct costs', money(kpis.cogs)),
    kv('Gross profit', money(kpis.gross_profit)),
    kv('Operating expenses', money(kpis.opex)),
    total('Net profit', money(kpis.net_profit)),
    blank(),
    section('TREASURY & WORKING CAPITAL'),
    blank(),
    header('Metric', 'Amount (EGP)'),
    kv('Collected in period', money(kpis.collected)),
    kv('Treasury total', money(kpis.treasury_total)),
    kv('Treasury inflows', money(kpis.treasury_in)),
    kv('Bank EGP', money(kpis.bank_egp)),
    kv('Cash EGP', money(kpis.cash_egp)),
    kv('Gateway clearing', money(kpis.gateway_clearing)),
    kv('Guest AR', money(kpis.guest_ar)),
    kv('Outstanding (unpaid stays)', money(kpis.uncollected ?? outstanding?.amount)),
    kv('Outstanding stay count', outstanding?.count ?? 0),
    kv('Owner trust held', money(kpis.owner_trust)),
    blank(),
    section('TAX'),
    blank(),
    header('Metric', 'Amount (EGP)'),
    kv('VAT output', money(kpis.vat_output)),
    kv('VAT input', money(kpis.vat_input)),
    total('VAT payable (net)', money(kpis.vat_payable)),
  ];
}

function pushAccountSection(rows, sectionLabel, accounts) {
  rows.push(group(sectionLabel, '', ''));
  for (const a of accounts || []) {
    if (a.virtual) continue;
    rows.push(data('', `${a.code || ''}  ${a.name || ''}`.trim(), money(a.balance)));
  }
}

function buildPnlSheet(statements) {
  const pnl = statements?.profit_and_loss || {};
  const totals = pnl.totals || {};
  const receipts = pnl.receipts || {};
  const rows = [
    banner('PROFIT & LOSS'),
    subtitle('Gross receipts and ledger P&L'),
    blank(),
    section('GROSS RECEIPTS'),
    blank(),
    header('Section', 'Account / Item', 'Amount (EGP)'),
    data('Receipts', 'Gross reservation + custom revenue', money(receipts.total ?? totals.gross_revenue)),
    data('Receipts', 'Stay revenue', money(receipts.stays)),
    data('Receipts', 'Stay count', receipts.stay_count || 0),
    data('Receipts', 'Custom / manual revenue', money(receipts.custom)),
    data('Receipts', 'Custom revenue count', receipts.custom_count || 0),
    data('Receipts', 'Owner share (of stays)', money(receipts.owner_share ?? totals.owner_share)),
    data('Receipts', 'Company / commission share', money(totals.company_share ?? receipts.company_share)),
    blank(),
    section('LEDGER P&L ACCOUNTS'),
    blank(),
    header('Section', 'Account / Item', 'Amount (EGP)'),
  ];

  pushAccountSection(rows, 'REVENUE', pnl.revenue);
  rows.push(blank());
  pushAccountSection(rows, 'COGS', pnl.cogs);
  rows.push(blank());
  pushAccountSection(rows, 'OPEX', pnl.opex);

  rows.push(
    blank(),
    section('TOTALS'),
    blank(),
    header('Metric', 'Amount (EGP)'),
    kv('Gross revenue', money(totals.gross_revenue ?? receipts.total)),
    kv('Owner share', money(totals.owner_share)),
    kv('Net revenue (after owner share)', money(totals.net_revenue)),
    kv('Cairo Homes fees / posted revenue', money(totals.company_fees ?? totals.revenue)),
    kv('COGS (ex owner share)', money(totals.cogs)),
    kv('Gross profit', money(totals.gross)),
    kv('Operating expenses', money(totals.opex)),
    total('Net profit', money(totals.net))
  );
  return rows;
}

function buildTreasurySheet(treasury = [], kpis = {}) {
  const rows = [
    banner('TREASURY'),
    subtitle('Bank, cash & gateway positions'),
    blank(),
    header('Code', 'Account', 'Currency', 'Kind', 'Inflow', 'Outflow', 'Balance', 'Txns'),
  ];
  for (const t of treasury) {
    rows.push(
      data(
        t.code,
        t.name,
        t.currency || 'EGP',
        t.kind || '',
        money(t.inflow),
        money(t.outflow),
        money(t.balance),
        t.txn_count || 0
      )
    );
  }
  rows.push(
    blank(),
    total('Treasury total', money(kpis.treasury_total)),
    kv('Treasury inflows', money(kpis.treasury_in)),
    kv('Collected (collections)', money(kpis.collected))
  );
  return rows;
}

function buildCoaSheet(groups = [], accounts = []) {
  const rows = [
    banner('CHART OF ACCOUNTS'),
    subtitle('Period balances by group'),
    blank(),
    header('Group', 'Code', 'Account', 'Type', 'Debit', 'Credit', 'Balance', 'Txns'),
  ];
  const byCode = Object.fromEntries((accounts || []).map((a) => [a.code, a]));
  for (const g of groups) {
    rows.push(
      group(ACCOUNT_GROUPS[g.id] || g.label || g.id, '', '', '', '', '', money(g.balance), '')
    );
    for (const a of g.accounts || []) {
      const live = byCode[a.code] || a;
      rows.push(
        data(
          '',
          live.code || a.code,
          live.name || a.name,
          live.type || a.type || '',
          money(live.debit),
          money(live.credit),
          money(live.balance),
          live.txn_count || 0
        )
      );
    }
    rows.push(blank());
  }
  return rows;
}

function buildBalanceSheet(statements) {
  const bs = statements?.balance_sheet || {};
  const totals = bs.totals || {};
  const rows = [
    banner('BALANCE SHEET'),
    subtitle('Assets, liabilities & equity'),
    blank(),
    header('Section', 'Code', 'Account', 'Amount (EGP)'),
  ];
  const sections = [
    ['ASSETS', bs.assets, totals.assets],
    ['LIABILITIES', bs.liabilities, totals.liabilities],
    ['EQUITY', bs.equity, totals.equity],
  ];
  for (const [label, list, sectionTotal] of sections) {
    rows.push(group(label, '', '', money(sectionTotal)));
    for (const a of list || []) {
      rows.push(data('', a.code, a.name, money(a.balance ?? a.amount)));
    }
    rows.push(blank());
  }
  rows.push(total('Assets total', money(totals.assets)));
  rows.push(kv('Liabilities total', money(totals.liabilities)));
  rows.push(kv('Equity total', money(totals.equity)));
  rows.push(total('Liabilities + Equity', money(totals.liabilities_and_equity)));
  return rows;
}

function buildTrialBalance(statements) {
  const tb = statements?.trial_balance || {};
  const rows = [
    banner('TRIAL BALANCE'),
    subtitle('Debits and credits by account'),
    blank(),
    header('Code', 'Account', 'Type', 'Debit', 'Credit', 'Balance'),
  ];
  for (const a of tb.accounts || tb.rows || []) {
    rows.push(data(a.code, a.name, a.type || '', money(a.debit), money(a.credit), money(a.balance)));
  }
  rows.push(blank());
  rows.push(total('Total debit', money(tb.debit ?? tb.total_debit ?? tb.totals?.debit)));
  rows.push(total('Total credit', money(tb.credit ?? tb.total_credit ?? tb.totals?.credit)));
  return rows;
}

function buildCashFlow(statements) {
  const cf = statements?.cash_flow || {};
  const rows = [
    banner('STATEMENT OF CASH FLOWS'),
    subtitle(cf.method === 'direct' ? 'Direct method · Treasury 101000–104000' : 'Treasury operating & financing movements'),
    blank(),
  ];
  if (cf.from_date || cf.to_date) {
    rows.push(note(`Period: ${cf.from_date || '—'} → ${cf.to_date || '—'}`));
    rows.push(blank());
  }

  rows.push(header('Cash bridge', 'Amount (EGP)'));
  rows.push(kv('Opening cash', money(cf.opening_cash)));
  rows.push(kv('Net change in cash', money(cf.net_change)));
  rows.push(kv('Ending cash (opening + net)', money(cf.ending_cash_bridge ?? cf.reconciliation?.opening_plus_net)));
  rows.push(total('Ending cash (ledger)', money(cf.ending_cash)));
  if (cf.reconciliation) {
    rows.push(
      kv(
        cf.reconciliation.balanced ? 'Reconciliation' : 'Reconciliation variance',
        money(cf.reconciliation.variance)
      )
    );
  }
  rows.push(blank());

  function sectionRows(title, section) {
    rows.push(header(title, 'Amount (EGP)'));
    for (const line of section?.lines || []) {
      rows.push(kv(line.label || line.id, money(line.amount)));
    }
    rows.push(total(`${title} total`, money(section?.total)));
    rows.push(blank());
  }

  sectionRows('Operating activities', cf.operating);
  sectionRows('Investing activities', cf.investing);
  sectionRows('Financing activities', cf.financing);
  rows.push(total('Net increase / (decrease) in cash', money(cf.net_change)));
  rows.push(blank());

  if (cf.by_account?.length) {
    rows.push(header('Account', 'Opening', 'Inflows', 'Outflows', 'Closing'));
    for (const a of cf.by_account) {
      rows.push(
        data(
          `${a.code} ${a.name || ''}`,
          money(a.opening),
          money(a.inflows),
          money(a.outflows),
          money(a.closing)
        )
      );
    }
    rows.push(blank());
  }

  // Legacy summary rows for compatibility
  rows.push(header('Summary (legacy)', 'Amount (EGP)'));
  rows.push(kv('Operating inflows', money(cf.operating_in)));
  rows.push(kv('Operating outflows', money(cf.operating_out)));
  rows.push(kv('Operating net', money(cf.operating_net)));
  rows.push(kv('Financing outflows (owner payouts)', money(cf.financing_out)));
  rows.push(total('Net change in treasury', money(cf.net_change)));

  if (cf.note) {
    rows.push(blank(), note(cf.note));
  }
  return rows;
}

function buildBookingsSheet(reservations = []) {
  const rows = [
    banner('BOOKINGS'),
    subtitle('By created / booked date'),
    blank(),
    header(
      'ID',
      'Guest',
      'Unit',
      'Project',
      'Created',
      'Check-in',
      'Check-out',
      'Status',
      'Gross',
      'Commission',
      'VAT',
      'Owner share',
      'Amount paid',
      'Remaining'
    ),
  ];
  for (const r of reservations) {
    const fin = calcReservationFinancials(r, r);
    const split = bookingSplit(fin, r);
    const totalAmt = money(r.total_amount);
    const paid = money(r.amount_paid);
    rows.push(
      data(
        r.id,
        r.guest_name || '',
        r.unit_name || r.unit_number || '',
        r.project || '',
        iso(r.created_at),
        iso(r.check_in),
        iso(r.check_out),
        r.status || '',
        money(split.gross_booking),
        money(split.company_commission),
        money(split.vat_on_commission),
        money(split.owner_trust_credit),
        paid,
        money(Math.max(0, totalAmt - paid))
      )
    );
  }
  if (!reservations.length) rows.push(note('No bookings in period'));
  return rows;
}

function buildExpensesSheet(expenses = []) {
  const rows = [
    banner('EXPENSES'),
    subtitle('By created date'),
    blank(),
    header('ID', 'Created', 'Expense date', 'Category', 'Description', 'Amount', 'Paid by', 'Unit'),
  ];
  for (const e of expenses) {
    rows.push(
      data(
        e.id,
        iso(e.created_at),
        iso(e.expense_date),
        e.category || '',
        e.description || '',
        money(e.amount),
        e.paid_by || 'company',
        e.unit_id || ''
      )
    );
  }
  if (!expenses.length) rows.push(note('No expenses in period'));
  return rows;
}

function buildPaymentsSheet(payments = []) {
  const rows = [
    banner('PAYMENTS / COLLECTIONS'),
    subtitle('By created date'),
    blank(),
    header('ID', 'Created', 'Payment date', 'Reservation', 'Amount', 'Method', 'Status', 'Notes'),
  ];
  for (const p of payments) {
    rows.push(
      data(
        p.id,
        iso(p.created_at),
        iso(p.payment_date || p.paid_at),
        p.reservation_id || '',
        money(p.amount),
        p.payment_method || '',
        p.status || '',
        String(p.notes || '').slice(0, 120)
      )
    );
  }
  if (!payments.length) rows.push(note('No payments in period'));
  return rows;
}

function buildManualSheet(entries = []) {
  const rows = [
    banner('MANUAL ENTRIES'),
    subtitle('By created date'),
    blank(),
    header('ID', 'Created', 'Entry date', 'Type', 'Flow', 'Description', 'Amount', 'Unit', 'Notes'),
  ];
  for (const m of entries) {
    rows.push(
      data(
        m.id,
        iso(m.created_at),
        iso(m.entry_date),
        m.entry_type || '',
        m.misc_flow || '',
        m.description || '',
        money(m.amount),
        m.unit_name || '',
        m.notes || ''
      )
    );
  }
  if (!entries.length) rows.push(note('No manual entries in period'));
  return rows;
}

function buildPettySheet(rowsIn = []) {
  const rows = [
    banner('PETTY CASH'),
    subtitle('By created date'),
    blank(),
    header('ID', 'Created', 'Entry date', 'Type', 'Amount', 'Location', 'Description', 'Status'),
  ];
  for (const pc of rowsIn) {
    rows.push(
      data(
        pc.id,
        iso(pc.created_at),
        iso(pc.entry_date),
        pc.entry_type || '',
        money(pc.amount),
        pc.location || '',
        pc.description || '',
        pc.status || ''
      )
    );
  }
  if (!rowsIn.length) rows.push(note('No petty cash in period'));
  return rows;
}

function buildOwnerTrustSheet(trust, payouts = [], holdbacks = []) {
  const rows = [
    banner('OWNER TRUST & PAYOUTS'),
    subtitle('Subledger, payout requests & holdbacks'),
    blank(),
    kv('Control account 202000', money(trust?.control_202000)),
    kv('Subledger tied to control', trust?.tied ? 'Yes' : 'No / check reconciling items'),
    blank(),
    section('Owner balances'),
    blank(),
    header('Owner ID', 'Owner', 'Credits', 'Payouts', 'Holdbacks', 'Expenses', 'Balance'),
  ];
  for (const o of trust?.rows || []) {
    rows.push(
      data(
        o.owner_id || o.id || '',
        o.owner_name || o.full_name || '',
        money(o.credits),
        money(o.payouts),
        money(o.holdbacks ?? o.holdback),
        money(o.expenses),
        money(o.balance ?? o.amount ?? o.available ?? o.remaining)
      )
    );
  }
  rows.push(blank(), section('Payout requests'), blank());
  rows.push(header('ID', 'Owner', 'Status', 'Gross', 'Commission', 'Net', 'Created', 'Reviewed'));
  for (const p of payouts) {
    rows.push(
      data(
        p.id,
        p.owner_name || p.owner_id,
        p.status || '',
        money(p.gross_amount),
        money(p.commission_amount),
        money(p.net_amount),
        iso(p.created_at),
        iso(p.reviewed_at)
      )
    );
  }
  rows.push(blank(), section('Active holdbacks'), blank());
  rows.push(header('ID', 'Owner', 'Amount', 'Reason', 'Created'));
  for (const h of (holdbacks || []).filter((x) => !Number(x.is_released))) {
    rows.push(
      data(h.id, h.owner_name || h.owner_id, money(h.amount), h.reason || '', iso(h.created_at))
    );
  }
  return rows;
}

function buildVatSheet(vat) {
  return [
    banner('VAT RETURN'),
    subtitle('Output / input VAT for the period'),
    blank(),
    header('Item', 'Amount (EGP)'),
    kv('Output VAT', money(vat?.output_vat)),
    kv('Input VAT', money(vat?.input_vat)),
    total('Net VAT payable', money(vat?.net_vat_payable)),
  ];
}

function buildAgingSheet(aging) {
  const buckets = aging?.buckets || {};
  const rows = [
    banner('ACCOUNTS RECEIVABLE AGING'),
    subtitle('Outstanding guest receivables by age'),
    blank(),
    kv('As of', aging?.as_of || '—'),
    kv('Total outstanding', money(aging?.total)),
    blank(),
    header('Bucket', 'Amount (EGP)', 'Count'),
  ];
  const order = ['current', 'd31', 'd61', 'd90'];
  for (const key of order) {
    const b = buckets[key];
    if (!b) continue;
    rows.push(data(b.label || key, money(b.amount), b.count || 0));
  }

  const detail = [];
  for (const key of order) {
    for (const r of buckets[key]?.rows || []) detail.push(r);
  }
  if (detail.length) {
    rows.push(blank(), section('Outstanding stays'), blank());
    rows.push(header('Reservation', 'Guest', 'Unit', 'Check-in', 'Due', 'Days'));
    for (const r of detail) {
      rows.push(
        data(
          r.reservation_id || r.id,
          r.guest_name || '',
          r.unit_name || '',
          iso(r.check_in),
          money(r.amount ?? r.due ?? r.remaining),
          r.days ?? r.days_overdue ?? ''
        )
      );
    }
  }
  return rows;
}

function buildJournalSheet(journal = []) {
  const rows = [
    banner('JOURNAL'),
    subtitle('Period journal lines (capped at 5,000 entries)'),
    blank(),
    header('Date', 'Entry ID', 'Type', 'Description', 'Account', 'Account name', 'Debit', 'Credit', 'Memo'),
  ];
  const capped = journal.slice(0, 5000);
  for (const e of capped) {
    for (const line of e.lines || []) {
      rows.push(
        data(
          iso(e.date),
          e.id,
          e.type || '',
          e.description || '',
          line.account,
          line.account_name || '',
          money(line.debit),
          money(line.credit),
          line.memo || ''
        )
      );
    }
  }
  if (journal.length > capped.length) {
    rows.push(blank(), note(`… truncated ${journal.length - capped.length} additional entries`));
  }
  if (!journal.length) rows.push(note('No journal entries in period'));
  return rows;
}

function buildContentsSheet() {
  return [
    banner('REPORT CONTENTS'),
    subtitle('Cairo Homes financial pack'),
    blank(),
    header('Sheet', 'Contents'),
    data('01 Summary', 'Executive KPIs — revenue, profit, treasury, VAT'),
    data('02 P&L', 'Gross receipts and profit & loss accounts'),
    data('03 Treasury', 'Bank, cash, gateway balances and flows'),
    data('04 Chart of Accounts', 'Period account balances by group'),
    data('05 Balance Sheet', 'Assets, liabilities, and equity'),
    data('06 Trial Balance', 'Debits and credits by account'),
    data('07 Cash Flow', 'Direct-method statement of cash flows'),
    data('08 Bookings', 'Reservations with commission / owner splits'),
    data('09 Expenses', 'Operating and unit expenses'),
    data('10 Payments', 'Guest collections and refunds'),
    data('11 Manual Entries', 'Manual revenue and expense entries'),
    data('12 Petty Cash', 'Petty cash movements'),
    data('13 Owner Trust', 'Owner subledger, payouts, holdbacks'),
    data('14 VAT', 'Output / input VAT return'),
    data('15 AR Aging', 'Outstanding guest receivables by age'),
    data('16 Journal', 'Full period journal lines (capped)'),
    blank(),
    note('Colors follow Cairo Homes brand: navy headers, teal sections, orange totals, green/red for net profit.'),
  ];
}

/**
 * Build a full Cairo Homes financial workbook for the given period.
 * @param {{ from: string, to: string|null, portal: object, statements: object, vat: object, aging: object, trust: object }} pack
 */
function buildFinancialWorkbook(pack) {
  const { from, to, portal, statements, vat, aging, trust } = pack;
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const dataBag = portal?.data || {};
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cairo Homes';
  wb.company = 'Cairo Homes';
  wb.created = new Date();
  wb.modified = new Date();
  wb.title = `Financial Report ${from} → ${to || 'open'}`;

  addSheet(wb, '00 Contents', buildContentsSheet(), [22, 56]);
  addSheet(
    wb,
    '01 Summary',
    buildCoverSheet({
      from,
      to,
      generatedAt,
      kpis: portal?.kpis || {},
      outstanding: portal?.outstanding,
    }),
    [38, 20]
  );
  addSheet(wb, '02 P&L', buildPnlSheet(statements), [16, 48, 16]);
  addSheet(wb, '03 Treasury', buildTreasurySheet(portal?.treasury || [], portal?.kpis || {}), [
    10, 42, 10, 10, 14, 14, 14, 8,
  ]);
  addSheet(wb, '04 Chart of Accounts', buildCoaSheet(portal?.groups || [], portal?.accounts || []), [
    18, 10, 48, 12, 14, 14, 14, 8,
  ]);
  addSheet(wb, '05 Balance Sheet', buildBalanceSheet(statements), [16, 10, 48, 16]);
  addSheet(wb, '06 Trial Balance', buildTrialBalance(statements), [10, 48, 12, 14, 14, 14]);
  addSheet(wb, '07 Cash Flow', buildCashFlow(statements), [42, 14, 14, 14, 14]);
  addSheet(wb, '08 Bookings', buildBookingsSheet(portal?.reservations || []), [
    10, 22, 14, 16, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
  ]);
  addSheet(wb, '09 Expenses', buildExpensesSheet(dataBag.expenses || []), [
    10, 12, 12, 16, 40, 12, 12, 12,
  ]);
  addSheet(wb, '10 Payments', buildPaymentsSheet(dataBag.payments || []), [
    10, 12, 12, 14, 12, 14, 12, 28,
  ]);
  addSheet(wb, '11 Manual Entries', buildManualSheet(dataBag.manuals || []), [
    10, 12, 12, 12, 10, 36, 12, 14, 24,
  ]);
  addSheet(wb, '12 Petty Cash', buildPettySheet(dataBag.petty || []), [
    10, 12, 12, 10, 12, 14, 32, 10,
  ]);
  addSheet(
    wb,
    '13 Owner Trust',
    buildOwnerTrustSheet(trust, portal?.payouts || [], dataBag.holdbacks || portal?.holdbacks || []),
    [14, 24, 12, 12, 12, 12, 12]
  );
  addSheet(wb, '14 VAT', buildVatSheet(vat), [32, 16]);
  addSheet(wb, '15 AR Aging', buildAgingSheet(aging), [16, 16, 10, 22, 14, 10]);
  addSheet(wb, '16 Journal', buildJournalSheet(portal?.journal || []), [
    12, 18, 14, 36, 10, 28, 12, 12, 24,
  ]);

  return wb;
}

async function workbookToBuffer(wb) {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = {
  buildFinancialWorkbook,
  workbookToBuffer,
};
