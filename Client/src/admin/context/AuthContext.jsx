import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import api from '../api/axios';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pms_user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('pms_token');
    if (token) {
      api.get('/auth/me')
        .then((res) => {
          const next = res.data?.user || res.data;
          setUser(next);
          localStorage.setItem('pms_user', JSON.stringify(next));
        })
        .catch(() => {
          localStorage.removeItem('pms_token');
          localStorage.removeItem('pms_user');
          setUser(null);
          queryClient.clear();
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [queryClient]);

  const login = useCallback(async (username, password) => {
    // Drop previous account's cached lists before switching users.
    queryClient.clear();
    const res = await api.post('/auth/login', { username, password });
    const userPayload = {
      ...res.data.user,
      is_first_login: Boolean(res.data.user?.is_first_login || res.data.forcePasswordChange),
    };
    localStorage.setItem('pms_token', res.data.token);
    localStorage.setItem('pms_user', JSON.stringify(userPayload));
    setUser(userPayload);
    return userPayload;
  }, [queryClient]);

  const logout = useCallback(() => {
    localStorage.removeItem('pms_token');
    localStorage.removeItem('pms_user');
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  const refreshUser = useCallback(async () => {
    const res = await api.get('/auth/me');
    const raw = res.data?.user || res.data;
    const next = { ...raw, is_first_login: Boolean(raw?.is_first_login) };
    setUser(next);
    localStorage.setItem('pms_user', JSON.stringify(next));
    return next;
  }, []);

  const applySession = useCallback((token, userPayload) => {
    if (token) localStorage.setItem('pms_token', token);
    if (userPayload) {
      const next = {
        ...userPayload,
        is_first_login: Boolean(userPayload?.is_first_login),
      };
      localStorage.setItem('pms_user', JSON.stringify(next));
      setUser(next);
      return next;
    }
    return null;
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, refreshUser, applySession }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
