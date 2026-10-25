// SPDX-FileCopyrightText: 2026 TorrPlay
//
// SPDX-License-Identifier: MIT

import { TorstApi } from '../api/torst';
import { translate } from '../lang/translations';
import { TorstInstance } from '../types/torst';
import { deobfuscateCredential, obfuscateCredential } from '../utils/storage-obfuscation';
import { generateUuid } from '../utils/uuid';

export const STORAGE_KEY_INSTANCES = 'torst_instances';
const STORAGE_KEY_MODE = 'torst_selection_mode';
const STORAGE_KEY_SELECTED = 'torst_selected_instance';

export const BENCHMARK_FRESHNESS_MS = 2 * 60 * 1000;

export type SelectionMode = 'auto' | 'manual';

export class InstanceManager {
  private static instances: TorstInstance[] = [];
  // Which databases requests can reach: null until the pool is first loaded.
  private static instancePoolSignature: string | null = null;
  private static isInitialized = false;
  private static readonly selectionListeners: Array<() => void> = [];

  /**
   * Registers a listener for changes to which instance requests are sent to. Anything cached
   * per instance has to be dropped when that changes, and this is the only place that knows.
   */
  public static onSelectionChanged(listener: () => void): void {
    this.selectionListeners.push(listener);
  }

  private static notifySelectionChanged(): void {
    this.selectionListeners.forEach(listener => {
      try {
        listener();
      } catch {} // A listener that throws must not break instance selection itself.
    });
  }

  public static init(): void {
    if (this.isInitialized) return;
    this.load();
    this.isInitialized = true;
  }

  public static getMode(): SelectionMode {
    return (Lampa.Storage.get(STORAGE_KEY_MODE, 'auto') as SelectionMode) || 'auto';
  }

  public static setMode(mode: SelectionMode): void {
    const previousMode = this.getMode();
    Lampa.Storage.set(STORAGE_KEY_MODE, mode);

    if (mode === 'manual') {
      const instances = this.getInstances();
      const selectedInstance = instances.find(instance => instance.id === this.getSelectedId());
      if (!selectedInstance) {
        this.setSelectedId(instances[0]?.id || '');
      }
    }

    if (previousMode !== mode) this.notifySelectionChanged();
  }

  public static getSelectedId(): string {
    return Lampa.Storage.get(STORAGE_KEY_SELECTED, '');
  }

  public static setSelectedId(id: string): void {
    const previousId = this.getSelectedId();
    Lampa.Storage.set(STORAGE_KEY_SELECTED, id);
    if (previousId !== id) this.notifySelectionChanged();
  }

  public static load(): TorstInstance[] {
    const storedInstances = Lampa.Storage.get(STORAGE_KEY_INSTANCES, '[]');
    try {
      const rawInstances = typeof storedInstances === 'string' ? JSON.parse(storedInstances) : storedInstances;
      if (Array.isArray(rawInstances)) {
        const unreadableCredentialInstances: string[] = [];
        this.instances = (rawInstances as TorstInstance[]).map(
          instance => {
            let password = instance.password;
            if (password !== undefined) {
              const deobfuscated = deobfuscateCredential(password);
              if (password !== '' && deobfuscated === '') {
                unreadableCredentialInstances.push(instance.name || instance.url || 'Torst');
              }
              password = deobfuscated;
            }
            return {
              ...instance,
              ...(password !== undefined ? { password } : {}),
              status: 'unknown' as const,
            };
          }
        );

        if (unreadableCredentialInstances.length > 0 && typeof Lampa !== 'undefined' && Lampa.Noty?.show) {
          const names = unreadableCredentialInstances.join(', ');
          Lampa.Noty.show(
            translate(
              'torst_invalid_credentials_noty',
              `Torst: Saved credentials for ${names} could not be read. Please re-enter the password in Settings.`,
              { names }
            )
          );
        }
      } else {
        this.instances = [];
      }
    } catch {
      this.instances = [];
    }

    // Default fallback if completely empty
    if (this.instances.length === 0) {
      this.instances = [
        {
          authType: 'none',
          id: generateUuid(),
          name: 'Local Torst',
          status: 'unknown' as const,
          url: 'http://127.0.0.1:8080',
        },
      ];
      this.save();
    }

    this.syncPoolSignature();
    return this.instances;
  }

