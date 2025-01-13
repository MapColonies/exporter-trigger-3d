import { type ConfigInstance, config } from '@map-colonies/config';
import { threeDStoreTriggerV1, type threeDStoreTriggerV1Type } from '@map-colonies/schemas';

// Choose here the type of the config instance and import this type from the entire application
type ConfigType = ConfigInstance<threeDStoreTriggerV1Type>;

let configInstance: ConfigType | undefined;

/**
 * Initializes the configuration by fetching it from the server.
 * This should only be called from the instrumentation file.
 * @returns A Promise that resolves when the configuration is successfully initialized.
 */
async function initConfig(offlineMode?:boolean): Promise<void> {
  configInstance = await config({
    configName: 'store-trigger',
    configServerUrl: 'http://localhost:8080',
    schema: threeDStoreTriggerV1,
    version: 'latest',
    offlineMode: offlineMode,
    localConfigPath: './config'
  });
}

function getConfig(): ConfigType {
  if (!configInstance) {
    throw new Error('config not initialized');
  }
  return configInstance;
}

export { getConfig, initConfig, ConfigType };
