export interface ISessionInfo {
  session_id?: string;
  user_id: string;
  email: string;
  display_name: string;
  issued_at: string;
  login_time?: string;
  last_activity_time?: string;
  logout_time?: string;
  status?: "Active" | "Closed" | "Expired_Idle" | "Revoked_by_Admin";
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
