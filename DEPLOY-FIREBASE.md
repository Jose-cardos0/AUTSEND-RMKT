# Como enviar (deploy) as Functions para o Firebase

## 1. Instalar o Firebase CLI

Se ainda não tiver instalado:

```bash
npm install -g firebase-tools
```

## 2. Fazer login no Firebase

```bash
firebase login
```

Abra o navegador e faça login na conta Google do projeto **afiliadocdnx**.

## 3. Deploy apenas das Functions

Na pasta do projeto (onde está o `firebase.json`):

```bash
cd "D:\3 - CODENXT DIRECT RESPONSE\AFILIADO ANALITICS"
firebase deploy --only functions
```

Isso vai:
- Fazer upload do código da pasta `functions/`
- Publicar a função **kiwifyAbandonedCheckout**
- A URL ficará: `https://us-central1-afiliadocdnx.cloudfunctions.net/kiwifyAbandonedCheckout`

## 4. Deploy das regras do Firestore (recomendado)

Para evitar erro 400 no Firestore, publique também as regras:

```bash
firebase deploy --only firestore:rules
```

## 5. Deploy de tudo (Functions + regras)

```bash
firebase deploy
```

---

## Sobre o erro 400 no Firestore

O erro `GET .../Write/channel?... 400 (Bad Request)` costuma acontecer quando:

1. **Firestore não está ativado**  
   No [Console Firebase](https://console.firebase.google.com) → projeto **afiliadocdnx** → Firestore Database → “Criar banco de dados” (modo produção ou teste).

2. **Regras não publicadas ou muito restritivas**  
   Rode:  
   `firebase deploy --only firestore:rules`

3. **Projeto/região errados**  
   Confirme que o app usa o mesmo `projectId`: **afiliadocdnx** (já está no seu `firebase.js`).

Depois de ativar o Firestore e publicar as regras, recarregue o app e teste de novo.
