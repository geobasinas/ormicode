export type FileErrorCode =
  | 'file.outside'
  | 'file.not_found'
  | 'file.not_git'
  | 'file.busy'
  | 'file.conflict'
  | 'file.binary'
  | 'file.bad_query'
  | 'file.failed';

export class FileError extends Error {
  readonly code: FileErrorCode;

  constructor(code: FileErrorCode, message: string) {
    super(message);
    this.name = 'FileError';
    this.code = code;
  }
}
