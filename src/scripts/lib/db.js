import bugsnagClient from './bugsnag';
import origins from '../origins';
const browser = require('webextension-polyfill');

const ORIGINS_KEY = 'TogglButton-origins';

// settings: key, default value
const DEFAULT_SETTINGS = {
  startAutomatically: false,
  stopAutomatically: false,
  showRightClickButton: true,
  showPostPopup: true,
  nannyCheckEnabled: true,
  nannyInterval: 3600000,
  nannyFromTo: '09:00-17:00',
  idleDetectionEnabled: false,
  pomodoroModeEnabled: false,
  pomodoroSoundFile: 'sounds/time_is_up_1.mp3',
  pomodoroSoundEnabled: true,
  pomodoroSoundVolume: 1,
  pomodoroStopTimeTrackingWhenTimerEnds: true,
  pomodoroInterval: 25,
  stopAtDayEnd: false,
  dayEndTime: '17:00',
  defaultProject: 0,
  rememberProjectPer: 'false',
  enableAutoTagging: false
};

// core settings: key, default value
const CORE_SETTINGS = {
  'dont-show-permissions': false,
  'show-permissions-info': 0,
  'settings-active-tab': 0,
  sendErrorReports: true,
  sendUsageStatistics: true
};

const transformLegacyValue = (value) => {
  if (typeof value !== 'undefined') {
    // Ensure older version's settings still function if they get saved to sync storage.
    if (value === 'false' || value === 'true') {
      return JSON.parse(value);
    }
    return value;
  } else {
    return null;
  }
};
export default class Db {
  constructor (togglButton) {
    this.togglButton = togglButton;
    this.loadAll();
  }

  async getOriginFileName (domain) {
    let origin = await this.getOrigin(domain);

    if (!origin) {
      origin = domain;
    }

    if (!origins[origin]) {
      // Handle cases where subdomain is used (like web.any.do (or sub1.sub2.any.do), we remove web from the beginning)
      origin = origin.split('.');
      while (origin.length > 0 && !origins[origin.join('.')]) {
        origin.shift();
      }
      origin = origin.join('.');
      if (!origins[origin]) {
        return null;
      }
    }

    const item = origins[origin];

    if (item.file) {
      return item.file;
    }

    return item.name.toLowerCase().replace(' ', '-') + '.js';
  }

  async getOrigin (origin) {
    const origins = await this.getAllOrigins();
    return origins[origin] || null;
  }

  async setOrigin (newOrigin, baseOrigin) {
    const origins = await this.getAllOrigins();
    origins[newOrigin] = baseOrigin;
    this.set(ORIGINS_KEY, {
      ...origins,
      [newOrigin]: baseOrigin
    });
  }

  async removeOrigin (origin) {
    const origins = await this.getAllOrigins();
    delete origins[origin];
    this.set(ORIGINS_KEY, origins);
  }

  async getAllOrigins () {
    const origins = await this.get(ORIGINS_KEY, {});
    return origins;
  }

  /**
   * Sets the default project for a given scope
   * @param {number} pid The project id
   * @param {string=} scope The scope to remember that project.
   * If null, then set global default
   */
  async setDefaultProject (pid, scope) {
    const userId = this.togglButton.$user.id;
    let defaultProjects = await this.get(userId + '-defaultProjects', {});
    if (!defaultProjects) defaultProjects = {}; // Catch pre-storage.sync settings

    if (!scope) {
      return this.set(userId + '-defaultProject', pid);
    }
    defaultProjects[scope] = pid;
    this.set(userId + '-defaultProjects', defaultProjects);
  }

  /**
   * Gets the default project for a given scope
   * @param {string=} scope If null, then get global default
   * @returns {number} The default project for the given scope
   */
  async getDefaultProject (scope) {
    if (!this.togglButton.$user) {
      return 0;
    }
    const userId = this.togglButton.$user.id;
    let defaultProjects = await this.get(userId + '-defaultProjects');
    if (!defaultProjects) defaultProjects = {}; // Catch pre-storage.sync settings

    let defaultProject = await this.get(userId + '-defaultProject');
    defaultProject = parseInt(defaultProject || '0', 10);

    if (!scope || !defaultProjects) {
      return defaultProject;
    }
    return defaultProjects[scope] || defaultProject;
  }

  resetDefaultProjects () {
    if (!this.togglButton.$user) {
      return;
    }
    this.set(this.togglButton.$user.id + '-defaultProjects', {});
  }

