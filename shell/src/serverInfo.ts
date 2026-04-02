export type ServerInfo = {
  hostname: string;
  platform: string;
  release: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalMemoryGb: number;
  freeMemoryGb: number;
  diskTotalGb: number | null;
  diskFreeGb: number | null;
  nodeVersion: string;
};
