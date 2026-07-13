import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, setAccessToken } from "./api";
type Session = { user: { id: string; email: string; firstName: string; lastName: string }; business: { id: string; name: string; onboardingComplete: boolean }; role: string };
const AuthContext = createContext<{ session: Session | null; loading: boolean; reload: () => Promise<void>; logout: () => Promise<void> } | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null); const [loading, setLoading] = useState(true);
  const reload = async () => { try { const { data } = await api.get("/auth/me"); setSession(data.data); } catch { setSession(null); } finally { setLoading(false); } };
  useEffect(() => { void reload(); }, []);
  const logout = async () => { try { await api.post("/auth/logout"); } finally { setAccessToken(null); setSession(null); } };
  return <AuthContext.Provider value={{ session, loading, reload, logout }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => { const value = useContext(AuthContext); if (!value) throw new Error("AuthProvider missing"); return value; };
