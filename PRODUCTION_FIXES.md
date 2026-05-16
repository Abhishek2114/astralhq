# AstralHQ - Production Fix Guide

## Target App: Project Management with Role-Based Access
- **Users**: Create projects, assign tasks, track progress
- **Roles**: Admin (full access), Member (limited to assigned projects)
- **Features**: Auth, Projects, Tasks, Dashboard, Status tracking

---

# PHASE 1: FIX CRITICAL DATABASE SCHEMA (HIGH PRIORITY)

## Step 1: Delete Old Migration & Clean Up

```bash
# Remove the mismatched migration
rm -rf apps/server/prisma/migrations/20260515120000_astralhq_saas

# Reset migration state
rm apps/server/prisma/migrations/migration_lock.toml

# Clean up old database files
rm -rf apps/server/data/
rm -f apps/server/prisma/*.db*
```

---

## Step 2: Fix Prisma Schema (PostgreSQL Production)

**File**: `apps/server/prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  directUrl = env("DATABASE_DIRECT_URL")  // For Prisma Migrate with connection pooling
}

// ============ ENUMS ============
enum UserRole {
  ADMIN
  MEMBER
}

enum ProjectStatus {
  PLANNING
  ACTIVE
  ON_HOLD
  COMPLETED
  ARCHIVED
}

enum TaskStatus {
  TODO
  IN_PROGRESS
  IN_REVIEW
  DONE
}

enum TaskPriority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

enum ActivityAction {
  PROJECT_CREATED
  PROJECT_UPDATED
  PROJECT_ARCHIVED
  TASK_CREATED
  TASK_UPDATED
  TASK_ASSIGNED
  TASK_COMPLETED
  USER_ADDED_TO_PROJECT
  USER_REMOVED_FROM_PROJECT
}

// ============ MODELS ============

model User {
  id            String    @id @default(cuid())
  name          String    @db.VarChar(255)
  email         String    @unique @db.VarChar(255)
  passwordHash  String    @db.VarChar(255)
  avatar        String?
  role          UserRole  @default(MEMBER)
  isActive      Boolean   @default(true)
  
  // Timestamps
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime? // For soft deletes
  
  // Relations
  ownedProjects Project[] @relation("ProjectOwner")
  projectMembers ProjectMember[]
  assignedTasks Task[] @relation("TaskAssignee")
  createdTasks  Task[] @relation("TaskCreator")
  refreshTokens RefreshToken[]
  activities    Activity[]
  
  @@index([email])
  @@index([role])
  @@index([isActive])
  @@index([deletedAt])
}

model RefreshToken {
  id            String    @id @default(cuid())
  tokenHash     String    @unique @db.VarChar(255)
  userId        String
  expiresAt     DateTime
  revokedAt     DateTime?
  userAgent     String?   @db.VarChar(500)
  ipAddress     String?   @db.VarChar(45)
  createdAt     DateTime  @default(now())
  
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
  @@index([expiresAt])
  @@index([revokedAt])
}

model Project {
  id            String    @id @default(cuid())
  title         String    @db.VarChar(255)
  description   String?   @db.Text
  status        ProjectStatus @default(PLANNING)
  ownerId       String
  
  // Timestamps
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime? // For soft deletes
  
  // Relations
  owner         User      @relation("ProjectOwner", fields: [ownerId], references: [id], onDelete: Restrict)
  members       ProjectMember[]
  tasks         Task[]
  activities    Activity[]
  
  @@index([ownerId])
  @@index([status])
  @@index([createdAt])
  @@index([deletedAt])
}

model ProjectMember {
  id            String    @id @default(cuid())
  projectId     String
  userId        String
  joinedAt      DateTime  @default(now())
  
  project       Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@unique([projectId, userId])
  @@index([userId])
  @@index([projectId])
}

model Task {
  id            String    @id @default(cuid())
  title         String    @db.VarChar(255)
  description   String?   @db.Text
  status        TaskStatus @default(TODO)
  priority      TaskPriority @default(MEDIUM)
  
  // Relations
  projectId     String
  project       Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  createdById   String
  createdBy     User      @relation("TaskCreator", fields: [createdById], references: [id], onDelete: Restrict)
  
  assignedToId  String?
  assignedTo    User?     @relation("TaskAssignee", fields: [assignedToId], references: [id], onDelete: SetNull)
  
  // Task tracking
  dueDate       DateTime?
  completedAt   DateTime?
  order         Int       @default(0) // For ordering in Kanban
  
  // Timestamps
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime? // For soft deletes
  
  @@index([projectId])
  @@index([status])
  @@index([priority])
  @@index([assignedToId])
  @@index([createdById])
  @@index([dueDate])
  @@index([createdAt])
  @@index([deletedAt])
  @@index([projectId, status]) // For "get tasks by project and status"
  @@index([assignedToId, status]) // For "get assigned tasks by status"
}

model Activity {
  id            String    @id @default(cuid())
  action        ActivityAction
  userId        String
  projectId     String?
  taskId        String?
  description   String?   @db.Text
  metadata      Json?     // Store JSON metadata (old title, new title, etc)
  createdAt     DateTime  @default(now())
  
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  project       Project?  @relation(fields: [projectId], references: [id], onDelete: SetNull)
  
  @@index([userId])
  @@index([projectId])
  @@index([createdAt])
  @@index([userId, createdAt]) // For user's recent activity
}

model AuditLog {
  id            String    @id @default(cuid())
  userId        String?
  action        String    @db.VarChar(255)
  entity        String    @db.VarChar(50) // User, Project, Task
  entityId      String    @db.VarChar(255)
  changes       Json?     // What changed
  ipAddress     String?   @db.VarChar(45)
  userAgent     String?   @db.VarChar(500)
  createdAt     DateTime  @default(now())
  
  @@index([userId])
  @@index([action])
  @@index([entity, entityId])
  @@index([createdAt])
}
```

---

## Step 3: Create SQLite Dev Schema (Local Development)

