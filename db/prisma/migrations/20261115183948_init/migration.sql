-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('TEAMTAILOR', 'RECRUITEE', 'GREENHOUSE', 'LEVER', 'ASHBY', 'EMPLY', 'HRMANAGER');

-- CreateEnum
CREATE TYPE "FilterStatus" AS ENUM ('PENDING', 'PASSED', 'DROPPED');

-- CreateEnum
CREATE TYPE "ScoreStatus" AS ENUM ('NOT_NEEDED', 'PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('NEW', 'INTERESTED', 'APPLIED', 'NOT_INTERESTED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "FetchStatus" AS ENUM ('OK', 'EMPTY', 'SUSPICIOUS_EMPTY', 'ERROR', 'SKIPPED_RECENT');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('RUN_SUMMARY', 'INSTANT', 'DIGEST', 'HEALTH_ALERT');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "SourceType" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "careersUrl" TEXT,
    "city" TEXT,
    "tags" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "baselineDoneAt" TIMESTAMP(3),
    "lastFetchedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastJobCount" INTEGER,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "remoteType" TEXT,
    "description" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "filterStatus" "FilterStatus" NOT NULL DEFAULT 'PENDING',
    "filterReason" TEXT,
    "scoreStatus" "ScoreStatus" NOT NULL DEFAULT 'PENDING',
    "scoreAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastScoreError" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'NEW',
    "appliedAt" TIMESTAMP(3),
    "notificationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL,
    "gitSha" TEXT,
    "companiesChecked" INTEGER NOT NULL DEFAULT 0,
    "companiesSkipped" INTEGER NOT NULL DEFAULT 0,
    "companiesFailed" INTEGER NOT NULL DEFAULT 0,
    "jobsFetched" INTEGER NOT NULL DEFAULT 0,
    "jobsNew" INTEGER NOT NULL DEFAULT 0,
    "jobsPassedFilter" INTEGER NOT NULL DEFAULT 0,
    "jobsScored" INTEGER NOT NULL DEFAULT 0,
    "llmCalls" INTEGER NOT NULL DEFAULT 0,
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FetchLog" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "FetchStatus" NOT NULL,
    "httpStatus" INTEGER,
    "jobsFound" INTEGER NOT NULL DEFAULT 0,
    "jobsNew" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FetchLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Company_source_sourceKey_key" ON "Company"("source", "sourceKey");

-- CreateIndex
CREATE INDEX "Job_filterStatus_scoreStatus_idx" ON "Job"("filterStatus", "scoreStatus");

-- CreateIndex
CREATE INDEX "Job_firstSeenAt_idx" ON "Job"("firstSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_companyId_externalId_key" ON "Job"("companyId", "externalId");

-- CreateIndex
CREATE INDEX "FetchLog_companyId_createdAt_idx" ON "FetchLog"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FetchLog" ADD CONSTRAINT "FetchLog_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FetchLog" ADD CONSTRAINT "FetchLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
