export const USER_ROLES = ["OWNER", "ADMIN", "SALES_AGENT", "VIEWER"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type ApiSuccess<T> = {
  success: true;
  data: T;
  message: string;
};

export type ApiError = {
  success: false;
  error: { code: string; message: string; details?: unknown };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

