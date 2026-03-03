# Payloads enviados do front → n8n

Todos os requests são **POST** com **Content-Type: application/json**.

---

## 1. Webhook Evolution API

**URL:** `https://n8n.iacodenxt.online/webhook/HUBNXTEVOPAI`

### 1.1 Criar instância (botão "Criar instância")

Ao clicar em **Criar instância**, o front envia esse payload para o n8n. O n8n devolve o QR Code e você lê com o celular.

**Body enviado:**
```json
{
  "tipoAcao": "criar_instancia",
  "nomeInstancia": "aaasaaas",
  "numeroWhatsApp": "5579998488788"
}
```
- `nomeInstancia` → valor digitado no frontend (ex.: "aaasaaas").
- `numeroWhatsApp` → número digitado no frontend; o front envia só dígitos (ex.: "5579 99848-8788" vira "5579998488788"). Só é enviado se o campo estiver preenchido.

**Resposta esperada do n8n (para o app exibir o QR e salvar):**
- `base64` ou `qrCodeBase64` ou `qrcode` → imagem do QR Code (para você ler no celular).
- `hash` ou `instanceId` ou `code` → identificador da instância.
- `instanciaId` (opcional) → ex: `"inst-1772236562832"`.

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

**Body enviado (sempre com nome da instância e hash para o n8n usar a Evolution API):**
```json
{
  "tipoAcao": "enviar_remarketing",
  "contatos": [
    { "id": "...", "nome": "...", "telefone": "5511999999999", "email": "..." }
  ],
  "mensagem": "Texto da mensagem (variáveis já substituídas se for o caso)",
  "nomeInstancia": "minha_instancia",
  "hash": "B5284DAF-1379-4E81-8FAE-417DAD08B304",
  "instanciaId": "inst-1772236562832"
}
```
- `nomeInstancia`, `hash`, `instanciaId`: dados da instância conectada em Integrações (obrigatório para o n8n enviar pelo WhatsApp certo).

---

### Envio automático (Cloud Function → REMARKETING)

Quando o webhook Kiwify recebe um evento (carrinho abandonado, compra aprovada, etc.), a Cloud Function salva o lead e, se existir uma **mensagem automática ativa** para aquele evento (e opcionalmente para aquele produto), envia **automaticamente** para o REMARKETING. O n8n recebe o mesmo formato abaixo, com **nomeInstancia**, **hash** e **numeroWhatsApp** para usar a instância Evolution correta.

**Body que o n8n recebe (POST):**
```json
{
  "tipoAcao": "enviar_remarketing",
  "contatos": [
    {
      "nome": "Nome do cliente",
      "telefone": "5511999999999",
      "email": "cliente@email.com"
    }
  ],
  "mensagem": "Olá Nome do cliente, você deixou itens no carrinho. Posso te ajudar?",
  "nomeInstancia": "josedev",
  "hash": "B5284DAF-1379-4E81-8FAE-417DAD08B304",
  "instanciaId": "inst-1772236562832",
  "numeroWhatsApp": "5579999062401",
  "evento": "abandoned_cart",
  "produto": "ONLYNEX"
}
```

| Campo | Descrição |
|-------|-----------|
| `nomeInstancia` | Nome da instância conectada em Integrações (ex.: josedev). **Use no n8n para chamar a Evolution API.** |
| `hash` | Hash/código da instância. **Envie para o n8n junto com nomeInstancia.** |
| `instanciaId` | Id da instância (ex.: inst-xxx). |
| `numeroWhatsApp` | Número do WhatsApp da instância (só dígitos). |
| `evento` | Tipo do evento Kiwify normalizado (ex.: abandoned_cart, order_status.purchase_approved). |
| `produto` | Nome do produto do evento (quando disponível). |
| `mensagem` | Texto já com variáveis substituídas: `{nome_cliente}`, `{numero_cliente}`, `{email_cliente}`, `{nome_produto}`. |

No n8n, use **nomeInstancia** e **hash** (e se precisar **instanciaId** / **numeroWhatsApp**) do body para identificar a instância Evolution e enviar a mensagem pelo WhatsApp.

**Resposta do n8n para o status do lead ficar "Enviado":**  
A Cloud Function usa a resposta do n8n para marcar o lead como **Enviado** ou **Erro**. Configure o nó "Respond to Webhook" no n8n para:

