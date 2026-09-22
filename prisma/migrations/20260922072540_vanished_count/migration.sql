-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FetchRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "requestedLimit" INTEGER,
    "includeVideos" BOOLEAN NOT NULL DEFAULT true,
    "includeShorts" BOOLEAN NOT NULL DEFAULT true,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "expectedCount" INTEGER,
    "vanishedCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotPath" TEXT,
    "errorReason" TEXT,
    CONSTRAINT "FetchRun_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FetchRun" ("channelId", "errorReason", "expectedCount", "finishedAt", "id", "includeShorts", "includeVideos", "processedCount", "requestedLimit", "snapshotPath", "startedAt", "status") SELECT "channelId", "errorReason", "expectedCount", "finishedAt", "id", "includeShorts", "includeVideos", "processedCount", "requestedLimit", "snapshotPath", "startedAt", "status" FROM "FetchRun";
DROP TABLE "FetchRun";
ALTER TABLE "new_FetchRun" RENAME TO "FetchRun";
CREATE INDEX "FetchRun_channelId_startedAt_idx" ON "FetchRun"("channelId", "startedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
