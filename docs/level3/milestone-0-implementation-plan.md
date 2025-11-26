# Milestone 0 Implementation Plan: Monorepo Restructure

## 🎯 Objective
Reorganize the existing Level 2 monolith into a monorepo structure BEFORE introducing Level 3 complexity. This prevents debugging nightmares during the transition and ensures all existing functionality remains intact.

## 📋 Prerequisites
- ✅ Level 2 implementation is complete and working
- ✅ Current codebase runs successfully without errors
- ✅ All Docker services start successfully
- ✅ Git repository is clean (commit any pending changes)

## 🛠️ Implementation Steps

### Step 1: Create Monorepo Directory Structure

**Actions:**
1. Create directory structure:
   ```
   /apps
     /api          (will contain existing src/*)
     /worker       (empty for now, populated in Milestone 4)
   /packages
     /database     (will contain db.ts and schema)
     /types        (will contain TypeScript interfaces)
     /lib          (will contain shared utilities)
   ```

2. Create placeholder README.md files in each directory for clarity

**Rationale:** Clear separation of concerns - apps are deployable services, packages are shared libraries

---

### Step 2: Initialize Package Structure

**Actions:**
1. Create `packages/database/package.json`:
   - Name: `@ticket-hive/database`
   - Main entry: `src/index.ts`
   - Type: `module`
   - Dependencies: `postgres`, `zod`
   - DevDependencies: TypeScript (for type checking only, not runtime compilation)

2. Create `packages/types/package.json`:
   - Name: `@ticket-hive/types`
   - Main entry: `src/index.ts`
   - Dependencies: `zod`
   - No runtime dependencies (pure types)

3. Create `packages/lib/package.json`:
   - Name: `@ticket-hive/lib`
   - Main entry: `src/index.ts`
   - Dependencies: `@ticket-hive/database`, `@ticket-hive/types`, `bcrypt`, `jsonwebtoken`, `@t3-oss/env-core`

4. Create `apps/api/package.json`:
   - Name: `@ticket-hive/api`
   - Main entry: `src/index.ts`
   - Dependencies: All shared packages + Express middleware

5. Create `apps/worker/package.json`:
   - Name: `@ticket-hive/worker`
   - Main entry: `src/index.ts`
   - Minimal dependencies for now (to be expanded later)

**Rationale:** Each package must be independently buildable and publishable

---

### Step 3: Extract Shared Database Layer

**Actions:**
1. Move `src/lib/db.ts` → `packages/database/src/index.ts`
2. Preserve entire file content initially (no refactoring yet)
3. Update exports to be explicit:
   ```typescript
   export { sql, initializeDatabase };
   export type { TransactionSql };
   ```

4. Create `packages/database/src/schema.ts`:
   - Extract `initializeDatabase()` function
   - Move all SQL schema definitions here
   - Export schema creation functions

5. Create barrel export file `packages/database/src/index.ts`:
   ```typescript
   export * from './schema';
   export { sql, initializeDatabase } from './db';
   ```

**Critical Considerations:**
- Maintain identical connection pool configuration
- Keep `statement_timeout: 5000` unchanged
- Do not modify database initialization logic
- Ensure environment variable loading still works

---

### Step 4: Extract Shared Types

**Actions:**
1. Move `src/types/index.ts` → `packages/types/src/index.ts`
2. Add Zod schema exports alongside TypeScript types:
   ```typescript
   // Export both types and validation schemas
   export interface User { ... }
   export const UserSchema = z.object({ ... });
   ```

3. Create type categories for better organization:
   - `auth.ts` - Authentication types
   - `event.ts` - Event types
   - `booking.ts` - Booking types
   - `api.ts` - API request/response types
   - `index.ts` - Barrel exports

4. Ensure all Zod schemas are reusable between API and Worker

**Rationale:** Type definitions must be available to both API and Worker services to ensure contract consistency

---

### Step 5: Extract Shared Utilities

**Actions:**
1. Move and reorganize files from `src/lib/` to `packages/lib/src/`:
   ```
   packages/lib/src/
     ├── errors.ts           (from src/lib/errors.ts)
     ├── errorHandler.ts     (from src/lib/errorHandler.ts)
     ├── auth.ts             (from src/lib/auth.ts)
     ├── env.ts              (from src/lib/env.ts)
     ├── logger.ts           (extract logging utilities)
     └── index.ts            (barrel exports)
   ```

2. Update imports in each utility file:
   - Use package imports (`@ticket-hive/types` instead of relative paths)
   - Ensure no circular dependencies

