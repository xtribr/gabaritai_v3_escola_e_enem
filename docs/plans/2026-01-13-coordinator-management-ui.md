# Coordinator Management UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Coordenadores" tab in the Super Admin panel to create/edit/delete coordinators with segmented access (allowed_series) without requiring direct Supabase access.

**Architecture:** New tab in admin.tsx with CRUD operations. Backend endpoints will use Supabase Admin API to create auth.users with school_admin role, then update profiles with allowed_series. Uses existing patterns from student management.

**Tech Stack:** React (shadcn/ui components), Express.js backend, Supabase Admin API (auth.admin.createUser), PostgreSQL (profiles table with allowed_series column).

---

### Task 1: Backend - Create Coordinator Endpoint

**Files:**
- Modify: `server/routes.ts` (add new endpoint after line ~7700)

**Step 1: Write the endpoint**

Add after the simulados endpoints section:

```typescript
// ========================================
// COORDINATOR MANAGEMENT ENDPOINTS
// ========================================

interface CoordinatorInput {
  email: string;
  name: string;
  password: string;
  school_id: string;
  allowed_series: string[] | null; // null = full access
}

// POST /api/admin/coordinators - Create new coordinator
app.post("/api/admin/coordinators", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const { email, name, password, school_id, allowed_series } = req.body as CoordinatorInput;

    if (!email || !name || !password || !school_id) {
      return res.status(400).json({
        error: "Email, nome, senha e escola são obrigatórios"
      });
    }

    // Validate school exists
    const { data: school, error: schoolError } = await supabaseAdmin
      .from("schools")
      .select("id, name")
      .eq("id", school_id)
      .single();

    if (schoolError || !school) {
      return res.status(400).json({ error: "Escola não encontrada" });
    }

    // Create auth user
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
        role: "school_admin",
        school_id
      }
    });

    if (authError) {
      console.error("[COORDINATOR] Auth error:", authError.message);
      return res.status(500).json({
        error: "Erro ao criar usuário",
        details: authError.message
      });
    }

    // Update profile with allowed_series (trigger already created base profile)
    if (authUser.user && allowed_series !== undefined) {
      await supabaseAdmin
        .from("profiles")
        .update({ allowed_series })
        .eq("id", authUser.user.id);
    }

    res.json({
      success: true,
      coordinator: {
        id: authUser.user?.id,
        email,
        name,
        school_id,
        allowed_series
      }
    });
  } catch (error) {
    console.error("[COORDINATOR] Error:", error);
    res.status(500).json({ error: "Erro interno ao criar coordenador" });
  }
});
```

**Step 2: Test endpoint manually**

Run: `curl -X POST http://localhost:8080/api/admin/coordinators -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d '{"email":"test@test.com","name":"Test","password":"Test1234!","school_id":"SCHOOL_ID","allowed_series":["3"]}'`

Expected: `{"success":true,"coordinator":{...}}`

**Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "$(cat <<'EOF'
feat(api): add POST /api/admin/coordinators endpoint

