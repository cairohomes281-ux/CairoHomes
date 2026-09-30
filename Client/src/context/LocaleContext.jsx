import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';
import en from '../i18n/en.json';
import ar from '../i18n/ar.json';

const DICTS = { en, ar };
const STORAGE_KEY = 'ch_locale';

const LocaleContext = createContext(null);

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

function isStaffPath(pathname = '') {
  return pathname.startsWith('/admin') || pathname.startsWith('/sales');
}

export function LocaleProvider({ children }) {
  const { pathname } = useLocation();
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

  // Guest website only — PMS/admin stays English at the shell level
  const effectiveLocale = isStaffPath(pathname) ? 'en' : locale;

  useEffect(() => {
    const root = document.documentElement;
    root.lang = effectiveLocale === 'ar' ? 'ar' : 'en';
    root.dir = effectiveLocale === 'ar' ? 'rtl' : 'ltr';
  }, [effectiveLocale]);

  const t = useCallback(
    (key, vars) => {
      const dict = DICTS[effectiveLocale] || en;
      let value = getByPath(dict, key);
      if (value == null) value = getByPath(en, key);
      if (value == null) return key;
      if (typeof value !== 'string') return value;
      return interpolate(value, vars);
    },
    [effectiveLocale]
  );

  const tList = useCallback(
    (key) => {
      const dict = DICTS[effectiveLocale] || en;
      let value = getByPath(dict, key);
      if (!Array.isArray(value)) value = getByPath(en, key);
      return Array.isArray(value) ? value : [];
    },
    [effectiveLocale]
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      toggleLocale,
      t,
      tList,
      isRtl: effectiveLocale === 'ar',
      localeTag: effectiveLocale === 'ar' ? 'ar-EG' : 'en-US',
    }),
    [locale, setLocale, toggleLocale, t, tList, effectiveLocale]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale within LocaleProvider');
  return ctx;
}

export function useT() {
  return useLocale().t;
}