3. Refactor `errorHandler.ts` to be framework-agnostic:
   - Accept `res` object as parameter
   - Return structured error responses
   - Work with both Express and potential future frameworks

**Important:** Maintain all error codes and metadata from Level 2

---

### Step 6: Update API Application Structure

**Actions:**
1. Move all files from `src/` to `apps/api/src/` preserving structure:
   ```
   apps/api/src/
     ├── index.ts                 (main application entry)
     ├── routes/                  (from src/routes/)
     ├── services/                (from src/services/)
     ├── middleware/              (from src/middleware/)
     └── lib/                     (app-specific utilities only)
   ```

2. Update imports in all API files:
   ```typescript
   // Before
   import { sql } from '../lib/db';
   import { Event } from '../types';
   
   // After
   import { sql } from '@ticket-hive/database';
   import { Event } from '@ticket-hive/types';
   ```

3. Move app-specific utilities to `apps/api/src/lib/`:
   - Only keep utilities that are NOT shared with worker
   - Most utilities should be in `packages/lib`

4. Update `apps/api/src/index.ts`:
   - Ensure database initialization still runs
   - Verify middleware chain intact
   - Confirm error handler registration

**Verification:**
- All TypeScript paths must resolve correctly
- No broken imports
- Application compiles without errors

---

### Step 7: Configure Build System

**Actions:**
1. Create `turbo.json` at root:
   ```json
   {
     "$schema": "https://turbo.build/schema.json",
     "globalDependencies": ["**/.env.*local"],
     "pipeline": {
       "build": {
         "dependsOn": ["^build"],
         "outputs": []
       },
       "lint": {},
       "dev": {
         "cache": false,
         "persistent": true
       }
     }
   }
   ```

2. Update root `package.json`:
   - Add `"workspaces": ["apps/*", "packages/*"]`
   - Add Turbo scripts: `build`, `dev`, `lint`
   - Keep existing Level 2 scripts for backward compatibility initially

3. Add TypeScript path mapping in root `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "paths": {
         "@ticket-hive/database": ["./packages/database/src/index.ts"],
         "@ticket-hive/types": ["./packages/types/src/index.ts"],
         "@ticket-hive/lib": ["./packages/lib/src/index.ts"]
       }
     }
   }
   ```

4. Ensure individual package tsconfig.json files extend root config

**Rationale:** Turbo enables efficient builds with caching and parallel execution

---

### Step 8: Update Docker Configuration

**Actions:**
1. Update `Dockerfile` for multi-stage monorepo builds with native TypeScript:
   ```dockerfile
   # Build stage - Type checking only
   FROM node:24-alpine AS builder
   WORKDIR /app
   COPY package*.json tsconfig.json turbo.json ./
   COPY apps/api/package.json ./apps/api/
   COPY packages/*/package.json ./packages/*/
   RUN npm ci
   COPY . .
   # Type check only (no transpilation needed for native TS support)
   RUN npm run build
   
   # Development stage - uses native TypeScript
   FROM node:24-alpine AS development
   WORKDIR /usr/src/app
   COPY --from=builder /app ./
   EXPOSE 3000 9229
   CMD ["node", "--experimental-transform-types", "--watch", "apps/api/src/index.ts"]
   
   # Production stage - runs TypeScript directly
   FROM node:24-alpine AS production
   WORKDIR /usr/src/app
   # No need to copy compiled dist - run TypeScript source directly
   COPY --from=builder /app/apps/api/src ./apps/api/src
   COPY --from=builder /app/packages ./packages
   COPY --from=builder /app/node_modules ./node_modules
   COPY --from=builder /app/package*.json ./
   COPY --from=builder /app/secrets ./secrets
   CMD ["node", "--experimental-transform-types", "apps/api/src/index.ts"]
   ```

   **Key Changes:**
   - Use Node.js 24 for native TypeScript support
   - No need for tsx or ts-node
   - Run TypeScript source files directly in production
   - Build stage only does type checking (`tsc --noEmit`)

2. Update `docker-compose.yml`:
   - Change volume mounts to new structure:
     ```yaml
     volumes:
       - ./apps/api/src:/usr/src/app/apps/api/src
       - ./packages:/usr/src/app/packages
     ```
   - Keep same port mappings

3. Add `.dockerignore` updates for monorepo with native TypeScript:
   ```
   **/*.test.ts
   **/*.spec.ts
   **/node_modules
   .git
   .turbo
   README.md
   # No need to ignore dist folders - we're running source directly
   ```
   
   **Note:** Since we're using native TypeScript support, no compilation artifacts to ignore.

