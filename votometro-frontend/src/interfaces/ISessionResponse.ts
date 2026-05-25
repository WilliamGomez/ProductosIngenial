export interface ISessionResponse {
  session_token: string;
  session_status?: "MFA_Pending" | "Active" | "Closed" | "Expired_Idle" | "Revoked_by_Admin";
  mfa_required?: boolean;
  mfa_enabled?: boolean;
  mfa_verified?: boolean;
}
