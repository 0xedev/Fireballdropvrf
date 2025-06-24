export interface NotificationData {
  category:
    | "game-created"
    | "game-sponsored"
    | "game-joined"
    | "winners-selected";
  dropId: string;
  hostAddress?: string;
  sponsorAddress?: string;
  participantAddress?: string;
  participantName?: string;
  winnerAddresses?: string[];
  rewardAmount?: string;
  rewardType?: number;
  entryFee?: string;
  maxParticipants?: number;
  numWinners?: number;
  transactionHash?: string;
}

export function sendNotification(data: NotificationData): Promise<{
  success: boolean;
  message: string;
  data?: any;
}>;