**File**: `apps/server/prisma/schema.sqlite.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

enum UserRole {
  ADMIN
  MEMBER
}

enum ProjectStatus {
  PLANNING
  ACTIVE
  ON_HOLD
  COMPLETED
  ARCHIVED
}

enum TaskStatus {
  TODO
  IN_PROGRESS
  IN_REVIEW
  DONE
}

enum TaskPriority {
  LOW
  MEDIUM
  HIGH
  URGENT
}

enum ActivityAction {
  PROJECT_CREATED
  PROJECT_UPDATED
  PROJECT_ARCHIVED
  TASK_CREATED
  TASK_UPDATED
  TASK_ASSIGNED
  TASK_COMPLETED
  USER_ADDED_TO_PROJECT
  USER_REMOVED_FROM_PROJECT
}

model User {
  id            String    @id @default(cuid())
  name          String
  email         String    @unique
  passwordHash  String
  avatar        String?
  role          UserRole  @default(MEMBER)
  isActive      Boolean   @default(true)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime?
  
  ownedProjects Project[] @relation("ProjectOwner")
  projectMembers ProjectMember[]
  assignedTasks Task[] @relation("TaskAssignee")
  createdTasks  Task[] @relation("TaskCreator")
  refreshTokens RefreshToken[]
  activities    Activity[]
  
  @@index([email])
  @@index([role])
  @@index([isActive])
  @@index([deletedAt])
}

model RefreshToken {
  id            String    @id @default(cuid())
  tokenHash     String    @unique
  userId        String
  expiresAt     DateTime
  revokedAt     DateTime?
  userAgent     String?
  ipAddress     String?
  createdAt     DateTime  @default(now())
  
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
  @@index([expiresAt])
}

model Project {
  id            String    @id @default(cuid())
  title         String
  description   String?
  status        ProjectStatus @default(PLANNING)
  ownerId       String
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime?
  
  owner         User      @relation("ProjectOwner", fields: [ownerId], references: [id], onDelete: Restrict)
  members       ProjectMember[]
  tasks         Task[]
  activities    Activity[]
  
  @@index([ownerId])
  @@index([status])
  @@index([createdAt])
  @@index([deletedAt])
}

model ProjectMember {
  id            String    @id @default(cuid())
  projectId     String
  userId        String
  joinedAt      DateTime  @default(now())
  
  project       Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@unique([projectId, userId])
  @@index([userId])
  @@index([projectId])
}

model Task {
  id            String    @id @default(cuid())
  title         String
  description   String?
  status        TaskStatus @default(TODO)
  priority      TaskPriority @default(MEDIUM)
  projectId     String
  project       Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)
  
  createdById   String
  createdBy     User      @relation("TaskCreator", fields: [createdById], references: [id], onDelete: Restrict)
  
  assignedToId  String?
  assignedTo    User?     @relation("TaskAssignee", fields: [assignedToId], references: [id], onDelete: SetNull)
  
  dueDate       DateTime?
  completedAt   DateTime?
  order         Int       @default(0)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  deletedAt     DateTime?
  
  @@index([projectId])
  @@index([status])
  @@index([priority])
  @@index([assignedToId])
  @@index([createdById])
  @@index([dueDate])
  @@index([createdAt])
  @@index([deletedAt])
}

model Activity {
  id            String    @id @default(cuid())
  action        ActivityAction
  userId        String
  projectId     String?
  taskId        String?
  description   String?
  metadata      Json?
  createdAt     DateTime  @default(now())
  
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  project       Project?  @relation(fields: [projectId], references: [id], onDelete: SetNull)
  
  @@index([userId])
  @@index([projectId])
  @@index([createdAt])
  @@index([userId, createdAt])
}

model AuditLog {
  id            String    @id @default(cuid())
  userId        String?
  action        String
  entity        String
  entityId      String
  changes       Json?
  ipAddress     String?
  userAgent     String?
  createdAt     DateTime  @default(now())
  
  @@index([userId])
  @@index([action])
  @@index([entity, entityId])
  @@index([createdAt])
}
```

---

## Step 4: Update .env Files

**File**: `apps/server/.env.sqlite`

```env
NODE_ENV=development
PORT=3000
APP_NAME=AstralHQ
DATABASE_URL="file:../data/dev.db"

# Auth - Change these for production!
JWT_ACCESS_SECRET=dev-access-secret-minimum-32-characters-long-key
JWT_REFRESH_SECRET=dev-refresh-secret-minimum-32-characters-long-key
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

BCRYPT_ROUNDS=12
CORS_ORIGIN=http://localhost:5173
COOKIE_SECURE=false
COOKIE_HTTP_ONLY=true
COOKIE_SAME_SITE=lax

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=200
AUTH_RATE_LIMIT_MAX=20

# Token cleanup
TOKEN_CLEANUP_INTERVAL_MS=3600000
```

**File**: `apps/server/.env.example`

```env
# ============ Development (SQLite) ============
# Run: npm run setup:local
NODE_ENV=development
PORT=3000
APP_NAME=AstralHQ
DATABASE_URL="file:../data/dev.db"

# ============ Production (PostgreSQL) ============
# NODE_ENV=production
# DATABASE_URL=postgresql://user:password@host:5432/astralhq?schema=public
# DATABASE_DIRECT_URL=postgresql://user:password@host:5432/astralhq  # For migrations with pooling

# ============ Authentication ============
JWT_ACCESS_SECRET=your-secure-32-char-secret-key-here
JWT_REFRESH_SECRET=your-secure-32-char-secret-key-here
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# ============ Security ============
BCRYPT_ROUNDS=12
CORS_ORIGIN=http://localhost:5173
COOKIE_SECURE=true
COOKIE_HTTP_ONLY=true
COOKIE_SAME_SITE=strict

# ============ Rate Limiting ============
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=200
AUTH_RATE_LIMIT_MAX=20

# ============ Background Jobs ============
TOKEN_CLEANUP_INTERVAL_MS=3600000
```

---

## Step 5: Generate Migration

```bash
cd apps/server

# Generate new migration from updated schema
npx prisma migrate dev --name init_project_management

# This will create: prisma/migrations/[timestamp]_init_project_management/migration.sql
```

---

# PHASE 2: UPDATE ENVIRONMENT & CONFIG (MEDIUM PRIORITY)

## Step 6: Fix Config Files

**File**: `apps/server/src/config/constants.js`

