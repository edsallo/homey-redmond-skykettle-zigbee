declare module 'homey-zigbeedriver' {
  import Homey from 'homey';

  export class ZigBeeDriver extends Homey.Driver {}

  export class ZigBeeDevice extends Homey.Device {
    registerCapability(
      capabilityId: string,
      cluster: unknown,
      configuration?: Record<string, unknown>,
    ): void;
  }
}
