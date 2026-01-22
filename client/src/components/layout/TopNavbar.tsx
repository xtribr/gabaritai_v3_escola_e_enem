import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { Menu, Moon, Sun, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ProfileMenu } from '@/components/ProfileMenu';
import { MessageInbox } from '@/components/MessageInbox';
import { NavItem } from './NavItem';
import { MobileNavDrawer } from './MobileNavDrawer';
import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export interface NavItemConfig {
  id: string;
  label: string;
  icon?: LucideIcon;
}

interface TopNavbarProps {
  items: NavItemConfig[];
  activeItem: string;
  onItemClick: (id: string) => void;
  className?: string;
}

export function TopNavbar({ items, activeItem, onItemClick, className }: TopNavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { profile } = useAuth();

  // Buscar contagem de mensagens não lidas
  useEffect(() => {
    const fetchUnreadCount = async () => {
      // Apenas para alunos e school_admins (não para super_admin que é quem envia)
      if (!profile || profile.role === 'super_admin') return;

      try {
        const response = await fetch('/api/messages', {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setUnreadCount(data.unread_count || 0);
        }
      } catch (error) {
        console.error('Erro ao buscar mensagens:', error);
      }
    };

    fetchUnreadCount();
    // Atualizar a cada 60 segundos
    const interval = setInterval(fetchUnreadCount, 60000);
    return () => clearInterval(interval);
  }, [profile]);

  const toggleTheme = () => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  // Verificar se deve mostrar o ícone de mensagens (não para super_admin)
  const showMessagesIcon = profile && profile.role !== 'super_admin';

  return (
    <>
      <header
        className={cn(
          'sticky top-0 z-40 w-full border-b border-slate-200 dark:border-slate-800',
          'bg-white/95 dark:bg-slate-900/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-slate-900/60',
          className
        )}
      >
        <div className="mx-auto max-w-7xl px-4 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Logo & Mobile Menu */}
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setMobileMenuOpen(true)}
              >
                <Menu className="h-5 w-5" />
                <span className="sr-only">Abrir menu</span>
              </Button>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                  <span className="text-primary-foreground font-bold text-sm">G</span>
                </div>
                <span className="font-bold text-xl text-slate-900 dark:text-slate-100 hidden sm:block">
                  GabaritAI
                </span>
              </div>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-1">
              {items.map((item) => (
                <NavItem
                  key={item.id}
                  label={item.label}
                  icon={item.icon}
                  isActive={activeItem === item.id}
                  onClick={() => onItemClick(item.id)}
                />
              ))}
            </nav>

            {/* Right Side Actions */}
            <div className="flex items-center gap-2">
              {/* Ícone de Mensagens (apenas para alunos e school_admins) */}
              {showMessagesIcon && (
                <Popover open={messagesOpen} onOpenChange={setMessagesOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="relative text-slate-600 dark:text-slate-400"
                    >
                      <Bell className="h-5 w-5" />
                      {unreadCount > 0 && (
                        <Badge
                          variant="destructive"
                          className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
                        >
                          {unreadCount > 9 ? '9+' : unreadCount}
                        </Badge>
                      )}
                      <span className="sr-only">Mensagens</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-96 p-0" align="end">
                    <MessageInbox
                      maxHeight="350px"
                      showHeader={true}
                      onUnreadCountChange={setUnreadCount}
                    />
                  </PopoverContent>
                </Popover>
              )}

              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="text-slate-600 dark:text-slate-400"
              >
                {theme === 'dark' ? (
                  <Sun className="h-5 w-5" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
                <span className="sr-only">Alternar tema</span>
              </Button>
              <ProfileMenu />
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      <MobileNavDrawer
        open={mobileMenuOpen}
        onOpenChange={setMobileMenuOpen}
        items={items}
        activeItem={activeItem}
        onItemClick={onItemClick}
      />
    </>
  );
}