```javascript
const API_PREFIX = "/api/v1";

const ROLES = Object.freeze({
  ADMIN: "ADMIN",
  MEMBER: "MEMBER",
});

const PROJECT_STATUS = Object.freeze({
  PLANNING: "PLANNING",
  ACTIVE: "ACTIVE",
  ON_HOLD: "ON_HOLD",
  COMPLETED: "COMPLETED",
  ARCHIVED: "ARCHIVED",
});

const TASK_STATUS = Object.freeze({
  TODO: "TODO",
  IN_PROGRESS: "IN_PROGRESS",
  IN_REVIEW: "IN_REVIEW",
  DONE: "DONE",
});

const TASK_PRIORITY = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  URGENT: "URGENT",
});

const REFRESH_COOKIE = "refreshToken";
const REFRESH_COOKIE_PATH = `${API_PREFIX}/auth`;

const JWT_ISSUER = "astralhq";
const JWT_AUDIENCE = "astralhq-api";

const ITEMS_PER_PAGE = 20;

module.exports = {
  API_PREFIX,
  ROLES,
  PROJECT_STATUS,
  TASK_STATUS,
  TASK_PRIORITY,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  JWT_ISSUER,
  JWT_AUDIENCE,
  ITEMS_PER_PAGE,
};
```

**File**: `apps/server/src/config/env.js`

```javascript
require("dotenv").config();

function requireEnv(key) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`❌ Missing required environment variable: ${key}`);
  }
  return value;
}

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3000,
  isProduction: process.env.NODE_ENV === "production",
  isDevelopment: process.env.NODE_ENV !== "production",
  appName: process.env.APP_NAME || "AstralHQ",
  databaseUrl: requireEnv("DATABASE_URL"),
  databaseDirectUrl: process.env.DATABASE_DIRECT_URL, // For Prisma Migrate with pooling
  
  jwt: {
    accessSecret: requireEnv("JWT_ACCESS_SECRET"),
    refreshSecret: requireEnv("JWT_REFRESH_SECRET"),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
    issuer: "astralhq",
    audience: "astralhq-api",
  },
  
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS) || 12,
  
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  },
  
  cookie: {
    secure: process.env.COOKIE_SECURE === "true",
    httpOnly: process.env.COOKIE_HTTP_ONLY !== "false",
    sameSite: process.env.COOKIE_SAME_SITE || "lax",
  },
  
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 200,
    authMax: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  },
  
  tokenCleanupIntervalMs:
    Number(process.env.TOKEN_CLEANUP_INTERVAL_MS) || 60 * 60 * 1000,
};

// Validate production settings
if (env.isProduction) {
  if (env.jwt.accessSecret.length < 32 || env.jwt.refreshSecret.length < 32) {
    throw new Error("❌ JWT secrets must be at least 32 characters in production");
  }
  if (!env.cookie.secure) {
    console.warn("⚠️ COOKIE_SECURE should be true in production");
  }
}

module.exports = env;
```

---

# PHASE 3: FIX SECURITY MIDDLEWARE (HIGH PRIORITY)

## Step 7: Update Security Middleware

**File**: `apps/server/src/middleware/security.middleware.js`

```javascript
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const express = require("express");
const { env } = require("../config");

function applySecurityMiddleware(app) {
  // Trust proxy (for Railway, Heroku, etc.)
  app.set("trust proxy", 1);

  // Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
  }));

  // CORS
  app.use(cors({
    origin: env.isProduction ? env.cors.origin : env.cors.origin,
    credentials: env.cors.credentials,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }));

  // Body parsing with size limit
  app.use(express.json({ limit: "10kb" }));
  app.use(express.urlencoded({ limit: "10kb", extended: true }));

  // Cookie parser
  app.use(cookieParser());

  // Global rate limit
  app.use(rateLimit({
    windowMs: env.rateLimit.windowMs,
    max: env.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests" },
    },
  }));
}

function createAuthRateLimiter() {
  return rateLimit({
    windowMs: env.rateLimit.windowMs,
    max: env.rateLimit.authMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many auth attempts" },
    },
    skip: (req) => {
      // Skip rate limit for health checks
      return req.path === "/api/v1/health";
    },
  });
}

module.exports = { applySecurityMiddleware, createAuthRateLimiter };
```

---

# PHASE 4: NEW SEED DATA (CRITICAL)

## Step 8: Create New Seed Script

**File**: `apps/server/prisma/seed.js`

