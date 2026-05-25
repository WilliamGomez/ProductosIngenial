export interface ISessionInfo {
  session_id?: string;
  user_id: string;
  email: string;
  display_name: string;
  issued_at: string;
  login_time?: string;
  last_activity_time?: string;
  logout_time?: string;
  status?: "MFA_Pending" | "Active" | "Closed" | "Expired_Idle" | "Revoked_by_Admin";
  ip_address: string;
  is_active: boolean;
  is_blocked: boolean;
  diff_seconds: number;
  device_id?: string;
  session_token?: string;
}

export interface ISessionActivityPage {
  log_id: number;
  page_route: string;
  time_spent_seconds: number;
  created_at: string;
}

export interface ISessionActivityDetail extends ISessionInfo {
  total_seconds: number;
  pages: ISessionActivityPage[];
}

export interface ISessionAnalyticsSummary {
  total_sessions: number;
  total_users: number;
  active_sessions: number;
  expired_sessions: number;
  tracked_seconds: number;
  avg_tracked_seconds: number;
}

export interface ISessionAnalyticsUser {
  user_id: string;
  email: string;
  display_name: string;
  sessions: number;
  total_seconds: number;
  last_activity_time?: string;
}

export interface ISessionAnalyticsRoute {
  product_name: string;
  report_area: string;
  page_route: string;
  total_seconds: number;
  events: number;
  sessions: number;
}

export interface ISessionAnalyticsTimeBucket {
  date?: string;
  hour?: number;
  total_seconds: number;
  sessions: number;
  events: number;
}

export interface ISessionAnalyticsProduct {
  product_name: string;
  total_seconds: number;
  sessions: number;
  events: number;
}

export interface ISessionAnalyticsBrowser {
  browser: string;
  sessions: number;
  users: number;
}

export interface ISessionAnalyticsRecentSession {
  session_id: string;
  user_id: string;
  email: string;
  display_name: string;
  ip_address: string;
  status?: string;
  is_active: boolean;
  issued_at: string;
  last_activity_time?: string;
  tracked_seconds: number;
}

export interface ISessionAnalytics {
  days: number;
  summary: ISessionAnalyticsSummary;
  top_users: ISessionAnalyticsUser[];
  top_routes: ISessionAnalyticsRoute[];
  by_date: ISessionAnalyticsTimeBucket[];
  by_hour: ISessionAnalyticsTimeBucket[];
  by_product: ISessionAnalyticsProduct[];
  browsers: ISessionAnalyticsBrowser[];
  recent_sessions: ISessionAnalyticsRecentSession[];
  has_user_agent: boolean;
}
