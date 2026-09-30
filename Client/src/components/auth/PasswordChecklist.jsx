import { useLocale } from '../../context/LocaleContext';

const RULE_KEYS = [
  { key: 'minLength', i18nKey: 'common.passwordMinLength' },
  { key: 'uppercase', i18nKey: 'common.passwordUppercase' },
  { key: 'lowercase', i18nKey: 'common.passwordLowercase' },
];


export default function PasswordChecklist({ checks, className = '' }) {
  const { t } = useLocale();
  return (
    <div
      className={`grid gap-2 rounded-xl border border-ch-line bg-[var(--pms-header-tint,rgba(47,93,88,0.04))] p-3 sm:grid-cols-2 ${className}`}
    >
      {RULE_KEYS.map((rule) => {
        const passed = checks[rule.key];
        return (
          <div
            key={rule.key}
            className={`flex items-center gap-2 text-xs sm:text-sm ${
              passed ? 'text-emerald-700' : 'text-ch-muted'
            }`}
          >
            <span
              className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-[10px] ${
                passed
                  ? 'border-emerald-200 bg-emerald-50'
                  : 'border-ch-line bg-white'
              }`}
            >
              {passed ? '✓' : '×'}
            </span>
            <span>{t(rule.i18nKey)}</span>
          </div>
        );
      })}
    </div>
  );
}
