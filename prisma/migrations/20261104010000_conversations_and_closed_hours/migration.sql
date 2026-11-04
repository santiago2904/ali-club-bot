-- CreateTable
CREATE TABLE "Conversation" (
    "phone" TEXT NOT NULL,
    "history" JSONB NOT NULL,
    "draft" JSONB NOT NULL,
    "lastOrderId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("phone")
);

-- CreateTable
CREATE TABLE "ClosedHoursContact" (
    "phone" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClosedHoursContact_pkey" PRIMARY KEY ("phone")
);
