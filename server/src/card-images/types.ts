type CardImageStatusMap = {
  [Status in (typeof CARD_IMAGE_STATUS_ARRAY)[number] as Uppercase<Status>]: Status;
};

export const CARD_IMAGE_STATUS_ARRAY = ['pending', 'fetching', 'ready', 'failed'] as const;

export const CARD_IMAGE_STATUSES = {
  PENDING: 'pending',
  FETCHING: 'fetching',
  READY: 'ready',
  FAILED: 'failed',
} satisfies CardImageStatusMap;

export interface CardImageRow {
  imageKey: string;
  originUrl: string;
  storageKey: string;
  status: (typeof CARD_IMAGE_STATUS_ARRAY)[number];
  contentType: string | null;
  contentLength: number | null;
  checksum: string | null;
  attemptCount: number;
  lastError: string | null;
  lastErrorCode: string | null;
  lastAttemptedAt: Date | null;
  nextAttemptAt: Date | null;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  storedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ClaimedCardImageRow = Pick<CardImageRow, 'imageKey' | 'originUrl' | 'storageKey' | 'attemptCount'>;
