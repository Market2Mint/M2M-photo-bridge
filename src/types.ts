export interface PhotoData {
  id: string;
  url: string;
  status: 'syncing' | 'ready' | 'error';
  timestamp: number;
  type: 'item' | 'label';
}

export interface SessionData {
  sessionid: string;
  name: string;
  email: string;
  phoneNumber: string;
  totalAmount: string;
  reportid1: string;
  storecode: string;
  date: string;
  servicesOrdered: string;
  totalamountBridge: string;
  customernotes: string;
}
