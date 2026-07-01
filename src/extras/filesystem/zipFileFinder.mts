import { Queue } from '../../util/Queue.mts';
import { FileFinderRules, type FileFinder, type FileFinderOptions } from './FileFinder.mts';
import { StaticFileFinder } from './staticFileFinder.mts';
import type { ZipDirectory, ZipFile } from './readZip.mts';

export function zipFileFinder(
  source: ZipDirectory,
  options: FileFinderOptions = {},
): FileFinder & { staticPaths: () => Set<string> } {
  const rules = new FileFinderRules(options);
  const precomputed = new StaticFileFinder<ZipFile>(rules, async (entity, details) => ({
    handle: await entity.open(),
    stats: entity.stat(),
    filesystemPath: entity.filesystemPath,
    ...details,
  }));

  const queue = new Queue({ dir: source, path: [] as string[] });
  for (const { dir, path } of queue) {
    const siblings = new Map(
      [...dir.children.entries()]
        .filter(([_, data]) => !data.isDirectory)
        .map(([name, data]) => [rules._normalise(name), data as ZipFile]),
    );
    for (const [name, data] of dir.children) {
      if (!data.virtual && rules._checkPermitted(name)) {
        if (data.isDirectory) {
          const dirPath = [...path, name];
          precomputed._addDir(dirPath);
          if (path.length < rules._subDirectories) {
            queue.push({ dir: data, path: dirPath });
          }
        } else {
          precomputed._addFile(path, name, data, siblings);
        }
      }
    }
  }
  return precomputed;
}
