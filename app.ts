import Homey from 'homey';

export default class RedmondKettleApp extends Homey.App {
  async onInit(): Promise<void> {
    this.log('REDMOND SkyKettle app initialized');
  }
}
