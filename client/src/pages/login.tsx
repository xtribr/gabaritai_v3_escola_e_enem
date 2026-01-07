import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, User, Mail } from 'lucide-react';

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { signIn } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [identifier, setIdentifier] = useState(''); // Matrícula ou Email
  const [password, setPassword] = useState('');

  // Detecta se é email (contém @) ou matrícula
  const isEmail = identifier.includes('@');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    let emailToUse = identifier;

    // Se não for email, buscar email pela matrícula
    if (!isEmail) {
      try {
        const response = await fetch(`/api/auth/email-by-matricula/${encodeURIComponent(identifier)}`);
        const data = await response.json();

        if (!response.ok || !data.email) {
          toast({
            title: 'Matrícula não encontrada',
            description: data.error || 'Não foi possível encontrar um aluno com essa matrícula. Verifique se digitou corretamente.',
            variant: 'destructive',
          });
          setLoading(false);
          return;
        }

        emailToUse = data.email;
      } catch (error) {
        toast({
          title: 'Erro de conexão',
          description: 'Não foi possível verificar a matrícula. Tente novamente.',
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }
    }

    // Fazer login com o email (original ou encontrado pela matrícula)
    const { error } = await signIn(emailToUse, password);

    if (error) {
      // Mensagem de erro mais amigável
      let errorMessage = error.message;
      if (error.message.includes('Invalid login credentials')) {
        errorMessage = isEmail
          ? 'Email ou senha incorretos'
          : 'Matrícula encontrada, mas a senha está incorreta';
      }

      toast({
        title: 'Erro ao entrar',
        description: errorMessage,
        variant: 'destructive',
      });
      setLoading(false);
    } else {
      toast({ title: 'Bem-vindo!' });
      setLocation('/');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Gabaritai</CardTitle>
          <CardDescription>Entre com sua conta</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">Matrícula ou Email</Label>
              <div className="relative">
                <Input
                  id="identifier"
                  type="text"
                  placeholder="Digite sua matrícula ou email"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="pl-10"
                  required
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {isEmail ? <Mail className="h-4 w-4" /> : <User className="h-4 w-4" />}
                </div>
              </div>
              <p className="text-xs text-gray-500">
                {isEmail ? 'Entrando com email' : 'Entrando com matrícula'}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Entrar
            </Button>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Não tem conta?{' '}
              <Link href="/signup" className="text-blue-600 hover:underline">
                Cadastre-se
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
