import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Home from "@/pages/home";
import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import SignupPage from "@/pages/signup";
import StudentDashboard from "@/pages/student-dashboard";
import AdminPage from "@/pages/admin";
import EscolaPage from "@/pages/escola";
import UnauthorizedPage from "@/pages/unauthorized";
import DebugPage from "@/pages/debug";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      {/* Rotas públicas */}
      <Route path="/login" component={LoginPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/signup" component={SignupPage} />
      <Route path="/unauthorized" component={UnauthorizedPage} />

      {/* Rota protegida - SUPER_ADMIN (Xandão/XTRI) */}
      <Route path="/">
        <ProtectedRoute allowedRoles={['super_admin']}>
          <Home />
        </ProtectedRoute>
      </Route>

      {/* Rota protegida - Admin panel */}
      <Route path="/admin">
        <ProtectedRoute allowedRoles={['super_admin']}>
          <AdminPage />
        </ProtectedRoute>
      </Route>

      {/* Rota protegida - SCHOOL_ADMIN (Coordenador/Diretor) */}
      <Route path="/escola">
        <ProtectedRoute allowedRoles={['school_admin']}>
          <EscolaPage />
        </ProtectedRoute>
      </Route>

      {/* Rota protegida - Aluno */}
      <Route path="/dashboard">
        <ProtectedRoute allowedRoles={['student']}>
          <StudentDashboard />
        </ProtectedRoute>
      </Route>

      <Route path="/debug" component={DebugPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
