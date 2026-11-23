export type SendPayload = {
  to: string;
  subject?: string;
  body: string;
};

export type SendResult = {
  ok: boolean;
  provider: string;
  error?: string;
};

export type ChannelProvider = {
  name: string;
  send: (payload: SendPayload) => Promise<SendResult>;
};
