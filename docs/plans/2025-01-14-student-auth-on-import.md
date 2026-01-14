# Student Auth on Import - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create Auth accounts for students during CSV import with generic password, force password change on first login

**Architecture:** Modify `/api/admin/import-students` to create Auth users + profiles alongside students table entries. Update delete endpoint to clean up Auth + profiles + students.

**Tech Stack:** Supabase Auth Admin API, TypeScript, Express

---

## Current State

- **Import CSV** → Only creates records in `students` table (no Auth account)
- **Reset Password button** → Looks in `profiles` table, fails because student has no Auth account
- **Delete** → Only deletes from `students`, doesn't clean Auth/profiles

## Target State

- **Import CSV** → Creates: Auth user + profile + students record (with links)
- **Reset Password button** → Works because student has Auth account
- **First Login** → Forces password change via `must_change_password: true`
- **Delete** → Cleans up Auth + profiles + students

---

### Task 1: Modify Import Students Endpoint to Create Auth Accounts

**Files:**
- Modify: `server/routes.ts` (lines 3803-3949)

**Step 1: Update the import-students endpoint to create Auth users**

Replace the current logic that only inserts into `students` table with:

```typescript
// For each student in the import:

// 1. Generate email: {matricula}@escola.gabaritai.com
const email = `${matricula}@escola.gabaritai.com`;
const DEFAULT_PASSWORD = 'escola123';

// 2. Check if Auth user already exists
const { data: existingAuth } = await supabaseAdmin.auth.admin.listUsers();
const authUserExists = existingAuth?.users?.find(u => u.email === email);

if (!authUserExists) {
  // 3. Create Auth user with must_change_password flag
  const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: DEFAULT_PASSWORD,
    email_confirm: true,
    user_metadata: {
      must_change_password: true,
      name: nome,
      role: 'student'
    }
  });

  if (authError) {
    throw new Error(`Erro ao criar conta Auth: ${authError.message}`);
  }

  // 4. Create/update profile
  await supabaseAdmin.from('profiles').upsert({
    id: authUser.user.id,
    email,
    name: nome,
    role: 'student',
    school_id: schoolId,
    student_number: matricula,
    turma: turma || null,
    must_change_password: true
  });

  // 5. Create/update students table with profile_id link
  await supabaseAdmin.from('students').upsert({
    school_id: schoolId,
    matricula,
    name: nome,
    turma: turma || null,
    profile_id: authUser.user.id
  }, { onConflict: 'school_id,matricula' });
}
```

**Step 2: Run manual test with a single student**

Run: Create a test CSV with 1 student and import via the admin panel
Expected: Student appears in Auth users, profiles, and students tables

**Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "$(cat <<'EOF'
feat: create Auth accounts during student CSV import

- Generate email as {matricula}@escola.gabaritai.com
- Create Auth user with default password 'escola123'
- Set must_change_password: true for first login
- Create profile linked to Auth user
- Link students table via profile_id
EOF
)"
```

---

### Task 2: Update Delete Student Endpoint to Clean All Tables

**Files:**
- Modify: `server/routes.ts` (lines 4100-4141)

**Step 1: Update DELETE endpoint to cascade through all tables**

```typescript
app.delete("/api/admin/students/:id", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // 1. Check if this is a students table ID or profiles ID
    let studentRecord = await supabaseAdmin
      .from('students')
      .select('id, matricula, name, profile_id')
      .eq('id', id)
      .maybeSingle();

    // If not found in students, check profiles
    if (!studentRecord?.data) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, name, student_number, email')
        .eq('id', id)
        .eq('role', 'student')
        .single();

      if (!profile) {
        return res.status(404).json({ error: "Aluno não encontrado" });
      }

      // Delete from profiles (will cascade to students via FK)
      // But first delete Auth user
      try {
        await supabaseAdmin.auth.admin.deleteUser(id);
        console.log(`[DELETE] Auth user ${id} deleted`);
      } catch (authErr) {
        console.warn(`[DELETE] Auth delete warning:`, authErr);
      }

      await supabaseAdmin.from('profiles').delete().eq('id', id);

      return res.json({
        success: true,
        message: `Aluno ${profile.name} removido completamente`
      });
    }

    const student = studentRecord.data;

    // 2. If student has profile_id, delete Auth user first
    if (student.profile_id) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(student.profile_id);
        console.log(`[DELETE] Auth user ${student.profile_id} deleted`);
      } catch (authErr) {
        console.warn(`[DELETE] Auth delete warning:`, authErr);
      }

      // Delete profile (this may fail if FK issues, that's ok)
      await supabaseAdmin.from('profiles').delete().eq('id', student.profile_id);
    }

    // 3. Delete from students table
    await supabaseAdmin.from('students').delete().eq('id', id);

    console.log(`[DELETE] Student ${student.name} (${student.matricula}) fully removed`);

    res.json({
      success: true,
      message: `Aluno ${student.name} removido completamente`
    });
  } catch (error: any) {
    console.error("[DELETE STUDENT]", error);
    res.status(500).json({
      error: "Erro ao deletar aluno",
      details: error.message
    });
  }
});
```

**Step 2: Test delete functionality**

Run: Delete a student via admin panel
Expected: Student removed from Auth, profiles, and students tables

**Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "$(cat <<'EOF'
fix: cascade delete through Auth + profiles + students

- Check both students and profiles tables
- Delete Auth user first (if exists)
- Delete profile record
- Delete students record
- Handle partial failures gracefully
EOF
)"
```