```javascript
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seed...");

  // ============ USERS ============
  const adminHash = await bcrypt.hash("Admin@123456", 12);
  const memberHash = await bcrypt.hash("Member@123456", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@astralhq.app" },
    update: { isActive: true, deletedAt: null },
    create: {
      email: "admin@astralhq.app",
      passwordHash: adminHash,
      name: "Admin User",
      role: "ADMIN",
      avatar: "https://api.dicebear.com/7.x/initials/svg?seed=AU",
    },
  });

  const member1 = await prisma.user.upsert({
    where: { email: "alice@astralhq.app" },
    update: { isActive: true, deletedAt: null },
    create: {
      email: "alice@astralhq.app",
      passwordHash: memberHash,
      name: "Alice Johnson",
      role: "MEMBER",
      avatar: "https://api.dicebear.com/7.x/initials/svg?seed=AJ",
    },
  });

  const member2 = await prisma.user.upsert({
    where: { email: "bob@astralhq.app" },
    update: { isActive: true, deletedAt: null },
    create: {
      email: "bob@astralhq.app",
      passwordHash: memberHash,
      name: "Bob Smith",
      role: "MEMBER",
      avatar: "https://api.dicebear.com/7.x/initials/svg?seed=BS",
    },
  });

  console.log("✅ Users created:", admin.email, member1.email, member2.email);

  // ============ PROJECTS ============
  const project1 = await prisma.project.upsert({
    where: { id: "proj_demo_1" },
    update: { deletedAt: null },
    create: {
      id: "proj_demo_1",
      title: "Website Redesign",
      description: "Redesign company website with modern UI",
      status: "ACTIVE",
      ownerId: admin.id,
    },
  });

  const project2 = await prisma.project.upsert({
    where: { id: "proj_demo_2" },
    update: { deletedAt: null },
    create: {
      id: "proj_demo_2",
      title: "Mobile App",
      description: "Build React Native mobile app",
      status: "PLANNING",
      ownerId: admin.id,
    },
  });

  console.log("✅ Projects created:", project1.title, project2.title);

  // ============ PROJECT MEMBERS ============
  await prisma.projectMember.deleteMany({});

  await prisma.projectMember.createMany({
    data: [
      { projectId: project1.id, userId: admin.id },
      { projectId: project1.id, userId: member1.id },
      { projectId: project1.id, userId: member2.id },
      { projectId: project2.id, userId: admin.id },
      { projectId: project2.id, userId: member1.id },
    ],
  });

  console.log("✅ Project members assigned");

  // ============ TASKS ============
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const nextWeek = new Date(today.getTime() + 7 * 86400000);

  await prisma.task.deleteMany({});

  const tasks = await prisma.task.createMany({
    data: [
      // Project 1 Tasks
      {
        title: "Create wireframes",
        description: "Design initial wireframes for new website",
        status: "IN_PROGRESS",
        priority: "HIGH",
        projectId: project1.id,
        createdById: admin.id,
        assignedToId: member1.id,
        dueDate: tomorrow,
        order: 0,
      },
      {
        title: "Setup design system",
        description: "Define colors, typography, components",
        status: "TODO",
        priority: "HIGH",
        projectId: project1.id,
        createdById: admin.id,
        assignedToId: member2.id,
        dueDate: nextWeek,
        order: 1,
      },
      {
        title: "Responsive design",
        description: "Ensure mobile and tablet support",
        status: "TODO",
        priority: "MEDIUM",
        projectId: project1.id,
        createdById: admin.id,
        dueDate: new Date(today.getTime() + 14 * 86400000),
        order: 2,
      },
      {
        title: "Code review",
        description: "Review frontend code",
        status: "DONE",
        priority: "MEDIUM",
        projectId: project1.id,
        createdById: member1.id,
        assignedToId: member2.id,
        completedAt: today,
        order: 3,
      },
      // Project 2 Tasks
      {
        title: "Setup React Native project",
        description: "Initialize new RN project",
        status: "TODO",
        priority: "URGENT",
        projectId: project2.id,
        createdById: admin.id,
        assignedToId: member1.id,
        dueDate: tomorrow,
        order: 0,
      },
      {
        title: "Define API contracts",
        description: "Document API endpoints and schemas",
        status: "IN_REVIEW",
        priority: "HIGH",
        projectId: project2.id,
        createdById: admin.id,
        assignedToId: member1.id,
        dueDate: nextWeek,
        order: 1,
      },
    ],
  });

  console.log("✅ Tasks created:", tasks.count);

  // ============ ACTIVITIES ============
  await prisma.activity.deleteMany({});

  await prisma.activity.createMany({
    data: [
      {
        action: "PROJECT_CREATED",
        userId: admin.id,
        projectId: project1.id,
        description: `Project "${project1.title}" created`,
        metadata: { title: project1.title },
      },
      {
        action: "TASK_CREATED",
        userId: admin.id,
        projectId: project1.id,
        description: "Task 'Create wireframes' created",
        metadata: { taskTitle: "Create wireframes" },
      },
      {
        action: "TASK_ASSIGNED",
        userId: admin.id,
        projectId: project1.id,
        description: "Task assigned to Alice Johnson",
        metadata: { assignee: "alice@astralhq.app" },
      },
      {
        action: "USER_ADDED_TO_PROJECT",
        userId: admin.id,
        projectId: project1.id,
        description: "Alice Johnson added to project",
        metadata: { user: "alice@astralhq.app" },
      },
    ],
  });

  console.log("✅ Activities logged");

  console.log("\n✨ Seed completed successfully!\n");
  console.log("📧 Demo Accounts:");
  console.log("   Admin:  admin@astralhq.app / Admin@123456");
  console.log("   Member: alice@astralhq.app / Member@123456");
  console.log("   Member: bob@astralhq.app / Member@123456\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

---

# PHASE 5: ADD MISSING SERVICES & UTILITIES (HIGH PRIORITY)

## Step 9: Create Core Services

**File**: `apps/server/src/shared/services/index.js`

```javascript
module.exports = {
  tokenService: require("./token.service"),
  queryService: require("./query.service"),
  authService: require("../auth/auth.service"),
};
```

**File**: `apps/server/src/shared/services/token.service.js`

```javascript
const jwt = require("jsonwebtoken");
const { env } = require("../../config");
const prisma = require("../../core/database/prisma");
const crypto = require("crypto");

function signAccessToken(payload) {
  return jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessExpiresIn,
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.accessSecret, {
    issuer: env.jwt.issuer,
    audience: env.jwt.audience,
  });
}

async function createRefreshToken(userId, meta = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  await prisma.refreshToken.create({
    data: {
      tokenHash,
      userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      userAgent: meta.userAgent || null,
      ipAddress: meta.ipAddress || null,
    },
  });

  return token;
}

async function verifyRefreshToken(token) {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const refreshToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
  });

  if (!refreshToken || refreshToken.revokedAt) {
    throw new Error("Invalid or revoked refresh token");
  }

  if (new Date() > refreshToken.expiresAt) {
    throw new Error("Refresh token expired");
  }

  return refreshToken;
}

async function rotateRefreshToken(oldToken, meta = {}) {
  const refreshToken = await verifyRefreshToken(oldToken);
  
  // Revoke old token
  await prisma.refreshToken.update({
    where: { id: refreshToken.id },
    data: { revokedAt: new Date() },
  });

  // Create new token
  const newToken = await createRefreshToken(refreshToken.userId, meta);

  return {
    userId: refreshToken.userId,
    refreshToken: newToken,
  };
}

async function revokeRefreshToken(token) {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await prisma.refreshToken.updateMany({
    where: { tokenHash },
    data: { revokedAt: new Date() },
  });
}

