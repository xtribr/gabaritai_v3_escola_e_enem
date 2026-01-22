import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Mail, Bell, ChevronLeft, ChevronRight } from 'lucide-react';
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

interface NewMessagesModalProps {
  onClose: () => void;
  onViewAll: () => void;
}

export function NewMessagesModal({ onClose, onViewAll }: NewMessagesModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const checkNewMessages = async () => {
      // Verificar se já mostrou o modal nesta sessão
      const sessionKey = 'messages_modal_shown';
      if (sessionStorage.getItem(sessionKey)) {
        return;
      }

      try {
        const response = await fetch('/api/messages', {
          credentials: 'include',
        });

        if (!response.ok) return;

        const data = await response.json();
        const unreadMessages = (data.messages || []).filter(
          (m: Message) => !m.read_at
        );

        if (unreadMessages.length > 0) {
          setMessages(unreadMessages);
          setOpen(true);
          sessionStorage.setItem(sessionKey, 'true');
        }
      } catch (error) {
        console.error('Erro ao verificar mensagens:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkNewMessages();
  }, []);

  const markAsRead = async (messageId: string) => {
    try {
      await fetch(`/api/messages/${messageId}/read`, {
        method: 'PATCH',
        credentials: 'include',
      });
    } catch (error) {
      console.error('Erro ao marcar como lida:', error);
    }
  };

  const handleClose = () => {
    // Marcar mensagem atual como lida ao fechar
    if (messages[currentIndex]) {
      markAsRead(messages[currentIndex].id);
    }
    setOpen(false);
    onClose();
  };

  const handleNext = () => {
    // Marcar mensagem atual como lida
    if (messages[currentIndex]) {
      markAsRead(messages[currentIndex].id);
    }
    if (currentIndex < messages.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleViewAll = () => {
    setOpen(false);
    onViewAll();
  };

  if (!open || messages.length === 0) {
    return null;
  }

  const currentMessage = messages[currentIndex];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            {messages.length === 1 ? (
              'Nova Mensagem'
            ) : (
              <>
                Novas Mensagens
                <Badge variant="secondary" className="ml-2">
                  {currentIndex + 1} de {messages.length}
                </Badge>
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="flex items-start gap-2">
              <Mail className="h-4 w-4 mt-1 text-primary" />
              <div className="flex-1">
                <h3 className="font-semibold">{currentMessage.title}</h3>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(currentMessage.created_at), {
                    addSuffix: true,
                    locale: ptBR,
                  })}
                </span>
              </div>
            </div>
          </div>

          <Separator />

          <ScrollArea className="max-h-[300px]">
            <div className="prose prose-sm dark:prose-invert max-w-none pr-4">
              <ReactMarkdown>{currentMessage.content}</ReactMarkdown>
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {messages.length > 1 && (
            <div className="flex gap-2 mr-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrev}
                disabled={currentIndex === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNext}
                disabled={currentIndex === messages.length - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleViewAll}>
              Ver todas
            </Button>
            <Button onClick={handleClose}>Fechar</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
