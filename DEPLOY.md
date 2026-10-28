# Deploy SIS-PDV — 5 Clientes na VPS

## O que esta estrutura faz

Roda 5 instâncias independentes do SIS-PDV na mesma VPS, cada uma com:
- Container Node.js próprio (porta 3001–3005)
- Container PostgreSQL próprio (banco isolado, dados nunca se misturam)
- Nginx roteando por subdomínio (`cliente1.seupdv.com.br` → porta 3001, etc.)

---

## Pré-requisitos na VPS

```bash
# Instalar Docker
curl -fsSL https://get.docker.com | sh

# Instalar Docker Compose
apt install docker-compose-plugin -y

# Criar diretório do projeto
mkdir -p /opt/pdv && cd /opt/pdv
```

---

## Passo a passo

### 1. Clonar o repositório

```bash
git clone https://github.com/urbano70/SIS-PDV-FLOW-dev-supabase.git /opt/pdv
cd /opt/pdv
```

### 2. Configurar variáveis de ambiente

```bash
cd docker
cp .env.example .env
nano .env   # preencha as senhas e chaves de cada cliente
```

> **Supabase**: cada cliente precisa de um projeto Supabase gratuito (usado **apenas** para login/auth do dono). O banco de dados (pedidos, mesas, cardápio) roda local no PostgreSQL.

### 3. Build da imagem

```bash
cd /opt/pdv
docker compose -f docker/docker-compose.yml build
```

Isso cria a imagem `sis-pdv:latest` usada por todos os 5 containers.

### 4. Subir tudo

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d
```

Aguarde ~30 segundos para todos os bancos iniciarem. Verifique:

```bash
docker compose -f docker/docker-compose.yml ps
```

Todos devem aparecer como `healthy` ou `running`.

### 5. Configurar DNS

No painel do seu domínio, crie registros A apontando para o IP da VPS:

```
cliente1.seupdv.com.br  →  IP_DA_VPS
cliente2.seupdv.com.br  →  IP_DA_VPS
cliente3.seupdv.com.br  →  IP_DA_VPS
cliente4.seupdv.com.br  →  IP_DA_VPS
cliente5.seupdv.com.br  →  IP_DA_VPS
```

### 6. SSL (HTTPS) com Certbot

```bash
apt install certbot python3-certbot-nginx -y

certbot --nginx \
  -d cliente1.seupdv.com.br \
  -d cliente2.seupdv.com.br \
  -d cliente3.seupdv.com.br \
  -d cliente4.seupdv.com.br \
  -d cliente5.seupdv.com.br
```

---

## Comandos do dia a dia

### Ver logs de um cliente
```bash
docker logs pdv-cliente-1 -f
docker logs postgres-cliente-1 -f
```

### Reiniciar um cliente específico
```bash
docker restart pdv-cliente-1
```

### Atualizar todos os clientes (nova versão do sistema)
```bash
cd /opt/pdv
git pull origin main
docker compose -f docker/docker-compose.yml build
docker compose -f docker/docker-compose.yml up -d
```
> Os containers reiniciam um a um com a nova imagem. Downtime de ~10s por cliente.

### Parar um cliente (manutenção)
```bash
docker compose -f docker/docker-compose.yml stop pdv-cliente-3
```

### Acessar o banco de um cliente
```bash
docker exec -it postgres-cliente-1 psql -U pdv -d pdv
```

---

## Backup automático

### Configurar backup diário às 3h da manhã
```bash
crontab -e
# Adicionar a linha:
0 3 * * * /opt/pdv/docker/backup.sh >> /var/log/pdv-backup.log 2>&1
```

Backups ficam em `/opt/pdv-backups/YYYY-MM-DD/`, mantidos por 7 dias.

### Restaurar backup de um cliente
```bash
# Parar o cliente
docker compose -f docker/docker-compose.yml stop pdv-cliente-2

# Restaurar o banco
gunzip -c /opt/pdv-backups/2025-01-15/cliente-2.sql.gz | \
  docker exec -i postgres-cliente-2 psql -U pdv -d pdv

# Reiniciar
docker compose -f docker/docker-compose.yml start pdv-cliente-2
```

---

## Adicionar um 6º cliente

```bash
chmod +x /opt/pdv/docker/provision.sh
/opt/pdv/docker/provision.sh 6 "Pizzaria Nova" pizzaria-nova
```

O script gera a senha e mostra exatamente o que adicionar em cada arquivo.

---

## Estrutura de arquivos

```
docker/
├── docker-compose.yml   # Define os 10 containers (5 app + 5 postgres) + Nginx
├── nginx.conf           # Roteamento por subdomínio
├── init.sql             # Schema do banco — executado ao criar cada PostgreSQL
├── .env.example         # Modelo de variáveis de ambiente
├── .env                 # Suas credenciais reais (NÃO commitar no Git)
├── backup.sh            # Backup automático dos 5 bancos
└── provision.sh         # Script para adicionar novo cliente
Dockerfile               # Como buildar a imagem do sistema
```

---

## Custo estimado

| Item | Custo/mês |
|---|---|
| VPS 8GB RAM, 4 vCPU (Hetzner/Contabo) | R$ 80–150 |
| Supabase (auth, plano free — 2 projetos) | R$ 0 |
| Supabase extra (3 projetos = 3 contas free) | R$ 0 |
| Domínio `.com.br` | R$ 4 |
| **Total para 5 clientes** | **~R$ 84–154/mês** |
