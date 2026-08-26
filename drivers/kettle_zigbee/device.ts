import Homey from 'homey';
import { ZigBeeDevice } from 'homey-zigbeedriver';
import { CLUSTER } from 'zigbee-clusters';

export default class RedmondZigbeeDevice extends ZigBeeDevice {
  private temperatureProgram?: { target: number; reachedAt?: number };
  private keepWarmTimer?: NodeJS.Timeout;
  private temperatureTransitionUntil = 0;
  private thermostat: any;
  private onOff: any;
  private currentTemperatureToken?: Homey.FlowToken;
  private targetTemperatureToken?: Homey.FlowToken;
  private lastReportedPower?: boolean;
  private lastTemperature = 0;
  private boilingCycleActive = false;
  private boilingMaxTemperature = 0;
  private boilEvaluationTimer?: NodeJS.Timeout;

  async onNodeInit({ zclNode }: { zclNode: any }): Promise<void> {
    this.thermostat = zclNode.endpoints[1].clusters.thermostat;
    this.onOff = zclNode.endpoints[1].clusters.onOff;
    if (!this.hasCapability('kettle_program_status')) {
      await this.addCapability('kettle_program_status');
    }
    if (this.getCapabilityValue('kettle_program_status') === null) {
      await this.setProgramStatus('inactive');
    }
    await this.initializeFlowTokens();
    this.registerCapability('onoff', CLUSTER.ON_OFF, {
      setParser: (value: boolean) => {
        // A direct On command means normal boiling, not a temperature program.
        this.finishTemperatureProgram();
        if (value) this.startBoilingCycle();
        else this.cancelBoilingCycle();
        void this.setProgramStatus(value ? 'boiling' : 'inactive');
        return {};
      },
      reportParser: (value: boolean) => {
        const wasOn = this.lastReportedPower;
        this.lastReportedPower = value;
        // The ESP intentionally reports a brief OFF while changing temperature
        // (OFF → SetMode → ON). Do not treat that transition as cancellation.
        if (!value && Date.now() >= this.temperatureTransitionUntil) {
          if (wasOn && this.boilingCycleActive) this.evaluateCompletedBoil();
          this.finishTemperatureProgram();
          void this.setProgramStatus('inactive');
        } else if (value && !this.temperatureProgram) {
          if (!this.boilingCycleActive) this.startBoilingCycle();
          void this.setProgramStatus('boiling');
        }
        if (value) this.temperatureTransitionUntil = 0;
        return value;
      },
    });
    this.registerCapability('measure_temperature', CLUSTER.TEMPERATURE_MEASUREMENT, {
      get: 'measuredValue',
      report: 'measuredValue',
      getOpts: { getOnStart: true },
      reportParser: (value: number) => {
        const temperature = Math.round(value / 10) / 10;
        void this.onTemperature(temperature);
        return temperature;
      },
      reportOpts: {
        configureAttributeReporting: { minInterval: 1, maxInterval: 30, minChange: 100 },
      },
    });
    this.registerCapability('target_temperature', CLUSTER.THERMOSTAT, {
      get: 'occupiedHeatingSetpoint',
      report: 'occupiedHeatingSetpoint',
      set: 'writeAttributes',
      getOpts: { getOnStart: true },
      reportParser: (value: number) => {
        const target = Math.round(value / 100);
        void this.targetTemperatureToken?.setValue(target);
        return target;
      },
      setParser: (value: number) => {
        const target = Math.min(100, Math.max(40, Math.round(value)));
        this.startTemperatureProgram(target);
        return { occupiedHeatingSetpoint: target * 100 };
      },
      reportOpts: {
        configureAttributeReporting: { minInterval: 1, maxInterval: 30, minChange: 100 },
      },
    });

    for (const temperature of [40, 55, 70, 85]) {
      this.registerCapabilityListener(`button.temperature_${temperature}`, async () => {
        this.startTemperatureProgram(temperature);
        await this.thermostat.writeAttributes({ occupiedHeatingSetpoint: temperature * 100 });
      });
    }

    await this.setAvailable();
    this.log('REDMOND Zigbee bridge initialized');
  }

  async onSettings({ changedKeys }: { changedKeys: string[] }): Promise<void> {
    if (changedKeys.includes('keep_warm_duration') && this.temperatureProgram?.reachedAt) {
      this.scheduleKeepWarmStop();
    }
  }

  async onDeleted(): Promise<void> {
    if (this.keepWarmTimer) this.homey.clearTimeout(this.keepWarmTimer);
    if (this.boilEvaluationTimer) this.homey.clearTimeout(this.boilEvaluationTimer);
    await Promise.all([
      this.currentTemperatureToken?.unregister(),
      this.targetTemperatureToken?.unregister(),
    ].filter(Boolean)).catch(this.error);
  }

  private startTemperatureProgram(target: number): void {
    this.cancelBoilingCycle();
    if (this.keepWarmTimer) this.homey.clearTimeout(this.keepWarmTimer);
    this.keepWarmTimer = undefined;
    this.temperatureProgram = { target };
    this.temperatureTransitionUntil = Date.now() + 5_000;
    void this.targetTemperatureToken?.setValue(target);
    void this.setProgramStatus('heating', target);
  }

