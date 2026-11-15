/**
 * An in-memory stand-in for the phone's files, for tests of photo posts (B22).
 *
 * Plays both sides of `social/postImages.ts`: `save` stands in for `savePostImageLocally` (the
 * copy of the picked photo into the waiting folder) and the object itself is the
 * `LocalPostImageFiles` the upload reads and cleans up. `files` is the set of file addresses
 * that "exist" — a test can delete one to play the phone clearing the folder.
 */
import { localPostImageUri, type LocalPostImageFiles } from '@/social/postImages';

export class FakePostImageFiles implements LocalPostImageFiles {
  /** Addresses of the files that exist, mapped to the picked file each was copied from. */
  readonly files = new Map<string, string>();
  /** When true, `save` throws (a full disk, a vanished picker file). */
  failSaves = false;

  /** The `savePostImageLocally` stand-in: "copies" `sourceUri` to the waiting address for `imagePath`. */
  save = async (sourceUri: string, imagePath: string): Promise<string> => {
    if (this.failSaves) throw new Error('copy failed: disk full');
    const target = localPostImageUri(imagePath);
    this.files.set(target, sourceUri);
    return target;
  };

  async exists(uri: string): Promise<boolean> {
    return this.files.has(uri);
  }

  async remove(uri: string): Promise<void> {
    this.files.delete(uri);
  }
}
