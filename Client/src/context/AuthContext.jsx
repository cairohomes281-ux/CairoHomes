import { createContext, useContext, useMemo, useState, useCallback, useEffect } from 'react';
import api from '../api/http';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('ch_guest_user'));
    } catch {
      return null;
    }
  });
  const [salesUser, setSalesUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('ch_sales_user'));
    } catch {
      return null;
    }
  });

  const clearStaffSession = useCallback(() => {
    localStorage.removeItem('pms_token');
    localStorage.removeItem('pms_user');
  }, []);

  const clearGuestSession = useCallback(() => {
    localStorage.removeItem('ch_guest_token');
    localStorage.removeItem('ch_guest_user');
    setUser(null);
  }, []);

  const signIn = useCallback(async (identity, password, options = {}) => {
    const staffOnly = Boolean(options.staffOnly);

    const tryStaff = async () => {
      const { data } = await api.post('/staff/auth/login', {
        username: identity.trim(),
        password,
      });
      clearGuestSession();
      const userPayload = {
        ...data.user,
        is_first_login: Boolean(data.user?.is_first_login || data.forcePasswordChange),
      };
      localStorage.setItem('pms_token', data.token);
      localStorage.setItem('pms_user', JSON.stringify(userPayload));
      return { kind: 'staff', user: userPayload, forcePasswordChange: userPayload.is_first_login };
    };

    const tryGuest = async () => {
      const { data } = await api.post('/auth/sign-in', {
        email: identity.trim(),
        password,
      });
      clearStaffSession();
      localStorage.setItem('ch_guest_token', data.accessToken);
      localStorage.setItem('ch_guest_user', JSON.stringify(data.user));
      setUser(data.user);
      return { kind: 'guest', user: data.user };
    };

    if (staffOnly) {
      return tryStaff();
    }

    const looksLikeEmail = identity.includes('@');
    if (looksLikeEmail) {
      try {
        return await tryGuest();
      } catch (guestErr) {
        try {
          return await tryStaff();
        } catch {
          throw guestErr;
        }
      }
    }

    try {
      return await tryStaff();
    } catch (staffErr) {
      try {
        return await tryGuest();
      } catch {
        throw staffErr;
      }
    }
  }, [clearGuestSession, clearStaffSession]);

  const signUp = useCallback(async (payload) => {
    const { data } = await api.post('/auth/sign-up', payload);
    if (data.accessToken) {
      localStorage.setItem('ch_guest_token', data.accessToken);
      localStorage.setItem('ch_guest_user', JSON.stringify(data.user));
      setUser(data.user);
    }
    return data;
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem('ch_guest_token');
    localStorage.removeItem('ch_guest_user');
    setUser(null);
  }, []);

  const salesLogin = useCallback(async (username, password) => {
    const { data } = await api.post('/staff/auth/login', { username, password });
    localStorage.setItem('ch_sales_token', data.token);
    localStorage.setItem('ch_sales_user', JSON.stringify(data.user));
    setSalesUser(data.user);
    return data.user;
  }, []);

  const salesLogout = useCallback(() => {
    localStorage.removeItem('ch_sales_token');
    localStorage.removeItem('ch_sales_user');
    setSalesUser(null);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('ch_guest_token');
    if (!token) return;
    api.get('/auth/me').then((r) => {
      if (r.data?.user) {
        setUser(r.data.user);
        localStorage.setItem('ch_guest_user', JSON.stringify(r.data.user));
      }
    }).catch(() => signOut());
  }, [signOut]);

  const value = useMemo(
    () => ({ user, signIn, signUp, signOut, salesUser, salesLogin, salesLogout }),
    [user, signIn, signUp, signOut, salesUser, salesLogin, salesLogout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth within AuthProvider');
  return ctx;
}
