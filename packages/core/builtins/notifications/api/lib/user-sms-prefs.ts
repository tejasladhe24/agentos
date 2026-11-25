import {
  createDbUserSenderPrefsStore,
  createMemoryUserSenderPrefsStore,
  type UserSenderPref,
  type UserSenderPrefsStore,
} from './user-sender-prefs';

const USER_SMS_PREFS_COLLECTION = 'notifications_user_sms_prefs';

export type UserSmsPref = UserSenderPref;
export type UserSmsPrefsStore = UserSenderPrefsStore;

/** Org-scoped per-user SMS sender number preferences backed by `db-store`. */
export function createDbUserSmsPrefsStore(
  dbStoreBaseUrl: string,
): UserSmsPrefsStore {
  return createDbUserSenderPrefsStore(
    dbStoreBaseUrl,
    USER_SMS_PREFS_COLLECTION,
  );
}

/** In-memory per-user SMS sender number preferences for unit tests. */
export function createMemoryUserSmsPrefsStore(): UserSmsPrefsStore {
  return createMemoryUserSenderPrefsStore();
}
