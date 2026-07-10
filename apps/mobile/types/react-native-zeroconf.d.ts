declare module "react-native-zeroconf" {
  export type ImplType = "NSD" | "DNSSD";

  export interface ZeroconfService {
    addresses?: string[];
    fullName?: string;
    host?: string;
    name?: string;
    port?: number;
    txt?: Record<string, string>;
  }

  export default class Zeroconf {
    on(event: "resolved", listener: (service: ZeroconfService) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    scan(type?: string, protocol?: string, domain?: string, implType?: ImplType): void;
    stop(implType?: ImplType): void;
    removeDeviceListeners(): void;
  }
}
