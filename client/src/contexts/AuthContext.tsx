import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@shared/database.types';
import { ChangePasswordModal } from '@/components/ChangePasswordModal';

type UserRole = 'super_admin' | 'school_admin' | 'student';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, metadata: {
    name: string;
    role: UserRole;
    school_id?: string;
    student_number?: string;
    turma?: string;
  }) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  // Helper functions
  hasRole: (role: UserRole | UserRole[]) => boolean;
  isSuperAdmin: boolean;
  isSchoolAdmin: boolean;
  isStudent: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForceChangePassword, setShowForceChangePassword] = useState(false);

  useEffect(() => {
    // Buscar sessão inicial
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user && session) {
        fetchProfile(session.user.id, session);
      } else {
        setLoading(false);
      }
    });

    // Listener para mudanças de auth
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('[AuthContext] Auth state changed:', event);
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user && session) {
          await fetchProfile(session.user.id, session);
        } else {
          setProfile(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(userId: string, sessionParam?: Session | null) {
    console.log('[AuthContext] Fetching profile for:', userId);

    try {
      // Usar sessão passada como parâmetro OU buscar nova
      let accessToken = sessionParam?.access_token;
      if (!accessToken) {
        console.log('[AuthContext] No session param, fetching from getSession...');
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        accessToken = currentSession?.access_token;
      }

      if (!accessToken) {
        console.error('[AuthContext] No access token available');
        throw new Error('No access token');
      }

      // Timeout de 10 segundos para evitar loading infinito
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      // Usar endpoint do backend que bypassa RLS
      const response = await fetch(`/api/profile/${userId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log('[AuthContext] Profile loaded:', data?.role);

      if (data && data.id) {
        setProfile(data);
        // Verificar se precisa forçar troca de senha
        console.log('[AuthContext] Verificando must_change_password:', data.must_change_password);
        if (data.must_change_password) {
          console.log('[AuthContext] Mostrando modal de troca de senha forçada');
          setShowForceChangePassword(true);
        } else {
          console.log('[AuthContext] Não precisa trocar senha');
        }
      } else {
        console.warn('[AuthContext] Profile not found for userId:', userId);
        setProfile(null);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error('[AuthContext] Profile fetch timed out after 10s');
      } else {
        console.error('[AuthContext] Error fetching profile:', error?.message || error);
      }
      setProfile(null);
    } finally {
      console.log('[AuthContext] Setting loading to false');
      setLoading(false);
    }
  }

  async function refreshProfile() {
    if (user && session) {
      await fetchProfile(user.id, session);
    }
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error as Error | null };
  }

  async function signUp(
    email: string,
    password: string,
    metadata: {
      name: string;
      role: 'super_admin' | 'school_admin' | 'student';
      school_id?: string;
      student_number?: string;
      turma?: string;
    }
  ) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
      },
    });
    return { error: error as Error | null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setSession(null);
  }

  // Helper: verificar se usuário tem determinada role
  function hasRole(role: UserRole | UserRole[]): boolean {
    if (!profile) return false;
    if (Array.isArray(role)) {
      return role.includes(profile.role as UserRole);
    }
    return profile.role === role;
  }

  // Computed booleans para fácil acesso
  const isSuperAdmin = profile?.role === 'super_admin';
  const isSchoolAdmin = profile?.role === 'school_admin';
  const isStudent = profile?.role === 'student';

  const handleForcePasswordChangeSuccess = async () => {
    console.log('[AuthContext] Senha alterada com sucesso, fechando modal e recarregando profile');
    setShowForceChangePassword(false);
    // Recarregar profile para atualizar must_change_password
    if (user && session) {
      await fetchProfile(user.id, session);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      session,
      loading,
      signIn,
      signUp,
      signOut,
      refreshProfile,
      hasRole,
      isSuperAdmin,
      isSchoolAdmin,
      isStudent,
    }}>
      {children}
      {/* Modal de sugestão de troca de senha (opcional - pode pular) */}
      {profile && showForceChangePassword && (
        <ChangePasswordModal
          open={showForceChangePassword}
          onClose={() => setShowForceChangePassword(false)}
          onSuccess={handleForcePasswordChangeSuccess}
          isForced={true}
          isFirstLogin={true}
          userId={profile.id}
        />
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
}
