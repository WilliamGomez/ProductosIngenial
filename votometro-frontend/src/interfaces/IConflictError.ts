export interface IConflictError {
  error: "ACTIVE_SESSION_EXISTS";
  message: string;
  active_device_id?: string;
}