**Critical:** Test both development and production Docker builds

---

### Step 9: Update Scripts and Configuration

**Actions:**
1. Update root `package.json` scripts:
   ```json
   {
     "scripts": {
       "dev": "turbo run dev --parallel",
       "build": "turbo run build",
       "api:dev": "node --watch --experimental-transform-types apps/api/src/index.ts",
       "docker:build": "docker build --target production -t tickethive:prod .","
       "docker:dev": "docker compose up -d"
     }
   }
   ```

2. Create app-specific scripts in `apps/api/package.json`:
   ```json
   {
     "scripts": {
       "dev": "node --watch --experimental-transform-types src/index.ts",
       "build": "tsc --noEmit",
       "start": "node --experimental-transform-types src/index.ts",
       "type-check": "tsc --noEmit"
     }
   }
   ```

   **Note:** `tsc --noEmit` is used for type checking only. Runtime execution uses Node's native TypeScript support.

3. Update `.env.example` with new path references if needed

4. Ensure `.gitignore` covers new build outputs:
   ```
   *.tsbuildinfo
   ```
   
   **Note:** No `dist/` folders needed - we use Node.js native TypeScript which runs `.ts` files directly.

---

### Step 10: Verification and Testing

**Actions:**
1. **Type Check:**
   ```bash
   npm run build
   # Should type-check all packages without errors
   # Note: No compilation artifacts created - Node runs TS directly
   ```

2. **Docker Build Check:**
   ```bash
   docker build --target production -t tickethive:prod .
   # Should complete successfully
   # Image will contain TypeScript source files, not compiled JS
   ```

3. **Start Services:**
   ```bash
   # Start services
   docker compose up -d
   
   # Wait for services to be ready
   sleep 10
   
   # Verify services are running
   docker compose ps
   ```

4. **API Health Check:**
   ```bash
   # Test basic API functionality
   curl http://localhost:3000/api/v1/events
   # Should return events list (may be empty if no events created yet)
      ```

5. **Validation Criteria (MUST PASS):**
   - ✅ All services start without errors
   - ✅ API container shows "Server running on port 3000" in logs
   - ✅ Database container starts without errors
   - ✅ No TypeScript compilation errors
   - ✅ Database schema unchanged (verify with psql if needed)
   - ✅ Zero functional changes to booking logic (code inspection)
   - ✅ All imports resolve correctly (no "module not found" errors in logs)
   - ✅ No tsx, ts-node, or dist references remain in codebase

**What counts as success:**
- API service may fail to start if environment variables are missing or Docker secrets aren't mounted - **THIS IS EXPECTED AND OK**
- The structure is correct: `/apps/api/src/index.ts` exists and uses package imports
- TypeScript type checking passes: `npm run build` succeeds
- All tests related to structure pass, functionality tests will come in Milestone 5

**Note:** Load testing is NOT performed in Milestone 0. This is a pure structural refactor. Load tests will be run in Milestone 5 after the async booking endpoint is implemented.
   ```bash
   # Check API logs
   docker compose logs server | tail -20
   
   # Verify database connectivity
   docker compose exec db psql -U tickethive_user -d tickethive -c "SELECT COUNT(*) FROM events;"
   
   # Check for any new errors
   docker compose logs --tail=50
   ```

---

## ⚠️ Common Pitfalls to Avoid

1. **Changing Business Logic**: This is a STRUCTURAL refactor only. Do not modify:
   - Database transaction logic
   - FOR UPDATE locking behavior  
   - Error handling logic
   - API endpoint behavior

2. **Breaking Imports**: Ensure all relative imports are updated to package imports

3. **Docker Volume Mounts**: Double-check that development mounts match new structure

4. **Environment Variables**: Verify all env vars still accessible in new structure

5. **TypeScript Path Mapping**: Ensure tsconfig.json paths match package names exactly

6. **Native TypeScript Flags**: Remember to use `--experimental-transform-types` in all Node.js scripts for features like enums

7. **Type-Only Imports**: Use `import type` where appropriate to help type stripping

8. **Testing Too Early**: Do not run load tests until AFTER type checking succeeds and services start cleanly

9. **tsconfig.json Configuration**: Ensure `isolatedModules` is set correctly for native TypeScript

10. **File Extensions**: Node.js native TypeScript requires `.ts` extensions in imports - ensure consistency

---

## 🚦 Go/No-Go Criteria

