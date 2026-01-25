import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { User, Lock, LogOut, Settings, ChevronDown } from 'lucide-react';
import { ChangePasswordModal } from './ChangePasswordModal';
import { EditProfileModal } from './EditProfileModal';

export function ProfileMenu() {
  const { profile, signOut } = useAuth();
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);

  console.log('[ProfileMenu] CÓDIGO NOVO CARREGADO - v2.0');

  if (!profile) return null;

  const initials = profile.name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const roleLabels: Record<string, string> = {
    super_admin: 'Super Admin',
    school_admin: 'Coordenador',
    student: 'Aluno',
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="flex items-center gap-2 px-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="hidden md:flex flex-col items-start">
              <span className="text-sm font-medium">{profile.name.split(' ')[0]}</span>
              <span className="text-xs text-muted-foreground">{roleLabels[profile.role] || profile.role}</span>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span className="font-medium">{profile.name}</span>
              <span className="text-xs text-muted-foreground font-normal">{profile.email}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setShowEditProfile(true)}>
            <User className="h-4 w-4 mr-2" />
            Meu Perfil
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => {
            console.log('[ProfileMenu] Abrindo modal com isForced=false e isFirstLogin=false');
            setShowChangePassword(true);
          }}>
            <Lock className="h-4 w-4 mr-2" />
            Alterar Senha
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut} className="text-red-600 focus:text-red-600">
            <LogOut className="h-4 w-4 mr-2" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangePasswordModal
        open={showChangePassword}
        onClose={() => setShowChangePassword(false)}
        onSuccess={() => {
          setShowChangePassword(false);
          // Mostrar toast de sucesso
        }}
        isForced={false}
        isFirstLogin={false}
        userId={profile.id}
      />

      <EditProfileModal
        open={showEditProfile}
        onClose={() => setShowEditProfile(false)}
        onSuccess={() => {
          setShowEditProfile(false);
          // Mostrar toast de sucesso
        }}
      />
    </>
  );
}
