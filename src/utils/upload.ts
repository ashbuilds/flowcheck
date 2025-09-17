import fs from "fs";
import path from "path";

export function resolveFiles(list: string[]): string[] {
  return list.map((p) => path.resolve(p));
}

export function ensureFilesExist(files: string[]) {
  for (const f of files) {
    if (!fs.existsSync(f)) {
      throw new Error(`Upload file not found: ${f}`);
    }
  }
}

export async function trySetInputFiles(page: any, selector: string | undefined, files: string[]) {
  // 1) Provided selector first (if given)
  if (selector) {
    const loc = page.locator(selector);
    if (await loc.count()) {
      await loc.first().setInputFiles(files);
      return true;
    }
  }

  // 2) Fallback: any input[type=file] on page
  {
    const loc = page.locator("input[type='file']");
    if (await loc.count()) {
      await loc.first().setInputFiles(files);
      return true;
    }
  }

  // 3) Fallback: inside a dialog (if present)
  if (page.getByRole) {
    const dialog = page.getByRole("dialog");
    const inDialog = dialog.locator("input[type='file']");
    if (await inDialog.count()) {
      await inDialog.first().setInputFiles(files);
      return true;
    }
  }

  // 4) Fallback: search every frame
  for (const frame of page.frames()) {
    const loc = frame.locator("input[type='file']");
    if (await loc.count()) {
      await loc.first().setInputFiles(files);
      return true;
    }
  }

  return false;
}
