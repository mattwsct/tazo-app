/**
 * Shape of a tip event received from the StreamElements Astro WebSocket gateway
 * when subscribed to the `channel.tips` topic.
 *
 * Reference: https://docs.streamelements.com/websockets/topics/channel-tips
 */
export interface StreamElementsTipEvent {
  _id: string;
  channel: string;
  provider: string;
  approved: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  transactionId?: string;
  donation: {
    user: {
      username: string;
      geo?: string;
      email?: string;
      channel?: string;
    };
    message: string;
    amount: number;
    currency: string;
    paymentMethod?: string;
  };
}