  get (key, defaultValue) {
    const hasDefaultValue = typeof defaultValue !== 'undefined';
    return browser.storage.sync.get(hasDefaultValue ? { [key]: defaultValue } : key)
      .then((result) => {
        if (process.env.DEBUG) {
          console.info(`Retrieved value ${key}: `, result[key]);
        }
        return transformLegacyValue(result[key]);
      });
  }

  /**
   * Retrieves multiple settings in one storage call
   * @param {Object} settings Map of setting keys and default values
   * @return {Object} Map of retrieved setting values
   */
  getMultiple (settings) {
    return browser.storage.sync.get(settings)
      .then((result) => {
        if (process.env.DEBUG) {
          console.info(`Retrieved values ${Object.keys(settings).join(', ')}: `, Object.values(result).map(JSON.strinfiy).join(', '));
        }
        return Object.keys(result).reduce((results, key) => {
          return Object.assign(results, {
            [key]: transformLegacyValue(result[key])
          });
        }, {});
      });
  }

  set (setting, value) {
    return browser.storage.sync
      .set({ [setting]: value })
      .catch((e) => {
        console.error(`Error attempting to save ${setting};`, e);
      })
      .finally(() => {
        if (process.env.DEBUG) {
          console.info(`Saved setting ${setting} :`, value);
        }
      });
  }

  setMultiple (settings) {
    return browser.storage.sync
      .set(settings)
      .catch((e) => {
        console.error(`Error attempting to save settings:`, settings, e);
      })
      .finally(() => {
        if (process.env.DEBUG) {
          console.info(`Saved multiple settings :`, settings);
        }
      });
  }

  getLocalCollection (key) {
    let collection = localStorage.getItem(key);
    if (!collection) {
      collection = {};
    } else {
      collection = JSON.parse(collection);
    }

    return collection;
  }

  async load (setting, defaultValue) {
    let value = await this.get(setting);

    // Attempt to migrate from old localStorage settings.
    if (value === null || typeof value === 'undefined') {
      value = localStorage.getItem(setting);
      if (value && typeof defaultValue === 'boolean') {
        value = JSON.parse(value);
      }
    }

    value = value || defaultValue;
    this.set(setting, value);
    return value;
  }

  loadAll () {
    for (const k in DEFAULT_SETTINGS) {
      if (DEFAULT_SETTINGS.hasOwnProperty(k)) {
        this.load(k, DEFAULT_SETTINGS[k]);
      }
    }

    for (const k in CORE_SETTINGS) {
      if (CORE_SETTINGS.hasOwnProperty(k)) {
        this.load(k, CORE_SETTINGS[k]);
      }
    }
  }

  updateSetting (key, state, callback, condition) {
    const c = condition !== null ? condition : state;
    this.set(key, state);

    if (c && callback !== null) {
      callback();
    }
  }

  resetAllSettings () {
    const allSettings = { ...DEFAULT_SETTINGS, ...CORE_SETTINGS };
    return this.setMultiple(allSettings)
      .then(() => {
        bugsnagClient.leaveBreadcrumb('Completed reset all settings');
      })
      .catch((e) => {
        bugsnagClient.notify(e);
        alert('Failed to reset settings. Please contact support@toggl.com for assistance or try re-installing the extension.');
      });
  }

  _migrateToStorageSync () {
    console.info('Migrating settings to v2');
    bugsnagClient.leaveBreadcrumb('Attempting settings migration to v2');

    try {
      const allSettings = { ...DEFAULT_SETTINGS, ...CORE_SETTINGS };
      const oldSettings = Object.keys(allSettings)
        .reduce((accumulator, key) => {
          const defaultValue = allSettings[key];
          let value = localStorage.getItem(key);
          if (value && typeof defaultValue === 'boolean') {
            value = JSON.parse(value);
          }
          accumulator[key] = value || defaultValue;
          return accumulator;
        }, {});

      if (process.env.DEBUG) {
        console.log('Found old settings: ', oldSettings);
      }

      this.setMultiple(oldSettings)
        .then(() => {
          console.info('Succesully migrated old settings to v2');
          bugsnagClient.leaveBreadcrumb('Migrated settings to v2');
        })
        .catch((e) => {
          console.error('Failed to migrate settings to v2; ');
          bugsnagClient.notify(e);
        });
    } catch (e) {
      bugsnagClient.notify(e);
    }
  }
}