async function revokeAllUserRefreshTokens(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function cleanupExpiredTokens() {
  const result = await prisma.refreshToken.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  return result.count;
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  createRefreshToken,
  verifyRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  cleanupExpiredTokens,
};
```

**File**: `apps/server/src/shared/services/query.service.js`

```javascript
// Utility service for common queries

async function getPaginatedResults(model, where, options = {}) {
  const {
    skip = 0,
    take = 20,
    orderBy = { createdAt: "desc" },
    include = {},
    select = null,
  } = options;

  const [data, total] = await Promise.all([
    model.findMany({
      where: { ...where, deletedAt: null },
      skip,
      take,
      orderBy,
      include,
      select,
    }),
    model.count({
      where: { ...where, deletedAt: null },
    }),
  ]);

  return {
    data,
    total,
    pages: Math.ceil(total / take),
    currentPage: Math.floor(skip / take) + 1,
    hasMore: skip + take < total,
  };
}

async function softDelete(model, id) {
  return model.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

async function restore(model, id) {
  return model.update({
    where: { id },
    data: { deletedAt: null },
  });
}

module.exports = {
  getPaginatedResults,
  softDelete,
  restore,
};
```

---

# PHASE 6: ADD VALIDATIONS (HIGH PRIORITY)

## Step 10: Create Validators

**File**: `apps/server/src/modules/auth/auth.validators.js`

```javascript
const { body, validationResult } = require("express-validator");

const registerValidator = [
  body("name")
    .trim()
    .isLength({ min: 2, max: 255 })
    .withMessage("Name must be between 2 and 255 characters"),
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Must be a valid email"),
  body("password")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters")
    .matches(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])/)
    .withMessage("Password must contain uppercase, lowercase, number, and special character"),
];

const loginValidator = [
  body("email")
    .isEmail()
    .normalizeEmail()
    .withMessage("Must be a valid email"),
  body("password")
    .notEmpty()
    .withMessage("Password is required"),
];

module.exports = {
  registerValidator,
  loginValidator,
};
```

**File**: `apps/server/src/modules/projects/project.validators.js`

```javascript
const { body, param } = require("express-validator");

const createProjectValidator = [
  body("title")
    .trim()
    .isLength({ min: 3, max: 255 })
    .withMessage("Title must be between 3 and 255 characters"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage("Description must be less than 5000 characters"),
  body("status")
    .optional()
    .isIn(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"])
    .withMessage("Invalid status"),
];

const updateProjectValidator = [
  param("id").isString().withMessage("Invalid project ID"),
  body("title")
    .optional()
    .trim()
    .isLength({ min: 3, max: 255 })
    .withMessage("Title must be between 3 and 255 characters"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage("Description must be less than 5000 characters"),
  body("status")
    .optional()
    .isIn(["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"])
    .withMessage("Invalid status"),
];

module.exports = {
  createProjectValidator,
  updateProjectValidator,
};
```

**File**: `apps/server/src/modules/tasks/task.validators.js`

```javascript
const { body, param } = require("express-validator");

const createTaskValidator = [
  param("projectId").isString().withMessage("Invalid project ID"),
  body("title")
    .trim()
    .isLength({ min: 3, max: 255 })
    .withMessage("Title must be between 3 and 255 characters"),
  body("description")
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage("Description must be less than 5000 characters"),
  body("priority")
    .optional()
    .isIn(["LOW", "MEDIUM", "HIGH", "URGENT"])
    .withMessage("Invalid priority"),
  body("status")
    .optional()
    .isIn(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"])
    .withMessage("Invalid status"),
  body("dueDate")
    .optional()
    .isISO8601()
    .withMessage("Invalid date format"),
  body("assignedToId")
    .optional()
    .isString()
    .withMessage("Invalid user ID"),
];

const updateTaskValidator = [
  param("projectId").isString().withMessage("Invalid project ID"),
  param("taskId").isString().withMessage("Invalid task ID"),
  body("title")
    .optional()
    .trim()
    .isLength({ min: 3, max: 255 })
    .withMessage("Title must be between 3 and 255 characters"),
  body("status")
    .optional()
    .isIn(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"])
    .withMessage("Invalid status"),
  body("priority")
    .optional()
    .isIn(["LOW", "MEDIUM", "HIGH", "URGENT"])
    .withMessage("Invalid priority"),
  body("dueDate")
    .optional()
    .isISO8601()
    .withMessage("Invalid date format"),
];

module.exports = {
  createTaskValidator,
  updateTaskValidator,
};
```

---

# PHASE 7: ADD AUTHORIZATION MIDDLEWARE (CRITICAL)

## Step 11: Create RBAC Authorization

**File**: `apps/server/src/middleware/authorize.middleware.js`

```javascript
const { AppError } = require("../core/errors");
const { ROLES } = require("../config/constants");
const prisma = require("../core/database/prisma");

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      throw new AppError("Authentication required", 401, "UNAUTHORIZED");
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError(
        "You do not have permission to perform this action",
        403,
        "FORBIDDEN"
      );
    }

    next();
  };
}

async function authorizeProjectAccess(req, res, next) {
  const { projectId } = req.params;

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      OR: [
        { ownerId: req.user.id }, // Owner has access
        { members: { some: { userId: req.user.id } } }, // Member has access
      ],
    },
  });

  if (!project) {
    throw new AppError(
      "Project not found or you don't have access",
      404,
      "PROJECT_NOT_FOUND"
    );
  }

  req.project = project;
  next();
}

async function authorizeTaskAccess(req, res, next) {
  const { projectId, taskId } = req.params;

  // First check project access
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      OR: [
        { ownerId: req.user.id },
        { members: { some: { userId: req.user.id } } },
      ],
    },
  });

  if (!project) {
    throw new AppError(
      "Project not found or you don't have access",
      404,
      "PROJECT_NOT_FOUND"
    );
  }

  // Then check task exists in project
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      projectId,
      deletedAt: null,
    },
  });

  if (!task) {
    throw new AppError("Task not found", 404, "TASK_NOT_FOUND");
  }

  req.project = project;
  req.task = task;
  next();
}

module.exports = {
  authorize,
  authorizeProjectAccess,
  authorizeTaskAccess,
};
```

---

# PHASE 8: CREATE MODULES (REST APIs)

## Step 12: Create Project Module

**File**: `apps/server/src/modules/projects/project.service.js`

```javascript
const prisma = require("../../core/database/prisma");
const { AppError } = require("../../core/errors");
const { getPaginatedResults } = require("../../shared/services");

async function createProject(data, userId) {
  return prisma.project.create({
    data: {
      title: data.title,
      description: data.description,
      status: data.status || "PLANNING",
      ownerId: userId,
      members: {
        create: [{ userId }], // Add creator as member
      },
    },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });
}