  public static save(): void {
    // Ephemeral tokens (accessToken, playbackToken) and runtime benchmarks (checkedAtMs, checkedUrl, latencyMs)
    // are strictly kept in-memory to prevent persistent credential leakage in localStorage.
    // Stored passwords are obfuscated to prevent plaintext leakage in storage dumps.
    const sanitized = this.instances.map(instance => {
      const persisted: TorstInstance = {
        authType: instance.authType,
        ...(instance.enableDownloader !== undefined ? { enableDownloader: instance.enableDownloader } : {}),
        id: instance.id,
        name: instance.name,
        ...(instance.password !== undefined ? { password: obfuscateCredential(instance.password) } : {}),
        ...(instance.profileId ? { profileId: instance.profileId, profileName: instance.profileName } : {}),
        status: 'unknown' as const,
        url: instance.url,
      };
      return persisted;
    });

    Lampa.Storage.set(STORAGE_KEY_INSTANCES, JSON.stringify(sanitized));
    this.syncPoolSignature();
  }

  /**
   * Announces a change to the set of databases requests can reach. Only instance identity and
   * URL count: credentials, names, and benchmarks leave every database where it was.
   */
  private static syncPoolSignature(): void {
    const signature = JSON.stringify(this.instances.map(instance => [instance.id, instance.url]).sort());
    if (signature === this.instancePoolSignature) return;
    const isFirstLoad = this.instancePoolSignature === null;
    this.instancePoolSignature = signature;
    if (!isFirstLoad) this.notifySelectionChanged();
  }

  public static getInstances(): TorstInstance[] {
    if (!this.isInitialized) this.init();
    return this.instances;
  }

  public static getPrimaryInstance(): TorstInstance {
    const list = this.getInstances();
    if (list.length === 0) {
      return this.load()[0];
    }
    if (this.getMode() === 'auto') {
      const online = list.filter(instance => (
        instance.status === 'online' && instance.latencyMs !== undefined && instance.latencyMs < Infinity
      ));
      if (online.length > 0) {
        online.sort((a, b) => (a.latencyMs || 0) - (b.latencyMs || 0));
        return online[0];
      }
    }
    const selectedId = this.getSelectedId();
    return list.find(instance => instance.id === selectedId) || list[0];
  }

  public static addInstance(instance: TorstInstance): void {
    this.instances.push(instance);
    this.save();
  }

  public static updateInstance(instance: TorstInstance): void {
    const instanceIndex = this.instances.findIndex(candidate => candidate.id === instance.id);
    if (instanceIndex !== -1) {
      this.instances[instanceIndex] = instance;
      this.save();
    }
  }

  public static removeInstance(id: string): void {
    this.instances = this.instances.filter(instance => instance.id !== id);
    if (this.getSelectedId() === id) {
      Lampa.Storage.set(STORAGE_KEY_SELECTED, this.instances[0]?.id || '');
    }
    this.save();
  }

  /**
   * Pings all instances in parallel using `/readyz` and measures latency.
   */
  public static async pingAll(): Promise<TorstInstance[]> {
    const instances = this.getInstances();
    if (instances.length === 0) return [];

    await Promise.all(
      instances.map(async instance => {
        instance.status = 'checking';
        await TorstApi.checkHealth(instance);
      })
    );

    this.save();
    return instances;
  }

