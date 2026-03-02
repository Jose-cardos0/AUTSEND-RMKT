# Payloads enviados do front → n8n

Todos os requests são **POST** com **Content-Type: application/json**.

---

## 1. Webhook Evolution API

**URL:** `https://n8n.iacodenxt.online/webhook/HUBNXTEVOPAI`

### 1.1 Criar instância (botão "Criar instância")

**Body enviado:**
```json
{
  "tipoAcao": "criar_instancia",
  "nomeInstancia": "nome_digitado_pelo_usuario",
  "numeroWhatsapp": "5511999999999"
}
```
- `numeroWhatsapp` só é enviado se o usuário preencheu o campo (apenas dígitos).

**Resposta esperada do n8n (para o app funcionar):**
- `base64` ou `qrCodeBase64` ou `qrcode` → imagem do QR Code
- `hash` ou `instanceId` ou `code` → identificador da instância
- `instanciaId` (opcional) → ex: `"inst-1772236562832"`

---

### 1.2 Verificar status (botão "Já escaneei — Verificar conexão")

**Body enviado:**
```json
{
  "tipoAcao": "verificar_status",
  "nomeInstancia": "nome_da_instancia",
  "getParticipants": false,
  "numeroWhatsapp": "5511999999999"
}
```
- `numeroWhatsapp` só é enviado se existir (preenchido ou salvo).

**Resposta esperada do n8n (para marcar como conectado):**
- Pelo menos um destes:
  - `conectado: true` ou `connected: true`
  - `state: "open"` ou `status: "connected"`
  - Ou o mesmo dentro de `data`: `data.conectado`, `data.state`, etc.

Exemplo: `{ "conectado": true }` ou `{ "state": "open" }`

---

### 1.3 Buscar grupos (botão "Puxar grupos")

**Body enviado:**
```json
{
  "tipoAcao": "buscar_grupo",
  "nomeInstancia": "nome_da_instancia",
  "hash": "B5284DAF-1379-4E81-8FAE-417DAD08B304",
  "instanciaId": "inst-1772236562832"
}
```

**Resposta esperada do n8n:**
- Array de grupos em uma destas chaves: `grupos`, `groups`, ou `data` (sendo array).
- Exemplo: `{ "grupos": [ { "id": "...", "name": "Meu Grupo" }, ... ] }`

---

## 2. Webhook Remarketing

**URL:** `https://n8n.iacodenxt.online/webhook/REMARKETING`

### Enviar remarketing (botão "Enviar" na página Remarketing)

**Body enviado:**
```json
{
  "tipoAcao": "enviar_remarketing",
  "contatos": [
    { "id": "...", "nome": "...", "telefone": "5511999999999", "email": "..." }
  ],
  "mensagem": "Texto da mensagem",
  "instanciaId": "inst-xxx ou hash"
}
```
- `instanciaId` pode ser o valor salvo na config Evolution (ou null se não houver).

---

## 3. Webhook Mensagem WhatsApp

**URL:** `https://n8n.iacodenxt.online/webhook/HUBNXTMSGWHATSAPPEVOAPI`

### Enviar mensagem (botão "Enviar mensagem" na página Enviar mensagem)

**Body enviado:**
```json
{
  "tipoAcao": "enviar_mensagem",
  "contatos": [
    { "telefone": "5511999999999", "nome": "João" }
  ],
  "mensagem": "Texto da mensagem",
  "instanciaId": "inst-xxx ou hash"
}
```

---

## Resumo das URLs e tipoAcao

| Ação no app        | URL (webhook)        | tipoAcao           |
|--------------------|----------------------|--------------------|
| Criar instância    | HUBNXTEVOPAI         | criar_instancia    |
| Verificar conexão  | HUBNXTEVOPAI         | verificar_status   |
| Puxar grupos      | HUBNXTEVOPAI         | buscar_grupo       |
| Enviar remarketing | REMARKETING          | enviar_remarketing |
| Enviar mensagem    | HUBNXTMSGWHATSAPPEVOAPI | enviar_mensagem  |

No n8n, use o campo **tipoAcao** do body para rotear cada request para o fluxo correto (Switch/IF) e devolva sempre **JSON** no "Respond to Webhook" quando o app precisar ler algo (ex.: conectado, grupos, QR).
