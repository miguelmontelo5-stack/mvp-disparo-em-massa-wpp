# 🚀 DLM WhatsApp — Central de Disparo em Massa (Multi-Chip Ultra-Leve)

Sistema profissional para gestão e disparo de mensagens em massa no WhatsApp com suporte a **Multi-Chip (múltiplas sessões)**, arquitetura orientada a eventos, processamento assíncrono em fila e consumo mínimo de recursos.

---

## ⚡ Por que esta arquitetura é ultra-leve?

| Abordagem Anterior (Legada) | Nova Arquitetura DLM |
| :--- | :--- |
| ❌ **Chromium headless por sessão** (`whatsapp-web.js` / Puppeteer). | ✅ **WebSocket nativo direto** via protocolo WhatsApp com `@whiskeysockets/baileys`. |
| ❌ **300 MB a 600 MB de RAM por chip** + uso pesado de CPU em VM. | ✅ **~15 MB a 30 MB de RAM por chip** (95% de economia de memória). |
| ❌ Requisições HTTP travadas com loops síncronos e timeouts. | ✅ **Filas assíncronas com BullMQ + Redis** (`POST /api/send` responde em < 10ms). |
| ❌ Sem controle de concorrência por chip (risco de ban). | ✅ **Distributed Locks atômicos e Rate Limiting** por sessão no Redis. |
| ❌ `console.log` bloqueando o Event Loop. | ✅ **Fastify + Pino Logger** de alta performance. |

---

## 🏗️ Stack Tecnológica

| Camada | Tecnologia | Função |
| :--- | :--- | :--- |
| **Runtime** | **Node.js 20+ & TypeScript** | Backend moderno fortemente tipado |
| **API Framework** | **Fastify** | Servidor HTTP de altíssimo throughput e baixo overhead |
| **Motor WhatsApp** | **@whiskeysockets/baileys** | Conexão socket nativa sem dependência de navegador |
| **Filas de Disparo** | **BullMQ** | Enfileiramento de jobs, retentativas e controle de concorrência |
| **Cache & Estado Rápido** | **Redis 7 (Alpine)** | Cache de sessões, locks atômicos por chip e rate limiting |
| **Banco de Dados** | **PostgreSQL 15 (Alpine)** | Persistência definitiva de campanhas, contatos e auditoria |
| **ORM** | **Drizzle ORM** | Acesso tipado ao banco com overhead zero |
| **Tempo Real** | **SSE (`/api/events`) + WebSocket (`/ws`)** | Transmissão instantânea de QR Code e status |
| **Validação** | **Zod** | Validação estrita de esquemas e variáveis de ambiente |
| **Frontend** | **React 19 + TypeScript + Vite + Tailwind** | Dashboard moderno, reativo e responsivo |
| **Containers** | **Docker & Docker Compose** | Ambiente reproduzível para Redis e Postgres |

---

## 📐 Diagrama da Arquitetura

```text
┌──────────────────────────────────────────────┐
│        Frontend (React 19 + Vite)            │
│   src/Dashboard.tsx / src/useControllers.ts  │
└──────────────────────┬───────────────────────┘
                       │ HTTP / SSE / WebSocket
                       ▼
┌──────────────────────────────────────────────┐
│           Fastify + TypeScript + Pino        │
│          Porta 3001 | Schemas com Zod        │
└──────────────┬───────────────────────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
┌──────────────┐ ┌──────────────┐
│  PostgreSQL  │ │    Redis     │
│ (Porta 5433) │ │ (Porta 6379) │
│  Persistência│ │  Locks /     │
│  Campanhas e │ │  Rate-limit /│
│  Contatos    │ │  Cache       │
└──────────────┘ └──────┬───────┘
                        │
                        ▼
                 ┌──────────────┐
                 │ Worker Pool  │
                 │   (BullMQ)   │
                 └──────┬───────┘
                        │
                        ▼
                 ┌──────────────┐
                 │ Baileys Core │ (WebSocket nativo,
                 │  Multi-Chip  │  sem Chromium)
                 └──────────────┘
```

---

## 📋 Pré-requisitos

Antes de iniciar, certifique-se de ter instalado:
1. **Node.js** versão 18 ou superior (`node -v`).
2. **Docker** e **Docker Compose** (`docker compose version`).

---

## 🚀 Como Rodar o Projeto (Passo a Passo)

### 1. Clonar e Instalar Dependências

No diretório raiz do projeto:

```bash
# 1. Instala as dependências do Frontend (raiz)
npm install

# 2. Instala as dependências do Backend
npm install --prefix backend
```