async function getProjectById(id) {
  const project = await prisma.project.findFirst({
    where: { id, deletedAt: null },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
      tasks: { where: { deletedAt: null }, select: { id: true, status: true } },
    },
  });

  if (!project) throw new AppError("Project not found", 404, "PROJECT_NOT_FOUND");
  return project;
}

async function getUserProjects(userId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  return getPaginatedResults(
    prisma.project,
    {
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
      ],
    },
    {
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { id: true, name: true } },
        members: { select: { userId: true } },
        tasks: { where: { deletedAt: null }, select: { id: true, status: true } },
      },
    }
  );
}

async function updateProject(id, data, userId) {
  const project = await prisma.project.findFirst({
    where: { id, ownerId: userId, deletedAt: null },
  });

  if (!project) throw new AppError("Project not found", 404, "PROJECT_NOT_FOUND");

  const updated = await prisma.project.update({
    where: { id },
    data: {
      title: data.title || project.title,
      description: data.description !== undefined ? data.description : project.description,
      status: data.status || project.status,
    },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      members: { include: { user: { select: { id: true, name: true, email: true } } } },
    },
  });

  // Log activity
  await prisma.activity.create({
    data: {
      action: "PROJECT_UPDATED",
      userId,
      projectId: id,
      description: `Project "${updated.title}" updated`,
      metadata: data,
    },
  });

  return updated;
}

async function deleteProject(id, userId) {
  const project = await prisma.project.findFirst({
    where: { id, ownerId: userId, deletedAt: null },
  });

  if (!project) throw new AppError("Project not found", 404, "PROJECT_NOT_FOUND");

  await prisma.project.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await prisma.activity.create({
    data: {
      action: "PROJECT_ARCHIVED",
      userId,
      projectId: id,
      description: `Project "${project.title}" deleted`,
    },
  });
}

async function addProjectMember(projectId, userId, creatorId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: creatorId, deletedAt: null },
  });

  if (!project) throw new AppError("Project not found", 404, "PROJECT_NOT_FOUND");

  const existingMember = await prisma.projectMember.findFirst({
    where: { projectId, userId },
  });

  if (existingMember) throw new AppError("User already in project", 409, "USER_ALREADY_MEMBER");

  await prisma.projectMember.create({
    data: { projectId, userId },
  });

  const user = await prisma.user.findUnique({ where: { id: userId } });

  await prisma.activity.create({
    data: {
      action: "USER_ADDED_TO_PROJECT",
      userId: creatorId,
      projectId,
      description: `${user.name} added to project`,
      metadata: { addedUserId: userId },
    },
  });
}

async function removeProjectMember(projectId, userId, creatorId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, ownerId: creatorId, deletedAt: null },
  });

  if (!project) throw new AppError("Project not found", 404, "PROJECT_NOT_FOUND");

  if (project.ownerId === userId) {
    throw new AppError("Cannot remove project owner", 400, "CANNOT_REMOVE_OWNER");
  }

  await prisma.projectMember.deleteMany({
    where: { projectId, userId },
  });

  const user = await prisma.user.findUnique({ where: { id: userId } });

  await prisma.activity.create({
    data: {
      action: "USER_REMOVED_FROM_PROJECT",
      userId: creatorId,
      projectId,
      description: `${user.name} removed from project`,
      metadata: { removedUserId: userId },
    },
  });
}

module.exports = {
  createProject,
  getProjectById,
  getUserProjects,
  updateProject,
  deleteProject,
  addProjectMember,
  removeProjectMember,
};
```

**File**: `apps/server/src/modules/projects/project.controller.js`

```javascript
const { catchAsync } = require("../../core/http");
const projectService = require("./project.service");

const createProject = catchAsync(async (req, res) => {
  const project = await projectService.createProject(req.body, req.user.id);
  res.status(201).json({
    success: true,
    data: project,
  });
});

const getProjects = catchAsync(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const result = await projectService.getUserProjects(
    req.user.id,
    parseInt(page),
    parseInt(limit)
  );
  res.json({
    success: true,
    data: result.data,
    pagination: {
      total: result.total,
      pages: result.pages,
      currentPage: result.currentPage,
      hasMore: result.hasMore,
    },
  });
});

const getProjectById = catchAsync(async (req, res) => {
  const project = await projectService.getProjectById(req.params.projectId);
  res.json({
    success: true,
    data: project,
  });
});

const updateProject = catchAsync(async (req, res) => {
  const project = await projectService.updateProject(
    req.params.projectId,
    req.body,
    req.user.id
  );
  res.json({
    success: true,
    data: project,
  });
});

const deleteProject = catchAsync(async (req, res) => {
  await projectService.deleteProject(req.params.projectId, req.user.id);
  res.json({
    success: true,
    message: "Project deleted successfully",
  });
});

const addMember = catchAsync(async (req, res) => {
  await projectService.addProjectMember(
    req.params.projectId,
    req.body.userId,
    req.user.id
  );
  res.json({
    success: true,
    message: "Member added successfully",
  });
});

const removeMember = catchAsync(async (req, res) => {
  await projectService.removeProjectMember(
    req.params.projectId,
    req.body.userId,
    req.user.id
  );
  res.json({
    success: true,
    message: "Member removed successfully",
  });
});

module.exports = {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
  addMember,
  removeMember,
};
```

**File**: `apps/server/src/modules/projects/project.routes.js`

```javascript
const express = require("express");
const { authenticate } = require("../../middleware/auth.middleware");
const { authorizeProjectAccess } = require("../../middleware/authorize.middleware");
const { validationErrorHandler } = require("../../middleware/validate.middleware");
const { createProjectValidator, updateProjectValidator } = require("./project.validators");
const controller = require("./project.controller");

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get all projects for user
router.get("/", controller.getProjects);

// Create new project
router.post("/", createProjectValidator, validationErrorHandler, controller.createProject);

// Get project by ID
router.get("/:projectId", authorizeProjectAccess, controller.getProjectById);

// Update project
router.put(
  "/:projectId",
  authorizeProjectAccess,
  updateProjectValidator,
  validationErrorHandler,
  controller.updateProject
);

