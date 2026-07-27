export type AppError = {
  code: string
  message: string
  stage: string
  fileName?: string
  materialTitle?: string
  canContinue: boolean
  suggestion?: string
}

export type Result<T> =
  | {
      ok: true
      value: T
    }
  | {
      ok: false
      error: AppError
    }

export const success = <T>(value: T): Result<T> => ({
  ok: true,
  value,
})

export const failure = <T = never>(error: AppError): Result<T> => ({
  ok: false,
  error,
})
