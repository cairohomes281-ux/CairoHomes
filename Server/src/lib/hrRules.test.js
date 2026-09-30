const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  dailyRate,
  latenessFactor,
  parseHhMm,
  computeLatenessDeduction,
  computeAbsenceDeduction,
  computeUnpaidLeaveDeduction,
  leaveDayDeductionAmount,
  assertCasualTiming,
  assertAnnualNotice,
  addDaysIso,
  EARLY_LEAVE_MAX_PER_YEAR,
  PAID_EXCUSE_MAX_PER_MONTH,
  PAID_EXCUSE_MAX_HOURS,
  hourlyRate,
  computeUnpaidExcuseDeduction,
  assertExcuseWindow,
  assertMissionWindow,
  isExcuseLeaveType,
  isMissionLeaveType,
  leaveDoesNotAffectAttendance,
  normalizeExcuseLeaveType,
  leaveTypeRequiresApproval,
  leaveApprovalPolicy,
  canRequestHolidays,
  leaveTypeRequiresHolidayAccess,
  isUnpaidLeaveUnlimited,
  nextPayrollPeriod,
  dateCoveredByRanges,
  parseAttendanceRows,
  collapsePunchAttendance,
  isDoorPunchLog,
  parseHtmlExcelTables,
  matchAttendanceStaff,
  fillMissingOfficeAbsences,
  splitSalaryAdjustments,
  hasOfficeAttendance,
  canRequestWfh,
  assertOriginalRecordsAttendanceTemplate,
  toIsoDate,
  DEFAULT_ATTENDANCE_CHECKOUT,
  normalizePersonId,
  canRequestStaffBenefits,
  canRequestLoan,
  loanRequestPolicy,
  staffRequestPolicy,
  eligibleReviewSlots,
  applyRequestReview,
  describeRequestApproval,
  canEditStaffCompensation,
  appliesSalaryImmediately,
  isHrActingOnSelf,
  assertCanEditStaffCompensation,
} = require('./hrRules');