// Delete project
router.delete("/:projectId", authorizeProjectAccess, controller.deleteProject);

// Add member to project
router.post("/:projectId/members", authorizeProjectAccess, controller.addMember);

// Remove member from project
router.delete("/:projectId/members/:userId", authorizeProjectAccess, controller.removeMember);

module.exports = router;
```

---

## Step 13: Create Task Module (Similar Pattern)

**File**: `apps/server/src/modules/tasks/task.service.js`

```javascript
const prisma = require("../../core/database/prisma");
const { AppError } = require("../../core/errors");
const { getPaginatedResults } = require("../../shared/services");

async function createTask(projectId, data, userId) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
  });

  if (!project) throw new AppError("Project not found", 404, "PROJECT_NOT_FOUND");

  const task = await prisma.task.create({
    data: {
      title: data.title,
      description: data.description,
      priority: data.priority || "MEDIUM",
      status: data.status || "TODO",
      projectId,
      createdById: userId,
      assignedToId: data.assignedToId || null,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
    },
    include: {
      project: { select: { id: true, title: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
    },
  });

  await prisma.activity.create({
    data: {
      action: "TASK_CREATED",
      userId,
      projectId,
      description: `Task "${task.title}" created`,
      metadata: { taskId: task.id, taskTitle: task.title },
    },
  });

  if (data.assignedToId) {
    await prisma.activity.create({
      data: {
        action: "TASK_ASSIGNED",
        userId,
        projectId,
        description: `Task assigned to ${task.assignedTo.name}`,
        metadata: { taskId: task.id, assigneeId: data.assignedToId },
      },
    });
  }

  return task;
}

async function getProjectTasks(projectId, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  return getPaginatedResults(
    prisma.task,
    { projectId, deletedAt: null },
    {
      skip,
      take: limit,
      orderBy: { order: "asc" },
      include: {
        createdBy: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    }
  );
}

async function updateTask(taskId, data, userId) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
  });

  if (!task) throw new AppError("Task not found", 404, "TASK_NOT_FOUND");

  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      title: data.title || task.title,
      description: data.description !== undefined ? data.description : task.description,
      status: data.status || task.status,
      priority: data.priority || task.priority,
      assignedToId: data.assignedToId !== undefined ? data.assignedToId : task.assignedToId,
      dueDate: data.dueDate ? new Date(data.dueDate) : task.dueDate,
      completedAt: data.status === "DONE" && task.status !== "DONE" ? new Date() : task.completedAt,
    },
    include: {
      createdBy: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
    },
  });

  await prisma.activity.create({
    data: {
      action: "TASK_UPDATED",
      userId,
      projectId: task.projectId,
      description: `Task "${updated.title}" updated`,
      metadata: {
        taskId: taskId,
        changes: {
          status: data.status ? { from: task.status, to: data.status } : undefined,
          priority: data.priority ? { from: task.priority, to: data.priority } : undefined,
          assignee: data.assignedToId ? { to: data.assignedToId } : undefined,
        },
      },
    },
  });

  return updated;
}

async function deleteTask(taskId, userId) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
  });

  if (!task) throw new AppError("Task not found", 404, "TASK_NOT_FOUND");

  await prisma.task.update({
    where: { id: taskId },
    data: { deletedAt: new Date() },
  });

  await prisma.activity.create({
    data: {
      action: "TASK_COMPLETED",
      userId,
      projectId: task.projectId,
      description: `Task "${task.title}" deleted`,
    },
  });
}

module.exports = {
  createTask,
  getProjectTasks,
  updateTask,
  deleteTask,
};
```

---

# PHASE 9: CREATE DASHBOARD MODULE

## Step 14: Create Dashboard Service

**File**: `apps/server/src/modules/dashboard/dashboard.service.js`

```javascript
const prisma = require("../../core/database/prisma");
const { TASK_STATUS } = require("../../config/constants");

