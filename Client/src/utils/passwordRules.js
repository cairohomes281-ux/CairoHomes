export function isPasswordPolicyExempt(_email) {
  return false;
}

export const getPasswordRuleChecks = (password, _email) => {
  const value = String(password || '');
  return {
    minLength: value.length >= 8,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
  };
};

export const passwordRuleItems = [
  { key: 'minLength', label: '8 characters minimum', labelKey: 'common.passwordMinLength' },
  { key: 'uppercase', label: 'At least one uppercase letter', labelKey: 'common.passwordUppercase' },
  { key: 'lowercase', label: 'At least one lowercase letter', labelKey: 'common.passwordLowercase' },
];

export function passwordPolicyOk(password, email) {
  return Object.values(getPasswordRuleChecks(password, email)).every(Boolean);
}

export function passwordPolicyMessage() {
  return 'Password must be at least 8 characters and include uppercase and lowercase letters';
}

/** Placeholder only — real temps come from the API response after create/reset. */
export const TEMP_STAFF_PASSWORD = '';