**Proceed to Milestone 1 ONLY IF:**
1. ✅ All services start without errors in Docker
2. ✅ API endpoints respond as expected (manually test at least GET /events)
3. ✅ TypeScript type checking passes with zero errors
4. ✅ No broken imports or module resolution errors
5. ✅ Docker logs show clean startup (no errors)
4. ✅ Build process completes successfully
5. ✅ No broken imports or TypeScript errors
6. ✅ Database schema and data unchanged
7. ✅ Zero functional changes to Level 2 behavior

**If ANY criterion fails:**
- STOP immediately
- Debug and fix the issue
- Re-run verification
- Document any deviations from plan

---

## 📦 Expected File Structure After Completion

```
tickets-hive/
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── routes/
│   │       ├── services/
│   │       └── middleware/
│   └── worker/
│       ├── package.json
│       └── src/              (empty, ready for Milestone 4)
├── packages/
│   ├── database/
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── db.ts
│   │       └── schema.ts
│   ├── types/
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.ts
│   │       ├── auth.ts
│   │       ├── event.ts
│   │       └── booking.ts
│   └── lib/
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── errors.ts
│           ├── errorHandler.ts
│           ├── auth.ts
│           └── env.ts
├── tests/                      (unchanged)
├── docker-compose.yml         (updated)
├── Dockerfile                 (updated)
├── turbo.json                 (new)
├── package.json               (updated with workspaces)
└── tsconfig.json              (updated with path mapping)
```

---

## ⏱️ Time Estimate

- **Total Estimated Time**: 4-6 hours
- **Directory Setup**: 30 minutes
- **Package.json Creation**: 30 minutes (simpler without tsx)
- **File Moving**: 1 hour
- **Import Updates**: 1-2 hours
- **Docker/Turbo Configuration**: 1 hour (Node 24 native TS)
- **Debug/Fix Issues**: 1-2 hours (less debugging without tsx)
- **Verification**: 30 minutes

**Buffer Time**: Add 1.5 hours for unexpected issues (reduced due to simpler setup)

**Time Savings with Native TypeScript:**
- No tsx configuration: -15 minutes
- No dist folder management: -15 minutes
- Simpler Docker setup: -15 minutes
- Faster startup (no transpilation): -10 minutes
- **Total time saved**: ~55 minutes

---

## 📝 Pre-Implementation Checklist

- [ ] Commit all current work to git
- [ ] Create new branch: `git checkout -b milestone-0-monorepo`
- [ ] Verify current Level 2 codebase runs successfully (manual API test is sufficient)
- [ ] Backup database if needed
- [ ] Have Docker and npm registry access
- [ ] IDE configured for monorepo (TypeScript path mapping support)
- [ ] Verify Node.js version: `node --version` (should be 24.x.x)
- [ ] Verify Docker has Node.js 24 image available

---

## ✅ Post-Implementation Checklist

- [ ] Test API endpoints manually with curl/Postman (test at least GET /events and GET /auth/register)
- [ ] Verify Docker logs show no errors
- [ ] Check that hot reload works in development with `--watch`
- [ ] Validate all packages build: `npm run build` (type check only)
- [ ] Verify no tsx/ts-node dependencies in package.json
- [ ] Verify Node.js native TypeScript is used: check scripts use `node file.ts`
- [ ] Create git commit with message: "Milestone 0: Monorepo restructure with native TypeScript - Level 2 functionality preserved"
- [ ] Document any deviations from this plan
- [ ] Ready for Milestone 1 review

---

## 🆕 Native TypeScript Benefits

### Performance
- **Faster startup**: No transpilation step
- **Lower memory**: No tsx/ts-node runtime overhead
- **Simpler debugging**: Debug original TypeScript source directly
- **Smaller Docker images**: No need to copy compiled output

### Developer Experience
- **Simpler config**: No tsx or ts-node configuration needed
- **Fewer dependencies**: Remove tsx, ts-node, tsconfig-paths
- **Faster iteration**: `--watch` flag works natively
- **Better error stack traces**: Direct mapping to .ts files

### Production
- **Single source of truth**: Run same .ts files in dev and prod
- **Easier deployments**: No build step for TypeScript
- **Reduced complexity**: One less tool in the toolchain

### Node.js 24.11.1 Features Available
- Type annotations stripped by default
- `--experimental-transform-types` for enums, namespaces
- `--watch` for file watching
- Top-level await support
- ES modules with .ts extensions
- Import maps support

---

**Plan Created**: 2025-11-26  
**Target Completion**: Before starting Milestone 1  
**Dependencies**: None (this is the foundation)  
**Next Milestone**: Milestone 1 - Infrastructure Setup (Redis & BullMQ)
