/**
 * The slice of Chromium's File System Access API this module uses (spec L497: "With a file handle
 * (Chromium's File System Access API) it writes that file"). No `@types` package ships these, so they're
 * declared locally, narrow, and read off `window` with a cast: never a global augmentation (contracts §1
 * forbids touching `tsconfig.json`, so no `lib` addition either).
 */

export type FsWritable = { write(data: string): Promise<void>; close(): Promise<void> };

export type FsFileHandle = {
  readonly name: string;
  createWritable(): Promise<FsWritable>;
  getFile?(): Promise<File>;
};

export type SaveFilePickerOptions = {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
};

export type OpenFilePickerOptions = {
  multiple?: false;
  types?: { description: string; accept: Record<string, string[]> }[];
};

export type FsDirectoryHandle = {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FsFileHandle>;
};

export type FsWindow = {
  showSaveFilePicker?(options?: SaveFilePickerOptions): Promise<FsFileHandle>;
  showOpenFilePicker?(options?: OpenFilePickerOptions): Promise<FsFileHandle[]>;
  showDirectoryPicker?(): Promise<FsDirectoryHandle>;
};

/** The ambient `window`, narrowed to the handful of File System Access members this module calls. */
export function fsWindow(): FsWindow | null {
  return typeof window === "undefined" ? null : (window as unknown as FsWindow);
}

/** `AbortError`: the person cancelled the native picker. Never an error to show. */
export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