async function getDashboard(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get user's projects
  const projects = await prisma.project.findMany({
    where: {
      deletedAt: null,
      OR: [
        { ownerId: userId },
        { members: { some: { userId } } },
      ],
    },
    select: { id: true, title: true, status: true },
  });

  const projectIds = projects.map(p => p.id);

  // Tasks by status
  const tasksByStatus = await prisma.task.groupBy({
    by: ["status"],
    where: {
      projectId: { in: projectIds },
      deletedAt: null,
    },
    _count: {
      id: true,
    },
  });

  // My assigned tasks
  const myTasks = await prisma.task.findMany({
    where: {
      assignedToId: userId,
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      project: { select: { id: true, title: true } },
    },
    take: 10,
  });

  // Overdue tasks
  const overdueTasks = await prisma.task.findMany({
    where: {
      projectId: { in: projectIds },
      deletedAt: null,
      dueDate: { lt: today },
      status: { not: "DONE" },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      priority: true,
      project: { select: { id: true, title: true } },
    },
  });

  // Due today
  const dueTodayTasks = await prisma.task.findMany({
    where: {
      projectId: { in: projectIds },
      deletedAt: null,
      dueDate: {
        gte: today,
        lt: new Date(today.getTime() + 86400000),
      },
      status: { not: "DONE" },
    },
    select: {
      id: true,
      title: true,
      priority: true,
      project: { select: { id: true, title: true } },
    },
  });

  // Recent activity
  const recentActivity = await prisma.activity.findMany({
    where: {
      projectId: { in: projectIds },
    },
    include: {
      user: { select: { id: true, name: true, avatar: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return {
    stats: {
      totalProjects: projects.length,
      tasksByStatus: tasksByStatus.reduce((acc, item) => {
        acc[item.status] = item._count.id;
        return acc;
      }, {}),
      myTasksCount: myTasks.length,
      overdueCount: overdueTasks.length,
      dueTodayCount: dueTodayTasks.length,
    },
    myTasks,
    overdueTasks,
    dueTodayTasks,
    recentActivity,
    projects,
  };
}

module.exports = {
  getDashboard,
};
```

---

# PHASE 10: UPDATE ROUTES & APP CONFIG

## Step 15: Update Main Routes

**File**: `apps/server/src/routes/v1/index.js`

```javascript
const express = require("express");
const healthRoutes = require("../../modules/health/health.routes");
const authRoutes = require("../../modules/auth/auth.routes");
const projectRoutes = require("../../modules/projects/project.routes");
const taskRoutes = require("../../modules/tasks/task.routes");
const dashboardRoutes = require("../../modules/dashboard/dashboard.routes");

const router = express.Router();

// Health check (no auth required)
router.use("/health", healthRoutes);

// Auth (no auth required for some routes)
router.use("/auth", authRoutes);

// Projects (auth required)
router.use("/projects", projectRoutes);

// Tasks (auth required)
router.use("/projects/:projectId/tasks", taskRoutes);

// Dashboard (auth required)
router.use("/dashboard", dashboardRoutes);

module.exports = router;
```

**File**: `apps/server/src/routes/index.js`

```javascript
const express = require("express");
const v1Routes = require("./v1");

const router = express.Router();

router.use("/v1", v1Routes);

// Health check at root
router.get("/health", (req, res) => {
  res.json({ success: true, message: "API is running" });
});

module.exports = router;
```

**File**: `apps/server/src/app.js`

```javascript
const express = require("express");
const { constants } = require("./config");
const apiRoutes = require("./routes");
const {
  applySecurityMiddleware,
  notFoundHandler,
  errorHandler,
} = require("./middleware");

const app = express();

// Apply security middleware
applySecurityMiddleware(app);

// API routes
app.use("/api", apiRoutes);

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

module.exports = app;
```

---

# PHASE 11: DEPLOYMENT & CI/CD

## Step 16: Create GitHub Actions CI/CD

**File**: `.github/workflows/deploy.yml`

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test-and-build:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: astralhq_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v3

      - uses: actions/setup-node@v3
        with:
          node-version: "20"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Setup test database
        run: |
          cd apps/server
          npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/astralhq_test

      - name: Run tests
        run: npm run test
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/astralhq_test

      - name: Build client
        run: npm run build -w @astralhq/client

      - name: Deploy to Railway
        if: success()
        run: |
          curl --location --request POST 'https://api.railway.app/graphql' \
            -H 'Authorization: Bearer ${{ secrets.RAILWAY_TOKEN }}' \
            -H 'Content-Type: application/json' \
            -d '{
              "query": "mutation { planDeploy(input: {projectId: \"${{ secrets.RAILWAY_PROJECT_ID }}\" environmentId: \"${{ secrets.RAILWAY_ENVIRONMENT_ID }}\"}) { deployment { id } } }"
            }'
```

---

# COMPLETE SETUP SCRIPT

## Step 17: Create Setup Script

**File**: `scripts/setup.sh`

```bash
#!/bin/bash

set -e

echo "🚀 AstralHQ Setup Script"
echo "========================\n"

# Step 1: Install dependencies
echo "📦 Installing dependencies..."
npm install

# Step 2: Setup environment
echo "🔐 Setting up environment files..."
if [ ! -f apps/server/.env ]; then
  cp apps/server/.env.sqlite apps/server/.env
  echo "✅ Created .env from .env.sqlite"
fi

if [ ! -f apps/client/.env ]; then
  cp apps/client/.env.example apps/client/.env
  echo "✅ Created client .env"
fi

# Step 3: Setup database
echo "🗄️  Setting up database..."
cd apps/server
npx prisma migrate deploy
npx prisma generate
npx prisma db seed
cd ../..

echo "\n✨ Setup complete!"
echo "\n📧 Demo Accounts:"
echo "   Admin:  admin@astralhq.app / Admin@123456"
echo "   Member: alice@astralhq.app / Member@123456"
echo "   Member: bob@astralhq.app / Member@123456"
echo "\n🚀 Start development:"
echo "   npm run dev"
echo "\n🌐 Access the app:"
echo "   Frontend: http://localhost:5173"
echo "   API: http://localhost:3000/api/v1"
```

---

# PRODUCTION DEPLOYMENT CHECKLIST

Create: `DEPLOYMENT_CHECKLIST.md`

```markdown
# Production Deployment Checklist

## Pre-Deployment
- [ ] All tests passing
- [ ] Environment variables configured
- [ ] Database migrations created and tested
- [ ] Secrets in GitHub Secrets (JWT keys, DB URL, etc.)
- [ ] CORS_ORIGIN set to production domain
- [ ] COOKIE_SECURE=true
- [ ] NODE_ENV=production

## Database
- [ ] PostgreSQL instance created (Railway, AWS RDS, etc.)
- [ ] Backups configured (daily backups)
- [ ] Connection pooling enabled (PgBouncer)
- [ ] Migrations applied to production
- [ ] Indexes verified

## Security
- [ ] HTTPS enabled
- [ ] Rate limiting configured
- [ ] CSRF protection enabled
- [ ] Input validation on all endpoints
- [ ] SQL injection protection (Prisma ORM)
- [ ] XSS protection (Helmet headers)

## Monitoring
- [ ] Error logging configured (Sentry, DataDog)
- [ ] Performance monitoring setup
- [ ] Uptime monitoring configured
- [ ] Log aggregation setup

## API
- [ ] API documentation updated
- [ ] Rate limits tested
- [ ] Auth flows tested
- [ ] RBAC tested
- [ ] Data validation tested

## Deployment
- [ ] Railway configured for auto-deploy on main branch
- [ ] Environment variables set in Railway
- [ ] Database migrations auto-run on deploy
- [ ] Health check endpoint working
- [ ] Error handling tested

## Post-Deployment
- [ ] Smoke tests passed
- [ ] Users can login/signup
- [ ] Can create projects/tasks
- [ ] Dashboard loads correctly
- [ ] No critical errors in logs
```

---

Now follow these steps in order:

1. **Delete old migration** (Step 1)
2. **Update schema** (Steps 2-3)
3. **Update env** (Step 4)
4. **Generate migration** (Step 5)
5. **Fix configs** (Step 6)
6. **Update security** (Step 7)
7. **Add seed data** (Step 8)
8. **Create services** (Step 9)
9. **Add validators** (Step 10)
10. **Add RBAC** (Step 11)
11. **Create modules** (Steps 12-13)
12. **Add dashboard** (Step 14)
13. **Update routes** (Step 15)
14. **Setup CI/CD** (Step 16)

This transforms AstralHQ into a **production-ready project management app**!
