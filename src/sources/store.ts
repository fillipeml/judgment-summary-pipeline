/** Where the case files live, behind one interface.
 *
 * In the original engagement there were two stores with entirely different shapes: a bucket
 * of whole dockets addressed by case number, and a shared drive whose folder tree a person
 * had organised by hand. The pipeline should not know which; it asks for the documents of a
 * case and gets them. The demo implements the same interface over a local folder. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { extractCaseNumber } from "../domain/case-number.ts";
import { classifyDocument, type DocumentKind } from "./classify.ts";

export interface SourceDocument {
  /** Stable identifier within the store (a path, a key, a URL). */
  id: string;
  name: string;
  /** The path as the store knows it, including any parent folders. */
  path: string;
  bytes: number;
  kind: DocumentKind;
  /** The case number this document belongs to, if one could be read from name or path. */
  caseNumber: string | null;
}

export interface SourceStore {
  readonly kind: string;
  /** Every document the store holds. */
  list(): SourceDocument[];
  read(document: SourceDocument): Promise<Uint8Array>;
}

/** A folder on disk. Sub-folders are part of the path, because in a real shared drive the
 *  case number is often only on the parent folder and not on the file. */
export class FolderStore implements SourceStore {
  readonly kind = "folder";

  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  list(): SourceDocument[] {
    const out: SourceDocument[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        const path = relative(this.root, full).split(sep).join("/");
        out.push({
          id: path,
          name: entry.name,
          path,
          bytes: statSync(full).size,
          kind: classifyDocument(entry.name),
          caseNumber: extractCaseNumber(path) ?? extractCaseNumber(entry.name),
        });
      }
    };
    walk(this.root);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(document: SourceDocument): Promise<Uint8Array> {
    return new Uint8Array(readFileSync(join(this.root, document.path)));
  }
}

/** A manifest of documents held elsewhere, as a shared-drive export would give it. The demo
 *  reads the bytes from a local folder; a deployment would fetch them. */
export interface ManifestEntry {
  name: string;
  path: string;
  bytes: number;
  /** Where the bytes actually are. In the demo, a path relative to the manifest's folder. */
  location: string;
}

export class ManifestStore implements SourceStore {
  readonly kind = "manifest";
  private readonly entries: ManifestEntry[];

  private readonly resolve: (entry: ManifestEntry) => string;

  constructor(manifestPath: string, resolve: (entry: ManifestEntry) => string) {
    this.resolve = resolve;
    this.entries = JSON.parse(readFileSync(manifestPath, "utf8")) as ManifestEntry[];
  }

  list(): SourceDocument[] {
    return this.entries.map((e) => ({
      id: e.path,
      name: e.name,
      path: e.path,
      bytes: e.bytes,
      kind: classifyDocument(e.name),
      caseNumber: extractCaseNumber(e.path) ?? extractCaseNumber(e.name),
    }));
  }

  async read(document: SourceDocument): Promise<Uint8Array> {
    const entry = this.entries.find((e) => e.path === document.path);
    if (!entry) throw new Error(`${document.path} is not in the manifest`);
    return new Uint8Array(readFileSync(this.resolve(entry)));
  }
}

/** Several stores searched as one, in order of preference. */
export class CompositeStore implements SourceStore {
  readonly kind = "composite";
  private readonly owner = new Map<string, SourceStore>();

  private readonly stores: SourceStore[];

  constructor(stores: SourceStore[]) {
    this.stores = stores;
  }

  list(): SourceDocument[] {
    const out: SourceDocument[] = [];
    for (const store of this.stores) {
      for (const doc of store.list()) {
        const id = `${store.kind}:${doc.id}`;
        this.owner.set(id, store);
        out.push({ ...doc, id });
      }
    }
    return out;
  }

  async read(document: SourceDocument): Promise<Uint8Array> {
    const store = this.owner.get(document.id);
    if (!store) throw new Error(`no store owns ${document.id}`);
    return store.read({ ...document, id: document.id.slice(document.id.indexOf(":") + 1) });
  }

  filenameOf(documentId: string): string {
    return basename(documentId);
  }
}
