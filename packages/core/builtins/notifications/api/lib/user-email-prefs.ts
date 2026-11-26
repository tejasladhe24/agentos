import {
  createDbUserSenderPrefsStore,
  createMemoryUserSenderPrefsStore,
  type UserSenderPref,
  type UserSenderPrefsStore,
} from './user-sender-prefs';

const USER_EMAIL_PREFS_COLLECTION = 'notifications_user_prefs';

export type UserEmailPref = UserSenderPref;
export type UserEmailPrefsStore = UserSenderPrefsStore;

/** Org-scoped per-user email sender preferences backed by builtin `db-store`. */
export function createDbUserEmailPrefsStore(
  dbStoreBaseUrl: string,
): UserEmailPrefsStore {
  return createDbUserSenderPrefsStore(
    dbStoreBaseUrl,
    USER_EMAIL_PREFS_COLLECTION,
  );
}

/** In-memory per-user email sender preferences for unit tests. */
export function createMemoryUserEmailPrefsStore(): UserEmailPrefsStore {
  return createMemoryUserSenderPrefsStore();
}
