import {spawnSync} from 'node:child_process';

// Independent ZIP reader checks central directory, UTF-8 names, sizes and CRC.
export function readPhotoZip(path) {
  const result = spawnSync('python', ['-c',
    'import zipfile,json,base64,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None\n print(json.dumps([{ "name":i.filename,"bytes":base64.b64encode(z.read(i)).decode("ascii")} for i in z.infolist()]))', path], {encoding: 'utf8'});
  if (result.status !== 0) throw new Error(result.stderr || 'ZIP verification failed');
  return JSON.parse(result.stdout).map(entry => ({name: entry.name, bytes: Buffer.from(entry.bytes, 'base64')}));
}
