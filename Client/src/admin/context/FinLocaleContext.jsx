import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import en from '../../i18n/en.json';
import ar from '../../i18n/ar.json';

const DICTS = { en, ar };
const STORAGE_KEY = 'ch_fin_locale';

const FinLocaleContext = createContext(null);

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  return String(path)
    .split('.')
    .reduce((cur, key) => (cur != null ? cur[key] : undefined), obj);
}

function interpolate(template, vars = {}) {
  if (template == null) return template;
  return String(template).replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : `{{${key}}}`
  );
}

export function FinLocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'ar' || stored === 'en' ? stored : 'en';
    } catch {
      return 'en';
    }
  });

  const setLocale = useCallback((next) => {
    setLocaleState(next === 'ar' ? 'ar' : 'en');
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((cur) => (cur === 'ar' ? 'en' : 'ar'));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {}
  }, [locale]);

  const t = useCallback(
    (key, vars) => {
      const dict = DICTS[locale] || en;
      let value = getByPath(dict, key);
      if (value == null) value = getByPath(en, key);
      if (value == null) return key;
      if (typeof value !== 'string') return value;
      return interpolate(value, vars);
    },
    [locale]
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      toggleLocale,
      t,
      isRtl: locale === 'ar',
    }),
    [locale, setLocale, toggleLocale, t]
  );

  return (
    <FinLocaleContext.Provider value={value}>{children}</FinLocaleContext.Provider>
  );
}

export function useFinLocale() {
  const ctx = useContext(FinLocaleContext);
  if (!ctx) throw new Error('useFinLocale within FinLocaleProvider');
  return ctx;
}
