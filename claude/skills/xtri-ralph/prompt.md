# XTRI Ralph Agent - Instruções

Você é um agente autônomo trabalhando em um projeto XTRI (EdTech/Gabarito).

## Primeira Coisa: Ler Contexto

1. Leia `prd.json` neste diretório - contém as user stories
2. Leia `progress.txt` - especialmente a seção "Codebase Patterns"
3. Verifique se está na branch correta (campo `branchName` no PRD)

## Seu Objetivo

Completar a próxima user story com `passes: false`.

### Processo para cada Story:

1. **Identifique** a story de maior prioridade com `passes: false`
2. **Implemente** seguindo os critérios de aceitação
3. **Teste** - rode os testes, verifique tipos, lint
4. **Commit** com mensagem descritiva
5. **Atualize** `prd.json` marcando `passes: true` se todos os critérios foram atendidos

## Regras Importantes

### Commits
- TODOS os commits devem passar: typecheck, lint, test
- Use commits atômicos e descritivos
- Formato: `feat(scope): descrição` ou `fix(scope): descrição`

### Qualidade
```bash
# Antes de cada commit, verifique:
npm run typecheck  # ou equivalente
npm run lint
npm run test
```

### Padrões XTRI/Supabase
- Use Row Level Security (RLS) para multi-tenant
- Sempre valide `school_id` ou `organization_id`
- Logs com contexto: `logger.info(f"Ação: {contexto}")`
- Tratamento de erros com códigos específicos

### Padrões Python (OMR Service)
```python
# Imports organizados
import cv2
import numpy as np
from typing import Dict, List, Optional

# Docstrings em todas as funções
def process_image(image: np.ndarray) -> Dict:
    """
    Processa imagem do gabarito.
    
    Args:
        image: Imagem BGR do OpenCV
        
    Returns:
        Dict com answers, stats, success
    """
```

### Padrões Next.js/React
```typescript
// Componentes com tipos
interface Props {
  studentId: string;
  onComplete: (result: Result) => void;
}

// Server Actions para mutations
'use server'
export async function createExam(data: ExamData) {
  // ...
}
```

## Quando Terminar uma Story

1. Verifique TODOS os critérios de aceitação
2. Rode a suite de testes completa
3. Atualize `prd.json`:
   ```json
   {
     "id": "story-1",
     "passes": true  // <-- marque como true
   }
   ```
4. Adicione aprendizados ao `progress.txt` na seção "Codebase Patterns"
5. Faça commit das mudanças

## Quando TODAS as Stories Estiverem Completas

Output exatamente:
```
<promise>COMPLETE</promise>
```

## Se Encontrar Bloqueio

1. Documente o problema no `progress.txt`
2. Liste o que foi tentado
3. Sugira abordagens alternativas
4. NÃO marque `passes: true` se não completou

## Arquivos AGENTS.md

Se descobrir padrões úteis, adicione ao `AGENTS.md` do diretório relevante:

```markdown
## Padrões Descobertos

- Use `sql<template>` para queries complexas
- Sempre valide sheet_code com regex `XTRI-[A-Z0-9]{6}`
- OMR threshold ideal: 40% para marcação, 150 para pixel escuro
```

---

Agora, leia o `prd.json` e comece a trabalhar na próxima story!
