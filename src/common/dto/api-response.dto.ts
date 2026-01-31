export class ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: {
    code: string;
    details?: unknown;
  };
  timestamp: string;
  path?: string;

  constructor(partial: Partial<ApiResponse<T>>) {
    Object.assign(this, partial);
    this.timestamp = new Date().toISOString();
  }

  static success<T>(data: T, message = 'Success'): ApiResponse<T> {
    return new ApiResponse({
      success: true,
      message,
      data,
    });
  }

  static error(
    message: string,
    code = 'ERROR',
    details?: unknown,
    path?: string,
  ): ApiResponse {
    return new ApiResponse({
      success: false,
      message,
      error: { code, details },
      path,
    });
  }
}
