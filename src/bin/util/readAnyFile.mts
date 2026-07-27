import { text } from 'node:stream/consumers';
import { SHARED_ASSET_OPENER } from '../../index.mts';

export const readAnyFile = async (path: string) => {
  const fd = await SHARED_ASSET_OPENER.open(path);
  try {
    return await text(fd.createReadStream());
  } finally {
    fd.close();
  }
};
