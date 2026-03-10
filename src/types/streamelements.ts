export interface StreamElementsTipEvent {
  _id: string;
  type: 'tip';
  channel: string;
  createdAt: string;
  /**
   * Main payload for the tip event as documented by StreamElements.
   * Amount is a number in the given currency (e.g. 5, 10.5).
   */
  data: {
    username: string;
    provider: string;
    amount: number;
    currency: string;
    message?: string;
  };
}

