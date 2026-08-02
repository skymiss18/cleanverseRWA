export class CleanverseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleanverseConfigurationError";
  }
}

export class CleanverseHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId: string,
  ) {
    super(message);
    this.name = "CleanverseHttpError";
  }
}

export class CleanverseBusinessError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly requestId: string,
    readonly providerData: unknown,
  ) {
    super(message);
    this.name = "CleanverseBusinessError";
  }
}