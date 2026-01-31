export class SubscriptionResponseDto {
  id: string;
  userId: string;
  packageId: string;
  startDate: Date;
  endDate: Date;
  usedQuota: number;
  todayUsed: number;
  status: string;
  package?: {
    id: string;
    name: string;
    monthlyQuota: number;
    dailyLimit: number;
  };
}
