import { z } from 'zod'

export const ONBOARDING_VERSION = 1

export const ExperienceModeSchema = z.enum(['basic', 'advanced'])

export const AppPreferencesSchema = z
  .object({
    schemaVersion: z.literal(1),
    experienceMode: ExperienceModeSchema,
    dismissedOnboardingVersion: z.number().int().min(0),
  })
  .strict()

export const AppPreferencesUpdateSchema = z
  .object({
    experienceMode: ExperienceModeSchema.optional(),
    dismissedOnboardingVersion: z.number().int().min(0).optional(),
  })
  .strict()

export type ExperienceMode = z.infer<typeof ExperienceModeSchema>
export type AppPreferences = z.infer<typeof AppPreferencesSchema>
export type AppPreferencesUpdate = z.infer<typeof AppPreferencesUpdateSchema>

export const DEFAULT_APP_PREFERENCES: AppPreferences = Object.freeze({
  schemaVersion: 1,
  experienceMode: 'basic',
  dismissedOnboardingVersion: 0,
})
