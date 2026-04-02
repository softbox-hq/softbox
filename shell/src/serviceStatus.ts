export type ServiceHealthStatus = "healthy" | "warning" | "error" | "unknown";

export type ServiceStatus = {
  name: string;
  role: string;
  detail: string;
  status: ServiceHealthStatus;
  message: string;
  checkedAt: number;
};
