export type SecretListItem = {
  key: string;
  updatedAt?: string;
  expiresAt?: string;
  hasValue: true;
};

export type SecretListResult = {
  orgId: string;
  canWrite: boolean;
  keys: SecretListItem[];
};

export type SecretsHealth = {
  ok: boolean;
  vault: boolean;
  masterKey: boolean;
};