### 2. Iniciar os Serviços de Infraestrutura (Redis e PostgreSQL)

Inicie os containers otimizados em segundo plano via Docker Compose:

```bash
docker compose up -d
```

> **Nota:** O Redis rodará na porta `6379` e o PostgreSQL na porta `5433` (evitando qualquer conflito com PostgreSQL local instalado na porta padrão `5432`).

### 3. Iniciar a Aplicação Completa

Execute o comando unificado de desenvolvimento:

```bash
npm run dev
```

Este comando iniciará simultaneamente:
* **API Fastify:** `http://localhost:3001`
* **Painel Web (Vite):** `http://localhost:5173`

Abra seu navegador em [http://localhost:5173](http://localhost:5173) para acessar o painel.

---

## ⚙️ Variáveis de Ambiente (.env)

O projeto possui um arquivo [backend/.env.example](file:///home/guest/Documentos/disparo_massa/mvp-disparo-em-massa-wpp/backend/.env.example) com valores padrão prontos para uso:

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `PORT` | `3001` | Porta HTTP da API Fastify |
| `HOST` | `0.0.0.0` | Host de escuta do servidor |
| `REDIS_URL` | `redis://localhost:6379` | URL de conexão com a instância Redis |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5433/disparo_massa` | String de conexão PostgreSQL |
| `AUTH_DIR` | `./auth_sessions` | Pasta de armazenamento das credenciais do WhatsApp |
| `SEND_DELAY_MS` | `800` | Intervalo mínimo entre disparos por chip (em ms) |
| `LOG_LEVEL` | `info` | Nível do log Pino (`info`, `debug`, `warn`, `error`) |

---

## 📡 Endpoints da API

### Monitoramento e Saúde
* **`GET /api/health`**: Retorna métricas de memória em tempo real (`rssMB`, `heapUsedMB`), status da fila BullMQ e chips conectados.
* **`GET /api/events`**: Stream Server-Sent Events (SSE) com o estado em tempo real dos chips.
* **`GET /ws`**: Conexão WebSocket nativa para eventos bidirecionais.

### Gerenciamento de Chips (Multi-Sessão)
* **`GET /api/sessions`**: Lista todos os chips cadastrados e seus estados.
* **`POST /api/sessions`**: Cria um novo chip secundário (`{ "name": "Chip Suporte" }`).
* **`DELETE /api/sessions/:sessionId`**: Remove o chip e limpa suas credenciais.
* **`GET /api/status?sessionId=default`**: Retorna status e QR Code em Base64 do chip solicitado.
* **`GET /api/qr?sessionId=default`**: Retorna exclusivamente o QR Code da sessão.
* **`POST /api/connect`**: Solicita geração de QR Code ou reconexão (`{ "sessionId": "default", "force": false }`).
* **`POST /api/disconnect`**: Desconecta o chip solicitado (`{ "sessionId": "default" }`).
* **`GET /api/contacts?sessionId=default`**: Lista contatos sincronizados (com cache no Redis).

### Disparo em Massa
* **`POST /api/send`**: Dispara campanha com distribuição equilibrada (*round-robin*) ou para chip específico:
  ```json
  {
    "numbers": ["5511999999999", "5511888888888"],
    "message": "Olá! Esta é uma mensagem de teste.",
    "image": "data:image/jpeg;base64,...",
    "sessionId": "auto"
  }
  ```

### Autenticação & Usuários (Supabase Auth & RBAC)
* **Credenciais do Administrador Master:**
  * **E-mail:** `disparomassa21@gmail.com`
  * **Senha:** `abc12345`
  * **Nível:** `ADMIN`
* **Tela Inicial Obrigatória:** Todos os usuários passam obrigatoriamente pela tela de Login/Cadastro (`LoginPage`).
* **Novos Usuários:** Usuários cadastrados recebem permissão de `OPERATOR` por padrão.

---

## 📁 Estrutura do Projeto Separado (Cloudflare Pages + VPS)

```text
├── frontend/                 # [CLOUDFLARE PAGES] Single Page App (React 19 + Vite)
│   ├── package.json          # Dependências do frontend
│   ├── vite.config.ts        # Configuração do Vite e proxy de dev
│   ├── wrangler.toml         # Configuração do Cloudflare Pages
│   ├── public/
│   │   └── _redirects        # SPA routing (/* -> /index.html 200)
│   ├── .env.example          # Variáveis VITE_SUPABASE_* e VITE_API_BASE
│   └── src/
│       ├── LoginPage.tsx     # Tela inicial com autenticação obrigatória
│       ├── Dashboard.tsx     # Painel principal autenticado
│       ├── components.tsx    # Vistas de campanha, envio rápido, equipe
│       ├── useControllers.ts # Hooks com token Bearer e sincronização de roles
│       └── lib/
│           └── supabase.ts   # Cliente Supabase Auth e fallback local
│
├── backend/                  # [VPS] Motor Node.js (Fastify + Baileys + BullMQ)
│   ├── package.json          # Dependências do backend
│   ├── Dockerfile            # Imagem Docker multi-stage para VPS
│   ├── docker-compose.yml    # Stack completa para VPS (API + Redis + Postgres)
│   ├── Caddyfile             # Configuração do Caddy para SSL automático na VPS
│   ├── .env.example          # Configurações do backend e Supabase
│   └── src/
│       ├── server.ts         # Fastify com CORS, rotas RBAC, SSE e WS
│       ├── supabase.ts       # Validação de JWT Supabase e seed do admin master
│       ├── config.ts         # Validação de variáveis de ambiente com Zod
│       ├── redis.ts          # Cliente Redis, distributed locks e cache
│       ├── auth/
│       │   └── userManager.ts # RBAC e contingência local
│       ├── whatsapp/
│       │   └── baileysManager.ts # Conexões Baileys multi-chip
│       └── queues/
│           └── dispatchQueue.ts  # Fila BullMQ com anti-spam e jitter
│
├── supabase/                 # Camada de Banco de Dados Supabase / PostgreSQL
│   └── migrations/           # 14 migrations SQL (00001 a 00014)
│       └── 00014_seed_admin_user.sql # Seed do admin disparomassa21@gmail.com
│
└── package.json              # Orquestrador raiz para desenvolvimento e build unificado
```

---

## 🌐 Guia de Deploy

### 1. Frontend no Cloudflare Pages
1. No painel da Cloudflare, acesse **Compute (Workers) > Workers & Pages > Create > Pages > Connect to Git**.
2. Conecte o repositório GitHub.
3. Configure os parâmetros de build:
   * **Framework preset:** `Vite`
   * **Root directory:** `frontend`
   * **Build command:** `npm run build`
   * **Build output directory:** `dist`
4. Em **Environment variables**, adicione:
   * `VITE_SUPABASE_URL`: URL do seu projeto no Supabase (`https://xxx.supabase.co`)
   * `VITE_SUPABASE_ANON_KEY`: Chave anônima (anon public key) do Supabase
   * `VITE_API_BASE`: Domínio da API na VPS (ex: `https://api.seudominio.com`)
5. Clique em **Save and Deploy**. O arquivo `frontend/public/_redirects` já garante o correto roteamento de SPA.

### 2. Backend na VPS (Oracle Cloud, GCP ou qualquer VPS)
1. Clone o repositório na VPS:
   ```bash
   git clone <URL_DO_REPOSITORIO>
   cd mvp-disparo-em-massa-wpp/backend
   ```
2. Crie e configure o arquivo `.env`:
   ```bash
   cp .env.example .env
   nano .env
   ```
   * Preencha `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
   * Configure `CORS_ORIGIN` com a URL do seu frontend no Cloudflare Pages (ex: `https://dlm-frontend.pages.dev`).
3. Inicie os containers com Docker Compose:
   ```bash
   docker compose up -d --build
   ```
4. Configure o Caddy para SSL automático apontando para a porta `3001` (veja `backend/Caddyfile`).

### 3. Banco de Dados & Supabase
Execute as migrations do diretório `supabase/migrations/` no seu projeto Supabase através da CLI ou SQL Editor:
* As migrations criam o schema multi-tenant, tabelas de perfil, conexões WhatsApp, filas, políticas de RLS e o seed do administrador:
  * **Usuário:** `disparomassa21@gmail.com`
  * **Senha:** `abc12345`
  * **Papel:** `ADMIN`

---

## 🛠️ Comandos Locais

| Comando | Descrição |
| :--- | :--- |
| `npm run dev` | Inicia Frontend e Backend simultaneamente em modo dev |
| `npm run dev:frontend` | Inicia apenas o Frontend Vite (`http://localhost:5173`) |
| `npm run dev:backend` | Inicia apenas a API Fastify (`http://localhost:3001`) |
| `npm run build` | Compila tanto o Frontend quanto o Backend |
| `npm run build:frontend` | Compila o Frontend para `frontend/dist` |
| `npm run build:backend` | Compila o Backend para `backend/dist` |