- **Status "Enviado"**: responder com **HTTP 200** e, no body, um JSON com indicação de sucesso, por exemplo:
  - `{ "success": true }` ou `{ "enviado": true }` ou `{ "sent": true }` ou `{ "ok": true }`
- **Status "Erro"**: responder com HTTP 4xx/5xx **ou** com HTTP 200 e body `{ "success": false }` (ou `"enviado": false` / `"sent": false`). Opcionalmente inclua `"erro"`, `"error"` ou `"message"` com a mensagem de erro para aparecer no app.

Se o n8n responder 200 sem o campo `success`/`enviado`/`sent`, o app considera sucesso e marca o lead como **Enviado**.

---

## 3. Webhook Mensagem WhatsApp

**URL:** `https://n8n.iacodenxt.online/webhook/HUBNXTMSGWHATSAPPEVOAPI`

### Enviar mensagem (botão "Enviar mensagem" na página Enviar mensagem)

Usa **sempre a instância selecionada em Integrações** (nomeInstancia, numeroWhatsApp, hash, instanciaId). **tipoDisparo: "leads"**.

O app envia **um request por contato**, cada um com o mesmo `disparoId` e `nomeDisparo`.

**Body enviado (por contato):**
```json
{
  "tipoDisparo": "leads",
  "tipoAcao": "enviar_mensagem",
  "disparoId": "disparo_1730123456789_abc12xy",
  "nomeDisparo": "Campanha Black Friday",
  "contatos": [
    { "telefone": "5511999999999", "nome": "João" }
  ],
  "mensagem": "Texto da mensagem",
  "nomeInstancia": "minha_instancia",
  "numeroWhatsApp": "5579999062401",
  "hash": "B5284DAF-1379-4E81-8FAE-417DAD08B304",
  "instanciaId": "inst-1772236562832"
}
```
- `disparoId`: identificador único do disparo (mesmo valor em todos os requests do mesmo envio).
- `nomeDisparo`, `nomeInstancia`, `hash`, `instanciaId`, `numeroWhatsApp`: dados do disparo e da instância.

### Enviar para grupos (Remarketing → Enviar para grupos do WhatsApp)

Usa **sempre a instância conectada em Integrações** (nomeInstancia, numeroWhatsApp, hash, instanciaId).

**Body enviado:**
```json
{
  "tipoDisparo": "grupos",
  "mensagem": { "texto": "Mensagem que o usuário digitou no frontend" },
  "grupos": [
    { "id": "120363368683697806@g.us", "nome": "Contingência Qualificada" },
    { "id": "120363226266049721@g.us", "nome": "Movimento Econômico" }
  ],
  "nomeInstancia": "minha_instancia",
  "numeroWhatsApp": "5579999062401",
  "hash": "B5284DAF-1379-4E81-8FAE-417DAD08B304",
  "instanciaId": "inst-1772236562832"
}
```
- `nomeInstancia`, `numeroWhatsApp`, `hash`, `instanciaId`: dados da instância conectada em Integrações (obrigatório para o n8n usar a instância certa).
- `grupos`: array com todos os dados de cada grupo selecionado (id, nome, etc).

---

## Resumo das URLs e tipoAcao / tipoDisparo

| Ação no app              | URL (webhook)           | tipoAcao / tipoDisparo |
|--------------------------|-------------------------|-------------------------|
| Criar instância          | HUBNXTEVOPAI            | criar_instancia         |
| Verificar conexão        | HUBNXTEVOPAI            | verificar_status        |
| Puxar grupos             | HUBNXTEVOPAI            | buscar_grupo            |
| Enviar remarketing       | REMARKETING             | enviar_remarketing      |
| Enviar mensagem (leads)  | HUBNXTMSGWHATSAPPEVOAPI | enviar_mensagem         |
| Enviar para grupos       | HUBNXTMSGWHATSAPPEVOAPI | tipoDisparo: "grupos"   |

No n8n, use o campo **tipoAcao** do body para rotear cada request para o fluxo correto (Switch/IF) e devolva sempre **JSON** no "Respond to Webhook" quando o app precisar ler algo (ex.: conectado, grupos, QR).
