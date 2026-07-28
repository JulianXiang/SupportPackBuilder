import type {
  FileConversionAdapter,
  OfficeConversionRequest,
  OfficeConversionResult,
} from './file-conversion-adapter.js'

export class ConversionManager {
  readonly #adapter: FileConversionAdapter
  #tail: Promise<void> = Promise.resolve()

  constructor(adapter: FileConversionAdapter) {
    this.#adapter = adapter
  }

  async convert(request: OfficeConversionRequest): Promise<OfficeConversionResult> {
    if (!this.#adapter.supports(request.officeFormat)) {
      throw new Error(`没有可处理 ${request.officeFormat.toUpperCase()} 的离线转换适配器。`)
    }
    let release!: () => void
    const previous = this.#tail
    this.#tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      if (request.signal.aborted) throw new Error('用户取消了 Office 转换。')
      return await this.#adapter.convert(request)
    } finally {
      release()
    }
  }
}
