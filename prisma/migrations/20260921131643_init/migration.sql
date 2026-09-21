-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "thumbnailUrl" TEXT,
    "uploadsPlaylistId" TEXT NOT NULL,
    "lastFetchedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Video" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "kindAssumed" BOOLEAN NOT NULL DEFAULT false,
    "durationSec" INTEGER NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL,
    "goneAt" DATETIME,
    CONSTRAINT "Video_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FetchRun" (
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
    "snapshotPath" TEXT,
    "errorReason" TEXT,
    CONSTRAINT "FetchRun_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VideoStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoId" TEXT NOT NULL,
    "fetchRunId" TEXT NOT NULL,
    "viewCount" INTEGER,
    "likeCount" INTEGER,
    "commentCount" INTEGER,
    "viralityScore" REAL,
    CONSTRAINT "VideoStat_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VideoStat_fetchRunId_fkey" FOREIGN KEY ("fetchRunId") REFERENCES "FetchRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Video_channelId_idx" ON "Video"("channelId");

-- CreateIndex
CREATE INDEX "Video_channelId_kind_idx" ON "Video"("channelId", "kind");

-- CreateIndex
CREATE INDEX "FetchRun_channelId_startedAt_idx" ON "FetchRun"("channelId", "startedAt");

-- CreateIndex
CREATE INDEX "VideoStat_fetchRunId_idx" ON "VideoStat"("fetchRunId");

-- CreateIndex
CREATE UNIQUE INDEX "VideoStat_videoId_fetchRunId_key" ON "VideoStat"("videoId", "fetchRunId");