  /**
   * Resolves the best available Torst instance according to selection mode and latency.
   */
  public static async getBestInstance(): Promise<TorstInstance> {
    if (!this.isInitialized) this.init();
    const mode = this.getMode();
    const instances = this.instances;

    if (instances.length === 0) {
      throw new Error('No Torst instances configured');
    }

    if (mode === 'manual') {
      const selectedId = this.getSelectedId();
      const selectedInstance = instances.find(instance => instance.id === selectedId) || instances[0];

      // Quick health verification
      const healthResult = await TorstApi.checkHealth(selectedInstance, 2500);
      if (healthResult.isOk) {
        return selectedInstance;
      }

      // If manual instance is down, trigger failover
      const fallbackInstance = await this.failover(selectedInstance);
      if (fallbackInstance) return fallbackInstance;
      throw new Error(`Instance "${selectedInstance.name}" is offline and no fallbacks available`);
    }

    // Auto Mode: Ping all in parallel, sort by latency
    await this.pingAll();

    const reachableInstances = instances
      .filter(instance => (
        instance.status === 'online' && instance.latencyMs !== undefined && instance.latencyMs < Infinity
      ))
      .sort((first, second) => (first.latencyMs ?? 99999) - (second.latencyMs ?? 99999));

    if (reachableInstances.length > 0) {
      return reachableInstances[0];
    }

    throw new Error('All configured Torst instances are unreachable');
  }

  /**
   * Resolves the instance requests should go to, trusting a recent benchmark when it shows a
   * reachable instance, and benchmarking only when there is none. A benchmark only counts for
   * the URL it measured, since editing an instance changes its URL in place.
   */
  public static async getBestKnownInstance(): Promise<TorstInstance> {
    if (!this.isInitialized) this.init();
    const nowMs = Date.now();
    const isReachable = (instance: TorstInstance) => (
      instance.status === 'online'
      && instance.latencyMs !== undefined
      && instance.latencyMs < Infinity
      && instance.checkedAtMs !== undefined
      && nowMs - instance.checkedAtMs < BENCHMARK_FRESHNESS_MS
      && instance.checkedUrl === instance.url
    );

    if (this.getMode() === 'manual') {
      const selectedId = this.getSelectedId();
      const selectedInstance = this.instances.find(instance => instance.id === selectedId) || this.instances[0];
      if (selectedInstance && isReachable(selectedInstance)) return selectedInstance;
    } else {
      const fastestInstance = this.instances
        .filter(isReachable)
        .sort((first, second) => (first.latencyMs ?? 99999) - (second.latencyMs ?? 99999))[0];
      if (fastestInstance) return fastestInstance;
    }

    return this.getBestInstance();
  }

  /**
   * Failover to the next best available instance when an active instance goes offline.
   */
  public static async failover(failedInstance: TorstInstance, isAborted?: () => boolean): Promise<TorstInstance | null> {
    if (isAborted?.()) return null;
    failedInstance.status = 'offline';
    failedInstance.latencyMs = Infinity;

    const remainingInstances = this.instances.filter(instance => instance.id !== failedInstance.id);
    if (remainingInstances.length === 0) return null;

    // Ping remaining instances concurrently
    await Promise.all(remainingInstances.map(instance => TorstApi.checkHealth(instance, 2500)));
    if (isAborted?.()) return null;

    const reachableInstances = remainingInstances
      .filter(instance => (
        instance.status === 'online' && instance.latencyMs !== undefined && instance.latencyMs < Infinity
      ))
      .sort((first, second) => (first.latencyMs ?? 99999) - (second.latencyMs ?? 99999));

    if (reachableInstances.length > 0) {
      const nextInstance = reachableInstances[0];
      if (typeof Lampa !== 'undefined' && Lampa.Noty) {
        Lampa.Noty.show(
          translate(
            'torst_noty_failover',
            `Torst: ${failedInstance.name} offline → Switched to ${nextInstance.name} (${nextInstance.latencyMs} ms)`,
            {
              failed: failedInstance.name,
              latency: nextInstance.latencyMs ?? 0,
              next: nextInstance.name,
            }
          ),
          { time: 4000 }
        );
      }
      return nextInstance;
    }

    return null;
  }
}
