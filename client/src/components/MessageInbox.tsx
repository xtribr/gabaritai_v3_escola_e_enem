import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Mail,
  MailOpen,
  Loader2,
  CheckCheck,
  Calendar,
  Clock,
  Inbox as InboxIcon,
  RefreshCw,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface Message {
  id: string;
  message_id: string;
  title: string;
  content: string;
  created_at: string;
  expires_at: string;
  read_at: string | null;
}

interface MessageInboxProps {
  maxHeight?: string;
  showHeader?: boolean;
  onUnreadCountChange?: (count: number) => void;
}

export function MessageInbox({
  maxHeight = '400px',
  showHeader = true,
  onUnreadCountChange
}: MessageInboxProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [markingAsRead, setMarkingAsRead] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchMessages = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/messages', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Erro ao buscar mensagens');
      }

      const data = await response.json();
      setMessages(data.messages || []);
      setUnreadCount(data.unread_count || 0);
      onUnreadCountChange?.(data.unread_count || 0);
    } catch (error) {
      console.error('Erro ao buscar mensagens:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível carregar as mensagens',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
    // Atualizar a cada 60 segundos
    const interval = setInterval(fetchMessages, 60000);
    return () => clearInterval(interval);
  }, []);

  const markAsRead = async (messageId: string) => {
    try {
      setMarkingAsRead(messageId);
      const response = await fetch(`/api/messages/${messageId}/read`, {
        method: 'PATCH',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Erro ao marcar como lida');
      }

      // Atualizar estado local
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId ? { ...m, read_at: new Date().toISOString() } : m
        )
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
      onUnreadCountChange?.(Math.max(0, unreadCount - 1));
    } catch (error) {
      console.error('Erro ao marcar como lida:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível marcar a mensagem como lida',
        variant: 'destructive',
      });
    } finally {
      setMarkingAsRead(null);
    }
  };

  const markAllAsRead = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/messages/read-all', {
        method: 'PATCH',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Erro ao marcar todas como lidas');
      }

      // Atualizar estado local
      setMessages(prev =>
        prev.map(m => ({ ...m, read_at: m.read_at || new Date().toISOString() }))
      );
      setUnreadCount(0);
      onUnreadCountChange?.(0);

      toast({
        title: 'Sucesso',
        description: 'Todas as mensagens foram marcadas como lidas',
      });
    } catch (error) {
      console.error('Erro ao marcar todas como lidas:', error);
      toast({
        title: 'Erro',
        description: 'Não foi possível marcar todas as mensagens como lidas',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMessageClick = (message: Message) => {
    setSelectedMessage(message);
    if (!message.read_at) {
      markAsRead(message.id);
    }
  };

  if (isLoading && messages.length === 0) {
    return (
      <Card>
        {showHeader && (
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Mensagens
            </CardTitle>
          </CardHeader>
        )}
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {showHeader && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Mensagens
              {unreadCount > 0 && (
                <Badge variant="destructive" className="ml-2">
                  {unreadCount} nova{unreadCount > 1 ? 's' : ''}
                </Badge>
              )}
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchMessages}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              </Button>
              {unreadCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={markAllAsRead}
                  disabled={isLoading}
                >
                  <CheckCheck className="h-4 w-4 mr-1" />
                  Marcar todas como lidas
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      )}
      <CardContent className="p-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <InboxIcon className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-sm">Nenhuma mensagem</p>
          </div>
        ) : selectedMessage ? (
          // Visualização da mensagem selecionada
          <div className="p-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedMessage(null)}
              className="mb-4"
            >
              ← Voltar
            </Button>
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold">{selectedMessage.title}</h3>
                <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {formatDistanceToNow(new Date(selectedMessage.created_at), {
                      addSuffix: true,
                      locale: ptBR,
                    })}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Expira em{' '}
                    {formatDistanceToNow(new Date(selectedMessage.expires_at), {
                      locale: ptBR,
                    })}
                  </span>
                </div>
              </div>
              <Separator />
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{selectedMessage.content}</ReactMarkdown>
              </div>
            </div>
          </div>
        ) : (
          // Lista de mensagens
          <ScrollArea style={{ maxHeight }}>
            <div className="divide-y">
              {messages.map((message) => (
                <button
                  key={message.id}
                  onClick={() => handleMessageClick(message)}
                  className={`w-full text-left p-4 hover:bg-muted/50 transition-colors ${
                    !message.read_at ? 'bg-primary/5' : ''
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      {markingAsRead === message.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : message.read_at ? (
                        <MailOpen className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Mail className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm truncate ${
                            !message.read_at ? 'font-semibold' : ''
                          }`}
                        >
                          {message.title}
                        </span>
                        {!message.read_at && (
                          <Badge variant="default" className="text-xs px-1.5 py-0">
                            Nova
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {message.content.replace(/[#*_`]/g, '').substring(0, 100)}...
                      </p>
                      <span className="text-xs text-muted-foreground mt-1 block">
                        {formatDistanceToNow(new Date(message.created_at), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