describe('HR daily-rate deductions and leave rules', () => {
  it('uses salary / 30 as the daily rate and / 24 as hourly', () => {
    assert.equal(dailyRate(9000), 300);
    assert.equal(hourlyRate(9000), Math.round((300 / 24 + Number.EPSILON) * 100) / 100);
  });

  it('applies lateness bands after the 11:00–11:15 grace', () => {
    assert.equal(latenessFactor(parseHhMm('11:15')).factor, 0);
    assert.equal(latenessFactor(parseHhMm('11:16')).factor, 0.25);
    assert.equal(latenessFactor(parseHhMm('11:30')).factor, 0.25);
    assert.equal(latenessFactor(parseHhMm('11:31')).factor, 0.5);
    assert.equal(latenessFactor(parseHhMm('12:00')).factor, 0.5);
    assert.equal(latenessFactor(parseHhMm('12:01')).factor, 1);
    assert.equal(computeLatenessDeduction(9000, '11:20').amount, 75);
    assert.equal(computeLatenessDeduction(9000, '11:45').amount, 150);
    assert.equal(computeLatenessDeduction(9000, '12:10').amount, 300);
  });

  it('deducts 2x daily rate for no show', () => {
    assert.equal(computeAbsenceDeduction(9000).amount, 600);
    assert.equal(computeAbsenceDeduction(9000).factor, 2);
  });

  it('deducts 1x daily rate for unpaid leave days', () => {
    assert.equal(computeUnpaidLeaveDeduction(9000).amount, 300);
    assert.equal(leaveDayDeductionAmount('unpaid', 9000), 300);
    assert.equal(leaveDayDeductionAmount('casual', 9000), 0);
    assert.equal(leaveDayDeductionAmount('annual', 9000), 0);
  });

  it('allows casual and annual leave with no request timing rules', () => {
    const afterShift = new Date('2026-08-19T09:05:00Z');
    assert.doesNotThrow(() => assertCasualTiming('2026-08-18', afterShift));
    assert.doesNotThrow(() => assertCasualTiming('2026-08-19', afterShift));
    assert.doesNotThrow(() => assertAnnualNotice('2026-08-19', afterShift, 1));
    assert.doesNotThrow(() => assertAnnualNotice('2026-08-20', afterShift, 5));
  });

  it('caps paid excuses at two per month and two hours each', () => {
    assert.equal(PAID_EXCUSE_MAX_PER_MONTH, 2);
    assert.equal(PAID_EXCUSE_MAX_HOURS, 2);
    assert.equal(EARLY_LEAVE_MAX_PER_YEAR, 2);
    assert.equal(assertExcuseWindow('paid_excuse', '15:00', '17:00').hours, 2);
    assert.throws(() => assertExcuseWindow('paid_excuse', '15:00', '17:30'), /2 hours/);
    assert.equal(assertExcuseWindow('unpaid_excuse', '12:00', '17:00').hours, 5);
    const unpaid = computeUnpaidExcuseDeduction(3000, 5);
    assert.equal(unpaid.amount, Math.round((hourlyRate(3000) * 5 + Number.EPSILON) * 100) / 100);
  });

  it('enables holiday access after 6 months unless HR denies or grants', () => {
    const created = new Date('2026-01-19T00:00:00Z');
    const now = new Date('2026-08-19T00:00:00Z');
    assert.equal(canRequestHolidays({ holiday_access: 'auto', created_at: created }, now), true);
    assert.equal(
      canRequestHolidays({ holiday_access: 'auto', created_at: new Date('2026-03-19T00:00:00Z') }, now),
      false
    );
    assert.equal(canRequestHolidays({ holiday_access: 'granted', created_at: now }, now), true);
    assert.equal(canRequestHolidays({ holiday_access: 'denied', created_at: created }, now), false);
  });

  it('treats unpaid leave, excuses, and missions as open without holiday access, but all need approval', () => {
    assert.equal(isUnpaidLeaveUnlimited(), true);
    assert.equal(leaveTypeRequiresHolidayAccess('unpaid'), false);
    assert.equal(leaveTypeRequiresHolidayAccess('paid_excuse'), false);
    assert.equal(leaveTypeRequiresHolidayAccess('unpaid_excuse'), false);
    assert.equal(leaveTypeRequiresHolidayAccess('early_leave'), false);
    assert.equal(leaveTypeRequiresHolidayAccess('mission'), false);
    assert.equal(leaveTypeRequiresHolidayAccess('casual'), true);
    assert.equal(leaveTypeRequiresHolidayAccess('annual'), true);
    assert.equal(leaveTypeRequiresApproval('paid_excuse'), true);
    assert.equal(leaveTypeRequiresApproval('unpaid_excuse'), true);
    assert.equal(leaveTypeRequiresApproval('mission'), true);
    assert.equal(leaveTypeRequiresApproval('casual'), true);
    assert.equal(leaveTypeRequiresApproval('annual'), true);
    assert.equal(isExcuseLeaveType('paid_excuse'), true);
    assert.equal(isMissionLeaveType('mission'), true);
    assert.equal(leaveDoesNotAffectAttendance('mission'), true);
    assert.equal(leaveDoesNotAffectAttendance('paid_excuse'), true);
    assert.equal(leaveDoesNotAffectAttendance('casual'), false);
    assert.equal(normalizeExcuseLeaveType('early_leave'), 'paid_excuse');
    assert.equal(assertMissionWindow('09:00', '17:00').hours, 8);
  });

  it('sets leave approval rules: all types need manager AND HR Manager', () => {
    assert.deepEqual(leaveApprovalPolicy('annual', 'reservations_web'), {
      canRequest: true,
      needsManager: true,
      needsHr: true,
      approvalMode: 'all',
    });
    assert.deepEqual(leaveApprovalPolicy('casual', 'reservations_web'), {
      canRequest: true,
      needsManager: true,
      needsHr: true,
      approvalMode: 'all',
    });
    assert.deepEqual(leaveApprovalPolicy('unpaid', 'reservations_web'), {
      canRequest: true,
      needsManager: true,
      needsHr: true,
      approvalMode: 'all',
    });
    assert.deepEqual(leaveApprovalPolicy('paid_excuse', 'reservations_web'), {
      canRequest: true,
      needsManager: true,
      needsHr: true,
      approvalMode: 'all',
    });
    assert.deepEqual(leaveApprovalPolicy('unpaid_excuse', 'reservations_web'), {
      canRequest: true,
      needsManager: true,
      needsHr: true,
      approvalMode: 'all',
    });
    assert.deepEqual(leaveApprovalPolicy('mission', 'reservations_web'), {
      canRequest: true,
      needsManager: true,
      needsHr: true,
      approvalMode: 'all',
    });

    const unpaidReq = {
      status: 'pending',
      leave_type: 'unpaid',
      needs_manager_approval: true,
      needs_hr_approval: true,
      manager_reviewed_by: null,
      hr_reviewed_by: null,
      staff_user_id: 21,
    };
    const staff = { id: 21, role: 'reservations_web', manager_id: 12 };
    const managerApprove = applyRequestReview(
      unpaidReq,
      { id: 12, role: 'reservations_manager' },
      'approved',
      staff
    );
    assert.equal(managerApprove.finalized, false);
    assert.equal(managerApprove.status, 'pending');

    const annualReq = {
      status: 'pending',
      leave_type: 'annual',
      needs_manager_approval: true,
      needs_hr_approval: true,
      manager_reviewed_by: null,
      hr_reviewed_by: null,
      staff_user_id: 21,
    };
    const annualManagerOnly = applyRequestReview(
      annualReq,
      { id: 12, role: 'reservations_manager' },
      'approved',
      staff
    );
    assert.equal(annualManagerOnly.finalized, false);
    assert.equal(annualManagerOnly.status, 'pending');
  });

  it('schedules approved loans on the first of next month', () => {
    assert.deepEqual(nextPayrollPeriod('2026-08-19'), {
      year: 2026,
      month: 9,
      deductionDate: '2026-09-01',
    });
    assert.equal(nextPayrollPeriod('2026-12-31').deductionDate, '2027-01-01');
  });

  it('skips attendance when an approved holiday covers the date', () => {
    assert.equal(
      dateCoveredByRanges('2026-08-20', [{ start_date: '2026-08-18', end_date: '2026-08-22' }]),
      true
    );
    assert.equal(
      dateCoveredByRanges('2026-08-23', [{ start_date: '2026-08-18', end_date: '2026-08-22' }]),
      false
    );
  });

  it('parses attendance excel rows as lateness or absence', () => {
    const rows = parseAttendanceRows([
      { staff_code: 'SH1', date: '2026-08-19', arrival_time: '11:20' },
      { 'Staff Code': 'SH2', Date: '2026-08-19', Status: 'absent', notified: 'yes' },
    ]);
    assert.equal(rows[0].absent, false);
    assert.equal(rows[0].arrival_time, '11:20');
    assert.equal(rows[1].absent, true);
    assert.equal(rows[1].notified, true);
  });

  it('reads door punch logs by Person ID, Time, and Attendance Status', () => {
    const punches = parseAttendanceRows([
      {
        'Person ID': "'15",
        Time: '2026-05-31 12:03:17',
        'Attendance Status': 'Check-in',
      },
      {
        'Person ID': "'15",
        Time: '2026-05-31 18:00:51',
        'Attendance Status': 'Check-out',
      },
      {
        'Person ID': "'15",
        Time: '8/30/2026 11:06',
        'Attendance Status': 'Check-in',
      },
    ]);
    assert.equal(isDoorPunchLog(punches), true);
    assert.equal(toIsoDate('8/30/2026 11:06'), '2026-08-30');
    const daily = collapsePunchAttendance(punches);
    const may31 = daily.find((r) => r.date === '2026-05-31');
    const aug30 = daily.find((r) => r.date === '2026-08-30');
    assert.equal(may31.staff_code, '15');
    assert.equal(may31.arrival_time, '12:03');
    assert.equal(may31.check_out, '18:00');
    assert.equal(may31.absent, false);
    assert.equal(aug30.arrival_time, '11:06');
    assert.equal(aug30.check_out, DEFAULT_ATTENDANCE_CHECKOUT);
  });

  it('requires the Original Records Report column headers', () => {
    assert.doesNotThrow(() =>
      assertOriginalRecordsAttendanceTemplate([
        { 'Person ID': '15', Time: '8/30/2026 11:06', 'Attendance Status': 'Check-in' },
      ])
    );
    assert.doesNotThrow(() =>
      assertOriginalRecordsAttendanceTemplate([
        { 'Personal ID': '15', Time: '8/30/2026 11:06', 'Attendance Status': 'Check-in' },
      ])
    );
    assert.throws(
      () => assertOriginalRecordsAttendanceTemplate([{ Name: 'Wael', Date: '2026-08-30' }]),
      /Wrong template/
    );
  });

  it('parses the HTML .xls door report layout', () => {
    const html = `
      <table><tr>
        <td colspan="11">Original Records Report</td>
      </tr></table>
      <table><tr>
        <td>Person ID</td><td>Name</td><td>Department</td><td>Time</td>
        <td>Attendance Status</td><td>Attendance Check Point</td><td>Custom Name</td>
        <td>Data Source</td><td>Handling Type</td><td>Temperature</td><td>Abnormal</td>
      </tr></table>
      <table><tr>
        <td>'15</td><td>Wael</td><td>New Organization</td><td>2026-05-31 12:03:17</td>
        <td>Check-in</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
      </tr>
      <td>'15</td><td>Wael</td><td>New Organization</td><td>2026-05-31 18:00:51</td>
      <td>Check-out</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
      </tr>
      <td>'103</td><td>Hana</td><td>New Organization</td><td>2026-06-04 09:36:39</td>
      <td>Overtime-Out</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>
      </tr></table>`;
    const json = parseHtmlExcelTables(html);
    const rows = parseAttendanceRows(json);
    assert.equal(json.length, 3);
    assert.equal(rows[0].staff_code, '15');
    assert.equal(rows[0].date, '2026-05-31');
    assert.equal(rows[0].arrival_time, '12:03');
    assert.equal(rows[0].is_check_in, true);
    assert.equal(rows[1].is_check_out, true);
    assert.equal(rows[1].arrival_time, '18:00');
    assert.equal(rows[2].staff_code, '103');
    assert.equal(rows[2].is_check_out, true);
  });

  it('fills absences by staff id and skips admin and operations', () => {
    const daily = [
      {
        staff_code: '15',
        name: 'Hana',
        date: '2026-06-02',
        arrival_time: '09:49',
        check_out: '18:00',
        absent: false,
      },
    ];
    const staff = [
      { id: 15, staff_code: 'SH15', full_name: 'Hana Kamal', role: 'hr' },
      { id: 22, staff_code: 'AYA', full_name: 'Aya Ahmed', role: 'reservations_web' },
      { id: 8, staff_code: 'OPS1', full_name: 'Field Agent', role: 'operations' },
      { id: 1, staff_code: 'ADM', full_name: 'Boss', role: 'admin' },
    ];
    const extra = fillMissingOfficeAbsences(daily, staff);
    assert.equal(extra.length, 1);
    assert.equal(extra[0].staff_code, '22');
    assert.equal(extra[0].date, '2026-06-02');
    assert.equal(extra[0].absent, true);
  });

  it('splits lateness and absence as penalties, loans as deductions', () => {
    const split = splitSalaryAdjustments([
      { amount: 75, category: 'lateness' },
      { amount: 300, category: 'loan' },
      { amount: 150, category: 'wfh' },
    ]);
    assert.equal(split.penalties_total, 75);
    assert.equal(split.deductions_total, 450);
  });

  it('requires office attendance for resale and unit acquisition managers only among line managers', () => {
    assert.equal(hasOfficeAttendance('operations'), false);
    assert.equal(hasOfficeAttendance('operations_supervisor'), false);
    assert.equal(hasOfficeAttendance('reservations_manager'), false);
    assert.equal(hasOfficeAttendance('resale_manager'), true);
    assert.equal(hasOfficeAttendance('unit_acquisition_manager'), true);
    assert.equal(hasOfficeAttendance('hr'), true);
    assert.equal(hasOfficeAttendance('hr_supervisor'), false);
    assert.equal(hasOfficeAttendance('reservations_web'), true);
    assert.equal(hasOfficeAttendance('admin'), false);
    assert.equal(hasOfficeAttendance('owner'), false);
    assert.equal(hasOfficeAttendance('web_developer'), false);
    assert.equal(hasOfficeAttendance('finance_manager'), false);
    assert.equal(
      hasOfficeAttendance('reservations_web', { office_attendance_exempt: true }),
      false
    );
    assert.equal(canRequestStaffBenefits('admin'), false);
    assert.equal(canRequestStaffBenefits('reservations_web'), true);
    assert.equal(canRequestLoan('admin'), true);
    assert.equal(canRequestLoan('owner'), true);
    assert.equal(canRequestLoan('reservations_web'), true);
    assert.equal(canRequestLoan(''), false);
    assert.deepEqual(loanRequestPolicy('admin'), {
      canRequest: true,
      needsManager: false,
      needsFinance: true,
      needsHr: true,
    });
    assert.equal(canRequestWfh('web_developer'), false);
    assert.equal(canRequestWfh('operations_supervisor'), false);
    assert.equal(canRequestWfh('reservations_web'), true);
  });

  it('treats only the primary web developer manager as a request approver', () => {
    const { isLineManager } = require('./hrRules');
    const webDev = { id: 20, role: 'web_developer', manager_id: 5, manager_ids: [5, 8] };
    assert.equal(isLineManager({ id: 5, role: 'admin' }, webDev), true);
    assert.equal(isLineManager({ id: 8, role: 'hr_supervisor' }, webDev), false);
    assert.equal(isLineManager({ id: 9, role: 'hr_supervisor' }, webDev), false);
  });

  it('lets every web developer manager review slots only for the primary manager', () => {
    const webDevReq = {
      status: 'pending',
      staff_user_id: 20,
      role: 'web_developer',
      manager_id: 5,
      needs_manager_approval: true,
      needs_hr_approval: true,
    };
    const webDev = { id: 20, role: 'web_developer', manager_id: 5, manager_ids: [5, 8] };
    assert.deepEqual(
      eligibleReviewSlots({ id: 5, role: 'reservations_manager' }, webDevReq, webDev),
      ['manager']
    );
    // HR can see the request but cannot act until the primary manager accepts.
    assert.deepEqual(eligibleReviewSlots({ id: 8, role: 'hr_supervisor' }, webDevReq, webDev), []);
    assert.deepEqual(
      eligibleReviewSlots({ id: 8, role: 'reservations_manager' }, webDevReq, webDev),
      []
    );
    assert.deepEqual(
      eligibleReviewSlots(
        { id: 8, role: 'hr_supervisor' },
        { ...webDevReq, manager_reviewed_by: 5 },
        webDev
      ),
      ['hr']
    );
  });

  it('strips a leading apostrophe from Person ID so \'15 matches 15', () => {
    assert.equal(normalizePersonId("'15"), '15');
    assert.equal(normalizePersonId("'103"), '103');
    assert.equal(normalizePersonId('‘22'), '22');
    assert.equal(normalizePersonId(15), '15');
    const staff = [{ id: 15, staff_code: 'SH15', full_name: 'Wael' }];
    assert.equal(matchAttendanceStaff({ staff_code: "'15" }, staff).id, 15);
  });

  it('matches door Person ID to Staff ID (staff_code) before internal user id', () => {
    const staff = [
      { id: 90, staff_code: '2424242', full_name: 'Omar Lotfy', role: 'finance_manager' },
      { id: 113, staff_code: '90', full_name: 'Salma Adel', role: 'unit_acquisition_manager' },
      { id: 22, staff_code: 'NRM', full_name: 'Nour Mahmoud' },
      { id: 30, staff_code: 'KF1', full_name: 'Karim Fawzy' },
    ];
    assert.equal(matchAttendanceStaff({ staff_code: "'90", name: 'Salma' }, staff).id, 113);
    assert.equal(matchAttendanceStaff({ staff_code: '90' }, staff).full_name, 'Salma Adel');
    assert.equal(matchAttendanceStaff({ staff_code: 'NRM' }, staff).id, 22);
    assert.equal(matchAttendanceStaff({ name: 'Unknown' }, staff), null);
  });

  it('matches door-report names when Person ID is missing', () => {
    const staff = [
      { id: 15, staff_code: 'SA15', full_name: 'Salma Adel' },
      { id: 22, staff_code: 'NRM', full_name: 'Nour Mahmoud' },
      { id: 30, staff_code: 'KF1', full_name: 'Karim Fawzy' },
    ];
    assert.equal(matchAttendanceStaff({ name: 'Karim' }, staff).id, 30);
    assert.equal(matchAttendanceStaff({ name: 'Nour Mahmoud' }, staff).id, 22);
    assert.equal(matchAttendanceStaff({ staff_code: '15' }, staff).id, 15);
  });

  it('requires manager + HR Manager for agents and HR staff; manager only for HR Manager', () => {
    assert.deepEqual(staffRequestPolicy('reservations_web'), {
      canRequest: true,
      needsManager: true,
      needsHr: true,
    });
    assert.deepEqual(staffRequestPolicy('hr'), {
      canRequest: true,
      needsManager: true,
      needsHr: true,
    });
    assert.deepEqual(staffRequestPolicy('hr_supervisor'), {
      canRequest: true,
      needsManager: true,
      needsHr: false,
    });
    assert.equal(staffRequestPolicy('admin').canRequest, false);

    const agentReq = {
      status: 'pending',
      staff_user_id: 20,
      role: 'reservations_web',
      manager_id: 5,
      needs_manager_approval: true,
      needs_hr_approval: true,
    };
    const agent = { id: 20, role: 'reservations_web', manager_id: 5, manager_ids: [5] };
    const manager = { id: 5, role: 'reservations_manager' };
    const hrSuper = { id: 8, role: 'hr_supervisor' };
    const admin = { id: 1, role: 'admin' };

    assert.deepEqual(eligibleReviewSlots(manager, agentReq, agent), ['manager']);
    assert.deepEqual(eligibleReviewSlots(hrSuper, agentReq, agent), []);
    assert.deepEqual(eligibleReviewSlots(admin, agentReq, agent), ['admin']);
    assert.deepEqual(eligibleReviewSlots({ id: 20, role: 'reservations_web' }, agentReq, agent), []);
    assert.equal(describeRequestApproval(agentReq), 'Waiting for manager');

    const afterManager = applyRequestReview(agentReq, manager, 'approved', agent);
    assert.equal(afterManager.status, 'pending');
    assert.equal(afterManager.manager_reviewed_by, 5);
    assert.deepEqual(
      eligibleReviewSlots(hrSuper, { ...agentReq, manager_reviewed_by: 5 }, agent),
      ['hr']
    );
    assert.equal(
      describeRequestApproval({ ...agentReq, manager_reviewed_by: 5 }),
      'Waiting for HR Manager'
    );
    const afterHr = applyRequestReview(
      { ...agentReq, manager_reviewed_by: 5 },
      hrSuper,
      'approved',
      agent
    );
    assert.equal(afterHr.status, 'approved');
    assert.equal(afterHr.finalized, true);

    const hrReq = {
      status: 'pending',
      staff_user_id: 11,
      role: 'hr',
      needs_manager_approval: true,
      needs_hr_approval: true,
      manager_reviewed_by: null,
      hr_reviewed_by: null,
    };
    const hrStaff = { id: 11, role: 'hr', manager_id: 8, manager_ids: [8] };
    // HR Manager is also the line manager — first step is manager.
    assert.deepEqual(eligibleReviewSlots(hrSuper, hrReq, hrStaff), ['manager']);
    const afterHrManager = applyRequestReview(hrReq, hrSuper, 'approved', hrStaff);
    assert.equal(afterHrManager.status, 'pending');
    assert.equal(afterHrManager.manager_reviewed_by, 8);
    const afterHrHr = applyRequestReview(
      { ...hrReq, manager_reviewed_by: 8 },
      hrSuper,
      'approved',
      hrStaff
    );
    assert.equal(afterHrHr.status, 'approved');
    assert.equal(afterHrHr.finalized, true);

    const superReq = {
      status: 'pending',
      staff_user_id: 8,
      role: 'hr_supervisor',
      needs_manager_approval: true,
      needs_hr_approval: false,
    };
    const superStaff = { id: 8, role: 'hr_supervisor' };
    assert.deepEqual(eligibleReviewSlots(hrSuper, superReq, superStaff), []);
    assert.deepEqual(eligibleReviewSlots(admin, superReq, superStaff), ['admin']);
    assert.equal(applyRequestReview(superReq, admin, 'approved', superStaff).status, 'approved');
  });

  it('lets HR and HR Manager change pay and leave for any staff including themselves', () => {
    const supervisor = { id: 10, role: 'hr_supervisor' };
    const hr = { id: 11, role: 'hr' };
    const admin = { id: 1, role: 'admin' };
    assert.equal(canEditStaffCompensation(admin, 10), true);
    assert.equal(canEditStaffCompensation(supervisor, 11), true);
    assert.equal(canEditStaffCompensation(supervisor, 10), true);
    assert.equal(canEditStaffCompensation(hr, 12), true);
    assert.equal(canEditStaffCompensation(hr, 11), true);
    assert.equal(appliesSalaryImmediately(admin), true);
    assert.equal(appliesSalaryImmediately(supervisor), true);
    assert.equal(appliesSalaryImmediately(hr), true);
    assert.equal(isHrActingOnSelf(supervisor, 10), true);
    assert.equal(isHrActingOnSelf(hr, 11), true);
    assert.doesNotThrow(() => assertCanEditStaffCompensation(supervisor, 11));
    assert.doesNotThrow(() => assertCanEditStaffCompensation(supervisor, 10));
    assert.doesNotThrow(() => assertCanEditStaffCompensation(hr, 12));
    assert.doesNotThrow(() => assertCanEditStaffCompensation(hr, 11));
  });

  it('requires HR Manager then Financial Manager for loans (no line manager)', () => {
    const { loanRequestPolicy, isLoanRequest, describeRequestApproval } = require('./hrRules');
    assert.deepEqual(loanRequestPolicy('reservations_web'), {
      canRequest: true,
      needsManager: false,
      needsFinance: true,
      needsHr: true,
    });
    assert.deepEqual(loanRequestPolicy('finance_manager'), {
      canRequest: true,
      needsManager: true,
      needsFinance: false,
      needsHr: true,
    });
    assert.deepEqual(loanRequestPolicy('hr_supervisor'), {
      canRequest: true,
      needsManager: true,
      needsFinance: true,
      needsHr: false,
    });

    const loanReq = {
      status: 'pending',
      request_kind: 'loan',
      amount: 1000,
      staff_user_id: 20,
      role: 'reservations_web',
      manager_id: 5,
      needs_manager_approval: false,
      needs_finance_approval: true,
      needs_hr_approval: true,
    };
    const agent = { id: 20, role: 'reservations_web', manager_id: 5, manager_ids: [5] };
    const lineManager = { id: 5, role: 'reservations_manager' };
    const financeMgr = { id: 9, role: 'finance_manager' };
    const hrMgr = { id: 8, role: 'hr_supervisor' };

    assert.equal(isLoanRequest(loanReq), true);
    assert.deepEqual(eligibleReviewSlots(lineManager, loanReq, agent), []);
    assert.deepEqual(eligibleReviewSlots(hrMgr, loanReq, agent), ['hr']);
    assert.deepEqual(eligibleReviewSlots(financeMgr, loanReq, agent), []);
    assert.equal(describeRequestApproval(loanReq), 'Waiting for HR Manager');

    const afterHr = applyRequestReview(loanReq, hrMgr, 'approved', agent);
    assert.equal(afterHr.status, 'pending');
    assert.equal(afterHr.hr_reviewed_by, 8);

    const afterHrReq = { ...loanReq, hr_reviewed_by: 8 };
    assert.deepEqual(eligibleReviewSlots(financeMgr, afterHrReq, agent), ['finance']);
    assert.equal(describeRequestApproval(afterHrReq), 'Waiting for Financial Manager');

    const afterFinance = applyRequestReview(afterHrReq, financeMgr, 'approved', agent);
    assert.equal(afterFinance.status, 'approved');
    assert.equal(afterFinance.finalized, true);
  });

  it('blocks HR from approving holidays until the manager accepts', () => {
    const annualReq = {
      status: 'pending',
      leave_type: 'annual',
      needs_manager_approval: true,
      needs_hr_approval: true,
      manager_reviewed_by: null,
      hr_reviewed_by: null,
      staff_user_id: 21,
    };
    const staff = { id: 21, role: 'reservations_web', manager_id: 12, manager_ids: [12] };
    const manager = { id: 12, role: 'reservations_manager' };
    const hrMgr = { id: 8, role: 'hr_supervisor' };

    assert.deepEqual(eligibleReviewSlots(hrMgr, annualReq, staff), []);
    assert.equal(describeRequestApproval(annualReq), 'Waiting for manager');

    const afterManager = applyRequestReview(annualReq, manager, 'approved', staff);
    assert.equal(afterManager.finalized, false);
    assert.equal(afterManager.manager_reviewed_by, 12);

    const waitingHr = { ...annualReq, manager_reviewed_by: 12 };
    assert.deepEqual(eligibleReviewSlots(hrMgr, waitingHr, staff), ['hr']);
    assert.equal(describeRequestApproval(waitingHr), 'Waiting for HR Manager');
  });

  it('uses the same manager-then-HR cycle for WFH as for annual holidays', () => {
    const { wfhRequestPolicy } = require('./hrRules');
    assert.deepEqual(wfhRequestPolicy('reservations_web'), {
      canRequest: true,
      needsManager: true,
      needsHr: true,
      approvalMode: 'all',
    });
    assert.deepEqual(leaveApprovalPolicy('annual', 'reservations_web'), {
      canRequest: true,
      needsManager: true,
      needsHr: true,
      approvalMode: 'all',
    });

    const wfhReq = {
      status: 'pending',
      request_kind: 'wfh',
      work_date: '2026-09-10',
      needs_manager_approval: true,
      needs_hr_approval: true,
      manager_reviewed_by: null,
      hr_reviewed_by: null,
      staff_user_id: 21,
    };
    const staff = { id: 21, role: 'reservations_web', manager_id: 12, manager_ids: [12] };
    const manager = { id: 12, role: 'reservations_manager' };
    const hrMgr = { id: 8, role: 'hr_supervisor' };

    assert.deepEqual(eligibleReviewSlots(manager, wfhReq, staff), ['manager']);
    assert.deepEqual(eligibleReviewSlots(hrMgr, wfhReq, staff), []);
    assert.equal(describeRequestApproval(wfhReq), 'Waiting for manager');

    const afterManager = applyRequestReview(wfhReq, manager, 'approved', staff);
    assert.equal(afterManager.status, 'pending');
    assert.equal(afterManager.finalized, false);

    const waitingHr = { ...wfhReq, manager_reviewed_by: 12 };
    assert.deepEqual(eligibleReviewSlots(hrMgr, waitingHr, staff), ['hr']);
    assert.equal(describeRequestApproval(waitingHr), 'Waiting for HR Manager');

    const afterHr = applyRequestReview(waitingHr, hrMgr, 'approved', staff);
    assert.equal(afterHr.status, 'approved');
    assert.equal(afterHr.finalized, true);
  });
});
