# Remarketing - Afiliado

App multitenant de remarketing: login (Firebase Auth), integrações (Evolution API + webhook Kiwify), página de remarketing com carrinhos abandonados e envio de mensagens via WhatsApp.

## Stack

- React + Vite
- Tailwind CSS
- Firebase (Auth + Firestore)
- React Router, Lucide Icons, date-fns

## Setup

```bash
npm install
npm run dev
```

## Firebase

1. No [Console Firebase](https://console.firebase.google.com), ative **Authentication** (Email/Password) e **Firestore**.
2. Faça o deploy das regras do Firestore:
   - Em Firestore > Regras, cole o conteúdo de `firestore.rules`.
3. Para o webhook Kiwify (carrinho abandonado), faça o deploy da Cloud Function:
   - Instale o Firebase CLI e faça login.
   - Na pasta `functions`: `npm install` e `firebase deploy --only functions`.
   - Use a URL gerada na Kiwify (Abandoned Checkout) e no app ao criar o webhook.

## Estrutura multitenant (Firestore)

- `users/{userId}/config/evolution` – instância Evolution (hash, QR, conectado).
- `users/{userId}/webhooks` – webhooks criados pelo usuário (ex.: Kiwify).
- `users/{userId}/abandonedCarts` – carrinhos abandonados recebidos pelo webhook.
- `users/{userId}/remarketingLog` – log de envios de remarketing.

Cada usuário só acessa e altera seus próprios dados (regras por `request.auth.uid == userId`).

## Webhooks n8n

- **Evolution API:** `https://n8n.iacodenxt.online/webhook/HUBNXTEVOPAI`  
  - `tipoAcao: "criar_instancia"` | `"verificar_status"` | `"buscar_grupo"`.
- **Remarketing:** `https://n8n.iacodenxt.online/webhook/REMARKETING`  
  - Envio de campanha (contatos + mensagem).
- **Mensagem WhatsApp:** `https://n8n.iacodenxt.online/webhook/HUBNXTMSGWHATSAPPEVOAPI`  
  - Envio de mensagem para lista de leads.

## Build

```bash
npm run build
```

Build de produção em `dist/`.