---

### Task 3: Fix Reset Password to Handle Students Without Auth

**Files:**
- Modify: `server/routes.ts` (lines 4143-4197)

**Step 1: Update reset-password endpoint to create Auth if missing**

```typescript
app.post("/api/admin/students/:id/reset-password", requireAuth, requireRole('school_admin', 'super_admin'), async (req: Request, res: Response) => {
  const DEFAULT_PASSWORD = 'escola123';

  try {
    const { id } = req.params;

    // Try to find in profiles first
    let student = await supabaseAdmin
      .from('profiles')
      .select('id, name, student_number, email, school_id')
      .eq('id', id)
      .maybeSingle();

    // If not in profiles, check students table
    if (!student?.data) {
      const { data: studentRecord } = await supabaseAdmin
        .from('students')
        .select('id, name, matricula, turma, school_id, profile_id')
        .eq('id', id)
        .single();

      if (!studentRecord) {
        return res.status(404).json({ error: "Aluno não encontrado" });
      }

      // If student has no profile_id, create Auth account now
      if (!studentRecord.profile_id) {
        const email = `${studentRecord.matricula}@escola.gabaritai.com`;

        // Create Auth user
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email,
          password: DEFAULT_PASSWORD,
          email_confirm: true,
          user_metadata: { must_change_password: true }
        });

        if (authError) {
          throw new Error(`Erro ao criar conta: ${authError.message}`);
        }

        // Create profile
        await supabaseAdmin.from('profiles').insert({
          id: authUser.user.id,
          email,
          name: studentRecord.name,
          role: 'student',
          school_id: studentRecord.school_id,
          student_number: studentRecord.matricula,
          turma: studentRecord.turma,
          must_change_password: true
        });

        // Link profile to student
        await supabaseAdmin.from('students')
          .update({ profile_id: authUser.user.id })
          .eq('id', id);

        return res.json({
          success: true,
          message: `Conta criada para ${studentRecord.name} com senha ${DEFAULT_PASSWORD}`,
          newPassword: DEFAULT_PASSWORD,
          mustChangePassword: true,
          created: true
        });
      }

      // Use profile_id to reset password
      student = { data: { id: studentRecord.profile_id, name: studentRecord.name, student_number: studentRecord.matricula } };
    }

    // Reset password for existing Auth user
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(student.data.id, {
      password: DEFAULT_PASSWORD,
      user_metadata: { must_change_password: true }
    });

    if (authError) {
      throw new Error(`Erro ao resetar senha: ${authError.message}`);
    }

    // Update profile flag
    await supabaseAdmin.from('profiles')
      .update({ must_change_password: true })
      .eq('id', student.data.id);

    res.json({
      success: true,
      message: `Senha de ${student.data.name} resetada para ${DEFAULT_PASSWORD}`,
      newPassword: DEFAULT_PASSWORD,
      mustChangePassword: true
    });
  } catch (error: any) {
    console.error("[RESET] Erro:", error);
    res.status(500).json({
      error: "Erro ao resetar senha",
      details: error.message
    });
  }
});
```

**Step 2: Test reset password on student without Auth**

Run: Click key icon on a student imported via old method (no Auth)
Expected: Creates Auth account and returns success with password

**Step 3: Commit**

```bash
git add server/routes.ts
git commit -m "$(cat <<'EOF'
fix: reset-password creates Auth account if missing

- Check students table if not found in profiles
- Create Auth user + profile if student has no profile_id
- Link profile_id to students record
- Reset password with must_change_password flag
EOF
)"
```

---

### Task 4: Verify First Login Password Change Flow Works

**Files:**
- Review: `client/src/contexts/AuthContext.tsx`
- Review: `client/src/components/ChangePasswordModal.tsx`

**Step 1: Trace the first login flow**

The flow should be:
1. Student logs in with `escola123`
2. Backend returns `must_change_password: true`
3. Frontend shows `ChangePasswordModal`
4. Student sets new password
5. `must_change_password` set to `false`

**Step 2: Test end-to-end**

Run: Log in as a student with `must_change_password: true`
Expected: Modal appears forcing password change

**Step 3: Commit (if changes needed)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
fix: ensure first login password change flow works

- Verify must_change_password flag triggers modal
- Ensure password update clears the flag
EOF
)"
```

---

### Task 5: Deploy and Test in Production

**Step 1: Push changes**

```bash
git push origin amazing-lamport
```

**Step 2: Deploy backend to Fly.io**

```bash
flyctl deploy -a xtri-gabaritos-api
```

**Step 3: Test complete flow**

1. Import new students via CSV
2. Verify they appear with Auth accounts
3. Test reset password button
4. Test login with default password
5. Verify password change modal appears
6. Test delete student removes all records

---

## Summary

| Feature | Before | After |
|---------|--------|-------|
| Import CSV | Only `students` table | Auth + profiles + students |
| Reset Password | Fails if no Auth | Creates Auth if missing |
| Delete Student | Only `students` | Cascades Auth + profiles + students |
| First Login | N/A (no account) | Forces password change |
| Default Password | N/A | `escola123` |