Creates coordinator users via Supabase Admin API with
segmented access (allowed_series) support.
EOF
)"
```

---

### Task 2: Backend - List Coordinators Endpoint

**Files:**
- Modify: `server/routes.ts`

**Step 1: Write the endpoint**

```typescript
// GET /api/admin/coordinators - List all coordinators
app.get("/api/admin/coordinators", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const { school_id } = req.query;

    let query = supabaseAdmin
      .from("profiles")
      .select(`
        id,
        email,
        name,
        role,
        school_id,
        allowed_series,
        created_at,
        schools!profiles_school_id_fkey (id, name)
      `)
      .eq("role", "school_admin")
      .order("created_at", { ascending: false });

    if (school_id) {
      query = query.eq("school_id", school_id);
    }

    const { data: coordinators, error } = await query;

    if (error) {
      console.error("[COORDINATOR] List error:", error);
      return res.status(500).json({ error: "Erro ao listar coordenadores" });
    }

    res.json({
      success: true,
      coordinators: coordinators || []
    });
  } catch (error) {
    console.error("[COORDINATOR] Error:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});
```

**Step 2: Test endpoint**

Run: `curl http://localhost:8080/api/admin/coordinators -H "Authorization: Bearer TOKEN"`

Expected: `{"success":true,"coordinators":[...]}`

**Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "feat(api): add GET /api/admin/coordinators endpoint"
```

---

### Task 3: Backend - Update Coordinator Endpoint

**Files:**
- Modify: `server/routes.ts`

**Step 1: Write the endpoint**

```typescript
// PUT /api/admin/coordinators/:id - Update coordinator
app.put("/api/admin/coordinators/:id", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, allowed_series, school_id } = req.body;

    // Build update object
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = name;
    if (allowed_series !== undefined) updates.allowed_series = allowed_series;
    if (school_id !== undefined) updates.school_id = school_id;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "Nenhum campo para atualizar" });
    }

    // Update profile
    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .update(updates)
      .eq("id", id)
      .eq("role", "school_admin")
      .select()
      .single();

    if (error || !profile) {
      return res.status(404).json({ error: "Coordenador não encontrado" });
    }

    // Update auth user metadata if name changed
    if (name) {
      await supabaseAdmin.auth.admin.updateUserById(id, {
        user_metadata: { name }
      });
    }

    res.json({ success: true, coordinator: profile });
  } catch (error) {
    console.error("[COORDINATOR] Update error:", error);
    res.status(500).json({ error: "Erro ao atualizar coordenador" });
  }
});
```

**Step 2: Commit**

```bash
git add server/routes.ts
git commit -m "feat(api): add PUT /api/admin/coordinators/:id endpoint"
```

---

### Task 4: Backend - Delete Coordinator Endpoint

**Files:**
- Modify: `server/routes.ts`

**Step 1: Write the endpoint**

```typescript
// DELETE /api/admin/coordinators/:id - Delete coordinator
app.delete("/api/admin/coordinators/:id", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Verify it's a coordinator
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", id)
      .single();

    if (!profile || profile.role !== "school_admin") {
      return res.status(404).json({ error: "Coordenador não encontrado" });
    }

    // Delete from auth (cascade will delete profile)
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);

    if (error) {
      console.error("[COORDINATOR] Delete error:", error);
      return res.status(500).json({ error: "Erro ao excluir coordenador" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("[COORDINATOR] Error:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});
```

**Step 2: Commit**

```bash
git add server/routes.ts
git commit -m "feat(api): add DELETE /api/admin/coordinators/:id endpoint"
```

---

### Task 5: Backend - Reset Coordinator Password Endpoint

**Files:**
- Modify: `server/routes.ts`

**Step 1: Write the endpoint**

```typescript
// POST /api/admin/coordinators/:id/reset-password - Reset coordinator password
app.post("/api/admin/coordinators/:id/reset-password", requireAuth, requireRole('super_admin'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Senha deve ter pelo menos 8 caracteres" });
    }

    // Verify it's a coordinator
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("role, email")
      .eq("id", id)
      .single();

    if (!profile || profile.role !== "school_admin") {
      return res.status(404).json({ error: "Coordenador não encontrado" });
    }

    // Update password
    const { error } = await supabaseAdmin.auth.admin.updateUserById(id, {
      password
    });

    if (error) {
      return res.status(500).json({ error: "Erro ao resetar senha" });
    }

    res.json({ success: true, email: profile.email });
  } catch (error) {
    console.error("[COORDINATOR] Reset password error:", error);
    res.status(500).json({ error: "Erro interno" });
  }
});
```

**Step 2: Commit**

```bash
git add server/routes.ts
git commit -m "feat(api): add coordinator password reset endpoint"
```

---

### Task 6: Frontend - Add Coordinators Tab Structure

**Files:**
- Modify: `client/src/pages/admin.tsx`

**Step 1: Add interfaces and state**

After existing interfaces (~line 94), add:

```typescript
interface Coordinator {
  id: string;
  email: string;
  name: string;
  role: string;
  school_id: string | null;
  allowed_series: string[] | null;
  created_at: string;
  schools?: { id: string; name: string } | null;
}
```

In the component, add state:

```typescript
// Coordinator states
const [coordinators, setCoordinators] = useState<Coordinator[]>([]);
const [isLoadingCoordinators, setIsLoadingCoordinators] = useState(false);
const [showCoordinatorModal, setShowCoordinatorModal] = useState(false);
const [coordinatorToEdit, setCoordinatorToEdit] = useState<Coordinator | null>(null);
const [coordinatorToDelete, setCoordinatorToDelete] = useState<Coordinator | null>(null);
const [coordinatorForm, setCoordinatorForm] = useState({
  email: '',
  name: '',
  password: '',
  school_id: '',
  allowed_series: [] as string[]
});
const [showResetPasswordModal, setShowResetPasswordModal] = useState<Coordinator | null>(null);
const [newCoordinatorPassword, setNewCoordinatorPassword] = useState('');
```

**Step 2: Commit**

```bash
git add client/src/pages/admin.tsx
git commit -m "feat(admin): add coordinator state and interfaces"
```

---

### Task 7: Frontend - Add Coordinator CRUD Functions

**Files:**
- Modify: `client/src/pages/admin.tsx`

**Step 1: Add fetch coordinators function**

```typescript
// Fetch coordinators
const fetchCoordinators = useCallback(async () => {
  setIsLoadingCoordinators(true);
  try {
    const response = await authFetch('/api/admin/coordinators');
    const data = await response.json();
    if (data.success) {
      setCoordinators(data.coordinators);
    }
  } catch (error) {
    console.error('Erro ao buscar coordenadores:', error);
  } finally {
    setIsLoadingCoordinators(false);
  }
}, []);
```

**Step 2: Add save coordinator function**

```typescript
// Save coordinator (create/update)
const handleSaveCoordinator = async () => {
  setIsActionLoading(true);
  try {
    const method = coordinatorToEdit ? 'PUT' : 'POST';
    const url = coordinatorToEdit
      ? `/api/admin/coordinators/${coordinatorToEdit.id}`
      : '/api/admin/coordinators';

    const body = coordinatorToEdit
      ? {
          name: coordinatorForm.name,
          school_id: coordinatorForm.school_id || null,
          allowed_series: coordinatorForm.allowed_series.length > 0
            ? coordinatorForm.allowed_series
            : null
        }
      : {
          email: coordinatorForm.email,
          name: coordinatorForm.name,
          password: coordinatorForm.password,
          school_id: coordinatorForm.school_id,
          allowed_series: coordinatorForm.allowed_series.length > 0
            ? coordinatorForm.allowed_series
            : null
        };

    const response = await authFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (data.success) {
      fetchCoordinators();
      setShowCoordinatorModal(false);
      setCoordinatorToEdit(null);
      setCoordinatorForm({ email: '', name: '', password: '', school_id: '', allowed_series: [] });
    } else {
      alert(`Erro: ${data.error}`);
    }
  } catch (error) {
    console.error('Erro ao salvar coordenador:', error);
    alert('Erro ao salvar coordenador');
  } finally {
    setIsActionLoading(false);
  }
};
```

**Step 3: Add delete coordinator function**

```typescript
// Delete coordinator
const handleDeleteCoordinator = async () => {
  if (!coordinatorToDelete) return;

  setIsActionLoading(true);
  try {
    const response = await authFetch(`/api/admin/coordinators/${coordinatorToDelete.id}`, {
      method: 'DELETE',
    });

    const data = await response.json();
    if (data.success) {
      fetchCoordinators();
    } else {
      alert(`Erro: ${data.error}`);
    }
  } catch (error) {
    console.error('Erro ao excluir coordenador:', error);
    alert('Erro ao excluir coordenador');
  } finally {
    setIsActionLoading(false);
    setCoordinatorToDelete(null);
  }
};
```

**Step 4: Add reset password function**

```typescript
// Reset coordinator password
const handleResetCoordinatorPassword = async () => {
  if (!showResetPasswordModal || !newCoordinatorPassword) return;

  setIsActionLoading(true);
  try {
    const response = await authFetch(`/api/admin/coordinators/${showResetPasswordModal.id}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newCoordinatorPassword }),
    });

    const data = await response.json();
    if (data.success) {
      alert(`Senha alterada com sucesso para ${data.email}`);
      setShowResetPasswordModal(null);
      setNewCoordinatorPassword('');
    } else {
      alert(`Erro: ${data.error}`);
    }
  } catch (error) {
    console.error('Erro ao resetar senha:', error);
    alert('Erro ao resetar senha');
  } finally {
    setIsActionLoading(false);
  }
};
```

**Step 5: Commit**

```bash
git add client/src/pages/admin.tsx
git commit -m "feat(admin): add coordinator CRUD functions"
```

---

### Task 8: Frontend - Add Coordinators Tab UI

**Files:**
- Modify: `client/src/pages/admin.tsx`

**Step 1: Update TabsList**

Change the TabsList grid-cols-2 to grid-cols-3:

```tsx
<TabsList className="grid w-full grid-cols-3 max-w-md">
  <TabsTrigger value="escolas" className="flex items-center gap-2">
    <Building2 className="h-4 w-4" />
    Escolas
  </TabsTrigger>
  <TabsTrigger value="coordenadores" className="flex items-center gap-2">
    <Users className="h-4 w-4" />
    Coordenadores
  </TabsTrigger>
  <TabsTrigger value="configuracoes" className="flex items-center gap-2">
    <Settings className="h-4 w-4" />
    Config
  </TabsTrigger>
</TabsList>
```

**Step 2: Add useEffect to load coordinators**

```typescript
// Load coordinators when tab changes
useEffect(() => {
  if (activeTab === 'coordenadores') {
    fetchCoordinators();
    fetchSchools(); // Need schools for dropdown
  }
}, [activeTab, fetchCoordinators, fetchSchools]);
```

**Step 3: Add TabsContent for coordinators**

```tsx
<TabsContent value="coordenadores" className="space-y-4">
  <Card>
    <CardHeader>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <CardTitle>Gestão de Coordenadores</CardTitle>
          <CardDescription>
            {coordinators.length} coordenador(es) cadastrado(s)
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchCoordinators}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Atualizar
          </Button>
          <Button size="sm" onClick={() => {
            setCoordinatorToEdit(null);
            setCoordinatorForm({ email: '', name: '', password: '', school_id: '', allowed_series: [] });
            setShowCoordinatorModal(true);
          }}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Coordenador
          </Button>
        </div>
      </div>
    </CardHeader>
    <CardContent>
      {isLoadingCoordinators ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : coordinators.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Nenhum coordenador cadastrado</p>
          <p className="text-sm mt-2">Clique em "Novo Coordenador" para adicionar</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Escola</TableHead>
                <TableHead>Acesso</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {coordinators.map((coord) => (
                <TableRow key={coord.id}>
                  <TableCell className="font-medium">{coord.name}</TableCell>
                  <TableCell className="text-sm">{coord.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {coord.schools?.name || 'Sem escola'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {coord.allowed_series && coord.allowed_series.length > 0 ? (
                      <div className="flex gap-1">
                        {coord.allowed_series.map(s => (
                          <Badge key={s} variant="secondary" className="text-xs">
                            {s}ª
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <Badge className="bg-green-100 text-green-800">Total</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setCoordinatorToEdit(coord);
                          setCoordinatorForm({
                            email: coord.email,
                            name: coord.name,
                            password: '',
                            school_id: coord.school_id || '',
                            allowed_series: coord.allowed_series || []
                          });
                          setShowCoordinatorModal(true);
                        }}
                        title="Editar"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowResetPasswordModal(coord)}
                        title="Resetar senha"
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCoordinatorToDelete(coord)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        title="Excluir"
                      >
                        <TrashIcon size={16} dangerHover />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </CardContent>
  </Card>
</TabsContent>
```

**Step 4: Commit**

```bash
git add client/src/pages/admin.tsx
git commit -m "feat(admin): add coordinators tab with table UI"
```

---

### Task 9: Frontend - Add Coordinator Create/Edit Modal

**Files:**
- Modify: `client/src/pages/admin.tsx`

**Step 1: Add the modal at the end of the component (before closing div)**

```tsx
{/* Modal Coordenador (Criar/Editar) */}
<Dialog
  open={showCoordinatorModal}
  onOpenChange={(open) => {
    if (!open) {
      setShowCoordinatorModal(false);
      setCoordinatorToEdit(null);
      setCoordinatorForm({ email: '', name: '', password: '', school_id: '', allowed_series: [] });
    }
  }}
>
  <DialogContent className="max-w-lg">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        <Users className="h-5 w-5" />
        {coordinatorToEdit ? 'Editar Coordenador' : 'Novo Coordenador'}
      </DialogTitle>
      <DialogDescription>
        {coordinatorToEdit
          ? 'Atualize os dados do coordenador'
          : 'Preencha os dados do novo coordenador'}
      </DialogDescription>
    </DialogHeader>

    <div className="space-y-4 mt-4">
      {!coordinatorToEdit && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Email *</label>
          <Input
            type="email"
            value={coordinatorForm.email}
            onChange={(e) => setCoordinatorForm({ ...coordinatorForm, email: e.target.value })}
            placeholder="coordenador@escola.com"
          />
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">Nome *</label>
        <Input
          value={coordinatorForm.name}
          onChange={(e) => setCoordinatorForm({ ...coordinatorForm, name: e.target.value })}
          placeholder="Nome do Coordenador"
        />
      </div>

      {!coordinatorToEdit && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Senha *</label>
          <Input
            type="password"
            value={coordinatorForm.password}
            onChange={(e) => setCoordinatorForm({ ...coordinatorForm, password: e.target.value })}
            placeholder="Mínimo 8 caracteres"
          />
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">Escola *</label>
        <Select
          value={coordinatorForm.school_id}
          onValueChange={(value) => setCoordinatorForm({ ...coordinatorForm, school_id: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione uma escola" />
          </SelectTrigger>
          <SelectContent>
            {schools.map((school) => (
              <SelectItem key={school.id} value={school.id}>{school.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Acesso por Série</label>
        <p className="text-xs text-gray-500 mb-2">
          Deixe vazio para acesso total. Selecione as séries que este coordenador pode visualizar.
        </p>
        <div className="flex gap-2">
          {['1', '2', '3'].map((serie) => (
            <Button
              key={serie}
              type="button"
              variant={coordinatorForm.allowed_series.includes(serie) ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setCoordinatorForm(prev => ({
                  ...prev,
                  allowed_series: prev.allowed_series.includes(serie)
                    ? prev.allowed_series.filter(s => s !== serie)
                    : [...prev.allowed_series, serie]
                }));
              }}
            >
              {serie}ª Série
            </Button>
          ))}
        </div>
        {coordinatorForm.allowed_series.length === 0 && (
          <Badge className="bg-green-100 text-green-800 mt-2">Acesso Total</Badge>
        )}
      </div>
    </div>

    <div className="flex justify-end gap-3 mt-6">
      <Button variant="outline" onClick={() => setShowCoordinatorModal(false)}>
        Cancelar
      </Button>
      <Button
        onClick={handleSaveCoordinator}
        disabled={isActionLoading || !coordinatorForm.name || (!coordinatorToEdit && (!coordinatorForm.email || !coordinatorForm.password)) || !coordinatorForm.school_id}
      >
        {isActionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {coordinatorToEdit ? 'Salvar' : 'Criar Coordenador'}
      </Button>
    </div>
  </DialogContent>
</Dialog>
```

**Step 2: Commit**

```bash
git add client/src/pages/admin.tsx
git commit -m "feat(admin): add coordinator create/edit modal"
```

---

### Task 10: Frontend - Add Delete and Reset Password Modals

**Files:**
- Modify: `client/src/pages/admin.tsx`

**Step 1: Add delete confirmation dialog**

```tsx
{/* AlertDialog Confirmar Exclusão de Coordenador */}
<AlertDialog open={!!coordinatorToDelete} onOpenChange={(open) => !open && setCoordinatorToDelete(null)}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Excluir Coordenador</AlertDialogTitle>
      <AlertDialogDescription>
        Tem certeza que deseja excluir o coordenador <strong>{coordinatorToDelete?.name}</strong>?
        <br />
        <span className="text-red-600 font-medium">
          Esta ação não pode ser desfeita. O acesso será removido imediatamente.
        </span>
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancelar</AlertDialogCancel>
      <AlertDialogAction
        onClick={handleDeleteCoordinator}
        className="bg-red-600 hover:bg-red-700"
        disabled={isActionLoading}
      >
        {isActionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Excluir
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

**Step 2: Add reset password dialog**

```tsx
{/* Dialog Resetar Senha do Coordenador */}
<Dialog
  open={!!showResetPasswordModal}
  onOpenChange={(open) => {
    if (!open) {
      setShowResetPasswordModal(null);
      setNewCoordinatorPassword('');
    }
  }}
>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle className="flex items-center gap-2">
        <KeyRound className="h-5 w-5" />
        Resetar Senha
      </DialogTitle>
      <DialogDescription>
        Definir nova senha para {showResetPasswordModal?.name}
      </DialogDescription>
    </DialogHeader>

    <div className="space-y-4 mt-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Nova Senha *</label>
        <Input
          type="password"
          value={newCoordinatorPassword}
          onChange={(e) => setNewCoordinatorPassword(e.target.value)}
          placeholder="Mínimo 8 caracteres"
        />
      </div>
    </div>

    <div className="flex justify-end gap-3 mt-6">
      <Button variant="outline" onClick={() => setShowResetPasswordModal(null)}>
        Cancelar
      </Button>
      <Button
        onClick={handleResetCoordinatorPassword}
        disabled={isActionLoading || newCoordinatorPassword.length < 8}
      >
        {isActionLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Alterar Senha
      </Button>
    </div>
  </DialogContent>
</Dialog>
```

**Step 3: Commit**

```bash
git add client/src/pages/admin.tsx
git commit -m "feat(admin): add coordinator delete and reset password modals"
```

---

### Task 11: Integration Testing

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Test create coordinator flow**

1. Login as super_admin
2. Go to Admin panel
3. Click "Coordenadores" tab
4. Click "Novo Coordenador"
5. Fill form with test data
6. Submit and verify user appears in list

**Step 3: Test edit coordinator flow**

1. Click edit on a coordinator
2. Change allowed_series
3. Save and verify changes persisted

**Step 4: Test delete coordinator flow**

1. Click delete on test coordinator
2. Confirm deletion
3. Verify removed from list

**Step 5: Test reset password flow**

1. Click reset password icon
2. Enter new password
3. Verify success message

**Step 6: Commit**

```bash
git add -A
git commit -m "test: verify coordinator management integration"
```

---

### Task 12: Final Verification and Cleanup

**Step 1: Run TypeScript check**

Run: `npm run check`

Expected: No errors

**Step 2: Run build**

Run: `npm run build`

Expected: Build succeeds

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: finalize coordinator management feature"
```