  private async onTemperature(temperature: number): Promise<void> {
    this.lastTemperature = temperature;
    if (this.boilingCycleActive) {
      this.boilingMaxTemperature = Math.max(this.boilingMaxTemperature, temperature);
      if (this.lastReportedPower === false && this.boilingMaxTemperature >= 95) {
        void this.triggerBoiledFlow();
      } else if (this.boilingMaxTemperature >= 99) {
        // RK-G211S keeps reporting is_on=1 after its own boil auto-stop.
        // Reaching the boiling point during an ordinary boil is therefore the
        // reliable completion signal. Allow a short period for the kettle's
        // mechanical/firmware auto-stop before firing the Flow trigger.
        this.scheduleBoilingPointCompletion();
      }
    }
    await this.currentTemperatureToken?.setValue(temperature);
    const program = this.temperatureProgram;
    if (program && !program.reachedAt && temperature >= program.target) {
      program.reachedAt = Date.now();
      await this.setProgramStatus('holding', program.target);
      this.scheduleKeepWarmStop();
    }
  }

  private scheduleKeepWarmStop(): void {
    if (this.keepWarmTimer) this.homey.clearTimeout(this.keepWarmTimer);
    const program = this.temperatureProgram;
    if (!program?.reachedAt) return;
    const minutes = Math.min(15, Math.max(1, Number(this.getSetting('keep_warm_duration')) || 10));
    const delay = Math.max(0, program.reachedAt + minutes * 60_000 - Date.now());
    this.keepWarmTimer = this.homey.setTimeout(async () => {
      this.keepWarmTimer = undefined;
      if (this.temperatureProgram !== program) return;
      await this.onOff.setOff();
      this.temperatureProgram = undefined;
      this.temperatureTransitionUntil = 0;
      await this.setProgramStatus('inactive');
    }, delay);
  }

  private finishTemperatureProgram(): void {
    if (this.keepWarmTimer) this.homey.clearTimeout(this.keepWarmTimer);
    this.keepWarmTimer = undefined;
    this.temperatureProgram = undefined;
    this.temperatureTransitionUntil = 0;
  }

  private startBoilingCycle(): void {
    if (this.boilEvaluationTimer) this.homey.clearTimeout(this.boilEvaluationTimer);
    this.boilEvaluationTimer = undefined;
    this.boilingCycleActive = true;
    this.boilingMaxTemperature = this.lastTemperature;
  }

  private cancelBoilingCycle(): void {
    if (this.boilEvaluationTimer) this.homey.clearTimeout(this.boilEvaluationTimer);
    this.boilEvaluationTimer = undefined;
    this.boilingCycleActive = false;
    this.boilingMaxTemperature = 0;
  }

  private evaluateCompletedBoil(): void {
    if (this.boilingMaxTemperature >= 95) {
      void this.triggerBoiledFlow();
      return;
    }
    if (this.boilEvaluationTimer) this.homey.clearTimeout(this.boilEvaluationTimer);
    this.boilEvaluationTimer = this.homey.setTimeout(() => {
      this.boilEvaluationTimer = undefined;
      if (this.boilingCycleActive && this.lastReportedPower === false
          && this.boilingMaxTemperature >= 95) {
        void this.triggerBoiledFlow();
      } else {
        this.cancelBoilingCycle();
      }
    }, 5_000);
  }

  private scheduleBoilingPointCompletion(): void {
    if (this.boilEvaluationTimer) return;
    this.boilEvaluationTimer = this.homey.setTimeout(() => {
      this.boilEvaluationTimer = undefined;
      if (this.boilingCycleActive && this.boilingMaxTemperature >= 99) {
        void this.triggerBoiledFlow();
      }
    }, 4_000);
  }

  private async triggerBoiledFlow(): Promise<void> {
    if (!this.boilingCycleActive) return;
    const temperature = this.boilingMaxTemperature;
    this.cancelBoilingCycle();
    await this.homey.flow.getDeviceTriggerCard('kettle_boiled')
      .trigger(this, { temperature })
      .catch(this.error);
  }

  private async setProgramStatus(
    state: 'inactive' | 'boiling' | 'heating' | 'holding',
    temperature?: number,
  ): Promise<void> {
    const value = this.homey.__(`program.${state}`, temperature === undefined ? undefined : {
      temperature: String(temperature),
    });
    if (this.getCapabilityValue('kettle_program_status') !== value) {
      await this.setCapabilityValue('kettle_program_status', value);
    }
  }

  private async initializeFlowTokens(): Promise<void> {
    const id = String(this.getData().id).replace(/[^a-z0-9]/gi, '');
    this.currentTemperatureToken = await this.getOrCreateToken(
      `kettle${id}currenttemperature`, `${this.getName()} — Текущая температура`,
      Number(this.getCapabilityValue('measure_temperature') ?? 0),
    );
    this.targetTemperatureToken = await this.getOrCreateToken(
      `kettle${id}targettemperature`, `${this.getName()} — Заданная температура`,
      Number(this.getCapabilityValue('target_temperature') ?? 100),
    );
  }

  private async getOrCreateToken(id: string, title: string, value: number): Promise<Homey.FlowToken> {
    try {
      return this.homey.flow.getToken(id);
    } catch {
      return this.homey.flow.createToken(id, { type: 'number', title, value });
    }
  }
}
