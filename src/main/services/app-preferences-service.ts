import ElectronStore from 'electron-store'
import {
  AppPreferencesSchema,
  DEFAULT_APP_PREFERENCES,
  type AppPreferences,
  type AppPreferencesUpdate,
} from '../../shared/schemas/preferences-schema.js'
import { appLog } from './log-service.js'

const Store =
  typeof ElectronStore === 'function'
    ? ElectronStore
    : (ElectronStore as unknown as { default: typeof ElectronStore }).default

export class AppPreferencesService {
  readonly #store: ElectronStore<AppPreferences>

  constructor(input: { cwd?: string } = {}) {
    this.#store = new Store<AppPreferences>({
      name: 'ui-preferences',
      defaults: DEFAULT_APP_PREFERENCES,
      clearInvalidConfig: true,
      ...(input.cwd ? { cwd: input.cwd } : {}),
    })
  }

  get(): AppPreferences {
    const parsed = AppPreferencesSchema.safeParse(this.#store.store)
    if (parsed.success) return parsed.data
    appLog.warn('界面偏好配置无效，已回退到默认设置', parsed.error)
    return { ...DEFAULT_APP_PREFERENCES }
  }

  update(input: AppPreferencesUpdate): AppPreferences {
    const next = AppPreferencesSchema.parse({ ...this.get(), ...input })
    this.#store.store = next
    return next
  }
}
