# OrbitChain API

<p align="center">
  <strong>Decentralized Fundraising & Campaign Management API</strong><br/>
  <em>Built on NestJS · Powered by Stellar · Backed by PostgreSQL</em>
</p>

<p align="center">
  <a href="https://nestjs.com/" target="_blank"><img src="https://img.shields.io/badge/NestJS-E0234E?style=for-the-badge&logo=nestjs&logoColor=white" alt="NestJS" /></a>
  <a href="https://stellar.org/" target="_blank"><img src="https://img.shields.io/badge/Stellar-7D00FF?style=for-the-badge&logo=stellar&logoColor=white" alt="Stellar" /></a>
  <a href="https://www.postgresql.org/" target="_blank"><img src="https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" /></a>
</p>

---

## Overview

**OrbitChain** is a decentralized fundraising platform API that enables transparent, blockchain-verified campaign creation, donation processing, and milestone-based fund releases on the Stellar network. Designed for NGOs, community organizers, and individual fundraisers who demand trustless accountability.

### Key Capabilities

- 🔐 **Stellar Wallet Authentication** — Sign-in with Stellar key-based challenge-response
- 📋 **Campaign Lifecycle Management** — Draft → Approval → Active → Completion
- 💰 **Blockchain-Verified Donations** — On-chain transaction tracking and confirmation
- 🎯 **Milestone-Based Fund Releases** — Smart contract-governed milestone unlocking
- 🔔 **Real-Time Notifications** — WebSocket + email notifications for all campaign events
- 📊 **Analytics & Export** — Campaign stats, donation history, CSV exports
- 🛡️ **Admin Dashboard** — User management, KYC verification, dispute resolution
- 📝 **Audit Trail** — Immutable audit logs for compliance and transparency

---

## Tech Stack

| Layer             | Technology                            |
| ----------------- | ------------------------------------- |
| **Runtime**       | Node.js + TypeScript                  |
| **Framework**     | NestJS (Express adapter)              |
| **Database**      | PostgreSQL + Prisma ORM               |
| **Cache / Queue** | Redis + Bull                          |
| **Blockchain**    | Stellar SDK + Soroban Smart Contracts |
| **Real-Time**     | Socket.IO WebSockets                  |
| **Monitoring**    | Sentry error tracking                 |
| **Email**         | Nodemailer (SMTP)                     |
| **API Docs**      | Swagger / OpenAPI                     |

---

## Project Setup

### Prerequisites

- Node.js >= 18
- PostgreSQL >= 14
- Redis >= 6
- npm or yarn

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd orbitchain-api

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database, Redis, and Stellar configuration
```

### Configuration

Update the `.env` file with your credentials:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/orbitchain?schema=public"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT
JWT_SECRET=your-secure-secret-here

# Email (optional — console fallback in development)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your-user
SMTP_PASS=your-password
EMAIL_FROM=noreply@orbitchain.io
```

### Database Migrations

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev --name init

# (Optional) Open Prisma Studio
npx prisma studio
```

---

## Running the Application

```bash
# Development (hot reload)
npm run start:dev

# Production
npm run build
npm run start:prod

# Debug mode
npm run start:debug
```

The API will be available at `http://localhost:3000` and Swagger docs at `http://localhost:3000/api/docs`.

---

## Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

---

## API Modules

| Module            | Description                            | Endpoints          |
| ----------------- | -------------------------------------- | ------------------ |
| **Auth**          | Stellar wallet challenge-response auth | `/auth/*`          |
| **Users**         | Profile, KYC, notification preferences | `/users/*`         |
| **Campaigns**     | CRUD, stats, fund release requests     | `/campaigns/*`     |
| **Donations**     | Donation creation, history, admin tips | `/donations/*`     |
| **Milestones**    | Campaign milestone tracking            | `/milestones/*`    |
| **Contracts**     | Soroban smart contract management      | `/contracts/*`     |
| **Notifications** | WebSocket gateway + REST endpoints     | `/notifications/*` |
| **Admin**         | User moderation, campaign suspension   | `/admin/*`         |
| **Health**        | Health checks (DB, Redis)              | `/health`          |
| **API Keys**      | Programmatic API key management        | `/api-keys/*`      |

---

## Project Structure

```
src/
├── admin/              # Admin dashboard & moderation
├── api-keys/           # API key management
├── audit/              # Audit log entities
├── auth/               # Stellar wallet authentication
├── campaigns/          # Campaign CRUD & lifecycle
├── common/             # Shared guards, decorators, middleware
├── contracts/          # Soroban smart contract services
├── donations/          # Donation processing & admin tips
├── health/             # Health check endpoints
├── milestones/         # Milestone tracking & fund release
├── notifications/      # Email, WebSocket, notification prefs
├── platform/           # Platform tip processing
├── prisma/             # Prisma ORM service & module
├── queue/              # Bull queue configuration
├── redis/              # Redis module
├── stellar/            # Stellar SDK, Soroban, event services
├── throttler/          # Rate limiting
├── users/              # User profiles, KYC, exports
├── app.controller.ts   # Root controller
├── app.module.ts       # Root module
├── app.service.ts      # Root service
└── main.ts             # Application bootstrap & Swagger
```

---

## CSV Donation Exports

All donation CSV exports (`GET /users/me/donations/export` and the async queue variant) include the following columns:

| Column   | Notes                                                 |
| -------- | ----------------------------------------------------- |
| Campaign | Campaign title at time of export                      |
| Amount   | On-chain amount in the native asset                   |
| Asset    | Asset code (e.g. `XLM`, `USDC`)                       |
| Date     | ISO date of the donation (`YYYY-MM-DD`)               |
| Tx Hash  | Stellar transaction hash for independent verification |

> **USD Equivalent column is intentionally absent.**
> A hardcoded `0.00` placeholder was previously exported under this heading — a medium-severity finding
> ([#15](https://github.com/OrbitChainLabs/OrbitChain-API/issues/15)) because downstream consumers
> (tax tools, accounting software, partner integrations) could silently trust an incorrect value.
> The column will be reinstated once a verified price-oracle integration
> (Stellar Horizon order-book snapshots, CoinGecko, or a self-hosted oracle) is in place.
> Until then, please cross-reference on-chain amounts with your preferred exchange-rate source.

---

## Deployment

For production deployment:

```bash
# Build the application
npm run build

# Run with Node.js
node dist/main

# Or use a process manager
pm2 start dist/main.js --name orbitchain-api
```

---

## Resources

- [NestJS Documentation](https://docs.nestjs.com)
- [Stellar Developer Docs](https://developers.stellar.org/)
- [Prisma Documentation](https://www.prisma.io/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs)

---

## License

UNLICENSED — Proprietary. All rights reserved.
